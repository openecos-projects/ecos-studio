from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import pytest

from ecos_agent.codex_rpc import CodexProviderError
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    KnobApplicationReceipt,
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationObjectiveContract,
    OptimizationObjectiveProposal,
    PlanningProviderEnvelope,
    PlanningProviderEvidence,
    ProposalReason,
    RequestedKnobValue,
    RuntimeAdjustment,
    StageObservation,
    StrategyDirection,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationEpisodeControllerError,
    planning_context_payload,
)
from ecos_agent.optimization_decision_audit import (
    OptimizationDecisionAudit,
    OptimizationDecisionAuditIntegrityError,
)
from ecos_agent.optimization_ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
)
from ecos_agent.optimization_memory import (
    OptimizationTaskMemoryStore,
    build_task_memory_scope,
)
from ecos_agent.optimization_retrieval import (
    KnowledgeChannel,
    KnowledgeChannelResult,
    OptimizationRetrievalRequest,
    OptimizationRetrievalResult,
)
from ecos_agent.optimization_rules import freeze_optimization_objective

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64
CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
    "synth.max_fanout": 32,
}


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


class _AuditedFakeCodex(_FakeCodex):
    def consume_planning_evidence(self) -> PlanningProviderEvidence | None:
        payload = {
            "schema_version": "ecos.optimization_planning_provider_envelope.v1",
            "provider_id": "codex_app_server",
            "requested_model": "test-model",
            "prompt": "bounded test prompt",
            "output_schema": {"type": "object"},
            "planner_payload_sha256": canonical_sha256(
                planning_context_payload(self.contexts[-1])
            ),
        }
        return PlanningProviderEvidence(
            provider_id="codex_app_server",
            thread_id="thread-1",
            turn_id=f"turn-{len(self.contexts)}",
            response_sha256=HASH,
            diagnostics_sha256=HASH,
            envelope=PlanningProviderEnvelope(
                **payload, envelope_sha256=canonical_sha256(payload)
            ),
        )


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
        budget=EpisodeBudget.from_reference_rerun(11.0),
        consumed_candidates=candidates,
        consumed_planning_calls=planning,
    )


def _objective() -> OptimizationObjectiveContract:
    return freeze_optimization_objective(
        "Minimize route wirelength while preserving DRC and congestion.",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            ),
            rationale_summary="Wirelength is primary; routing quality remains constrained.",
        ),
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
    task_memory_refs: list[dict[str, str]] | None = None,
    knob_id: str = "place.cell_padding_x",
    direction: StrategyDirection = StrategyDirection.INCREASE,
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
        "task_memory_refs": task_memory_refs or [],
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


def _controller(
    tmp_path: Path,
    codex: _FakeCodex,
    ecc: _FakeEcc,
    *,
    mode: OptimizationAgentMode = OptimizationAgentMode.FULL_AGENT,
    budget: BudgetSnapshot | None = None,
    clock: _Clock | None = None,
    objective: OptimizationObjectiveContract | None = None,
    task_memory=None,
    receipt_aware_planning: bool = True,
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
        objective=objective,
        task_memory_scope_sha256=(
            task_memory.scope.scope_sha256 if task_memory is not None else None
        ),
        task_memory_supplier=(lambda: task_memory) if task_memory is not None else None,
        receipt_aware_planning=receipt_aware_planning,
    )


def _started(execution_id: str = "execution-1") -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(execution_id=execution_id, started=True)


def _terminal(
    outcome: OptimizationOutcomeKind,
    execution_id: str = "execution-1",
) -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(execution_id=execution_id, started=True, outcome=outcome)


def _application_receipt() -> KnobApplicationReceipt:
    return KnobApplicationReceipt(
        receipt_id="receipt-1",
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=3),
        written=AppliedKnobValue(knob_id="place.cell_padding_x", value=600),
        effective_initial=AppliedKnobValue(knob_id="place.cell_padding_x", value=600),
        runtime_adjustments=(
            RuntimeAdjustment(
                effective_value=AppliedKnobValue(
                    knob_id="place.cell_padding_x", value=400
                ),
                reason="capacity_cap",
                evidence_sha256=HASH,
            ),
        ),
        effective_final=AppliedKnobValue(knob_id="place.cell_padding_x", value=400),
        evidence_sha256=HASH,
    )


