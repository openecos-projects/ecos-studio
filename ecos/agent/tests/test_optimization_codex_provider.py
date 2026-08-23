from __future__ import annotations

from pathlib import Path

import pytest

from ecos_agent.codex_provider import (
    CodexAppServerProposalProvider,
    CodexProviderError,
    create_required_codex_provider,
)
from ecos_agent.optimization_contracts import (
    ExpectedEffectDirection,
    HistoryReference,
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
    history = OptimizationHistory(
        reference=HistoryReference(
            intervention_id="intervention-1", outcome_sha256=HASH
        ),
        outcome=OptimizationOutcomeKind.DEGRADED,
        action=ProposalAction(
            knob_id="place.cell_padding_x",
            direction=StrategyDirection.INCREASE,
            expected_effects=(
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                },
            ),
        ),
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=2),
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
    }
    assert "workspace" not in captured["user"]
    assert "specific parameter values" in captured["system"]
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
        "action",
    ]
    assert schema["$defs"]["OptimizationKnob"]["enum"] == [
        "place.target_density",
        "place.cell_padding_x",
        "place.routability_opt",
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

    def request(**_kwargs: object) -> dict[str, object]:
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
