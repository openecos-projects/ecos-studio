#!/usr/bin/env python3

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.closed_loop_driver import main


if __name__ == "__main__":
    raise SystemExit(main(CodexAppServerProposalProvider))
