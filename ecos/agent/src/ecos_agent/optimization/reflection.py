"""Typed planner feedback: contracts plus deterministic construction.

Two reflection sources feed the next planning turn:

- rejection attribution: the deterministic reason a proposal turn failed to
  dispatch, with recovery hints the planner can act on;
- prediction-outcome attribution: the planner's own ``expected_effects``
  predictions joined against the recorded terminal outcome of the most recent
  intervention, so the next hypothesis starts from what the probe showed.

Both are pure functions over ledger-bound state; nothing here invents
thresholds or reclassifies outcomes.
"""

from __future__ import annotations

import math
from enum import StrEnum
from typing import TYPE_CHECKING, Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.optimization.contracts import (
    ExpectedEffect,
    ExpectedEffectDirection,
    LegalAction,
    ObjectiveMetric,
    OptimizationOutcomeKind,
    TerminalObservation,
)
from ecos_agent.optimization.rules import PROMOTING_DECISIONS

if TYPE_CHECKING:
    from ecos_agent.optimization.planning import OptimizationHistory


class _FeedbackModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FeedbackSource(StrEnum):
    REJECTION = "rejection"
    OUTCOME_ATTRIBUTION = "outcome_attribution"


class PredictionVerdict(StrEnum):
    CONFIRMED = "confirmed"
    REFUTED = "refuted"
    UNKNOWN = "unknown"


