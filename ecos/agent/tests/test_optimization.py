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
    OptimizationObjectiveContract,
    OptimizationObjectiveProposal,
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
    TimingMetric,
)
from ecos_agent.optimization_rules import (
    IncumbentDecision,
    compare_incumbent,
    freeze_optimization_objective,
    freeze_routability_objective,
    next_coordinate_selection,
    legal_actions,
)


HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


def _budget() -> EpisodeBudget:
    return EpisodeBudget.from_reference_rerun(11.0)


def _terminal(
    observation_id: str,
    *,
    dr: int,
    overflow: int,
    wirelength: float,
    signoff: GateResult = GateResult.PASS,
    evidence_valid: bool = True,
    harden_artifacts_complete: bool = True,
    timing: dict[TimingMetric, float] | None = None,
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
        timing_guardrail=timing
        or {
            TimingMetric.STA_SETUP_WNS: 1.0,
            TimingMetric.STA_SETUP_TNS: 0.0,
            TimingMetric.STA_HOLD_WNS: 0.5,
            TimingMetric.STA_HOLD_TNS: 0.0,
        },
    )


def _objective() -> RoutabilityObjectiveContract:
    return freeze_routability_objective(
        _terminal(
            "baseline",
            dr=9,
            overflow=15,
            wirelength=101.0,
            timing={
                TimingMetric.STA_SETUP_WNS: 0.9,
                TimingMetric.STA_SETUP_TNS: -0.05,
                TimingMetric.STA_HOLD_WNS: 0.45,
                TimingMetric.STA_HOLD_TNS: 0.0,
            },
        )
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


def test_budget_is_frozen_from_one_reference_rerun() -> None:
    budget = _budget()

    assert budget.schema_version == "ecos.optimization_budget.v4"
    assert budget.candidate_execution_limit == 6
    assert budget.minimum_candidate_executions == budget.candidate_execution_limit
    assert budget.planning_call_limit == 18
    assert budget.reference_place_to_harden_seconds == 11.0
    assert budget.wall_time_limit_seconds == 88.0
    assert BudgetSnapshot(budget=budget, consumed_candidates=6, consumed_planning_calls=18).exhausted


def test_budget_rejects_a_noncanonical_wall_time_limit() -> None:
    with pytest.raises(ValidationError, match="8 times"):
        EpisodeBudget(
            reference_place_to_harden_seconds=11.0,
            wall_time_limit_seconds=80.0,
        )


def test_budget_reports_remaining_wall_time() -> None:
    snapshot = BudgetSnapshot(
        budget=EpisodeBudget.from_reference_rerun(11.0),
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


def test_coordinate_search_bisects_the_largest_unexplored_density_interval() -> None:
    selection = next_coordinate_selection(
        current_values={
            "place.target_density": 0.47,
            "place.cell_padding_x": 2,
            "place.routability_opt": True,
        },
        attempted=(),
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.3)
    assert selection.next_action_index == 1


def test_coordinate_search_uses_attempted_and_alias_values_to_refine_the_interval() -> None:
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
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.25)
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


def test_legal_actions_exclude_only_noop_directions() -> None:
    actions = legal_actions(
        current_values={
            "place.target_density": 0.2,
            "place.cell_padding_x": 1.5,
            "place.routability_opt": True,
        },
        attempted=(),
    )

    assert [(item.knob_id.value, item.direction.value) for item in actions] == [
        ("place.target_density", "decrease"),
        ("place.target_density", "increase"),
        ("place.cell_padding_x", "decrease"),
        ("place.cell_padding_x", "increase"),
        ("place.routability_opt", "disable"),
    ]

    with pytest.raises(ValueError, match="site count"):
        next_coordinate_selection(
            current_values={
                "place.target_density": 0.5,
                "place.cell_padding_x": 400,
                "place.routability_opt": True,
            },
            attempted=(),
        )


def test_objective_is_frozen_from_one_parent_terminal_observation() -> None:
    objective = _objective()

    assert objective.reference_value(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT) == 9
    assert objective.reference_value(ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW) == 15
    assert objective.reference_value(ObjectiveMetric.ROUTE_WIRELENGTH) == 101
    assert objective.timing_guardrail.reference_value(TimingMetric.STA_SETUP_WNS) == pytest.approx(
        0.9
    )

    with pytest.raises(ValueError, match="eligible"):
        freeze_routability_objective(
            _terminal(
                "ineligible-baseline",
                dr=0,
                overflow=0,
                wirelength=0,
                signoff=GateResult.FAIL,
            )
        )


def test_comparator_rejects_any_timing_regression() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=0, overflow=0, wirelength=100),
        candidate=_terminal(
            "candidate",
            dr=0,
            overflow=0,
            wirelength=90,
            timing={
                TimingMetric.STA_SETUP_WNS: 0.7,
                TimingMetric.STA_SETUP_TNS: 0.0,
                TimingMetric.STA_HOLD_WNS: 0.5,
                TimingMetric.STA_HOLD_TNS: 0.0,
            },
        ),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert comparison.decisive_metric == TimingMetric.STA_SETUP_WNS


def test_semantic_objective_preserves_guardrails_before_primary_metric() -> None:
    semantic = freeze_optimization_objective(
        "reduce wirelength while preserving detail route violations",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
            rationale_summary="Prefer wirelength only if DRC does not regress.",
        ),
    )

    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=1, overflow=10, wirelength=100),
        candidate=_terminal("candidate", dr=4, overflow=10, wirelength=80),
        objective=_objective(),
        semantic_objective=semantic,
    )

    assert comparison.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT

    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=1, overflow=10, wirelength=100),
        candidate=_terminal("candidate", dr=1, overflow=10, wirelength=80),
        objective=_objective(),
        semantic_objective=semantic,
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_WIRELENGTH


def test_comparator_accepts_unchanged_timing_before_route_improvement() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=0, overflow=0, wirelength=100),
        candidate=_terminal(
            "candidate",
            dr=0,
            overflow=0,
            wirelength=90,
            timing={
                TimingMetric.STA_SETUP_WNS: 1.0,
                TimingMetric.STA_SETUP_TNS: 0.0,
                TimingMetric.STA_HOLD_WNS: 0.5,
                TimingMetric.STA_HOLD_TNS: 0.0,
            },
        ),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_WIRELENGTH


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


def test_comparator_uses_first_improved_metric() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=10, overflow=9, wirelength=105),
        candidate=_terminal("candidate", dr=8, overflow=7, wirelength=100),
        objective=_objective(),
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT


def test_comparator_keeps_incumbent_on_exact_tie() -> None:
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=10, overflow=10, wirelength=100),
        candidate=_terminal("candidate", dr=10, overflow=10, wirelength=100),
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


@pytest.mark.parametrize(
    "field",
    [
        "drc_clean",
        "lvs_clean",
        "rcx_corner_coverage",
        "rcx_spef_parse_health",
        "sta_setup_closed",
        "sta_hold_closed",
    ],
)
def test_required_signoff_gate_cannot_be_not_applicable(field: str) -> None:
    values = SignoffGates.all(GateResult.PASS).model_dump()
    values[field] = GateResult.NOT_APPLICABLE

    with pytest.raises(ValidationError, match="required signoff gates"):
        SignoffGates.model_validate(values)


def test_optional_mpc_signoff_gates_can_be_not_applicable() -> None:
    gates = SignoffGates.all(GateResult.PASS).model_copy(
        update={
            "mpc_minimum_area": GateResult.NOT_APPLICABLE,
            "mpc_maximum_area": GateResult.NOT_APPLICABLE,
        }
    )

    assert gates.passed is True
