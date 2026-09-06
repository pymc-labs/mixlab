"""Integration check against the same native package versions as the WASM runtime.
Uses short chains for API validation, never as a production convergence claim.
"""
from pathlib import Path
import contextlib, io, json, tempfile, time
import numpy as np
import pandas as pd
import pymc as pm

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as temp:
    temp = Path(temp)
    original = pd.read_csv(root / 'public/example.csv')
    renamed = original.rename(columns={'revenue':'y','paid_search':'channel_0','paid_social':'channel_1','event_1':'control_0','event_2':'control_1','trend':'control_2'})
    renamed.to_csv(temp / 'data.csv', index=False)
    config = dict(lag=8,seasonality=True,priorScale=2,seed=42)
    (temp / 'config.json').write_text(json.dumps(config))
    source = (root/'public/python/model.py').read_text().replace('/mixlab-data.csv',str(temp/'data.csv')).replace('/mixlab-config.json',str(temp/'config.json'))
    scope = dict(Path=Path)
    started=time.perf_counter()
    exec(source,scope)
    compiled=time.perf_counter()-started
    with scope['model']:
        idata=pm.sample(chains=2,cores=1,tune=150,draws=100,target_accept=.95,random_seed=42,progressbar=False)
    scope.update(idata=idata,_nuts_compile_seconds=compiled,_nuts_result={'sampling_seconds':time.perf_counter()-started-compiled})
    output=io.StringIO()
    with contextlib.redirect_stdout(output):exec((root/'public/python/analyze.py').read_text(),scope)
    lines=[json.loads(s[13:]) for s in output.getvalue().splitlines() if s.startswith('MIXLAB_EVENT ')]
    posterior=next(e['posterior'] for e in lines if e['type']=='result')
    assert len(posterior['alpha'])==200
    assert len(posterior['channelScale'])==2
    assert len(posterior['prediction']['median'])==len(original)
    assert all(np.isfinite(posterior['prediction']['median']))
    for i in range(len(original)):
        assert posterior['prediction']['low'][i]<=posterior['prediction']['median'][i]<=posterior['prediction']['high'][i]
    # Verify the exact numpy counterpart of the frontend counterfactual against PyMC deterministics.
    for c in range(2):
        xs=renamed[f'channel_{c}'].to_numpy()/posterior['channelScale'][c]
        for draw in (0,37,199):
            alpha=posterior['alpha'][draw][c]; lam=posterior['lam'][draw][c]; beta=posterior['beta'][draw][c]
            weights=alpha**np.arange(config['lag']);weights/=weights.sum()
            adstock=np.convolve(xs,weights)[:len(xs)]
            response=beta*np.tanh(lam*adstock/2)*posterior['targetScale']
            reference=idata.posterior.channel_contribution.isel(chain=draw//100,draw=draw%100,channel=c).values*posterior['targetScale']
            np.testing.assert_allclose(response,reference,rtol=1e-9,atol=1e-8)
    Path('/tmp/mixlab-native-posterior.json').write_text(json.dumps(posterior))
    print('PASS: model construction, sampling, diagnostics, prediction, parameter extraction, and response equations agree.')
    print(json.dumps(posterior['diagnostics'],indent=2))
