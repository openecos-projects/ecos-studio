#!/usr/bin/env python3
"""Run the frozen-context offline knowledge pilot with the real Codex provider."""

import argparse
import functools
import json
import os
import threading
from pathlib import Path

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.experiments.knowledge_pilot import run_offline_pilot
from ecos_agent.optimization.experiments.knowledge_protocol import (
    build_protocol_manifest,
    validate_protocol_manifest,
)
from ecos_agent.optimization.knowledge.compiler import load_state_rule_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", default="gcd")
    parser.add_argument("--bank", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--planning-call-limit", type=int, default=60)
    parser.add_argument("--watchdog-minutes", type=float, default=30.0)
    parser.add_argument(
        "--ecc-bin",
        type=Path,
        default=(
            Path(__file__).resolve().parents[3] / "ecc/.venv/bin/ecc-agent-rpc"
        ),
    )
    args = parser.parse_args()

    bank = json.loads(args.bank.read_text(encoding="utf-8"))
    contexts = bank["contexts"]
    design_id = args.design
    objective_contract_sha256 = contexts[0]["objective_contract_sha256"]
    knowledge_bundle_sha256 = contexts[0]["knowledge_bundle_sha256"]
    ecc_bin = args.ecc_bin.resolve()
    manifest = build_protocol_manifest(
        design_ids=[design_id],
        treatments=[
            "llm-no-knowledge",
            "current-metric-id-raw-rag",
            "state-conditioned-dual-layer-zero-shot",
        ],
        knowledge_bundle_sha256=knowledge_bundle_sha256,
        state_rule_manifest_sha256=load_state_rule_manifest().manifest_sha256,
        objective_contract_sha256=objective_contract_sha256,
        toolchain={"ecc_executable_sha256": file_sha256(ecc_bin)},
        model={"name": args.model, "planner_seed": 0},
        budget={
            "candidate_limit": 0,
            "planning_call_limit": args.planning_call_limit,
            "repeats": args.repeats,
        },
        noise_rule={
            "schema_version": "ecos.offline_pilot_noise.v1",
            "note": (
                "offline pilot executes no candidate; terminal deltas and "
                "epsilon comparisons are out of scope for this run"
            ),
        },
    )
    validate_protocol_manifest(manifest)
    protocol_path = args.output.with_suffix(".protocol.json")
    protocol_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    diagnostics_path = args.output.with_suffix(".codex-diagnostics.jsonl")
    # The transcript plus the app-server stderr file are the only evidence
    # of a wedged turn: the idle timeout refreshes on every notification,
    # so a hung upstream otherwise blocks the pilot with no trace.
    os.environ["ECOS_AGENT_CODEX_DIAGNOSTICS_PATH"] = str(diagnostics_path)
    provider_factory = functools.partial(
        CodexAppServerProposalProvider,
        diagnostics_path=diagnostics_path,
        env=os.environ,
    )
    watchdog = threading.Timer(
        args.watchdog_minutes * 60,
        lambda: (
            print(
                f"[offline] watchdog fired after {args.watchdog_minutes} min;"
                " see diagnostics + stderr log",
                flush=True,
            )
            or os._exit(124)
        ),
    )
    watchdog.daemon = True
    watchdog.start()
    payload = run_offline_pilot(
        design_id=design_id,
        contexts=contexts,
        provider_factory=provider_factory,
        model=args.model,
        repeats=args.repeats,
        planning_call_limit=args.planning_call_limit,
        protocol=manifest,
    )
    args.output.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    summary = payload["summary"]["treatments"]
    for treatment, row in summary.items():
        print(
            f"[offline] {treatment}: proposals={row['proposals']}"
            f" claim_bound={row['claim_bound_proposals']}"
            f" unique_actions={row['exact_action_divergence']['unique_actions']}"
            f" decisions={row['decision_counts']}"
        )
    print(f"[offline] gate: {json.dumps(payload['gate'])}")
    print(f"[offline] output: {args.output}")
    print(f"[offline] protocol: {protocol_path} hash={manifest['protocol_hash']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
