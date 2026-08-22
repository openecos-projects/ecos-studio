import pytest
from pydantic import ValidationError

from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffect,
    GateResult,
    KnobApplicationReceipt,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    RoutabilityObjectiveContract,
    RuntimeAdjustment,
    SignoffGates,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization_rules import (
    IncumbentDecision,
    compare_incumbent,
    freeze_routability_objective,
    next_coordinate_selection,
)


HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


def _budget() -> EpisodeBudget:
    return EpisodeBudget.from_default_reruns((10.0, 12.0, 11.0))


def _terminal(
    observation_id: str,
    *,
    dr: int,
    overflow: int,
    wirelength: float,
    signoff: GateResult = GateResult.PASS,
    evidence_valid: bool = True,
    harden_artifacts_complete: bool = True,
) -> TerminalObservation:
    return TerminalObservation(
        observation_id=observation_id,
        evidence_manifest_sha256=HASH,
        evidence_valid=evidence_valid,
        harden_artifacts_complete=harden_artifacts_complete,
        signoff_gates=SignoffGates.all(signoff),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: dr,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
        },
    )


def _objective() -> RoutabilityObjectiveContract:
    return freeze_routability_objective(
        {
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: (8, 9, 10),
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: (15, 15, 15),
            ObjectiveMetric.ROUTE_WIRELENGTH: (100.0, 102.0, 101.0),
        }
    )


def _proposal(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "context_ref": {
            "episode_id": "episode-1",
            "checkpoint_id": "checkpoint-1",
            "input_sha256": HASH,
        },
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": "Observed terminal routing violations remain above the baseline.",
        "observation_refs": [{"observation_id": "observation-1", "sha256": HASH}],
        "history_refs": [],
        "knowledge_refs": [{"entity_id": "strategy.congestion.padding.v1", "chunk_sha256": CHUNK_HASH}],
        "action": {
            "knob_id": "place.target_density",
            "direction": StrategyDirection.DECREASE,
            "expected_effects": [
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": "decrease",
                }
            ],
        },
    }
    payload.update(overrides)
    return payload


def test_budget_is_frozen_from_three_default_reruns() -> None:
    budget = _budget()

    assert budget.candidate_execution_limit == 6
    assert budget.planning_call_limit == 18
    assert budget.default_place_to_harden_seconds == (10.0, 12.0, 11.0)
    assert budget.wall_time_limit_seconds == 88.0
    assert BudgetSnapshot(budget=budget, consumed_candidates=6, consumed_planning_calls=18).exhausted


def test_budget_rejects_a_noncanonical_wall_time_limit() -> None:
    with pytest.raises(ValidationError, match="8 times"):
        EpisodeBudget(
            default_place_to_harden_seconds=(10.0, 12.0, 11.0),
            wall_time_limit_seconds=80.0,
        )


def test_budget_reports_remaining_wall_time() -> None:
    snapshot = BudgetSnapshot(
        budget=EpisodeBudget.from_default_reruns((10.0, 12.0, 11.0)),
        elapsed_wall_time_seconds=20.0,
    )

    assert snapshot.remaining_wall_time_seconds == 68.0


def test_stage_observation_is_typed_and_carries_remaining_budget() -> None:
    observation = StageObservation(
        observation_id="observation-1",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        requested_knobs=[RequestedKnobValue(knob_id="place.cell_padding_x", value=2)],
        budget=BudgetSnapshot(budget=_budget(), consumed_candidates=1, consumed_planning_calls=2),
    )

    assert observation.budget.remaining_candidates == 5
    assert observation.budget.remaining_planning_calls == 16


def test_proposal_requires_one_action_only_for_propose() -> None:
    proposal = OptimizationProposal.model_validate(_proposal())

    assert proposal.action is not None
    assert proposal.action.knob_id == "place.target_density"

    with pytest.raises(ValidationError, match="requires an action"):
        OptimizationProposal.model_validate(_proposal(action=None))

    with pytest.raises(ValidationError, match="cannot contain an action"):
        OptimizationProposal.model_validate(
            _proposal(decision=OptimizationDecision.CONTINUE, action=_proposal()["action"])
        )


