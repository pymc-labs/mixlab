"""Validate the ArviZ data-backend bridge against the pinned native runtime."""
import ast
import json
from pathlib import Path
import numpy as np
import xarray as xr

source = ast.parse((Path(__file__).resolve().parents[1] / 'public/python/analyze.py').read_text())
functions = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in ('finite', 'diagnostic_plots')]
scope = {'np': np}
exec(compile(ast.Module(body=functions, type_ignores=[]), 'analyze.py', 'exec'), scope)
rng = np.random.default_rng(42)
posterior = xr.Dataset({'beta': (('chain', 'draw', 'channel'), rng.normal(size=(4, 120, 2))), 'sigma': (('chain', 'draw'), rng.exponential(size=(4, 120)))}, coords={'chain': range(4), 'draw': range(120), 'channel': ['search', 'social']})
diverging = np.zeros((4, 120), dtype=bool)
diverging[2, 19] = True
idata = xr.DataTree.from_dict({'posterior': posterior, 'sample_stats': xr.Dataset({'diverging': (('chain', 'draw'), diverging)})})
plots = scope['diagnostic_plots'](idata, ['beta', 'sigma'])
assert [p['name'] for p in plots] == ['beta [search]', 'beta [social]', 'sigma']
for p in plots:
    assert 'rankError' not in p and 'essError' not in p, p
    assert len(p['rank']) == 4
    assert len(p['ess']['x']) == len(p['ess']['y']) == 20
    assert p['divergences'][2] == [19]
    assert len(p['envelope']['x']) == len(p['envelope']['low']) == len(p['envelope']['high'])
np.testing.assert_array_equal(plots[0]['chains'], posterior.beta.sel(channel='search').values)
json.dumps(plots, allow_nan=False)
single = scope['diagnostic_plots'](idata.isel(chain=[0]), ['sigma'])[0]
assert 'at least two chains' in single['rankError']
assert len(single['chains']) == 1
print('PASS: scalar and channel parameters, full chains, rank envelopes, quantile ESS, divergences and single-chain fallback')
