"""Fail-closed loader for the eight reviewed parameter semantics cards."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.knob_registry import knob_spec
from ecos_agent.optimization_contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.parameter_evidence_contracts import CardManifest, ParameterSemanticsCard
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt

_PACKAGE_CARD_ROOT = Path(__file__).resolve().parent / "knowledge" / "optimization" / "parameter-effectiveness"
_SOURCE_CARD_ROOT = Path(__file__).resolve().parents[2] / "knowledge" / "optimization" / "parameter-effectiveness"
CARD_ROOT = _PACKAGE_CARD_ROOT if (_PACKAGE_CARD_ROOT / "manifest.json").is_file() else _SOURCE_CARD_ROOT
LATTICE_VERSION = "ecos.optimization_lattice.v1"
FROZEN_KNOBS = tuple(OptimizationKnob)
EXPECTED_LATTICE_COUNTS = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: 16,
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: 13,
    OptimizationKnob.SYNTH_MAX_FANOUT: 16,
    OptimizationKnob.TARGET_DENSITY: 21,
    OptimizationKnob.TARGET_OVERFLOW: 23,
    OptimizationKnob.CELL_PADDING_X: 12,
    OptimizationKnob.ROUTABILITY_OPT: 2,
    OptimizationKnob.DENSITY_WEIGHT: 18,
}


class ParameterSemanticsError(ValueError):
    """Parameter cards cannot be trusted for this runtime."""


def load_parameter_cards(root: Path | None = None, *, tool_revisions: dict[str, str] | None = None) -> dict[OptimizationKnob, ParameterSemanticsCard]:
    base = Path(root or CARD_ROOT).resolve()
    manifest_path = base / "manifest.json"
    try:
        manifest = CardManifest.model_validate_json(manifest_path.read_bytes())
    except (OSError, ValueError) as exc:
        raise ParameterSemanticsError("parameter card manifest is invalid") from exc
    if manifest.lattice_version != LATTICE_VERSION:
        raise ParameterSemanticsError("parameter lattice version does not match")
    cards: dict[OptimizationKnob, ParameterSemanticsCard] = {}
    listed = set()
    for item in manifest.cards:
        knob_id, relative, expected_hash = item.get("knob_id"), item.get("path"), item.get("sha256")
        if not isinstance(knob_id, str) or not isinstance(relative, str) or not isinstance(expected_hash, str):
            raise ParameterSemanticsError("parameter card manifest entry is invalid")
        if knob_id in listed or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise ParameterSemanticsError("parameter card manifest has duplicate or unsafe entry")
        listed.add(knob_id)
        path = base / relative
        try:
            if file_sha256(path) != expected_hash:
                raise ParameterSemanticsError("parameter card hash does not match")
            card = ParameterSemanticsCard.model_validate_json(path.read_bytes())
        except ParameterSemanticsError:
            raise
        except (OSError, ValueError) as exc:
            raise ParameterSemanticsError("parameter card is invalid") from exc
        if card.knob_id.value != knob_id or card.review.get("status") != "source-audited":
            raise ParameterSemanticsError("parameter card identity or review status is invalid")
        if len(card.requested_domain.values) != EXPECTED_LATTICE_COUNTS[card.knob_id]:
            raise ParameterSemanticsError("parameter card lattice count does not match the frozen contract")
        spec = knob_spec(knob_id)
        target = spec.read_target
        if card.surface.file != target.file or tuple(card.surface.json_path) != tuple(target.json_path):
            raise ParameterSemanticsError("parameter card surface does not match registry")
        if tool_revisions is not None and tool_revisions.get(card.tool.name) != card.tool.revision:
            raise ParameterSemanticsError("parameter card tool revision does not match")
        if card.knob_id in cards:
            raise ParameterSemanticsError("duplicate parameter card")
        cards[card.knob_id] = card
    if set(cards) != set(FROZEN_KNOBS) or len(cards) != 8:
        raise ParameterSemanticsError("parameter card set must contain exactly eight knobs")
    return cards


def validate_parameter_cards(root: Path | None = None, *, tool_revisions: dict[str, str] | None = None) -> None:
    load_parameter_cards(root, tool_revisions=tool_revisions)


def validate_application_receipt(
    receipt: ParameterApplicationReceipt,
    cards: dict[OptimizationKnob, ParameterSemanticsCard],
) -> None:
    """Validate L2 producer facts against the reviewed card allowlist."""
    if not isinstance(receipt, ParameterApplicationReceipt):
        raise ParameterSemanticsError("application receipt type is invalid")
    knob = OptimizationKnob(receipt.requested["knob_id"])
    card = cards.get(knob)
    if card is None or receipt.tool.name != card.tool.name or receipt.tool.revision != card.tool.revision:
        raise ParameterSemanticsError("application receipt tool/card binding is invalid")
    allowed = {item.get("consumer_id") for item in card.consumers}
    for consumer in receipt.activation.consumers:
        if consumer.consumer_id not in allowed:
            raise ParameterSemanticsError("application receipt consumer is not registered")


def card_hash(card: ParameterSemanticsCard) -> str:
    return canonical_sha256(card.model_dump(mode="json"))


def requested_lattice(card: ParameterSemanticsCard) -> tuple[RequestedKnobValue, ...]:
    return tuple(RequestedKnobValue(knob_id=card.knob_id, value=value) for value in card.requested_domain.values)


def narrative_view(card: ParameterSemanticsCard) -> dict[str, object]:
    return {"knob_id": card.knob_id.value, "stage": card.stage, "conditions": card.activation_conditions, "consumers": card.consumers, "source_spans": card.source_spans}


def typed_rules(card: ParameterSemanticsCard) -> tuple[dict[str, object], ...]:
    return tuple(card.resolution_rules)
