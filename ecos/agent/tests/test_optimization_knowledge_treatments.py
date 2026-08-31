from __future__ import annotations

from dataclasses import replace

import pytest

from ecos_agent.optimization_equal_budget import CandidateTrace, EqualBudgetConfig
from ecos_agent.optimization_knowledge_treatments import (
    KNOWLEDGE_TREATMENTS,
    KnowledgeTreatment,
    build_knowledge_treatment_report,
)


def _trace(
    treatment: KnowledgeTreatment,
    design_id: str,
    utility: float,
    *,
    effective: bool,
    candidate_index: int = 0,
) -> CandidateTrace:
    return CandidateTrace(
        design_id=design_id,
        candidate_id=f"{treatment.value}.{design_id}.{candidate_index}",
        started=True,
        terminal_success=True,
        planning_mode="receipt-aware",
        terminal_utility=utility,
        reference_utility=10.0,
        requested_value=0.7,
        application_status="applied",
        activation_status="used" if effective else "not_activated",
        application_signature=f"app.{treatment.value}.{design_id}",
        response_signature=f"response.{treatment.value}.{design_id}",
        receipt_status="ok",
    )


def test_frozen_knowledge_treatments_map_to_bounded_runtime_modes() -> None:
    assert [item.treatment for item in KNOWLEDGE_TREATMENTS] == [
        KnowledgeTreatment.LLM_NO_KNOWLEDGE,
        KnowledgeTreatment.CURRENT_METRIC_ID_RAW_RAG,
        KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT,
    ]
    assert [item.agent_mode for item in KNOWLEDGE_TREATMENTS] == [
        "llm_no_knowledge",
        "raw_rag",
        "full_agent",
    ]
    assert [item.knowledge_case_shots for item in KNOWLEDGE_TREATMENTS] == [0, 0, 3]
    assert all(item.receipt_aware_planning for item in KNOWLEDGE_TREATMENTS)


def test_treatment_report_applies_all_go_gates_at_the_design_level() -> None:
    no_knowledge = KnowledgeTreatment.LLM_NO_KNOWLEDGE
    raw_rag = KnowledgeTreatment.CURRENT_METRIC_ID_RAW_RAG
    full = KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT
    design_ids = tuple(f"d{index}" for index in range(10))
    traces = {
        no_knowledge: tuple(
            _trace(
                no_knowledge,
                design_id,
                8.0,
                effective=False,
                candidate_index=candidate_index,
            )
            for design_id in design_ids
            for candidate_index in range(2)
        ),
        raw_rag: tuple(
            _trace(
                raw_rag,
                design_id,
                9.0,
                effective=design_id == "d0",
                candidate_index=candidate_index,
            )
            for design_id in design_ids
            for candidate_index in range(2)
        ),
        full: tuple(
            _trace(
                full,
                design_id,
                11.0,
                effective=True,
                candidate_index=candidate_index,
            )
            for design_id in design_ids
            for candidate_index in range(2)
        ),
    }
    flags = {treatment: True for treatment in KnowledgeTreatment}

    report = build_knowledge_treatment_report(
        traces,
        planning_calls_by_treatment={treatment: 20 for treatment in traces},
        config=EqualBudgetConfig(reference_runtime_seconds=2.0),
        design_ids=design_ids,
        rule_guided_utility_by_design={design_id: -1.0 for design_id in design_ids},
        budget_complete_by_treatment=flags,
        terminal_artifacts_complete_by_treatment=flags,
        replay_chain_complete_by_treatment=flags,
        selected_cases_by_treatment={
            treatment: 20 if treatment == full else 0 for treatment in traces
        },
        case_selection_events_by_treatment={
            treatment: 20 if treatment == full else 0 for treatment in traces
        },
        nonempty_case_selection_events_by_treatment={
            treatment: 20 if treatment == full else 0 for treatment in traces
        },
    )

    assert report["schema_version"] == "ecos.optimization_knowledge_treatment_report.v1"
    assert report["evaluation_status"] == "completed"
    assert report["go_no_go"]["decision"] == "go"
    assert all(report["go_no_go"]["criteria"].values())
    assert report["paired_utility"]["full_vs_no_knowledge"][
        "mean_paired_difference"
    ] == 2.0
    assert report["paired_utility"]["full_vs_raw_rag"]["win_tie_loss"] == {
        "win": 10,
        "tie": 0,
        "loss": 0,
    }
    assert report["diagnostics"][full.value]["effective_intervention_rate"] == 1.0
    assert (
        report["diagnostics"][no_knowledge.value]["ineffective_candidate_rate"]
        == 1.0
    )


