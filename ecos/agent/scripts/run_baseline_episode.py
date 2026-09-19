#!/usr/bin/env python3
"""Run one deterministic-baseline closed-loop episode (Agent-necessity arm).

Requires --baseline-method; the episode reuses the standard closed-loop
driver's execution contract, budget, receipts, and ledger.
"""

from ecos_agent.optimization.experiments.closed_loop_driver import main


if __name__ == "__main__":
    raise SystemExit(main(None))