class ExpectedEffectVerdict(_FeedbackModel):
    metric_id: ObjectiveMetric
    predicted: ExpectedEffectDirection
    verdict: PredictionVerdict
    observed_delta: float | None = None

    @field_validator("observed_delta")
    @classmethod
    def validate_delta(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("observed delta must be finite")
        return value


class PlanningFeedbackEntry(_FeedbackModel):
    """Typed planner reflection: what failed or what the last probe showed."""

    schema_version: Literal["ecos.planning_feedback.v1"] = (
        "ecos.planning_feedback.v1"
    )
    source: FeedbackSource
    reason_code: str = Field(min_length=1, max_length=64)
    summary: str = Field(min_length=1, max_length=512)
    expected_effect_verdicts: tuple[ExpectedEffectVerdict, ...] = Field(
        default=(), max_length=3
    )
    outcome: str | None = None
    incumbent_decision: str | None = None
    decisive_metric: str | None = None
    intervention_id: str | None = None
    recovery_hints: tuple[str, ...] = Field(
        default=(), max_length=4
    )

    @field_validator("summary")
    @classmethod
    def validate_summary(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("planning feedback summary is invalid")
        return value

    @field_validator("recovery_hints")
    @classmethod
    def validate_hints(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        stripped = tuple(hint.strip() for hint in value)
        if any(not hint or len(hint) > 240 for hint in stripped):
            raise ValueError("planning feedback hints are invalid")
        return stripped

    @model_validator(mode="after")
    def validate_source_fields(self) -> "PlanningFeedbackEntry":
        if self.source == FeedbackSource.REJECTION and (
            self.outcome is not None or self.decisive_metric is not None
        ):
            raise ValueError("rejection feedback cannot carry outcome fields")
        if (
            self.source == FeedbackSource.OUTCOME_ATTRIBUTION
            and self.intervention_id is None
        ):
            raise ValueError("outcome attribution requires an intervention id")
        return self


# Outcomes whose terminal evidence cannot support a prediction verdict.
_UNUSABLE_OUTCOMES = frozenset(
    {
        OptimizationOutcomeKind.EVIDENCE_INVALID,
        OptimizationOutcomeKind.INDETERMINATE,
        OptimizationOutcomeKind.EXECUTION_FAILED,
        OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
    }
)

_REJECTION_HINTS: dict[str, tuple[str, ...]] = {
    "context_reference": (
        "copy context_ref field-for-field from the supplied context",
    ),
    "observation_reference": (
        "reference exactly the supplied observation_ref and no invented observations",
    ),
    "history_reference": (
        "cite only supplied history or parameter trajectory references",
    ),
    "knowledge_reference": (
        "cite only supplied knowledge references",
    ),
    "no_knowledge_reference": (
        "this agent mode forbids knowledge citations; drop knowledge_refs",
    ),
    "task_memory_reference": (
        "cite only supplied task-memory summaries",
    ),
    "proposal_action": (
        "choose a knob and direction from the supplied legal_actions with a "
        "value inside the effective domain",
    ),
}

_KNOWN_REJECTION_CODES = frozenset(
    {
        *_REJECTION_HINTS,
        "no_legal_candidate",
        "parameter_domain_unavailable",
        "planning_budget_exhausted",
        "proposal_repair_failed",
        "minimum_candidates_not_met",
        "planner_continue",
    }
)

_FALLBACK_HINTS: tuple[str, ...] = (
    "emit exactly the schema fields with valid types",
    "copy hashes and references from the supplied context",
)


def rejection_feedback_entry(
    reason: str,
    *,
    legal_actions: Sequence[LegalAction] = (),
) -> PlanningFeedbackEntry:
    """Project a rejection reason into a typed entry with recovery hints."""
    text = reason.strip()
    if not text:
        text = "unspecified rejection"
    if text.startswith("proposal_schema:"):
        code = "proposal_schema"
        summary = text
        hints = _FALLBACK_HINTS
    elif text in _KNOWN_REJECTION_CODES:
        code = text
        summary = text.replace("_", " ")
        hints = _REJECTION_HINTS.get(text, ())
    else:
        # Free-text reasons come from effective-domain rejections that already
        # carry their own mechanism explanation and corrective guidance.
        code = "parameter_domain"
        summary = text
        hints = _FALLBACK_HINTS
    if code == "proposal_action" and legal_actions:
        hints = (
            *hints,
            "legal knob/direction pairs: "
            + ", ".join(
                f"{action.knob_id.value}/{action.direction.value}"
                for action in legal_actions
            )[:200],
        )
    return PlanningFeedbackEntry(
        source=FeedbackSource.REJECTION,
        reason_code=code,
        summary=summary[:512],
        recovery_hints=hints[:4],
    )


def _effect_verdict(
    effect: ExpectedEffect,
    *,
    candidate_value: float | None,
    baseline_value: float | None,
) -> tuple[PredictionVerdict, float | None]:
    if candidate_value is None or baseline_value is None:
        return PredictionVerdict.UNKNOWN, None
    delta = candidate_value - baseline_value
    if effect.direction == ExpectedEffectDirection.INCREASE:
        verdict = (
            PredictionVerdict.CONFIRMED
            if delta > 0
            else PredictionVerdict.REFUTED
            if delta < 0
            else PredictionVerdict.UNKNOWN
        )
    elif effect.direction == ExpectedEffectDirection.DECREASE:
        verdict = (
            PredictionVerdict.CONFIRMED
            if delta < 0
            else PredictionVerdict.REFUTED
            if delta > 0
            else PredictionVerdict.UNKNOWN
        )
    elif effect.direction == ExpectedEffectDirection.UNCHANGED:
        verdict = (
            PredictionVerdict.CONFIRMED
            if delta == 0
            else PredictionVerdict.REFUTED
        )
    else:
        verdict = PredictionVerdict.UNKNOWN
    return verdict, delta


def outcome_attribution_entry(
    item: OptimizationHistory,
    *,
    incumbent: TerminalObservation | None,
) -> PlanningFeedbackEntry | None:
    """Join the planner's predicted effects with the recorded outcome."""
    if item.terminal_observation is None:
        return None
    baseline_replaced = item.incumbent_decision in {
        decision.value for decision in PROMOTING_DECISIONS
    }
    verdicts = []
    if item.outcome in _UNUSABLE_OUTCOMES or not item.terminal_observation.evidence_valid:
        verdicts = [
            (effect, PredictionVerdict.UNKNOWN, None)
            for effect in item.action.expected_effects
        ]
    elif baseline_replaced or incumbent is None:
        # The candidate became the incumbent, so the pre-probe baseline is no
        # longer reconstructible from current state; the recorded outcome kind
        # still answers at the episode level.
        verdicts = [
            (effect, PredictionVerdict.UNKNOWN, None)
            for effect in item.action.expected_effects
        ]
    else:
        for effect in item.action.expected_effects:
            verdict, delta = _effect_verdict(
                effect,
                candidate_value=item.terminal_observation.metrics.get(
                    effect.metric_id
                ),
                baseline_value=incumbent.metrics.get(effect.metric_id),
            )
            verdicts.append((effect, verdict, delta))
    confirmed = sum(1 for _, verdict, _ in verdicts if verdict == PredictionVerdict.CONFIRMED)
    refuted = sum(1 for _, verdict, _ in verdicts if verdict == PredictionVerdict.REFUTED)
    summary = (
        f"intervention {item.reference.intervention_id}: outcome "
        f"{item.outcome.value}"
        + (f", incumbent {item.incumbent_decision}" if item.incumbent_decision else "")
        + (f", decisive metric {item.decisive_metric}" if item.decisive_metric else "")
        + f"; predictions {confirmed} confirmed, {refuted} refuted"
        + (
            " (per-metric deltas unavailable: the candidate was promoted)"
            if baseline_replaced
            else ""
        )
    )
    return PlanningFeedbackEntry(
        source=FeedbackSource.OUTCOME_ATTRIBUTION,
        reason_code="prediction_outcome",
        summary=summary[:512],
        expected_effect_verdicts=tuple(
            ExpectedEffectVerdict(
                metric_id=effect.metric_id,
                predicted=effect.direction,
                verdict=verdict,
                observed_delta=(
                    round(delta, 12) if delta is not None else None
                ),
            )
            for effect, verdict, delta in verdicts
        ),
        outcome=item.outcome.value,
        incumbent_decision=item.incumbent_decision,
        decisive_metric=item.decisive_metric,
        intervention_id=item.reference.intervention_id,
    )


def build_planning_feedback(
    *,
    prior_decisions: Sequence[object],
    history: Sequence[OptimizationHistory],
    legal_actions: Sequence[LegalAction] = (),
    incumbent: TerminalObservation | None = None,
) -> tuple[PlanningFeedbackEntry, ...]:
    """Assemble the bounded typed feedback tuple for the next planning turn."""
    entries: list[PlanningFeedbackEntry] = []
    if prior_decisions:
        last = prior_decisions[-1]
        if (
            getattr(last, "validation_result", None) == "rejected"
            and getattr(last, "rejection_reason", None)
        ):
            persisted = getattr(last, "attribution", None)
            entries.append(
                persisted
                if isinstance(persisted, PlanningFeedbackEntry)
                else rejection_feedback_entry(
                    last.rejection_reason, legal_actions=legal_actions
                )
            )
    usable = [item for item in history if item.terminal_observation is not None]
    if usable:
        attribution = outcome_attribution_entry(usable[-1], incumbent=incumbent)
        if attribution is not None:
            entries.append(attribution)
    return tuple(entries[:2])


def build_reflection_inputs(
    *,
    prior_decisions: Sequence[object],
    history: Sequence[OptimizationHistory],
    legal_actions: Sequence[LegalAction],
    incumbent: TerminalObservation | None,
    strategy: object,
    strategy_parent_config_sha256: str | None,
    current_parent_config_sha256: str | None,
    attempted: Sequence[object],
) -> tuple[tuple[PlanningFeedbackEntry, ...], dict[str, object] | None]:
    """Assemble the typed feedback and annotated active-strategy payload."""
    from ecos_agent.optimization.strategy import annotate_strategy

    feedback = build_planning_feedback(
        prior_decisions=prior_decisions,
        history=history,
        legal_actions=legal_actions,
        incumbent=incumbent,
    )
    if strategy is None:
        return feedback, None
    payload = annotate_strategy(
        strategy,
        incumbent=incumbent,
        history=history,
        legal_actions=legal_actions,
        attempted=attempted,
        parent_config_sha256=strategy_parent_config_sha256,
        current_parent_config_sha256=current_parent_config_sha256,
    )
    return feedback, payload
