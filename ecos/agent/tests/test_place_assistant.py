import json
from pathlib import Path

from ecos_agent.place_assistant import PlaceAssistant
from ecos_agent.place_contracts import PlaceEvidence
from ecos_agent.provider import EcosAgentProvider


def _bundle(root: Path) -> Path:
    root.mkdir()
    (root / "knowledge").mkdir()
    (root / "catalog.json").write_text(
        json.dumps(
            {
                "schema_version": "ecos-place-catalog.v1",
                "domain": "ecos_placement",
                "review_status": "approved",
                "entities": [
                    {
                        "id": "parameter.dreamplace.target_density",
                        "type": "parameter",
                        "aliases": ["target density", "target_density"],
                        "stage_scope": ["place"],
                        "tool_scope": "ecos_dreamplace",
                        "status": "user_settable",
                        "default": 0.8,
                        "document": "parameters.md",
                        "anchor": "parameter.dreamplace.target_density",
                        "review_status": "approved",
                        "evidence": [{"source_id": "ecos-source.config", "symbol": "target_density"}],
                        "relationships": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (root / "sources.json").write_text('{"sources": []}', encoding="utf-8")
    (root / "knowledge" / "parameters.md").write_text(
        '<a id="parameter.dreamplace.target_density"></a>', encoding="utf-8"
    )
    return root


def test_explain_is_read_only_and_references_the_approved_entity(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("What is target density?", language="en")

    assert answer.intent == "explain"
    assert answer.evidence_ids == ["parameter.dreamplace.target_density"]
    assert "0.8" in answer.text
    assert "does not execute" in answer.text


def test_ambiguous_utilization_direction_requires_clarification(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")

    answer = assistant.reply("Should utilization be smaller?", language="en")

    assert answer.intent == "clarify"
    assert answer.evidence_ids == []
    assert "clarify" in answer.text.lower()


def test_provider_keeps_the_existing_operation_menu_after_a_place_answer(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")
    provider = EcosAgentProvider(emit=events.append, place_assistant=assistant)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "What is target density?"})

    session = provider.sessions[session_id]
    assert session.phase == "operation"
    answer = next(event for event in reversed(events) if event["type"] == "message")
    assert answer["contract"]["schema_version"] == "ecos-place-answer.v1"
    assert events[-2]["type"] == "choice"


def test_analysis_does_not_claim_a_strategy_when_the_bundle_has_none(tmp_path: Path) -> None:
    assistant = PlaceAssistant.from_bundle(_bundle(tmp_path / "bundle"), audit_path=tmp_path / "audit.jsonl")
    evidence = PlaceEvidence(workspace_id="gcd", step_status={"place": "Success"})

    answer = assistant.reply("Analyze target density", language="en", evidence=evidence)

    assert answer.intent == "analyze"
    assert answer.evidence_ids == ["parameter.dreamplace.target_density"]
    assert "No reviewed PlaceStrategy" in answer.text
