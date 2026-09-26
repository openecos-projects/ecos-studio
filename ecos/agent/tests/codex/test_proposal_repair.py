"""Proposal output repair retry for the Codex app-server provider."""

import json
from pathlib import Path

import pytest

from ecos_agent.codex.provider import CodexAppServerProposalProvider, CodexProviderError


def test_proposal_repairs_one_schema_violation(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    prompts: list[str] = []

    def capture_turn(
        prompt: str, schema: dict[str, object], *, tool_policy: str, effort: str | None = None
    ) -> str:
        prompts.append(prompt)
        if len(prompts) == 1:
            return json.dumps(
                {
                    "schema_version": "flow-agent.stage_routing_slots.v1",
                    "scope": "in_scope",
                }
            )
        return json.dumps(
            {
                "schema_version": "flow-agent.stage_routing_slots.v1",
                "scope": "in_scope",
                "primary_stage": "place",
                "secondary_stage": None,
                "tertiary_stage": None,
                "rationale": "Placement question.",
            }
        )

    monkeypatch.setattr(provider, "_run_turn", capture_turn)
    monkeypatch.setattr(provider, "_ensure_client", lambda: object())
    monkeypatch.setattr(provider, "_ensure_thread", lambda client: "thread-test")

    response = provider.propose_stage_routing(
        {
            "natural_language_request": "What objective guides cell locations?",
            "stage_catalog": [
                {"stage": "place", "summary": "Place movable cells.", "chunk_sha256": "a" * 64}
            ],
        }
    )

    assert response["candidate_stages"] == ["place"]
    assert len(prompts) == 2
    assert "previous_rejected_output" in prompts[1]
    assert "schema_violation" in prompts[1]
    assert "Field required" in prompts[1]


def test_proposal_fails_closed_after_a_repair_attempt(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    calls = 0

    def capture_turn(
        prompt: str, schema: dict[str, object], *, tool_policy: str, effort: str | None = None
    ) -> str:
        nonlocal calls
        calls += 1
        return json.dumps(
            {
                "schema_version": "flow-agent.stage_routing_slots.v1",
                "scope": "in_scope",
            }
        )

    monkeypatch.setattr(provider, "_run_turn", capture_turn)
    monkeypatch.setattr(provider, "_ensure_client", lambda: object())
    monkeypatch.setattr(provider, "_ensure_thread", lambda client: "thread-test")

    with pytest.raises(CodexProviderError, match="validation errors"):
        provider.propose_stage_routing(
            {
                "natural_language_request": "What objective guides cell locations?",
                "stage_catalog": [
                    {"stage": "place", "summary": "Place movable cells.", "chunk_sha256": "a" * 64}
                ],
            }
        )

    assert calls == 2
