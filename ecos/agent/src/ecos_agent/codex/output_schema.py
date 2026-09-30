"""Equivalent explicit schemas for Responses API providers."""

import copy
from typing import Any
from urllib.parse import unquote


_ANNOTATIONS = {"title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly", "$comment"}
_SCHEMA_MAPS = {"properties", "patternProperties", "dependentSchemas"}
_SCHEMA_VALUES = {
    "items", "additionalItems", "additionalProperties", "unevaluatedItems",
    "unevaluatedProperties", "contains", "propertyNames", "not", "if", "then", "else",
}
_SCHEMA_LISTS = {"anyOf", "oneOf", "allOf", "prefixItems"}


def normalize_output_schema(schema: dict[str, Any]) -> dict[str, Any]:
    # ponytail: acyclic local refs only; use a schema resolver if recursive outputs are introduced.
    def resolve(ref: str) -> dict[str, Any]:
        if not isinstance(ref, str) or not ref.startswith("#/"):
            raise ValueError("Output schema references must be local JSON pointers")
        target = schema
        try:
            for key in unquote(ref[2:]).split("/"):
                target = target[key.replace("~1", "/").replace("~0", "~")]
        except (KeyError, TypeError) as exc:
            raise ValueError(f"Unresolved output schema reference: {ref}") from exc
        if not isinstance(target, dict):
            raise ValueError(f"Output schema reference is not an object: {ref}")
        return target

    def expand(node: Any, refs: tuple[str, ...] = ()) -> Any:
        if isinstance(node, bool):
            return node
        if not isinstance(node, dict):
            raise ValueError("Output schema nodes must be objects or booleans")
        if "$ref" in node:
            ref = node["$ref"]
            if ref in refs:
                raise ValueError(f"Recursive output schema reference: {ref}")
            target = expand(resolve(ref), (*refs, ref))
            siblings = expand({key: value for key, value in node.items() if key != "$ref"}, refs)
            conflicts = {
                key for key in (target.keys() & siblings.keys()) - _ANNOTATIONS
                if target[key] != siblings[key]
            }
            if conflicts:
                raise ValueError(f"Conflicting output schema reference constraints: {sorted(conflicts)}")
            return target | siblings

        result = {}
        for key, value in node.items():
            if key in {"$defs", "definitions"}:
                continue
            if key in _SCHEMA_MAPS:
                result[key] = {name: expand(child, refs) for name, child in value.items()}
            elif key in _SCHEMA_VALUES:
                result[key] = (
                    [expand(child, refs) for child in value]
                    if isinstance(value, list) else expand(value, refs)
                )
            elif key in _SCHEMA_LISTS:
                result[key] = [expand(child, refs) for child in value]
            else:
                result[key] = copy.deepcopy(value)

        types = result.get("type")
        if isinstance(types, list) and ({"object", "array"} & set(types)):
            annotations = {key: value for key, value in result.items() if key in _ANNOTATIONS}
            constraints = {key: value for key, value in result.items() if key not in _ANNOTATIONS and key != "type"}
            return {
                **annotations,
                "anyOf": [{**constraints, "type": kind} for kind in types],
            }
        return result

    return expand(schema)