def _density_receipt(requested: RequestedKnobValue) -> KnobApplicationReceipt:
    assert requested.knob_id.value == "place.target_density"
    return KnobApplicationReceipt(
        receipt_id="receipt-density",
        requested=requested,
        written=AppliedKnobValue(knob_id=requested.knob_id, value=requested.value),
        effective_initial=AppliedKnobValue(
            knob_id=requested.knob_id, value=0.8
        ),
        effective_final=AppliedKnobValue(knob_id=requested.knob_id, value=0.8),
        evidence_sha256=HASH,
    )


def _density_proposal(context: object) -> dict[str, object]:
    return _proposal(
        context,
        knob_id="place.target_density",
        direction=StrategyDirection.INCREASE,
    )


def _task_memory_snapshot(tmp_path: Path):
    objective = _objective()
    scope = build_task_memory_scope(
        workspace_manifest_sha256=HASH,
        design_id="design-a",
        checkpoint_id="checkpoint-1",
        episode_id="episode-1",
        objective_contract_sha256=objective.contract_sha256,
    )
    return OptimizationTaskMemoryStore(tmp_path / "task-memory", scope).snapshot()


def test_full_agent_accepts_only_current_context_and_retrieved_knowledge(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_terminal(OptimizationOutcomeKind.DEGRADED))
    controller = _controller(tmp_path, codex, ecc)

    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert planned.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert planned.proposal is not None
    assert planned.requested is not None
    assert planned.requested.value == 3
    assert codex.contexts[0].knowledge_chunks == ("Audited congestion strategy.",)
    completed = controller.execute()
    assert completed.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_planning_calls == 1
    assert controller.budget.consumed_candidates == 1
    assert len(ecc.start_calls) == 1
    assert controller.ledger.replay().terminal_outcomes[0].outcome == OptimizationOutcomeKind.DEGRADED


def test_controller_binds_codex_turn_evidence_to_the_planning_audit(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _AuditedFakeCodex(_proposal),
        _FakeEcc(_started()),
    )

    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    planning = OptimizationPlanningAudit(tmp_path / "episode").replay()
    provider = OptimizationPlanningProviderEvidenceAudit(tmp_path / "episode").replay()
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert provider.entries[0].planning_entry_sha256 == planning.entries[0].entry_sha256
    assert state["planning_provider_audit_event_count"] == 1
    assert state["planning_provider_audit_chain_head_sha256"] == provider.chain_head_sha256
    recovered = OptimizationEpisodeController.recover(
        planner=_AuditedFakeCodex(_proposal),
        executor=_FakeEcc(_started()),
        ledger=controller.ledger,
        clock=_Clock(),
    )
    assert recovered.state == OptimizationEpisodeState.AWAITING_EXECUTION


def test_controller_binds_task_memory_snapshot_and_rejects_unknown_refs(
    tmp_path: Path,
) -> None:
    snapshot = _task_memory_snapshot(tmp_path)
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(_started()),
        objective=_objective(),
        task_memory=snapshot,
    )

    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert planned.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert controller.planner.contexts[0].task_memory == snapshot
    audit = OptimizationPlanningAudit(tmp_path / "episode").replay().entries[0]
    assert audit.task_memory_snapshot_sha256 == snapshot.snapshot_sha256
    assert audit.task_memory_refs == ()
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert state["task_memory_scope_sha256"] == snapshot.scope.scope_sha256
    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(_started()),
        ledger=controller.ledger,
        clock=_Clock(),
        task_memory_scope_sha256=snapshot.scope.scope_sha256,
        task_memory_supplier=lambda: snapshot,
    )
    assert recovered.task_memory_scope_sha256 == snapshot.scope.scope_sha256

    def unknown_ref(context):
        return _proposal(
            context,
            task_memory_refs=[{"summary_sha256": HASH}],
        )

    rejected = _controller(
        tmp_path / "unknown",
        _FakeCodex(unknown_ref),
        _FakeEcc(_started()),
        objective=_objective(),
        task_memory=snapshot,
    ).plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert rejected.rejection_reason == "task_memory_reference"


