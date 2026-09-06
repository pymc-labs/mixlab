# Agent capability audit

The assistant has two read tools (`inspect_workspace`, `inspect_data`) and eight workspace action kinds. Reads need no approval; workspace actions are reviewed before execution. Actions are validated both at the conversation boundary and in the workbench.

| Task | Available path | Preconditions / limits |
| --- | --- | --- |
| Explore data | `inspect_data` | Local numeric aggregates, missing/nonnumeric counts and pairwise complete Pearson correlations; no fit needed, no raw rows or categorical values shared. |
| Inspect current state and validation | `inspect_workspace` | Current mapping, configuration, validation, fit diagnostics, contribution intervals, comparable fits and scenario summaries. |
| Open a view | `navigate` | data, model, overview, scenarios, code. Navigation alone does not analyze data. |
| Change priors and sampling | `configure` | Shared channel priors, bounded settings; invalidates current fit. |
| Fit guided model | `fit` | Valid guided data and idle runtime. |
| Review diagnostics and robustness | `inspect_workspace` | Completed fits; comparing configurations requires separate fits. No automated sensitivity sweep. |
| Historical counterfactual | `scenario` | Current guided posterior and existing channel; multiplier 0–2. Not forecasting or optimization. |
| Draft custom model | `python_draft` | Complete source, sampled variable names and after-sampling analysis. Does not execute. |
| Run custom model | `python_fit` | Nonempty draft and idle runtime; host performs sampling. Runtime compatibility remains experimental. |
| Follow-up Python | `python_cell` | Successfully fitted kernel matching current model source and data; cannot perform pre-fit EDA. |
| Interpret Python output | `python_output` | Separate review before output is transmitted to the provider. |
| Upload, change mapping, export, stop fit | Manual UI | No agent action currently exposed. Assistant must explain where to do it. |

## Findings and fixes

- The reported `Opened data.` confirms successful navigation. The following generic `Unsupported action.` came from action validation; without the original provider payload its exact arguments cannot be reconstructed.
- Previously no descriptive data tool existed. `inspect_data` now supplies actual computed aggregates before any fit, including invalid guided datasets.
- The tool schema now declares per-kind required fields. Validation identifies missing, unexpected and invalid arguments and gives supported-action guidance rather than a generic failure.
- Failed, blocked and cancelled execution results are marked as tool errors; navigation changes now participate in stale-proposal detection. Python busy state is visible in context.
- The agent instructions explicitly distinguish pre-fit exploration, navigation, fitted Python and manual-only operations.

## Verification boundary

Automated tests cover every advertised action kind and view, required-field rejection, configuration/scenario limits, malformed Python requests, descriptive statistics and privacy exclusions, and mocked Anthropic/OpenAI transports. The full existing suite also exercises data validation, model math, scenarios, exports and sampler lifecycle.

No live paid provider conversation or fresh browser inference run was performed for this audit. Provider tool selection, browser approval/cancellation interaction and actual custom-model compilation still require end-to-end validation. This audit does not claim those paths were live-tested.
