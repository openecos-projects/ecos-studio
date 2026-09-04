from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationEpisodeState,
    StrategyDirection,
    TimingMetric,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationPlanningContext,
)
from ecos_agent.optimization.experiments.equal_budget import export_episode_traces
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningAuditIntegrityError,
)
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditIntegrityError
from ecos_agent.optimization.rules import IncumbentDecision
from ecos_agent.optimization.runner import OptimizationEpisodeRunner

_HASH = "sha256:" + "a" * 64
_CHUNK_HASH = "b" * 64
_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
}
_TIMING_GUARDRAIL = {metric: 0.0 for metric in TimingMetric}



from tests.optimization.runner_support import (
    _Clock,
    _FakeExecutor,
    _FakePlanner,
    _ImmediateSuccessfulExecutor,
    _RoutabilityFalseExecutor,
    _RoutabilityPlanner,
    _budget,
    _evidence,
    _execution_context,
    _incumbent,
    _native_receipt,
    _objective,
    _observation,
    _proposal,
    _retrieval,
    _terminal_observation,
)

def test_runner_accepts_false_routability_candidate_with_not_activated_branch(
    tmp_path: Path,
) -> None:
    planner = _RoutabilityPlanner()
    executor = _RoutabilityFalseExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-routability-false",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=None,
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )

    turn = runner.run_turn()

    assert turn.incumbent_comparison is not None
    assert turn.incumbent_comparison.decision == IncumbentDecision.INITIALIZED
    assert controller.incumbent is not None
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.EXECUTION_SUCCEEDED
    )
    runner.close()


def test_runner_validates_immediate_success_before_completing(tmp_path: Path) -> None:
    executor = _ImmediateSuccessfulExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-immediate-success",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=_FakePlanner(),
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=None,
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )

    turn = runner.run_turn()

    assert turn.terminal_observation is not None
    assert turn.incumbent_comparison is not None
    assert turn.incumbent_comparison.decision == IncumbentDecision.INITIALIZED
    assert controller.incumbent is not None
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.EXECUTION_SUCCEEDED
    )


