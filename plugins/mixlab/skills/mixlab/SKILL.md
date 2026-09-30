---
name: mixlab
description: Open and operate the Mixlab MCP workbench to explore synthetic marketing mix data, adjust priors, run TyMC sampling and inspect convergence diagnostics. Use for explicit Mixlab requests or an active Mixlab session.
---

# Mixlab workbench

Use the plugin's Mixlab MCP tools. Call `open_demo` with `{}` to create a workspace and show the interactive app inside the host. Retain its `session_id` for subsequent calls. Each call opens a new session, so reuse the current session when continuing work.

Wait for `inspect_workspace` to report `browser_connected: true` before `start_fit`. The app must stay open for sampling. The MCP server is hosted at `https://pymc-mixlab-mcp.fly.dev/mcp`; no local server is needed. If it is unavailable, report the connection failure and retry once; do not claim a fit ran.

Use `inspect_data` for synthetic data aggregates and `configure_model` for supported prior and sampling changes. Changes clear previous results. `start_fit` queues a real tymc-marketing fit and returns immediately. Poll `get_fit_status` until a terminal status, avoiding rapid repeated calls. Use `cancel_fit` only when cancellation is requested and verify acknowledgement.

Report completion only for `completed`. Report failed, cancelled and interrupted jobs accurately. Results are browser-reported summaries. Mention convergence warnings: R-hat above 1.01, bulk or tail ESS below 400, or any divergences. Passing diagnostics does not establish causality. The demo contains synthetic data; do not present it as a real campaign analysis. Forecasting, budget optimization and private CSV import are not exposed by these tools.
