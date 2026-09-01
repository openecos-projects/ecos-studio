"""Step-scoped general knowledge; not a flow stage."""

from __future__ import annotations

import json
from pathlib import Path

from ecos_agent.optimization.parameters.semantics import CARD_ROOT, card_hash, load_parameter_cards
from ecos_agent.optimization.parameters.contracts import ParameterSemanticsCard

from .steps import AGENT_ROOT, STAGES, _add, _json, _sha256, _source_inventory

GENERAL_DIR = AGENT_ROOT / "knowledge_sources" / "general"
GENERAL_SOURCE_PATHS = {
    "congestion": {
        "general.statements": "ecos/agent/knowledge_sources/general/congestion/statements.jsonl",
        "general.bindings": "ecos/agent/knowledge_sources/general/congestion/bindings.jsonl",
    },
    "wirelength": {
        "general.wirelength.statements": (
            "ecos/agent/knowledge_sources/general/wirelength/statements.jsonl"
        ),
        "general.wirelength.bindings": (
            "ecos/agent/knowledge_sources/general/wirelength/bindings.jsonl"
        ),
    },
}
GENERAL_KNOWLEDGE_METRICS = tuple(GENERAL_SOURCE_PATHS)
_ALLOWED_STAGES = {stage.slug for stage in STAGES}
_DIRECTION = {
    "increase": "increase",
    "decrease": "decrease",
    "set_true": "set true",
    "set_false": "set false",
}
_CONTRACT_DIRECTION = {
    "increase": "increase",
    "decrease": "decrease",
    "set_true": "enable",
    "set_false": "disable",
}
_UNSUPPORTED_BOUND_KNOBS = frozenset(
    {
        "floorplan.global_right_padding",
        "floorplan.utilitization",
        "legalization.cell_padding_x",
    }
)


