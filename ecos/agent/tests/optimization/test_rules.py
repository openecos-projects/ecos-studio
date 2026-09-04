import pytest
from pydantic import ValidationError

from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    RequestedKnobValue,
    RoutabilityObjectiveContract,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.rules import (
    CoordinateDirection,
    IncumbentDecision,
    compare_incumbent,
    freeze_optimization_objective,
    freeze_routability_objective,
    legal_actions,
    next_coordinate_selection,
)

HASH = "sha256:" + "a" * 64


def _expanded_current(**overrides: object) -> dict[str, object]:
    return {
        "place.target_density": 0.5,
        "place.target_overflow": 0.1,
        "place.cell_padding_x": 2,
        "place.routability_opt": True,
        "place.density_weight": 0.00085,
        "floorplan.core_util": 0.6,
        "floorplan.aspect_ratio": 1.0,
        **overrides,
    }


def _all_requested_values() -> tuple[RequestedKnobValue, ...]:
    lattices = {
        "place.target_density": tuple(round(0.1 + 0.05 * index, 2) for index in range(14)) + (0.8, 0.825, 0.85, 0.875, 0.9, 0.925, 0.95),
        "place.target_overflow": (0.0, 0.02, 0.04, 0.06, 0.07, 0.08, 0.085, 0.09, 0.095, 0.1, 0.105, 0.11, 0.115, 0.12, 0.13, 0.14, 0.16, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0),
        "place.cell_padding_x": (0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16),
        "place.routability_opt": (False, True),
        "place.density_weight": (0.00001, 0.000025, 0.00005, 0.0001, 0.00025, 0.0005, 0.00065, 0.00075, 0.00085, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.0035, 0.005, 0.0075, 0.01),
        "floorplan.core_util": tuple(round(0.2 + 0.05 * index, 2) for index in range(16)),
        "floorplan.aspect_ratio": (0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.33, 1.5, 2.0, 3.0, 4.0, 5.0),
    }
    return tuple(
        RequestedKnobValue(knob_id=knob_id, value=value)
        for knob_id, values in lattices.items()
        for value in values
    )


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


def test_coordinate_search_bisects_the_largest_unexplored_density_interval() -> None:
    selection = next_coordinate_selection(
        current_values=_expanded_current(**{"place.target_density": 0.47}),
        attempted=(),
        start_action_index=4,
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.3)
    assert selection.next_action_index == 5


def test_coordinate_search_uses_attempted_and_alias_values_to_refine_the_interval() -> None:
    selection = next_coordinate_selection(
        current_values=_expanded_current(
            **{"place.cell_padding_x": 1, "place.routability_opt": False}
        ),
        attempted=(RequestedKnobValue(knob_id="place.target_density", value=0.45),),
        known_aliases=(RequestedKnobValue(knob_id="place.target_density", value=0.4),),
        start_action_index=4,
    )

    assert selection is not None
    assert selection.requested == RequestedKnobValue(knob_id="place.target_density", value=0.25)
    assert selection.next_action_index == 5


def test_coordinate_search_toggles_routability_optimization() -> None:
    current = _expanded_current(
        **{
            "place.target_density": 0.1,
            "place.target_overflow": 0.06,
            "place.cell_padding_x": 0,
            "place.routability_opt": True,
        }
    )
    attempted = tuple(
        item
        for item in _all_requested_values()
        if item.knob_id.value != "place.routability_opt"
    )

    selection = next_coordinate_selection(
        current_values=current,
        attempted=attempted,
        start_action_index=12,
    )
    assert selection is not None
    assert selection.action.direction == CoordinateDirection.TOGGLE
    assert selection.requested == RequestedKnobValue(
        knob_id="place.routability_opt", value=False
    )


def test_coordinate_search_can_enable_routability_optimization() -> None:
    selection = next_coordinate_selection(
        current_values=_expanded_current(**{"place.routability_opt": False}),
        attempted=tuple(
            item
            for item in _all_requested_values()
            if item.knob_id.value != "place.routability_opt"
        ),
        start_action_index=12,
    )
    assert selection is not None
    assert selection.requested == RequestedKnobValue(
        knob_id="place.routability_opt", value=True
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
        ("place.target_density", "decrease"),
        ("place.target_density", "increase"),
        ("place.target_overflow", "decrease"),
        ("place.target_overflow", "increase"),
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

    ineligible = _terminal(
        "ineligible-baseline",
        dr=0,
        overflow=0,
        wirelength=7,
        signoff=GateResult.FAIL,
    )
    with pytest.raises(ValueError, match="eligible"):
        freeze_routability_objective(ineligible)



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
