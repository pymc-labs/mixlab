# Mixlab plugin

Install the hosted Mixlab MCP App in Codex:

```sh
codex plugin marketplace add pymc-labs/mixlab
codex plugin add mixlab@mixlab-local
```

Restart Codex, then open Mixlab from the app/sidebar entry or ask:
**Open the Mixlab workbench.**

The marketplace identifier is `mixlab-local` for compatibility with earlier
local installations. The plugin uses the hosted HTTPS endpoint at
`https://pymc-mixlab-mcp.fly.dev/mcp`; no local server, project dependencies,
Fly.io account or API key is needed to use the demo.

If an earlier local marketplace with this name is already configured, remove
its marketplace registration before adding the GitHub source:

```sh
codex plugin marketplace remove mixlab-local
codex plugin marketplace add pymc-labs/mixlab
codex plugin add mixlab@mixlab-local
```

To refresh the source for later releases:

```sh
codex plugin marketplace upgrade mixlab-local
codex plugin add mixlab@mixlab-local
```

The workbench opens synthetic marketing mix data. Change supported priors and
sampling settings, run a TyMC fit and inspect uncertainty and convergence
warnings. Keep the app frame open while sampling. Version 0.1.2 automatically keeps up to six completed fits per session and adds `list_fits` and `show_plot`. Ask for channel contribution plots, carryover/saturation/coefficient posterior histograms, residuals, or two-fit contribution comparisons without resampling. Draw-based plots need the original frame to stay open; saved fits are session history, not permanent storage. It currently does not expose
private CSV import or budget optimization. Passing convergence diagnostics does
not establish causality. In-memory sessions expire after inactivity and are
cleared on server restart.

The plugin bundles its MCP connection, a workflow skill, and app artwork. The
MCP server advertises global and conversation-panel entrypoints for hosts that
support MCP Extensions.