def test_proposal_rejects_numeric_and_direction_mismatches() -> None:
    with pytest.raises(ValidationError):
        OptimizationProposal.model_validate(_proposal(confidence=0.9))

    invalid_action = dict(_proposal()["action"])
    invalid_action["direction"] = StrategyDirection.ENABLE
    with pytest.raises(ValidationError, match="numeric knobs"):
        OptimizationProposal.model_validate(_proposal(action=invalid_action))


def test_proposal_binds_context_and_stable_knowledge_refs() -> None:
    proposal = OptimizationProposal.model_validate(_proposal())

    assert proposal.context_ref == ProposalContextRef(
        episode_id="episode-1", checkpoint_id="checkpoint-1", input_sha256=HASH
    )
    assert proposal.observation_refs == (ObservationReference(observation_id="observation-1", sha256=HASH),)
    assert proposal.knowledge_refs == (
        KnowledgeReference(entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH),
    )

    with pytest.raises(ValidationError, match="hash"):
        OptimizationProposal.model_validate(
            _proposal(context_ref={"episode_id": "episode-1", "checkpoint_id": "checkpoint-1", "input_sha256": "old"})
        )


def test_requested_lattice_uses_logical_padding_sites() -> None:
    assert RequestedKnobValue(knob_id="place.target_density", value=0.15).value == 0.15
    assert RequestedKnobValue(knob_id="place.cell_padding_x", value=3).value == 3
    assert RequestedKnobValue(knob_id="place.routability_opt", value=True).value is True

    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.target_density", value=0.12)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.cell_padding_x", value=4)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.routability_opt", value="true")


def test_knob_receipt_binds_requested_written_and_runtime_effective_values() -> None:
    receipt = KnobApplicationReceipt(
        receipt_id="receipt-1",
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=2),
        written=AppliedKnobValue(knob_id="place.cell_padding_x", value=400),
        effective_initial=AppliedKnobValue(knob_id="place.cell_padding_x", value=400),
        runtime_adjustments=(
            RuntimeAdjustment(
                effective_value=AppliedKnobValue(knob_id="place.cell_padding_x", value=200),
                reason="capacity_cap",
                evidence_sha256=HASH,
            ),
        ),
        effective_final=AppliedKnobValue(knob_id="place.cell_padding_x", value=200),
        evidence_sha256=HASH,
    )

    assert receipt.effective_final.value == 200

    with pytest.raises(ValidationError, match="final value"):
        invalid_receipt = receipt.model_dump()
        invalid_receipt["effective_final"] = AppliedKnobValue(
            knob_id="place.cell_padding_x", value=400
        )
        KnobApplicationReceipt.model_validate(invalid_receipt)


def test_knob_receipt_rejects_a_mismatched_runtime_knob() -> None:
    with pytest.raises(ValidationError, match="knob ids"):
        KnobApplicationReceipt(
            receipt_id="receipt-1",
            requested=RequestedKnobValue(knob_id="place.target_density", value=0.2),
            written=AppliedKnobValue(knob_id="place.target_density", value=0.2),
            effective_initial=AppliedKnobValue(knob_id="place.target_density", value=0.2),
            runtime_adjustments=(
                RuntimeAdjustment(
                    effective_value=AppliedKnobValue(knob_id="place.cell_padding_x", value=200),
                    reason="wrong_knob",
                    evidence_sha256=HASH,
                ),
            ),
            effective_final=AppliedKnobValue(knob_id="place.target_density", value=0.2),
            evidence_sha256=HASH,
        )


def test_coordinate_search_selects_nearest_untried_density_value() -> None:
    selection = next_coordinate_selection(
        current_values={
            "place.target_density": 0.47,
            "place.cell_padding_x": 2,
            "place.routability_opt": True,
        },
        attempted=(),
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.45)
    assert selection.next_action_index == 1


def test_coordinate_search_skips_attempted_and_known_aliases_without_reordering() -> None:
    selection = next_coordinate_selection(
        current_values={
            "place.target_density": 0.5,
            "place.cell_padding_x": 1,
            "place.routability_opt": False,
        },
        attempted=(RequestedKnobValue(knob_id="place.target_density", value=0.45),),
        known_aliases=(RequestedKnobValue(knob_id="place.target_density", value=0.4),),
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.35)
    assert selection.next_action_index == 1


