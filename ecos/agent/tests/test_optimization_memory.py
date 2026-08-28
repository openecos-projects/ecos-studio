from __future__ import annotations

import json
from pathlib import Path

import pytest
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
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
    RequestedKnobValue,
    SignoffGates,
    StrategyDirection,
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
    _canonical_json,
    _new_entry,
)
from ecos_agent.optimization_legacy_reader import KnobApplicationReceipt
from ecos_agent.optimization_memory import (
    OptimizationTaskMemoryIntegrityError,
    OptimizationTaskMemoryStore,
    build_task_memory_scope,
)
from ecos_agent.optimization_metric_contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization_rules import freeze_optimization_objective
from ecos_agent.parameter_evidence_contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
)
from ecos_agent.parameter_semantics import card_hash, load_parameter_cards

HASH = "sha256:" + "a" * 64
WORKSPACE_HASH = "sha256:" + "b" * 64


def _objective(primary: ObjectiveMetric = ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW):
    return freeze_optimization_objective(
        "Optimize this design under the frozen objective.",
        OptimizationObjectiveProposal(
            primary_metric=primary,
            preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
            rationale_summary="Keep the objective scoped and auditable.",
        ),
    )


def _terminal(observation_id: str, overflow: float) -> TerminalObservation:
    one = {
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "sta_corner_count",
        "sta_expected_corner_count",
    }
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id=observation_id,
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100.0 + overflow,
        },
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
        evaluation_metrics=tuple(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=1.0 if metric_id in one else 0.0,
                unit="count",
                category=EvaluationMetricCategory.ELIGIBILITY,
                role=EvaluationMetricRole.GATE,
                direction=EvaluationMetricDirection.EXACT,
                source_refs=("analysis/terminal.json",),
            )
            for metric_id in (
                "drc_count",
                "lvs_count",
                "rcx_expected_corner_count",
                "rcx_spef_file_count",
                "rcx_missing_corner_count",
                "rcx_spef_parse_failure_count",
                "sta_corner_count",
                "sta_expected_corner_count",
                "sta_missing_corner_count",
                "sta_setup_violation_count",
                "sta_hold_violation_count",
                "harden_artifact_missing_count",
            )
        ),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )


def _parameter_application_receipt(value: int) -> ParameterApplicationReceipt:
    card = load_parameter_cards()["place.cell_padding_x"]
    effective = value * 200
    payload = {
        "receipt_id": f"parameter-receipt-padding-{value}",
        "tool": card.tool,
        "context": {
            "stage": "place",
            "lattice_version": "ecos.optimization_lattice.v1",
        },
        "requested": {
            "knob_id": "place.cell_padding_x",
            "value": value,
            "unit": "site",
        },
        "materialization": MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=HASH,
            config_after_sha256=WORKSPACE_HASH,
            written_value=effective,
            unit="dbu",
        ),
        "effective_initial": EffectiveValue(value=effective, unit="dbu"),
        "application_status": "applied",
        "activation": ActivationEvidence(
            status="used",
            consumers=(
                {
                    "consumer_id": "dreamplace.cell_size_expansion",
                    "outcome": "entered",
                    "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                    "evidence_sha256": HASH,
                },
            ),
        ),
        "consumer_observation": {
            "effective_padding_dbu": effective,
            "movable_node_count": 1,
            "evidence_complete": True,
        },
        "effective_final": EffectiveValue(value=effective, unit="dbu"),
    }
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"evidence_sha256"})
        ),
    )


def _replace_receipt(
    receipt: ParameterApplicationReceipt, **updates: object
) -> ParameterApplicationReceipt:
    payload = {
        name: getattr(receipt, name)
        for name in receipt.__class__.model_fields
        if name != "evidence_sha256"
    }
    payload.update(updates)
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"evidence_sha256"})
        ),
    )


def _scope(
    episode_id: str,
    *,
    design_id: str = "design-a",
    workspace_sha256: str = WORKSPACE_HASH,
    objective=None,
):
    objective = objective or _objective()
    return build_task_memory_scope(
        workspace_manifest_sha256=workspace_sha256,
        design_id=design_id,
        checkpoint_id="place",
        episode_id=episode_id,
        objective_contract_sha256=objective.contract_sha256,
    )


