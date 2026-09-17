#!/usr/bin/env python3
"""Launch the second-objective (overflow) generalization spot-check matrix.

designs × arms × seeds over the closed-loop driver; see
ecos_agent.optimization.experiments.generalization_matrix for the contract.
"""

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.generalization_matrix import main


if __name__ == "__main__":
    raise SystemExit(main(CodexAppServerProposalProvider))
