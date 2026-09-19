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


def _assert_no_null_valued_keywords(node: object) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            assert value is not None, f"null keyword value at .{key}"
            _assert_no_null_valued_keywords(value)
    elif isinstance(node, list):
        for value in node:
            _assert_no_null_valued_keywords(value)


def test_strict_response_schema_strips_null_keyword_values() -> None:
    # Strict structured-output endpoints reject e.g. `"default": null` and
    # `"description": null` with `None is not of type 'string'` request errors
    # (observed on the gpt-5.6-terra provider; GLM tolerated them).
    from ecos_agent.codex.provider import _strict_response_schema

    strict = _strict_response_schema(
        {
            "type": "object",
            "properties": {
                "note": {"type": "string", "default": None},
                "claim": {"type": "string"},
            },
            "required": [],
        }
    )

    _assert_no_null_valued_keywords(strict)
    assert strict["properties"]["note"]["anyOf"][0]["type"] == "string"


def test_real_proposal_strict_schema_carries_no_null_keyword_values() -> None:
    from ecos_agent.codex.provider import _strict_response_schema
    from ecos_agent.optimization.parameters.contracts import OptimizationProposalV2

    strict = _strict_response_schema(OptimizationProposalV2.model_json_schema())

    _assert_no_null_valued_keywords(strict)


def test_turn_submission_normalizes_schema_only_for_strict_providers(tmp_path) -> None:
    from tests.optimization.test_codex_proposal_provider import _provider

    schema = {
        "type": "object",
        "properties": {"note": {"type": "string", "default": None}},
        "required": [],
    }

    def submitted(model: str | None) -> dict:
        provider = _provider(tmp_path)
        provider._model = model
        provider._interrupted = False
        provider._ensure_client = lambda: object()
        provider._ensure_thread = lambda client: "thread-1"
        captured: dict[str, object] = {}
        provider._start_and_wait = (
            lambda client, thread_id, method, params, *, tool_policy="none":
            captured.setdefault("schema", params["outputSchema"]) or ""
        )
        provider._run_turn("prompt", schema)
        return captured["schema"]

    terra = submitted("gpt-5.6-terra")
    assert terra["required"] == ["note"]
    assert "default" not in terra["properties"]["note"]

    glm = submitted("glm-5.3-flash")
    assert glm == schema
