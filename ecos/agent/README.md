# ECOS Agent

`ecos_agent` is the in-tree, GUI-only provider for ECOS Studio. It accepts
only the numeric GUI workflows `1` (run flow) and `2` (rerun step).

## Prerequisites

- Python 3.11+, `uv`, and an authenticated Codex CLI at the path configured in
  `agent-provider.json`.
- This source-checkout example does not support Electron packaging.

## Install and Start

```bash
cd ecos/agent
uv sync --locked
```

During desktop development, ECOS Studio discovers this in-tree provider
automatically. To exercise the newline-JSON provider protocol directly, run:

```bash
uv run python -m ecos_agent.provider
```

## Workflows

- `1` Run flow: collect and validate the existing workspace, design, RTL,
  constraints, PDK, and physical-design fields. After explicit confirmation,
  ECOS Studio creates the workspace and runs its existing ECC lifecycle.
- `2` Rerun step: enter a design name, then confirm the current GUI workspace
  path or enter another source workspace path. The path is locally verified
  before stage selection. The remaining parameter, scope,
  and frozen-contract flow is unchanged.

The provider always sends typed, review-required contracts. Codex is limited
to read-only proposal generation; ECOS Studio validates contracts, creates or
switches workspaces, and invokes fixed ECC RPC methods. Missing Codex, timeout,
or invalid structured output fails closed without invoking ECC.

## Verify

```bash
uv run pytest -q
```

The tests inject mock Codex proposal functions. They verify frozen setup and
rerun contracts, authorized workspace discovery, and fail-closed Codex timeout
handling without running EDA.

No PDK, RTL, benchmark, optimization result, or real EDA execution is included
in this component.
