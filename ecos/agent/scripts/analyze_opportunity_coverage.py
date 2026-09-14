#!/usr/bin/env python3
"""Offline knowledge-opportunity coverage over default replay workspaces.

Read-only over the baseline run artifacts: for every design replay the script
replays the knowledge pilot's frozen-context capture on a scratch copy of the
replay workspace, compiles the full stage-compatible support catalog against
the captured default terminal state, and judges the frozen run-plan criterion
(>=2 of 3 replays with >=1 pass/weak claim-action whose knob is inside the
default-parameter legal domain).  No flow is executed and no runtime code is
modified; scratch copies are deleted after capture.

Requires the ECC runtime environment (CHIPCOMPILER_ECC_SIZER_ROOT,
ECOS_AGENT_ECC_RPC_BIN) because the capture opens the workspace once.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import time
from pathlib import Path

from ecos_agent.knowledge.step import load_default_general_knowledge_bundles
from ecos_agent.optimization.experiments.knowledge_pilot import build_context_bank
from ecos_agent.optimization.knowledge.compiler import (
    knowledge_support_catalog_from_bundles,
    load_state_rule_manifest,
)
from ecos_agent.optimization.knowledge.compiler_runtime import _evaluate

_NUMERIC_NEAR_MISS = {"positive", "zero", "negative"}


def _near_miss(view: dict, catalog_claims: dict, matches: dict) -> list[dict]:
    """Raw feature values and threshold distances for a claim's blocked predicates."""
    features = {
        item["feature_id"]: item["value"] for item in view["state"]["features"]
    }
    claim = catalog_claims.get(
        (matches["claim_ref"]["entity_id"], matches["claim_ref"]["chunk_sha256"])
    )
    if claim is None:
        return []
    rows = []
    predicates = [
        (predicate, "state_condition")
        for predicate in claim.state_predicates
    ] + [(predicate, "anti_condition") for predicate in claim.anti_predicates]
    for predicate, kind in predicates:
        value = features.get(predicate.feature_id)
        evaluated = _evaluate(predicate, features)
        distance = None
        if predicate.op in _NUMERIC_NEAR_MISS and isinstance(value, (int, float)):
            distance = abs(value)
        rows.append(
            {
                "kind": kind,
                "feature_id": predicate.feature_id,
                "op": predicate.op,
                "required": predicate.required,
                "feature_value": value,
                "distance_to_threshold": distance,
                "evaluates_false": evaluated is False,
            }
        )
    return rows


