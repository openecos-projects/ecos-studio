from __future__ import annotations

from pathlib import Path

from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    KnowledgeReference,
    ObjectiveMetric,
    OptimizationDecision,
    OptimizationEpisodeState,
    ProposalReason,
    StageObservation,
    StrategyDirection,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationPlanningContext,
)
from ecos_agent.optimization_ledger import OptimizationLedger, OptimizationOutcomeKind
from ecos_agent.optimization_retrieval import (
    KnowledgeChannel,
    KnowledgeChannelResult,
    OptimizationRetrievalRequest,
    OptimizationRetrievalResult,
)
from ecos_agent.optimization_runner import OptimizationEpisodeRunner


_HASH = "sha256:" + "a" * 64
_CHUNK_HASH = "b" * 64
_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
}


class _Clock:
    def __call__(self) -> float:
        return 0.0


class _FakePlanner:
    def __init__(self) -> None:
        self.contexts: list[OptimizationPlanningContext] = []

    def propose(self, context: OptimizationPlanningContext) -> object:
        self.contexts.append(context)
        if not context.history:
            return _proposal(context, "place.cell_padding_x", StrategyDirection.INCREASE)
        assert len(context.history) == 1
        assert context.history[0].outcome == OptimizationOutcomeKind.DEGRADED
        return _proposal(
            context,
            "place.target_density",
            StrategyDirection.DECREASE,
            history_refs=[context.history[0].reference.model_dump()],
        )


class _FakeExecutor:
    def __init__(self) -> None:
        self.receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.DEGRADED,
                ),
                CandidateExecutionReceipt(
                    execution_id="execution-2",
                    started=True,
                    outcome=OptimizationOutcomeKind.IMPROVED,
                ),
            )
        )

    def start(self, request: object) -> CandidateExecutionReceipt:
        return next(self.receipts)

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        raise AssertionError("the fake runner never cancels a terminal receipt")


def _budget() -> BudgetSnapshot:
    return BudgetSnapshot(budget=EpisodeBudget.from_default_reruns((10.0, 11.0, 12.0)))


def _proposal(
    context: OptimizationPlanningContext,
    knob_id: str,
    direction: StrategyDirection,
    *,
    history_refs: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "context_ref": context.context_ref.model_dump(),
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": "Use the next bounded congestion strategy.",
        "observation_refs": [context.observation_ref.model_dump()],
        "history_refs": history_refs or [],
        "knowledge_refs": [reference.model_dump() for reference in context.knowledge_refs],
        "action": {
            "knob_id": knob_id,
            "direction": direction,
            "expected_effects": [
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                }
            ],
        },
    }


def _observation(budget: BudgetSnapshot) -> StageObservation:
    return StageObservation(
        observation_id=f"observation-{budget.consumed_candidates + 1}",
        stage="place",
        evidence_manifest_sha256=_HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        budget=budget,
    )


def _retrieval(
    observation: StageObservation,
    previous_outcome: OptimizationOutcomeKind | None,
) -> OptimizationRetrievalResult:
    reference = KnowledgeReference(entity_id="strategy.congestion.padding.v1", chunk_sha256=_CHUNK_HASH)
    request = OptimizationRetrievalRequest(
        task_id="task-1",
        current_stage=observation.stage,
        observed_metric_ids=tuple(sorted(observation.metrics)),
        previous_intervention_outcome=previous_outcome,
    )
    channel = KnowledgeChannelResult(
        channel=KnowledgeChannel.GENERAL,
        enabled=True,
        query="fixed query",
        query_sha256="c" * 64,
        corpus_sha256="d" * 64,
        answer_text="Audited congestion strategy.",
        knowledge_refs=(reference,),
    )
    return OptimizationRetrievalResult(request, (channel,), (reference,))


def test_fake_runner_completes_two_replanning_turns_with_bounded_history(tmp_path: Path) -> None:
    planner = _FakePlanner()
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=_FakeExecutor(),
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
    )

    first = runner.run_turn()
    second = runner.run_turn()

    assert first.execution is not None
    assert second.execution is not None
    assert controller.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_candidates == 2
    assert controller.budget.consumed_planning_calls == 2
    assert first.retrieval.request.previous_intervention_outcome is None
    assert second.retrieval.request.previous_intervention_outcome == OptimizationOutcomeKind.DEGRADED
    assert planner.contexts[0].history == ()
    assert planner.contexts[1].history[0].requested.value == 3
    assert planner.contexts[0].context_ref.input_sha256 != planner.contexts[1].context_ref.input_sha256
    assert [outcome.outcome for outcome in controller.ledger.replay().terminal_outcomes] == [
        OptimizationOutcomeKind.DEGRADED,
        OptimizationOutcomeKind.IMPROVED,
    ]
