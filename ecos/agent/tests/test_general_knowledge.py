import json
from pathlib import Path

from ecos_agent.knowledge_retriever import GlobalKnowledgeRetriever
from ecos_agent.provider import EcosAgentProvider
from ecos_agent.step_knowledge import (
    GENERAL_KNOWLEDGE_SPEC,
    STEP_KNOWLEDGE_SPECS,
    load_default_general_knowledge,
    load_default_step_knowledge,
)


AGENT_ROOT = Path(__file__).parents[1]
GENERAL_ROOT = AGENT_ROOT / "knowledge" / "general" / "congestion"
PLACE_ROOT = AGENT_ROOT / "knowledge" / "tool" / "place"


def _load_general():
    return load_default_general_knowledge()


def test_general_is_not_a_flow_stage() -> None:
    assert "general" not in {spec.slug for spec in STEP_KNOWLEDGE_SPECS}
    assert len(STEP_KNOWLEDGE_SPECS) == 12
    assert GENERAL_KNOWLEDGE_SPEC.slug == "general"
    assert GENERAL_KNOWLEDGE_SPEC.catalog_schema == "ecos-general-catalog.v1"


def test_place_bundle_stays_tool_specific() -> None:
    catalog = json.loads((PLACE_ROOT / "catalog.json").read_text(encoding="utf-8"))
    assert {entity["kind"] for entity in catalog["entities"]} == {
        "algorithm",
        "artifact",
        "failure_mode",
        "metric",
        "parameter",
    }
    assert not any(str(entity["id"]).startswith("strategy.") for entity in catalog["entities"])
    assert not (PLACE_ROOT / "knowledge" / "strategies.md").exists()


def test_general_bundle_publishes_congestion_strategy_cards() -> None:
    knowledge = _load_general()
    catalog = json.loads((GENERAL_ROOT / "catalog.json").read_text(encoding="utf-8"))
    strategies = (GENERAL_ROOT / "knowledge" / "strategies.md").read_text(encoding="utf-8")

    assert catalog["schema_version"] == "ecos-general-catalog.v1"
    assert catalog["publication"]["metrics"] == ["congestion"]
    assert {entity["kind"] for entity in catalog["entities"]} == {"strategy"}
    assert len(knowledge.entities) == 18
    assert "strategy.congestion.local_move_cells.v1" in knowledge.entity_ids
    assert "strategy.congestion.macro_or_narrow_channel.v1" in knowledge.entity_ids
    entity = next(item for item in knowledge.entities if item.entity_id.endswith("macro_or_narrow_channel.v1"))
    assert entity.stages == ("place", "floorplan")
    assert "No authorized knob" in strategies
    assert "place.routability_opt" in strategies
    assert "spread_local_movable_cells" in strategies


def test_retriever_attaches_general_cards_to_steps_not_a_new_stage() -> None:
    bundles = (*load_default_step_knowledge(), _load_general())
    retriever = GlobalKnowledgeRetriever(bundles)

    assert "general" not in retriever.stage_ids
    assert set(retriever.stage_ids) == {spec.slug for spec in STEP_KNOWLEDGE_SPECS}
    assert [item["stage"] for item in retriever.stage_catalog] == list(retriever.stage_ids)
    place_summary = next(item for item in retriever.stage_catalog if item["stage"] == "place")
    assert "Execution path" in place_summary["summary"]


def test_congestion_questions_retrieve_step_scoped_strategy_cards() -> None:
    retriever = GlobalKnowledgeRetriever((*load_default_step_knowledge(), _load_general()))
    regression = [
        json.loads(line)
        for line in (GENERAL_ROOT / "regression" / "congestion_questions.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for case in regression:
        answer = retriever.reply(case["question"])
        assert answer is not None, case["id"]
        assert case["entity_id"] in answer.entity_ids
        assert case["required_text"] in answer.text
        assert {match["stage"] for match in answer.contract["matches"]} <= {"place", "floorplan"}

    distinctive = (
        (
            "many nets cross the region without connecting cells inside it",
            "strategy.congestion.global_whitespace_insufficient.v1",
            "redistribute_global_routing_demand",
        ),
        (
            "A hotspot has high pin density, not only high cell density",
            "strategy.congestion.pin_density_with_overflow.v1",
            "increase_cell_padding",
        ),
        (
            "narrow channels between macros cause routing overflow",
            "strategy.congestion.macro_or_narrow_channel.v1",
            "macro_or_narrow_channel",
        ),
    )
    for question, entity_id, required in distinctive:
        answer = retriever.reply(question)
        assert answer is not None, question
        assert entity_id in answer.entity_ids, (question, answer.entity_ids)
        assert required in answer.text
        assert {match["stage"] for match in answer.contract["matches"]} <= {"place", "floorplan"}


def test_default_provider_loads_general_without_adding_a_stage() -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    assert "general" not in provider.knowledge_retriever.stage_ids
    assert set(provider.knowledge_retriever.stage_ids) == {spec.slug for spec in STEP_KNOWLEDGE_SPECS}
    assert "strategy.congestion.local_move_cells.v1" in {
        entity.entity_id
        for bundle in (*provider.knowledge, load_default_general_knowledge())
        for entity in bundle.entities
    }
