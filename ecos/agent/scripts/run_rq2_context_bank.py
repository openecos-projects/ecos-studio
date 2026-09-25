#!/usr/bin/env python3
"""Capture the formal RQ2 frozen-context bank for one design.

Reads real RQ1 G4 candidate checkpoints (read-only sources), captures one
native planning turn per checkpoint via the existing bank machinery, and
freezes the strata contexts under the RQ2 v2 contract.  Capture never starts
a provider turn, an ECC candidate, or a terminal run: the capture provider
always answers ``continue`` and the flow artifacts are read as-is.

Checkpoint selection rule (registered): candidate checkpoints of the design's
``rq1-ra-<design>-r1`` episode, taken at evenly spaced intervention indices
over the episode (1, 7, 13, 19 for a 20-candidate episode), copied by
hardlink so the RQ1 evidence tree stays byte-identical.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.experiments.knowledge_pilot import build_context_bank
from ecos_agent.optimization.experiments.knowledge_protocol import (
    RQ2_DESIGNS,
    validate_rq2_design_ids,
)
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    RQ2_BANK_SCHEMA,
    STRATUM_ALIASES,
    canonical_stratum,
    upgrade_bank_contexts,
    validate_rq2_context_bank,
)
from ecos_agent.optimization.knowledge.compiler import load_state_rule_manifest

RQ1_ROOT = Path("/nfs/share/home/yhqiu/fse/projects/llm-rq1-20260924")
DETRUN_ROOT = Path("/nfs/share/home/yhqiu/fse/projects/deterministic-batch-20260919")


def _checkpoint_candidates(design: str, count: int) -> list[tuple[str, Path]]:
    episode = f"rq1-ra-{design}-r1"
    candidates_root = RQ1_ROOT / "cells" / episode / "workspaces" / design / ".agent" / "candidates"
    if not candidates_root.is_dir():
        raise SystemExit(f"source candidates missing: {candidates_root}")
    entries = sorted(
        (path.name for path in candidates_root.iterdir() if path.is_dir()),
        key=lambda name: int(name.rsplit("-", 1)[1]),
    )
    if len(entries) < count:
        raise SystemExit(
            f"source episode has {len(entries)} candidates, need {count}"
        )
    step = len(entries) / count
    picked = [entries[min(int(index * step), len(entries) - 1)] for index in range(count)]
    return [(episode, candidates_root / name) for name in picked]


def capture_design(
    design: str,
    *,
    checkpoints: int,
    strata: list[str],
    capture_root: Path,
    episode_prefix: str,
) -> dict[str, object]:
    validate_rq2_design_ids([design])
    manifest = load_state_rule_manifest()
    ecc_bin = Path(__file__).resolve().parents[3] / "ecc/.venv/bin/ecc-agent-rpc"
    toolchain_sha256 = canonical_sha256(
        {
            "ecc_agent_rpc_sha256": file_sha256(ecc_bin),
            "capture_entry": "scripts/run_rq2_context_bank.py",
            "bank_builder": "knowledge_pilot.build_context_bank",
        }
    )
    prompt_skeleton_sha256 = canonical_sha256(
        {
            "proposal_schema": "ecos.optimization_proposal.v3",
            "capture_provider_decision": "continue",
            "context_projection": "knowledge_pilot.freeze_planning_context",
        }
    )
    sources = _checkpoint_candidates(design, checkpoints)
    contexts: list[dict[str, object]] = []
    excluded: list[dict[str, object]] = []
    checkpoint_records = []
    epsilon_src = (
        DETRUN_ROOT
        / "determinism-evidence"
        / "ten-designs"
        / "agent-ledgers"
        / f"{design}.noise-epsilon.v1.json"
    )
    if not epsilon_src.is_file():
        raise SystemExit(f"frozen epsilon donor missing: {epsilon_src}")
    for index, (episode, candidate_root) in enumerate(sources, start=1):
        checkpoint = f"cp{index}"
        workspace = capture_root / design / checkpoint
        if workspace.exists():
            shutil.rmtree(workspace)
        shutil.copytree(candidate_root, workspace, copy_function=os_link)
        optimization_dir = workspace / ".agent" / "optimization"
        optimization_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(epsilon_src, optimization_dir / "noise-epsilon.v1.json")
        episode_id = f"{episode_prefix}-{design}-{checkpoint}"
        captured = build_context_bank(
            workspace=workspace,
            design_id=design,
            episode_id=episode_id,
        )
        ledger = (
            RQ1_ROOT
            / "cells"
            / episode
            / "workspaces"
            / design
            / ".agent"
            / "optimization"
            / episode
            / "optimization-outcomes.v1.jsonl"
        )
        upgraded, missing = upgrade_bank_contexts(
            captured,
            design=design,
            checkpoint=checkpoint,
            source_artifacts=[
                f"episode:{episode}",
                f"candidate_root:{candidate_root}",
                f"outcome_ledger_sha256:{file_sha256(ledger)}",
                f"noise_epsilon_donor_sha256:{file_sha256(epsilon_src)}",
            ],
            toolchain_sha256=toolchain_sha256,
            prompt_skeleton_sha256=prompt_skeleton_sha256,
            state_rule_manifest_sha256=manifest.manifest_sha256,
        )
        wanted = {canonical_stratum(alias) for alias in strata}
        upgraded = [
            context
            for context in upgraded
            if context["state_stratum"] in wanted
        ]
        excluded.extend(
            record
            for record in missing
            if record["state_stratum"] in wanted
        )
        contexts.extend(upgraded)
        excluded.extend(missing)
        checkpoint_records.append(
            {
                "checkpoint": checkpoint,
                "source_episode": episode,
                "source_candidate": candidate_root.name,
                "capture_episode_id": episode_id,
                "capture_workspace": str(workspace),
                "strata_captured": sorted(
                    {str(context["state_stratum"]) for context in upgraded}
                ),
            }
        )
    bank = {
        "schema_version": RQ2_BANK_SCHEMA,
        "design": design,
        "checkpoints_target": checkpoints,
        "strata_target": strata,
        "stratum_aliases": STRATUM_ALIASES,
        "state_rule_manifest_sha256": manifest.manifest_sha256,
        "toolchain_sha256": toolchain_sha256,
        "prompt_skeleton_sha256": prompt_skeleton_sha256,
        "checkpoints": checkpoint_records,
        "contexts": contexts,
        "excluded": excluded,
        "coverage": {
            "checkpoints": len(checkpoint_records),
            "contexts": len(contexts),
            "excluded_strata": len(excluded),
        },
    }
    validate_rq2_context_bank(bank)
    return bank


def os_link(source: str, destination: str) -> None:
    import os

    os.link(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", required=True, choices=RQ2_DESIGNS)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--checkpoints", type=int, default=4)
    parser.add_argument(
        "--strata",
        default="knowledge_opportunity,stale_binding,anti_condition,missing_observation,no_supported_action",
    )
    parser.add_argument(
        "--capture-root",
        type=Path,
        default=Path("/nfs/share/home/yhqiu/fse/projects/llm-rq2-20260924/bank/capture-workspaces"),
    )
    parser.add_argument("--episode-prefix", default="rq2-bank")
    args = parser.parse_args()
    strata = [item.strip() for item in args.strata.split(",") if item.strip()]
    bank = capture_design(
        args.design,
        checkpoints=args.checkpoints,
        strata=strata,
        capture_root=args.capture_root,
        episode_prefix=args.episode_prefix,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(bank, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "design": args.design,
                "contexts": bank["coverage"]["contexts"],
                "excluded": bank["coverage"]["excluded_strata"],
                "output": str(args.output),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
