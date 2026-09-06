"""Verify portable notebook models against the guided browser model specification.
Run with the matching native PyMC-Marketing environment from the repository root.
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import numpy as np

root = Path(__file__).resolve().parents[1]
export = r"""
import {notebook} from './lib/exports.ts';
import {parseCSV,inferMapping,validate,defaultConfig} from './lib/core.ts';
import {readFileSync} from 'node:fs';
const raw=parseCSV(readFileSync('public/example.csv','utf8'));
const data=validate(raw,inferMapping(raw)).data;
const fixtures=[{...defaultConfig,lag:12,priorScale:.5,seasonality:false},{...defaultConfig,lag:4,priorScale:3,seasonality:true,adstockPrior:{alpha:4,beta:2},saturationPrior:{alpha:5,beta:2}}].map(config=>{
 const nb=notebook(data,config,'native','https://example.com');
 return nb.cells.filter(c=>c.cell_type==='code').slice(0,3).map(c=>c.source.join('')).join('\n');
});
console.log(JSON.stringify(fixtures));
"""
fixtures = json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',export],cwd=root,text=True))
original_cwd = Path.cwd()
try:
    with tempfile.TemporaryDirectory() as temp:
        os.chdir(temp)
        for fixture in fixtures:
            portable = {}
            exec(fixture, portable)
            config = portable['config']
            Path('config.json').write_text(json.dumps(config))
            source = (root/'public/python/model.py').read_text().replace('/mixlab-data.csv',str(Path('mixlab-data.csv').resolve())).replace('/mixlab-config.json',str(Path('config.json').resolve()))
            runtime = {'Path': Path}
            exec(source, runtime)
            first, second = portable['model'], runtime['model']
            assert [v.name for v in first.free_RVs] == [v.name for v in second.free_RVs]
            np.testing.assert_allclose(first.compile_logp()(first.initial_point()),second.compile_logp()(second.initial_point()),rtol=1e-12)
            print(f'PASS: exported and browser models agree for lag={config["lag"]}, priorScale={config["priorScale"]}, seasonality={config["seasonality"]}')
finally:
    os.chdir(original_cwd)
