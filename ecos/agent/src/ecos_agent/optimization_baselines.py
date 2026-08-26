"""Deterministic non-LLM policies for the two-design optimization pilot."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache
from typing import Iterable, Mapping

from ecos_agent.optimization_contracts import (
    CANDIDATE_EXECUTION_LIMIT,
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization_rules import (
    CoordinateDirection,
    legal_actions,
    next_coordinate_selection,
    select_requested_value,
)
from ecos_agent.step_knowledge import load_default_general_knowledge

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
    for knob_id, direction, entity_id in rule_actions:
        action = LegalAction(knob_id=knob_id, direction=direction)
        requested = select_requested_value(
            action, current_values=current_values, attempted=attempted
        )
        if requested is not None:
            return BaselineSelection(
                action,
                requested,
                coordinate_index,
                _rule_references()[entity_id],
            )
    return _coordinate_selection(current_values, attempted, coordinate_index)


_ENABLE_ROUTABILITY = "strategy.congestion.enable_congestion_guided_area_adjust.v1"
_INCREASE_PADDING = "strategy.congestion.padding_spreads_hotspot_cells.v1"
_DECREASE_DENSITY = "strategy.congestion.lower_packing_when_overflow_persists.v1"
_REDUCE_SPREADING = "strategy.wirelength.reduce_excessive_place_spreading.v1"

_CONGESTED_RULES = (
    (OptimizationKnob.ROUTABILITY_OPT, StrategyDirection.ENABLE, _ENABLE_ROUTABILITY),
    (OptimizationKnob.CELL_PADDING_X, StrategyDirection.INCREASE, _INCREASE_PADDING),
    (OptimizationKnob.TARGET_DENSITY, StrategyDirection.DECREASE, _DECREASE_DENSITY),
)
_CLEAN_RULES = (
    (OptimizationKnob.ROUTABILITY_OPT, StrategyDirection.DISABLE, _REDUCE_SPREADING),
    (OptimizationKnob.CELL_PADDING_X, StrategyDirection.DECREASE, _REDUCE_SPREADING),
    (OptimizationKnob.TARGET_DENSITY, StrategyDirection.INCREASE, _REDUCE_SPREADING),
)


def rule_guided_policy_manifest() -> dict[str, object]:
    references = _rule_references()

    def rows(rules):
        return tuple(
            {
                "priority": priority,
                "action": {
                    "knob_id": knob_id.value,
                    "direction": direction.value,
                },
                "knowledge_ref": references[entity_id].model_dump(mode="json"),
            }
            for priority, (knob_id, direction, entity_id) in enumerate(rules, 1)
        )

    return {
        "schema_version": "ecos.optimization_rule_guided_policy.v2",
        "condition_metric": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW.value,
        "exhaustion_policy": "controlled_coordinate_order",
        "congested_when": "> 0",
        "congested_rules": rows(_CONGESTED_RULES),
        "clean_when": "<= 0",
        "clean_rules": rows(_CLEAN_RULES),
    }


@lru_cache(maxsize=1)
def _rule_references() -> dict[str, KnowledgeReference]:
    entities = {
        entity.entity_id: entity
        for metric in ("congestion", "wirelength")
        for entity in load_default_general_knowledge(metric).entities
    }
    result = {}
    for entity_id in {_ENABLE_ROUTABILITY, _INCREASE_PADDING, _DECREASE_DENSITY, _REDUCE_SPREADING}:
        entity = entities.get(entity_id)
        if entity is None:
            raise ValueError(f"rule-guided knowledge is unavailable: {entity_id}")
        result[entity_id] = KnowledgeReference(
            entity_id=entity.entity_id,
            chunk_sha256=entity.chunk_sha256,
        )
    return result