def test_controller_persists_attempted_requested_values(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal, _proposal),
        _FakeEcc(
            _terminal(OptimizationOutcomeKind.DEGRADED, "execution-1"),
            _terminal(OptimizationOutcomeKind.DEGRADED, "execution-2"),
        ),
    )

    assert controller.plan(_observation(), _retrieval(), CURRENT_VALUES).requested.value == 3
    controller.execute()
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert planned.requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=4
    )
    assert planned.rejection_reason is None


def test_planning_context_compiles_hash_bound_domain_for_active_knobs(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(_proposal)
    controller = _controller(tmp_path, codex, _FakeEcc())

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == OptimizationEpisodeState.AWAITING_EXECUTION
    context = codex.contexts[0]
    assert len(context.effective_domains) == 7
    assert {item.knob_id.value for item in context.effective_domains} == set(
        CURRENT_VALUES
    ) - {"place.routability_opt"}
    assert context.current_values is not None
    assert set(context.current_values) == set(CURRENT_VALUES) - {
        "place.routability_opt"
    }
    assert all(item.snapshot_sha256.startswith("sha256:") for item in context.effective_domains)
    payload = planning_context_payload(context)
    assert len(payload["effective_domains"]) == 7
    assert payload["effective_domains"][0]["snapshot_sha256"] == context.effective_domains[0].snapshot_sha256
    audit = OptimizationPlanningAudit(tmp_path / "episode").replay()
    assert tuple(
        item.snapshot_sha256 for item in audit.entries[0].effective_domains
    ) == tuple(item.snapshot_sha256 for item in context.effective_domains)


def test_requested_only_planning_does_not_expose_receipts_or_task_memory(
    tmp_path: Path,
) -> None:
    task_memory = _task_memory_snapshot(tmp_path)
    planner = _FakeCodex(_proposal, _proposal)
    controller = _controller(
        tmp_path,
        planner,
        _FakeEcc(_started()),
        objective=_objective(),
        task_memory=task_memory,
        receipt_aware_planning=False,
    )

    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert first.requested is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            application_receipt=_application_receipt(),
        ),
        incumbent_decision="incumbent_retained",
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context = planner.contexts[1]
    assert context.task_memory is None
    assert context.history[0].application_receipt is None
    assert context.history[0].parameter_application_receipt is None
    assert all(not domain.thresholds for domain in context.effective_domains)
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert state["receipt_aware_planning"] is False


def test_recovery_rejects_planning_mode_drift(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(),
        receipt_aware_planning=False,
    )

    with pytest.raises(
        OptimizationEpisodeControllerError,
        match="planning mode does not match",
    ):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
            receipt_aware_planning=True,
        )


