"""Pure selection and comparison rules for the first optimization milestone."""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Mapping

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    KnobApplicationReceipt,
    MetricReference,
    ObjectiveMetric,
    LegalAction,
    OptimizationKnob,
    OptimizationObjectiveContract,
    OptimizationObjectiveProposal,
    ProposalAction,
    REQUIRED_SIGNOFF_GATES,
    RequestedKnobValue,
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    RoutabilityObjectiveContract,
    SelectionMetric,
    StrategyDirection,
    TerminalObservation,
    TimingGuardrailContract,
    TimingReference,
)


_DENSITY_VALUES = tuple(round(0.1 + 0.05 * index, 2) for index in range(18))
_PADDING_VALUES = (0, 1, 2, 3)
_LATTICE_VALUES = {
    OptimizationKnob.TARGET_DENSITY: _DENSITY_VALUES,
    OptimizationKnob.TARGET_OVERFLOW: (0.06, 0.07, 0.08, 0.09, 0.1),
    OptimizationKnob.CELL_PADDING_X: _PADDING_VALUES,
    OptimizationKnob.DENSITY_WEIGHT: (0.0001, 0.00025, 0.0005, 0.00085, 0.001, 0.0025, 0.005),
    OptimizationKnob.FLOORPLAN_CORE_UTIL: (0.4, 0.5, 0.6, 0.7, 0.8),
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: (0.5, 0.75, 1.0, 1.33, 2.0),
    OptimizationKnob.SYNTH_MAX_FANOUT: (8, 16, 20, 24, 32, 48, 64),
}
_DRC_GOAL_MARKERS = (
    "drc",
    "design rule",
    "design-rule",
    "设计规则",
    "规则违例",
)
_METRIC_RELATIVE_TOLERANCE = 0.01
_METRIC_ABSOLUTE_TOLERANCE = 0.01


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
    decisive_metric: SelectionMetric | None


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
    CoordinateAction(OptimizationKnob.FLOORPLAN_CORE_UTIL, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.FLOORPLAN_CORE_UTIL, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.FLOORPLAN_ASPECT_RATIO, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.FLOORPLAN_ASPECT_RATIO, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.SYNTH_MAX_FANOUT, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.SYNTH_MAX_FANOUT, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.TARGET_DENSITY, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.TARGET_DENSITY, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.TARGET_OVERFLOW, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.TARGET_OVERFLOW, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.CELL_PADDING_X, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.CELL_PADDING_X, CoordinateDirection.INCREASE),
    CoordinateAction(OptimizationKnob.ROUTABILITY_OPT, CoordinateDirection.TOGGLE),
    CoordinateAction(OptimizationKnob.DENSITY_WEIGHT, CoordinateDirection.DECREASE),
    CoordinateAction(OptimizationKnob.DENSITY_WEIGHT, CoordinateDirection.INCREASE),
)


def coordinate_value_from_receipt(
    receipt: KnobApplicationReceipt, *, site_width_dbu: int
) -> bool | int | float:
    if type(site_width_dbu) is not int or site_width_dbu <= 0:
        raise ValueError("site width is invalid")
    if receipt.requested.knob_id == OptimizationKnob.DENSITY_WEIGHT:
        return receipt.requested.value
    value = receipt.effective_final.value
    return value / site_width_dbu if receipt.requested.knob_id == OptimizationKnob.CELL_PADDING_X else value


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


def freeze_optimization_objective(
    goal_text: str,
    proposal: OptimizationObjectiveProposal,
) -> OptimizationObjectiveContract:
    if not isinstance(goal_text, str) or not goal_text.strip():
        raise ValueError("optimization goal text is invalid")
    preserve_metrics = _effective_preserve_metrics(goal_text, proposal)
    payload = {
        "schema_version": "ecos.optimization_objective.v1",
        "source_goal_sha256": canonical_sha256(goal_text.strip()),
        "primary_metric": proposal.primary_metric.value,
        "preserve_metrics": [metric.value for metric in preserve_metrics],
        "required_signoff_gates": list(REQUIRED_SIGNOFF_GATES),
        "rationale_summary": proposal.rationale_summary,
    }
    return OptimizationObjectiveContract(
        **payload,
        contract_sha256=canonical_sha256(payload),
    )


def _effective_preserve_metrics(
    goal_text: str, proposal: OptimizationObjectiveProposal
) -> tuple[ObjectiveMetric, ...]:
    preserve_metrics = list(proposal.preserve_metrics)
    mentions_drc = any(marker in goal_text.casefold() for marker in _DRC_GOAL_MARKERS)
    drc_metric = ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT
    if (
        mentions_drc
        and proposal.primary_metric != drc_metric
        and drc_metric not in preserve_metrics
    ):
        preserve_metrics.insert(0, drc_metric)
    if len(preserve_metrics) > 2:
        raise ValueError("optimization objective preserves too many metrics after DRC binding")
    return tuple(preserve_metrics)


def freeze_routability_objective(
    baseline: TerminalObservation,
) -> RoutabilityObjectiveContract:
    if not baseline.eligible_for_incumbent:
        raise ValueError("baseline terminal observation is not eligible")
    return RoutabilityObjectiveContract(
        references=tuple(
            MetricReference(metric_id=metric_id, reference_value=baseline.metrics[metric_id])
            for metric_id in ROUTABILITY_OBJECTIVE_ORDER
        ),
        timing_guardrail=TimingGuardrailContract(
            references=tuple(
                TimingReference(
                    metric_id=metric_id,
                    reference_value=baseline.timing_guardrail[metric_id],
                )
                for metric_id in TIMING_GUARDRAIL_ORDER
            )
        ),
    )


