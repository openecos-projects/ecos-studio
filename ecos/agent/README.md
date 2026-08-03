# ECOS Agent

`ecos_agent` is the in-tree, GUI-only provider for ECOS Studio. It accepts
only the numeric GUI workflows `1` (run flow) and `2` (rerun step).

## Prerequisites

- In a source checkout: Python 3.11+ and `uv`.
- An authenticated Codex CLI installed by the user. The provider discovers
  `codex` on the application `PATH`, or uses an explicit user environment
  variable `ECOS_AGENT_CODEX_BIN`.

The packaged desktop application includes the ECOS Agent Python runtime. It
does not include Codex, credentials, or an authenticated session. The
provider validates the Codex CLI when the GUI starts an Agent session and
fails closed when it is unavailable.

## Install and Start

```bash
cd ecos/agent
uv sync --locked
```

During desktop development, ECOS Studio discovers this in-tree provider
automatically. Its manifest uses `uv run --locked`, so the source runtime is
reproducible from `uv.lock`. To exercise the newline-JSON provider protocol
directly, run:

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

`ECOS_AGENT_PROVIDER_ROOTS` may register additional local provider roots for
development. Each root is trusted executable code; do not configure paths from
untrusted sources. Invalid or inaccessible optional manifests are ignored so
they cannot disable the bundled provider.

## Verify

```bash
uv run pytest -q
```

The tests inject mock Codex proposal functions. They verify frozen setup and
rerun contracts, authorized workspace discovery, and fail-closed Codex timeout
handling without running EDA.

No PDK, RTL, benchmark, optimization result, or real EDA execution is included
in this component.
