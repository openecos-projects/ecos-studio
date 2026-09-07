from __future__ import annotations

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import RequestedKnobValue, StrategyDirection
from ecos_agent.optimization.controller import CandidateExecutionReceipt, OptimizationEpisodeController
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.planning import planning_context_payload

from .support import (
    CURRENT_VALUES,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _controller,
    _execution_context,
    _native_receipt,
    _observation,
    _proposal,
    _retrieval,
    _started,
)


def test_planner_receives_parameter_mechanisms_without_preset_probe_values(tmp_path):
    planner = _FakeCodex(_proposal)
    controller = _controller(tmp_path, planner, _FakeEcc())
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context = planner.contexts[0]
    assert {card.knob_id for card in context.parameter_knowledge} == set(CURRENT_VALUES)
    assert all(card.runtime_semantics is not None for card in context.parameter_knowledge)
    assert context.parameter_trajectories == ()
    density = next(d for d in context.effective_domains if d.knob_id == "place.target_density")
    assert density.accepts(0.71321)
    assert density.accepts(0.15)
    assert "thresholds" not in density.model_dump()
    assert "allowed_requested_values" not in density.model_dump()


@pytest.mark.parametrize("status", ("effective", "unknown"))
def test_trajectory_driven_probe_preserves_uncertainty_and_exact_model_value(tmp_path, status):
    def first(context):
        return _proposal(context, knob_id="place.target_density", direction=StrategyDirection.DECREASE,
                         requested_value=0.1, rationale_summary="Probe whether the requested density is adopted.")

    def next_probe(context):
        trajectory = context.parameter_trajectories[0]
        receipt = trajectory.parameter_application_receipt
        assert receipt.status == status
        assert receipt.requested["value"] == 0.1
        assert receipt.observation["utilization_floor"] == 0.6678301093355762
        assert trajectory.terminal_observation is None
        assert trajectory.planning_values == CURRENT_VALUES
        assert trajectory.rationale_summary == "Probe whether the requested density is adopted."
        card = next(card for card in context.parameter_knowledge if card.knob_id == "place.target_density")
        assert card.runtime_semantics.mechanism
        density = next(d for d in context.effective_domains if d.knob_id == card.knob_id)
        assert density.accepts(0.15)  # The model's hypothesis never becomes a hard bound.
        return _proposal(context, knob_id=card.knob_id, requested_value=0.71321,
                         rationale_summary="Knowledge and the observed lift suggest a possible utilization bound. Probe 0.71321; check whether the consumer uses it without another lift.")

    planner = _FakeCodex(first, next_probe)
    executor = _FakeEcc(_started("execution-1"), _started("execution-2"))
    controller = _controller(tmp_path, planner, executor)
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    payload = _native_receipt(planned.requested, effective_value=0.6678301093355762).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload.update(status=status, actual_value=0.6678301093355762 if status == "effective" else None)
    if status != "effective":
        payload["observation"]["density_operator_call_count"] = 0
    receipt = ParameterApplicationReceipt(**payload, evidence_sha256=canonical_sha256(payload))
    controller.complete_terminal(CandidateExecutionReceipt(
        execution_id="execution-1", started=True, outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
        parameter_application_receipt=receipt,
    ))

    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.requested == RequestedKnobValue(knob_id="place.target_density", value=0.71321)
    controller.execute()
    assert executor.start_calls[-1].requested == planned.requested


def test_other_parameter_clamp_is_evidence_not_a_programmed_search_limit(tmp_path):
    def next_probe(context):
        trajectory = context.parameter_trajectories[0]
        assert trajectory.requested.value == 16
        assert trajectory.parameter_application_receipt.actual_value == 5
        domain = next(d for d in context.effective_domains if d.knob_id == "place.cell_padding_x")
        assert domain.accepts(15)
        return _proposal(context, requested_value=7,
                         rationale_summary="The previous request was reduced to five sites. Probe seven to distinguish a fixed cap from context-dependent capacity.")

    planner = _FakeCodex(lambda context: _proposal(context, requested_value=16), next_probe)
    controller = _controller(tmp_path, planner, _FakeEcc(_started()))
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    controller.complete_terminal(CandidateExecutionReceipt(
        execution_id="execution-1", started=True, outcome=OptimizationOutcomeKind.DEGRADED,
        parameter_application_receipt=_native_receipt(planned.requested, effective_value=5),
    ), incumbent_decision="incumbent_retained")
    assert controller.plan(_observation(), _retrieval(), CURRENT_VALUES).requested.value == 7


def test_full_parameter_trajectory_survives_recent_history_window_and_recovery(tmp_path):
    responses = [
        lambda context, value=value: _proposal(context, requested_value=value)
        for value in range(3, 10)
    ]
    controller = _controller(tmp_path, _FakeCodex(*responses), _FakeEcc(*[
        _started(f"execution-{index}") for index in range(7)
    ]))
    for index in range(7):
        planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
        controller.execute()
        controller.complete_terminal(CandidateExecutionReceipt(
            execution_id=f"execution-{index}", started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            parameter_application_receipt=_native_receipt(planned.requested),
        ), incumbent_decision="incumbent_retained")
    planner = _FakeCodex(lambda context: _proposal(context, requested_value=11))
    recovered = OptimizationEpisodeController.recover(
        planner=planner, executor=_FakeEcc(), ledger=controller.ledger, clock=_Clock(),
        execution_context=_execution_context(),
    )
    recovered.plan(_observation(), _retrieval(), CURRENT_VALUES)
    context = planner.contexts[0]
    assert len(context.history) == 6
    assert len(context.parameter_trajectories) == 7
    payload = planning_context_payload(context)
    assert payload["parameter_trajectories"][0]["requested"]["value"] == 3
    assert payload["parameter_trajectories"][0]["parameter_application_receipt"]["actual_value"] == 3
