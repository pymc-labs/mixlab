/** Export an edited lab, including follow-up code, without sending its data anywhere. */
export function makeLabNotebook(
  { source, csv, config, varNames, afterSample, followup },
  origin,
) {
  const md = (source, id) => ({
    cell_type: 'markdown',
    id,
    metadata: {},
    source: source.split(/(?<=\n)/),
  });
  const code = (source, id) => ({
    cell_type: 'code',
    id,
    metadata: {},
    execution_count: null,
    outputs: [],
    source: source.split(/(?<=\n)/),
  });
  const literal = (value) =>
    `json.loads(${JSON.stringify(JSON.stringify(value))})`;
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        name: 'python3',
        display_name: 'Python 3',
        language: 'python',
      },
      language_info: { name: 'python', version: '3.13' },
      mixlab: { version: 1, mode: 'browser-lab' },
    },
    cells: [
      md(
        '# My open Python lab\n\nThis notebook preserves the edited model, data, sampling settings, post-fit code, and follow-up cell from Mixlab. Run it in notebook.link or Jupyter with IPython. Computation happens in a browser worker on your device. The file contains your data; only share it intentionally.',
        'intro',
      ),
      code(
        `import json\n\nmodel_source = ${literal(source)}\nprint(model_source)\n`,
        'model',
      ),
      code(
        `csv_text = ${literal(csv)}\nsampling_options = ${literal(config)}\nvariable_names = ${literal(varNames)}\n`,
        'data-settings',
      ),
      code(
        `after_sample = ${literal(afterSample)}\nfollowup_code = ${literal(followup)}\nprint(after_sample)\nprint(followup_code)\n`,
        'analysis',
      ),
      md(
        '## Open the edited lab\n\nChange any source string above, then run the cell below. Nothing runs in the browser lab until you click **Run model**. If embedding is blocked, use the separate-tab link. For a self-hosted instance, change `app_url`.',
        'launch-notes',
      ),
      code(
        `from IPython.display import IFrame, HTML, display\nfrom urllib.parse import quote\nfrom html import escape\n\napp_url = ${JSON.stringify(origin)}\npayload = dict(version=1, source=model_source, csv=csv_text, config=sampling_options, varNames=variable_names, afterSample=after_sample, followup=followup_code)\nurl = app_url.rstrip('/') + '/notebook.html#' + quote(json.dumps(payload), safe='')\ndisplay(HTML('<a target="_blank" rel="noopener" href="' + escape(url, quote=True) + '">Open the Python lab in a separate tab</a>'))\ndisplay(IFrame(url, width='100%', height=1200))\n`,
        'launch',
      ),
      md(
        'After sampling, run the follow-up cell in the lab against the same `mmm` and `idata`. Download its Arrow traces to continue in another environment. URL fragments are not sent in HTTP requests, but the link itself still contains the data.',
        'continue',
      ),
    ],
  };
}
