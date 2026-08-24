import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

from ecos_agent.provider import EcosAgentProvider
from ecos_agent.knowledge_retriever import GlobalKnowledgeRetriever, RetrievalConfig
from ecos_agent.step_knowledge import (
    STEP_KNOWLEDGE_SPECS,
    StepKnowledge,
    StepKnowledgeError,
)


AGENT_ROOT = Path(__file__).parents[1]
KNOWLEDGE_ROOT = AGENT_ROOT / "knowledge"


def _bundle_smoke_retriever(knowledge: StepKnowledge) -> GlobalKnowledgeRetriever:
    return GlobalKnowledgeRetriever(
        (knowledge,),
        config=RetrievalConfig(max_raw_bm25=None, min_token_overlap=2),
    )


def test_flow_knowledge_specs_include_place_in_canonical_order() -> None:
    assert [spec.slug for spec in STEP_KNOWLEDGE_SPECS] == [
        "synthesis",
        "floorplan",
        "fixfanout",
        "place",
        "cts",
        "legalization",
        "route",
        "drc",
        "filler",
        "rcx",
        "sta",
        "harden",
    ]


def test_stage_generator_builds_place_through_the_single_step_dispatch(tmp_path: Path) -> None:
    output = tmp_path / "knowledge"
    subprocess.run(
        ["uv", "run", "python", "scripts/build_knowledge.py", "--output", str(output)],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    assert sorted(path.name for path in output.iterdir() if path.is_dir()) == ["general", "tool"]
    assert sorted(path.name for path in (output / "tool").iterdir()) == sorted(
        spec.slug for spec in STEP_KNOWLEDGE_SPECS
    )
    assert sorted(path.name for path in (output / "general").iterdir()) == [
        "congestion",
        "wirelength",
    ]
    assert (output / "retrieval-config.v1.json").is_file()
    place_catalog = json.loads((output / "tool" / "place" / "catalog.json").read_text(encoding="utf-8"))
    assert place_catalog["schema_version"] == "ecos-place-catalog.v3"
    general_catalog = json.loads((output / "general" / "congestion" / "catalog.json").read_text(encoding="utf-8"))
    assert general_catalog["schema_version"] == "ecos-general-catalog.v1"
    assert "strategy" in {entity["kind"] for entity in general_catalog["entities"]}
    assert "strategy" not in {entity["kind"] for entity in place_catalog["entities"]}
    assert not (AGENT_ROOT / "scripts" / "knowledge" / "place.py").exists()
    assert "from knowledge import steps" in (AGENT_ROOT / "scripts" / "build_knowledge.py").read_text(
        encoding="utf-8"
    )


def test_committed_stage_bundles_pass_generator_check() -> None:
    subprocess.run(
        ["uv", "run", "python", "scripts/build_knowledge.py", "--check"],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_generator_check_ignores_repository_revisions(tmp_path: Path) -> None:
    output = tmp_path / "knowledge"
    shutil.copytree(KNOWLEDGE_ROOT, output)
    sources_path = output / "tool" / "place" / "sources.json"
    manifest_path = sources_path.with_name("manifest.json")
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    sources["repositories"] = dict.fromkeys(sources["repositories"], "0" * 40)
    data = (json.dumps(sources, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
    sources_path.write_bytes(data)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"][sources_path.name] = hashlib.sha256(data).hexdigest()
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    subprocess.run(
        ["uv", "run", "python", "scripts/build_knowledge.py", "--check", "--output", str(output)],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_every_flow_step_has_a_source_audited_knowledge_bundle() -> None:
    for spec in STEP_KNOWLEDGE_SPECS:
        root = KNOWLEDGE_ROOT / "tool" / spec.slug
        knowledge = StepKnowledge.from_directory(root, spec)
        answer = _bundle_smoke_retriever(knowledge).reply(
            f"How does the {spec.step_name} stage execute?"
        )

        assert {"algorithms.md", "artifacts.md", "failures.md", "metrics.md", "parameters.md"} <= {
            path.name for path in (root / "knowledge").iterdir()
        }
        assert answer is not None
        assert f"algorithm.{spec.slug}.execution" in answer.entity_ids
        assert answer.contract["schema_version"] == "ecos-knowledge-answer.v2"
        assert answer.contract["read_only"] is True


def test_step_bundles_have_entity_level_algorithm_artifact_metric_and_failure_knowledge() -> None:
    for spec in STEP_KNOWLEDGE_SPECS:
        root = KNOWLEDGE_ROOT / "tool" / spec.slug
        knowledge = StepKnowledge.from_directory(root, spec)
        documents = {
            name: (root / "knowledge" / name).read_text(encoding="utf-8")
            for name in ("algorithms.md", "artifacts.md", "failures.md", "metrics.md", "parameters.md")
        }
        anchors = {
            name: re.findall(r'<a id="([^"]+)"></a>', text)
            for name, text in documents.items()
        }
        cases = [
            json.loads(line)
            for line in (root / "regression" / f"{spec.slug}_questions.jsonl").read_text(
                encoding="utf-8"
            ).splitlines()
            if line
        ]

        assert len(anchors["algorithms.md"]) >= 5
        assert len(anchors["failures.md"]) >= 3
        assert len(cases) >= 5
        if spec.slug != "place":
            assert len(
                [case for case in cases if case["entity_id"].startswith(f"algorithm.{spec.slug}.")]
            ) >= 5
        assert "**Meaning:**" in documents["parameters.md"]
        assert "**Role:**" in documents["parameters.md"]
        assert "is the normalized" not in documents["metrics.md"]
        assert documents["metrics.md"].count("**Boundary:**") == len(anchors["metrics.md"])
        assert all(case["entity_id"] in knowledge.entity_ids for case in cases)

        if spec.slug in {"synthesis", "harden"}:
            assert len(anchors["artifacts.md"]) >= 4
        else:
            assert len(anchors["artifacts.md"]) >= 10
            assert f"artifact.{spec.slug}.output_def" in knowledge.entity_ids
            assert f"artifact.{spec.slug}.qor_metrics" in knowledge.entity_ids


def test_step_bundle_regression_questions_return_audited_read_only_answers() -> None:
    for spec in STEP_KNOWLEDGE_SPECS:
        root = KNOWLEDGE_ROOT / "tool" / spec.slug
        knowledge = StepKnowledge.from_directory(root, spec)
        cases = [
            json.loads(line)
            for line in (root / "regression" / f"{spec.slug}_questions.jsonl").read_text(
                encoding="utf-8"
            ).splitlines()
            if line
        ]

        for case in cases:
            answer = _bundle_smoke_retriever(knowledge).reply(case["question"])

            assert answer is not None
            assert case["entity_id"] in answer.entity_ids
            assert case["required_text"] in answer.text
            assert answer.contract["read_only"] is True


def test_step_bundle_rejects_changed_markdown(tmp_path: Path) -> None:
    spec = next(item for item in STEP_KNOWLEDGE_SPECS if item.slug == "cts")
    copied_bundle = tmp_path / "cts"
    shutil.copytree(KNOWLEDGE_ROOT / "tool" / "cts", copied_bundle)
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
    assert answer["contract"]["knowledge"]["schema_version"] == "ecos-knowledge-answer.v2"
    assert answer["contract"]["knowledge"]["matches"][0]["stage"] == "cts"
    assert provider.sessions[session_id].phase == "home_ready"


def test_short_stage_acronyms_do_not_match_an_operation_request() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "start the flow"})

    assert not any("contract" in event for event in events)


def test_wheel_build_copies_external_knowledge_and_removes_legacy_paths(tmp_path: Path) -> None:
    output = tmp_path / "dist"
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(output)],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    with zipfile.ZipFile(next(output.glob("*.whl"))) as wheel:
        names = wheel.namelist()
    assert "ecos_agent/knowledge/tool/place/catalog.json" in names
    assert "ecos_agent/place_knowledge.py" not in names
    assert not any("_knowledge/" in name for name in names)
    assert "graft knowledge" in (AGENT_ROOT / "MANIFEST.in").read_text(encoding="utf-8")
