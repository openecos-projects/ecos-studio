"""Pure selection and comparison rules for the first optimization milestone."""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Mapping, Sequence

from ecos_agent.optimization_contracts import (
    MetricNoiseBand,
    ObjectiveMetric,
    LegalAction,
    OptimizationKnob,
    ProposalAction,
    RequestedKnobValue,
    ROUTABILITY_OBJECTIVE_ORDER,
    RoutabilityObjectiveContract,
    StrategyDirection,
    TerminalObservation,
)


_DENSITY_VALUES = tuple(round(0.1 + 0.05 * index, 2) for index in range(18))
_PADDING_VALUES = (0, 1, 2, 3)


class IncumbentDecision(StrEnum):
    INITIALIZED = "initialized"
    CANDIDATE_BETTER = "candidate_better"
    INCUMBENT_RETAINED = "incumbent_retained"
    NOISE_TIE = "noise_tie"
    CANDIDATE_INELIGIBLE = "candidate_ineligible"


class CoordinateDirection(StrEnum):
    DECREASE = "decrease"
    INCREASE = "increase"
    TOGGLE = "toggle"


@dataclass(frozen=True)
class IncumbentComparison:
    decision: IncumbentDecision
    decisive_metric: ObjectiveMetric | None


@dataclass(frozen=True)
class CoordinateAction:
    knob_id: OptimizationKnob
    direction: CoordinateDirection


@dataclass(frozen=True)
class CoordinateSelection:
    action: CoordinateAction
    requested: RequestedKnobValue
    next_action_index: int


CONTROLLED_COORDINATE_ORDER = (
    CoordinateAction(OptimizationKnob.TARGET_DENSITY, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.TARGET_DENSITY, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.CELL_PADDING_X, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.CELL_PADDING_X, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.ROUTABILITY_OPT, CoordinateDirection.TOGGLE),
)


def legal_actions(
    *,
    current_values: Mapping[str, bool | int | float],
    attempted: Iterable[RequestedKnobValue],
    known_aliases: Iterable[RequestedKnobValue] = (),
) -> tuple[LegalAction, ...]:
    """Return every direction that still maps to a concrete local value."""
    attempted_values = tuple(attempted)
    aliases = tuple(known_aliases)
    actions = []
    for coordinate in CONTROLLED_COORDINATE_ORDER:
        current = _current_value(coordinate.knob_id, current_values)
        if _next_requested_value(coordinate, current_values, attempted_values, aliases) is None:
            continue
        direction = (
            StrategyDirection.ENABLE
            if coordinate.direction == CoordinateDirection.TOGGLE and not current
            else StrategyDirection.DISABLE
            if coordinate.direction == CoordinateDirection.TOGGLE
            else StrategyDirection(coordinate.direction.value)
        )
        actions.append(LegalAction(knob_id=coordinate.knob_id, direction=direction))
    return tuple(actions)


def freeze_routability_objective(
    default_replays: Mapping[ObjectiveMetric, Sequence[float]],
) -> RoutabilityObjectiveContract:
    bands = []
    for metric_id in ROUTABILITY_OBJECTIVE_ORDER:
        values = tuple(default_replays.get(metric_id, ()))
        if len(values) != 3:
            raise ValueError("each objective metric requires exactly three default replays")
        bands.append(
            MetricNoiseBand(
                metric_id=metric_id,
                default_replay_values=values,
                tolerance=max(values) - min(values),
            )
        )
    if set(default_replays) != set(ROUTABILITY_OBJECTIVE_ORDER):
        raise ValueError("default replays must contain only frozen objective metrics")
    return RoutabilityObjectiveContract(noise_bands=tuple(bands))


def compare_incumbent(
    *,
    incumbent: TerminalObservation,
    candidate: TerminalObservation,
    objective: RoutabilityObjectiveContract,
) -> IncumbentComparison:
    if not incumbent.eligible_for_incumbent:
        raise ValueError("incumbent terminal observation is not eligible")
    if not candidate.eligible_for_incumbent:
        return IncumbentComparison(IncumbentDecision.CANDIDATE_INELIGIBLE, None)
    for metric_id in ROUTABILITY_OBJECTIVE_ORDER:
        delta = incumbent.metrics[metric_id] - candidate.metrics[metric_id]
        tolerance = objective.noise_band(metric_id)
        if delta > tolerance:
            return IncumbentComparison(IncumbentDecision.CANDIDATE_BETTER, metric_id)
        if -delta > tolerance:
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
    return IncumbentComparison(IncumbentDecision.NOISE_TIE, None)