def compare_incumbent(
    *,
    incumbent: TerminalObservation,
    candidate: TerminalObservation,
    objective: RoutabilityObjectiveContract,
    semantic_objective: OptimizationObjectiveContract | None = None,
) -> IncumbentComparison:
    if not incumbent.eligible_for_incumbent:
        raise ValueError("incumbent terminal observation is not eligible")
    if not candidate.eligible_for_incumbent:
        return IncumbentComparison(IncumbentDecision.CANDIDATE_INELIGIBLE, None)
    for metric_id in TIMING_GUARDRAIL_ORDER:
        incumbent_value = incumbent.timing_guardrail[metric_id]
        candidate_value = candidate.timing_guardrail[metric_id]
        if candidate_value < incumbent_value and _meaningful_metric_change(
            incumbent_value, candidate_value
        ):
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
    if semantic_objective is not None:
        for metric_id in semantic_objective.preserve_metrics:
            incumbent_value = incumbent.metrics[metric_id]
            candidate_value = candidate.metrics[metric_id]
            if candidate_value > incumbent_value and _meaningful_metric_change(
                incumbent_value, candidate_value
            ):
                return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
        metric_id = semantic_objective.primary_metric
        incumbent_value = incumbent.metrics[metric_id]
        candidate_value = candidate.metrics[metric_id]
        if candidate_value < incumbent_value:
            return IncumbentComparison(IncumbentDecision.CANDIDATE_BETTER, metric_id)
        if candidate_value > incumbent_value:
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
        return IncumbentComparison(IncumbentDecision.NOISE_TIE, None)
    for metric_id in ROUTABILITY_OBJECTIVE_ORDER:
        incumbent_value = incumbent.metrics[metric_id]
        candidate_value = candidate.metrics[metric_id]
        if candidate_value < incumbent_value:
            return IncumbentComparison(IncumbentDecision.CANDIDATE_BETTER, metric_id)
        if candidate_value > incumbent_value:
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
    return IncumbentComparison(IncumbentDecision.NOISE_TIE, None)


def _meaningful_metric_change(reference: float, candidate: float) -> bool:
    return not math.isclose(
        reference,
        candidate,
        rel_tol=_METRIC_RELATIVE_TOLERANCE,
        abs_tol=_METRIC_ABSOLUTE_TOLERANCE,
    )


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
    for value in _directional_lattice_values(
        coordinate_action, current, (*attempted_values, *aliases)
    ):
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
    candidates = _directional_lattice_values(action, current, (*attempted, *aliases))
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
    if knob_id == OptimizationKnob.ROUTABILITY_OPT:
        if type(value) is not bool:
            raise ValueError("current routability optimization value is invalid")
    elif knob_id == OptimizationKnob.CELL_PADDING_X:
        if (
            type(value) not in {int, float}
            or isinstance(value, bool)
            or not math.isfinite(float(value))
            or not 0 <= float(value) <= 3
        ):
            raise ValueError("current cell padding site count is invalid")
    elif knob_id == OptimizationKnob.SYNTH_MAX_FANOUT:
        if type(value) is not int or value < 1:
            raise ValueError("current max fanout is invalid")
    elif type(value) not in {int, float} or isinstance(value, bool) or not math.isfinite(float(value)):
        raise ValueError(f"current numeric value is invalid: {knob_id.value}")
    elif knob_id in {OptimizationKnob.TARGET_DENSITY, OptimizationKnob.FLOORPLAN_CORE_UTIL} and not 0 < float(value) <= 1:
        raise ValueError(f"current bounded ratio is invalid: {knob_id.value}")
    elif knob_id == OptimizationKnob.TARGET_OVERFLOW and not 0 <= float(value) <= 1:
        raise ValueError("current target overflow is invalid")
    elif knob_id in {OptimizationKnob.DENSITY_WEIGHT, OptimizationKnob.FLOORPLAN_ASPECT_RATIO} and float(value) <= 0:
        raise ValueError(f"current positive value is invalid: {knob_id.value}")
    return value


def _directional_lattice_values(
    action: CoordinateAction,
    current: bool | int | float,
    known: tuple[RequestedKnobValue, ...] = (),
) -> tuple[float | int, ...]:
    values = _LATTICE_VALUES[action.knob_id]
    candidates = (
        tuple(value for value in reversed(values) if value < current)
        if action.direction == CoordinateDirection.DECREASE
        else tuple(value for value in values if value > current)
    )
    if not candidates:
        return ()
    # The boundary is a virtual anchor, so maximin ordering bisects unexplored intervals.
    boundary = values[0] if action.direction == CoordinateDirection.DECREASE else values[-1]
    anchors = (current, boundary) + tuple(
        item.value
        for item in known
        if item.knob_id == action.knob_id
        and min(boundary, current) <= item.value <= max(boundary, current)
    )
    return tuple(
        sorted(
            candidates,
            key=lambda value: -min(abs(value - anchor) for anchor in anchors),
        )
    )


def _unexcluded_request(
    knob_id: OptimizationKnob,
    value: bool | int | float,
    attempted: tuple[RequestedKnobValue, ...],
    aliases: tuple[RequestedKnobValue, ...],
) -> RequestedKnobValue | None:
    request = RequestedKnobValue(knob_id=knob_id, value=value)
    return None if request in {*attempted, *aliases} else request
