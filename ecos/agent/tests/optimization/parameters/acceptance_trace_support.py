from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization import memory as optimization_memory
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationKnob,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization.memory import (
    OptimizationTaskMemoryStore,
    build_task_memory_scope,
)
from ecos_agent.optimization.parameters import acceptance
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.parameters.semantics import card_hash
from tests.optimization.parameters.acceptance_support import (
    HASH,
    card_for,
    receipt_hash_payload,
    write_candidate,
    write_json,
)


def write_trace(
    workspace: Path,
    paths: dict[str, Path],
    observation: TerminalObservation,
    *,
    domain_context_sha256: str | None = None,
) -> Path:
    optimization_root = workspace / ".agent/optimization"
    episode_root = optimization_root / "episode-acceptance-test"
    scope = build_task_memory_scope(
        workspace_manifest_sha256=HASH,
        design_id="design-a",
        checkpoint_id="place",
        episode_id=episode_root.name,
        objective_contract_sha256=HASH,
    )
    store = OptimizationTaskMemoryStore(optimization_root, scope)
    store.ensure_episode_scope(episode_root, scope)
    context_ref = ProposalContextRef(
        episode_id=scope.episode_id,
        checkpoint_id=scope.checkpoint_id,
        input_sha256=HASH,
    )
    native = ParameterApplicationReceipt.model_validate_json(
        paths["receipt"].read_bytes()
    )
    knob = OptimizationKnob(native.requested["knob_id"])
    action = ProposalAction(
        knob_id=knob,
        direction=StrategyDirection.DECREASE,
        expected_effects=(
            {
                "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                "direction": ExpectedEffectDirection.DECREASE,
            },
        ),
    )
    proposal = OptimizationProposal(
        context_ref=context_ref,
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="Replay one acceptance candidate.",
        observation_refs=(
            ObservationReference(observation_id="observation-1", sha256=HASH),
        ),
        action=action,
    )
    planning = OptimizationPlanningAudit(episode_root).append(
        context_ref=context_ref,
        history_refs=(),
        history_outcomes=(),
        budget_snapshot=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(1)),
        incumbent=None,
        planner_payload_sha256=HASH,
        effective_domains=(
            domain_for(
                knob,
                domain_context_sha256 or native.context["context_sha256"],
            ),
        ),
    )
    OptimizationDecisionAudit(episode_root).append(
        planning_entry_sha256=planning.entry_sha256,
        proposal=proposal,
        validation_result="accepted",
        rejection_reason=None,
        requested=None,
        state=OptimizationEpisodeState.AWAITING_EXECUTION,
        objective_contract_sha256=scope.objective_contract_sha256,
    )
    candidate_ref = ".agent/candidates/candidate-acceptance-test"
    ledger = OptimizationLedger(episode_root)
    ledger.append_start(
        OptimizationInterventionStart(
            intervention_id="intervention-1",
            parent_checkpoint_id=scope.checkpoint_id,
            candidate_checkpoint_id="candidate-1",
            parameter_before_sha256=HASH,
            parameter_after_sha256=HASH,
            proposal_sha256=canonical_sha256(proposal.model_dump(mode="json")),
            execution_contract_sha256=HASH,
            parent_manifest_sha256=scope.workspace_manifest_sha256,
            environment_sha256=HASH,
            objective_contract_sha256=scope.objective_contract_sha256,
            proposal_action=action,
            requested=RequestedKnobValue(
                knob_id=knob,
                value=native.requested["value"],
            ),
        )
    )
    ledger.append_terminal(
        OptimizationTerminalOutcome(
            intervention_id="intervention-1",
            outcome=OptimizationOutcomeKind.IMPROVED,
            candidate_manifest_sha256=file_sha256(paths["manifest"]),
            candidate_root_ref=candidate_ref,
            candidate_manifest_ref=(
                f"{candidate_ref}/analysis/candidate_workspace.v1.json"
            ),
            receipt_sha256=native.evidence_sha256,
            terminal_observation_sha256=canonical_sha256(
                observation.model_dump(mode="json")
            ),
            terminal_observation=observation,
            parameter_application_receipt=native,
            parameter_card_sha256=card_hash(card_for(knob)),
            materialization_receipt_sha256=native.materialization.receipt_sha256,
            parameter_application_receipt_id=native.receipt_id,
            outcome_details_sha256=HASH,
        )
    )
    ledger_replay = ledger.verify()
    decision_replay = OptimizationDecisionAudit(episode_root).verify()
    state = {
        "schema_version": "ecos.optimization_episode_state.v7",
        "episode_id": scope.episode_id,
        "checkpoint_id": scope.checkpoint_id,
        "objective": {"contract_sha256": scope.objective_contract_sha256},
        "objective_alignment": {
            "objective_contract_sha256": scope.objective_contract_sha256
        },
        "parent_manifest_sha256": scope.workspace_manifest_sha256,
        "ledger_event_count": len(ledger_replay.entries),
        "ledger_chain_head_sha256": ledger_replay.chain_head_sha256,
        "decision_audit_event_count": len(decision_replay.entries),
        "decision_audit_chain_head_sha256": decision_replay.chain_head_sha256,
        "task_memory_scope_sha256": scope.scope_sha256,
    }
    state["state_sha256"] = canonical_sha256(state)
    write_json(episode_root / "optimization-episode-state.v7.json", state)
    store.synchronize()
    return episode_root


