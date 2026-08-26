import pytest
from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
    BudgetSnapshot,
    EpisodeBudget,
    GateResult,
    KnobApplicationReceipt,
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
    coordinate_value_from_receipt,
    freeze_optimization_objective,
    freeze_routability_objective,
    legal_actions,
    next_coordinate_selection,
)
from pydantic import ValidationError

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


def _expanded_current(**overrides: object) -> dict[str, object]:
    return {
        "place.target_density": 0.5,
        "place.target_overflow": 0.1,
        "place.cell_padding_x": 2,
        "place.routability_opt": True,
        "place.density_weight": 0.00085,
        "floorplan.core_util": 0.6,
        "floorplan.aspect_ratio": 1.0,
        "synth.max_fanout": 32,
        **overrides,
    }


def _all_requested_values() -> tuple[RequestedKnobValue, ...]:
    lattices = {
        "place.target_density": tuple(round(0.1 + 0.05 * index, 2) for index in range(18)),
        "place.target_overflow": (0.06, 0.07, 0.08, 0.09, 0.1),
        "place.cell_padding_x": (0, 1, 2, 3),
        "place.routability_opt": (False, True),
        "place.density_weight": (0.0001, 0.00025, 0.0005, 0.00085, 0.001, 0.0025, 0.005),
        "floorplan.core_util": (0.4, 0.5, 0.6, 0.7, 0.8),
        "floorplan.aspect_ratio": (0.5, 0.75, 1.0, 1.33, 2.0),
        "synth.max_fanout": (8, 16, 20, 24, 32, 48, 64),
    }
    return tuple(
        RequestedKnobValue(knob_id=knob_id, value=value)
        for knob_id, values in lattices.items()
        for value in values
    )


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
    assert RequestedKnobValue(knob_id="synth.max_fanout", value=32).value == 32

    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.target_density", value=0.12)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.cell_padding_x", value=4)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.routability_opt", value="true")
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.target_overflow", value=0.11)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="place.density_weight", value=0.0008)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="floorplan.core_util", value=0.45)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="floorplan.aspect_ratio", value=1.5)
    with pytest.raises(ValidationError):
        RequestedKnobValue(knob_id="synth.max_fanout", value=30)


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
    assert coordinate_value_from_receipt(receipt, site_width_dbu=200) == 1

    with pytest.raises(ValidationError, match="final value"):
        invalid_receipt = receipt.model_dump()
        invalid_receipt["effective_final"] = AppliedKnobValue(
            knob_id="place.cell_padding_x", value=400
        )
        KnobApplicationReceipt.model_validate(invalid_receipt)


def test_density_weight_receipt_keeps_the_requested_search_coordinate() -> None:
    receipt = KnobApplicationReceipt(
        receipt_id="receipt-1",
        requested=RequestedKnobValue(knob_id="place.density_weight", value=0.001),
        written=AppliedKnobValue(knob_id="place.density_weight", value=0.001),
        effective_initial=AppliedKnobValue(
            knob_id="place.density_weight", value=4.884961e-07
        ),
        runtime_adjustments=(
            RuntimeAdjustment(
                effective_value=AppliedKnobValue(
                    knob_id="place.density_weight", value=0.0817526
                ),
                reason="adaptive update",
                evidence_sha256=HASH,
            ),
        ),
        effective_final=AppliedKnobValue(
            knob_id="place.density_weight", value=0.0817526
        ),
        evidence_sha256=HASH,
    )

    assert coordinate_value_from_receipt(receipt, site_width_dbu=200) == 0.001


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
        current_values=_expanded_current(**{"place.target_density": 0.47}),
        attempted=(),
        start_action_index=6,
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.3)
    assert selection.next_action_index == 7


def test_coordinate_search_uses_attempted_and_alias_values_to_refine_the_interval() -> None:
    selection = next_coordinate_selection(
        current_values=_expanded_current(
            **{"place.cell_padding_x": 1, "place.routability_opt": False}
        ),
        attempted=(RequestedKnobValue(knob_id="place.target_density", value=0.45),),
        known_aliases=(RequestedKnobValue(knob_id="place.target_density", value=0.4),),
        start_action_index=6,
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.25)
    assert selection.next_action_index == 7


