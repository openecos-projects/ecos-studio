from __future__ import annotations

import pytest
from pydantic import ValidationError

from ecos_agent.optimization.contracts import (
    LegalAction,
    ObjectiveMetric,
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationStrategyV4,
    StrategyStepCondition,
    StrategyStepV4,
)
from ecos_agent.optimization.strategy import (
    annotate_strategy,
    evaluate_step_condition,
    strategy_sha256,
    viable_strategy_step_count,
)


def _step(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "step_id": "step-1",
        "knob_id": "place.cell_padding_x",
        "direction": "increase",
        "requested_value": 4,
    }
    payload.update(overrides)
    return payload


def test_strategy_rejects_duplicate_step_ids() -> None:
    with pytest.raises(ValidationError, match="unique"):
        OptimizationStrategyV4(
            goal="Probe padding twice.",
            steps=(_step(), _step()),
        )


def test_strategy_rejects_dependency_cycles() -> None:
    with pytest.raises(ValidationError, match="DAG"):
        OptimizationStrategyV4(
            goal="Circular plan.",
            steps=(
                _step(step_id="a", depends_on=["b"]),
                _step(step_id="b", depends_on=["a"]),
            ),
        )


def test_strategy_rejects_unknown_dependencies() -> None:
    with pytest.raises(ValidationError, match="unknown step"):
        OptimizationStrategyV4(
            goal="Dangling plan.",
            steps=(_step(depends_on=["missing"]),),
        )


def test_strategy_rejects_direction_value_mismatch() -> None:
    with pytest.raises(ValidationError):
        StrategyStepV4.model_validate(
            _step(
                knob_id="place.routability_opt",
                direction="increase",
                requested_value=True,
            )
        )


def test_strategy_hash_is_stable_and_bound() -> None:
    strategy = OptimizationStrategyV4(
        goal="Probe then confirm.",
        steps=(_step(),),
    )

    assert strategy_sha256(strategy).startswith("sha256:")
    assert strategy_sha256(strategy) == strategy_sha256(
        OptimizationStrategyV4.model_validate(strategy.model_dump())
    )


def test_annotate_strategy_marks_attempted_and_illegal_steps() -> None:
    strategy = OptimizationStrategyV4(
        goal="Two probes.",
        steps=(
            _step(),
            _step(
                step_id="step-2",
                knob_id="place.target_density",
                direction="decrease",
                requested_value=0.3,
            ),
        ),
    )

    payload = annotate_strategy(
        strategy,
        incumbent=None,
        history=(),
        legal_actions=(
            LegalAction(
                knob_id=OptimizationKnob.CELL_PADDING_X,
                direction=StrategyDirection.INCREASE,
            ),
        ),
        attempted=(
            RequestedKnobValue(knob_id=OptimizationKnob.CELL_PADDING_X, value=4),
        ),
        parent_config_sha256="sha256:" + "a" * 64,
        current_parent_config_sha256="sha256:" + "a" * 64,
    )

    steps = payload["steps"]
    assert isinstance(steps, list)
    assert steps[0]["status"] == "attempted"
    assert steps[0]["legal"] is True
    assert steps[1]["status"] == "pending"
    assert steps[1]["legal"] is False
    assert payload["viable_step_count"] == 0
    assert payload["values_stale"] is False


def test_viable_step_count_counts_pending_legal_steps() -> None:
    strategy = OptimizationStrategyV4(
        goal="Two probes.",
        steps=(
            _step(),
            _step(
                step_id="step-2",
                knob_id="place.cell_padding_x",
                direction="decrease",
                requested_value=2,
            ),
        ),
    )

    count = viable_strategy_step_count(
        strategy,
        incumbent=None,
        history=(),
        legal_actions=(
            LegalAction(
                knob_id=OptimizationKnob.CELL_PADDING_X,
                direction=StrategyDirection.INCREASE,
            ),
            LegalAction(
                knob_id=OptimizationKnob.CELL_PADDING_X,
                direction=StrategyDirection.DECREASE,
            ),
        ),
        attempted=(
            RequestedKnobValue(knob_id=OptimizationKnob.CELL_PADDING_X, value=4),
        ),
    )

    assert count == 1


def test_viable_step_count_is_zero_without_strategy() -> None:
    assert (
        viable_strategy_step_count(
            None, incumbent=None, history=(), legal_actions=(), attempted=()
        )
        == 0
    )


def test_condition_evaluation_resolves_from_recent_history() -> None:
    from ecos_agent.hashing import canonical_sha256
    from ecos_agent.optimization.contracts import (
        ExpectedEffect,
        ExpectedEffectDirection,
        HistoryReference,
        OptimizationOutcomeKind,
        ProposalAction,
    )
    from ecos_agent.optimization.planning import OptimizationHistory
    from .controller.support import _eligible_terminal

    overflow_key = ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    incumbent = _eligible_terminal().model_copy(
        update={
            "metrics": {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
                overflow_key: 10.0,
                ObjectiveMetric.ROUTE_WIRELENGTH: 100,
            }
        }
    )
    candidate = _eligible_terminal().model_copy(
        update={
            "metrics": {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
                overflow_key: 4.0,
                ObjectiveMetric.ROUTE_WIRELENGTH: 100,
            }
        }
    )
    history = (
        OptimizationHistory(
            reference=HistoryReference(
                intervention_id="intervention-1",
                outcome_sha256=canonical_sha256({"probe": 1}),
            ),
            outcome=OptimizationOutcomeKind.TRADEOFF,
            action=ProposalAction(
                knob_id=OptimizationKnob.CELL_PADDING_X,
                direction=StrategyDirection.INCREASE,
                expected_effects=(
                    ExpectedEffect(
                        metric_id=overflow_key,
                        direction=ExpectedEffectDirection.DECREASE,
                    ),
                ),
            ),
            requested=RequestedKnobValue(
                knob_id=OptimizationKnob.CELL_PADDING_X, value=3
            ),
            terminal_observation=candidate,
            incumbent_decision="incumbent_retained",
        ),
    )

    improved = StrategyStepCondition(
        metric_id=overflow_key, expects="improved"
    )
    degraded = StrategyStepCondition(
        metric_id=overflow_key, expects="degraded"
    )

    assert (
        evaluate_step_condition(improved, history=history, incumbent=incumbent)
        == "satisfied"
    )
    assert (
        evaluate_step_condition(degraded, history=history, incumbent=incumbent)
        == "unsatisfied"
    )


def test_condition_evaluation_is_unknown_without_baseline() -> None:
    condition = StrategyStepCondition(
        metric_id=ObjectiveMetric.ROUTE_WIRELENGTH, expects="improved"
    )

    assert (
        evaluate_step_condition(condition, history=(), incumbent=None)
        == "unknown"
    )
