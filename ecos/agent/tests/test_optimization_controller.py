from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import pytest

from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
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
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization_ledger import OptimizationLedger, OptimizationOutcomeKind
from ecos_agent.optimization_retrieval import (
    KnowledgeChannel,
    KnowledgeChannelResult,
    OptimizationRetrievalRequest,
    OptimizationRetrievalResult,
)


HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class _FakeCodex:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.contexts = []

    def propose(self, context: object) -> object:
        self.contexts.append(context)
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        if callable(response):
            return response(context)
        return response


class _FakeEcc:
    def __init__(
        self,
        *start_receipts: CandidateExecutionReceipt,
        cancel_receipt: CandidateExecutionReceipt | None = None,
    ) -> None:
        self.start_receipts = list(start_receipts)
        self.cancel_receipt = cancel_receipt
        self.start_calls = []
        self.cancel_calls = []

    def start(self, request: object) -> CandidateExecutionReceipt:
        self.start_calls.append(request)
        return self.start_receipts.pop(0)

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        self.cancel_calls.append(intervention_id)
        assert self.cancel_receipt is not None
        return self.cancel_receipt


def _budget(*, candidates: int = 0, planning: int = 0) -> BudgetSnapshot:
    return BudgetSnapshot(
        budget=EpisodeBudget.from_default_reruns((10.0, 11.0, 12.0)),
        consumed_candidates=candidates,
        consumed_planning_calls=planning,
    )


def _observation() -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        budget=_budget(),
    )


def _retrieval() -> OptimizationRetrievalResult:
    reference = KnowledgeReference(entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH)
    request = OptimizationRetrievalRequest(
        task_id="task-1",
        current_stage="place",
        observed_metric_ids=("place_lutrudy_utilization_max",),
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
    return OptimizationRetrievalResult(
        request=request,
        channels=(channel,),
        knowledge_refs=(reference,),
    )


def _proposal(
    context: object,
    *,
    knowledge_refs: list[dict[str, str]] | None = None,
    context_ref: dict[str, str] | None = None,
    observation_refs: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    expected_context = getattr(context, "context_ref")
    expected_observation = getattr(context, "observation_ref")
    expected_knowledge = getattr(context, "knowledge_refs")
    return {
        "context_ref": context_ref or expected_context.model_dump(),
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": "Placement congestion remains high.",
        "observation_refs": observation_refs or [expected_observation.model_dump()],
        "history_refs": [],
        "knowledge_refs": (
            knowledge_refs
            if knowledge_refs is not None
            else [reference.model_dump() for reference in expected_knowledge]
        ),
        "action": {
            "knob_id": "place.cell_padding_x",
            "direction": StrategyDirection.INCREASE,
            "expected_effects": [
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                }
            ],
        },
    }


def _controller(
    tmp_path: Path,
    codex: _FakeCodex,
    ecc: _FakeEcc,
    *,
    mode: OptimizationAgentMode = OptimizationAgentMode.FULL_AGENT,
    budget: BudgetSnapshot | None = None,
    clock: _Clock | None = None,
) -> OptimizationEpisodeController:
    return OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=mode,
        budget=budget or _budget(),
        planner=codex,
        executor=ecc,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=clock or _Clock(),
    )


def _started(execution_id: str = "execution-1") -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(execution_id=execution_id, started=True)


def _terminal(
    outcome: OptimizationOutcomeKind,
    execution_id: str = "execution-1",
) -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(execution_id=execution_id, started=True, outcome=outcome)


def test_full_agent_accepts_only_current_context_and_retrieved_knowledge(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_terminal(OptimizationOutcomeKind.DEGRADED))
    controller = _controller(tmp_path, codex, ecc)

    planned = controller.plan(_observation(), _retrieval())

    assert planned.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert planned.proposal is not None
    assert codex.contexts[0].knowledge_chunks == ("Audited congestion strategy.",)
    completed = controller.execute()
    assert completed.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_planning_calls == 1
    assert controller.budget.consumed_candidates == 1
    assert len(ecc.start_calls) == 1
    assert controller.ledger.replay().terminal_outcomes[0].outcome == OptimizationOutcomeKind.DEGRADED


@pytest.mark.parametrize(
    "mutation",
    [
        lambda context: _proposal(
            context,
            context_ref={**context.context_ref.model_dump(), "checkpoint_id": "other-checkpoint"},
        ),
        lambda context: _proposal(
            context,
            observation_refs=[
                ObservationReference(observation_id="old-observation", sha256=HASH).model_dump()
            ],
        ),
        lambda context: _proposal(
            context,
            knowledge_refs=[
                KnowledgeReference(entity_id="strategy.congestion.other.v1", chunk_sha256=CHUNK_HASH).model_dump()
            ],
        ),
        lambda context: {**_proposal(context), "workspace": "/tmp/escape"},
    ],
)
def test_contract_mutations_are_rejected_before_fake_ecc_side_effects(
    tmp_path: Path,
    mutation: Callable[[object], dict[str, object]],
) -> None:
    codex = _FakeCodex(mutation)
    ecc = _FakeEcc()
    controller = _controller(tmp_path, codex, ecc)

    rejected = controller.plan(_observation(), _retrieval())

    assert rejected.proposal is None
    assert rejected.rejection_reason is not None
    assert rejected.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_planning_calls == 1
    assert controller.budget.consumed_candidates == 0
    assert ecc.start_calls == []