def test_fake_runner_completes_two_replanning_turns_with_bounded_history(
    tmp_path: Path,
) -> None:
    planner = _FakePlanner()
    executor = _FakeExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=_incumbent(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )

    first = runner.run_turn()
    second = runner.run_turn()

    assert first.execution is not None
    assert second.execution is not None
    assert controller.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_candidates == 2
    assert controller.budget.consumed_planning_calls == 2
    assert first.retrieval.request.previous_intervention_outcome is None
    assert (
        second.retrieval.request.previous_intervention_outcome
        == OptimizationOutcomeKind.DEGRADED
    )
    assert planner.contexts[0].history == ()
    assert planner.contexts[1].history[0].requested.value == 3
    assert planner.contexts[1].current_values is not None
    assert planner.contexts[1].current_values["place.cell_padding_x"] == 2
    assert executor.requests[0].parent_candidate_root_ref is None
    assert executor.requests[1].parent_candidate_root_ref is None
    assert planner.contexts[1].history[0].terminal_observation is not None
    assert (
        planner.contexts[1]
        .history[0]
        .terminal_observation.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW]
        == 3.0
    )
    assert first.incumbent_comparison is not None
    assert first.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    assert second.incumbent_comparison is not None
    assert second.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert controller.incumbent is not None
    assert controller.incumbent.observation_id == "terminal-execution-2"
    assert controller.incumbent_candidate_root_ref == ".agent/candidates/execution-2"
    assert runner._current_values["place.target_density"] == 0.8
    assert (
        planner.contexts[0].context_ref.input_sha256
        != planner.contexts[1].context_ref.input_sha256
    )
    assert [
        outcome.outcome for outcome in controller.ledger.replay().terminal_outcomes
    ] == [
        OptimizationOutcomeKind.DEGRADED,
        OptimizationOutcomeKind.IMPROVED,
    ]
    assert all(
        outcome.terminal_observation_sha256 is not None
        for outcome in controller.ledger.replay().terminal_outcomes
    )
    assert all(
        outcome.candidate_manifest_sha256 == _HASH
        for outcome in controller.ledger.replay().terminal_outcomes
    )
    assert controller.ledger.replay().terminal_outcomes[0].incumbent_decision == (
        IncumbentDecision.CANDIDATE_INELIGIBLE.value
    )
    assert controller.ledger.replay().terminal_outcomes[0].decisive_metric is None
    planning_audit = OptimizationPlanningAudit(tmp_path / "episode").replay()
    assert [entry.history_count for entry in planning_audit.entries] == [0, 1]
    assert planning_audit.entries[1].history_refs[0].intervention_id == "intervention-1"
    assert all(
        entry.planner_payload_sha256.startswith("sha256:")
        for entry in planning_audit.entries
    )
    for execution_id in ("execution-1", "execution-2"):
        flow_path = (
            tmp_path / ".agent" / "candidates" / execution_id / "home" / "flow.json"
        )
        flow_path.parent.mkdir(parents=True)
        flow_path.write_text(
            json.dumps(
                {
                    "steps": [
                        {
                            "name": "place",
                            "runtime": "0:0:2",
                            "peak memory (mb)": 64.0,
                        },
                        {
                            "name": "Harden",
                            "runtime": "0:0:1",
                            "peak memory (mb)": 32.0,
                        },
                    ]
                }
            ),
            encoding="utf-8",
        )
    traces, planning_calls, planning_mode = export_episode_traces(
        workspace=tmp_path,
        episode_root=tmp_path / "episode",
        design_id="gcd",
        reference_observation=_incumbent(),
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
    )
    started_traces = [item for item in traces if item.started]
    assert planning_calls == 2
    assert planning_mode == "receipt-aware"
    assert len(started_traces) == 2
    assert all(item.receipt_status == "ok" for item in started_traces)
    case_audit_path = tmp_path / "episode" / "optimization-knowledge-cases.v1.jsonl"
    case_audit = case_audit_path.read_text(encoding="utf-8")
    case_audit_path.write_text(
        case_audit.replace('"shot_count":0', '"shot_count":3', 1),
        encoding="utf-8",
    )
    with pytest.raises(EmpiricalCaseAuditIntegrityError, match="invalid"):
        export_episode_traces(
            workspace=tmp_path,
            episode_root=tmp_path / "episode",
            design_id="gcd",
            reference_observation=_incumbent(),
            objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        )
    case_audit_path.write_text(case_audit, encoding="utf-8")
    audit_path = tmp_path / "episode" / "optimization-planning-audit.v1.jsonl"
    audit_path.write_text(
        audit_path.read_text(encoding="utf-8").replace(
            '"history_count":1', '"history_count":0'
        ),
        encoding="utf-8",
    )
    with pytest.raises(OptimizationPlanningAuditIntegrityError, match="invalid hash"):
        OptimizationPlanningAudit(tmp_path / "episode").verify()
    runner.close()
    assert (controller.ledger.root / "optimization-ledger-manifest.v1.json").is_file()


def test_requested_only_runner_tracks_requested_not_effective_value(
    tmp_path: Path,
) -> None:
    class DensityPlanner(_FakePlanner):
        def propose(self, context: OptimizationPlanningContext) -> object:
            self.contexts.append(context)
            return _proposal(
                context,
                "place.target_density",
                StrategyDirection.DECREASE,
            )

    planner = DensityPlanner()
    executor = _FakeExecutor()
    executor.start_receipts = iter(
        (CandidateExecutionReceipt(execution_id="execution-2", started=True),)
    )
    executor.terminal_receipts = iter(
        (
            CandidateExecutionReceipt(
                execution_id="execution-2",
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                evidence=_evidence("execution-2"),
                parameter_application_receipt=_native_receipt(
                    "place.target_density", 0.15, effective_value=0.8
                ),
            ),
        )
    )
    controller = OptimizationEpisodeController(
        episode_id="episode-requested-only",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=_incumbent(),
        receipt_aware_planning=False,
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )

    runner.run_turn()

    assert runner._current_values["place.target_density"] == 0.15


def test_runner_persists_stopped_when_stop_arrives_before_ecc_start(
    tmp_path: Path,
) -> None:
    stop_event = threading.Event()

    class StopAfterProposalPlanner(_FakePlanner):
        def propose(self, context: OptimizationPlanningContext) -> object:
            proposal = super().propose(context)
            stop_event.set()
            return proposal

    class NoStartExecutor(_FakeExecutor):
        def start(self, _request: object) -> CandidateExecutionReceipt:
            raise AssertionError("stop before execution must not start ECC")

    executor = NoStartExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-stop-before-start",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=StopAfterProposalPlanner(),
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=_incumbent(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        stop_event=stop_event,
    )

    turn = runner.run_turn()

    assert turn.execution is not None
    assert turn.execution.state == OptimizationEpisodeState.STOPPED
    assert controller.state == OptimizationEpisodeState.STOPPED
    assert controller.ledger.replay().entries == ()
    persisted = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert persisted["state"] == "stopped"
