#!/usr/bin/env python3

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.closed_loop_driver import main
from ecos_agent.optimization.experiments.runner_environment import (
    apply_glm_runtime_environment,
)


if __name__ == "__main__":
    _summary = apply_glm_runtime_environment()
    print("[runner-env]", _summary, flush=True)
    raise SystemExit(main(CodexAppServerProposalProvider))