def test_treatment_report_does_not_assess_incomplete_evidence() -> None:
    traces = {
        treatment: (
            _trace(treatment, "d0", 10.0, effective=True),
        )
        for treatment in KnowledgeTreatment
    }
    complete = {treatment: True for treatment in KnowledgeTreatment}
    incomplete_replay = dict(complete)
    incomplete_replay[KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT] = False

    report = build_knowledge_treatment_report(
        traces,
        planning_calls_by_treatment={treatment: 1 for treatment in traces},
        config=EqualBudgetConfig(),
        design_ids=tuple(f"d{index}" for index in range(10)),
        rule_guided_utility_by_design=None,
        budget_complete_by_treatment=complete,
        terminal_artifacts_complete_by_treatment=complete,
        replay_chain_complete_by_treatment=incomplete_replay,
        selected_cases_by_treatment={treatment: 0 for treatment in traces},
        case_selection_events_by_treatment={treatment: 0 for treatment in traces},
        nonempty_case_selection_events_by_treatment={
            treatment: 0 for treatment in traces
        },
    )

    assert report["evaluation_status"] == "incomplete"
    assert report["go_no_go"]["decision"] == "not_assessed"
    assert report["go_no_go"]["criteria"]["full_not_worse_than_rule_guided"] is None
    assert report["research_claim"] == "not_assessed"
    assert report["research_classification"] == "Research Claim Not Assessed"
    assert report["design_coverage"]["missing"] == [
        f"d{index}" for index in range(1, 10)
    ]


def test_full_treatment_with_partial_case_coverage_remains_not_assessed() -> None:
    no_knowledge = KnowledgeTreatment.LLM_NO_KNOWLEDGE
    raw_rag = KnowledgeTreatment.CURRENT_METRIC_ID_RAW_RAG
    full = KnowledgeTreatment.STATE_CONDITIONED_DUAL_LAYER_FEW_SHOT
    design_ids = tuple(f"d{index}" for index in range(10))
    traces = {
        no_knowledge: tuple(
            _trace(no_knowledge, design_id, 8.0, effective=False, candidate_index=index)
            for design_id in design_ids
            for index in range(2)
        ),
        raw_rag: tuple(
            _trace(raw_rag, design_id, 9.0, effective=design_id == "d0", candidate_index=index)
            for design_id in design_ids
            for index in range(2)
        ),
        full: tuple(
            _trace(full, design_id, 11.0, effective=True, candidate_index=index)
            for design_id in design_ids
            for index in range(2)
        ),
    }
    complete = {treatment: True for treatment in KnowledgeTreatment}

    report = build_knowledge_treatment_report(
        traces,
        planning_calls_by_treatment={treatment: 20 for treatment in traces},
        config=EqualBudgetConfig(reference_runtime_seconds=2.0),
        design_ids=design_ids,
        rule_guided_utility_by_design={design_id: -1.0 for design_id in design_ids},
        budget_complete_by_treatment=complete,
        terminal_artifacts_complete_by_treatment=complete,
        replay_chain_complete_by_treatment=complete,
        selected_cases_by_treatment={
            treatment: 3 if treatment == full else 0 for treatment in traces
        },
        case_selection_events_by_treatment={
            treatment: 20 if treatment == full else 0 for treatment in traces
        },
        nonempty_case_selection_events_by_treatment={
            treatment: 1 if treatment == full else 0 for treatment in traces
        },
    )

    assert report["evaluation_status"] == "incomplete"
    assert report["research_claim"] == "not_assessed"
    assert report["research_classification"] == "Research Claim Not Assessed"
    assert report["go_no_go"]["decision"] == "not_assessed"
    assert report["go_no_go"]["criteria"][
        "few_shot_cases_present_only_in_full_treatment"
    ] is False
    assert report["evidence_completeness"]["selected_cases"][full.value] == 3
    assert report["evidence_completeness"]["nonempty_case_selection_events"][
        full.value
    ] == 1


def test_treatment_report_rejects_reused_candidate_execution() -> None:
    traces = {
        treatment: (
            replace(
                _trace(treatment, "d0", 10.0, effective=True),
                candidate_id="shared-candidate",
            ),
        )
        for treatment in KnowledgeTreatment
    }
    flags = {treatment: False for treatment in KnowledgeTreatment}

    with pytest.raises(ValueError, match="independent candidate executions"):
        build_knowledge_treatment_report(
            traces,
            planning_calls_by_treatment={treatment: 1 for treatment in traces},
            config=EqualBudgetConfig(),
            design_ids=tuple(f"d{index}" for index in range(10)),
            rule_guided_utility_by_design=None,
            budget_complete_by_treatment=flags,
            terminal_artifacts_complete_by_treatment=flags,
            replay_chain_complete_by_treatment=flags,
            selected_cases_by_treatment={treatment: 0 for treatment in traces},
            case_selection_events_by_treatment={treatment: 0 for treatment in traces},
            nonempty_case_selection_events_by_treatment={
                treatment: 0 for treatment in traces
            },
        )
