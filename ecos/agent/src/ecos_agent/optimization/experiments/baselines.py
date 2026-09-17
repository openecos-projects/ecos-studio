"""Deterministic non-LLM optimization policies."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache
from typing import Iterable, Mapping

from ecos_agent.optimization.contracts import (
    CANDIDATE_EXECUTION_LIMIT,
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.rules import (
    CoordinateDirection,
    legal_actions,
    next_coordinate_selection,
    select_requested_value,
)
from ecos_agent.knowledge.step import load_default_general_knowledge

_DESIGN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")


class BaselineMethod(StrEnum):
    DEFAULT = "default_ecos"
    CONTROLLED_COORDINATE = "controlled_coordinate"
    RANDOM_ACTION = "random_action"
    RULE_GUIDED_DIRECTION = "rule_guided_direction"


ONLINE_BASELINE_METHODS = (
    BaselineMethod.CONTROLLED_COORDINATE,
    BaselineMethod.RANDOM_ACTION,
    BaselineMethod.RULE_GUIDED_DIRECTION,
)


@dataclass(frozen=True)
class BaselineSelection:
    action: LegalAction
    requested: RequestedKnobValue
    next_coordinate_index: int
    knowledge_ref: KnowledgeReference | None = None


def select_baseline_candidate(
    method: BaselineMethod,
    *,
    design_id: str,
    turn_index: int,
    coordinate_index: int,
    random_seed: int,
    current_values: Mapping[str, bool | int | float],
    attempted: Iterable[RequestedKnobValue],
    incumbent: TerminalObservation,
) -> BaselineSelection | None:
    """Choose one legal direction; the local numeric selector still owns its value."""
    method = BaselineMethod(method)
    if not _DESIGN_ID.fullmatch(design_id):
        raise ValueError("baseline design id is invalid")
    if type(turn_index) is not int or not 0 <= turn_index < CANDIDATE_EXECUTION_LIMIT:
        raise ValueError("baseline turn index is invalid")
    if type(random_seed) is not int:
        raise ValueError("baseline random seed is invalid")
    attempted_values = tuple(attempted)
    if method == BaselineMethod.DEFAULT:
        return None
    if method == BaselineMethod.CONTROLLED_COORDINATE:
        return _coordinate_selection(current_values, attempted_values, coordinate_index)
    if method == BaselineMethod.RANDOM_ACTION:
        return _random_selection(
            design_id, turn_index, random_seed, current_values, attempted_values
        )
    return _rule_selection(current_values, attempted_values, incumbent, coordinate_index)


def _coordinate_selection(
    current_values: Mapping[str, bool | int | float],
    attempted: tuple[RequestedKnobValue, ...],
    coordinate_index: int,
) -> BaselineSelection | None:
    selection = next_coordinate_selection(
        current_values=current_values,
        attempted=attempted,
        start_action_index=coordinate_index,
    )
    if selection is None:
        return None
    direction = (
        StrategyDirection.ENABLE
        if selection.action.direction == CoordinateDirection.TOGGLE
        and selection.requested.value is True
        else StrategyDirection.DISABLE
        if selection.action.direction == CoordinateDirection.TOGGLE
        else StrategyDirection(selection.action.direction.value)
    )
    return BaselineSelection(
        LegalAction(knob_id=selection.action.knob_id, direction=direction),
        selection.requested,
        selection.next_action_index,
    )


def _random_selection(
    design_id: str,
    turn_index: int,
    random_seed: int,
    current_values: Mapping[str, bool | int | float],
    attempted: tuple[RequestedKnobValue, ...],
) -> BaselineSelection | None:
    actions = legal_actions(current_values=current_values, attempted=attempted)
    if not actions:
        return None
    action = random.Random(f"{random_seed}:{design_id}:{turn_index}").choice(actions)
    requested = select_requested_value(
        action, current_values=current_values, attempted=attempted
    )
    if requested is None:
        return None
    return BaselineSelection(action, requested, 0)


def _rule_selection(
    current_values: Mapping[str, bool | int | float],
    attempted: tuple[RequestedKnobValue, ...],
    incumbent: TerminalObservation,
    coordinate_index: int,
) -> BaselineSelection | None:
    overflow = incumbent.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW]
    rule_actions = _CONGESTED_RULES if overflow > 0 else _CLEAN_RULES
    for rule in rule_actions:
        if not _rule_state_matches(rule, current_values):
            continue
        action = LegalAction(knob_id=rule.knob_id, direction=rule.direction)
        requested = select_requested_value(
            action, current_values=current_values, attempted=attempted
        )
        if requested is not None:
            # No runtime knowledge_ref: the planner contract only accepts
            # references supplied by the retrieval context, and the rule
            # table's corpus provenance is declared by
            # rule_guided_policy_manifest() instead.
            return BaselineSelection(action, requested, coordinate_index)
    return _coordinate_selection(current_values, attempted, coordinate_index)


def _rule_state_matches(
    rule: _Rule, current_values: Mapping[str, bool | int | float]
) -> bool:
    if rule.value_above is None and rule.value_below is None:
        return True
    value = float(current_values[rule.knob_id.value])
    if rule.value_above is not None:
        return value > rule.value_above
    return value < rule.value_below


@dataclass(frozen=True)
class _Rule:
    knob_id: OptimizationKnob
    direction: StrategyDirection
    entity_id: str
    # Activation bounds on the rule's own current knob value; unconstrained
    # when both are None (mirrors the bound state predicates on the card).
    value_above: float | None = None
    value_below: float | None = None


_INCREASE_PADDING = "strategy.congestion.padding_spreads_hotspot_cells.v1"
_DECREASE_DENSITY = "strategy.congestion.lower_packing_when_overflow_persists.v1"
_ENABLE_ROUTABILITY = "strategy.congestion.enable_congestion_guided_area_adjust.v1"
_CORE_WHITESPACE = "strategy.congestion.trial_core_whitespace.v1"
_REDUCE_SPREADING = "strategy.wirelength.reduce_excessive_place_spreading.v1"
_WIDE_CORE = "strategy.wirelength.trial_wide_core_shape.v1"
_TALL_CORE = "strategy.wirelength.trial_tall_core_shape.v1"
_WEAKER_DENSITY_PENALTY = "strategy.wirelength.trial_weaker_initial_density_penalty.v1"
_TIGHTER_CORE_AREA = "strategy.wirelength.trial_tighter_core_area.v1"

_CONGESTED_RULES = (
    _Rule(OptimizationKnob.CELL_PADDING_X, StrategyDirection.INCREASE, _INCREASE_PADDING),
    _Rule(OptimizationKnob.TARGET_DENSITY, StrategyDirection.DECREASE, _DECREASE_DENSITY),
    _Rule(OptimizationKnob.ROUTABILITY_OPT, StrategyDirection.ENABLE, _ENABLE_ROUTABILITY),
    _Rule(OptimizationKnob.FLOORPLAN_CORE_UTIL, StrategyDirection.DECREASE, _CORE_WHITESPACE),
)
_CLEAN_RULES = (
    _Rule(OptimizationKnob.CELL_PADDING_X, StrategyDirection.DECREASE, _REDUCE_SPREADING),
    _Rule(OptimizationKnob.TARGET_DENSITY, StrategyDirection.INCREASE, _REDUCE_SPREADING),
    _Rule(
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
        StrategyDirection.DECREASE,
        _WIDE_CORE,
        value_above=1.0,
    ),
    _Rule(
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
        StrategyDirection.INCREASE,
        _TALL_CORE,
        value_below=1.0,
    ),
    _Rule(OptimizationKnob.DENSITY_WEIGHT, StrategyDirection.DECREASE, _WEAKER_DENSITY_PENALTY),
    _Rule(OptimizationKnob.FLOORPLAN_CORE_UTIL, StrategyDirection.INCREASE, _TIGHTER_CORE_AREA),
)


def rule_guided_policy_manifest() -> dict[str, object]:
    references = _rule_references()

    def rows(rules):
        return tuple(
            {
                "priority": priority,
                "action": {
                    "knob_id": rule.knob_id.value,
                    "direction": rule.direction.value,
                },
                "active_when": _active_when(rule),
                "knowledge_ref": references[rule.entity_id].model_dump(mode="json"),
            }
            for priority, rule in enumerate(rules, 1)
        )

    return {
        "schema_version": "ecos.optimization_rule_guided_policy.v3",
        "condition_metric": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW.value,
        "exhaustion_policy": "controlled_coordinate_order",
        "congested_when": "> 0",
        "congested_rules": rows(_CONGESTED_RULES),
        "clean_when": "<= 0",
        "clean_rules": rows(_CLEAN_RULES),
    }


def _active_when(rule: _Rule) -> dict[str, object] | None:
    if rule.value_above is not None:
        return {"op": ">", "value": rule.value_above}
    if rule.value_below is not None:
        return {"op": "<", "value": rule.value_below}
    return None


@lru_cache(maxsize=1)
def _rule_references() -> dict[str, KnowledgeReference]:
    entities = {
        entity.entity_id: entity
        for metric in ("congestion", "wirelength")
        for entity in load_default_general_knowledge(metric).entities
    }
    result = {}
    for entity_id in {
        _INCREASE_PADDING,
        _DECREASE_DENSITY,
        _ENABLE_ROUTABILITY,
        _CORE_WHITESPACE,
        _REDUCE_SPREADING,
        _WIDE_CORE,
        _TALL_CORE,
        _WEAKER_DENSITY_PENALTY,
        _TIGHTER_CORE_AREA,
    }:
        entity = entities.get(entity_id)
        if entity is None:
            raise ValueError(f"rule-guided knowledge is unavailable: {entity_id}")
        result[entity_id] = KnowledgeReference(
            entity_id=entity.entity_id,
            chunk_sha256=entity.chunk_sha256,
        )
    return result
