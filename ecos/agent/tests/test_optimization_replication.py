import json

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationProposal,
    OptimizationTaskMemoryReference,
    PlanningProviderEnvelope,
    PlanningProviderEvidence,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    StrategyDirection,
)
from ecos_agent.optimization_decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationTerminalOutcome,
    build_optimization_artifact_manifest,
)
from ecos_agent.optimization_replication import (
    OptimizationReplicationError,
    export_replication_package,
    verify_replication_package,
)


HASH = "sha256:" + "a" * 64
MEMORY_HASH = "sha256:" + "b" * 64


def _episode(root, *, with_task_memory: bool = False):
    context_ref = ProposalContextRef(
        episode_id="episode-1", checkpoint_id="checkpoint-parent", input_sha256=HASH
    )
    proposal = OptimizationProposal(
        context_ref=context_ref,
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="Try one bounded congestion intervention.",
        observation_refs=(ObservationReference(observation_id="observation-1", sha256=HASH),),
        task_memory_refs=(
            (OptimizationTaskMemoryReference(summary_sha256=MEMORY_HASH),)
            if with_task_memory
            else ()
        ),
        action=ProposalAction(
            knob_id="place.target_density",
            direction=StrategyDirection.DECREASE,
            expected_effects=(
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                },
            ),
        ),
    )
    ledger = OptimizationLedger(root)
    ledger.append_start(
        OptimizationInterventionStart(
            intervention_id="intervention-1",
            parent_checkpoint_id="checkpoint-parent",
            candidate_checkpoint_id="checkpoint-candidate",
            parameter_before_sha256=HASH,
            parameter_after_sha256=HASH,
            proposal_sha256=canonical_sha256(proposal.model_dump(mode="json")),
            execution_contract_sha256=HASH,
            parent_manifest_sha256=HASH,
            environment_sha256=HASH,
        )
    )
    ledger.append_terminal(
        OptimizationTerminalOutcome(
            intervention_id="intervention-1",
            outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
            candidate_manifest_sha256=HASH,
            receipt_sha256=HASH,
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
        task_memory_snapshot_sha256=MEMORY_HASH if with_task_memory else None,
        task_memory_refs=(
            (OptimizationTaskMemoryReference(summary_sha256=MEMORY_HASH),)
            if with_task_memory
            else ()
        ),
    )
    prompt = "Owner alice inspects /home/alice/private/design on build01.ucas.ac.cn."
    envelope_payload = {
        "schema_version": "ecos.optimization_planning_provider_envelope.v1",
        "provider_id": "codex_app_server",
        "requested_model": "gpt-test",
        "prompt": prompt,
        "output_schema": {"type": "object", "additionalProperties": False},
        "planner_payload_sha256": HASH,
    }
    envelope = PlanningProviderEnvelope(
        **envelope_payload,
        envelope_sha256=canonical_sha256(envelope_payload),
    )
    OptimizationPlanningProviderEvidenceAudit(root).append(
        planning_entry_sha256=planning.entry_sha256,
        evidence=PlanningProviderEvidence(
            provider_id="codex_app_server",
            thread_id="alice-thread-private",
            turn_id="alice-turn-private",
            response_sha256=HASH,
            envelope=envelope,
        ),
    )
    OptimizationDecisionAudit(root).append(
        planning_entry_sha256=planning.entry_sha256,
        proposal=proposal,
        validation_result="accepted",
        rejection_reason=None,
        requested=None,
        state=OptimizationEpisodeState.AWAITING_EXECUTION,
    )


def test_replication_package_is_sanitized_keyless_and_tamper_evident(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    package_root = tmp_path / "public"
    _episode(episode_root)

    manifest = export_replication_package(episode_root, package_root)

    assert manifest.raw_root_sha256 != manifest.sanitized_root_sha256
    projection = (package_root / "optimization-replay.v1.json").read_text(encoding="utf-8")
    assert "alice" not in projection
    assert "build01.ucas.ac.cn" not in projection
    assert "<absolute-path>" in projection
    assert verify_replication_package(package_root) == manifest
    assert len(manifest.raw_manifest.entries) == 4

    second_manifest = export_replication_package(episode_root, package_root)
    assert second_manifest == manifest
    assert (package_root / "optimization-replay.v1.json").read_text(
        encoding="utf-8"
    ) == projection

    records = json.loads(projection)
    records["planning"][0]["envelope"]["prompt"] = "tampered"
    (package_root / "optimization-replay.v1.json").write_text(
        json.dumps(records, sort_keys=True), encoding="utf-8"
    )
    with pytest.raises(OptimizationReplicationError, match="hash"):
        verify_replication_package(package_root)


def test_verifier_requires_manifest_to_bind_the_replay_projection(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    package_root = tmp_path / "public"
    _episode(episode_root)
    export_replication_package(episode_root, package_root)
    decoy = package_root / "decoy.json"
    decoy.write_text("{}", encoding="utf-8")
    decoy_manifest = build_optimization_artifact_manifest(package_root, ("decoy.json",))
    manifest_path = package_root / "replication-manifest.v1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sanitized_manifest"] = decoy_manifest.model_dump(mode="json")
    manifest["sanitized_root_sha256"] = canonical_sha256(
        decoy_manifest.model_dump(mode="json")
    )
    manifest["manifest_sha256"] = canonical_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    )
    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")

    with pytest.raises(OptimizationReplicationError, match="replay projection"):
        verify_replication_package(package_root)


def test_replication_projection_preserves_task_memory_evidence_refs(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    package_root = tmp_path / "public"
    _episode(episode_root, with_task_memory=True)

    export_replication_package(episode_root, package_root)

    projection = json.loads(
        (package_root / "optimization-replay.v1.json").read_text(encoding="utf-8")
    )
    planning = projection["planning"][0]
    assert planning["task_memory_snapshot_sha256"] == MEMORY_HASH
    assert planning["task_memory_refs"] == [{"summary_sha256": MEMORY_HASH}]
    assert "chat" not in json.dumps(planning)


def test_verifier_rejects_execution_without_an_accepted_proposal(tmp_path) -> None:
    episode_root = tmp_path / "episode"
    package_root = tmp_path / "public"
    _episode(episode_root)
    export_replication_package(episode_root, package_root)
    projection_path = package_root / "optimization-replay.v1.json"
    projection = json.loads(projection_path.read_text(encoding="utf-8"))
    projection["lifecycle"][0]["payload"]["proposal_sha256"] = HASH
    projection["projection_sha256"] = canonical_sha256(
        {key: value for key, value in projection.items() if key != "projection_sha256"}
    )
    projection_path.write_text(json.dumps(projection, sort_keys=True), encoding="utf-8")
    sanitized = build_optimization_artifact_manifest(
        package_root, ("optimization-replay.v1.json",)
    )
    manifest_path = package_root / "replication-manifest.v1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["sanitized_manifest"] = sanitized.model_dump(mode="json")
    manifest["sanitized_root_sha256"] = canonical_sha256(
        sanitized.model_dump(mode="json")
    )
    manifest["manifest_sha256"] = canonical_sha256(
        {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    )
    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")

    with pytest.raises(OptimizationReplicationError, match="accepted proposal"):
        verify_replication_package(package_root)