def _write_state(root: Path, scope, ledger: OptimizationLedger) -> None:
    replay = ledger.replay()
    decisions = OptimizationDecisionAudit(root).replay()
    value = {
        "schema_version": "ecos.optimization_episode_state.v6",
        "episode_id": scope.episode_id,
        "checkpoint_id": scope.checkpoint_id,
        "objective": {"contract_sha256": scope.objective_contract_sha256},
        "parent_manifest_sha256": scope.workspace_manifest_sha256,
        "ledger_event_count": len(replay.entries),
        "ledger_chain_head_sha256": replay.chain_head_sha256,
        "decision_audit_event_count": len(decisions.entries),
        "decision_audit_chain_head_sha256": decisions.chain_head_sha256,
        "task_memory_scope_sha256": scope.scope_sha256,
    }
    value["state_sha256"] = canonical_sha256(value)
    (root / "optimization-episode-state.v6.json").write_text(
        json.dumps(value, sort_keys=True), encoding="utf-8"
    )


def _append_intervention(
    root: Path,
    scope,
    *,
    index: int,
    outcome: OptimizationOutcomeKind = OptimizationOutcomeKind.IMPROVED,
    terminal: bool = True,
    application_receipt: KnobApplicationReceipt | None = None,
    include_native_receipt: bool = True,
    parameter_application_receipt: ParameterApplicationReceipt | None = None,
    observation: TerminalObservation | None = None,
    terminal_receipt_sha256: str | None = None,
) -> None:
    context_ref = ProposalContextRef(
        episode_id=scope.episode_id,
        checkpoint_id=scope.checkpoint_id,
        input_sha256=HASH,
    )
    proposal = OptimizationProposal(
        context_ref=context_ref,
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="Use one bounded placement intervention.",
        observation_refs=(
            ObservationReference(observation_id=f"observation-{index}", sha256=HASH),
        ),
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
        objective_contract_sha256=scope.objective_contract_sha256,
    )
    intervention_id = f"intervention-{index}"
    ledger = OptimizationLedger(root)
    requested = RequestedKnobValue(knob_id="place.cell_padding_x", value=index % 4)
    ledger.append_start(
        OptimizationInterventionStart(
            intervention_id=intervention_id,
            parent_checkpoint_id=scope.checkpoint_id,
            candidate_checkpoint_id=f"candidate-{index}",
            parameter_before_sha256=HASH,
            parameter_after_sha256=HASH,
            proposal_sha256=canonical_sha256(proposal.model_dump(mode="json")),
            execution_contract_sha256=HASH,
            parent_manifest_sha256=scope.workspace_manifest_sha256,
            environment_sha256=HASH,
            objective_contract_sha256=scope.objective_contract_sha256,
            proposal_action=proposal.action,
            requested=requested,
        )
    )
    if terminal:
        observation = observation or _terminal(f"terminal-{index}", float(index))
        native_receipt = None
        if include_native_receipt and application_receipt is None:
            native_receipt = parameter_application_receipt or (
                _parameter_application_receipt(requested.value)
            )
        terminal_outcome = OptimizationTerminalOutcome(
                intervention_id=intervention_id,
                outcome=outcome,
                candidate_manifest_sha256=HASH,
                candidate_root_ref=f".agent/optimization/{scope.episode_id}/candidates/{index}",
                candidate_manifest_ref=(
                    f".agent/optimization/{scope.episode_id}/candidates/{index}/manifest.json"
                ),
                receipt_sha256=(
                    terminal_receipt_sha256
                    or (native_receipt.evidence_sha256 if native_receipt is not None else HASH)
                ),
                terminal_observation_sha256=canonical_sha256(
                    observation.model_dump(mode="json")
                ),
                terminal_observation=observation,
                application_receipt=application_receipt,
                parameter_application_receipt=native_receipt,
                parameter_card_sha256=(
                    card_hash(load_parameter_cards()[requested.knob_id])
                    if native_receipt is not None
                    else None
                ),
                materialization_receipt_sha256=(
                    native_receipt.materialization.receipt_sha256
                    if native_receipt is not None
                    else None
                ),
                parameter_application_receipt_id=(
                    native_receipt.receipt_id if native_receipt is not None else None
                ),
                outcome_details_sha256=HASH,
        )
        if application_receipt is None:
            ledger.append_terminal(terminal_outcome)
        else:
            replay = ledger.replay()
            entry = _new_entry(
                len(replay.entries) + 1,
                replay.chain_head_sha256,
                terminal_outcome,
            )
            with ledger.ledger_path.open("ab") as stream:
                stream.write(_canonical_json(entry.model_dump(mode="json")) + b"\n")
    _write_state(root, scope, ledger)


def _episode(store: OptimizationTaskMemoryStore, scope, *, terminal: bool = True) -> Path:
    root = store.root / scope.episode_id
    store.ensure_episode_scope(root, scope)
    _append_intervention(root, scope, index=1, terminal=terminal)
    return root


