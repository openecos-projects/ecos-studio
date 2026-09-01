"""Frozen knowledge treatments and design-blocked utility reporting."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Mapping, Sequence, TypeVar

from ecos_agent.optimization.experiments.equal_budget import (
    CandidateTrace,
    EqualBudgetConfig,
    evaluate_equal_budget,
    validate_design_manifest,
)
from ecos_agent.optimization.experiments.statistics import paired_design_statistics

_T = TypeVar("_T")


class KnowledgeTreatment(StrEnum):
    LLM_NO_KNOWLEDGE = "llm-no-knowledge"
    CURRENT_METRIC_ID_RAW_RAG = "current-metric-id-raw-rag"
    STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT = (
        "state-conditioned-dual-layer-few-shot"
    )


@dataclass(frozen=True, slots=True)
class KnowledgeTreatmentConfig:
    treatment: KnowledgeTreatment
    agent_mode: str
    knowledge_case_shots: int
    receipt_aware_planning: bool = True

    def __post_init__(self) -> None:
        if self.agent_mode not in {"llm_no_knowledge", "raw_rag", "full_agent"}:
            raise ValueError("knowledge treatment agent mode is invalid")
        if self.knowledge_case_shots not in {0, 3}:
            raise ValueError("knowledge treatment case shots must be zero or three")
        if self.receipt_aware_planning is not True:
            raise ValueError("knowledge treatments require receipt-aware planning")


KNOWLEDGE_TREATMENTS = (
    KnowledgeTreatmentConfig(
        KnowledgeTreatment.LLM_NO_KNOWLEDGE,
        "llm_no_knowledge",
        0,
    ),
    KnowledgeTreatmentConfig(
        KnowledgeTreatment.CURRENT_METRIC_ID_RAW_RAG,
        "raw_rag",
        0,
    ),
    KnowledgeTreatmentConfig(
        KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT,
        "full_agent",
        3,
    ),
)


def build_knowledge_treatment_report(
    traces_by_treatment: Mapping[
        KnowledgeTreatment | str, Sequence[CandidateTrace]
    ],
    *,
    planning_calls_by_treatment: Mapping[KnowledgeTreatment | str, int],
    config: EqualBudgetConfig,
    design_ids: Sequence[str],
    rule_guided_utility_by_design: Mapping[str, float | int] | None,
    budget_complete_by_treatment: Mapping[KnowledgeTreatment | str, bool],
    terminal_artifacts_complete_by_treatment: Mapping[
        KnowledgeTreatment | str, bool
    ],
    replay_chain_complete_by_treatment: Mapping[KnowledgeTreatment | str, bool],
    selected_cases_by_treatment: Mapping[KnowledgeTreatment | str, int],
    case_selection_events_by_treatment: Mapping[KnowledgeTreatment | str, int],
    nonempty_case_selection_events_by_treatment: Mapping[
        KnowledgeTreatment | str, int
    ],
) -> dict[str, object]:
    """Summarize the three pre-registered treatments without changing accounting."""
    frozen_design_ids = validate_design_manifest(design_ids)
    traces = _treatment_mapping(traces_by_treatment, "traces")
    planning_calls = _treatment_mapping(
        planning_calls_by_treatment, "planning calls"
    )
    budget_complete = _boolean_treatment_mapping(
        budget_complete_by_treatment, "budget completeness"
    )
    terminal_complete = _boolean_treatment_mapping(
        terminal_artifacts_complete_by_treatment, "terminal artifact completeness"
    )
    replay_complete = _boolean_treatment_mapping(
        replay_chain_complete_by_treatment, "replay chain completeness"
    )
    selected_cases = _treatment_mapping(
        selected_cases_by_treatment, "selected case counts"
    )
    selection_events = _treatment_mapping(
        case_selection_events_by_treatment, "case selection event counts"
    )
    nonempty_selection_events = _treatment_mapping(
        nonempty_case_selection_events_by_treatment,
        "nonempty case selection event counts",
    )
    counts = (*selected_cases.values(), *selection_events.values(), *nonempty_selection_events.values())
    if any(type(value) is not int or value < 0 for value in counts):
        raise ValueError("knowledge treatment case selection counts are invalid")
    _validate_independent_executions(traces)
    summaries = {
        treatment: evaluate_equal_budget(
            traces[treatment],
            mode="receipt-aware",
            config=config,
            planning_calls=planning_calls[treatment],
        )
        for treatment in KnowledgeTreatment
    }
    scores = {
        treatment: _utility_scores(summary.simple_regret_by_design)
        for treatment, summary in summaries.items()
    }
    observed_design_ids = set(scores[KnowledgeTreatment.LLM_NO_KNOWLEDGE])
    if not observed_design_ids or any(
        set(values) != observed_design_ids for values in scores.values()
    ):
        raise ValueError("knowledge treatments must cover the same designs")
    coverage_complete = observed_design_ids == set(frozen_design_ids)
    per_design_limit = config.candidate_limit // len(frozen_design_ids)
    budget_complete = {
        treatment: budget_complete[treatment]
        and summaries[treatment].started_candidates == config.candidate_limit
        and planning_calls[treatment] >= summaries[treatment].started_candidates
        and all(
            sum(
                item.started and item.design_id == design_id
                for item in traces[treatment]
            )
            == per_design_limit
            for design_id in frozen_design_ids
        )
        for treatment in KnowledgeTreatment
    }

    full = KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT
    no_knowledge = KnowledgeTreatment.LLM_NO_KNOWLEDGE
    raw_rag = KnowledgeTreatment.CURRENT_METRIC_ID_RAW_RAG
    comparisons = {
        "full_vs_no_knowledge": paired_design_statistics(
            scores[full], scores[no_knowledge]
        ),
        "full_vs_raw_rag": paired_design_statistics(scores[full], scores[raw_rag]),
    }
    rule_scores = _rule_guided_scores(
        rule_guided_utility_by_design, observed_design_ids
    )
    if rule_scores is not None:
        comparisons["full_vs_rule_guided"] = paired_design_statistics(
            scores[full], rule_scores
        )

    diagnostics = {
        treatment: _diagnostics(traces[treatment])
        for treatment in KnowledgeTreatment
    }
    criteria = _go_no_go_criteria(
        comparisons,
        scores,
        diagnostics,
        budget_complete,
        terminal_complete,
        replay_complete,
        rule_scores is not None,
        coverage_complete,
        selected_cases,
        selection_events,
        nonempty_selection_events,
        planning_calls,
    )
    few_shot_complete = (
        selection_events[full] == planning_calls[full]
        and nonempty_selection_events[full] == selection_events[full]
        and selected_cases[full] >= nonempty_selection_events[full] > 0
        and selected_cases[no_knowledge] == 0
        and selected_cases[raw_rag] == 0
        and selection_events[no_knowledge] == 0
        and selection_events[raw_rag] == 0
    )
    completed = (
        coverage_complete
        and few_shot_complete
        and all(value is not None for value in criteria.values())
        and all(
            (
                *budget_complete.values(),
                *terminal_complete.values(),
                *replay_complete.values(),
            )
        )
    )
    decision = (
        "go"
        if completed and all(criteria.values())
        else "no_go"
        if completed
        else "not_assessed"
    )
    return {
        "schema_version": "ecos.optimization_knowledge_treatment_report.v1",
        "evaluation_status": "completed" if completed else "incomplete",
        "research_claim": (
            "supported"
            if decision == "go"
            else "not_supported"
            if decision == "no_go"
            else "not_assessed"
        ),
        "research_classification": (
            "Research Claim Supported"
            if decision == "go"
            else "Research Claim Not Supported"
            if decision == "no_go"
            else "Research Claim Not Assessed"
        ),
        "treatment_configs": [
            {
                "treatment": item.treatment.value,
                "agent_mode": item.agent_mode,
                "knowledge_case_shots": item.knowledge_case_shots,
                "receipt_aware_planning": item.receipt_aware_planning,
            }
            for item in KNOWLEDGE_TREATMENTS
        ],
        "design_coverage": {
            "required": list(frozen_design_ids),
            "observed": [
                design_id
                for design_id in frozen_design_ids
                if design_id in observed_design_ids
            ],
            "missing": [
                design_id
                for design_id in frozen_design_ids
                if design_id not in observed_design_ids
            ],
        },
        "paired_utility_metric": "negative_simple_regret",
        "summaries": {
            treatment.value: summary.to_dict()
            for treatment, summary in summaries.items()
        },
        "paired_utility": comparisons,
        "diagnostics": {
            treatment.value: values for treatment, values in diagnostics.items()
        },
        "evidence_completeness": {
            "equal_budget": _string_keys(budget_complete),
            "terminal_artifacts": _string_keys(terminal_complete),
            "replay_chain": _string_keys(replay_complete),
            "selected_cases": {
                treatment.value: count
                for treatment, count in selected_cases.items()
            },
            "case_selection_events": _string_keys(selection_events),
            "nonempty_case_selection_events": _string_keys(
                nonempty_selection_events
            ),
        },
        "go_no_go": {"decision": decision, "criteria": criteria},
    }


def _treatment_mapping(
    values: Mapping[KnowledgeTreatment | str, _T], label: str
) -> dict[KnowledgeTreatment, _T]:
    try:
        result = {KnowledgeTreatment(key): value for key, value in values.items()}
    except (TypeError, ValueError) as exc:
        raise ValueError(f"knowledge treatment {label} are invalid") from exc
    if set(result) != set(KnowledgeTreatment) or len(result) != len(values):
        raise ValueError(f"knowledge treatment {label} must contain all treatments")
    return result


def _boolean_treatment_mapping(
    values: Mapping[KnowledgeTreatment | str, bool], label: str
) -> dict[KnowledgeTreatment, bool]:
    result = _treatment_mapping(values, label)
    if any(type(value) is not bool for value in result.values()):
        raise ValueError(f"knowledge treatment {label} must be boolean")
    return result


def _utility_scores(
    regrets: Mapping[str, float | None],
) -> dict[str, float]:
    if not regrets or any(value is None for value in regrets.values()):
        raise ValueError("paired utility requires terminal regret for every design")
    return {design_id: -float(value) for design_id, value in regrets.items()}


def _rule_guided_scores(
    values: Mapping[str, float | int] | None, design_ids: set[str]
) -> dict[str, float] | None:
    if values is None:
        return None
    if set(values) != design_ids:
        raise ValueError("Rule-Guided utility must cover the treatment designs")
    return {design_id: float(value) for design_id, value in values.items()}


def _diagnostics(traces: Sequence[CandidateTrace]) -> dict[str, float | int]:
    started = tuple(item for item in traces if item.started)
    effective = sum(
        item.activation_status == "used"
        or (
            item.requested_value is False
            and item.application_status == "applied"
            and item.activation_status == "not_activated"
        )
        for item in started
    )
    count = len(started)
    return {
        "started_candidates": count,
        "effective_interventions": effective,
        "effective_intervention_rate": effective / count if count else 0.0,
        "ineffective_candidates": count - effective,
        "ineffective_candidate_rate": (count - effective) / count if count else 0.0,
    }


def _validate_independent_executions(
    traces: Mapping[KnowledgeTreatment, Sequence[CandidateTrace]],
) -> None:
    seen: set[str] = set()
    for treatment in KnowledgeTreatment:
        candidate_ids = {
            item.candidate_id for item in traces[treatment] if item.started
        }
        started_count = sum(item.started for item in traces[treatment])
        if len(candidate_ids) != started_count or seen & candidate_ids:
            raise ValueError(
                "knowledge treatments require independent candidate executions"
            )
        seen.update(candidate_ids)


def _go_no_go_criteria(
    comparisons: Mapping[str, Mapping[str, object]],
    scores: Mapping[KnowledgeTreatment, Mapping[str, float]],
    diagnostics: Mapping[KnowledgeTreatment, Mapping[str, float | int]],
    budget_complete: Mapping[KnowledgeTreatment, bool],
    terminal_complete: Mapping[KnowledgeTreatment, bool],
    replay_complete: Mapping[KnowledgeTreatment, bool],
    has_rule_guided: bool,
    coverage_complete: bool,
    selected_cases: Mapping[KnowledgeTreatment, int],
    selection_events: Mapping[KnowledgeTreatment, int],
    nonempty_selection_events: Mapping[KnowledgeTreatment, int],
    planning_calls: Mapping[KnowledgeTreatment, int],
) -> dict[str, bool | None]:
    full = KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT
    references = (
        KnowledgeTreatment.LLM_NO_KNOWLEDGE,
        KnowledgeTreatment.CURRENT_METRIC_ID_RAW_RAG,
    )
    full_effective = float(diagnostics[full]["effective_intervention_rate"])
    full_ineffective = float(diagnostics[full]["ineffective_candidate_rate"])
    reference_effective = [
        float(diagnostics[item]["effective_intervention_rate"])
        for item in references
    ]
    reference_ineffective = [
        float(diagnostics[item]["ineffective_candidate_rate"])
        for item in references
    ]
    improved_effectiveness = (
        full_effective >= max(reference_effective)
        and full_effective > min(reference_effective)
    ) or (
        full_ineffective <= min(reference_ineffective)
        and full_ineffective < max(reference_ineffective)
    )
    multi_design_gain = sum(
        scores[full][design_id]
        > scores[KnowledgeTreatment.LLM_NO_KNOWLEDGE][design_id]
        for design_id in scores[full]
    ) >= 2
    rule_comparison = comparisons.get("full_vs_rule_guided")
    return {
        "full_better_than_no_knowledge": _mean_difference(
            comparisons["full_vs_no_knowledge"]
        )
        > 0,
        "full_not_worse_than_raw_rag": _mean_difference(
            comparisons["full_vs_raw_rag"]
        )
        >= 0,
        "full_not_worse_than_rule_guided": (
            _mean_difference(rule_comparison) >= 0
            if has_rule_guided and rule_comparison is not None
            else None
        ),
        "gain_spans_multiple_designs": multi_design_gain,
        "effective_intervention_improved_or_ineffective_reduced": (
            improved_effectiveness
        ),
        "frozen_ten_design_coverage_complete": coverage_complete,
        "few_shot_cases_present_only_in_full_treatment": (
            selection_events[full] == planning_calls[full]
            and nonempty_selection_events[full] == selection_events[full]
            and selected_cases[full] >= nonempty_selection_events[full] > 0
            and all(
                selected_cases[item] == 0
                and selection_events[item] == 0
                and nonempty_selection_events[item] == 0
                for item in references
            )
        ),
        "equal_budget_complete": all(budget_complete.values()),
        "terminal_artifacts_and_replay_complete": all(terminal_complete.values())
        and all(replay_complete.values()),
    }


def _mean_difference(summary: Mapping[str, object]) -> float:
    return float(summary["mean_paired_difference"])


def _string_keys(values: Mapping[KnowledgeTreatment, bool]) -> dict[str, bool]:
    return {treatment.value: value for treatment, value in values.items()}
