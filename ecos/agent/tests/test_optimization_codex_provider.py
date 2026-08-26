from __future__ import annotations

from pathlib import Path

import pytest

from ecos_agent.codex_provider import (
    CodexAppServerProposalProvider,
    CodexProviderError,
    _build_prompt,
    create_required_codex_provider,
)
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
    ExpectedEffectDirection,
    HistoryReference,
    KnobApplicationReceipt,
    LegalAction,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization_controller import (
    OptimizationHistory,
    OptimizationPlanningContext,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


def _provider(tmp_path: Path) -> CodexAppServerProposalProvider:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    return CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)


def _context() -> OptimizationPlanningContext:
    receipt = KnobApplicationReceipt(
        receipt_id="receipt-density",
        requested=RequestedKnobValue(knob_id="place.target_density", value=0.2),
        written=AppliedKnobValue(knob_id="place.target_density", value=0.2),
        effective_initial=AppliedKnobValue(
            knob_id="place.target_density", value=0.8
        ),
        effective_final=AppliedKnobValue(knob_id="place.target_density", value=0.8),
        evidence_sha256=HASH,
    )
    history = OptimizationHistory(
        reference=HistoryReference(
            intervention_id="intervention-1", outcome_sha256=HASH
        ),
        outcome=OptimizationOutcomeKind.DEGRADED,
        action=ProposalAction(
            knob_id="place.target_density",
            direction=StrategyDirection.INCREASE,
            expected_effects=(
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                },
            ),
        ),
        requested=RequestedKnobValue(knob_id="place.target_density", value=0.2),
        application_receipt=receipt,
    )
    return OptimizationPlanningContext(
        context_ref=ProposalContextRef(
            episode_id="episode-1",
            checkpoint_id="checkpoint-1",
            input_sha256=HASH,
        ),
        observation_ref=ObservationReference(
            observation_id="observation-1", sha256=HASH
        ),
        incumbent=None,
        history=(history,),
        knowledge_refs=(
            KnowledgeReference(entity_id="strategy-1", chunk_sha256=CHUNK_HASH),
        ),
        knowledge_chunks=("Use the bounded audited congestion strategy.",),
        legal_actions=(
            LegalAction(
                knob_id="place.target_density",
                direction=StrategyDirection.INCREASE,
            ),
        ),
        known_ineffective_requests=tuple(
            RequestedKnobValue(knob_id="place.target_density", value=value)
            for value in (
                0.1,
                0.15,
                0.2,
                0.25,
                0.3,
                0.35,
                0.4,
                0.45,
                0.5,
                0.55,
                0.6,
                0.65,
                0.7,
                0.75,
            )
        ),
    )


def _proposal(context: OptimizationPlanningContext) -> dict[str, object]:
    return OptimizationProposal(
        context_ref=context.context_ref,
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="Use one bounded congestion strategy.",
        observation_refs=(context.observation_ref,),
        history_refs=(context.history[0].reference,),
        knowledge_refs=context.knowledge_refs,
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
    ).model_dump(mode="json")


def test_optimization_planner_sends_only_bounded_context_and_validates_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = _provider(tmp_path)
    context = _context()
    captured: dict[str, object] = {}

    def request(
        system: str, user: dict[str, object], output_schema: dict[str, object]
    ) -> dict[str, object]:
        captured.update(system=system, user=user, output_schema=output_schema)
        return _proposal(context)

    monkeypatch.setattr(provider, "_request_json", request)

    proposal = provider.propose(context)

    assert proposal == _proposal(context)
    assert set(captured["user"]) == {
        "context_ref",
        "observation_ref",
        "incumbent",
        "history",
        "knowledge_refs",
        "knowledge_chunks",
        "legal_actions",
        "known_ineffective_requests",
        "objective",
    }
    assert "workspace" not in captured["user"]
    assert "specific parameter values" in captured["system"]
    assert "exactly the supplied observation_ref" in captured["system"]
    assert "effective values" in captured["system"]
    assert "known_ineffective_requests" in captured["system"]
    assert captured["user"]["history"][0]["application_receipt"][
        "effective_initial"
    ]["value"] == 0.8
    schema = captured["output_schema"]
    assert schema["required"] == [
        "schema_version",
        "context_ref",
        "decision",
        "reason_code",
        "rationale_summary",
        "observation_refs",
        "history_refs",
        "knowledge_refs",
        "task_memory_refs",
        "action",
    ]
    assert schema["$defs"]["OptimizationKnob"]["enum"] == [
        "place.target_density",
        "place.target_overflow",
        "place.cell_padding_x",
        "place.routability_opt",
        "place.density_weight",
        "floorplan.core_util",
        "floorplan.aspect_ratio",
        "synth.max_fanout",
    ]


