"""Compile a PyMC model and expose its Numba logp/gradient via a C callback.

Uses PyMC graph transformations without importing Nutpie.
Set PYTENSOR_FLAGS=cxx=,blas__ldflags=,numba__cache=False before importing PyTensor
in the browser. Keep the returned object alive for the lifetime of sampling.
"""

# This worker has no Jupyter widget manager; Mixlab renders its own progress UI.
# Suppress only tqdm's optional IProgress warning, preserving model warnings.
import warnings
warnings.filterwarnings('ignore', message=r'IProgress not found.*', module=r'tqdm\.(auto|autonotebook)')

import json
from dataclasses import dataclass, field

import numba
import numpy as np
import pytensor
import pytensor.tensor as pt
from pymc.pytensorf import join_nonshared_inputs
from pytensor.compile.sharedvalue import SharedVariable
from pytensor.graph.replace import clone_replace
from pytensor.graph.traversal import graph_inputs


@dataclass
class BrowserModel:
    callback: object
    function: object
    initial: np.ndarray
    scratch: np.ndarray
    gradient: np.ndarray
    layout: list
    expand_callback: object
    expand_function: object
    expanded: np.ndarray
    expanded_layout: list
    coords: dict

    data: np.ndarray = field(default_factory=lambda: np.empty(0))
    data_layout: list = field(default_factory=list)
    model: object = None
    shape_function: object = None

    def update_data(self, values):
        """Atomically update same-shape numeric data in the callback buffer."""
        layouts = {v["name"]: v for v in self.data_layout}
        if not isinstance(values, dict) or not values or set(values) - layouts.keys():
            raise ValueError(
                "Use names selected by mutable_data when preparing the model"
            )
        updates = []
        for name, value in values.items():
            spec = layouts[name]
            raw = np.asarray(value)
            if list(raw.shape) != spec["shape"]:
                raise ValueError(f"{name}: shape changes require recompilation")
            if raw.dtype.kind not in "biuf" or not np.all(np.isfinite(raw)):
                raise ValueError(f"{name}: data must be finite numeric values")
            converted = raw.astype(spec["dtype"])
            if not np.array_equal(raw, converted):
                raise ValueError(
                    f"{name}: values cannot be represented by the original dtype"
                )
            packed = converted.astype(np.float64)
            if not np.array_equal(packed.astype(spec["dtype"]), converted):
                raise ValueError(
                    f"{name}: values must be exactly representable as float64"
                )
            updates.append((spec, packed.ravel()))
        candidate = self.data.copy()
        for spec, packed in updates:
            candidate[spec["offset"] : spec["offset"] + spec["size"]] = packed
        shapes = self.shape_function(self.initial, candidate)
        if any(
            list(shape) != spec["shape"]
            for shape, spec in zip(shapes, self.expanded_layout)
        ):
            raise ValueError(
                "Data-dependent output shape changes require recompilation"
            )
        self.data[:] = candidate
        self.activate_data()

    def activate_data(self):
        for spec in self.data_layout:
            values = self.data[spec["offset"] : spec["offset"] + spec["size"]]
            self.model[spec["name"]].set_value(
                values.reshape(spec["shape"]).astype(spec["dtype"])
            )

    def config(self):
        """Pointers refer to this Python runtime's WASM memory/function table."""
        return {
            "data_pointer": int(self.data.ctypes.data) if self.data_layout else 0,
            "data_layout": self.data_layout,
            "callback_pointer": int(self.callback.address),
            "x_pointer": int(self.scratch.ctypes.data),
            "g_pointer": int(self.gradient.ctypes.data),
            "initial": self.initial.tolist(),
            "layout": self.layout,
            "expand_pointer": int(self.expand_callback.address),
            "expanded_pointer": int(self.expanded.ctypes.data),
            "expanded_size": len(self.expanded),
            "expanded_layout": self.expanded_layout,
            "coords": self.coords,
        }


