"""xarray results from the numeric view of the same expanded Arrow samples."""

import json
from pathlib import Path

import numpy as np
import xarray as xr


def load_worker_result(metadata_path):
    """Read local worker buffers; delete staging files even if conversion fails.

    Numeric values never leave this worker and return as Python source. Arrays
    own their storage, so transferring the JavaScript buffers cannot detach them.
    """
    path = Path(metadata_path)
    try:
        result = json.loads(path.read_text())
        chains, draws, width = result["shape"]
        for name, shape in [
            ("expanded_samples", (chains, draws, width)),
            ("samples", (chains, draws, result["unconstrained_width"])),
            ("stats", (chains, draws, 3)),
        ]:
            filename = result.pop(f"{name}_file", None)
            if filename is not None:
                result[name] = np.fromfile(filename, dtype="<f8").reshape(shape)
        raw = result["stats"]
        stats = np.empty(
            (chains, draws),
            dtype=[("diverging", "?"), ("n_steps", "u8"), ("step_size", "f8")],
        )
        for index, name in enumerate(stats.dtype.names):
            stats[name] = raw[:, :, index]
        result["stats"] = stats
        return result
    finally:
        for name in (
            "expanded_samples.bin",
            "samples.bin",
            "stats.bin",
            "metadata.json",
        ):
            (path.parent / name).unlink(missing_ok=True)
        # Also support explicitly supplied manifest file names.
        path.unlink(missing_ok=True)
        path.parent.rmdir()


def to_inference_data(result):
    samples = np.asarray(result["expanded_samples"])
    if samples.ndim == 1 and "shape" in result:
        samples = samples.reshape(result["shape"])
    if samples.ndim != 3:
        raise ValueError("Expected chain, draw, expanded-parameter axes")
    variables = {}
    offset = 0
    for variable in result["expanded_layout"]:
        size = variable["size"]
        values = samples[:, :, offset : offset + size].reshape(
            (*samples.shape[:2], *variable["shape"])
        )
        variables[variable["name"]] = (("chain", "draw", *variable["dims"]), values)
        offset += size
    if offset != samples.shape[-1]:
        raise ValueError("Expanded sample size does not match metadata")
    posterior = xr.Dataset(variables)
    for dim, values in result.get("coords", {}).items():
        if dim in posterior.dims and len(values) == posterior.sizes[dim]:
            posterior = posterior.assign_coords({dim: values})
    stats = result["stats"]
    if isinstance(stats, np.ndarray) and stats.ndim == 1 and "shape" in result:
        stats = stats.reshape((*samples.shape[:2], 3))
    if isinstance(stats, np.ndarray) and stats.ndim == 3 and not stats.dtype.names:
        stats = {
            "diverging": stats[:, :, 0].astype(bool),
            "n_steps": stats[:, :, 1].astype(np.uint64),
            "step_size": stats[:, :, 2],
        }
    sample_stats = xr.Dataset(
        {
            name: (
                ("chain", "draw"),
                stats[name]
                if isinstance(stats, dict)
                or (isinstance(stats, np.ndarray) and stats.dtype.names)
                else np.asarray([[draw[name] for draw in chain] for chain in stats]),
            )
            for name in ["diverging", "n_steps", "step_size"]
        }
    )
    return xr.DataTree.from_dict({"posterior": posterior, "sample_stats": sample_stats})