def analyze_replay(
    design_id: str,
    replay: int,
    replay_workspace: Path,
    epsilon_path: Path,
    scratch_root: Path,
    catalog,
    catalog_claims: dict,
) -> dict:
    episode_id = f"opportunity-{design_id}-r{replay}"
    scratch = scratch_root / f"{design_id}-r{replay}"
    if scratch.exists():
        shutil.rmtree(scratch)
    shutil.copytree(
        replay_workspace, scratch, ignore=shutil.ignore_patterns(".agent")
    )
    optimization_root = scratch / ".agent" / "optimization"
    optimization_root.mkdir(parents=True, exist_ok=True)
    shutil.copy2(epsilon_path, optimization_root / "noise-epsilon.v1.json")
    started = time.monotonic()
    try:
        contexts = build_context_bank(
            workspace=scratch, design_id=design_id, episode_id=episode_id
        )
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    opportunity = contexts[0]
    if opportunity["stratum"] != "knowledge_opportunity":
        raise ValueError("context bank did not return the opportunity stratum first")
    planning = opportunity["planning_context"]
    view = planning["supported_action_view"]
    actions = view["actions"]
    pass_weak = [
        action for action in actions if action["applicability"] in {"pass", "weak"}
    ]
    match_by_claim = {
        (match["claim_ref"]["entity_id"], match["claim_ref"]["chunk_sha256"]): match
        for match in view["matches"]
    }
    action_counts: dict[tuple[str, str], int] = {}
    for action in actions:
        key = (action["claim_ref"]["entity_id"], action["claim_ref"]["chunk_sha256"])
        action_counts[key] = action_counts.get(key, 0) + 1
    claim_rows = []
    for reference in view["candidate_refs"]:
        key = (reference["entity_id"], reference["chunk_sha256"])
        match = match_by_claim.get(key)
        claim = catalog_claims[key]
        trend_rules = sorted(
            predicate.rule_ref
            for predicate in (*claim.state_predicates, *claim.anti_predicates)
            if predicate.rule_ref.startswith("rules.trend.")
        )
        claim_rows.append(
            {
                "design_id": design_id,
                "replay": replay,
                "entity_id": reference["entity_id"],
                "chunk_sha256": reference["chunk_sha256"],
                "applicability": match["applicability"] if match else "not_candidate",
                "reason_codes": ",".join(match["reason_codes"]) if match else "",
                "trend_rule_refs": ",".join(trend_rules),
                "compiled_actions": action_counts.get(key, 0),
                "near_miss": (
                    _near_miss(view, catalog_claims, match)
                    if match and match["applicability"] == "blocked"
                    else []
                ),
            }
        )
    return {
        "design_id": design_id,
        "replay": replay,
        "context_fingerprint": opportunity["context_fingerprint"],
        "expected_behavior": opportunity["expected_behavior"],
        "label_evidence": opportunity["label_evidence"],
        "candidate_claims": len(claim_rows),
        "compiled_actions": len(actions),
        "pass_weak_actions": len(pass_weak),
        "pass_weak_knobs": sorted(
            {f"{action['knob_id']}:{action['direction']}" for action in pass_weak}
        ),
        "covered_replay": bool(pass_weak),
        "elapsed_seconds": time.monotonic() - started,
        "claims": claim_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs", nargs="+", required=True)
    parser.add_argument("--replays", type=int, default=3)
    parser.add_argument(
        "--scratch-root", type=Path, default=None,
        help="transient capture copies (default: <run-root>/opportunity-analysis/scratch)",
    )
    args = parser.parse_args()
    run_root = args.run_root.resolve()
    scratch_root = (
        args.scratch_root or run_root / "opportunity-analysis" / "scratch"
    ).resolve()
    scratch_root.mkdir(parents=True, exist_ok=True)

    manifest = load_state_rule_manifest()
    catalog = knowledge_support_catalog_from_bundles(
        load_default_general_knowledge_bundles()
    )
    catalog_claims = {
        (claim.claim_ref.entity_id, claim.claim_ref.chunk_sha256): claim
        for claim in catalog.claims
    }
    replays = []
    for design_id in args.designs:
        workspace = run_root / "workspaces" / design_id
        epsilon_path = (
            workspace / ".agent" / "optimization" / "noise-epsilon.v1.json"
        )
        if not epsilon_path.is_file():
            raise SystemExit(f"missing noise epsilon for {design_id}: {epsilon_path}")
        for replay in range(1, args.replays + 1):
            replay_workspace = (
                workspace
                / ".agent" / "optimization" / "noise-calibration"
                / f"default-replay-{replay}" / "workspace"
            )
            if not replay_workspace.is_dir():
                raise SystemExit(
                    f"missing replay workspace: {replay_workspace}"
                )
            row = analyze_replay(
                design_id, replay, replay_workspace, epsilon_path,
                scratch_root, catalog, catalog_claims,
            )
            replays.append(row)
            print(
                f"[opportunity] {design_id} r{replay}: "
                f"pass/weak actions={row['pass_weak_actions']} "
                f"covered={row['covered_replay']} "
                f"({row['elapsed_seconds']:.0f}s)",
                flush=True,
            )

    covered = sorted(
        {
            row["design_id"]
            for row in replays
            if row["covered_replay"]
            and sum(
                1
                for other in replays
                if other["design_id"] == row["design_id"] and other["covered_replay"]
            )
            >= 2
        }
    )
    payload = {
        "schema_version": "ecos.opportunity_coverage.v1",
        "state_rule_manifest_sha256": manifest.manifest_sha256,
        "support_catalog_sha256": catalog.catalog_sha256,
        "criterion": ">=2 of 3 replays with >=1 pass/weak claim-action",
        "covered_designs": covered,
        "covered_count": len(covered),
        "replays": replays,
    }
    out_json = run_root / "opportunity-coverage.v1.json"
    out_json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    flat_rows = []
    for row in replays:
        for claim in row["claims"]:
            for near in claim.get("near_miss") or [{}]:
                flat_rows.append(
                    {
                        **claim,
                        "near_miss_kind": near.get("kind", ""),
                        "near_miss_feature": near.get("feature_id", ""),
                        "near_miss_op": near.get("op", ""),
                        "near_miss_value": near.get("feature_value", ""),
                        "near_miss_distance": near.get("distance_to_threshold", ""),
                    }
                )
    out_csv = run_root / "opportunity-coverage.csv"
    with out_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(flat_rows[0].keys()))
        writer.writeheader()
        writer.writerows(flat_rows)

    design_ids = list(args.designs)
    claim_ids = sorted(
        {
            (claim["entity_id"], claim["chunk_sha256"][:12])
            for row in replays
            for claim in row["claims"]
        }
    )
    lines = [
        "# Opportunity coverage: default terminal observations x frozen corpus",
        "",
        f"- criterion: {payload['criterion']}",
        f"- state-rule manifest: `{payload['state_rule_manifest_sha256']}`",
        f"- support catalog: `{payload['support_catalog_sha256']}`",
        f"- covered: **{len(covered)}/{len(design_ids)}** {covered}",
        "",
        "## Per-design verdict (frozen criterion)",
        "",
        "| design | r1 pass/weak | r2 | r3 | covered |",
        "|---|---|---|---|---|",
    ]
    for design_id in design_ids:
        counts = [
            row["pass_weak_actions"]
            for row in replays
            if row["design_id"] == design_id
        ]
        hits = sum(1 for count in counts if count >= 1)
        lines.append(
            f"| {design_id} | " + " | ".join(map(str, counts))
            + f" | {'yes' if hits >= 2 else 'NO'} |"
        )
    lines += [
        "",
        "## Claim x design applicability (majority over replays)",
        "",
        "applicability per design is the modal verdict across its replays;",
        "`acts` = compiled pass/weak claim-actions.",
        "",
    ]
    header = "| claim | " + " | ".join(design_ids) + " |"
    lines += [header, "|---" * (len(design_ids) + 1) + "|"]

    def _modal(values: list[str]) -> str:
        return max(set(values), key=values.count)

    for entity_id, chunk in claim_ids:
        cells = []
        for design_id in design_ids:
            claims = [
                claim
                for row in replays
                if row["design_id"] == design_id
                for claim in row["claims"]
                if claim["entity_id"] == entity_id
                and claim["chunk_sha256"].startswith(chunk)
            ]
            if not claims:
                cells.append("-")
                continue
            actions = sum(claim["compiled_actions"] for claim in claims)
            cells.append(f"{_modal([c['applicability'] for c in claims])} ({actions})")
        lines.append(f"| {entity_id} | " + " | ".join(cells) + " |")

    trend_claims = sorted(
        {
            claim["entity_id"]
            for row in replays
            for claim in row["claims"]
            if claim["trend_rule_refs"]
        }
    )
    lines += [
        "",
        "## Trend-typed claims (entry coverage unmeasurable by design)",
        "",
        (
            "- none of the stage-compatible claims carries a `rules.trend.*` "
            "predicate on the default replay entry state"
            if not trend_claims
            else "\n".join(f"- {name}" for name in trend_claims)
        ),
        "",
        "## Near-miss detail (blocked predicates, raw feature value vs threshold)",
        "",
    ]
    near_rows = [
        (claim, near)
        for row in replays
        for claim in row["claims"]
        for near in claim["near_miss"]
        if near["evaluates_false"]
    ]
    if near_rows:
        lines += [
            "| design | claim | kind | feature | op | value | distance |",
            "|---|---|---|---|---|---|---|",
        ]
        for claim, near in near_rows:
            lines.append(
                f"| {claim['design_id']} r{claim['replay']} "
                f"| {claim['entity_id']} | {near['kind']} "
                f"| {near['feature_id']} | {near['op']} "
                f"| {near['feature_value']} | {near['distance_to_threshold']} |"
            )
    else:
        lines.append("- no level-predicate near-misses on any design")
    lines.append("")
    out_md = run_root / "opportunity-coverage.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(
        f"[opportunity] covered {len(covered)}/{len(args.designs)}: "
        f"{covered}; rows -> {out_json.name}, {out_csv.name}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