def test_no_knowledge_mode_hides_chunks_and_rejects_knowledge_references(tmp_path: Path) -> None:
    codex = _FakeCodex(
        lambda context: _proposal(
            context,
            knowledge_refs=[KnowledgeReference(entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH).model_dump()],
        )
    )
    controller = _controller(
        tmp_path,
        codex,
        _FakeEcc(),
        mode=OptimizationAgentMode.LLM_NO_KNOWLEDGE,
    )

    rejected = controller.plan(_observation(), _retrieval())

    assert codex.contexts[0].knowledge_chunks == ()
    assert codex.contexts[0].knowledge_refs == ()
    assert rejected.rejection_reason == "no_knowledge_reference"
    assert rejected.proposal is None


def test_budget_exhaustion_stops_without_calling_fake_codex(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    controller = _controller(tmp_path, codex, _FakeEcc(), budget=_budget(candidates=6))

    stopped = controller.plan(_observation(), _retrieval())

    assert stopped.state == OptimizationEpisodeState.STOPPED
    assert codex.contexts == []


@pytest.mark.parametrize(
    ("decision", "expected_state"),
    [
        (OptimizationDecision.CONTINUE, OptimizationEpisodeState.PLANNING),
        (OptimizationDecision.STOP, OptimizationEpisodeState.STOPPED),
        (OptimizationDecision.ESCALATE, OptimizationEpisodeState.ESCALATED),
    ],
)
def test_non_action_decisions_never_reach_fake_ecc(
    tmp_path: Path,
    decision: OptimizationDecision,
    expected_state: OptimizationEpisodeState,
) -> None:
    def response(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal["decision"] = decision
        proposal.pop("action")
        return proposal

    ecc = _FakeEcc()
    controller = _controller(tmp_path, _FakeCodex(response), ecc)

    result = controller.plan(_observation(), _retrieval())

    assert result.state == expected_state
    assert result.proposal is not None
    assert ecc.start_calls == []


def test_missing_fake_ecc_receipt_is_charged_and_quarantined(tmp_path: Path) -> None:
    class _NoReceiptEcc(_FakeEcc):
        def start(self, request: object) -> CandidateExecutionReceipt:
            self.start_calls.append(request)
            raise RuntimeError("connection lost after request")

    controller = _controller(tmp_path, _FakeCodex(_proposal), _NoReceiptEcc())
    controller.plan(_observation(), _retrieval())

    result = controller.execute()

    assert result.state == OptimizationEpisodeState.QUARANTINED
    assert controller.budget.consumed_candidates == 1
    assert controller.ledger.replay().terminal_outcomes[0].outcome == OptimizationOutcomeKind.INDETERMINATE


def test_not_started_retries_once_without_consuming_a_candidate(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(
        CandidateExecutionReceipt(execution_id="execution-1", started=False),
        CandidateExecutionReceipt(execution_id="execution-2", started=False),
    )
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval())

    result = controller.execute()

    assert result.state == OptimizationEpisodeState.PLANNING
    assert result.rejection_reason == "execution_not_started"
    assert len(ecc.start_calls) == 2
    assert controller.budget.consumed_candidates == 0
    assert controller.ledger.replay().entries == ()


def test_timeout_cancels_once_and_quarantines_when_fake_ecc_has_no_receipt(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_started(), cancel_receipt=_started())
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval())
    controller.execute()

    quarantined = controller.timeout()

    assert quarantined.state == OptimizationEpisodeState.QUARANTINED
    assert controller.budget.consumed_candidates == 1
    assert len(ecc.cancel_calls) == 1
    assert controller.ledger.replay().terminal_outcomes[0].outcome == OptimizationOutcomeKind.INDETERMINATE
    with pytest.raises(OptimizationEpisodeControllerError, match="already requested"):
        controller.timeout()


def test_timeout_with_terminal_cancel_receipt_preserves_negative_outcome(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(
        _started(),
        cancel_receipt=_terminal(OptimizationOutcomeKind.TIMED_OUT_CANCELLED),
    )
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval())
    controller.execute()

    result = controller.timeout()

    assert result.state == OptimizationEpisodeState.PLANNING
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.TIMED_OUT_CANCELLED
    )


def test_recovery_quarantines_pending_execution_and_rejects_tampered_state(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_started())
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval())
    controller.execute()

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
    )
    assert recovered.state == OptimizationEpisodeState.QUARANTINED
    assert recovered.budget.consumed_candidates == 1

    state_path = controller.state_path
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["state"] = "planning"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    with pytest.raises(OptimizationEpisodeControllerError, match="state hash"):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
        )