def test_planning_domain_excludes_attempted_value_without_rewriting_proposal(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(_proposal)
    controller = _controller(tmp_path, codex, _FakeEcc())
    controller._attempted_request_values = (
        RequestedKnobValue(knob_id="place.target_density", value=0.85),
    )

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context = codex.contexts[0]
    density = next(
        item for item in context.effective_domains if item.knob_id.value == "place.target_density"
    )
    assert 0.85 in density.excluded_aliases
    assert 0.85 not in density.allowed_requested_values
    assert result.requested != RequestedKnobValue(
        knob_id="place.target_density", value=0.75
    )


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

    rejected = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

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

    rejected = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert codex.contexts[0].knowledge_chunks == ()
    assert codex.contexts[0].knowledge_refs == ()
    assert rejected.rejection_reason == "no_knowledge_reference"
    assert rejected.proposal is None


def test_budget_exhaustion_stops_without_calling_fake_codex(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    controller = _controller(tmp_path, codex, _FakeEcc(), budget=_budget(candidates=20))

    stopped = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert stopped.state == OptimizationEpisodeState.STOPPED
    assert codex.contexts == []


@pytest.mark.parametrize(
    ("decision", "expected_state"),
    [
        (OptimizationDecision.CONTINUE, OptimizationEpisodeState.PLANNING),
        (OptimizationDecision.STOP, OptimizationEpisodeState.PLANNING),
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

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == expected_state
    assert result.proposal is not None
    assert ecc.start_calls == []


def test_controller_defers_early_stop_then_uses_local_fallback(tmp_path: Path) -> None:
    def stop(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.STOP,
            reason_code=ProposalReason.NO_LEGAL_CANDIDATE,
            rationale_summary="No evidence-backed action remains.",
        )
        proposal.pop("action")
        return proposal

    controller = _controller(tmp_path, _FakeCodex(stop, stop), _FakeEcc(_started()))

    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert first.state == OptimizationEpisodeState.PLANNING
    assert first.rejection_reason == "minimum_candidates_not_met"
    assert second.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert second.requested is not None
    assert second.rejection_reason == "controlled_coordinate_fallback"


def test_controller_uses_local_fallback_after_codex_parse_error(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _AuditedFakeCodex(
            lambda context: _proposal(
                context,
                observation_refs=[
                    context.observation_ref.model_dump(),
                    ObservationReference(
                        observation_id="terminal-Harden", sha256=HASH
                    ).model_dump(),
                ],
            ),
            CodexProviderError("schema validation", failure_class="parse_error"),
        ),
        _FakeEcc(_started()),
    )

    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert first.rejection_reason == "observation_reference"
    assert second.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert second.rejection_reason == "controlled_coordinate_fallback"


class _V2FakeCodex(_FakeCodex):
    def __init__(self, *responses: object) -> None:
        super().__init__()
        self.v2_responses = list(responses)
        self.v2_calls = []

    def propose(self, context: object) -> object:
        raise AssertionError("v1 planner must not be used when v2 is enabled")

    def propose_v2(self, context: object, domain: object) -> object:
        self.v2_calls.append((context, domain))
        response = self.v2_responses.pop(0)
        return response(context, domain) if callable(response) else response


def _v2_proposal(context: object, domain: object, *, value: object = None) -> dict[str, object]:
    action = context.legal_actions[0]
    current = context.current_values[action.knob_id.value]
    if value is None:
        candidates = (
            item for item in domain.allowed_requested_values
            if item > current
            if action.direction == StrategyDirection.INCREASE
        )
        value = next(candidates, None)
        if value is None:
            value = next(
                item for item in domain.allowed_requested_values if item < current
            )
    return {
        "schema_version": "ecos.optimization_proposal.v2",
        "context_ref": context.context_ref.model_dump(mode="json"),
        "decision": "propose",
        "reason_code": "observation",
        "rationale_summary": "Use one exact bounded value.",
        "observation_refs": [context.observation_ref.model_dump(mode="json")],
        "knowledge_refs": [
            item.model_dump(mode="json") for item in context.knowledge_refs
        ],
        "action": {
            "knob_id": action.knob_id.value,
            "direction": action.direction.value,
            "requested_value": value,
            "effective_domain_sha256": domain.snapshot_sha256,
            "expected_effects": [
                {"metric_id": "route_wirelength", "direction": "decrease"}
            ],
        },
    }


def test_controller_uses_exact_v2_value_only_when_feature_enabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")
    planner = _V2FakeCodex(_v2_proposal)
    controller = _controller(tmp_path, planner, _FakeEcc())

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context, domain = planner.v2_calls[0]
    assert result.requested is not None
    assert result.requested.value in domain.allowed_requested_values
    assert result.requested.knob_id == context.legal_actions[0].knob_id
    assert result.planner_source == "llm"


def test_controller_repairs_one_invalid_v2_response_before_accepting_exact_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")

    def invalid(context: object, domain: object) -> dict[str, object]:
        return _v2_proposal(context, domain, value=999)

    planner = _V2FakeCodex(invalid, _v2_proposal)
    controller = _controller(tmp_path, planner, _FakeEcc())

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert len(planner.v2_calls) == 2
    assert result.requested is not None
    assert result.planner_source == "repair"
    decision = OptimizationDecisionAudit(tmp_path / "episode").replay().entries[-1]
    assert decision.planner_source == "repair"


def test_controller_falls_back_immediately_after_v2_repair_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1")
    planner = _V2FakeCodex(
        lambda context, domain: _v2_proposal(context, domain, value=999),
        lambda context, domain: _v2_proposal(context, domain, value=999),
    )
    controller = _controller(tmp_path, planner, _FakeEcc())

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert result.rejection_reason == "v2_repair_failed"
    assert result.planner_source == "local_fallback"
    decision = OptimizationDecisionAudit(tmp_path / "episode").replay().entries[-1]
    assert decision.planner_source == "local_fallback"


def test_stop_is_deferred_until_fixed_candidate_budget_is_exhausted(tmp_path: Path) -> None:
    def stop(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.STOP,
            reason_code=ProposalReason.OBSERVATION,
            rationale_summary="The bounded search is complete.",
        )
        proposal.pop("action")
        return proposal

    controller = _controller(
        tmp_path,
        _FakeCodex(stop),
        _FakeEcc(),
        budget=_budget(candidates=2),
    )

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert result.state == OptimizationEpisodeState.PLANNING
    assert result.rejection_reason == "minimum_candidates_not_met"


def test_planning_decisions_are_hash_bound_and_replayable(tmp_path: Path) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    entries = OptimizationDecisionAudit(tmp_path / "episode").replay().entries
    assert len(entries) == 1
    assert entries[0].proposal == result.proposal
    assert entries[0].validation_result == "accepted"
    assert entries[0].requested == result.requested


def test_objective_is_bound_to_planning_state_decision_and_execution(tmp_path: Path) -> None:
    objective = _objective()
    codex = _FakeCodex(_proposal)
    controller = _controller(
        tmp_path,
        codex,
        _FakeEcc(_started()),
        objective=objective,
    )

    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    assert codex.contexts[0].objective == objective
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert state["objective"] == objective.model_dump(mode="json")
    start = controller.ledger.replay().entries[0].payload
    assert start.objective_contract_sha256 == objective.contract_sha256
    decision = OptimizationDecisionAudit(tmp_path / "episode").replay().entries[0]
    assert decision.objective_contract_sha256 == objective.contract_sha256


def test_recovery_preserves_the_frozen_objective(tmp_path: Path) -> None:
    objective = _objective()
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(_started()),
        objective=objective,
    )

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
    )

    assert recovered.objective == objective


def test_missing_fake_ecc_receipt_is_charged_and_quarantined(tmp_path: Path) -> None:
    class _NoReceiptEcc(_FakeEcc):
        def start(self, request: object) -> CandidateExecutionReceipt:
            self.start_calls.append(request)
            raise RuntimeError("connection lost after request")

    controller = _controller(tmp_path, _FakeCodex(_proposal), _NoReceiptEcc())
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    result = controller.execute()

    assert result.state == OptimizationEpisodeState.QUARANTINED
    assert controller.budget.consumed_candidates == 1
    assert controller.ledger.replay().terminal_outcomes[0].outcome == OptimizationOutcomeKind.INDETERMINATE
    state = json.loads(controller.state_path.read_text(encoding="utf-8"))
    assert state["attempted_requests"] == [
        {"knob_id": "place.cell_padding_x", "value": 3}
    ]


def test_not_started_retries_once_without_consuming_a_candidate(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(
        CandidateExecutionReceipt(execution_id="execution-1", started=False),
        CandidateExecutionReceipt(execution_id="execution-2", started=False),
    )
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

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
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
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
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    result = controller.timeout()

    assert result.state == OptimizationEpisodeState.PLANNING
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.TIMED_OUT_CANCELLED
    )


def test_terminal_outcome_can_only_complete_the_pending_execution(tmp_path: Path) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    result = controller.complete_terminal(
        _terminal(OptimizationOutcomeKind.DEGRADED, "execution-1")
    )

    assert result.state == OptimizationEpisodeState.PLANNING
    assert controller.ledger.replay().terminal_outcomes[0].outcome == OptimizationOutcomeKind.DEGRADED


def test_controller_persists_effective_value_receipt_in_terminal_ledger(tmp_path: Path) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            application_receipt=_application_receipt(),
        )
    )

    outcome = controller.ledger.replay().terminal_outcomes[0]
    assert outcome.application_receipt is not None
    assert outcome.application_receipt.effective_final.value == 400


