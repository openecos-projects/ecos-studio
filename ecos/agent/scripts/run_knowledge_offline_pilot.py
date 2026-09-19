#!/usr/bin/env python3
from pathlib import Path

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.knowledge_offline_cli import main


if __name__ == "__main__":
    raise SystemExit(
        main(
            Path(__file__).resolve().parents[3] / "ecc/.venv/bin/ecc",
            CodexAppServerProposalProvider,
        )
    )
