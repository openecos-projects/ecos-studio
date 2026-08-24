from __future__ import annotations

import json

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    GateResult,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationObjectiveProposal,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    SignoffGates,
    StrategyDirection,
    RequestedKnobValue,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization_memory import (
    OptimizationTaskMemoryError,
    derive_episode_task_memory,
    load_episode_task_memory,
)
from ecos_agent.optimization_rules import freeze_optimization_objective


HASH = "sha256:" + "a" * 64


def _terminal_observation(observation_id: str) -> TerminalObservation:
    return TerminalObservation(
        observation_id=observation_id,
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 1,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 2,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100.0,
        },
        timing_guardrail={
            TimingMetric.STA_SETUP_WNS: 0.1,
            TimingMetric.STA_SETUP_TNS: 0.0,
            TimingMetric.STA_HOLD_WNS: 0.1,
            TimingMetric.STA_HOLD_TNS: 0.0,
        },
    )


def _proposal(context_ref: ProposalContextRef) -> OptimizationProposal:
    return OptimizationProposal(
        context_ref=context_ref,
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="Use one bounded placement knob.",
        observation_refs=(ObservationReference(observation_id="observation-1", sha256=HASH),),
        action=ProposalAction(
            knob_id="place.cell_padding_x",
            direction=StrategyDirection.DECREASE,
            expected_effects=(
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                },
            ),
        ),
    )


def _episode(root):
    objective = freeze_optimization_objective(
        "Reduce congestion for this design only.",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
            rationale_summary="Congestion is primary.",
        ),
    )
    _append_intervention(root, objective.contract_sha256, "intervention-1")
    return objective


def _append_intervention(root, objective_sha256: str, intervention_id: str) -> None:
    context_ref = ProposalContextRef(
        episode_id="episode-1",
        checkpoint_id="place",
        input_sha256=canonical_sha256({"intervention": intervention_id}),
    )
    proposal = _proposal(context_ref)
    ledger = OptimizationLedger(root)
    ledger.append_start(
        OptimizationInterventionStart(
            intervention_id=intervention_id,
            parent_checkpoint_id="place",
            candidate_checkpoint_id=f"candidate-{intervention_id}",
            parameter_before_sha256=HASH,
            parameter_after_sha256=HASH,
            proposal_sha256=canonical_sha256(proposal.model_dump(mode="json")),
            execution_contract_sha256=HASH,
            parent_manifest_sha256=HASH,
            environment_sha256=HASH,
            objective_contract_sha256=objective_sha256,
            proposal_action=proposal.action,
            requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=3),
        )
    )
    terminal = _terminal_observation("terminal-Harden")
    ledger.append_terminal(
        OptimizationTerminalOutcome(
            intervention_id=intervention_id,
            outcome=OptimizationOutcomeKind.IMPROVED,
            candidate_manifest_sha256=HASH,
            candidate_root_ref=f".agent/optimization/episode-1/candidates/{intervention_id}",
            candidate_manifest_ref=f".agent/optimization/episode-1/candidates/{intervention_id}/manifest.json",
            receipt_sha256=HASH,
            terminal_observation_sha256=canonical_sha256(terminal.model_dump(mode="json")),
            terminal_observation=terminal,
            incumbent_decision="candidate_better",
            decisive_metric=ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            outcome_details_sha256=HASH,
        )
    )
    planning = OptimizationPlanningAudit(root).append(
        context_ref=context_ref,
        history_refs=(),
        history_outcomes=(),
        budget_snapshot=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(1.0)),
        incumbent=None,
        planner_payload_sha256=HASH,
    )
    OptimizationDecisionAudit(root).append(
        planning_entry_sha256=planning.entry_sha256,
        proposal=proposal,
        validation_result="accepted",
        rejection_reason=None,
        requested=None,
        state=OptimizationEpisodeState.AWAITING_EXECUTION,
        objective_contract_sha256=objective_sha256,
    )


def test_task_memory_is_scope_bound_evidence_bound_and_replayable(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    objective = _episode(episode_root)

    memory = derive_episode_task_memory(
        episode_root,
        workspace_id="workspace-a",
        design_id="design-a",
        design_fingerprint_sha256="sha256:" + "b" * 64,
    )

    assert memory.scope.workspace_id == "workspace-a"
    assert memory.scope.design_id == "design-a"
    assert memory.scope.episode_id == "episode-1"
    assert memory.scope.objective_contract_sha256 == objective.contract_sha256
    assert memory.entries[0].evidence.terminal_entry_sha256
    assert memory.entries[0].evidence.terminal_outcome_sha256
    assert memory.entries[0].terminal_observation is not None
    assert memory.entries[0].summary != ""
    assert "prompt" not in json.dumps(memory.model_dump(mode="json"))
    assert load_episode_task_memory(episode_root) == memory


def test_task_memory_appends_without_rewriting_prior_evidence(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    objective = _episode(episode_root)
    first = derive_episode_task_memory(
        episode_root,
        workspace_id="workspace-a",
        design_id="design-a",
        design_fingerprint_sha256="sha256:" + "b" * 64,
    )

    _append_intervention(episode_root, objective.contract_sha256, "intervention-2")
    updated = derive_episode_task_memory(
        episode_root,
        workspace_id="workspace-a",
        design_id="design-a",
        design_fingerprint_sha256="sha256:" + "b" * 64,
    )

    assert len(updated.entries) == 2
    assert updated.entries[0] == first.entries[0]


def test_task_memory_rejects_wrong_scope_and_tampering(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    _episode(episode_root)
    derive_episode_task_memory(
        episode_root,
        workspace_id="workspace-a",
        design_id="design-a",
        design_fingerprint_sha256="sha256:" + "b" * 64,
    )

    with pytest.raises(OptimizationTaskMemoryError, match="scope"):
        load_episode_task_memory(episode_root, workspace_id="workspace-b")

    path = episode_root / "optimization-task-memory.v1.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["entries"][0]["outcome"] = "degraded"
    path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
    with pytest.raises(OptimizationTaskMemoryError, match="hash"):
        load_episode_task_memory(episode_root)
