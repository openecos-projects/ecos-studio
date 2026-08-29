"""Build the compact, hash-bound acceptance index for the target knobs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.optimization_controller import CandidateExecutionEvidence
from ecos_agent.optimization_decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization_ecc_evidence import (
    OptimizationEccAdapterError,
    validate_candidate_artifacts,
)
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization_memory import (
    OptimizationTaskMemoryScope,
    OptimizationTaskMemoryStore,
)
from ecos_agent.optimization_observations import build_candidate_terminal_observation
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt
from ecos_agent.parameter_semantics import (
    load_parameter_cards,
    validate_application_receipt,
)

CANDIDATES = {
    "floorplan.core_util": "candidate-fb53a8688a8318c2-candidate-accept-core-util-v3-20260827",
    "floorplan.aspect_ratio": (
        "candidate-91962560dc60ce20-candidate-accept-aspect-ratio-v3b-20260827"
    ),
    "synth.max_fanout": "candidate-native-max-fanout-v9-20260827",
    "place.target_density": "candidate-accept-rerun-smoke2-20260827",
    "place.target_overflow": "candidate-accept-target-overflow-v3-20260827",
    "place.cell_padding_x": "candidate-accept-cell-padding-v3-20260827",
    "place.routability_opt": "candidate-routability-false-parent-v3b-20260827",
    "place.density_weight": "candidate-accept-density-weight-v3-20260827",
}

IGNORED_KNOBS: tuple[str, ...] = ()
_SUCCESSFUL_TRACE_OUTCOMES = frozenset(
    {
        OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        OptimizationOutcomeKind.IMPROVED,
        OptimizationOutcomeKind.DEGRADED,
        OptimizationOutcomeKind.TRADEOFF,
    }
)


def _receipt_is_effective(receipt: dict) -> bool:
    if receipt.get("application_status") != "applied":
        return False
    activation = receipt.get("activation", {})
    if activation.get("status") == "used":
        return True
    requested = receipt.get("requested", {})
    return (
        requested.get("knob_id") == "place.routability_opt"
        and requested.get("value") is False
        and activation.get("status") == "not_activated"
    )


def _validate_native_receipt(
    receipt_payload: dict,
    runtime_payload: dict,
    materialization_payload: dict,
    candidate_ref: str,
    knob_id: str,
    card,
    cards,
) -> tuple[ParameterApplicationReceipt | None, list[str]]:
    issues: list[str] = []
    try:
        receipt = ParameterApplicationReceipt.model_validate(receipt_payload)
    except ValueError:
        return None, ["native receipt contract validation failed"]
    try:
        validate_application_receipt(receipt, cards)
    except ValueError:
        issues.append("native receipt semantics validation failed")
    if receipt.requested["knob_id"] != knob_id:
        issues.append("native receipt knob does not match acceptance entry")
    if receipt.tool.source_sha256 != card.tool.source_sha256:
        issues.append("native receipt tool source does not match current card")
    if runtime_payload.get("tool") != receipt.tool.model_dump(mode="json"):
        issues.append("runtime report tool binding mismatch")
    expected_materialization_sha256 = canonical_sha256(
        {
            key: value
            for key, value in materialization_payload.items()
            if key != "receipt_sha256"
        }
    )
    if (
        materialization_payload.get("receipt_sha256") != expected_materialization_sha256
        or receipt.materialization.receipt_sha256 != expected_materialization_sha256
    ):
        issues.append("native receipt materialization hash mismatch")
    if (
        receipt.materialization.candidate_ref != candidate_ref
        or receipt.materialization.workspace_ref != candidate_ref
    ):
        issues.append("native receipt candidate binding mismatch")
    dumped = receipt.model_dump(mode="json", by_alias=True)
    runtime_fields = (
        "application_status",
        "effective_initial",
        "effective_final",
        "activation",
        "transitions",
        "consumer_observation",
    )
    if any(runtime_payload.get(field) != dumped.get(field) for field in runtime_fields):
        issues.append("native receipt does not match runtime report")
    return receipt, issues


def _validate_candidate_artifact_binding(
    *,
    workspace: Path,
    payload: dict,
    evidence: CandidateExecutionEvidence,
    receipt: ParameterApplicationReceipt,
    card,
) -> str | None:
    site_width_dbu = receipt.context.get("site_width_dbu")
    if type(site_width_dbu) is not int or site_width_dbu <= 0:
        return "application receipt site width binding is unavailable"
    try:
        validate_candidate_artifacts(
            workspace_root=workspace,
            site_width_dbu=site_width_dbu,
            receipt=receipt,
            requested=RequestedKnobValue(
                knob_id=OptimizationKnob(receipt.requested["knob_id"]),
                value=receipt.requested["value"],
            ),
            evidence=evidence,
            candidate_ref=payload["candidate_root_ref"],
            parent_ref=payload.get("parent_candidate_root_ref"),
            terminal_state=payload["terminal_state"],
            target_step=payload["target_step"],
            config_ref=card.surface.file,
            config_json_path=tuple(card.surface.json_path),
        )
    except (OptimizationEccAdapterError, TypeError, ValueError, KeyError) as exc:
        return f"candidate artifact binding failed: {exc}"
    return None


def _has_native_density_floor_override(receipt: dict) -> bool:
    if receipt.get("requested", {}).get("knob_id") != "place.target_density":
        return False
    requested = receipt.get("requested", {}).get("value")
    effective = receipt.get("effective_initial", {}).get("value")
    final = receipt.get("effective_final", {}).get("value")
    observation = receipt.get("consumer_observation") or {}
    if (
        type(requested) not in {int, float}
        or type(effective) not in {int, float}
        or requested >= effective
        or final != effective
        or observation.get("effective_target_density") != effective
        or observation.get("density_tensor_value") != effective
    ):
        return False
    return any(
        transition.get("to") == "overridden"
        and transition.get("rule_id") == "dreamplace.target_density.utilization_floor"
        and transition.get("value") == effective
        and bool(transition.get("evidence_ref"))
        and bool(transition.get("evidence_sha256"))
        for transition in receipt.get("transitions", [])
        if isinstance(transition, dict)
    )


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


def _read_json_artifact(path: Path, label: str, issues: list[str]) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        issues.append(f"{label} is missing or invalid")
        return {}
    if not isinstance(payload, dict):
        issues.append(f"{label} is invalid")
        return {}
    return payload


def _verified_episode_replays(
    workspace: Path, episode_roots: tuple[Path, ...]
) -> tuple[dict, ...]:
    optimization_root = (workspace / ".agent/optimization").resolve()
    verified = []
    for requested_root in episode_roots:
        try:
            root = requested_root.resolve(strict=True)
            if root.parent != optimization_root:
                continue
            ledger = OptimizationLedger(root).verify()
            planning = OptimizationPlanningAudit(root).verify()
            decisions = OptimizationDecisionAudit(root).verify()
            scope = OptimizationTaskMemoryScope.model_validate_json(
                (root / "optimization-task-memory-scope.v1.json").read_bytes()
            )
            store = OptimizationTaskMemoryStore(optimization_root, scope)
            store.verify_episode_scope(root)
            memory = store.replay()
        except (OSError, TypeError, ValueError):
            continue
        planning_by_hash = {entry.entry_sha256: entry for entry in planning.entries}
        decision_by_hash = {entry.entry_sha256: entry for entry in decisions.entries}
        if (
            scope.episode_id != root.name
            or not planning_by_hash
            or not decision_by_hash
            or any(
                entry.planning_entry_sha256 not in planning_by_hash
                for entry in decisions.entries
            )
        ):
            continue
        verified.append(
            {
                "root": root,
                "scope": scope,
                "ledger_entries": ledger.entries,
                "planning": planning_by_hash,
                "decisions": decision_by_hash,
                "memory_entries": memory.entries,
            }
        )
    return tuple(verified)


def _matching_trace_episode(
    replays: tuple[dict, ...],
    *,
    candidate_root_ref: str,
    candidate_manifest_sha256: str,
    receipt_sha256: str | None,
    terminal_observation_sha256: str,
    card_sha256: str,
) -> Path | None:
    for replay in replays:
        starts = {
            entry.payload.intervention_id: entry.payload
            for entry in replay["ledger_entries"]
            if isinstance(entry.payload, OptimizationInterventionStart)
        }
        for ledger_entry in replay["ledger_entries"]:
            terminal = ledger_entry.payload
            if not isinstance(
                terminal, OptimizationTerminalOutcome
            ) or not _terminal_matches(
                terminal,
                candidate_root_ref,
                candidate_manifest_sha256,
                receipt_sha256,
                terminal_observation_sha256,
                card_sha256,
            ):
                continue
            if any(
                _memory_matches(
                    entry,
                    replay,
                    ledger_entry.entry_sha256,
                    starts.get(terminal.intervention_id),
                    terminal,
                )
                for entry in replay["memory_entries"]
            ):
                return replay["root"]
    return None


def _terminal_matches(
    terminal,
    root_ref,
    manifest_sha256,
    receipt_sha256,
    terminal_sha256,
    card_sha256,
) -> bool:
    receipt = terminal.parameter_application_receipt
    observation = terminal.terminal_observation
    return (
        terminal.outcome in _SUCCESSFUL_TRACE_OUTCOMES
        and terminal.candidate_root_ref == root_ref
        and terminal.candidate_manifest_sha256 == manifest_sha256
        and terminal.receipt_sha256 == receipt_sha256
        and terminal.terminal_observation_sha256 == terminal_sha256
        and terminal.parameter_card_sha256 == card_sha256
        and receipt is not None
        and receipt.evidence_sha256 == receipt_sha256
        and observation is not None
        and observation.schema_version == "ecos.terminal_observation.v3"
        and observation.eligible_for_incumbent
    )


def _memory_matches(entry, replay, ledger_entry_sha256, start, terminal) -> bool:
    evidence = entry.evidence
    decision = replay["decisions"].get(evidence.decision_entry_sha256)
    receipt = entry.parameter_application_receipt
    return (
        start is not None
        and decision is not None
        and decision.validation_result in {"accepted", "fallback"}
        and decision.proposal is not None
        and decision.planning_entry_sha256 == evidence.planning_entry_sha256
        and decision.planning_entry_sha256 in replay["planning"]
        and canonical_sha256(decision.proposal.model_dump(mode="json"))
        == start.proposal_sha256
        and evidence.source_episode_id == replay["scope"].episode_id
        and evidence.intervention_id == terminal.intervention_id
        and evidence.ledger_terminal_entry_sha256 == ledger_entry_sha256
        and evidence.candidate_root_ref == terminal.candidate_root_ref
        and evidence.candidate_manifest_sha256 == terminal.candidate_manifest_sha256
        and evidence.receipt_sha256 == terminal.receipt_sha256
        and evidence.terminal_observation_sha256 == terminal.terminal_observation_sha256
        and entry.outcome == terminal.outcome
        and entry.terminal_observation.eligible_for_incumbent
        and receipt is not None
        and receipt.evidence_sha256 == terminal.receipt_sha256
    )


def build_acceptance(
    workspace: Path,
    output: Path,
    *,
    episode_roots: tuple[Path, ...] = (),
) -> dict:
    cards = load_parameter_cards()
    card_by_id = {card.knob_id.value: card for card in cards.values()}
    episode_replays = _verified_episode_replays(workspace, episode_roots)
    entries = []
    observation_dir = output / "terminal-observations"
    for knob_id, candidate_id in CANDIDATES.items():
        candidate_root = workspace / ".agent" / "candidates" / candidate_id
        candidate_manifest = candidate_root / "analysis" / "candidate_workspace.v1.json"
        materialization = (
            candidate_root / "analysis" / "candidate_materialization.v1.json"
        )
        receipt = candidate_root / "analysis" / "parameter_application_receipt.v1.json"
        runtime_report = (
            candidate_root / "analysis" / "parameter_runtime_report.v1.json"
        )
        replay = candidate_root / "analysis" / "candidate_execution_receipt.v1.json"
        payload = json.loads(candidate_manifest.read_text(encoding="utf-8"))
        artifacts = payload.get("artifacts", {})
        for key, relative in (
            ("candidate_materialization", materialization),
            ("parameter_application_receipt", receipt),
            ("parameter_runtime_report", runtime_report),
        ):
            declared_artifact = artifacts.get(key, {})
            if not relative.is_file():
                payload.setdefault("_artifact_issues", []).append(f"{key} missing")
                continue
            expected_ref = relative.relative_to(candidate_root).as_posix()
            if declared_artifact.get("ref") != expected_ref:
                payload.setdefault("_artifact_issues", []).append(f"{key} ref mismatch")
            if declared_artifact.get("sha256") != file_sha256(relative):
                # Keep processing so the report contains all independent failures.
                payload.setdefault("_artifact_issues", []).append(
                    f"{key} hash mismatch"
                )
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
            json.dumps(observation.model_dump(mode="json"), sort_keys=True, indent=2)
            + "\n",
            encoding="utf-8",
        )
        issues = payload.pop("_artifact_issues", [])
        receipt_payload = _read_json_artifact(receipt, "native receipt", issues)
        runtime_payload = _read_json_artifact(runtime_report, "runtime report", issues)
        materialization_payload = _read_json_artifact(
            materialization, "materialization receipt", issues
        )
        snapshots = materialization_payload.get("snapshots", [])
        configs = materialization_payload.get("configs", [])
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
        native_receipt, receipt_issues = _validate_native_receipt(
            receipt_payload,
            runtime_payload,
            materialization_payload,
            payload["candidate_root_ref"],
            knob_id,
            card_by_id[knob_id],
            cards,
        )
        issues.extend(receipt_issues)
        if native_receipt is None or not _receipt_is_effective(receipt_payload):
            issues.append("native receipt is not effective")
        elif binding_issue := _validate_candidate_artifact_binding(
            workspace=workspace,
            payload=payload,
            evidence=evidence,
            receipt=native_receipt,
            card=card_by_id[knob_id],
        ):
            issues.append(binding_issue)
        if not observation.eligible_for_incumbent:
            issues.append("terminal observation is not eligible for incumbent")
        replay_payload = None
        if not replay.is_file():
            issues.append("replay artifact not persisted")
        else:
            replay_payload = _read_json_artifact(replay, "replay artifact", issues)
            if replay_payload.get("schema") != "ecc.candidate_execution_receipt.v1":
                issues.append("replay schema mismatch")
            if replay_payload.get("candidate_id") != payload.get("candidate_id"):
                issues.append("replay candidate id mismatch")
            if replay_payload.get("candidate_root_ref") != payload.get(
                "candidate_root_ref"
            ):
                issues.append("replay candidate root mismatch")
            if replay_payload.get("parent_candidate_root_ref") != payload.get(
                "parent_candidate_root_ref"
            ):
                issues.append("replay parent mismatch")
            parent_ref = payload.get("parent_candidate_root_ref")
            parent_root = (
                workspace / parent_ref if isinstance(parent_ref, str) else workspace
            )
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
            if replay_payload.get("parent_flow_sha256") != payload.get(
                "parent_flow_sha256"
            ):
                issues.append("replay parent flow mismatch")
            if replay_payload.get("candidate_manifest_sha256") != file_sha256(
                candidate_manifest
            ):
                issues.append("replay candidate manifest hash mismatch")
        requested = receipt_payload.get("requested", {})
        effective = receipt_payload.get("effective_initial", {})
        expected_unit = (
            "objective_weight"
            if knob_id.endswith("density_weight")
            else requested.get("unit")
        )
        if requested.get("unit") != expected_unit:
            issues.append(f"native receipt unit mismatch; expected {expected_unit}")
        if (
            requested.get("value") != effective.get("value")
            and knob_id != "place.cell_padding_x"
            and not _has_native_density_floor_override(receipt_payload)
        ):
            issues.append("effective initial does not match requested value")
        card_sha256 = canonical_sha256(card_by_id[knob_id].model_dump(mode="json"))
        terminal_sha256 = canonical_sha256(observation.model_dump(mode="json"))
        trace_episode = _matching_trace_episode(
            episode_replays,
            candidate_root_ref=evidence.candidate_root_ref,
            candidate_manifest_sha256=evidence.candidate_manifest_sha256,
            receipt_sha256=(
                native_receipt.evidence_sha256 if native_receipt is not None else None
            ),
            terminal_observation_sha256=terminal_sha256,
            card_sha256=card_sha256,
        )
        if trace_episode is None:
            issues.append("optimization trace replay is missing, invalid, or unmatched")
        entries.append(
            {
                "knob_id": knob_id,
                "card_sha256": card_sha256,
                "candidate_id": candidate_id,
                "candidate_root_ref": evidence.candidate_root_ref,
                "candidate_manifest_ref": evidence.candidate_manifest_ref,
                "candidate_manifest_sha256": evidence.candidate_manifest_sha256,
                "materialization_ref": str(materialization.relative_to(workspace)),
                "materialization_sha256": (
                    file_sha256(materialization) if materialization.is_file() else None
                ),
                "native_receipt_ref": str(receipt.relative_to(workspace)),
                "native_receipt_sha256": file_sha256(receipt)
                if receipt.is_file()
                else None,
                "activation_status": receipt_payload.get("activation", {}).get(
                    "status"
                ),
                "issues": issues,
                "terminal_observation_ref": str(observation_path.relative_to(output)),
                "terminal_observation_sha256": terminal_sha256,
                "optimization_trace": {
                    "episode_root_ref": (
                        trace_episode.relative_to(workspace).as_posix()
                        if trace_episode is not None
                        else None
                    ),
                    "verified": trace_episode is not None,
                },
                "replay": {
                    "operation": "candidate.rerun",
                    "target_step": payload["target_step"],
                    "end_step": payload["end_step"],
                    "available": replay_payload is not None
                    and not any(
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
        "ignored_knobs": list(IGNORED_KNOBS),
        "entries": entries,
    }
    manifest["manifest_sha256"] = canonical_sha256(manifest)
    (output / "acceptance-manifest.v1.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    report = {
        "schema_version": "ecos.parameter_acceptance_report.v1",
        "ignored_knobs": list(IGNORED_KNOBS),
        "classification": (
            "Engineering Complete"
            if all(not entry["issues"] for entry in entries)
            else "Engineering Incomplete"
        ),
        "research_claim": "not_assessed",
        "terminal_closed_knobs": [
            entry["knob_id"]
            for entry in entries
            if not entry["issues"]
            and (
                entry["activation_status"] == "used"
                or (
                    entry["knob_id"] == "place.routability_opt"
                    and entry["activation_status"] == "not_activated"
                )
            )
        ],
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
    parser.add_argument("--episode-root", type=Path, action="append", default=[])
    args = parser.parse_args()
    build_acceptance(
        args.workspace,
        args.output,
        episode_roots=tuple(args.episode_root),
    )


if __name__ == "__main__":
    main()
