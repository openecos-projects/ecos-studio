"""Fail-closed loader for the reviewed parameter semantics cards."""

from __future__ import annotations

import math
from pathlib import Path

from ecos_agent.hashing import canonical_sha256
from ecos_agent.workspace.knob_registry import knob_spec
from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    RequestedKnobValue,
    requested_reference_values,
)
from ecos_agent.optimization.parameters.contracts import (
    CardManifest, ParameterSemanticsCard, RequestedValueBounds,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt

_PACKAGE_CARD_ROOT = (
    Path(__file__).resolve().parents[2]
    / "knowledge"
    / "optimization"
)
_SOURCE_CARD_ROOT = (
    Path(__file__).resolve().parents[4]
    / "knowledge"
    / "optimization"
)
CARD_ROOT = (
    _PACKAGE_CARD_ROOT
    if (_PACKAGE_CARD_ROOT / "manifest.json").is_file()
    else _SOURCE_CARD_ROOT
)
LATTICE_VERSION = "ecos.optimization_lattice.v1"
FROZEN_KNOBS = tuple(OptimizationKnob)
EXPECTED_LATTICE_COUNTS = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: 16,
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: 13,
    OptimizationKnob.TARGET_DENSITY: 21,
    OptimizationKnob.TARGET_OVERFLOW: 21,
    OptimizationKnob.CELL_PADDING_X: 12,
    OptimizationKnob.ROUTABILITY_OPT: 2,
    OptimizationKnob.DENSITY_WEIGHT: 18,
}

_REGISTERED_PROBES = frozenset(
    {
        "ifp.die_builder.die_utilization",
        "ifp.die_builder.die_aspect_ratio",
        "floorplan.dimension_solver",
        "dreamplace.density_objective",
        "dreamplace.overflow_predicate",
        "dreamplace.cell_size_expansion",
        "dreamplace.routability_branch",
        "dreamplace.density_preconditioner",
    }
)
_EXPECTED_SURFACES = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: ("float", "ratio"),
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: ("float", "ratio"),
    OptimizationKnob.TARGET_DENSITY: ("float", "ratio"),
    OptimizationKnob.TARGET_OVERFLOW: ("float", "ratio"),
    OptimizationKnob.CELL_PADDING_X: ("int", "site"),
    OptimizationKnob.ROUTABILITY_OPT: ("bool", "boolean"),
    OptimizationKnob.DENSITY_WEIGHT: ("float", "objective_weight"),
}


class ParameterSemanticsError(ValueError):
    """Parameter cards cannot be trusted for this runtime."""


def _load_manifest(base: Path) -> CardManifest:
    try:
        manifest = CardManifest.model_validate_json((base / "manifest.json").read_bytes())
    except (OSError, ValueError) as exc:
        raise ParameterSemanticsError("parameter card manifest is invalid") from exc
    if manifest.lattice_version != LATTICE_VERSION:
        raise ParameterSemanticsError("parameter lattice version does not match")
    return manifest


