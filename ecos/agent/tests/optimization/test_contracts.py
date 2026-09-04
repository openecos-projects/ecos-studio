import pytest
from pydantic import ValidationError

from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationObjectiveContract,
    OptimizationObjectiveProposal,
    OptimizationProposal,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StageObservation,
    StrategyDirection,
)
from ecos_agent.optimization.rules import freeze_optimization_objective

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


def _budget() -> EpisodeBudget:
    return EpisodeBudget.from_reference_rerun(11.0)


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


def test_budget_is_frozen_from_one_reference_rerun() -> None:
    budget = _budget()

    assert budget.schema_version == "ecos.optimization_budget.v5"
    assert budget.candidate_execution_limit == 20
    assert budget.minimum_candidate_executions == budget.candidate_execution_limit
    assert budget.planning_call_limit == 60
    assert budget.reference_place_to_harden_seconds == 11.0
    assert budget.wall_time_limit_seconds == 242.0
    assert BudgetSnapshot(
        budget=budget, consumed_candidates=20, consumed_planning_calls=60
    ).exhausted


def test_budget_rejects_a_noncanonical_wall_time_limit() -> None:
    with pytest.raises(ValidationError, match="22 times"):
        EpisodeBudget(
            reference_place_to_harden_seconds=11.0,
            wall_time_limit_seconds=80.0,
        )


def test_budget_reports_remaining_wall_time() -> None:
    snapshot = BudgetSnapshot(
        budget=EpisodeBudget.from_reference_rerun(11.0),
        elapsed_wall_time_seconds=20.0,
    )

    assert snapshot.remaining_wall_time_seconds == 222.0


def test_stage_observation_is_typed_and_carries_remaining_budget() -> None:
    observation = StageObservation(
        observation_id="observation-1",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        requested_knobs=[RequestedKnobValue(knob_id="place.cell_padding_x", value=2)],
        budget=BudgetSnapshot(budget=_budget(), consumed_candidates=1, consumed_planning_calls=2),
    )

    assert observation.budget.remaining_candidates == 19
    assert observation.budget.remaining_planning_calls == 58


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


def test_natural_language_objective_is_frozen_with_required_signoff_gates() -> None:
    proposal = OptimizationObjectiveProposal(
        primary_metric=ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
        preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
        rationale_summary="Reduce global routing overflow without increasing DRC pressure.",
    )

    contract = freeze_optimization_objective("optimize congestion", proposal)

    assert contract.source_goal_sha256.startswith("sha256:")
    assert contract.primary_metric == ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    assert contract.preserve_metrics == (ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,)
    assert contract.required_signoff_gates == (
        "drc_clean",
        "lvs_clean",
        "rcx_corner_coverage",
        "rcx_spef_parse_health",
        "sta_setup_closed",
        "sta_hold_closed",
    )


@pytest.mark.parametrize(
    "metric",
    [
        ObjectiveMetric.DIE_AREA,
        ObjectiveMetric.CORE_AREA,
        ObjectiveMetric.SYNTHESIS_CELL_AREA,
        ObjectiveMetric.STA_STANDARD_CELL_AREA,
        ObjectiveMetric.STA_SETUP_WNS,
        ObjectiveMetric.STA_SETUP_TNS,
        ObjectiveMetric.STA_HOLD_WNS,
        ObjectiveMetric.STA_HOLD_TNS,
        ObjectiveMetric.STA_TYPICAL_DYNAMIC_POWER,
        ObjectiveMetric.STA_TYPICAL_LEAKAGE_POWER,
        ObjectiveMetric.STA_WORST_DYNAMIC_POWER,
        ObjectiveMetric.STA_WORST_LEAKAGE_POWER,
        ObjectiveMetric.GUI_OVERALL_QOR_SCORE,
    ],
)
def test_terminal_metrics_are_allowed_objectives(metric: ObjectiveMetric) -> None:
    proposal = OptimizationObjectiveProposal(
        primary_metric=metric,
        rationale_summary=f"Reduce {metric.value}.",
    )

    assert proposal.primary_metric == metric


def test_drc_goal_is_locally_bound_to_detail_route_violations() -> None:
    contract = freeze_optimization_objective(
        "reduce routed wirelength while preserving DRC and timing",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            rationale_summary="Reduce wirelength without DRC or timing regressions.",
        ),
    )

    assert contract.preserve_metrics == (
        ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
    )
    assert contract.contract_sha256.startswith("sha256:")
    assert OptimizationObjectiveContract.model_validate(contract.model_dump()) == contract


def test_natural_language_objective_rejects_primary_preserve_overlap() -> None:
    with pytest.raises(ValidationError, match="primary metric"):
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.ROUTE_WIRELENGTH,),
            rationale_summary="Invalid overlap.",
        )


def test_requested_lattice_uses_logical_padding_sites() -> None:
    assert RequestedKnobValue(knob_id="place.target_density", value=0.15).value == 0.15
    assert RequestedKnobValue(knob_id="place.target_overflow", value=0.08).value == 0.08
    assert RequestedKnobValue(knob_id="place.cell_padding_x", value=3).value == 3
    assert RequestedKnobValue(knob_id="place.routability_opt", value=True).value is True
    assert RequestedKnobValue(knob_id="place.density_weight", value=0.00085).value == 0.00085
    assert RequestedKnobValue(knob_id="floorplan.core_util", value=0.6).value == 0.6
    assert RequestedKnobValue(knob_id="floorplan.aspect_ratio", value=1.33).value == 1.33

    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.target_density", value=0.12)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.cell_padding_x", value=9)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.routability_opt", value="true")
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.target_overflow", value=0.111)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.density_weight", value=0.0008)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="floorplan.core_util", value=0.475)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="floorplan.aspect_ratio", value=1.25)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="cts.max_fanout", value=32)
