"""Pure selection and comparison rules for the first optimization milestone."""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Mapping

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    POWER_SELECTION_ORDER,
    REQUIRED_SIGNOFF_GATES,
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    LegalAction,
    MetricReference,
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationObjectiveContract,
    OptimizationOutcomeKind,
    OptimizationObjectiveProposal,
    ProposalAction,
    RequestedKnobValue,
    RoutabilityObjectiveContract,
    SelectionMetric,
    StrategyDirection,
    TerminalObservation,
    TimingGuardrailContract,
    TimingReference,
    objective_metric_utility,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.objective_alignment import (
    ObjectiveAlignmentError,
    OptimizationObjectiveAlignment,
    build_active_objective,
    recovery_violation_counts,
)

_DENSITY_VALUES = tuple(round(0.1 + 0.05 * i, 2) for i in range(14)) + (0.8, 0.825, 0.85, 0.875, 0.9, 0.925, 0.95)
_PADDING_VALUES = (0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16)
_LATTICE_VALUES = {
    OptimizationKnob.TARGET_DENSITY: _DENSITY_VALUES,
    OptimizationKnob.TARGET_OVERFLOW: (0.0, 0.02, 0.04, 0.06, 0.07, 0.08, 0.085, 0.09, 0.095, 0.1, 0.105, 0.11, 0.115, 0.12, 0.13, 0.14, 0.16, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0),
    OptimizationKnob.CELL_PADDING_X: _PADDING_VALUES,
    OptimizationKnob.DENSITY_WEIGHT: (0.00001, 0.000025, 0.00005, 0.0001, 0.00025, 0.0005, 0.00065, 0.00075, 0.00085, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.0035, 0.005, 0.0075, 0.01),
    OptimizationKnob.FLOORPLAN_CORE_UTIL: tuple(round(0.2 + 0.05 * i, 2) for i in range(16)),
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: (0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.33, 1.5, 2.0, 3.0, 4.0, 5.0),
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
class TerminalCandidateClassification:
    comparison: IncumbentComparison | None
    outcome: OptimizationOutcomeKind
    promote: bool


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
ACTIVE_OPTIMIZATION_KNOBS = tuple(
    OptimizationKnob
)


def coordinate_value_from_native_receipt(
    receipt: ParameterApplicationReceipt, *, site_width_dbu: int
) -> bool | int | float:
    if type(site_width_dbu) is not int or site_width_dbu <= 0:
        raise ValueError("site width is invalid")
    knob_id = OptimizationKnob(receipt.requested["knob_id"])
    value = (
        receipt.requested["value"]
        if knob_id == OptimizationKnob.DENSITY_WEIGHT
        else receipt.effective_final.value
    )
    if type(value) not in {bool, int, float}:
        raise ValueError("native receipt effective value is unavailable")
    return value / site_width_dbu if knob_id == OptimizationKnob.CELL_PADDING_X else value


def native_receipt_is_effective(receipt: ParameterApplicationReceipt) -> bool:
    """Return whether a native receipt is a valid optimization intervention."""
    if receipt.application_status != "applied":
        return False
    if receipt.activation.status == "used":
        return True
    return (
        receipt.requested.get("knob_id") == OptimizationKnob.ROUTABILITY_OPT.value
        and receipt.requested.get("value") is False
        and receipt.activation.status == "not_activated"
    )


def terminal_quality_outcome(
    execution_outcome: OptimizationOutcomeKind,
    comparison: IncumbentComparison | None,
) -> OptimizationOutcomeKind:
    if execution_outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED:
        return execution_outcome
    if comparison is None:
        return execution_outcome
    return {
        IncumbentDecision.INITIALIZED: OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        IncumbentDecision.CANDIDATE_BETTER: OptimizationOutcomeKind.IMPROVED,
        IncumbentDecision.INCUMBENT_RETAINED: OptimizationOutcomeKind.DEGRADED,
        IncumbentDecision.NOISE_TIE: OptimizationOutcomeKind.TRADEOFF,
        IncumbentDecision.CANDIDATE_INELIGIBLE: (
            OptimizationOutcomeKind.CANDIDATE_INELIGIBLE
        ),
    }[comparison.decision]


def terminal_candidate_is_promotable(
    *,
    execution_outcome: OptimizationOutcomeKind,
    candidate: TerminalObservation | None,
    comparison: IncumbentComparison | None,
    requested: RequestedKnobValue | None,
    parameter_receipt: ParameterApplicationReceipt | None,
    objective_alignment: OptimizationObjectiveAlignment | None = None,
    recovery_active: bool = False,
) -> bool:
    recovery_eligible = False
    if recovery_active and candidate is not None and objective_alignment is not None:
        try:
            recovery_violation_counts(candidate)
            recovery_eligible = True
        except ObjectiveAlignmentError:
            recovery_eligible = False
    return bool(
        candidate is not None
        and execution_outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED
        and candidate.schema_version == "ecos.terminal_observation.v3"
        and (candidate.eligible_for_incumbent or recovery_eligible)
        and comparison is not None
        and comparison.decision
        in {IncumbentDecision.INITIALIZED, IncumbentDecision.CANDIDATE_BETTER}
        and requested is not None
        and parameter_receipt is not None
        and native_receipt_is_effective(parameter_receipt)
    )


def classify_terminal_candidate(
    *,
    execution_outcome: OptimizationOutcomeKind,
    candidate: TerminalObservation | None,
    incumbent: TerminalObservation | None,
    objective: RoutabilityObjectiveContract | None,
    semantic_objective: OptimizationObjectiveContract | None,
    objective_alignment: OptimizationObjectiveAlignment | None = None,
    requested: RequestedKnobValue | None,
    parameter_receipt: ParameterApplicationReceipt | None,
) -> TerminalCandidateClassification:
    comparison: IncumbentComparison | None = None
    recovering = bool(
        objective_alignment is not None
        and incumbent is not None
        and semantic_objective is not None
        and build_active_objective(
            objective_alignment, semantic_objective, incumbent
        ).recovery_stage
        != "original"
    )
    if candidate is not None and objective is not None:
        if recovering:
            assert objective_alignment is not None and incumbent is not None
            comparison = compare_recovery_incumbent(
                incumbent=incumbent,
                candidate=candidate,
                alignment=objective_alignment,
            )
        elif not candidate.eligible_for_incumbent:
            comparison = IncumbentComparison(
                IncumbentDecision.CANDIDATE_INELIGIBLE, None
            )
        elif incumbent is None:
            comparison = IncumbentComparison(IncumbentDecision.INITIALIZED, None)
        else:
            comparison = compare_incumbent(
                incumbent=incumbent,
                candidate=candidate,
                objective=objective,
                semantic_objective=semantic_objective,
            )
    if execution_outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED or (
        candidate is not None
        and candidate.schema_version != "ecos.terminal_observation.v3"
    ):
        comparison = IncumbentComparison(
            IncumbentDecision.CANDIDATE_INELIGIBLE, None
        )
    if requested is not None and (
        parameter_receipt is None
        or not native_receipt_is_effective(parameter_receipt)
    ):
        comparison = IncumbentComparison(
            IncumbentDecision.CANDIDATE_INELIGIBLE, None
        )
    return TerminalCandidateClassification(
        comparison=comparison,
        outcome=terminal_quality_outcome(execution_outcome, comparison),
        promote=terminal_candidate_is_promotable(
            execution_outcome=execution_outcome,
            candidate=candidate,
            comparison=comparison,
            requested=requested,
            parameter_receipt=parameter_receipt,
            objective_alignment=objective_alignment,
            recovery_active=recovering,
        ),
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
    *,
    objective_alignment: OptimizationObjectiveAlignment | None = None,
) -> RoutabilityObjectiveContract:
    if not baseline.eligible_for_incumbent and (
        objective_alignment is None
        or objective_alignment.baseline_terminal_observation_sha256
        != canonical_sha256(baseline.model_dump(mode="json"))
    ):
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
    incumbent_objectives = incumbent.objective_metrics
    candidate_objectives = candidate.objective_metrics
    selected_metrics = (
        (*semantic_objective.preserve_metrics, semantic_objective.primary_metric)
        if semantic_objective is not None
        else ROUTABILITY_OBJECTIVE_ORDER
    )
    for metric_id in selected_metrics:
        if metric_id not in incumbent_objectives:
            raise ValueError("incumbent terminal objective metric is unavailable")
        if metric_id not in candidate_objectives:
            return IncumbentComparison(
                IncumbentDecision.CANDIDATE_INELIGIBLE, metric_id
            )
    for metric_id in TIMING_GUARDRAIL_ORDER:
        incumbent_value = incumbent.timing_guardrail[metric_id]
        candidate_value = candidate.timing_guardrail[metric_id]
        if candidate_value < incumbent_value and _meaningful_metric_change(
            incumbent_value, candidate_value
        ):
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
    if semantic_objective is not None:
        for metric_id in semantic_objective.preserve_metrics:
            incumbent_value = incumbent_objectives[metric_id]
            candidate_value = candidate_objectives[metric_id]
            if (
                objective_metric_utility(metric_id, candidate_value)
                < objective_metric_utility(metric_id, incumbent_value)
                and _meaningful_metric_change(incumbent_value, candidate_value)
            ):
                return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
    metric_order = (
        (semantic_objective.primary_metric,)
        if semantic_objective is not None
        else ROUTABILITY_OBJECTIVE_ORDER
    )
    for metric_id in metric_order:
        incumbent_value = incumbent_objectives[metric_id]
        candidate_value = candidate_objectives[metric_id]
        incumbent_utility = objective_metric_utility(metric_id, incumbent_value)
        candidate_utility = objective_metric_utility(metric_id, candidate_value)
        if candidate_utility > incumbent_utility:
            return IncumbentComparison(IncumbentDecision.CANDIDATE_BETTER, metric_id)
        if candidate_utility < incumbent_utility:
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric_id)
    incumbent_evaluation = {
        metric.metric_id: metric.value for metric in incumbent.evaluation_metrics
    }
    candidate_evaluation = {
        metric.metric_id: metric.value for metric in candidate.evaluation_metrics
    }
    for metric_id in POWER_SELECTION_ORDER:
        incumbent_value = incumbent_evaluation.get(metric_id.value)
        candidate_value = candidate_evaluation.get(metric_id.value)
        if (
            incumbent_value is None
            or candidate_value is None
            or not _meaningful_metric_change(incumbent_value, candidate_value)
        ):
            continue
        decision = (
            IncumbentDecision.CANDIDATE_BETTER
            if candidate_value < incumbent_value
            else IncumbentDecision.INCUMBENT_RETAINED
        )
        return IncumbentComparison(decision, metric_id)
    return IncumbentComparison(IncumbentDecision.NOISE_TIE, None)


