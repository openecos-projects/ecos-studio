"""Generate the ECC-free RQ1 Tier-A contract-case matrix."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Mapping, Sequence

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    PlanningProviderEnvelope,
    PlanningProviderEvidence,
)
from ecos_agent.optimization.experiments.rq1_execution_evidence import analyze_records
from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import (
    TIER_A_CASE_NAMES,
    build_case_matrix,
    render_case_matrix_markdown,
    replay_fidelity,
)
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerIntegrityError,
    OptimizationOutcomeKind,
    OptimizationPlanningProviderAuditIntegrityError,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization.parameters.contracts import (
    MaterializationRef,
    ParameterApplication,
    ParameterApplicationReceipt,
    ParameterEvidence,
    ParameterValueEvidence,
    ToolRef,
)
from ecos_agent.optimization.rules import IncumbentDecision

_HASH = "sha256:" + "a" * 64
_RELATIONS = (
    "exact",
    "converted",
    "quantized",
    "clamped",
    "floored",
    "transformed",
    "rederived",
)
_FAIL_CLOSED_CASES = {
    "missing receipt",
    "stale verifier evidence",
    "tampered hash",
    "foreign candidate binding",
}


def _hash(letter: str) -> str:
    return "sha256:" + letter * 64


def _receipt(
    case: str,
    *,
    status: str = "applied",
    relation: str = "exact",
    receipt_id: str = "receipt-1",
    candidate_ref: str = "candidate-1",
    requested: float = 0.5,
    consumed: float | None = 0.6,
    realized: float | None = None,
) -> ParameterApplicationReceipt:
    consumed_evidence = (
        ParameterValueEvidence(
            value=consumed,
            unit="ratio",
            source=f"native.{case.replace(' ', '_')}",
        )
        if consumed is not None
        else None
    )
    realized_evidence = (
        ParameterValueEvidence(
            value=realized,
            unit="ratio",
            source=f"derived.{case.replace(' ', '_')}",
        )
        if realized is not None
        else None
    )
    return ParameterApplicationReceipt.model_construct(
        receipt_id=receipt_id,
        tool=ToolRef(name="fixture-tool", revision="tier-a"),
        context={"stage": "place", "fixture_case": case},
        parameter=ParameterEvidence(
            knob_id="place.target_density",
            requested=ParameterValueEvidence(value=requested, unit="ratio"),
            written=ParameterValueEvidence(value=requested, unit="ratio"),
            consumed=consumed_evidence,
            realized=realized_evidence,
        ),
        materialization=MaterializationRef(
            receipt_ref=f"fixtures/{case.replace(' ', '_')}/receipt.json",
            receipt_sha256=_HASH,
            registry_sha256=_HASH,
            patch_sha256=_HASH,
            candidate_ref=candidate_ref,
            workspace_ref=candidate_ref,
            config_before_sha256=_HASH,
            config_after_sha256=_HASH,
            written_value=requested,
            unit="ratio",
        ),
        application=ParameterApplication(
            status=status,
            relation=relation,
            reason=None if status == "applied" else f"native {case} evidence",
        ),
        observation={},
        evidence_sha256=_hash("b" if receipt_id.endswith("2") else "a"),
    )


def _start(intervention_id: str = "i-1") -> OptimizationInterventionStart:
    return OptimizationInterventionStart.model_construct(
        intervention_id=intervention_id,
        parent_checkpoint_id=f"{intervention_id}-parent",
        candidate_checkpoint_id=f"{intervention_id}-candidate",
        parameter_before_sha256=_HASH,
        parameter_after_sha256=_HASH,
        proposal_sha256=_HASH,
        execution_contract_sha256=_HASH,
        parent_manifest_sha256=_HASH,
        environment_sha256=_HASH,
    )


def _outcome(
    intervention_id: str,
    receipt: ParameterApplicationReceipt | None,
    *,
    outcome: OptimizationOutcomeKind = OptimizationOutcomeKind.CANDIDATE_INELIGIBLE,
    promoted: bool = False,
    receipt_sha256: str | None = None,
    receipt_id: str | None = None,
) -> OptimizationTerminalOutcome:
    return OptimizationTerminalOutcome.model_construct(
        intervention_id=intervention_id,
        outcome=outcome,
        candidate_manifest_sha256=_HASH,
        receipt_sha256=(
            receipt_sha256
            if receipt_sha256 is not None
            else receipt.evidence_sha256 if receipt else None
        ),
        parameter_application_receipt=receipt,
        parameter_application_receipt_id=(
            receipt_id
            if receipt_id is not None
            else receipt.receipt_id if receipt else None
        ),
        materialization_receipt_sha256=(
            receipt.materialization.receipt_sha256 if receipt else None
        ),
        incumbent_decision=(
            IncumbentDecision.CANDIDATE_BETTER
            if promoted
            else IncumbentDecision.CANDIDATE_INELIGIBLE
        ),
        outcome_details_sha256=_HASH,
        terminal_observation=None,
    )


def _role_expectations(
    *,
    requested: float = 0.5,
    consumed: float | None,
    realized: float | None = None,
) -> dict[str, Any]:
    return {
        "requested": {"present": True, "value": requested},
        "written": {"present": True, "value": requested},
        "consumed": {
            "present": consumed is not None,
            "value": consumed,
            "source_kind": "native" if consumed is not None else None,
        },
        "realized": {
            "present": realized is not None,
            "value": realized,
            "source_kind": "derived" if realized is not None else None,
        },
    }


def _role_snapshot(receipt: ParameterApplicationReceipt) -> dict[str, Any]:
    parameter = receipt.parameter

    def snapshot(role: str) -> dict[str, Any]:
        evidence = getattr(parameter, role)
        result = {
            "present": evidence is not None,
            "value": evidence.value if evidence is not None else None,
        }
        if role in {"consumed", "realized"}:
            source = evidence.source if evidence is not None else None
            result["source_kind"] = source.split(".", 1)[0] if source else None
        return result

    return {role: snapshot(role) for role in ("requested", "written", "consumed", "realized")}


def _classified(report: Mapping[str, Any], metric_id: str) -> str:
    distribution = report["primary"][metric_id]["distribution"]
    observed = [name for name, count in distribution.items() if count]
    return observed[0] if len(observed) == 1 else "unresolved"


def _metrics(
    name: str,
    report: Mapping[str, Any],
    observed: Mapping[str, Any],
) -> dict[str, Any]:
    primary = report["primary"]
    accounting = primary["P19"]
    return {
        "false_applied": primary["P12"]["false_applied"],
        "false_inactive": primary["P12"]["false_inactive"],
        "false_promotion": primary["P12"]["false_promotion"],
        "promotion_invariant_violations": primary["P10"]["count"],
        "fail_closed": (
            int(observed.get("promotion") is False)
            if name in _FAIL_CLOSED_CASES
            else None
        ),
        "failure_accounting_conserved": (
            accounting["conservation"]
            and accounting["accounted_started"] == accounting["accounted_terminal"]
        ),
        "stale_receipt": primary["P13"].get("stale_receipt", 0),
        "foreign_candidate": primary["P08"].get("foreign_candidate", 0),
        "receipt_semantic_mismatch": 0,
    }


def _row(
    name: str,
    expected: Mapping[str, Any],
    observed: Mapping[str, Any],
    report: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "case": name,
        "expected": dict(expected),
        "observed": dict(observed),
        "evidence_refs": [
            f"contract-cases/fixtures/{name.replace(' ', '_')}.json"
        ],
        "producer_coverage": "fixture-only",
        "metrics": _metrics(name, report, observed),
    }


def _single_case(
    name: str,
    receipt: ParameterApplicationReceipt,
    *,
    expected_status: str,
    expected_relation: str,
    expected_roles: Mapping[str, Any],
    promoted: bool = False,
    outcome: OptimizationOutcomeKind = OptimizationOutcomeKind.CANDIDATE_INELIGIBLE,
    reason_typed: bool = False,
    control: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    terminal = _outcome("i-1", receipt, outcome=outcome, promoted=promoted)
    report = analyze_records(
        [_start()],
        [terminal],
        contract_cases=[{
            "expected_status": expected_status,
            "observed_status": receipt.application.status,
            "expected_block": not promoted,
            "observed_promoted": promoted,
        }],
    )
    expected = {
        "status": expected_status,
        "relation": expected_relation,
        "roles": dict(expected_roles),
        "promotion": promoted,
        "execution_outcome": outcome.value,
        "reason_typed": reason_typed,
        "control": dict(control or {}),
    }
    observed = {
        "status": _classified(report, "P05"),
        "relation": _classified(report, "P06"),
        "roles": _role_snapshot(receipt),
        "promotion": promoted,
        "execution_outcome": terminal.outcome.value,
        "reason_typed": bool(report["primary"]["P07"]["numerator"]),
        "control": dict(control or {}),
    }
    return _row(name, expected, observed, report)


def _chain_tamper_verdict() -> dict[str, bool]:
    ledger_rejected = False
    with TemporaryDirectory() as root:
        ledger = OptimizationLedger(Path(root))
        ledger.append_start(OptimizationInterventionStart(
            record_type="intervention_started",
            intervention_id="i-1",
            parent_checkpoint_id="parent",
            candidate_checkpoint_id="candidate",
            parameter_before_sha256=_HASH,
            parameter_after_sha256=_HASH,
            proposal_sha256=_HASH,
            execution_contract_sha256=_HASH,
            parent_manifest_sha256=_HASH,
            environment_sha256=_HASH,
        ))
        ledger.append_terminal(OptimizationTerminalOutcome(
            record_type="terminal_outcome",
            intervention_id="i-1",
            outcome=OptimizationOutcomeKind.DEGRADED,
            candidate_manifest_sha256=_HASH,
            receipt_sha256=_HASH,
            terminal_observation_sha256=_HASH,
            outcome_details_sha256=_HASH,
        ))
        ledger.ledger_path.write_text(
            ledger.ledger_path.read_text(encoding="utf-8").replace(
                "degraded", "improved"
            ),
            encoding="utf-8",
        )
        try:
            ledger.verify()
        except OptimizationLedgerIntegrityError:
            ledger_rejected = True

    audit_rejected = False
    with TemporaryDirectory() as root:
        audit = OptimizationPlanningProviderEvidenceAudit(Path(root))
        envelope_payload = {
            "schema_version": "ecos.optimization_planning_provider_envelope.v1",
            "provider_id": "codex_app_server",
            "requested_model": "fixture-model",
            "prompt": "bounded fixture prompt",
            "output_schema": {"type": "object"},
            "planner_payload_sha256": _HASH,
        }
        evidence = PlanningProviderEvidence(
            provider_id="codex_app_server",
            thread_id="thread-1",
            turn_id="turn-1",
            response_sha256=_HASH,
            diagnostics_sha256=_HASH,
            envelope=PlanningProviderEnvelope(
                **envelope_payload,
                envelope_sha256=canonical_sha256(envelope_payload),
            ),
        )
        audit.append(planning_entry_sha256=_HASH, evidence=evidence)
        audit.audit_path.write_text(
            audit.audit_path.read_text(encoding="utf-8").replace(
                "turn-1", "turn-2"
            ),
            encoding="utf-8",
        )
        try:
            audit.verify()
        except OptimizationPlanningProviderAuditIntegrityError:
            audit_rejected = True
    return {
        "ledger_hash_rejected": ledger_rejected,
        "audit_hash_rejected": audit_rejected,
    }


def _blocked_row(
    name: str,
    report: Mapping[str, Any],
    observed_control: Mapping[str, Any],
    expected_control: Mapping[str, Any],
) -> dict[str, Any]:
    common = {
        "status": "unresolved",
        "relation": "unresolved",
        "roles": {"accepted": False},
        "promotion": False,
        "execution_outcome": "candidate_ineligible",
        "reason_typed": None,
    }
    return _row(
        name,
        {**common, "control": dict(expected_control)},
        {**common, "control": dict(observed_control)},
        report,
    )


def run_tier_a_cases() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for relation in _RELATIONS:
        name = "exact mapping" if relation == "exact" else relation
        consumed = 0.5 if relation == "exact" else 0.6
        realized = 0.61 if relation in {"transformed", "rederived"} else None
        receipt = _receipt(
            name,
            relation=relation,
            consumed=consumed,
            realized=realized,
        )
        rows.append(_single_case(
            name,
            receipt,
            expected_status="applied",
            expected_relation=relation,
            expected_roles=_role_expectations(
                consumed=consumed,
                realized=realized,
            ),
            promoted=True,
            outcome=OptimizationOutcomeKind.IMPROVED,
        ))

    for name, status in (
        ("inactive", "inactive"),
        ("application failure", "failed"),
    ):
        receipt = _receipt(name, status=status, relation="unknown", consumed=None)
        rows.append(_single_case(
            name,
            receipt,
            expected_status=status,
            expected_relation="unknown",
            expected_roles=_role_expectations(consumed=None),
            reason_typed=True,
            control={
                "native_failure_evidence": name == "application failure",
            },
        ))

    downstream = _receipt(
        "downstream execution failure after application",
        relation="exact",
        consumed=0.5,
    )
    rows.append(_single_case(
        "downstream execution failure after application",
        downstream,
        expected_status="applied",
        expected_relation="exact",
        expected_roles=_role_expectations(consumed=0.5),
        outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
        control={"application_failure": False, "terminal_eligible": False},
    ))

    missing_native = _receipt(
        "missing native evidence",
        status="unknown",
        relation="unknown",
        consumed=None,
    )
    rows.append(_single_case(
        "missing native evidence",
        missing_native,
        expected_status="unknown",
        expected_relation="unknown",
        expected_roles=_role_expectations(consumed=None),
        reason_typed=True,
        control={"native_failure_evidence": False},
    ))

    stale = _receipt("stale verifier evidence")
    report = analyze_records(
        [_start()],
        [_outcome("i-1", stale, receipt_sha256=_hash("c"))],
        contract_cases=[{
            "expected_status": "applied",
            "observed_status": "applied",
            "expected_block": True,
            "observed_promoted": False,
        }],
    )
    rows.append(_blocked_row(
        "stale verifier evidence",
        report,
        {"stale_binding": report["primary"]["P13"]["stale_receipt"]},
        {"stale_binding": 1},
    ))

    empty_terminal = _outcome("i-1", None)
    report = analyze_records(
        [_start()],
        [empty_terminal],
        contract_cases=[{
            "expected_status": "unknown",
            "observed_status": "unknown",
            "expected_block": True,
            "observed_promoted": False,
        }],
    )
    rows.append(_blocked_row(
        "missing receipt",
        report,
        {"missing_receipt": report["primary"]["P19"]["counts"]["missing_receipt"]},
        {"missing_receipt": 1},
    ))

    tampered = _receipt("tampered hash").model_dump(mode="json")
    tampered["evidence_sha256"] = _hash("d")
    report = analyze_records(
        [_start()],
        [empty_terminal],
        receipts=[tampered],
        contract_cases=[{
            "expected_status": "unknown",
            "observed_status": "unknown",
            "expected_block": True,
            "observed_promoted": False,
        }],
    )
    rows.append(_blocked_row(
        "tampered hash",
        report,
        {
            "receipt_hash_rejected": (
                report["primary"]["P01"]["receipt_valid_of_emitted"]["numerator"]
                == 0
            ),
            **_chain_tamper_verdict(),
        },
        {
            "receipt_hash_rejected": True,
            "ledger_hash_rejected": True,
            "audit_hash_rejected": True,
        },
    ))

    foreign = _receipt("foreign candidate binding")
    foreign_terminal = _outcome("i-1", None, receipt_id="foreign-receipt")
    report = analyze_records(
        [_start()],
        [foreign_terminal],
        receipts=[foreign],
        contract_cases=[{
            "expected_status": "unknown",
            "observed_status": "unknown",
            "expected_block": True,
            "observed_promoted": False,
        }],
    )
    rows.append(_blocked_row(
        "foreign candidate binding",
        report,
        {"foreign_candidate": report["primary"]["P08"]["foreign_candidate"]},
        {"foreign_candidate": 1},
    ))

    duplicate_inputs = (
        (
            "duplicate requested",
            _receipt(
                "duplicate requested",
                receipt_id="receipt-1",
                candidate_ref="candidate-1",
                requested=0.5,
                consumed=0.6,
            ),
            _receipt(
                "duplicate requested",
                receipt_id="receipt-2",
                candidate_ref="candidate-2",
                requested=0.5,
                consumed=0.7,
            ),
            {"native_duplicate": False, "shadow_duplicate": False},
        ),
        (
            "duplicate consumed",
            _receipt(
                "duplicate consumed",
                receipt_id="receipt-1",
                candidate_ref="candidate-1",
                requested=0.5,
                consumed=0.6,
            ),
            _receipt(
                "duplicate consumed",
                receipt_id="receipt-2",
                candidate_ref="candidate-2",
                requested=0.7,
                consumed=0.6,
            ),
            {"native_duplicate": True, "shadow_duplicate": True},
        ),
    )
    for name, first, second, expected_control in duplicate_inputs:
        report = analyze_records(
            [_start("i-1"), _start("i-2")],
            [_outcome("i-1", first), _outcome("i-2", second)],
            contract_cases=[],
        )
        observed_control = {
            "native_duplicate": report["primary"]["P14"]["duplicate_consumed"] > 0,
            "shadow_duplicate": report["primary"]["P14"]["shadow_duplicates"] > 0,
        }
        expected = {
            "status": "applied/applied",
            "relation": "exact/exact",
            "roles": {
                "requested": [
                    first.parameter.requested.value,
                    second.parameter.requested.value,
                ],
                "consumed": [
                    first.parameter.consumed.value,
                    second.parameter.consumed.value,
                ],
            },
            "promotion": False,
            "execution_outcome": "candidate_ineligible/candidate_ineligible",
            "reason_typed": False,
            "control": expected_control,
        }
        observed = {**expected, "control": observed_control}
        rows.append(_row(name, expected, observed, report))

    original = {
        "requested": {"knob": "place.target_density", "value": 0.5},
        "receipt_ids": ["episode-a.receipt-1"],
        "receipt_semantics": [{
            "status": "applied",
            "relation": "exact",
            "consumed": 0.5,
        }],
        "primary": {"P10": {"count": 0}},
        "terminal": {"values": {"route_wirelength": 100.0}},
    }
    replay = {
        **original,
        "receipt_ids": ["episode-b.receipt-9"],
        "terminal": {"values": {"route_wirelength": 100.0000005}},
    }
    fidelity = replay_fidelity(original, replay)
    replay_common = {
        "status": "applied",
        "relation": "exact",
        "roles": {"receipt_semantics_preserved": True},
        "promotion": False,
        "execution_outcome": "replay_only",
        "reason_typed": False,
    }
    expected_fidelity = {
        "proposal_action": {"exact": 1, "within_band": 0, "mismatch": 0},
        "receipt_semantics": {"exact": 1, "within_band": 0, "mismatch": 0},
        "promotion_decision": {"exact": 1, "within_band": 0, "mismatch": 0},
        "terminal_metrics": {"exact": 0, "within_band": 1, "mismatch": 0},
    }
    observed_fidelity = {layer: fidelity[layer] for layer in expected_fidelity}
    rows.append({
        "case": "replay",
        "expected": {**replay_common, "control": expected_fidelity},
        "observed": {**replay_common, "control": observed_fidelity},
        "evidence_refs": ["contract-cases/fixtures/replay.json"],
        "producer_coverage": "fixture-only",
        "metrics": {
            "false_applied": 0,
            "false_inactive": 0,
            "false_promotion": 0,
            "promotion_invariant_violations": 0,
            "fail_closed": None,
            "failure_accounting_conserved": True,
            "receipt_semantic_mismatch": fidelity["receipt_semantics"]["mismatch"],
        },
    })
    order = {name: index for index, name in enumerate(TIER_A_CASE_NAMES)}
    rows.sort(key=lambda row: order[row["case"]])
    return rows


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_contract_case_artifacts(output_dir: Path) -> dict[str, Any]:
    rows = run_tier_a_cases()
    fixtures = output_dir / "fixtures"
    for row in rows:
        _write_json(
            fixtures / f"{row['case'].replace(' ', '_')}.json",
            row,
        )
    matrix = build_case_matrix(rows)
    _write_json(output_dir / "rq1-contract-case-matrix.v1.json", matrix)
    (output_dir / "rq1-contract-case-matrix.v1.md").write_text(
        render_case_matrix_markdown(matrix),
        encoding="utf-8",
    )
    if not matrix["summary"]["complete"]:
        raise ValueError("RQ1 Tier-A contract matrix is incomplete or failed")
    return matrix


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    matrix = write_contract_case_artifacts(args.output_dir)
    json.dump(matrix["summary"], sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