def _load_jsonl(metric: str, name: str) -> list[dict[str, object]]:
    directory = GENERAL_DIR / metric
    return [
        json.loads(line)
        for line in (directory / name).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _analog(binding: dict[str, object] | None) -> str:
    if binding is None or not binding.get("knobs"):
        return "No authorized knob. Do not invent one."
    parts = []
    for knob in binding["knobs"]:
        if isinstance(knob, dict):
            direction = _DIRECTION[str(knob["direction"])]
            parts.append(f"{direction} `{knob['knob_id']}`")
    return f"{'; '.join(parts)} ({binding.get('analog_quality', 'coarse')} analog)"


def _strategy_entries(metric: str) -> tuple[list[dict[str, object]], dict[str, list[str]]]:
    bindings = {
        str(item["action_intent"]): item for item in _load_jsonl(metric, "bindings.jsonl")
    }
    source_ids = tuple(GENERAL_SOURCE_PATHS[metric])
    cards = {card.knob_id.value: card for card in load_parameter_cards().values()}
    entries: list[dict[str, object]] = []
    documents: dict[str, list[str]] = {}
    for statement in _load_jsonl(metric, "statements.jsonl"):
        intent = str(statement["action_intent"])
        diagnosis = statement["diagnosis"]
        if not isinstance(diagnosis, dict):
            raise ValueError(f"invalid diagnosis: {statement['id']}")
        stages = tuple(statement.get("scope", {}).get("stages", ()))
        if not stages or any(stage not in _ALLOWED_STAGES for stage in stages):
            raise ValueError(f"invalid stages: {statement['id']}")
        statement_metric = str(statement["id"]).split(".")[1]
        if statement_metric != metric:
            raise ValueError(f"invalid metric: {statement['id']}")
        effects = "; ".join(
            f"{item['metric']} {item['direction']}"
            for item in statement["effects"]
            if isinstance(item, dict)
        )
        body = "\n\n".join(
            [
                f"**Topic:** {statement_metric} strategy.",
                f"**Metric:** {statement_metric}.",
                f"**Applies to steps:** {', '.join(stages)}.",
                f"**Condition:** {statement['condition']}",
                f"**Diagnosis:** {str(diagnosis['cause']).replace('_', ' ')}.",
                f"**Required evidence:** {', '.join(str(item) for item in diagnosis['required_evidence'])}.",
                f"**Action intent:** {intent.replace('_', ' ')} (`{intent}`).",
                f"**Effects:** {effects}.",
                f"**Anti-conditions:** {', '.join(str(item) for item in statement['anti_conditions'])}.",
                f"**ECOS analog:** {_analog(bindings.get(intent))}",
                f"**Paper sources:** {', '.join(dict.fromkeys(str(item['source_id']) for item in statement['evidence'] if isinstance(item, dict)))}.",
            ]
        )
        _add(
            entries,
            documents,
            entity_id=str(statement["id"]),
            kind="strategy",
            aliases=(),
            document="strategies.md",
            body=body,
            evidence=source_ids,
            stages=stages,
        )
        entries[-1]["metric"] = statement_metric
        entries[-1]["support"] = _support_contract(
            statement, bindings.get(intent), entries[-1], cards
        )
    return entries, documents


def _support_contract(
    statement: dict[str, object],
    binding: dict[str, object] | None,
    entry: dict[str, object],
    cards: dict[str, ParameterSemanticsCard],
) -> dict[str, object]:
    diagnosis = statement["diagnosis"]
    if not isinstance(diagnosis, dict):
        raise ValueError(f"invalid diagnosis: {statement['id']}")
    claim_sha256 = "sha256:" + _sha256(_json(statement).encode("utf-8"))
    claim = _claim_contract(statement, entry, diagnosis, claim_sha256)
    if binding is None or not binding.get("knobs"):
        return {"claim": claim, "binding": None}
    actions = _binding_actions(binding, cards)
    if not actions:
        return {"claim": claim, "binding": None}
    binding_payload = {**binding, "actions": actions}
    binding_sha256 = "sha256:" + _sha256(_json(binding_payload).encode("utf-8"))
    toolchain_ref = "sha256:" + _sha256(
        _json(
            {"binding_sha256": binding_sha256, "source_paths": GENERAL_SOURCE_PATHS}
        ).encode("utf-8")
    )
    return {
        "claim": claim,
        "binding": {
            "schema_version": "ecos.version_bound_tool_binding.v1",
            "binding_id": binding["id"],
            "binding_sha256": binding_sha256,
            "claim_id": statement["id"],
            "claim_sha256": claim_sha256,
            "toolchain_ref": toolchain_ref,
            "actions": actions,
            "consumer_ids": _action_ids(actions, "consumer_ids"),
            "activation_predicate_ids": _action_ids(
                actions, "activation_predicate_ids"
            ),
        },
    }


def _claim_contract(
    statement: dict[str, object],
    entry: dict[str, object],
    diagnosis: dict[str, object],
    claim_sha256: str,
) -> dict[str, object]:
    return {
        "schema_version": "ecos.general_domain_claim.v1",
        "claim_ref": {
            "entity_id": statement["id"],
            "chunk_sha256": entry["chunk_sha256"],
        },
        "claim_sha256": claim_sha256,
        "stages": statement["scope"]["stages"],
        "state_predicates": statement.get("state_predicates")
        or [
            {
                "feature_id": feature_id,
                "op": "present",
                "rule_ref": "rules.evidence.present.v1",
            }
            for feature_id in diagnosis["required_evidence"]
        ],
        "anti_predicates": statement.get("anti_predicates")
        or [
            {
                "feature_id": feature_id,
                "op": "true",
                "rule_ref": "rules.anti_condition.absent.v1",
            }
            for feature_id in statement["anti_conditions"]
        ],
        "required_evidence": diagnosis["required_evidence"],
        "action_intents": [statement["action_intent"]],
        "evidence_refs": [
            f"{item['source_id']}@sha256:{item['span_sha256']}"
            for item in statement["evidence"]
        ],
        "expected_effects": [
            f"{effect['metric']}:{effect['direction']}" for effect in statement["effects"]
        ],
        "guardrails": [
            effect["metric"]
            for effect in statement["effects"]
            if effect["direction"] in {"may_increase", "unchanged"}
        ],
    }


def _binding_actions(
    binding: dict[str, object], cards: dict[str, ParameterSemanticsCard]
) -> list[dict[str, object]]:
    actions = []
    for knob in binding["knobs"]:
        card = cards.get(knob["knob_id"])
        if card is None:
            if knob["knob_id"] in _UNSUPPORTED_BOUND_KNOBS:
                continue
            raise ValueError(f"binding parameter card is unavailable: {knob['knob_id']}")
        if str(knob.get("step", "")).casefold() != card.stage.casefold():
            raise ValueError(f"binding stage does not match parameter card: {knob['knob_id']}")
        card_ref = str(
            (CARD_ROOT / "cards" / f"{card.knob_id.value}.json").relative_to(
                AGENT_ROOT
            )
        )
        actions.append(
            {
                "knob_id": knob["knob_id"],
                "direction": _CONTRACT_DIRECTION[knob["direction"]],
                "parameter_card_ref": card_ref,
                "parameter_card_sha256": card_hash(card),
                "consumer_ids": [item.consumer_id for item in card.consumers],
                "activation_predicate_ids": list(card.runtime_probe_ids),
            }
        )
    return actions


def _action_ids(actions: list[dict[str, object]], key: str) -> list[str]:
    return sorted({item for action in actions for item in action[key]})


CONGESTION_REGRESSION_CASES = (
    {
        "id": "strategy-local-move",
        "entity_id": "strategy.congestion.local_move_cells.v1",
        "required_text": "spread_local_movable_cells",
    },
    {
        "id": "strategy-global-whitespace",
        "entity_id": "strategy.congestion.global_whitespace_insufficient.v1",
        "required_text": "redistribute_global_routing_demand",
    },
    {
        "id": "strategy-padding",
        "entity_id": "strategy.congestion.pin_density_with_overflow.v1",
        "required_text": "increase_cell_padding",
    },
    {
        "id": "strategy-narrow-channel",
        "entity_id": "strategy.congestion.macro_or_narrow_channel.v1",
        "required_text": "macro_or_narrow_channel",
    },
    {
        "id": "strategy-unbound-timing",
        "entity_id": "strategy.congestion.timing_overflow_tradeoff.v1",
        "required_text": "No authorized knob",
    },
)

WIRELENGTH_REGRESSION_CASES = (
    {
        "id": "wirelength-proxy-route-validation",
        "question": "Placement HPWL improved, but routed wirelength has not been validated through route. What should happen next?",
        "entity_id": "strategy.wirelength.validate_route_after_proxy_gain.v1",
        "required_text": "validate_routed_wirelength_after_proxy_gain",
    },
    {
        "id": "wirelength-hpwl-flute-disagreement",
        "question": "Placement HPWL cannot distinguish candidate topology, or HPWL and FLUTE rank candidates differently. Which place-stage proxy should be checked?",
        "entity_id": "strategy.wirelength.use_flute_when_hpwl_is_ambiguous.v1",
        "required_text": "use_flute_as_secondary_wirelength_proxy",
    },
    {
        "id": "wirelength-clean-congestion-reduce-spreading",
        "question": "Congestion and DRC are clean, timing is within tolerance, but routed wirelength is high while routability relief remains active.",
        "entity_id": "strategy.wirelength.reduce_excessive_place_spreading.v1",
        "required_text": "reduce_excessive_place_spreading",
    },
    {
        "id": "wirelength-timing-veto",
        "question": "Wirelength improves but WNS and TNS materially worsen beyond replay noise. Should the placement candidate be accepted?",
        "entity_id": "strategy.wirelength.reject_guardrail_regression.v1",
        "required_text": "reject_wirelength_guardrail_regression",
    },
    {
        "id": "wirelength-macro-hpwl-veto",
        "question": "MacroHPWL improves but congestion, routed wirelength, WNS, and TNS degrade.",
        "entity_id": "strategy.wirelength.reject_macro_hpwl_only_gain.v1",
        "required_text": "reject_macro_hpwl_only_gain",
    },
    {
        "id": "wirelength-downstream-rebound-veto",
        "question": "Global routing improves but legalization or detailed route reverses the wirelength gain.",
        "entity_id": "strategy.wirelength.reject_post_legalization_rebound.v1",
        "required_text": "reject_post_legalization_rebound",
    },
)

REGRESSION_CASES = {
    "congestion": CONGESTION_REGRESSION_CASES,
    "wirelength": WIRELENGTH_REGRESSION_CASES,
}


def build_general_bundle(output: Path, metric: str) -> None:
    if metric not in GENERAL_KNOWLEDGE_METRICS:
        raise ValueError(f"unsupported general knowledge metric: {metric}")
    entries, documents = _strategy_entries(metric)
    knowledge = output / "knowledge"
    knowledge.mkdir(parents=True, exist_ok=True)
    for name, chunks in documents.items():
        (knowledge / name).write_text("\n".join(chunks), encoding="utf-8")
    catalog = {
        "schema_version": "ecos-general-catalog.v2",
        "domain": "ecos_general_knowledge",
        "publication": {
            "status": "source-audited",
            "scope": "step-scoped general strategies; not a flow stage",
            "metrics": [metric],
        },
        "entities": entries,
    }
    (output / "catalog.json").write_text(_json(catalog) + "\n", encoding="utf-8")
    (output / "sources.json").write_text(
        _json(_source_inventory(GENERAL_SOURCE_PATHS[metric], "ecos-general-sources.v1"))
        + "\n",
        encoding="utf-8",
    )
    regression = output / "regression"
    regression.mkdir(exist_ok=True)
    regression.joinpath(f"{metric}_questions.jsonl").write_text(
        "".join(
            _json(
                case
                if "question" in case
                else {**case, "question": f"Explain {case['entity_id']}"}
            )
            + "\n"
            for case in REGRESSION_CASES[metric]
        ),
        encoding="utf-8",
    )
    files = {
        str(path.relative_to(output)): _sha256(path.read_bytes())
        for path in sorted(output.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }
    manifest = {
        "schema_version": "ecos-general-manifest.v1",
        "files": files,
        "entity_count": len(entries),
    }
    (output / "manifest.json").write_text(_json(manifest) + "\n", encoding="utf-8")