def test_coordinate_search_toggles_a_boolean_only_once() -> None:
    current = _expanded_current(
        **{
            "place.target_density": 0.1,
            "place.target_overflow": 0.06,
            "place.cell_padding_x": 0,
            "place.routability_opt": False,
        }
    )
    selection = next_coordinate_selection(current_values=current, attempted=(), start_action_index=12)

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.routability_opt", value=True)
    assert (
        next_coordinate_selection(
            current_values=current,
            attempted=_all_requested_values(),
            start_action_index=6,
        )
        is None
    )


def test_coordinate_search_returns_none_when_the_lattice_is_exhausted() -> None:
    assert (
        next_coordinate_selection(
            current_values=_expanded_current(),
            attempted=_all_requested_values(),
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
        current_values=_expanded_current(
            **{"place.target_density": 0.2, "place.cell_padding_x": 1.5}
        ),
        attempted=(),
    )

    assert [(item.knob_id.value, item.direction.value) for item in actions] == [
        ("floorplan.core_util", "decrease"),
        ("floorplan.core_util", "increase"),
        ("floorplan.aspect_ratio", "decrease"),
        ("floorplan.aspect_ratio", "increase"),
        ("synth.max_fanout", "decrease"),
        ("synth.max_fanout", "increase"),
        ("place.target_density", "decrease"),
        ("place.target_density", "increase"),
        ("place.target_overflow", "decrease"),
        ("place.cell_padding_x", "decrease"),
        ("place.cell_padding_x", "increase"),
        ("place.routability_opt", "disable"),
        ("place.density_weight", "decrease"),
        ("place.density_weight", "increase"),
    ]

    with pytest.raises(ValueError, match="site count"):
        next_coordinate_selection(
            current_values=_expanded_current(**{"place.cell_padding_x": 400}),
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


def test_legacy_terminal_observation_dump_excludes_v3_defaults() -> None:
    payload = _terminal("legacy", dr=0, overflow=0, wirelength=100).model_dump(mode="json")

    assert payload["schema_version"] == "ecos.terminal_observation.v2"
    assert "evaluation_metrics" not in payload
    assert "evaluation_metrics_complete" not in payload
    assert "sta_corner_ids" not in payload
    assert "sta_corner_set_sha256" not in payload


def test_legacy_terminal_observation_rejects_v3_metrics() -> None:
    payload = _terminal("legacy", dr=0, overflow=0, wirelength=100).model_dump(mode="json")
    payload["evaluation_metrics"] = [
        {
            "metric_id": "drc_count",
            "value": 1,
            "unit": "count",
            "category": "eligibility",
            "role": "gate",
            "direction": "exact",
            "source_refs": ["drc_ecc/analysis/qor_metrics.json"],
        }
    ]

    with pytest.raises(ValidationError, match="v3 fields"):
        TerminalObservation.model_validate(payload)


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


def test_comparator_allows_one_percent_timing_and_preserve_metric_noise() -> None:
    semantic = freeze_optimization_objective(
        "reduce wirelength while preserving DRC and timing",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
            rationale_summary="Keep DRC and timing within tolerance.",
        ),
    )
    comparison = compare_incumbent(
        incumbent=_terminal(
            "incumbent",
            dr=100,
            overflow=10,
            wirelength=100,
            timing={
                TimingMetric.STA_SETUP_WNS: 1.0,
                TimingMetric.STA_SETUP_TNS: 0.0,
                TimingMetric.STA_HOLD_WNS: 0.5,
                TimingMetric.STA_HOLD_TNS: 0.0,
            },
        ),
        candidate=_terminal(
            "candidate",
            dr=100.5,
            overflow=10,
            wirelength=98,
            timing={
                TimingMetric.STA_SETUP_WNS: 0.995,
                TimingMetric.STA_SETUP_TNS: -0.005,
                TimingMetric.STA_HOLD_WNS: 0.4975,
                TimingMetric.STA_HOLD_TNS: -0.005,
            },
        ),
        objective=_objective(),
        semantic_objective=semantic,
    )

    assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_WIRELENGTH


def test_comparator_accepts_any_primary_metric_improvement() -> None:
    semantic = freeze_optimization_objective(
        "reduce wirelength",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            rationale_summary="Reduce routed wirelength.",
        ),
    )
    comparison = compare_incumbent(
        incumbent=_terminal("incumbent", dr=0, overflow=0, wirelength=100),
        candidate=_terminal("candidate", dr=0, overflow=0, wirelength=99.5),
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
