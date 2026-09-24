from __future__ import annotations

from ecos_agent.optimization.experiments.rq1_execution_evidence import (
    analyze_records,
    auc20,
)
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationOutcomeKind,
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

HASH = "sha256:" + "a" * 64


def _receipt(*, status: str = "applied", receipt_id: str = "receipt-1", requested: float = 0.5) -> ParameterApplicationReceipt:
    return ParameterApplicationReceipt.model_construct(
        receipt_id=receipt_id,
        tool=ToolRef(name="tool", revision="test"),
        context={"stage": "place"},
        parameter=ParameterEvidence(
            knob_id="place.target_density",
            requested=ParameterValueEvidence(value=requested, unit="ratio"),
            written=ParameterValueEvidence(value=requested, unit="ratio"),
            consumed=(
                ParameterValueEvidence(value=0.6, unit="ratio", source="native")
                if status == "applied" else None
            ),
            realized=None,
        ),
        materialization=MaterializationRef(
            receipt_ref="receipt.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=HASH,
            config_after_sha256=HASH,
            written_value=requested,
            unit="ratio",
        ),
        application=ParameterApplication(status=status, relation="transformed", reason="native inactive"),
        observation={},
        evidence_sha256=HASH,
    )


def _start(intervention_id: str = "i-1") -> OptimizationInterventionStart:
    return OptimizationInterventionStart.model_construct(
        intervention_id=intervention_id,
        parent_checkpoint_id="parent",
        candidate_checkpoint_id="candidate",
        parameter_before_sha256=HASH,
        parameter_after_sha256=HASH,
        proposal_sha256=HASH,
        execution_contract_sha256=HASH,
        parent_manifest_sha256=HASH,
        environment_sha256=HASH,
    )


def _outcome(receipt: ParameterApplicationReceipt | None, *, promoted: bool = False) -> OptimizationTerminalOutcome:
    return OptimizationTerminalOutcome.model_construct(
        intervention_id="i-1",
        outcome=(OptimizationOutcomeKind.IMPROVED if promoted else OptimizationOutcomeKind.EXECUTION_FAILED),
        candidate_manifest_sha256=HASH,
        receipt_sha256=receipt.evidence_sha256 if receipt else None,
        parameter_application_receipt=receipt,
        parameter_application_receipt_id=receipt.receipt_id if receipt else None,
        incumbent_decision=(IncumbentDecision.CANDIDATE_BETTER if promoted else IncumbentDecision.CANDIDATE_INELIGIBLE),
        outcome_details_sha256=HASH,
        terminal_observation=None,
    )


def test_auc20_pads_only_a_complete_terminal_curve() -> None:
    assert auc20([False, True], terminal_complete=True)["value"] == 0.95
    result = auc20([False, True], terminal_complete=False)
    assert result["value"] is None
    assert result["partial"] == 0.5


def test_analyzer_keeps_failed_and_downstream_failure_distinct() -> None:
    receipt = _receipt()
    report = analyze_records([_start()], [_outcome(receipt)])
    assert report["primary"]["P03"]["rate"] == 1.0
    assert report["primary"]["P10"]["count"] == 0
    assert report["primary"]["P05"]["distribution"]["applied"] == 1
    assert report["primary"]["P19"]["counts"]["failed"] == 1


def test_analyzer_marks_missing_receipt_promotion_as_invariant_violation() -> None:
    report = analyze_records([_start()], [_outcome(None, promoted=True)])
    assert report["primary"]["P10"]["count"] == 1
    assert report["secondary"]["S06"]["count"] == 1


def test_analyzer_rejects_tampered_and_foreign_receipts() -> None:
    receipt = _receipt()
    tampered = receipt.model_dump(mode="json")
    tampered["evidence_sha256"] = "sha256:" + "b" * 64
    report = analyze_records([_start()], [_outcome(None)], receipts=[tampered])
    assert report["primary"]["P01"]["receipt_valid_of_emitted"]["numerator"] == 0

    foreign_payload = _outcome(None).model_dump(mode="python")
    foreign_payload["parameter_application_receipt_id"] = "foreign-receipt"
    foreign = OptimizationTerminalOutcome.model_construct(**foreign_payload)
    report = analyze_records([_start()], [foreign], receipts=[receipt])
    assert report["primary"]["P08"]["foreign_candidate"] == 1


def test_analyzer_detects_shadow_duplicate_consumed_values() -> None:
    first = _receipt(receipt_id="receipt-1", requested=0.5)
    second = _receipt(receipt_id="receipt-2", requested=0.7)
    report = analyze_records([_start("i-1"), _start("i-2")], [], receipts=[first, second])
    assert report["primary"]["P14"]["shadow_duplicates"] == 1


def test_replay_fidelity_ignores_episode_specific_receipt_ids() -> None:
    row = {"knob": "place.target_density", "requested": 0.5, "written": 0.5, "consumed": 0.6, "status": "applied", "relation": "transformed"}
    from ecos_agent.optimization.experiments.rq1_execution_evidence import replay_fidelity

    result = replay_fidelity(
        {"receipt_ids": ["episode-a.receipt-1"], "receipt_semantics": [row]},
        {"receipt_ids": ["episode-b.receipt-9"], "receipt_semantics": [row]},
    )
    assert result["receipt_semantics"] == {"exact": 1, "within_band": 0, "mismatch": 0}


def test_strict_episode_analysis_fails_on_promotion_integrity_error() -> None:
    import pytest

    with pytest.raises(ValueError, match="promotion invariant"):
        analyze_records([_start()], [_outcome(None, promoted=True)], strict=True)


def test_contract_matrix_reports_missing_cases_and_markdown() -> None:
    from ecos_agent.optimization.experiments.rq1_execution_evidence import (
        build_case_matrix,
        render_case_matrix_markdown,
    )

    matrix = build_case_matrix([
        {
            "case": "exact mapping",
            "expected": {"status": "applied"},
            "observed": {"status": "applied"},
            "evidence_refs": ["fixture/exact.json"],
        }
    ])
    assert matrix["summary"]["passed"] == 1
    assert "converted" in matrix["summary"]["missing_tier_a_cases"]
    assert "| exact mapping | yes | fixture-only |" in render_case_matrix_markdown(matrix)


def test_analyze_episode_rejects_corrupt_ledger(tmp_path) -> None:
    import pytest

    (tmp_path / "optimization-outcomes.v1.jsonl").write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError):
        from ecos_agent.optimization.experiments.rq1_execution_evidence import analyze_episode
        analyze_episode(tmp_path)


def test_analyzer_rejects_stale_embedded_receipt_binding() -> None:
    receipt = _receipt()
    outcome = _outcome(receipt).model_copy(update={"receipt_sha256": "sha256:" + "b" * 64})
    report = analyze_records([_start()], [outcome])
    assert report["primary"]["P13"]["stale_receipt"] == 1
    assert report["primary"]["P19"]["counts"]["stale_receipt"] == 1
