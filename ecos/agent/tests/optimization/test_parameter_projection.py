import json

from ecos_agent.optimization.parameters.semantics import load_parameter_cards
from ecos_agent.optimization.parameter_projection import (
    planner_parameter_knowledge_payload,
)


def test_parameter_knowledge_projection_keeps_decision_semantics_only() -> None:
    cards = load_parameter_cards()
    projected = [planner_parameter_knowledge_payload(card) for card in cards.values()]

    assert len(projected) == 7
    assert all(item["schema_version"] == "ecos.parameter_knowledge.planner.v1" for item in projected)
    assert all(
        {
            "schema_version",
            "knob_id",
            "stage",
            "effectiveness_conditions",
            "runtime_semantics",
        }
        == set(item)
        for item in projected
    )

    payload = json.dumps(projected)
    for forbidden in (
        "source_spans",
        "source_span_ids",
        "runtime_probe_ids",
        "review",
        "parameter_card_sha256",
        "source_sha256",
        "write_mapping",
        "consumers",
    ):
        assert forbidden not in payload

    assert all(item["runtime_semantics"]["mechanism"] for item in projected)
    assert all(
        len(json.dumps(planner_parameter_knowledge_payload(card)))
        < len(json.dumps(card.model_dump(mode="json")))
        for card in cards.values()
    )