def test_optimization_planner_fails_closed_on_invalid_codex_proposal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = _provider(tmp_path)
    context = _context()
    invalid = _proposal(context)
    invalid["action"] = None
    monkeypatch.setattr(provider, "_request_json", lambda **_kwargs: invalid)

    with pytest.raises(CodexProviderError, match="schema validation") as error:
        provider.propose(context)

    assert error.value.failure_class == "parse_error"


def test_optimization_planner_exposes_one_consumable_turn_evidence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = _provider(tmp_path)
    context = _context()
    captured: dict[str, object] = {}

    def request(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        provider._completed_turn = ("thread-1", "turn-1", HASH)
        return _proposal(context)

    monkeypatch.setattr(provider, "_request_json", request)

    provider.propose(context)

    evidence = provider.consume_planning_evidence()
    assert evidence is not None
    assert evidence.provider_id == "codex_app_server"
    assert evidence.thread_id == "thread-1"
    assert evidence.turn_id == "turn-1"
    assert evidence.response_sha256 == HASH
    assert evidence.diagnostics_sha256 is None
    assert evidence.envelope.requested_model is None
    assert evidence.envelope.prompt == _build_prompt(
        captured["system"], captured["user"]
    )
    assert evidence.envelope.output_schema == captured["output_schema"]
    assert evidence.envelope.planner_payload_sha256 == canonical_sha256(captured["user"])
    assert evidence.envelope.envelope_sha256 == canonical_sha256(
        evidence.envelope.model_dump(mode="json", exclude={"envelope_sha256"})
    )
    assert provider.consume_planning_evidence() is None


def test_required_codex_provider_forwards_episode_diagnostics_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def initialize(self: object, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(CodexAppServerProposalProvider, "__init__", initialize)
    diagnostics_path = tmp_path / "codex-rpc-diagnostics.v1.jsonl"

    create_required_codex_provider(
        cwd=tmp_path,
        runtime_workspace_roots=(tmp_path,),
        diagnostics_path=diagnostics_path,
    )

    assert captured["diagnostics_path"] == diagnostics_path


def test_optimization_objective_parser_sends_only_bounded_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = _provider(tmp_path)
    captured: dict[str, object] = {}

    def request(
        system: str, user: dict[str, object], output_schema: dict[str, object]
    ) -> dict[str, object]:
        captured.update(system=system, user=user, output_schema=output_schema)
        return {
            "schema_version": "ecos.optimization_objective_proposal.v1",
            "primary_metric": "route_wirelength",
            "preserve_metrics": ["route_dr_total_violation_count"],
            "rationale_summary": "Reduce routing wirelength while preserving signoff cleanliness.",
        }

    monkeypatch.setattr(provider, "_request_json", request)

    proposal = provider.propose_optimization_objective("reduce routed wirelength")

    assert proposal["primary_metric"] == "route_wirelength"
    assert captured["user"] == {
        "schema_version": "ecos.optimization_objective_request.v1",
        "natural_language_goal": "reduce routed wirelength",
    }
    assert "primary_metric" in captured["system"]
    assert "commands" in captured["system"]
    assert captured["output_schema"]["required"] == [
        "schema_version",
        "primary_metric",
        "preserve_metrics",
        "rationale_summary",
    ]


def test_optimization_objective_parser_rejects_empty_goal(tmp_path: Path) -> None:
    provider = _provider(tmp_path)

    with pytest.raises(CodexProviderError, match="empty"):
        provider.propose_optimization_objective("  ")