def domain_for(knob: OptimizationKnob, context_sha256: str) -> EffectiveDomainSnapshot:
    payload = {
        "schema_version": "ecos.effective_domain.v1",
        "knob_id": knob,
        "context_sha256": context_sha256,
        "current_coordinate": None,
        "surface_values": (0.2, 0.65),
        "excluded_aliases": (),
        "allowed_requested_values": (0.2, 0.65),
        "thresholds": (),
        "observed_application_signatures": (),
        "observed_response_signatures": (),
    }
    return EffectiveDomainSnapshot(
        **payload, snapshot_sha256=canonical_sha256(payload)
    )


def build_acceptance(
    workspace: Path,
    output: Path,
    episode_roots: tuple[Path, ...],
) -> dict:
    receipt = json.loads(
        (
            workspace
            / ".agent/candidates/candidate-acceptance-test/analysis"
            / "parameter_application_receipt.v1.json"
        ).read_text(encoding="utf-8")
    )
    return acceptance.build_acceptance(
        workspace,
        output,
        candidates={receipt["requested"]["knob_id"]: "candidate-acceptance-test"},
        episode_roots=episode_roots,
        expected_ecos_revision=acceptance._current_revisions()["ecos_revision"],
        expected_ecc_revision="ecc-test-revision",
    )


def rewrite_receipt(paths: dict[str, Path], mutate) -> None:
    receipt = json.loads(paths["receipt"].read_text(encoding="utf-8"))
    mutate(receipt)
    receipt["evidence_sha256"] = canonical_sha256(receipt_hash_payload(receipt))
    write_json(paths["receipt"], receipt)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["artifacts"]["parameter_application_receipt"]["sha256"] = file_sha256(
        paths["receipt"]
    )
    write_json(paths["manifest"], manifest)
    replay = json.loads(paths["replay"].read_text(encoding="utf-8"))
    replay["candidate_manifest_sha256"] = file_sha256(paths["manifest"])
    write_json(paths["replay"], replay)


def patch_acceptance_for_single_knob(
    monkeypatch: pytest.MonkeyPatch,
    observation: TerminalObservation,
    *,
    knob: OptimizationKnob = OptimizationKnob.TARGET_DENSITY,
) -> None:
    revisions = acceptance._current_revisions()
    monkeypatch.setattr(
        acceptance,
        "_current_revisions",
        lambda: {**revisions, "ecc_gitlink_revision": "ecc-test-revision"},
    )
    monkeypatch.setattr(
        acceptance,
        "load_parameter_cards",
        lambda: {knob: card_for(knob)},
    )
    monkeypatch.setattr(
        optimization_memory,
        "load_parameter_card",
        lambda _knob: card_for(knob),
    )
    monkeypatch.setattr(acceptance, "_state_sha256", lambda _: HASH)
    monkeypatch.setattr(
        acceptance,
        "build_candidate_terminal_observation",
        lambda *_: observation,
    )


def write_padding_candidate(
    workspace: Path,
    *,
    written_value: int = 4000,
    effective_value: int = 4000,
) -> dict[str, Path]:
    return write_candidate(
        workspace,
        knob=OptimizationKnob.CELL_PADDING_X,
        requested_value=2,
        written_value=written_value,
        effective_value=effective_value,
        requested_unit="site",
        written_unit="dbu",
        config_field="cell_padding_x",
        consumer_id="dreamplace.cell_size_expansion",
        observation_payload={
            "evidence_complete": True,
            "effective_padding_dbu": effective_value,
            "movable_node_count": 10,
            "geometry_apply_count": 1,
        },
    )