def compare_recovery_incumbent(
    *,
    incumbent: TerminalObservation,
    candidate: TerminalObservation,
    alignment: OptimizationObjectiveAlignment,
) -> IncumbentComparison:
    try:
        incumbent_counts = recovery_violation_counts(incumbent)
        candidate_counts = recovery_violation_counts(candidate)
    except ObjectiveAlignmentError:
        return IncumbentComparison(IncumbentDecision.CANDIDATE_INELIGIBLE, None)
    active = next(
        (metric for metric in alignment.recovery_order if incumbent_counts[metric]),
        None,
    )
    if active is None:
        raise ValueError("incumbent has no active recovery metric")
    for metric in alignment.recovery_order:
        if metric != active and candidate_counts[metric] > incumbent_counts[metric]:
            return IncumbentComparison(IncumbentDecision.INCUMBENT_RETAINED, metric)
    decision = (
        IncumbentDecision.CANDIDATE_BETTER
        if candidate_counts[active] < incumbent_counts[active]
        else IncumbentDecision.INCUMBENT_RETAINED
    )
    return IncumbentComparison(decision, active)


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
    for knob_id in ACTIVE_OPTIMIZATION_KNOBS:
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
    if action.knob_id not in ACTIVE_OPTIMIZATION_KNOBS:
        return None
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
                or not 0 <= float(value) <= max(_PADDING_VALUES)
        ):
            raise ValueError("current cell padding site count is invalid")
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
    if action.knob_id == OptimizationKnob.CELL_PADDING_X:
        return tuple(sorted(candidates, key=lambda value: (abs(value - current), value)))
    return tuple(sorted(candidates, key=lambda value: -min(abs(value - anchor) for anchor in anchors)))


def _unexcluded_request(
    knob_id: OptimizationKnob,
    value: bool | int | float,
    attempted: tuple[RequestedKnobValue, ...],
    aliases: tuple[RequestedKnobValue, ...],
) -> RequestedKnobValue | None:
    request = RequestedKnobValue(knob_id=knob_id, value=value)
    return None if request in {*attempted, *aliases} else request
