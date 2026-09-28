#!/usr/bin/env python3
"""Run one Contract A RQ3 episode with the frozen Terra model path."""

from __future__ import annotations

import sys

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.closed_loop_driver import (
    main as run_closed_loop,
)
from ecos_agent.optimization.experiments.runner_environment import (
    apply_runner_environment,
)

MODEL = "gpt-5.6-terra"
REASONING_EFFORT = "medium"


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if any(
        arg in {"--model", "--reasoning-effort"}
        or arg.startswith("--model=")
        or arg.startswith("--reasoning-effort=")
        for arg in args
    ):
        raise SystemExit("model and reasoning effort are frozen by the Terra RQ3 contract")

    print("[runner-env]", apply_runner_environment(model=MODEL), flush=True)
    sys.argv = [sys.argv[0], *args, "--model", MODEL, "--reasoning-effort", REASONING_EFFORT]
    return run_closed_loop(CodexAppServerProposalProvider)


if __name__ == "__main__":
    raise SystemExit(main())
