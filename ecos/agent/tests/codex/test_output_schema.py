import copy

import pytest

from ecos_agent.codex.provider_helpers import (
    _gui_chat_response_output_schema,
    _gui_workspace_setup_output_schema,
    _optimization_objective_output_schema,
    _optimization_proposal_output_schema_v2,
)
from tests.optimization.test_codex_proposal_provider import _domain, _provider


def _assert_explicit_schema(value):
    if isinstance(value, dict):
        assert "$ref" not in value
        assert "$defs" not in value
        types = value.get("type")
        if isinstance(types, list):
            assert "object" not in types
            assert "array" not in types
        for nested in value.values():
            _assert_explicit_schema(nested)
    elif isinstance(value, list):
        for nested in value:
            _assert_explicit_schema(nested)


@pytest.mark.parametrize("schema", [
    _gui_chat_response_output_schema(["create_flow"]),
    _optimization_objective_output_schema(),
    _optimization_proposal_output_schema_v2(_domain(), ("increase", "decrease")),
    _gui_workspace_setup_output_schema(),
])
def test_transport_normalizes_schema_without_mutating_the_contract(
    tmp_path, monkeypatch, schema,
):
    provider = _provider(tmp_path)
    original = copy.deepcopy(schema)
    sent = []
    class Client:
        def request(self, method, params):
            assert method == "turn/start"
            sent.append(params["outputSchema"])
            return {"turn": {"id": "turn-1"}}

    monkeypatch.setattr(provider, "_ensure_client", lambda: Client())
    monkeypatch.setattr(provider, "_ensure_thread", lambda _client: "thread-1")
    monkeypatch.setattr(provider, "_wait_for_turn", lambda *_args, **_kwargs: "{}")
    provider._run_turn("Hello", schema)

    wire = sent[0]
    _assert_explicit_schema(wire)
    assert schema == original
    assert wire["required"] == original["required"]
    assert wire["additionalProperties"] is False
    if "clarification" in wire["properties"]:
        variants = wire["properties"]["clarification"]["anyOf"]
        assert [variant["type"] for variant in variants] == ["object", "null"]
        assert variants[0]["properties"] == original["properties"]["clarification"]["properties"]
        assert variants[0]["required"] == ["title", "description", "options"]
        assert variants[0]["additionalProperties"] is False
    if "parameter_policy" in wire["properties"]:
        policy = wire["properties"]["parameter_policy"]["anyOf"][0]
        assert policy == original["$defs"]["OptimizationParameterPolicy"]
        assert wire["properties"]["primary_metric"] == original["$defs"]["ObjectiveMetric"]
        assert wire["properties"]["preserve_metrics"]["maxItems"] == 2
        assert wire["properties"]["rationale_summary"] == original["properties"]["rationale_summary"]
    if "action" in wire["properties"]:
        for before, after in zip(
            original["properties"]["action"]["anyOf"][:-1],
            wire["properties"]["action"]["anyOf"][:-1],
            strict=True,
        ):
            assert after["properties"]["requested_value"] == before["properties"]["requested_value"]
            assert after["properties"]["effective_domain_sha256"] == before["properties"]["effective_domain_sha256"]


def test_normalization_preserves_metadata_literal_data_and_reference_constraints():
    from ecos_agent.codex.output_schema import normalize_output_schema

    literal = {"$ref": "literal-value", "type": ["object", "null"]}
    schema = {
        "$defs": {"number/value": {"type": "integer", "minimum": 2, "maximum": 8}},
        "type": "object",
        "properties": {
            "$ref": {"type": "string"},
            "value": {"$ref": "#/$defs/number~1value", "description": "Bounded value"},
            "values": {"type": ["array", "null"], "items": {"$ref": "#/$defs/number~1value"}, "maxItems": 3},
            "literal": {"type": "object", "const": literal, "default": literal},
        },
    }
    original = copy.deepcopy(schema)
    wire = normalize_output_schema(schema)

    assert wire["properties"]["$ref"] == {"type": "string"}
    assert wire["properties"]["value"] == {
        "type": "integer", "minimum": 2, "maximum": 8, "description": "Bounded value",
    }
    variants = wire["properties"]["values"]["anyOf"]
    assert [variant["type"] for variant in variants] == ["array", "null"]
    assert variants[0]["items"] == {"type": "integer", "minimum": 2, "maximum": 8}
    assert variants[0]["maxItems"] == 3
    assert wire["properties"]["literal"]["const"] == literal
    assert wire["properties"]["literal"]["default"] == literal
    assert normalize_output_schema(wire) == wire
    wire["properties"]["literal"]["default"]["type"].clear()
    assert schema == original


@pytest.mark.parametrize("schema", [
    {"$ref": "https://example.invalid/schema.json"},
    {"$ref": "#/$defs/Missing"},
    {"$defs": {"Node": {"type": "object", "properties": {"next": {"$ref": "#/$defs/Node"}}}}, "$ref": "#/$defs/Node"},
    {"$defs": {"Bound": {"type": "integer", "maximum": 8}}, "$ref": "#/$defs/Bound", "maximum": 100},
])
def test_unsafe_reference_expansion_fails_closed(schema):
    from ecos_agent.codex.output_schema import normalize_output_schema

    with pytest.raises(ValueError):
        normalize_output_schema(schema)
