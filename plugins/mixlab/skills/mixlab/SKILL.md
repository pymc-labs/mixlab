---
name: mixlab
description: Open and operate the Mixlab MCP workbench to explore synthetic marketing mix data, adjust priors, run TyMC sampling and inspect convergence diagnostics. Use for explicit Mixlab requests or an active Mixlab session.
---

# Mixlab workbench

Use the plugin's Mixlab MCP tools. Call `open_demo` with `{}` to create a workspace and show the interactive app inside the host. Retain its `session_id` for subsequent calls. Each call opens a new session, so reuse the current session when continuing work.

Wait for `inspect_workspace` to report `browser_connected: true` before `start_fit`. The app must stay open for sampling. The MCP server is hosted at `https://pymc-mixlab-mcp.fly.dev/mcp`; no local server is needed. If it is unavailable, report the connection failure and retry once; do not claim a fit ran.

Use `inspect_data` for synthetic data aggregates and `configure_model` for supported prior and sampling changes. Changes clear the current result but retain saved fits. `start_fit` queues a real tymc-marketing fit and returns immediately. Poll `get_fit_status` until a terminal status, avoiding rapid repeated calls. Use `cancel_fit` only when cancellation is requested and verify acknowledgement.

Report completion only for `completed`. Report failed, cancelled and interrupted jobs accurately. Results are browser-reported summaries. Mention convergence warnings: R-hat above 1.01, bulk or tail ESS below 400, or any divergences. Passing diagnostics does not establish causality. The demo contains synthetic data; do not present it as a real campaign analysis. Forecasting, budget optimization and private CSV import are not exposed by these tools.

## Saved fits and on-demand plots

Completed fits are saved automatically, up to six per session. `list_fits` returns their IDs, exact settings and convergence summaries. A configuration change clears the current job but keeps these fits. The server retains summaries only; full draws stay in the current app frame and are lost when it closes. Sessions expire after inactivity and are lost on server restart. Do not describe these fits as permanent storage.

Use `show_plot` with `session_id`, `kind` and optionally `fit_id` (defaults to latest). Supported kinds:
- `contributions`: channel medians and central 90% credible intervals.
- `posterior`: a histogram; choose a channel and `parameter` of `alpha` (weekly carryover), `lam` (saturation in scaled spend units), or `beta` (scaled coefficient, not ROAS).
- `residuals`: observed minus predictive median with posterior predictive uncertainty. RMSE is in sample, not a validation score.
- `comparison`: specify `fit_id` and a distinct `compare_fit_id`; overlays independent channel contribution intervals. This is not a paired posterior difference distribution or a formal model selection test.

Keep the app open. Requesting a plot does not sample again. Poll `inspect_workspace` until `plot.status` is `ready` or `unavailable`, then read its aggregate `stats` or explain its error. Do not claim a requested plot rendered before acknowledgement. Use saved fit settings and diagnostics when interpreting a comparison. For a missing draw-based plot, summary plots remain usable, or ask to run a new fit. Do not launch new fits without the user requesting sampling or a model comparison that requires it.