def test_recovery_uses_non_promoted_effective_density_history_for_next_value(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_density_proposal),
        _FakeEcc(_started()),
    )
    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert first.requested is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            application_receipt=_density_receipt(first.requested),
        ),
        incumbent_decision="incumbent_retained",
    )

    def stop(context: object) -> dict[str, object]:
        proposal = _proposal(context)
        proposal.update(
            decision=OptimizationDecision.STOP,
            reason_code=ProposalReason.NO_LEGAL_CANDIDATE,
        )
        proposal.pop("action")
        return proposal

    planner = _FakeCodex(stop, stop)
    monkeypatch.setattr(
        "ecos_agent.optimization_controller.legal_actions",
        lambda **_: (
            LegalAction(
                knob_id="place.target_density",
                direction=StrategyDirection.INCREASE,
            ),
        ),
    )
    recovered = OptimizationEpisodeController.recover(
        planner=planner,
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
    )
    deferred = recovered.plan(_observation(), _retrieval(), CURRENT_VALUES)
    planned = recovered.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context = planner.contexts[0]
    assert context.history[0].application_receipt is not None
    assert context.history[0].application_receipt.effective_initial.value == 0.8
    assert tuple(item.value for item in context.excluded_surface_values) == (0.55,)
    assert (
        "place.target_density",
        StrategyDirection.DECREASE,
    ) not in tuple((item.knob_id.value, item.direction) for item in context.legal_actions)
    assert deferred.state == OptimizationEpisodeState.PLANNING
    assert planned.rejection_reason == "controlled_coordinate_fallback"
    assert planned.requested == RequestedKnobValue(
        knob_id="place.target_density", value=0.75
    )


