#!/usr/bin/env python3

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.knowledge_treatment_runner import main


if __name__ == "__main__":
    main(CodexAppServerProposalProvider)
