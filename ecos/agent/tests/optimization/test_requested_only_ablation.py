"""RQ1 system-level ablation: the requested-only arm drops the receipt gate."""

from __future__ import annotations

from tests.optimization.controller.support import _native_receipt
from tests.optimization.test_objective_alignment import _objective, _terminal

from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationOutcomeKind,
    RequestedKnobValue,
)
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.rules import (
    IncumbentComparison,
    IncumbentDecision,
    classify_terminal_candidate,
    freeze_routability_objective,
    terminal_candidate_is_promotable,
)


def _requested() -> RequestedKnobValue:
    return RequestedKnobValue(
        knob_id=OptimizationKnob.TARGET_DENSITY, value=0.65
    )


def _inactive_receipt():
    return _native_receipt(_requested()).model_copy(
        update={
            "status": "inactive",
            "actual_value": None,
            "reason": "knob did not reach the native consumer",
        }
    )


def _classification(parameter_receipt, *, receipt_aware_planning: bool):
    objective = _objective()
    baseline = _terminal()
    candidate = _terminal(wirelength=90)
    alignment = build_objective_alignment(objective, baseline)
    return classify_terminal_candidate(
        execution_outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        candidate=candidate,
        incumbent=baseline,
        objective=freeze_routability_objective(
            baseline, objective_alignment=alignment
        ),
        semantic_objective=objective,
        objective_alignment=alignment,
        baseline_geometry=baseline.geometry,
        requested=_requested(),
        parameter_receipt=parameter_receipt,
        receipt_aware_planning=receipt_aware_planning,
    )


def test_requested_only_arm_promotes_an_inactive_receipt_candidate() -> None:
    result = _classification(_inactive_receipt(), receipt_aware_planning=False)
    assert result.comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert result.promote is True


def test_requested_only_arm_promotes_without_any_receipt() -> None:
    result = _classification(None, receipt_aware_planning=False)
    assert result.comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert result.promote is True


def test_receipt_aware_arm_still_rejects_inactive_or_missing_receipt() -> None:
    for receipt in (_inactive_receipt(), None):
        result = _classification(receipt, receipt_aware_planning=True)
        assert result.comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
        assert result.promote is False


def test_promotable_gate_switches_with_the_ablation_flag() -> None:
    common = dict(
        execution_outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        candidate=_terminal(wirelength=90),
        comparison=IncumbentComparison(
            IncumbentDecision.CANDIDATE_BETTER, ObjectiveMetric.ROUTE_WIRELENGTH
        ),
        requested=_requested(),
    )
    inactive = _inactive_receipt()
    assert terminal_candidate_is_promotable(
        **common,
        parameter_receipt=inactive,
        receipt_aware_planning=False,
    )
    assert not terminal_candidate_is_promotable(
        **common,
        parameter_receipt=inactive,
        receipt_aware_planning=True,
    )
    assert not terminal_candidate_is_promotable(
        **common,
        parameter_receipt=None,
        receipt_aware_planning=True,
    )
