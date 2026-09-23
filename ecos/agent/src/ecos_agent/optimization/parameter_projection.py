"""Compact planner-facing projection of parameter semantics cards."""

from __future__ import annotations

from ecos_agent.optimization.parameters.contracts import ParameterSemanticsCard


def planner_parameter_knowledge_payload(
    card: ParameterSemanticsCard,
) -> dict[str, object]:
    """Keep decision semantics model-visible and provenance audit-only."""
    runtime = card.runtime_semantics
    return {
        "schema_version": "ecos.parameter_knowledge.planner.v1",
        "knob_id": card.knob_id.value,
        "stage": card.stage,
        "effectiveness_conditions": [
            {"kind": item.kind, "predicate": item.predicate}
            for item in card.effectiveness_conditions
        ],
        "runtime_semantics": (
            {
                "mechanism": runtime.mechanism,
                "metric_relevance": [
                    {"metric_id": item.metric_id, "relation": item.relation}
                    for item in runtime.metric_relevance
                ],
                "interactions": [
                    {"knob_id": item.knob_id.value, "relation": item.relation}
                    for item in runtime.interactions
                ],
            }
            if runtime is not None
            else None
        ),
    }
