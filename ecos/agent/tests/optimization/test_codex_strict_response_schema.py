"""Strict-mode response schema normalization for non-GLM providers."""

from __future__ import annotations


def test_strict_response_schema_requires_every_property_and_recurses() -> None:
    from ecos_agent.codex.provider import _strict_response_schema

    schema = {
        "type": "object",
        "properties": {
            "schema_version": {"type": "string"},
            "decision": {"type": "string", "const": "propose"},
            "either": {"anyOf": [{"type": "integer"}, {"type": "string"}]},
            "already_null": {"type": ["string", "null"]},
        },
        "required": ["decision"],
        "$defs": {
            "Effect": {
                "type": "object",
                "properties": {"metric_id": {"type": "string"}, "note": {"type": "string"}},
                "required": ["metric_id"],
            }
        },
    }

    strict = _strict_response_schema(schema)

    assert strict["required"] == ["already_null", "decision", "either", "schema_version"]
    assert strict["properties"]["schema_version"]["anyOf"] == [
        {"type": "string"},
        {"type": "null"},
    ]
    assert strict["properties"]["decision"]["type"] == "string"
    assert strict["properties"]["either"]["anyOf"][-1] == {"type": "null"}
    assert strict["properties"]["already_null"]["anyOf"] == [
        {"type": "string"},
        {"type": "null"},
    ]
    assert strict["$defs"]["Effect"]["required"] == ["metric_id", "note"]
    assert strict["$defs"]["Effect"]["properties"]["note"]["anyOf"] == [
        {"type": "string"},
        {"type": "null"},
    ]
    assert strict["additionalProperties"] is False
    assert strict["$defs"]["Effect"]["additionalProperties"] is False


def test_strict_response_schema_keeps_constraints_inside_the_non_null_branch() -> None:
    from ecos_agent.codex.provider import _strict_response_schema

    strict = _strict_response_schema(
        {
            "type": "object",
            "properties": {
                "rationale": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 512,
                    "description": "Explain the decision.",
                }
            },
            "required": [],
        }
    )

    branch = strict["properties"]["rationale"]["anyOf"][0]
    assert branch["type"] == "string"
    assert branch["minLength"] == 1
    assert branch["maxLength"] == 512
    assert strict["properties"]["rationale"]["anyOf"][1] == {"type": "null"}
    assert strict["properties"]["rationale"]["description"] == "Explain the decision."


def test_strict_response_schema_covers_the_real_proposal_envelope() -> None:
    from ecos_agent.codex.provider import (
        _optimization_proposal_output_schema_v2,
        _strict_response_schema,
    )
    from ecos_agent.optimization.parameters.contracts import OptimizationProposalV2

    schema = OptimizationProposalV2.model_json_schema()
    strict = _strict_response_schema(schema)

    assert not set(strict["properties"]) - set(strict["required"])
    for definition in strict.get("$defs", {}).values():
        if definition.get("type") == "object" and "properties" in definition:
            assert not set(definition["properties"]) - set(definition["required"])