def compile_browser_model(model, var_names=None, mutable_data=None):
    """Compile continuous value variables, optionally exposing mutable shared data.

    Compile density and expansion callbacks. Expansion follows PyMC backward
    transforms and includes selected deterministics. mutable_data selects same-shape
    numeric shared variables to pass through a stable buffer; other data are frozen. Discrete variables, JAX, and Python fallback Ops are unsupported.
    """
    if model.discrete_value_vars:
        raise ValueError("The browser adapter requires continuous value variables")
    point = model.initial_point()
    layout = [
        {
            "name": v.name,
            "shape": list(point[v.name].shape),
            "size": int(point[v.name].size),
        }
        for v in model.value_vars
    ]
    if not layout:
        raise ValueError("The model needs at least one free variable")
    initial = np.concatenate([point[v.name].ravel() for v in model.value_vars])
    initial = np.ascontiguousarray(initial, dtype=np.float64)
    initial.setflags(write=False)
    [logp], q = join_nonshared_inputs(point, [model.logp()], model.value_vars)
    outputs = [logp, pt.grad(logp, q)]
    shared = {
        k: v for k, v in model.named_vars.items() if isinstance(v, SharedVariable)
    }
    mutable_names = list(shared) if mutable_data is True else list(mutable_data or [])
    if len(mutable_names) != len(set(mutable_names)) or any(
        k not in shared for k in mutable_names
    ):
        raise ValueError("mutable_data must contain unique shared data names")
    data_layout, chunks, replacements = [], [], {}
    data_input = pt.vector("_nuts_data", dtype="float64")
    offset = 0
    for name in mutable_names:
        variable = shared[name]
        value = np.asarray(variable.get_value())
        if value.dtype.kind not in "biuf" or not np.all(np.isfinite(value)):
            raise ValueError(f"{name}: mutable data must be finite numeric values")
        packed = value.astype(np.float64)
        if not np.array_equal(packed.astype(value.dtype), value):
            raise ValueError(f"{name}: data must be exactly representable as float64")
        data_layout.append(
            {
                "name": name,
                "shape": list(value.shape),
                "size": int(value.size),
                "dtype": str(value.dtype),
                "offset": offset,
            }
        )
        replacements[variable] = (
            data_input[offset : offset + value.size]
            .reshape(value.shape)
            .astype(value.dtype)
        )
        chunks.append(packed.ravel())
        offset += value.size
    data = np.concatenate(chunks) if chunks else np.empty(0)

    def replace_shared(expressions):
        constants = {
            v: replacements.get(v, pt.constant(v.get_value()))
            for v in graph_inputs(expressions)
            if isinstance(v, SharedVariable)
        }
        return clone_replace(expressions, replace=constants)

    inputs = [data_input] if data_layout else []
    outputs = replace_shared(outputs)
    function = pytensor.function(
        [q, *inputs], outputs, mode="NUMBA", on_unused_input="ignore"
    )
    function(initial, *([data] if data_layout else []))
    inner = function.vm.jit_fn
    n = len(initial)
    pointer = numba.types.CPointer(numba.types.float64)

    if data_layout:
        nd = len(data)

        @numba.cfunc(numba.types.float64(pointer, pointer, pointer), cache=False)
        def callback(xp, gp, dp):
            lp, gradient = inner(numba.carray(xp, (n,)), numba.carray(dp, (nd,)))
            g = numba.carray(gp, (n,))
            for j in range(n):
                g[j] = gradient[j]
            return lp.item()
    else:

        @numba.cfunc(numba.types.float64(pointer, pointer), cache=False)
        def callback(xp, gp):
            lp, gradient = inner(numba.carray(xp, (n,)))
            g = numba.carray(gp, (n,))
            for j in range(n):
                g[j] = gradient[j]
            return lp.item()

    # Same graph-level expansion used by Nutpie's _make_functions:
    # PyMC supplies the backward transforms and deterministic expressions in
    # unobserved_value_vars. Never infer a transform from a variable's name.
    names = (
        list(var_names)
        if var_names is not None
        else [v.name for v in [*model.free_RVs, *model.deterministics]]
    )
    available = {v.name: v for v in model.unobserved_value_vars}
    if (
        not names
        or len(names) != len(set(names))
        or any(k not in available for k in names)
    ):
        raise ValueError("var_names must be unique unobserved model variable names")
    selected = [
        pt.as_tensor(available[k], allow_xtensor_conversion=True) for k in names
    ]
    shape_outputs, sq = join_nonshared_inputs(
        point, [v.shape for v in selected], model.value_vars
    )
    shape_fn = pytensor.function(
        [sq, *inputs],
        replace_shared(shape_outputs),
        mode="FAST_COMPILE",
        on_unused_input="ignore",
    )
    shapes = shape_fn(initial, *([data] if data_layout else []))
    flat = pt.concatenate(
        [pt.as_tensor_variable(v).ravel().astype("float64") for v in selected]
    )
    [flat], eq = join_nonshared_inputs(point, [flat], model.value_vars)
    [flat] = replace_shared([flat])
    expand_function = pytensor.function(
        [eq, *inputs], flat, mode="NUMBA", on_unused_input="ignore"
    )
    expanded = np.ascontiguousarray(
        expand_function(initial, *([data] if data_layout else [])), dtype=np.float64
    )
    expand_inner = expand_function.vm.jit_fn
    ne = len(expanded)
    if not ne:
        raise ValueError("At least one expanded output value is required")

    if data_layout:

        @numba.cfunc(numba.types.int32(pointer, pointer, pointer), cache=False)
        def expand_callback(xp, op, dp):
            (values,) = expand_inner(numba.carray(xp, (n,)), numba.carray(dp, (nd,)))
            if len(values) != ne:
                return 1
            out = numba.carray(op, (ne,))
            for j in range(ne):
                out[j] = values[j]
            return 0
    else:

        @numba.cfunc(numba.types.int32(pointer, pointer), cache=False)
        def expand_callback(xp, op):
            (values,) = expand_inner(numba.carray(xp, (n,)))
            if len(values) != ne:
                return 1
            out = numba.carray(op, (ne,))
            for j in range(ne):
                out[j] = values[j]
            return 0

    expanded_layout = []
    for name, shape in zip(names, shapes):
        shape = [int(x) for x in shape]
        dims = list(model.named_vars_to_dims.get(name, ()))
        dims = [
            dims[i] if i < len(dims) and dims[i] is not None else f"{name}_dim_{i}"
            for i in range(len(shape))
        ]
        expanded_layout.append(
            {"name": name, "shape": shape, "size": int(np.prod(shape)), "dims": dims}
        )
    coords = {
        str(k): np.asarray(v).tolist() for k, v in model.coords.items() if v is not None
    }
    coords = json.loads(json.dumps(coords, default=lambda value: value.isoformat()))
    return BrowserModel(
        callback,
        function,
        initial,
        initial.copy(),
        np.zeros(n),
        layout,
        expand_callback,
        expand_function,
        expanded,
        expanded_layout,
        coords,
        data,
        data_layout,
        model,
        shape_fn,
    )
