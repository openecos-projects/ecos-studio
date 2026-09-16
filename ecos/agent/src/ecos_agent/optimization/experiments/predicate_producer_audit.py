"""Audit corpus predicate coverage against the runtime state-evidence producers.

Read-only and pure-computation: extracts every state/anti predicate feature
from the frozen knowledge catalogs, classifies each as produced (by stage
metrics, state evidence, knob values, configured features, or absence
markers), conditionally produced (delta/trend), or missing (corpus debt), and
emits a versioned report for the measurement-chain version boundary.  No ECC
or LLM is involved.

``scripts/audit_predicate_producers.py`` is the thin CLI entry point.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Mapping, Sequence
from pathlib import Path

from ecos_agent.optimization.contracts import BudgetSnapshot, EpisodeBudget
from ecos_agent.optimization.knob_policy import KNOB_ROLES
from ecos_agent.optimization.knowledge.compiler import ABSENCE_MARKER_SOURCES
from ecos_agent.optimization.observations import (
    build_stage_observation,
    build_terminal_observation,
)

# Configured/derived feature ids built inside build_state_evidence_request.
_CONFIGURED_FEATURES = {
    "current_place_knob_values": "configured",
    "floorplan_aspect_ratio_offset": "configured",
    "routability_relief_configured": "configured",
    **{feature_id: "absence_marker" for feature_id in ABSENCE_MARKER_SOURCES},
}

_REPORT_SCHEMA = "ecos.predicate_producer_audit.v1"


def corpus_predicates(
    knowledge_root: Path,
) -> list[dict[str, object]]:
    """Extract every state/anti predicate feature from the frozen catalogs."""
    rows: dict[str, dict[str, object]] = {}
    for path in sorted(knowledge_root.glob("general/*/catalog.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for entity in payload["entities"]:
            support = entity.get("support") or {}
            claim = support.get("claim")
            if not claim:
                continue
            for role in ("state_predicates", "anti_predicates"):
                for predicate in claim.get(role) or []:
                    feature_id = str(predicate["feature_id"])
                    row = rows.setdefault(
                        feature_id,
                        {
                            "feature_id": feature_id,
                            "ops": set(),
                            "uses": [],
                            "required_any": False,
                        },
                    )
                    row["ops"].add(str(predicate["op"]))
                    row["required_any"] = row["required_any"] or bool(
                        predicate.get("required")
                    )
                    row["uses"].append(
                        {
                            "claim_id": str(entity["id"]),
                            "role": role[:5],
                            "required": bool(predicate.get("required")),
                            "stages": list(claim.get("stages") or []),
                        }
                    )
    return [
        {
            "feature_id": row["feature_id"],
            "ops": sorted(row["ops"]),  # type: ignore[arg-type]
            "required_any": row["required_any"],
            "uses": row["uses"],
        }
        for row in sorted(rows.values(), key=lambda item: str(item["feature_id"]))
    ]


def produced_feature_ids(
    workspace: Path,
    *,
    current_values: Mapping[str, bool | int | float] | None = None,
) -> dict[str, str]:
    """One checkpoint's produced feature set mapped to its producer mechanism."""
    observation = build_stage_observation(
        workspace,
        "place",
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(60.0)),
    )
    mechanisms: dict[str, str] = {}
    for metric_id in observation.metrics:
        mechanisms[metric_id] = "stage_metric"
    for feature in observation.state_evidence:
        mechanisms[feature.feature_id] = "state_evidence"
    for knob in KNOB_ROLES:
        mechanisms[str(knob.value)] = "knob_value"
    for knob_id, value in (current_values or {}).items():
        mechanisms[str(knob_id)] = "knob_value"
    for feature_id, mechanism in _CONFIGURED_FEATURES.items():
        mechanisms[feature_id] = mechanism
    # build_state_evidence_request exposes the incumbent's completed terminal
    # flow as the current known terminal state; enumerate this workspace's
    # terminal metric ids as incumbent_terminal producers.
    terminal = build_terminal_observation(workspace)
    for metric in terminal.metrics:
        mechanisms.setdefault(metric.value, "incumbent_terminal")
    for metric in terminal.timing_guardrail:
        mechanisms.setdefault(metric.value, "incumbent_terminal")
    for metric in terminal.evaluation_metrics:
        mechanisms.setdefault(metric.metric_id, "incumbent_terminal")
    return mechanisms


def audit_predicate_producers(
    workspace: Path,
    knowledge_root: Path,
    *,
    current_values: Mapping[str, bool | int | float] | None = None,
) -> dict[str, object]:
    predicates = corpus_predicates(knowledge_root)
    mechanisms = produced_feature_ids(workspace, current_values=current_values)
    rows: list[dict[str, object]] = []
    counts = {"produced": 0, "conditional": 0, "missing": 0}
    for predicate in predicates:
        feature_id = str(predicate["feature_id"])
        mechanism = mechanisms.get(feature_id)
        if mechanism is not None:
            classification = "produced"
        elif feature_id.startswith(("delta.", "trend.")):
            classification = "conditional"
            mechanism = "delta_or_trend"
        else:
            classification = "missing"
            mechanism = "corpus_debt"
        counts[classification] += 1
        rows.append({**predicate, "classification": classification, "mechanism": mechanism})
    return {
        "schema_version": _REPORT_SCHEMA,
        "workspace": str(workspace.resolve()),
        "counts": {
            "unique_features": len(rows),
            **counts,
        },
        "features": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument(
        "--knowledge-root", type=Path,
        default=Path(__file__).resolve().parents[4] / "knowledge",
    )
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    report = audit_predicate_producers(
        args.workspace.resolve(), args.knowledge_root.resolve()
    )
    output = args.output or args.workspace.resolve() / "predicate-producer-audit.v1.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    csv_path = output.with_suffix(".csv")
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["feature_id", "classification", "ops", "required_any"],
            extrasaction="ignore",
        )
        writer.writeheader()
        for row in report["features"]:  # type: ignore[index]
            writer.writerow({**row, "ops": ",".join(row["ops"])})  # type: ignore[index]
    print(json.dumps(report["counts"], sort_keys=True), f"-> {output.name}, {csv_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