def _application_receipt(value: int) -> KnobApplicationReceipt:
    applied = AppliedKnobValue(knob_id="place.cell_padding_x", value=value * 200)
    return KnobApplicationReceipt(
        receipt_id=f"receipt-padding-{value}",
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=value),
        written=applied,
        effective_initial=applied,
        effective_final=applied,
        evidence_sha256=HASH,
    )


def test_memory_promotes_only_terminal_closed_evidence_and_sync_is_idempotent(
    tmp_path: Path,
) -> None:
    current = _scope("episode-current")
    store = OptimizationTaskMemoryStore(tmp_path / "optimization", current)
    _episode(store, _scope("episode-source"), terminal=False)

    assert store.synchronize().entries == ()

    source_root = store.root / "episode-source"
    source_scope = _scope("episode-source")
    ledger = OptimizationLedger(source_root)
    observation = _terminal("terminal-1", 1.0)
    native_receipt = _parameter_application_receipt(1)
    ledger.append_terminal(
        OptimizationTerminalOutcome(
            intervention_id="intervention-1",
            outcome=OptimizationOutcomeKind.IMPROVED,
            candidate_manifest_sha256=HASH,
            candidate_root_ref=".agent/optimization/episode-source/candidates/1",
            candidate_manifest_ref=(
                ".agent/optimization/episode-source/candidates/1/manifest.json"
            ),
            receipt_sha256=native_receipt.evidence_sha256,
            terminal_observation_sha256=canonical_sha256(observation.model_dump(mode="json")),
            terminal_observation=observation,
            parameter_application_receipt=native_receipt,
            parameter_card_sha256=card_hash(
                load_parameter_cards()["place.cell_padding_x"]
            ),
            materialization_receipt_sha256=native_receipt.materialization.receipt_sha256,
            parameter_application_receipt_id=native_receipt.receipt_id,
            outcome_details_sha256=HASH,
        )
    )
    _write_state(source_root, source_scope, ledger)

    first = store.synchronize()
    second = store.synchronize()
    assert len(first.entries) == 1
    assert first.entries[0].evidence.candidate_manifest_ref.endswith("manifest.json")
    assert first.entries[0].evidence.receipt_sha256 == native_receipt.evidence_sha256
    assert second == first


def test_snapshot_isolates_workspace_design_objective_and_current_episode(
    tmp_path: Path,
) -> None:
    current = _scope("episode-current")
    store = OptimizationTaskMemoryStore(tmp_path / "optimization", current)
    for scope in (_scope("episode-matching"), _scope("episode-current")):
        _episode(store, scope)
    isolated = store.snapshot()

    for scope in (
        _scope("episode-other-design", design_id="design-b"),
        _scope("episode-other-workspace", workspace_sha256="sha256:" + "c" * 64),
        _scope(
            "episode-other-objective",
            objective=_objective(ObjectiveMetric.ROUTE_WIRELENGTH),
        ),
    ):
        _episode(store, scope)

    snapshot = store.snapshot()

    assert snapshot == isolated
    evidence = snapshot.summaries[0].evidence_refs
    assert {item.source_episode_id for item in evidence} == {"episode-matching"}
    assert snapshot.scope == current


def test_snapshot_is_bounded_compressed_deterministic_and_updates(tmp_path: Path) -> None:
    current = _scope("episode-current")
    store = OptimizationTaskMemoryStore(tmp_path / "optimization", current)
    for index in range(1, 8):
        scope = _scope(f"episode-source-{index}")
        root = store.root / scope.episode_id
        store.ensure_episode_scope(root, scope)
        _append_intervention(
            root,
            scope,
            index=index,
            outcome=(
                OptimizationOutcomeKind.IMPROVED
                if index % 2
                else OptimizationOutcomeKind.DEGRADED
            ),
        )

    first = store.snapshot()
    assert first == store.snapshot()
    assert sum(len(item.evidence_refs) for item in first.summaries) == 6
    assert len(first.summaries) == 1
    assert {item.outcome for item in first.summaries[0].outcome_counts} == {
        OptimizationOutcomeKind.IMPROVED,
        OptimizationOutcomeKind.DEGRADED,
    }
    assert first.summaries[0].metric_ranges

    scope = _scope("episode-source-8")
    root = store.root / scope.episode_id
    store.ensure_episode_scope(root, scope)
    _append_intervention(root, scope, index=8)
    updated = store.snapshot()
    assert updated.snapshot_sha256 != first.snapshot_sha256
    assert sum(len(item.evidence_refs) for item in updated.summaries) == 6


