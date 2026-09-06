"""Numerical regression checks using conjugate Normal posteriors and real ArviZ.

Run with the bundled arviz-stats version (1.3.0) on PYTHONPATH.
"""
from pathlib import Path
import importlib.util
import json
import unittest
import numpy as np
from scipy.stats import norm

spec = importlib.util.spec_from_file_location('sensitivity', Path(__file__).resolve().parents[1] / 'public/python/sensitivity.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class SensitivityChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rng = np.random.default_rng(738)
        # prior N(0,1), y=2 with observation sd=1 => posterior N(1, 1/2).
        cls.x = rng.normal(1, np.sqrt(.5), size=(4, 4000))
        cls.prior = norm.logpdf(cls.x, 0, 1)
        cls.likelihood = norm.logpdf(2, cls.x, 1)
        cls.result = s.summarize_sensitivity(cls.prior, cls.likelihood, cls.x[..., None])

    def test_agrees_with_analytic_refits_for_both_components(self):
        for group in ('prior', 'likelihood'):
            for point in self.result['groups'][group][::5]:
                a = point['power']
                mean = 2 / (1 + a) if group == 'prior' else 2 * a / (1 + a)
                expected = norm.ppf([.05, .5, .95], loc=mean, scale=np.sqrt(1 / (1 + a)))
                c = point['channels'][0]
                np.testing.assert_allclose([c['low'], c['median'], c['high']], expected, atol=.055)
                self.assertTrue(point['reliable'])

    def test_original_is_exact_and_histograms_integrate_to_one(self):
        for group in ('prior', 'likelihood'):
            point = self.result['groups'][group][10]
            self.assertEqual(point['power'], 1)
            self.assertAlmostEqual(point['weightEss'], self.x.size)
            self.assertEqual(point['paretoK'], 0)
            c = point['channels'][0]
            np.testing.assert_allclose([c['low'], c['median'], c['high']], np.quantile(self.x, [.05, .5, .95]), rtol=0, atol=0)
            centers = self.result['binCenters'][0]
            for p in self.result['groups'][group]:
                self.assertAlmostEqual(sum(p['channels'][0]['density']) * (centers[1] - centers[0]), 1, places=10)
        json.dumps(self.result, allow_nan=False)

    def test_prior_and_likelihood_move_in_opposite_directions(self):
        prior = self.result['groups']['prior']
        likelihood = self.result['groups']['likelihood']
        self.assertLess(prior[-1]['channels'][0]['median'], prior[0]['channels'][0]['median'])
        self.assertGreater(likelihood[-1]['channels'][0]['median'], likelihood[0]['channels'][0]['median'])
        self.assertGreater(self.result['scores']['prior'][0], .05)

    def test_constant_log_prior_does_not_invent_sensitivity(self):
        result = s.summarize_sensitivity(np.zeros_like(self.prior), self.likelihood, self.x[..., None])
        self.assertTrue(all(p['paretoK'] == 0 for p in result['groups']['prior']))
        self.assertEqual(result['groups']['prior'][0]['channels'], result['groups']['prior'][10]['channels'])

    def test_extreme_weights_are_flagged(self):
        logp = self.prior * 1000
        result = s.summarize_sensitivity(logp, self.likelihood, self.x[..., None])
        self.assertFalse(result['groups']['prior'][0]['reliable'])
        self.assertTrue(result['groups']['prior'][10]['reliable'])

    def test_rejects_nonfinite_and_misaligned_inputs(self):
        with self.assertRaises(ValueError): s.summarize_sensitivity(self.prior, self.likelihood[0], self.x[..., None])
        with self.assertRaises(ValueError): s.summarize_sensitivity(self.prior * np.nan, self.likelihood, self.x[..., None])

if __name__ == '__main__': unittest.main()