def test_coordinate_search_toggles_a_boolean_only_once() -> None:
    current = {
        "place.target_density": 0.1,
        "place.cell_padding_x": 0,
        "place.routability_opt": False,
    }
    selection = next_coordinate_selection(current_values=current, attempted=(), start_action_index=4)

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.routability_opt", value=True)
    all_numeric_values = tuple(
        RequestedKnobValue(knob_id="place.target_density", value=value)
        for value in (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95)
    ) + tuple(
        RequestedKnobValue(knob_id="place.cell_padding_x", value=value) for value in range(4)
    )
    assert (
        next_coordinate_selection(
            current_values=current,
            attempted=(*all_numeric_values, selection.requested),
            start_action_index=4,
        )
        is None
    )


def test_coordinate_search_returns_none_when_the_lattice_is_exhausted() -> None:
    requests = tuple(
        RequestedKnobValue(knob_id="place.target_density", value=value)
        for value in (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95)
    ) + tuple(
        RequestedKnobValue(knob_id="place.cell_padding_x", value=value) for value in range(4)
    ) + (RequestedKnobValue(knob_id="place.routability_opt", value=False),)

    assert (
        next_coordinate_selection(
            current_values={
                "place.target_density": 0.5,
                "place.cell_padding_x": 2,
                "place.routability_opt": True,
            },
            attempted=requests,
        )
        is None
    )


def test_coordinate_search_rejects_missing_or_invalid_current_values() -> None:
    with pytest.raises(ValueError, match="missing"):
        next_coordinate_selection(
            current_values={"place.target_density": 0.5},
            attempted=(),
        )

    with pytest.raises(ValueError, match="site count"):
        next_coordinate_selection(
            current_values={
                "place.target_density": 0.5,
                "place.cell_padding_x": 400,
                "place.routability_opt": True,
            },
            attempted=(),
        )


def test_noise_bands_are_derived_from_all_three_default_replays() -> None:
    objective = _objective()

    assert objective.noise_band(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT) == 2
    assert objective.noise_band(ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW) == 0
    assert objective.noise_band(ObjectiveMetric.ROUTE_WIRELENGTH) == 2

    with pytest.raises(ValueError, match="three"):
        freeze_routability_objective(
            {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: (8, 9),
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: (15, 15, 15),
                ObjectiveMetric.ROUTE_WIRELENGTH: (100.0, 102.0, 101.0),
            }
        )


def test_comparator_prioritizes_detail_route_violations() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=10, overflow=2, wirelength=100),
        candidate=_terminal("candidate", dr=7, overflow=0, wirelength=90),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT


def test_comparator_does_not_trade_detail_route_violations_for_overflow() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=5, overflow=20, wirelength=100),
        candidate=_terminal("candidate", dr=9, overflow=0, wirelength=90),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT


def test_comparator_uses_next_metric_only_inside_noise_band() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=10, overflow=9, wirelength=105),
        candidate=_terminal("candidate", dr=8, overflow=7, wirelength=100),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW


def test_comparator_keeps_incumbent_on_noise_tie() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=10, overflow=10, wirelength=100),
        candidate=_terminal("candidate", dr=9, overflow=10, wirelength=101),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.NOISE_TIE
    assert comparison.decisive_metric is None


def test_comparator_never_promotes_an_invalid_terminal() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=10, overflow=10, wirelength=100),
        candidate=_terminal("candidate", dr=0, overflow=0, wirelength=1, signoff=GateResult.FAIL),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    assert comparison.decisive_metric is None


def test_comparator_rejects_an_invalid_incumbent() -> None:
    with pytest.raises(ValueError, match="incumbent"):
        compare_incumbent(
            incumbent=_terminal("incumbent", dr=10, overflow=10, wirelength=100, evidence_valid=False),
            candidate=_terminal("candidate", dr=0, overflow=0, wirelength=1),
            objective=_objective(),
        )
