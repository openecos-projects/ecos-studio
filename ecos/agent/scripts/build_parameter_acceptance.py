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
    "floorplan.core_util": "candidate-fb53a8688a8318c2-candidate-accept-core-util-v3-20260827",
    "floorplan.aspect_ratio": (
        "candidate-91962560dc60ce20-candidate-accept-aspect-ratio-v3b-20260827"
    ),
    "synth.max_fanout": "candidate-91962560dc60ce20-candidate-accept-max-fanout-v3b-20260827",
    "place.target_density": "candidate-accept-rerun-smoke2-20260827",
    "place.target_overflow": "candidate-accept-target-overflow-v3-20260827",
    "place.cell_padding_x": "candidate-accept-cell-padding-v3-20260827",
    "place.routability_opt": "candidate-accept-routability-v3-20260827",
    "place.density_weight": "candidate-accept-density-weight-v3-20260827",
}


def _state_sha256(root: Path) -> str:
    files = (
        "home/flow.json",
        "home/parameters.json",
        "config/floorplan_ecc.json",
        "config/fixfanout_ecc.json",
        "config/dreamplace_ecc.json",
    )
    missing = [relative for relative in files if not (root / relative).is_file()]
    if missing:
        raise FileNotFoundError(f"parent state files missing: {', '.join(missing)}")
    hashes = {relative: file_sha256(root / relative) for relative in files}
    return canonical_sha256(hashes)


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
        replay = candidate_root / "analysis" / "candidate_execution_receipt.v1.json"
        payload = json.loads(candidate_manifest.read_text(encoding="utf-8"))
        artifacts = payload.get("artifacts", {})
        for key, relative in (
            ("candidate_materialization", materialization),
            ("parameter_application_receipt", receipt),
            ("candidate_execution_receipt", replay),
        ):
            declared = artifacts.get(key, {}).get("sha256")
            if not relative.is_file():
                continue
            if declared != file_sha256(relative):
                # Keep processing so the report contains all independent failures.
                payload.setdefault("_artifact_issues", []).append(f"{key} hash mismatch")
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
        materialization_payload = json.loads(materialization.read_text(encoding="utf-8"))
        snapshots = materialization_payload.get("snapshots", [])
        configs = materialization_payload.get("configs", [])
        issues = []
        issues.extend(payload.pop("_artifact_issues", []))
        if not configs or not snapshots:
            issues.append("materialization snapshots missing")
        else:
            config_entry, snapshot = configs[0], snapshots[0]
            if config_entry.get("after_sha256") != snapshot.get("after_sha256"):
                issues.append("materialization after hash mismatch")
            if config_entry.get("before_sha256") == config_entry.get("after_sha256"):
                issues.append("materialization config did not change")
            if snapshot.get("before_sha256") == snapshot.get("after_sha256"):
                issues.append("materialization snapshot did not change")
        if receipt_payload.get("activation", {}).get("status") != "used":
            issues.append("native activation is not used")
        replay_payload = None
        if not replay.is_file():
            issues.append("replay artifact not persisted")
        else:
            replay_payload = json.loads(replay.read_text(encoding="utf-8"))
            if replay_payload.get("candidate_root_ref") != payload.get("candidate_root_ref"):
                issues.append("replay candidate root mismatch")
            if replay_payload.get("parent_candidate_root_ref") != payload.get(
                "parent_candidate_root_ref"
            ):
                issues.append("replay parent mismatch")
            parent_ref = payload.get("parent_candidate_root_ref")
            parent_root = workspace / parent_ref if isinstance(parent_ref, str) else workspace
            expected_parent_state = _state_sha256(parent_root)
            if payload.get("parent_state_sha256") != expected_parent_state:
                issues.append("candidate parent state hash mismatch")
            if replay_payload.get("parent_state_sha256") != expected_parent_state:
                issues.append("replay parent state hash mismatch")
            if replay_payload.get("target_step") != payload.get("target_step"):
                issues.append("replay target step mismatch")
            if replay_payload.get("end_step") != payload.get("end_step"):
                issues.append("replay end step mismatch")
            if replay_payload.get("execution_scope") != payload.get("execution_scope"):
                issues.append("replay execution scope mismatch")
        requested = receipt_payload.get("requested", {})
        effective = receipt_payload.get("effective_initial", {})
        expected_unit = (
            "objective_weight" if knob_id.endswith("density_weight") else requested.get("unit")
        )
        if requested.get("unit") != expected_unit:
            issues.append(f"native receipt unit mismatch; expected {expected_unit}")
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
                    "available": replay_payload is not None and not any(
                        issue.startswith(("replay ", "candidate parent state hash"))
                        for issue in issues
                    ),
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
