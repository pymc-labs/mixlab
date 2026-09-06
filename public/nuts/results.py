"""xarray results from the numeric view of the same expanded Arrow samples."""

import numpy as np
import xarray as xr


def to_inference_data(result):
    samples = np.asarray(result["expanded_samples"])
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
    sample_stats = xr.Dataset(
        {
            name: (
                ("chain", "draw"),
                np.asarray([[draw[name] for draw in chain] for chain in stats]),
            )
            for name in ["diverging", "n_steps", "step_size"]
        }
    )
    return xr.DataTree.from_dict({"posterior": posterior, "sample_stats": sample_stats})
