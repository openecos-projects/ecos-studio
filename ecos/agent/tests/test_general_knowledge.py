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
GENERAL_SOURCE_ROOT = AGENT_ROOT / "scripts" / "knowledge" / "general"


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


def test_general_bundle_publishes_congestion_and_wirelength_strategy_cards() -> None:
    knowledge = _load_general()
    catalog = json.loads((GENERAL_ROOT / "catalog.json").read_text(encoding="utf-8"))
    strategies = (GENERAL_ROOT / "knowledge" / "strategies.md").read_text(encoding="utf-8")

    assert catalog["schema_version"] == "ecos-general-catalog.v1"
    assert catalog["publication"]["metrics"] == ["congestion", "wirelength"]
    assert {entity["kind"] for entity in catalog["entities"]} == {"strategy"}
    assert len(knowledge.entities) == 24
    assert "strategy.congestion.local_move_cells.v1" in knowledge.entity_ids
    assert "strategy.congestion.macro_or_narrow_channel.v1" in knowledge.entity_ids
    entity = next(item for item in knowledge.entities if item.entity_id.endswith("macro_or_narrow_channel.v1"))
    assert entity.stages == ("place", "floorplan")
    assert "No authorized knob" in strategies
    assert "place.routability_opt" in strategies
    assert "spread_local_movable_cells" in strategies
    assert "strategy.wirelength.validate_route_after_proxy_gain.v1" in knowledge.entity_ids
    assert "strategy.wirelength.reduce_excessive_place_spreading.v1" in knowledge.entity_ids


def test_wirelength_bindings_expose_only_the_authorized_place_knobs() -> None:
    bindings = {
        item["action_intent"]: item
        for item in (
            json.loads(line)
            for line in (GENERAL_SOURCE_ROOT / "bindings.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }
    wirelength_intents = {
        "validate_routed_wirelength_after_proxy_gain",
        "use_flute_as_secondary_wirelength_proxy",
        "reduce_excessive_place_spreading",
        "reject_wirelength_guardrail_regression",
        "reject_post_legalization_rebound",
        "reject_macro_hpwl_only_gain",
    }

    assert wirelength_intents <= bindings.keys()
    spreading = bindings["reduce_excessive_place_spreading"]
    assert spreading["review_status"] == "source_grounded"
    assert spreading["knobs"] == [
        {
            "bounds": [0.1, 0.95],
            "direction": "increase",
            "kind": "ranged",
            "knob_id": "place.target_density",
            "step": "place",
        },
        {
            "bounds": [0, None],
            "direction": "decrease",
            "kind": "zero_based_integer",
            "knob_id": "place.cell_padding_x",
            "step": "place",
        },
        {
            "direction": "set_false",
            "kind": "boolean",
            "knob_id": "place.routability_opt",
            "step": "place",
        },
    ]
    for intent in wirelength_intents - {"reduce_excessive_place_spreading"}:
        binding = bindings[intent]
        assert binding["analog_quality"] == "none"
        assert binding["knobs"] == []
        assert binding["review_status"] == "unbound"
        assert "No authorized knob. Do not invent one." in binding["note"]


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


def test_wirelength_questions_retrieve_step_scoped_strategy_cards() -> None:
    retriever = GlobalKnowledgeRetriever((*load_default_step_knowledge(), _load_general()))
    regression = [
        json.loads(line)
        for line in (GENERAL_ROOT / "regression" / "wirelength_questions.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    assert {case["id"] for case in regression} == {
        "wirelength-proxy-route-validation",
        "wirelength-hpwl-flute-disagreement",
        "wirelength-clean-congestion-reduce-spreading",
        "wirelength-timing-veto",
        "wirelength-macro-hpwl-veto",
        "wirelength-downstream-rebound-veto",
    }
    for case in regression:
        answer = retriever.reply_for_stages(case["question"], ("place",))
        assert answer is not None, case["id"]
        assert case["entity_id"] in answer.entity_ids, (case["id"], answer.entity_ids)
        assert case["required_text"] in answer.text
        assert {match["stage"] for match in answer.contract["matches"]} == {"place"}


def test_default_provider_loads_general_without_adding_a_stage() -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    assert "general" not in provider.knowledge_retriever.stage_ids
    assert set(provider.knowledge_retriever.stage_ids) == {spec.slug for spec in STEP_KNOWLEDGE_SPECS}
    assert "strategy.congestion.local_move_cells.v1" in {
        entity.entity_id
        for bundle in (*provider.knowledge, load_default_general_knowledge())
        for entity in bundle.entities
    }
