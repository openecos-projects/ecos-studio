from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Callable

import pytest
from tests.optimization.support import support_catalog

from .support import (
    CHUNK_HASH,
    CURRENT_VALUES,
    HASH,
    _AuditedFakeCodex,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _controller,
    _execution_context,
    _native_receipt,
    _objective,
    _observation,
    _proposal,
    _retrieval,
    _started,
    _task_memory_snapshot,
    _terminal,
)

from ecos_agent.optimization.contracts import (
    KnowledgeReference,
    ObservationReference,
    OptimizationEpisodeState,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationEpisodeControllerError,
    planning_context_payload,
)
from ecos_agent.optimization.knowledge.compiler import (
    BoundKnowledgeAction,
    StatePredicate,
)
from ecos_agent.optimization.knowledge.cases import (
    EmpiricalCaseAuditStore,
    EmpiricalCaseDiagnostic,
    EmpiricalOutcome,
    TerminalEmpiricalCase,
)
from ecos_agent.optimization.ledger import (
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
)


def test_full_agent_accepts_only_current_context_and_retrieved_knowledge(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(_proposal)
    ecc = _FakeEcc(_terminal(OptimizationOutcomeKind.DEGRADED))
    controller = _controller(tmp_path, codex, ecc)

    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert planned.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert planned.proposal is not None
    assert planned.requested is not None
    assert planned.requested.value == 3
    assert codex.contexts[0].knowledge_chunks == ()
    assert codex.contexts[0].supported_action_view is not None
    completed = controller.execute()
    assert completed.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_planning_calls == 1
    assert controller.budget.consumed_candidates == 1
    assert len(ecc.start_calls) == 1
    assert (
        controller.ledger.replay().terminal_outcomes[0].outcome
        == OptimizationOutcomeKind.DEGRADED
    )


def test_full_agent_exposes_state_matched_claim_outside_raw_top_three(
    tmp_path: Path,
) -> None:
    retrieval = _retrieval()
    base = support_catalog(
        retrieval.knowledge_refs[0], feature_id="missing_required_metric"
    )
    hidden_ref = KnowledgeReference(
        entity_id="strategy.congestion.state_matched.v1",
        chunk_sha256="f" * 64,
    )
    hidden_claim = base.claims[0].model_copy(
        update={
            "claim_ref": hidden_ref,
            "claim_sha256": "sha256:" + "f" * 64,
            "state_predicates": (
                StatePredicate(
                    feature_id="place_lutrudy_utilization_max",
                    op="present",
                    rule_ref="rules.evidence.present.v1",
                ),
            ),
        }
    )
    hidden_binding = base.bindings[0].model_copy(
        update={
            "binding_id": "binding.state_matched.v1",
            "binding_sha256": "sha256:" + "f" * 64,
            "claim_id": hidden_ref.entity_id,
            "claim_sha256": hidden_claim.claim_sha256,
        }
    )
    catalog = base.model_copy(
        update={
            "claims": (*base.claims, hidden_claim),
            "bindings": (*base.bindings, hidden_binding),
        }
    )
    retrieval = replace(retrieval, support_catalog=catalog)
    codex = _FakeCodex(_proposal)
    controller = _controller(tmp_path, codex, _FakeEcc())

    planned = controller.plan(_observation(), retrieval, CURRENT_VALUES)

    assert planned.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert codex.contexts[0].knowledge_refs == (hidden_ref,)
    view = codex.contexts[0].supported_action_view
    assert view is not None
    assert len(view.matches) == 2
    assert view.exposed_claim_refs == (hidden_ref,)


def test_full_agent_rejects_retrieved_claim_that_does_not_support_action(
    tmp_path: Path,
) -> None:
    retrieval = _retrieval()
    binding = retrieval.support_catalog.bindings[0].model_copy(
        update={
            "actions": (
                BoundKnowledgeAction(
                    knob_id="place.cell_padding_x",
                    direction=StrategyDirection.INCREASE,
                ),
            )
        }
    )
    retrieval = replace(
        retrieval,
        support_catalog=retrieval.support_catalog.model_copy(
            update={"bindings": (binding,)}
        ),
    )
    codex = _FakeCodex(
        lambda context: _proposal(
            context,
            knob_id="place.cell_padding_x",
            direction=StrategyDirection.DECREASE,
        )
    )
    ecc = _FakeEcc()

    rejected = _controller(tmp_path, codex, ecc).plan(
        _observation(), retrieval, CURRENT_VALUES
    )

    assert rejected.rejection_reason == "knowledge_action_support"
    assert rejected.proposal is None
    assert ecc.start_calls == []


def test_controller_binds_codex_turn_evidence_to_the_planning_audit(
    tmp_path: Path,
) -> None:
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
    assert (
        state["planning_provider_audit_chain_head_sha256"] == provider.chain_head_sha256
    )
    recovered = OptimizationEpisodeController.recover(
        planner=_AuditedFakeCodex(_proposal),
        executor=_FakeEcc(_started()),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
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
        execution_context=_execution_context(),
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

    assert (
        controller.plan(_observation(), _retrieval(), CURRENT_VALUES).requested.value
        == 3
    )
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
    assert len(context.effective_domains) == 8
    assert {item.knob_id.value for item in context.effective_domains} == set(
        CURRENT_VALUES
    )
    assert context.current_values is not None
    assert set(context.current_values) == set(CURRENT_VALUES)
    assert all(
        item.snapshot_sha256.startswith("sha256:") for item in context.effective_domains
    )
    supported = context.supported_action_view.actions[0]
    domain = next(
        item for item in context.effective_domains if item.knob_id == supported.knob_id
    )
    assert supported.effective_domain_sha256 == domain.snapshot_sha256
    assert set(supported.allowed_requested_values) <= set(
        domain.allowed_requested_values
    )
    payload = planning_context_payload(context)
    assert payload["supported_action_view"] == context.supported_action_view.planner_payload()
    assert len(payload["effective_domains"]) == 8
    assert (
        payload["effective_domains"][0]["snapshot_sha256"]
        == context.effective_domains[0].snapshot_sha256
    )
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
            parameter_application_receipt=_native_receipt(first.requested),
        ),
        incumbent_decision="incumbent_retained",
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    context = planner.contexts[1]
    assert context.task_memory is None
    assert not hasattr(context.history[0], "application_receipt")
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
            execution_context=_execution_context(),
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
        item
        for item in context.effective_domains
        if item.knob_id.value == "place.target_density"
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
            context_ref={
                **context.context_ref.model_dump(),
                "checkpoint_id": "other-checkpoint",
            },
        ),
        lambda context: _proposal(
            context,
            observation_refs=[
                ObservationReference(
                    observation_id="old-observation", sha256=HASH
                ).model_dump()
            ],
        ),
        lambda context: _proposal(
            context,
            knowledge_refs=[
                KnowledgeReference(
                    entity_id="strategy.congestion.other.v1", chunk_sha256=CHUNK_HASH
                ).model_dump()
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


def test_no_knowledge_mode_hides_chunks_and_rejects_knowledge_references(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(
        lambda context: _proposal(
            context,
            knowledge_refs=[
                KnowledgeReference(
                    entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH
                ).model_dump()
            ],
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


def test_raw_rag_mode_exposes_retrieval_without_state_conditioned_support(
    tmp_path: Path,
) -> None:
    codex = _FakeCodex(
        lambda context: _proposal(
            context,
            knob_id="synth.max_fanout",
            direction=StrategyDirection.DECREASE,
        )
    )
    controller = _controller(
        tmp_path,
        codex,
        _FakeEcc(),
        mode=OptimizationAgentMode.RAW_RAG,
    )

    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    assert codex.contexts[0].knowledge_refs == _retrieval().knowledge_refs
    assert codex.contexts[0].supported_action_view is None
    assert result.rejection_reason is None


def test_knowledge_case_shots_are_validated_and_recovered(tmp_path: Path) -> None:
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(),
        knowledge_case_shots=3,
    )

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
        knowledge_case_shots=3,
    )

    assert recovered.knowledge_case_shots == 3
    with pytest.raises(ValueError, match="case shots"):
        _controller(
            tmp_path / "invalid",
            _FakeCodex(_proposal),
            _FakeEcc(),
            knowledge_case_shots=1,
        )


def test_recovery_rejects_empirical_case_audit_added_after_snapshot(
    tmp_path: Path,
) -> None:
    controller = _controller(tmp_path, _FakeCodex(_proposal), _FakeEcc())
    EmpiricalCaseAuditStore(tmp_path / "episode").append_diagnostic(
        EmpiricalCaseDiagnostic(
            intervention_id="intervention-1",
            reason_code="unexpected_external_event",
        )
    )

    with pytest.raises(
        OptimizationEpisodeControllerError, match="empirical case audit trace"
    ):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
            execution_context=_execution_context(),
        )


def test_recovery_rejects_changed_external_case_pool_head(tmp_path: Path) -> None:
    pool_root = tmp_path / "external-pool"
    pool = EmpiricalCaseAuditStore(pool_root)
    pool.append_diagnostic(
        EmpiricalCaseDiagnostic(
            intervention_id="pool-event-1",
            reason_code="initial_pool_head",
        )
    )
    controller = _controller(
        tmp_path,
        _FakeCodex(_proposal),
        _FakeEcc(),
        knowledge_case_pool_root=pool_root,
    )
    pool.append_diagnostic(
        EmpiricalCaseDiagnostic(
            intervention_id="pool-event-2",
            reason_code="changed_pool_head",
        )
    )

    with pytest.raises(
        OptimizationEpisodeControllerError,
        match="knowledge case pool does not match",
    ):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
            execution_context=_execution_context(),
            knowledge_case_pool_root=pool_root,
        )


def test_external_case_pool_requires_explicit_training_split(tmp_path: Path) -> None:
    pool_root = tmp_path / "external-pool"
    EmpiricalCaseAuditStore(pool_root).append_case(
        TerminalEmpiricalCase(
            case_id="case.unlabeled",
            context_fingerprint=HASH,
            claim_id="claim.one",
            binding_id="binding.one",
            toolchain_ref=HASH,
            requested_value=0.7,
            activation_status="used",
            proposal_sha256=HASH,
            effective_domain_sha256=HASH,
            parameter_card_sha256=HASH,
            materialization_receipt_sha256=HASH,
            receipt_sha256=HASH,
            terminal_outcome_sha256=HASH,
            terminal_observation_sha256=HASH,
            guardrail_status="pass",
            outcome_class=EmpiricalOutcome.SUPPORTED,
            design_id="train-design",
        )
    )

    with pytest.raises(
        OptimizationEpisodeControllerError, match="non-training case"
    ):
        _controller(
            tmp_path,
            _FakeCodex(_proposal),
            _FakeEcc(),
            knowledge_case_pool_root=pool_root,
        )


def test_planning_rejects_external_case_pool_change_during_episode(
    tmp_path: Path,
) -> None:
    pool_root = tmp_path / "external-pool"
    pool = EmpiricalCaseAuditStore(pool_root)
    pool.append_diagnostic(
        EmpiricalCaseDiagnostic(
            intervention_id="pool-event-1",
            reason_code="initial_pool_head",
        )
    )
    codex = _FakeCodex(_proposal)
    controller = _controller(
        tmp_path,
        codex,
        _FakeEcc(),
        knowledge_case_pool_root=pool_root,
    )
    pool.append_diagnostic(
        EmpiricalCaseDiagnostic(
            intervention_id="pool-event-2",
            reason_code="changed_pool_head",
        )
    )

    with pytest.raises(
        OptimizationEpisodeControllerError,
        match="frozen knowledge case pool changed",
    ):
        controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert codex.contexts == []
