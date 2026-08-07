import json
import shutil
from pathlib import Path

import pytest

from ecos_agent.place_knowledge import PlaceKnowledge, PlaceKnowledgeError
from ecos_agent.provider import EcosAgentProvider


AGENT_ROOT = Path(__file__).parents[1]
BUNDLE_ROOT = AGENT_ROOT / "src" / "ecos_agent" / "place_knowledge"
ECOS_ROOT = AGENT_ROOT.parents[1]


def test_published_bundle_covers_every_default_dreamplace_parameter() -> None:
    knowledge = PlaceKnowledge.from_directory(BUNDLE_ROOT)
    config = json.loads(
        (ECOS_ROOT / "ecc/chipcompiler/tools/ecc_dreamplace/configs/dreamplace.json").read_text(
            encoding="utf-8"
        )
    )

    assert len(knowledge.entities) >= len(config) + 18
    assert {f"parameter.dreamplace.{name}" for name in config} <= set(knowledge.entity_ids)


def test_regression_questions_render_only_published_markdown_chunks() -> None:
    knowledge = PlaceKnowledge.from_directory(BUNDLE_ROOT)
    cases = [
        json.loads(line)
        for line in (BUNDLE_ROOT / "regression" / "place_questions.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]

    for case in cases:
        answer = knowledge.reply(case["question"])

        assert answer is not None, case["id"]
        assert case["entity_id"] in answer.entity_ids
        assert case["required_text"] in answer.text
        assert answer.text in "\n\n".join(knowledge.chunk_text(entity_id) for entity_id in answer.entity_ids)
        assert answer.contract["schema_version"] == "ecos-place-answer.v1"
        assert answer.contract["read_only"] is True


def test_bundle_rejects_a_markdown_chunk_with_a_changed_hash(tmp_path: Path) -> None:
    copied_bundle = tmp_path / "place_knowledge"
    shutil.copytree(BUNDLE_ROOT, copied_bundle)
    parameters = copied_bundle / "knowledge" / "parameters.md"
    parameters.write_text(parameters.read_text(encoding="utf-8") + "\nchanged", encoding="utf-8")

    with pytest.raises(PlaceKnowledgeError, match="hash"):
        PlaceKnowledge.from_directory(copied_bundle)


def test_provider_answers_place_questions_without_changing_operation_state() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "RUDY指标是如何计算的？"})

    answer = next(event for event in reversed(events) if event["type"] == "message")
    assert "overlap_area" in str(answer["text"])
    assert answer["contract"]["schema_version"] == "ecos-place-answer.v1"
    assert provider.sessions[session_id].phase == "operation"
    assert not any(event["type"] in {"workspace_rerun", "workspace_create"} for event in events)


def test_packaged_agent_spec_uses_the_built_in_knowledge_bundle() -> None:
    spec = (AGENT_ROOT / "packaging" / "ecos-agent.spec").read_text(encoding="utf-8")

    assert "place_knowledge" in spec
    assert "ecos-place-knowledge" not in spec
