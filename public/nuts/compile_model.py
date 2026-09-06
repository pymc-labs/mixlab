"""Freeze a PyMC model and expose its Numba logp/gradient via a C callback.

Uses PyMC graph transformations without importing Nutpie.
Set PYTENSOR_FLAGS=cxx=,blas__ldflags=,numba__cache=False before importing PyTensor
in the browser. Keep the returned object alive for the lifetime of sampling.
"""

# This worker has no Jupyter widget manager; Mixlab renders its own progress UI.
# Suppress only tqdm's optional IProgress warning, preserving model warnings.
import warnings
warnings.filterwarnings('ignore', message=r'IProgress not found.*', module=r'tqdm\.(auto|autonotebook)')

import json
from dataclasses import dataclass

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

    def config(self):
        """Pointers refer to this Python runtime's WASM memory/function table."""
        return {
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


def compile_browser_model(model, var_names=None):
    """Compile continuous value variables; snapshot all current shared data.

    Compile density and expansion callbacks. Expansion follows PyMC backward
    transforms and includes selected deterministics. Data changes require
    recompilation. Discrete variables, JAX, and Python fallback Ops are unsupported.
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
    constants = {
        v: pt.constant(v.get_value())
        for v in graph_inputs(outputs)
        if isinstance(v, SharedVariable)
    }
    outputs = clone_replace(outputs, replace=constants)
    function = pytensor.function([q], outputs, mode="NUMBA")
    function(initial)
    inner = function.vm.jit_fn
    n = len(initial)
    pointer = numba.types.CPointer(numba.types.float64)

    @numba.cfunc(numba.types.float64(pointer, pointer), cache=False)
    def callback(xp, gp):
        x = numba.carray(xp, (n,))
        g = numba.carray(gp, (n,))
        lp, gradient = inner(x)
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
    shape_fn = pytensor.function(
        model.value_vars,
        [v.shape for v in selected],
        mode="FAST_COMPILE",
        on_unused_input="ignore",
    )
    shapes = shape_fn(*[point[v.name] for v in model.value_vars])
    flat = pt.concatenate(
        [pt.as_tensor_variable(v).ravel().astype("float64") for v in selected]
    )
    [flat], eq = join_nonshared_inputs(point, [flat], model.value_vars)
    constants = {
        v: pt.constant(v.get_value())
        for v in graph_inputs([flat])
        if isinstance(v, SharedVariable)
    }
    [flat] = clone_replace([flat], replace=constants)
    expand_function = pytensor.function([eq], flat, mode="NUMBA")
    expanded = np.ascontiguousarray(expand_function(initial), dtype=np.float64)
    expand_inner = expand_function.vm.jit_fn
    ne = len(expanded)

    @numba.cfunc(numba.types.int32(pointer, pointer), cache=False)
    def expand_callback(xp, op):
        (values,) = expand_inner(numba.carray(xp, (n,)))
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
    )
