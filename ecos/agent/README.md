# ECOS Agent

`ecos_agent` is the in-tree, GUI-only provider for ECOS Studio. It accepts
only the numeric GUI workflows `1` (run flow) and `2` (rerun step).

## Prerequisites

- Python 3.11+, `uv`, and an authenticated Codex CLI on `PATH`.
- Set `ECOS_AGENT_WORKSPACE_ROOT` to the directory containing completed ECOS
  workspaces before using workflow `2`.
- This source-checkout example does not support Electron packaging.

The provider always sends typed, review-required contracts. Codex is limited
to read-only proposal generation; ECOS Studio validates contracts, creates or
switches workspaces, and invokes fixed ECC RPC methods. Missing Codex, timeout,
or invalid structured output fails closed without invoking ECC.

## Verify

```bash
uv run pytest -q
```

No PDK, RTL, benchmark, optimization result, or real EDA execution is included
in this component.
