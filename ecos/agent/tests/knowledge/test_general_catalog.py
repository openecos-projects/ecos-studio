import json

from ecos_agent.knowledge.retriever import GlobalKnowledgeRetriever
from ecos_agent.optimization.knowledge.compiler import (
    knowledge_support_catalog_from_bundles,
)
from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards
from ecos_agent.knowledge.step import (
    GENERAL_KNOWLEDGE_METRICS,
    GENERAL_KNOWLEDGE_SPEC,
    STEP_KNOWLEDGE_SPECS,
    load_default_general_knowledge,
    load_default_general_knowledge_bundles,
    load_default_step_knowledge,
)
from tests.paths import AGENT_ROOT

CONGESTION_ROOT = AGENT_ROOT / "knowledge" / "general" / "congestion"
WIRELENGTH_ROOT = AGENT_ROOT / "knowledge" / "general" / "wirelength"
PLACE_ROOT = AGENT_ROOT / "knowledge" / "tool" / "place"
GENERAL_SOURCE_ROOT = AGENT_ROOT / "knowledge" / "inputs" / "general"
WIRELENGTH_SOURCE_ROOT = GENERAL_SOURCE_ROOT / "wirelength"


def _load_general(metric: str = "congestion"):
    return load_default_general_knowledge(metric)


def test_general_inputs_are_nested_under_knowledge() -> None:
    assert GENERAL_SOURCE_ROOT.is_dir()
    assert not (AGENT_ROOT / "knowledge_sources").exists()


def test_general_is_not_a_flow_stage() -> None:
    assert "general" not in {spec.slug for spec in STEP_KNOWLEDGE_SPECS}
    assert len(STEP_KNOWLEDGE_SPECS) == 12
    assert GENERAL_KNOWLEDGE_METRICS == ("congestion", "wirelength")
    assert GENERAL_KNOWLEDGE_SPEC.slug == "general"
    assert GENERAL_KNOWLEDGE_SPEC.catalog_schema == "ecos-general-catalog.v2"


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


def test_general_bundles_keep_congestion_and_wirelength_separate() -> None:
    congestion = _load_general("congestion")
    wirelength = _load_general("wirelength")
    congestion_catalog = json.loads(
        (CONGESTION_ROOT / "catalog.json").read_text(encoding="utf-8")
    )
    wirelength_catalog = json.loads(
        (WIRELENGTH_ROOT / "catalog.json").read_text(encoding="utf-8")
    )
    congestion_strategies = (CONGESTION_ROOT / "knowledge" / "strategies.md").read_text(
        encoding="utf-8"
    )

    assert congestion_catalog["publication"]["metrics"] == ["congestion"]
    assert wirelength_catalog["publication"]["metrics"] == ["wirelength"]
    assert len(congestion.entities) == 18
    assert len(wirelength.entities) == 6
    assert all(entity_id.startswith("strategy.congestion.") for entity_id in congestion.entity_ids)
    assert all(entity_id.startswith("strategy.wirelength.") for entity_id in wirelength.entity_ids)
    assert not (CONGESTION_ROOT / "regression" / "wirelength_questions.jsonl").exists()
    assert not (WIRELENGTH_ROOT / "regression" / "congestion_questions.jsonl").exists()
    entity = next(item for item in congestion.entities if item.entity_id.endswith("macro_or_narrow_channel.v1"))
    assert entity.stages == ("place", "floorplan")
    assert "No authorized knob" in congestion_strategies
    assert "spread_local_movable_cells" in congestion_strategies


def test_general_bundles_publish_hash_locked_claim_action_support() -> None:
    catalog = knowledge_support_catalog_from_bundles(
        load_default_general_knowledge_bundles()
    )
    spreading = next(
        claim
        for claim in catalog.claims
        if claim.claim_ref.entity_id
        == "strategy.congestion.lower_packing_when_overflow_persists.v1"
    )
    binding = next(
        item for item in catalog.bindings if item.claim_id == spreading.claim_ref.entity_id
    )

    assert len(catalog.claims) == 24
    assert spreading.claim_sha256.startswith("sha256:")
    assert spreading.required_evidence == ("overflow_map", "cell_density_map")
    assert spreading.action_intents == ("decrease_packing_density",)
    assert spreading.evidence_refs
    assert {predicate.feature_id for predicate in spreading.state_predicates} == {
        "overflow_map",
        "cell_density_map",
    }
    assert ("place.target_density", "decrease") in {
        (action.knob_id, action.direction.value) for action in binding.actions
    }
    target_density = next(
        action for action in binding.actions if action.knob_id == "place.target_density"
    )
    card = load_parameter_cards()["place.target_density"]
    assert target_density.parameter_card_ref.endswith("place.target_density.json")
    assert target_density.parameter_card_sha256 == card_hash(card)
    assert target_density.consumer_ids == tuple(item.consumer_id for item in card.consumers)
    assert target_density.activation_predicate_ids == card.runtime_probe_ids
    assert binding.consumer_ids
    assert binding.activation_predicate_ids


def test_wirelength_bindings_expose_only_the_authorized_place_knobs() -> None:
    bindings = {
        item["action_intent"]: item
        for item in (
            json.loads(line)
            for line in (WIRELENGTH_SOURCE_ROOT / "bindings.jsonl").read_text(encoding="utf-8").splitlines()
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
    bundles = (*load_default_step_knowledge(), *load_default_general_knowledge_bundles())
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
        for line in (CONGESTION_ROOT / "regression" / "congestion_questions.jsonl").read_text(encoding="utf-8").splitlines()
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
    retriever = GlobalKnowledgeRetriever(
        (*load_default_step_knowledge(), _load_general("wirelength"))
    )
    regression = [
        json.loads(line)
        for line in (WIRELENGTH_ROOT / "regression" / "wirelength_questions.jsonl").read_text(encoding="utf-8").splitlines()
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
    answer = provider.knowledge_retriever.reply_for_stages(
        "HPWL and FLUTE rank placement candidates differently", ("place",)
    )
    assert answer is not None
    assert "strategy.wirelength.use_flute_when_hpwl_is_ambiguous.v1" in answer.entity_ids
