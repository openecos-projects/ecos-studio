#!/usr/bin/env python3

import sys

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.knowledge_treatment_runner import main
from ecos_agent.optimization.experiments.runner_environment import (
    apply_runner_environment,
    runner_model_from_argv,
)


if __name__ == "__main__":
    _model = runner_model_from_argv(sys.argv)
    print("[runner-env]", apply_runner_environment(model=_model), flush=True)
    raise SystemExit(main(CodexAppServerProposalProvider))
