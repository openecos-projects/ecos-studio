import shutil
from pathlib import Path

import pytest

from ecos_agent.provider import EcosAgentProvider
from ecos_agent.step_knowledge import (
    STEP_KNOWLEDGE_SPECS,
    StepKnowledge,
    StepKnowledgeError,
)


AGENT_ROOT = Path(__file__).parents[1]
KNOWLEDGE_ROOT = AGENT_ROOT / "src" / "ecos_agent"


def test_every_non_place_step_has_a_source_audited_knowledge_bundle() -> None:
    for spec in STEP_KNOWLEDGE_SPECS:
        root = KNOWLEDGE_ROOT / f"{spec.slug}_knowledge"
        knowledge = StepKnowledge.from_directory(root, spec)
        answer = knowledge.reply(f"How does the {spec.step_name} stage execute?")

        assert {"algorithms.md", "artifacts.md", "failures.md", "metrics.md", "parameters.md"} <= {
            path.name for path in (root / "knowledge").iterdir()
        }
        assert answer is not None
        assert answer.entity_ids == (f"algorithm.{spec.slug}.execution",)
        assert answer.contract["schema_version"] == f"ecos-{spec.slug}-answer.v1"
        assert answer.contract["read_only"] is True


def test_step_bundle_rejects_changed_markdown(tmp_path: Path) -> None:
    spec = next(item for item in STEP_KNOWLEDGE_SPECS if item.slug == "cts")
    copied_bundle = tmp_path / "cts_knowledge"
    shutil.copytree(KNOWLEDGE_ROOT / "cts_knowledge", copied_bundle)
    algorithms = copied_bundle / "knowledge" / "algorithms.md"
    algorithms.write_text(algorithms.read_text(encoding="utf-8") + "\nchanged", encoding="utf-8")

    with pytest.raises(StepKnowledgeError, match="hash"):
        StepKnowledge.from_directory(copied_bundle, spec)


def test_provider_answers_cts_question_without_changing_operation_state() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "CTS stage execution"})

    answer = next(event for event in reversed(events) if event["type"] == "message")
    assert "clock-tree" in str(answer["text"])
    assert answer["contract"]["schema_version"] == "ecos-cts-answer.v1"
    assert provider.sessions[session_id].phase == "operation"


def test_short_stage_acronyms_do_not_match_an_operation_request() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "start the flow"})

    assert not any("contract" in event for event in events)


def test_package_data_includes_every_knowledge_bundle() -> None:
    pyproject = (AGENT_ROOT / "pyproject.toml").read_text(encoding="utf-8")

    assert '"*_knowledge/**/*.json"' in pyproject
    assert '"*_knowledge/**/*.md"' in pyproject
    assert '"*_knowledge/**/*.jsonl"' in pyproject