def test_promoting_another_knob_invalidates_the_density_floor(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_density_proposal, _proposal, _density_proposal),
        _FakeEcc(_started("execution-1"), _started("execution-2")),
    )
    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert first.requested is not None
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
            application_receipt=_density_receipt(first.requested),
        ),
        incumbent_decision="incumbent_retained",
    )
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert second.requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=3
    )
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-2",
            started=True,
            outcome=OptimizationOutcomeKind.IMPROVED,
            application_receipt=_application_receipt(),
        ),
        incumbent_decision="candidate_better",
    )

    planned = controller.plan(
        _observation(),
        _retrieval(),
        {**CURRENT_VALUES, "place.cell_padding_x": 3},
    )

    assert tuple(
        item.value for item in controller.planner.contexts[2].excluded_surface_values
    ) == (0.55, 3)
    assert planned.requested == RequestedKnobValue(
        knob_id="place.target_density", value=0.75
    )


def test_recovery_quarantines_pending_execution_and_rejects_tampered_state(tmp_path: Path) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_started())
    controller = _controller(tmp_path, codex, ecc)
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
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


@pytest.mark.parametrize("version", ("v2", "v5"))
def test_recovery_rejects_a_pre_policy_episode(tmp_path: Path, version: str) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.state_path.rename(controller.state_path.with_name(f"optimization-episode-state.{version}.json"))

    with pytest.raises(OptimizationEpisodeControllerError, match="pre-policy"):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
        )


def test_decision_audit_rejects_malformed_hash_and_tampered_record(tmp_path: Path) -> None:
    audit = OptimizationDecisionAudit(tmp_path / "episode")
    with pytest.raises(ValueError, match="hash is invalid"):
        audit.append(
            planning_entry_sha256="sha256:" + "z" * 64,
            proposal=None,
            validation_result="rejected",
            rejection_reason="proposal_schema",
            requested=None,
            state=OptimizationEpisodeState.PLANNING,
        )

    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()))
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    path = OptimizationDecisionAudit(tmp_path / "episode").audit_path
    record = json.loads(path.read_text(encoding="utf-8"))
    record["rejection_reason"] = "tampered"
    path.write_text(json.dumps(record) + "\n", encoding="utf-8")

    with pytest.raises(OptimizationDecisionAuditIntegrityError, match="record 1 is invalid"):
        OptimizationDecisionAudit(tmp_path / "episode").verify()