def next_coordinate_selection(
    *,
    current_values: Mapping[str, bool | int | float],
    attempted: Iterable[RequestedKnobValue],
    known_aliases: Iterable[RequestedKnobValue] = (),
    start_action_index: int = 0,
) -> CoordinateSelection | None:
    if not 0 <= start_action_index < len(CONTROLLED_COORDINATE_ORDER):
        raise ValueError("coordinate action index is invalid")
    for knob_id in OptimizationKnob:
        _current_value(knob_id, current_values)
    attempted_values = tuple(attempted)
    aliases = tuple(known_aliases)
    for offset in range(len(CONTROLLED_COORDINATE_ORDER)):
        index = (start_action_index + offset) % len(CONTROLLED_COORDINATE_ORDER)
        action = CONTROLLED_COORDINATE_ORDER[index]
        requested = _next_requested_value(action, current_values, attempted_values, aliases)
        if requested is not None:
            return CoordinateSelection(
                action,
                requested,
                (index + 1) % len(CONTROLLED_COORDINATE_ORDER),
            )
    return None


def select_requested_value(
    action: ProposalAction,
    *,
    current_values: Mapping[str, bool | int | float],
    attempted: Iterable[RequestedKnobValue] = (),
    known_aliases: Iterable[RequestedKnobValue] = (),
) -> RequestedKnobValue | None:
    """Select the next frozen value for one validated strategy direction."""
    current = _current_value(action.knob_id, current_values)
    attempted_values = tuple(attempted)
    aliases = tuple(known_aliases)
    if action.knob_id == OptimizationKnob.ROUTABILITY_OPT:
        desired = action.direction == StrategyDirection.ENABLE
        if current == desired:
            return None
        return _unexcluded_request(action.knob_id, desired, attempted_values, aliases)
    direction = (
        CoordinateDirection.INCREASE
        if action.direction == StrategyDirection.INCREASE
        else CoordinateDirection.DECREASE
    )
    coordinate_action = CoordinateAction(action.knob_id, direction)
    for value in _directional_lattice_values(coordinate_action, current):
        request = _unexcluded_request(action.knob_id, value, attempted_values, aliases)
        if request is not None:
            return request
    return None


def _next_requested_value(
    action: CoordinateAction,
    current_values: Mapping[str, bool | int | float],
    attempted: tuple[RequestedKnobValue, ...],
    aliases: tuple[RequestedKnobValue, ...],
) -> RequestedKnobValue | None:
    current = _current_value(action.knob_id, current_values)
    if action.direction == CoordinateDirection.TOGGLE:
        if any(item.knob_id == action.knob_id for item in attempted):
            return None
        return _unexcluded_request(action.knob_id, not current, attempted, aliases)
    candidates = _directional_lattice_values(action, current)
    for value in candidates:
        request = _unexcluded_request(action.knob_id, value, attempted, aliases)
        if request is not None:
            return request
    return None


def _current_value(
    knob_id: OptimizationKnob, current_values: Mapping[str, bool | int | float]
) -> bool | int | float:
    if knob_id.value not in current_values:
        raise ValueError(f"current value is missing: {knob_id.value}")
    value = current_values[knob_id.value]
    if knob_id == OptimizationKnob.TARGET_DENSITY:
        if (
            type(value) not in {int, float}
            or isinstance(value, bool)
            or not 0.1 <= float(value) <= 0.95
        ):
            raise ValueError("current target density is invalid")
    elif knob_id == OptimizationKnob.CELL_PADDING_X:
        if (
            type(value) not in {int, float}
            or isinstance(value, bool)
            or not math.isfinite(float(value))
            or not 0 <= float(value) <= 3
        ):
            raise ValueError("current cell padding site count is invalid")
    elif type(value) is not bool:
        raise ValueError("current routability optimization value is invalid")
    return value


def _directional_lattice_values(
    action: CoordinateAction, current: bool | int | float
) -> tuple[float | int, ...]:
    values = (
        _DENSITY_VALUES
        if action.knob_id == OptimizationKnob.TARGET_DENSITY
        else _PADDING_VALUES
    )
    if action.direction == CoordinateDirection.DECREASE:
        return tuple(value for value in reversed(values) if value < current)
    return tuple(value for value in values if value > current)


def _unexcluded_request(
    knob_id: OptimizationKnob,
    value: bool | int | float,
    attempted: tuple[RequestedKnobValue, ...],
    aliases: tuple[RequestedKnobValue, ...],
) -> RequestedKnobValue | None:
    request = RequestedKnobValue(knob_id=knob_id, value=value)
    return None if request in {*attempted, *aliases} else request