def _load_card_entry(
    item: dict[str, str],
    base: Path,
    *,
    tool_revisions: dict[str, str] | None,
) -> ParameterSemanticsCard:
    knob_id, relative, expected_hash = (
        item.get("knob_id"),
        item.get("path"),
        item.get("sha256"),
    )
    if (
        not isinstance(knob_id, str)
        or not isinstance(relative, str)
        or not isinstance(expected_hash, str)
    ):
        raise ParameterSemanticsError("parameter card manifest entry is invalid")
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ParameterSemanticsError("parameter card manifest entry is unsafe")
    try:
        card = ParameterSemanticsCard.model_validate_json(
            (base / relative).read_bytes()
        )
        if card_hash(card) != expected_hash:
            raise ParameterSemanticsError("parameter card hash does not match")
    except ParameterSemanticsError:
        raise
    except (OSError, ValueError) as exc:
        raise ParameterSemanticsError("parameter card is invalid") from exc
    if (
        card.knob_id.value != knob_id
        or card.review.get("status") != "source-audited"
    ):
        raise ParameterSemanticsError("parameter card identity or review status is invalid")
    try:
        expected_values = tuple(item.value for item in requested_lattice(card))
    except ValueError as exc:
        raise ParameterSemanticsError("parameter card lattice is invalid") from exc
    if (
        len(expected_values) != EXPECTED_LATTICE_COUNTS[card.knob_id]
        or expected_values != requested_reference_values(card.knob_id)
        or tuple(card.requested_domain.reference_values) != expected_values
    ):
        raise ParameterSemanticsError(
            "parameter card lattice does not match the frozen contract"
        )
    spec = knob_spec(knob_id)
    target = spec.evidence_target
    expected_type, expected_unit = _EXPECTED_SURFACES[card.knob_id]
    bounds = RequestedValueBounds(
        type={"bool": "boolean", "int": "integer", "float": "number"}[expected_type],
        minimum=None if expected_type == "bool" else min(expected_values),
        maximum=None if expected_type == "bool" else max(expected_values),
    )
    if card.knob_id == OptimizationKnob.TARGET_OVERFLOW:
        bounds = RequestedValueBounds(
            type="number", minimum=0.0, maximum=1.0,
            exclusive_minimum=True, exclusive_maximum=True,
        )
    if card.requested_domain.model_dump(exclude={"reference_values"}) != bounds.model_dump():
        raise ParameterSemanticsError("parameter card bounds do not match execution contract")
    if (
        card.surface.file != target.file
        or tuple(card.surface.json_path) != tuple(target.json_path)
        or card.surface.type != expected_type
        or card.surface.unit != expected_unit
        or card.stage != spec.step.value
    ):
        raise ParameterSemanticsError("parameter card surface does not match registry")
    if (
        not card.runtime_probe_ids
        or not set(card.runtime_probe_ids) <= _REGISTERED_PROBES
    ):
        raise ParameterSemanticsError("parameter card runtime probe is not registered")
    consumer_ids = {consumer.consumer_id for consumer in card.consumers}
    if not consumer_ids or not consumer_ids <= _REGISTERED_PROBES:
        raise ParameterSemanticsError("parameter card consumer is not registered")
    roles = {span.role for span in card.source_spans}
    if card.runtime_semantics is None or any(
        span.span_id is None for span in card.source_spans
    ):
        raise ParameterSemanticsError("parameter card runtime semantics are incomplete")
    if card.tool.source_sha256 is None or "runtime_report_producer" not in roles:
        raise ParameterSemanticsError("parameter card runtime report producer is missing")
    if "native_consumer" not in roles:
        raise ParameterSemanticsError("parameter card native consumer source is missing")
    if (
        tool_revisions is not None
        and tool_revisions.get(card.tool.name) != card.tool.revision
    ):
        raise ParameterSemanticsError("parameter card tool revision does not match")
    return card


def load_parameter_card(
    knob_id: OptimizationKnob | str,
    root: Path | None = None,
    *,
    tool_revisions: dict[str, str] | None = None,
) -> ParameterSemanticsCard:
    try:
        target_knob = OptimizationKnob(knob_id)
    except (TypeError, ValueError) as exc:
        raise ParameterSemanticsError("parameter card knob is invalid") from exc
    base = Path(root or CARD_ROOT).resolve()
    manifest = _load_manifest(base)
    matches = [item for item in manifest.cards if item.get("knob_id") == target_knob.value]
    if len(matches) != 1:
        raise ParameterSemanticsError("parameter card is not listed exactly once")
    return _load_card_entry(matches[0], base, tool_revisions=tool_revisions)


def load_parameter_cards(
    root: Path | None = None, *, tool_revisions: dict[str, str] | None = None
) -> dict[OptimizationKnob, ParameterSemanticsCard]:
    base = Path(root or CARD_ROOT).resolve()
    manifest = _load_manifest(base)
    cards: dict[OptimizationKnob, ParameterSemanticsCard] = {}
    listed = set()
    for item in manifest.cards:
        knob_id = item.get("knob_id")
        if not isinstance(knob_id, str) or knob_id in listed:
            raise ParameterSemanticsError("parameter card manifest has duplicate entry")
        listed.add(knob_id)
        card = _load_card_entry(item, base, tool_revisions=tool_revisions)
        if card.knob_id in cards:
            raise ParameterSemanticsError("duplicate parameter card")
        cards[card.knob_id] = card
    if set(cards) != set(FROZEN_KNOBS) or len(cards) != 7:
        raise ParameterSemanticsError(
            "parameter card set must contain exactly seven knobs"
        )
    return cards


def validate_parameter_cards(
    root: Path | None = None, *, tool_revisions: dict[str, str] | None = None
) -> None:
    load_parameter_cards(root, tool_revisions=tool_revisions)


