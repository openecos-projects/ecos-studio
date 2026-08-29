"""Fail-closed loader for the reviewed parameter semantics cards."""

from __future__ import annotations

import hashlib
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.knob_registry import knob_spec
from ecos_agent.optimization_contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.parameter_evidence_contracts import CardManifest, ParameterSemanticsCard
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt

_PACKAGE_CARD_ROOT = (
    Path(__file__).resolve().parent
    / "knowledge"
    / "optimization"
    / "parameter-effectiveness"
)
_SOURCE_CARD_ROOT = (
    Path(__file__).resolve().parents[2]
    / "knowledge"
    / "optimization"
    / "parameter-effectiveness"
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
    OptimizationKnob.SYNTH_MAX_FANOUT: 16,
    OptimizationKnob.TARGET_DENSITY: 21,
    OptimizationKnob.TARGET_OVERFLOW: 23,
    OptimizationKnob.CELL_PADDING_X: 12,
    OptimizationKnob.ROUTABILITY_OPT: 2,
    OptimizationKnob.DENSITY_WEIGHT: 18,
}

_REGISTERED_PROBES = frozenset(
    {
        "ifp.die_builder.die_utilization",
        "ifp.die_builder.die_aspect_ratio",
        "floorplan.dimension_solver",
        "fixfanout.threshold_compare",
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
    OptimizationKnob.SYNTH_MAX_FANOUT: ("int", "fanout"),
    OptimizationKnob.TARGET_DENSITY: ("float", "ratio"),
    OptimizationKnob.TARGET_OVERFLOW: ("float", "ratio"),
    OptimizationKnob.CELL_PADDING_X: ("int", "site"),
    OptimizationKnob.ROUTABILITY_OPT: ("bool", "boolean"),
    OptimizationKnob.DENSITY_WEIGHT: ("float", "objective_weight"),
}


class ParameterSemanticsError(ValueError):
    """Parameter cards cannot be trusted for this runtime."""


def load_parameter_cards(
    root: Path | None = None, *, tool_revisions: dict[str, str] | None = None
) -> dict[OptimizationKnob, ParameterSemanticsCard]:
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
        if (
            knob_id in listed
            or Path(relative).is_absolute()
            or ".." in Path(relative).parts
        ):
            raise ParameterSemanticsError(
                "parameter card manifest has duplicate or unsafe entry"
            )
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
        if (
            card.knob_id.value != knob_id
            or card.review.get("status") != "source-audited"
        ):
            raise ParameterSemanticsError(
                "parameter card identity or review status is invalid"
            )
        try:
            expected_values = tuple(item.value for item in requested_lattice(card))
        except ValueError as exc:
            raise ParameterSemanticsError("parameter card lattice is invalid") from exc
        if (
            len(expected_values) != EXPECTED_LATTICE_COUNTS[card.knob_id]
            or tuple(card.requested_domain.values) != expected_values
        ):
            raise ParameterSemanticsError(
                "parameter card lattice does not match the frozen contract"
            )
        spec = knob_spec(knob_id)
        target = spec.read_target
        expected_type, expected_unit = _EXPECTED_SURFACES[card.knob_id]
        if (
            card.surface.file != target.file
            or tuple(card.surface.json_path) != tuple(target.json_path)
            or card.surface.type != expected_type
            or card.surface.unit != expected_unit
            or card.stage != spec.step.value
        ):
            raise ParameterSemanticsError(
                "parameter card surface does not match registry"
            )
        if (
            not card.runtime_probe_ids
            or not set(card.runtime_probe_ids) <= _REGISTERED_PROBES
        ):
            raise ParameterSemanticsError(
                "parameter card runtime probe is not registered"
            )
        consumer_ids = {item.consumer_id for item in card.consumers}
        if not consumer_ids or not consumer_ids <= _REGISTERED_PROBES:
            raise ParameterSemanticsError("parameter card consumer is not registered")
        if card.tool.name == "DREAMPlace":
            roles = {span.role for span in card.source_spans}
            if card.runtime_semantics is None or any(
                span.span_id is None for span in card.source_spans
            ):
                raise ParameterSemanticsError(
                    "DREAMPlace parameter card runtime semantics are incomplete"
                )
            if (
                card.tool.source_sha256 is None
                or "runtime_report_producer" not in roles
            ):
                raise ParameterSemanticsError(
                    "DREAMPlace parameter card runtime report producer is missing"
                )
            if "native_consumer" not in roles:
                raise ParameterSemanticsError(
                    "DREAMPlace parameter card native consumer source is missing"
                )
        _validate_source_spans(card, base)
        if (
            tool_revisions is not None
            and tool_revisions.get(card.tool.name) != card.tool.revision
        ):
            raise ParameterSemanticsError("parameter card tool revision does not match")
        if card.knob_id in cards:
            raise ParameterSemanticsError("duplicate parameter card")
        cards[card.knob_id] = card
    if set(cards) != set(FROZEN_KNOBS) or len(cards) != 8:
        raise ParameterSemanticsError(
            "parameter card set must contain exactly eight knobs"
        )
    return cards


def validate_parameter_cards(
    root: Path | None = None, *, tool_revisions: dict[str, str] | None = None
) -> None:
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
    if (
        card is None
        or receipt.tool.name != card.tool.name
        or receipt.tool.revision != card.tool.revision
    ):
        raise ParameterSemanticsError(
            "application receipt tool/card binding is invalid"
        )
    if receipt.requested.get("unit") != card.surface.unit:
        raise ParameterSemanticsError("application receipt unit does not match card")
    if receipt.context.get("stage") not in {None, card.stage}:
        raise ParameterSemanticsError("application receipt stage does not match card")
    if receipt.context.get("lattice_version") not in {None, LATTICE_VERSION}:
        raise ParameterSemanticsError(
            "application receipt lattice version does not match"
        )
    if (
        card.tool.source_sha256 is None
        or receipt.tool.source_sha256 != card.tool.source_sha256
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
    if receipt.activation.status == "used" and receipt.application_status != "applied":
        raise ParameterSemanticsError("used activation requires an applied receipt")
    allowed = {item.consumer_id for item in card.consumers}
    if _is_routability_false_arm(receipt):
        _validate_routability_false_arm(receipt, allowed)
    if card.tool.name == "DREAMPlace" and receipt.activation.status in {
        "used",
        "not_activated",
    }:
        if receipt.activation.status == "used":
            _validate_dreamplace_observation(receipt)
        _validate_dreamplace_consumer_evidence(receipt)
    if (
        receipt.application_status == "applied"
        and receipt.materialization.config_before_sha256
        == receipt.materialization.config_after_sha256
    ):
        raise ParameterSemanticsError("applied receipt must bind a changed config")
    for consumer in receipt.activation.consumers:
        if consumer.consumer_id not in allowed:
            raise ParameterSemanticsError(
                "application receipt consumer is not registered"
            )


def _is_routability_false_arm(receipt: ParameterApplicationReceipt) -> bool:
    return (
        receipt.requested.get("knob_id") == "place.routability_opt"
        and receipt.requested.get("value") is False
        and receipt.application_status == "applied"
        and receipt.activation.status == "not_activated"
    )


def _validate_routability_false_arm(
    receipt: ParameterApplicationReceipt,
    allowed_consumers: set[str],
) -> None:
    observation = receipt.consumer_observation
    gate_evaluated = any(
        consumer.consumer_id in allowed_consumers and consumer.outcome == "evaluated"
        for consumer in receipt.activation.consumers
    )
    if (
        not gate_evaluated
        or not isinstance(observation, dict)
        or observation.get("evidence_complete") is not True
        or observation.get("branch_round_count") != 0
    ):
        raise ParameterSemanticsError(
            "DREAMPlace routability gate evaluation evidence is incomplete"
        )


def _validate_dreamplace_observation(receipt: ParameterApplicationReceipt) -> None:
    observation = receipt.consumer_observation
    if (
        not isinstance(observation, dict)
        or observation.get("evidence_complete") is not True
    ):
        raise ParameterSemanticsError("DREAMPlace consumer observation is incomplete")
    knob_id = receipt.requested["knob_id"]
    effective = receipt.effective_initial.value
    expected_fields = {
        "place.target_density": ("effective_target_density", "density_tensor_value"),
        "place.target_overflow": (
            "effective_stop_overflow",
            "placement_iteration_count",
        ),
        "place.cell_padding_x": ("effective_padding_dbu", "movable_node_count"),
        "place.routability_opt": ("branch_round_count",),
        "place.density_weight": (
            "configured_density_weight",
            "placement_iteration_count",
        ),
    }[knob_id]
    if any(observation.get(field) is None for field in expected_fields):
        raise ParameterSemanticsError(
            "DREAMPlace consumer observation fields are missing"
        )
    effective_field = expected_fields[0]
    if knob_id != "place.routability_opt" and observation[effective_field] != effective:
        raise ParameterSemanticsError(
            "DREAMPlace consumer observation value does not match"
        )
    if knob_id == "place.routability_opt" and observation["branch_round_count"] <= 0:
        raise ParameterSemanticsError("DREAMPlace routability consumer was not entered")


def _validate_dreamplace_consumer_evidence(
    receipt: ParameterApplicationReceipt,
) -> None:
    observation = receipt.consumer_observation
    if not isinstance(observation, dict):
        raise ParameterSemanticsError("DREAMPlace consumer observation is incomplete")
    bound_consumers = set()
    for consumer in receipt.activation.consumers:
        expected_hash = canonical_sha256(
            {
                "consumer_id": consumer.consumer_id,
                "outcome": consumer.outcome,
                "consumer_observation": observation,
            }
        )
        if consumer.evidence_sha256 != expected_hash:
            raise ParameterSemanticsError(
                "DREAMPlace consumer evidence hash does not match observation"
            )
        bound_consumers.add((consumer.evidence_ref, consumer.evidence_sha256))
    for transition in receipt.transitions:
        if (
            receipt.requested["knob_id"] == "place.target_density"
            and transition.to == "overridden"
            and transition.rule_id == "dreamplace.target_density.utilization_floor"
            and (transition.evidence_ref, transition.evidence_sha256)
            not in bound_consumers
        ):
            raise ParameterSemanticsError(
                "DREAMPlace transition evidence is not bound to activation consumer"
            )


def _validate_source_spans(card: ParameterSemanticsCard, card_root: Path) -> None:
    if not card.source_spans:
        raise ParameterSemanticsError("parameter card source spans are missing")
    source_checkout = _source_checkout_root()
    producer_source_bound = False
    for span in card.source_spans:
        if source_checkout is None:
            if card_root != _PACKAGE_CARD_ROOT:
                raise ParameterSemanticsError(
                    "parameter card source checkout is unavailable"
                )
            continue
        path = (source_checkout / span.file).resolve()
        try:
            path.relative_to(source_checkout)
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, ValueError, UnicodeError) as exc:
            raise ParameterSemanticsError(
                "parameter card source span is unavailable"
            ) from exc
        if (
            span.end > len(lines)
            or _span_sha256(lines, span.start, span.end) != span.sha256
        ):
            raise ParameterSemanticsError(
                "parameter card source span hash does not match"
            )
        if (
            span.role == "runtime_report_producer"
            and file_sha256(path) == card.tool.source_sha256
        ):
            producer_source_bound = True
    if card.tool.source_sha256 is None or (
        source_checkout is not None and not producer_source_bound
    ):
        raise ParameterSemanticsError(
            "parameter card tool source is not a report producer"
        )


def _span_sha256(lines: list[str], start: int, end: int) -> str:
    text = "\n".join(lines[start - 1 : end]) + "\n"
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _source_checkout_root() -> Path | None:
    path = Path(__file__).resolve()
    if len(path.parents) <= 4:
        return None
    root = path.parents[4]
    return root if (root / "ecc").is_dir() else None


def card_hash(card: ParameterSemanticsCard) -> str:
    return canonical_sha256(card.model_dump(mode="json"))


def requested_lattice(card: ParameterSemanticsCard) -> tuple[RequestedKnobValue, ...]:
    return tuple(
        RequestedKnobValue(knob_id=card.knob_id, value=value)
        for value in card.requested_domain.values
    )


def narrative_view(card: ParameterSemanticsCard) -> dict[str, object]:
    return {
        "knob_id": card.knob_id.value,
        "stage": card.stage,
        "conditions": [
            item.model_dump(mode="json") for item in card.activation_conditions
        ],
        "consumers": [item.model_dump(mode="json") for item in card.consumers],
        "runtime_semantics": (
            card.runtime_semantics.model_dump(mode="json")
            if card.runtime_semantics is not None
            else None
        ),
        "source_spans": [item.model_dump(mode="json") for item in card.source_spans],
    }


def typed_rules(card: ParameterSemanticsCard) -> tuple[dict[str, object], ...]:
    return tuple(card.resolution_rules)
