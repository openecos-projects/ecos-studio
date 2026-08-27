"""Build the compact, hash-bound acceptance index for the frozen eight knobs."""

from __future__ import annotations

import argparse
import json
from hashlib import sha256
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_controller import CandidateExecutionEvidence
from ecos_agent.optimization_observations import build_candidate_terminal_observation
from ecos_agent.parameter_semantics import load_parameter_cards


CANDIDATES = {
    "floorplan.core_util": "accept-floorplan-core-util-20260827-r2",
    "floorplan.aspect_ratio": "candidate-0d7bf9efcf635d6d-accept-floorplan-aspect-ratio-20260827",
    "synth.max_fanout": "candidate-9542e5eff883b209-accept-synth-max-fanout-20260827-r3",
    "place.target_density": "candidate-0d7bf9efcf635d6d-accept-place-target-density-20260827",
    "place.target_overflow": "candidate-f4a4e662ebd24ccb-accept-place-target-overflow-20260827-r2",
    "place.cell_padding_x": "candidate-9542e5eff883b209-accept-place-cell-padding-x-20260827-r2",
    "place.routability_opt": "candidate-f4a4e662ebd24ccb-accept-place-routability-opt-20260827",
    "place.density_weight": "candidate-f4a4e662ebd24ccb-accept-place-density-weight-20260827",
}


def build_acceptance(workspace: Path, output: Path) -> dict:
    cards = load_parameter_cards()
    card_by_id = {card.knob_id.value: card for card in cards.values()}
    entries = []
    observation_dir = output / "terminal-observations"
    for knob_id, candidate_id in CANDIDATES.items():
        candidate_root = workspace / ".agent" / "candidates" / candidate_id
        candidate_manifest = candidate_root / "analysis" / "candidate_workspace.v1.json"
        materialization = candidate_root / "analysis" / "candidate_materialization.v1.json"
        receipt = candidate_root / "analysis" / "parameter_application_receipt.v1.json"
        payload = json.loads(candidate_manifest.read_text(encoding="utf-8"))
        evidence = CandidateExecutionEvidence(
            payload["candidate_root_ref"],
            payload["candidate_root_ref"] + "/analysis/candidate_workspace.v1.json",
            file_sha256(candidate_manifest),
            payload["target_step"],
            payload["end_step"],
            payload["execution_scope"],
        )
        observation = build_candidate_terminal_observation(workspace, evidence)
        observation_path = observation_dir / f"{knob_id}.json"
        observation_path.parent.mkdir(parents=True, exist_ok=True)
        observation_path.write_text(
            json.dumps(observation.model_dump(mode="json"), sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        receipt_payload = json.loads(receipt.read_text(encoding="utf-8"))
        snapshots = json.loads(materialization.read_text(encoding="utf-8")).get("snapshots", [])
        configs = json.loads(materialization.read_text(encoding="utf-8")).get("configs", [])
        issues = []
        if not configs or not snapshots:
            issues.append("materialization snapshots missing")
        elif configs[0].get("before_sha256") != snapshots[0].get("before_sha256"):
            issues.append("materialization before hash mismatch")
        elif configs[0].get("after_sha256") != snapshots[0].get("after_sha256"):
            issues.append("materialization after hash mismatch")
        elif snapshots[0].get("before_sha256") == snapshots[0].get("after_sha256"):
            issues.append("materialization patch did not change the config")
        if receipt_payload.get("activation", {}).get("status") != "used":
            issues.append("native activation is not used")
        issues.append("replay artifact not persisted")
        requested = receipt_payload.get("requested", {})
        effective = receipt_payload.get("effective_initial", {})
        if requested.get("unit") == "ratio" and knob_id.endswith("density_weight"):
            issues.append("native receipt unit is stale; expected objective_weight")
        if requested.get("value") != effective.get("value") and knob_id != "place.cell_padding_x":
            issues.append("effective initial does not match requested value")
        entries.append(
            {
                "knob_id": knob_id,
                "card_sha256": canonical_sha256(card_by_id[knob_id].model_dump(mode="json")),
                "candidate_id": candidate_id,
                "candidate_root_ref": evidence.candidate_root_ref,
                "candidate_manifest_ref": evidence.candidate_manifest_ref,
                "candidate_manifest_sha256": evidence.candidate_manifest_sha256,
                "materialization_ref": str(materialization.relative_to(workspace)),
                "materialization_sha256": file_sha256(materialization),
                "native_receipt_ref": str(receipt.relative_to(workspace)),
                "native_receipt_sha256": file_sha256(receipt),
                "activation_status": receipt_payload.get("activation", {}).get("status"),
                "issues": issues,
                "terminal_observation_ref": str(observation_path.relative_to(output)),
                "terminal_observation_sha256": canonical_sha256(observation.model_dump(mode="json")),
                "replay": {
                    "operation": "candidate.rerun",
                    "target_step": payload["target_step"],
                    "end_step": payload["end_step"],
                    "available": False,
                },
            }
        )
    manifest = {
        "schema_version": "ecos.parameter_acceptance_manifest.v1",
        "workspace": str(workspace),
        "candidate_count": len(entries),
        "entries": entries,
    }
    manifest["manifest_sha256"] = canonical_sha256(manifest)
    (output / "acceptance-manifest.v1.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    report = {
        "schema_version": "ecos.parameter_acceptance_report.v1",
        "classification": (
            "Engineering Complete"
            if all(not entry["issues"] for entry in entries)
            else "Engineering Incomplete"
        ),
        "research_claim": "not_assessed",
        "terminal_closed_knobs": [entry["knob_id"] for entry in entries if entry["activation_status"] == "used"],
        "entries": entries,
        "manifest_sha256": manifest["manifest_sha256"],
    }
    (output / "acceptance-report.v1.json").write_text(
        json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_acceptance(args.workspace, args.output)


if __name__ == "__main__":
    main()