def _receipt_stage_matches(receipt_stage: object, card_stage: str) -> bool:
    """Stage names compare equal modulo the split-floorplan topology.

    The RPC candidate target for the floorplan knobs is "Floorplan", while
    the flow (and the reviewed cards) name the step that actually runs the
    floorplan phase "postFloorplan"; the receipt records the RPC-level name.
    """
    if receipt_stage == card_stage:
        return True
    return {receipt_stage, card_stage} == {"Floorplan", "postFloorplan"}


def validate_application_receipt(
    receipt: ParameterApplicationReceipt,
    cards: dict[OptimizationKnob, ParameterSemanticsCard],
) -> None:
    """Validate parameter observations against the reviewed tool and card binding."""
    if not isinstance(receipt, ParameterApplicationReceipt):
        raise ParameterSemanticsError("application receipt type is invalid")
    knob = OptimizationKnob(receipt.parameter.knob_id.value)
    card = cards.get(knob)
    if (
        card is None
        or receipt.tool.name != card.tool.name
        or receipt.tool.revision != card.tool.revision
    ):
        raise ParameterSemanticsError(
            "application receipt tool/card binding is invalid"
        )
    if receipt.parameter.requested.model_dump(mode="json").get("unit") != card.surface.unit:
        raise ParameterSemanticsError("application receipt unit does not match card")
    if not _receipt_stage_matches(receipt.context.get("stage"), card.stage):
        raise ParameterSemanticsError("application receipt stage does not match card")
    if receipt.context.get("lattice_version") != LATTICE_VERSION:
        raise ParameterSemanticsError(
            "application receipt lattice version does not match"
        )
    if (
        card.tool.source_sha256 is None
        or not receipt.tool.source_sha256
    ):
        raise ParameterSemanticsError(
            "application receipt tool source does not match card"
        )
    written_unit = (
        "dbu" if card.write_mapping.get("kind") == "site_to_dbu" else card.surface.unit
    )
    if receipt.materialization.unit != written_unit:
        raise ParameterSemanticsError(
            "application receipt materialization unit does not match card"
        )
    if receipt.materialization.config_before_sha256 == receipt.materialization.config_after_sha256:
        raise ParameterSemanticsError("receipt must bind a changed config")
    _validate_parameter_observation(receipt)


def _positive_count(value: object) -> bool:
    return type(value) is int and value > 0


def _same_number(left: object, right: object) -> bool:
    return (
        type(left) in {int, float}
        and type(right) in {int, float}
        and math.isfinite(left)
        and math.isfinite(right)
        and math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-7)
    )


