from __future__ import annotations

from ecos_agent.optimization.experiments.baselines import (
    BaselineMethod,
    rule_guided_policy_manifest,
    select_baseline_candidate,
)
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    RequestedKnobValue,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)

HASH = "sha256:" + "a" * 64


def _terminal(violations: float, overflow: float, wirelength: float) -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-Harden",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: violations,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
        },
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
    )


def _values() -> dict[str, bool | int | float]:
    return {
        "place.target_density": 0.2,
        "place.target_overflow": 0.1,
        "place.cell_padding_x": 2,
        "place.routability_opt": True,
        "place.density_weight": 0.00085,
        "floorplan.core_util": 0.6,
        "floorplan.aspect_ratio": 1.0,
        "synth.max_fanout": 32,
    }


def test_controlled_coordinate_reuses_fixed_direction_order_without_duplicates() -> None:
    values = _values()
    attempted: list[RequestedKnobValue] = []
    selections = []
    coordinate_index = 0

    for turn_index in range(20):
        selection = select_baseline_candidate(
            BaselineMethod.CONTROLLED_COORDINATE,
            design_id="gcd",
            turn_index=turn_index,
            coordinate_index=coordinate_index,
            random_seed=17,
            current_values=values,
            attempted=attempted,
            incumbent=_terminal(0, 1, 100),
        )
        assert selection is not None
        selections.append(selection)
        coordinate_index = selection.next_coordinate_index
        attempted.append(selection.requested)
        values[selection.requested.knob_id.value] = selection.requested.value

    assert [item.action.knob_id.value for item in selections[:5]] == [
        "floorplan.core_util",
        "floorplan.core_util",
        "floorplan.aspect_ratio",
        "floorplan.aspect_ratio",
        "synth.max_fanout",
    ]
    assert len({(item.requested.knob_id, item.requested.value) for item in selections}) == 20


def test_random_action_is_seeded_legal_and_replayable() -> None:
    def sequence() -> list[tuple[str, object]]:
        values = _values()
        attempted: list[RequestedKnobValue] = []
        result = []
        for turn_index in range(20):
            selection = select_baseline_candidate(
                BaselineMethod.RANDOM_ACTION,
                design_id="i2c",
                turn_index=turn_index,
                coordinate_index=0,
                random_seed=20260824,
                current_values=values,
                attempted=attempted,
                incumbent=_terminal(0, 2, 100),
            )
            assert selection is not None
            attempted.append(selection.requested)
            values[selection.requested.knob_id.value] = selection.requested.value
            result.append((selection.requested.knob_id.value, selection.requested.value))
        return result

    assert sequence() == sequence()
    assert len(set(sequence())) == 20


def test_rule_guided_direction_uses_audited_card_mappings() -> None:
    congested = select_baseline_candidate(
        BaselineMethod.RULE_GUIDED_DIRECTION,
        design_id="i2c",
        turn_index=0,
        coordinate_index=0,
        random_seed=0,
        current_values={**_values(), "place.routability_opt": False},
        attempted=(),
        incumbent=_terminal(0, 2, 100),
    )
    clean = select_baseline_candidate(
        BaselineMethod.RULE_GUIDED_DIRECTION,
        design_id="gcd",
        turn_index=0,
        coordinate_index=0,
        random_seed=0,
        current_values=_values(),
        attempted=(),
        incumbent=_terminal(0, 0, 100),
    )

    assert congested is not None
    assert congested.requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=3
    )
    assert congested.knowledge_ref is not None
    assert congested.knowledge_ref.entity_id == (
        "strategy.congestion.padding_spreads_hotspot_cells.v1"
    )
    assert clean is not None
    assert clean.requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=1
    )
    assert clean.knowledge_ref is not None
    assert clean.knowledge_ref.entity_id == (
        "strategy.wirelength.reduce_excessive_place_spreading.v1"
    )


def test_rule_guided_direction_fills_the_candidate_budget() -> None:
    values = _values()
    attempted: list[RequestedKnobValue] = []
    coordinate_index = 0

    for turn_index in range(20):
        selection = select_baseline_candidate(
            BaselineMethod.RULE_GUIDED_DIRECTION,
            design_id="gcd",
            turn_index=turn_index,
            coordinate_index=coordinate_index,
            random_seed=0,
            current_values=values,
            attempted=attempted,
            incumbent=_terminal(0, 0, 100),
        )
        assert selection is not None
        attempted.append(selection.requested)
        coordinate_index = selection.next_coordinate_index
        values[selection.requested.knob_id.value] = selection.requested.value

    assert len(set(attempted)) == 20


def test_rule_guided_policy_manifest_freezes_order_and_knowledge_hashes() -> None:
    manifest = rule_guided_policy_manifest()

    assert manifest["exhaustion_policy"] == "controlled_coordinate_order"
    assert [rule["priority"] for rule in manifest["congested_rules"]] == [1, 2]
    assert [rule["priority"] for rule in manifest["clean_rules"]] == [1, 2]
    for rule in (*manifest["congested_rules"], *manifest["clean_rules"]):
        assert len(rule["knowledge_ref"]["chunk_sha256"]) == 64
