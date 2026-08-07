import json
import re
import shutil
from pathlib import Path

import pytest

from ecos_agent.provider import EcosAgentProvider
from ecos_agent.step_knowledge import STEP_KNOWLEDGE_SPECS, StepKnowledge, StepKnowledgeError


AGENT_ROOT = Path(__file__).parents[1]
BUNDLE_ROOT = AGENT_ROOT / "knowledge" / "place"
ECOS_ROOT = AGENT_ROOT.parents[1]
PLACE_SPEC = next(spec for spec in STEP_KNOWLEDGE_SPECS if spec.slug == "place")


def _load_place_knowledge(root: Path = BUNDLE_ROOT) -> StepKnowledge:
    return StepKnowledge.from_directory(root, PLACE_SPEC)


def test_published_bundle_covers_every_default_dreamplace_parameter() -> None:
    knowledge = _load_place_knowledge()
    config = json.loads(
        (ECOS_ROOT / "ecc/chipcompiler/tools/ecc_dreamplace/configs/dreamplace.json").read_text(
            encoding="utf-8"
        )
    )

    assert len(knowledge.entities) >= len(config) + 18
    assert {f"parameter.dreamplace.{name}" for name in config} <= set(knowledge.entity_ids)
    assert "parameter.place.global_right_padding" not in knowledge.entity_ids


def test_parameter_chunks_are_english_meaning_and_role_only() -> None:
    parameters = (BUNDLE_ROOT / "knowledge" / "parameters.md").read_text(encoding="utf-8")

    assert "**Meaning:**" in parameters
    assert "**Role:**" in parameters
    assert "**Role in the algorithm:**" not in parameters
    assert "global_right_padding" not in parameters
    assert not any("\u4e00" <= character <= "\u9fff" for character in parameters)
    assert set(re.findall(r"^\*\*([^:]+):\*\*", parameters, flags=re.MULTILINE)) == {
        "Meaning",
        "Role",
    }


def test_failure_chunks_are_english() -> None:
    failures = (BUNDLE_ROOT / "knowledge" / "failures.md").read_text(encoding="utf-8")

    assert "**Source evidence:**" in failures
    assert not any("\u4e00" <= character <= "\u9fff" for character in failures)


def test_algorithm_chunks_are_english_and_describe_place_stages() -> None:
    knowledge = _load_place_knowledge()
    algorithms = (BUNDLE_ROOT / "knowledge" / "algorithms.md").read_text(encoding="utf-8")
    expected_details = {
        "algorithm.place.execution": "global placement -> acceptance gate -> legalization -> detailed placement",
        "algorithm.dreamplace.global_placement": "three nested optimization loops",
        "algorithm.dreamplace.routability_optimization": "adjust_node_area_op",
        "algorithm.dreamplace.legalization": "MacroLegalize -> GreedyLegalize -> AbacusLegalize",
        "algorithm.dreamplace.detailed_placement": "K-Reorder -> IndependentSetMatching -> GlobalSwap -> K-Reorder",
    }

    assert "**Source evidence:**" in algorithms
    assert "default" not in algorithms.casefold()
    assert not any("\u4e00" <= character <= "\u9fff" for character in algorithms)
    for entity_id, required_text in expected_details.items():
        assert required_text in knowledge.chunk_text(entity_id)


def test_metrics_cover_gui_place_values_and_maps_with_english_calculations() -> None:
    gui_metrics = (
        ECOS_ROOT / "ecos/gui/apps/renderer/src/utils/projectManagement.ts"
    ).read_text(encoding="utf-8")
    place_metrics = re.search(r"Place: \[(?P<metrics>.*?)\],", gui_metrics, re.DOTALL)

    assert place_metrics is not None
    visible_numeric_metrics = set(re.findall(r"'(place_[^']+)'", place_metrics.group("metrics")))
    expected_map_entities = {
        "metric.place.map.cell_density",
        "metric.place.map.macro_density",
        "metric.place.map.stdcell_density",
        "metric.place.map.pin_density",
        "metric.place.map.macro_pin_density",
        "metric.place.map.stdcell_pin_density",
        "metric.place.map.net_density",
        "metric.place.map.global_net_density",
        "metric.place.map.local_net_density",
        "metric.place.map.egr_horizontal",
        "metric.place.map.egr_vertical",
        "metric.place.map.egr_union",
        "metric.place.map.rudy_horizontal",
        "metric.place.map.rudy_vertical",
        "metric.place.map.rudy_union",
        "metric.place.map.lutrudy_horizontal",
        "metric.place.map.lutrudy_vertical",
        "metric.place.map.lutrudy_union",
    }
    knowledge = _load_place_knowledge()
    metrics = (BUNDLE_ROOT / "knowledge" / "metrics.md").read_text(encoding="utf-8")

    expected_entities = {f"metric.{metric}" for metric in visible_numeric_metrics}
    assert expected_entities <= set(knowledge.entity_ids)
    assert expected_map_entities <= set(knowledge.entity_ids)
    assert not any("\u4e00" <= character <= "\u9fff" for character in metrics)
    for entity_id in expected_entities | expected_map_entities:
        chunk = knowledge.chunk_text(entity_id)
        assert "**Meaning:**" in chunk
        assert "**Calculation:**" in chunk


def test_artifact_chunks_are_english_and_describe_contents_and_generation() -> None:
    knowledge = _load_place_knowledge()
    artifacts = (BUNDLE_ROOT / "knowledge" / "artifacts.md").read_text(encoding="utf-8")
    expected_content = {
        "artifact.place.outputs": "source artifacts",
        "artifact.place.output_def": "standard-cell placement coordinates",
        "artifact.place.output_verilog": "logical connectivity",
        "artifact.place.output_gds": "physical geometry",
        "artifact.place.output_db": "routing grids, cell masters",
        "artifact.place.output_image": "placement plots",
        "artifact.place.output_json": "reserved JSON-export path",
        "artifact.place.geometry": "geometry.manifest",
        "artifact.place.view_json": "view-JSON serialization",
        "artifact.place.feature_db": "Design Information",
        "artifact.place.feature_step": "not emitted",
        "artifact.place.feature_map": "placement evaluation",
        "artifact.place.qor_metrics": '"metrics"',
        "artifact.place.qor_summary": '"gates"',
        "artifact.place.qor_hotspots": "value > 0",
        "artifact.place.log": "root logger",
    }

    assert "**Boundary:**" not in artifacts
    assert not any("\u4e00" <= character <= "\u9fff" for character in artifacts)
    for entity_id, required_text in expected_content.items():
        chunk = knowledge.chunk_text(entity_id)
        assert "**Meaning:**" in chunk
        assert "**Calculation:**" in chunk
        assert required_text in chunk


def test_regression_questions_render_only_published_markdown_chunks() -> None:
    knowledge = _load_place_knowledge()
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

    with pytest.raises(StepKnowledgeError, match="hash"):
        _load_place_knowledge(copied_bundle)


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


def test_packaged_agent_build_includes_the_external_knowledge_bundle() -> None:
    build_script = (ECOS_ROOT / ".github" / "scripts" / "build-binaries.sh").read_text(
        encoding="utf-8"
    )

    assert '--add-data "$PWD/knowledge:knowledge"' in build_script