def _validate_parameter_observation(receipt: ParameterApplicationReceipt) -> None:
    observation = receipt.observation
    parameter = receipt.parameter
    requested = parameter.requested.value
    consumed = parameter.consumed.value if parameter.consumed is not None else None
    status = receipt.application.status
    relation = receipt.application.relation
    knob = OptimizationKnob(parameter.knob_id.value)

    if status == "applied" and consumed is None:
        raise ParameterSemanticsError("applied parameter has no consumed evidence")
    if consumed is not None and isinstance(consumed, float) and not math.isfinite(consumed):
        raise ParameterSemanticsError("consumed parameter value is not finite")
    if knob == OptimizationKnob.TARGET_DENSITY:
        value = observation.get("target_density")
        if not _finite_number(value) or not 0 < value <= 1 or not _positive_count(observation.get("density_operator_call_count")):
            if status == "unknown" and consumed is None:
                return
            raise ParameterSemanticsError("parameter observation target-density consumed evidence is invalid")
        if consumed is None or not _same_number(value, consumed):
            raise ParameterSemanticsError("parameter observation target-density consumed evidence is invalid")
        floor = observation.get("utilization_floor")
        if floor is not None and (
            not _finite_number(floor) or not 0 < floor <= 1
        ):
            raise ParameterSemanticsError("parameter observation target-density floor evidence is invalid")
        expected_relation = (
            "exact" if _same_number(consumed, requested)
            else "floored" if floor is not None and _same_number(consumed, floor)
            else "transformed"
        )
        if status != "applied" or relation != expected_relation:
            raise ParameterSemanticsError("parameter observation target-density relation contradicts observation")
    elif knob == OptimizationKnob.TARGET_OVERFLOW:
        threshold = observation.get("stop_overflow")
        final = observation.get("final_overflow")
        if not _finite_number(threshold) or not 0 <= threshold <= 1:
            if status == "unknown" and consumed is None:
                return
            raise ParameterSemanticsError("parameter observation overflow threshold evidence is invalid")
        if not _finite_number(final) or final < 0:
            if status == "unknown" and consumed is None:
                return
            raise ParameterSemanticsError("parameter observation overflow application evidence is invalid")
        expected_status = "applied" if final < threshold else "inactive"
        if consumed is None or not _same_number(consumed, threshold) or status != expected_status:
            raise ParameterSemanticsError("parameter observation overflow application evidence is invalid")
    elif knob == OptimizationKnob.CELL_PADDING_X:
        value = observation.get("padding_sites")
        if not _finite_number(value) or value < 0 or not _positive_count(observation.get("geometry_apply_count")):
            if status == "unknown" and consumed is None:
                return
            raise ParameterSemanticsError("parameter observation padding consumed evidence is invalid")
        if consumed is None or not _same_number(consumed, value):
            raise ParameterSemanticsError("parameter observation padding consumed evidence is invalid")
        expected_status = "inactive" if value == 0 and requested > 0 else "applied"
        if status != expected_status or relation != "converted":
            raise ParameterSemanticsError("parameter observation padding relation contradicts observation")
    elif knob == OptimizationKnob.ROUTABILITY_OPT:
        value = observation.get("configured_routability_opt")
        rounds = observation.get("branch_round_count")
        if type(value) is not bool or type(rounds) is not int or rounds < 0:
            if status == "unknown" and consumed is None:
                return
            raise ParameterSemanticsError("parameter observation routability consumed evidence is invalid")
        expected_status = (
            "applied"
            if (value is True and requested is True and rounds > 0)
            or (value is False and requested is False and rounds == 0 and observation.get("placement_completed") is True)
            else "inactive"
            if observation.get("placement_completed") is True
            else "unknown"
        )
        if consumed is not value or status != expected_status:
            raise ParameterSemanticsError("parameter observation routability application evidence is invalid")
    elif knob == OptimizationKnob.DENSITY_WEIGHT:
        value = observation.get("configured_density_weight")
        if not _finite_number(value) or value <= 0 or not _positive_count(observation.get("initialization_count")):
            if status == "unknown" and consumed is None:
                return
            raise ParameterSemanticsError("parameter observation density-weight consumed evidence is invalid")
        if consumed is None or not _same_number(consumed, value) or status != "applied":
            raise ParameterSemanticsError("parameter observation density-weight consumed evidence is invalid")
    else:
        value = observation.get("input_configured_value")
        boundary_observed = (
            observation.get("init_fp_call_count") == 1
            and observation.get("run_fp_call_count") == 1
            and observation.get("geometry_constructed") is True
        )
        if observation.get("mode") == "die_size":
            expected_status = "inactive"
        elif (
            observation.get("mode") == "die_util"
            and boundary_observed
            and _finite_number(value)
            and value > 0
            and (knob != OptimizationKnob.FLOORPLAN_CORE_UTIL or value <= 1)
        ):
            expected_status = "applied"
        else:
            expected_status = "unknown"
        if expected_status == "applied" and (consumed is None or not _same_number(consumed, value)):
            raise ParameterSemanticsError("parameter observation floorplan consumed evidence is invalid")
        if status != expected_status:
            raise ParameterSemanticsError("parameter observation floorplan application status is invalid")
        if expected_status == "applied" and relation != ("exact" if _same_number(consumed, requested) else "transformed"):
            raise ParameterSemanticsError("parameter observation floorplan relation contradicts observation")


def _finite_number(value: object) -> bool:
    return type(value) in {int, float} and math.isfinite(value)


def card_hash(card: ParameterSemanticsCard) -> str:
    return canonical_sha256(card.model_dump(mode="json"))


def requested_lattice(card: ParameterSemanticsCard) -> tuple[RequestedKnobValue, ...]:
    return tuple(
        RequestedKnobValue(knob_id=card.knob_id, value=value)
        for value in card.requested_domain.reference_values
    )


def narrative_view(card: ParameterSemanticsCard) -> dict[str, object]:
    return {
        "knob_id": card.knob_id.value,
        "stage": card.stage,
        "requested_domain": card.requested_domain.model_dump(mode="json"),
        "effectiveness_conditions": [
            item.model_dump(mode="json") for item in card.effectiveness_conditions
        ],
        "consumers": [item.model_dump(mode="json") for item in card.consumers],
        "runtime_semantics": (
            card.runtime_semantics.model_dump(mode="json")
            if card.runtime_semantics is not None
            else None
        ),
        "source_spans": [item.model_dump(mode="json") for item in card.source_spans],
    }