def test_task_memory_rejects_legacy_application_receipts(
    tmp_path: Path,
) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    source_scope = _scope("episode-source")
    root = store.root / source_scope.episode_id
    store.ensure_episode_scope(root, source_scope)
    receipt = _application_receipt(1)
    _append_intervention(root, source_scope, index=1, application_receipt=receipt)

    replay = store.synchronize()
    snapshot = store.snapshot()

    assert replay.entries == ()
    assert snapshot.summaries == ()
    assert store.replay() == replay


def test_task_memory_rejects_terminal_without_native_receipt(
    tmp_path: Path,
) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    source_scope = _scope("episode-source")
    root = store.root / source_scope.episode_id
    store.ensure_episode_scope(root, source_scope)
    _append_intervention(root, source_scope, index=1, include_native_receipt=False)

    replay = store.synchronize()
    assert replay.entries == ()
    assert store.replay() == replay


def test_task_memory_rejects_terminal_with_foreign_receipt_hash(tmp_path: Path) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    source_scope = _scope("episode-source")
    root = store.root / source_scope.episode_id
    store.ensure_episode_scope(root, source_scope)
    _append_intervention(
        root,
        source_scope,
        index=1,
        terminal_receipt_sha256=WORKSPACE_HASH,
    )

    assert store.synchronize().entries == ()


@pytest.mark.parametrize(
    "outcome",
    (
        OptimizationOutcomeKind.EXECUTION_FAILED,
        OptimizationOutcomeKind.EVIDENCE_INVALID,
        OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
    ),
)
def test_task_memory_rejects_unsuccessful_outcomes(
    tmp_path: Path, outcome: OptimizationOutcomeKind
) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    _episode(store, _scope("episode-source"))
    source_scope = _scope("episode-failed")
    root = store.root / source_scope.episode_id
    store.ensure_episode_scope(root, source_scope)
    _append_intervention(root, source_scope, index=1, outcome=outcome)

    replay = store.synchronize()

    assert len(replay.entries) == 1
    assert replay.entries[0].scope.episode_id == "episode-source"


def test_task_memory_requires_eligible_v3_terminal_observation(tmp_path: Path) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    for episode_id, observation in (
        (
            "episode-v2",
            TerminalObservation(
                observation_id="terminal-v2",
                evidence_manifest_sha256=HASH,
                evidence_valid=True,
                harden_artifacts_complete=True,
                signoff_gates=SignoffGates.all(GateResult.PASS),
                metrics=_terminal("unused", 1.0).metrics,
                timing_guardrail={metric: 0.0 for metric in TimingMetric},
            ),
        ),
        (
            "episode-ineligible",
            _terminal("terminal-ineligible", 1.0).model_copy(
                update={"evidence_valid": False}
            ),
        ),
    ):
        scope = _scope(episode_id)
        root = store.root / scope.episode_id
        store.ensure_episode_scope(root, scope)
        _append_intervention(root, scope, index=1, observation=observation)

    assert store.synchronize().entries == ()


@pytest.mark.parametrize(
    "updates",
    (
        {"context": {"stage": "route"}},
        {
            "application_status": "ignored",
            "activation": ActivationEvidence(status="unknown"),
        },
    ),
)
def test_task_memory_rejects_invalid_or_ineffective_native_receipt(
    tmp_path: Path, updates: dict[str, object]
) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    scope = _scope("episode-source")
    root = store.root / scope.episode_id
    store.ensure_episode_scope(root, scope)
    receipt = _replace_receipt(_parameter_application_receipt(1), **updates)
    _append_intervention(
        root,
        scope,
        index=1,
        parameter_application_receipt=receipt,
    )

    assert store.synchronize().entries == ()


def test_memory_store_rejects_hash_tampering(tmp_path: Path) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    _episode(store, _scope("episode-source"))
    store.synchronize()
    content = store.store_path.read_text(encoding="utf-8")
    store.store_path.write_text(
        content.replace('"improved"', '"degraded"'), encoding="utf-8"
    )

    with pytest.raises(OptimizationTaskMemoryIntegrityError, match="hash"):
        store.replay()


def test_snapshot_rejects_missing_source_evidence(tmp_path: Path) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    source = _episode(store, _scope("episode-source"))
    store.synchronize()
    (source / "optimization-episode-state.v6.json").unlink()

    with pytest.raises(OptimizationTaskMemoryIntegrityError, match="unavailable"):
        store.snapshot()


def test_memory_contains_no_raw_chat_or_prompt(tmp_path: Path) -> None:
    store = OptimizationTaskMemoryStore(
        tmp_path / "optimization", _scope("episode-current")
    )
    _episode(store, _scope("episode-source"))

    payload = json.dumps(store.snapshot().model_dump(mode="json"))
    assert "prompt" not in payload
    assert "message" not in payload
    assert "chat" not in payload
