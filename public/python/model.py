"""Mixlab's trusted model. User data and settings arrive as JSON/CSV, never code."""
import json
import numpy as np
import pandas as pd
from pymc_marketing.mmm import MMM, GeometricAdstock, LogisticSaturation
from pymc_extras.prior import Prior

config = json.loads(Path('/mixlab-config.json').read_text())
data = pd.read_csv('/mixlab-data.csv', parse_dates=['date'])
channels = [c for c in data.columns if c.startswith('channel_')]
controls = [c for c in data.columns if c.startswith('control_')]
mmm = MMM(
    date_column='date', channel_columns=channels,
    control_columns=controls or None,
    adstock=GeometricAdstock(l_max=config['lag'], normalize=True, priors={'alpha': Prior('Beta', **config.get('adstockPrior', {'alpha': 1, 'beta': 3}))}),
    saturation=LogisticSaturation(priors={'beta': Prior('HalfNormal', sigma=config['priorScale']), 'lam': Prior('Gamma', **config.get('saturationPrior', {'alpha': 3, 'beta': 1}))}),
    yearly_seasonality=2 if config['seasonality'] else None,
)
mmm.build_model(data.drop(columns='y'), data.y)
model = mmm._get_sampling_model()

def emit(**event):
    print('MIXLAB_EVENT ' + json.dumps(event, allow_nan=False), flush=True)
