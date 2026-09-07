"""Context-bound dynamic allowlist compilation and exact-value validation."""

from __future__ import annotations

import math
import re
from typing import Any, Iterable, Literal, Mapping

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.rules import coordinate_value_from_native_receipt
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.semantics import (
    card_hash,
    requested_lattice,
    validate_application_receipt,
)


class EffectiveDomainError(ValueError):
    """A domain cannot be compiled or a proposal is outside its authority."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


_EXECUTION_CONTEXT_KEYS = {
    "design_sha256",
    "rtl_sha256",
    "filelist_sha256",
    "sdc_sha256",
    "pdk_sha256",
    "parent_lineage_sha256",
    "stage",
    "backend",
    "ecc_revision",
    "tool_revision",
    "lattice_version",
    "unit",
    "site_width_dbu",
    "seed",
}
_DOMAIN_CONTEXT_KEYS = _EXECUTION_CONTEXT_KEYS | {
    "incumbent_state_sha256",
    "parameter_card_sha256",
    "parent_manifest_sha256",
    "terminal_execution_contract_sha256",
    "current_values",
    "tool_source_sha256",
}


class DomainThreshold(_Model):
    threshold_id: str
    kind: str
    value: float
    rule_id: str
    evidence_refs: tuple[dict[str, str], ...] = ()


class EffectiveDomainSnapshot(_Model):
    schema_version: Literal["ecos.effective_domain.v3"] = "ecos.effective_domain.v3"
    knob_id: OptimizationKnob
    context_sha256: str
    current_coordinate: dict[str, Any] | None = None
    surface_values: tuple[bool | int | float, ...]
    excluded_aliases: tuple[bool | int | float, ...] = ()
    allowed_requested_values: tuple[bool | int | float, ...]
    thresholds: tuple[DomainThreshold, ...] = ()
    snapshot_sha256: str

    @field_validator("context_sha256", "snapshot_sha256")
    @classmethod
    def hashes(cls, value: str) -> str:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", value):
            raise ValueError("effective domain hash is invalid")
        return value

    @model_validator(mode="after")
    def verify(self) -> "EffectiveDomainSnapshot":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"snapshot_sha256"})
        )
        if expected != self.snapshot_sha256:
            raise ValueError("effective domain snapshot hash does not match")
        if any(
            value not in self.surface_values for value in self.allowed_requested_values
        ):
            raise ValueError("effective domain contains an unbound candidate value")
        if set(self.allowed_requested_values) & set(self.excluded_aliases):
            raise ValueError("effective domain aliases are still allowed")
        return self


def build_context_fingerprint(context: Mapping[str, Any]) -> str:
    """Hash the complete execution context; callers must provide all binding fields."""
    if not isinstance(context, Mapping) or not context:
        raise EffectiveDomainError("effective-domain context is empty")
    missing = sorted(
        key
        for key in _DOMAIN_CONTEXT_KEYS
        if key not in context or context[key] is None
    )
    if missing:
        raise EffectiveDomainError(
            f"effective-domain context is missing binding fields: {', '.join(missing)}"
        )
    # run_id identifies one execution, while the domain is reusable across the
    # same design/tool/parent context. Keep it in the receipt, out of the key.
    stable = {key: context[key] for key in _DOMAIN_CONTEXT_KEYS}
    return canonical_sha256(dict(sorted(stable.items(), key=lambda item: item[0])))


def _receipt_matches_execution_context(
    receipt: ParameterApplicationReceipt,
    context: Mapping[str, Any],
) -> bool:
    if any(
        key not in receipt.context or key not in context
        for key in _EXECUTION_CONTEXT_KEYS
    ):
        return False
    if any(receipt.context[key] != context[key] for key in _EXECUTION_CONTEXT_KEYS):
        return False
    if receipt.tool.source_sha256 != context["tool_source_sha256"]:
        return False
    return True


def _receipt_matches_context(
    receipt: ParameterApplicationReceipt,
    context: Mapping[str, Any],
    context_sha256: str,
) -> bool:
    if not _receipt_matches_execution_context(receipt, context):
        return False
    receipt_sha = receipt.context.get("context_sha256")
    return receipt_sha == context_sha256


_CANDIDATES_PER_DIRECTION = 3
_LOG_SCALE_KNOBS = frozenset({OptimizationKnob.DENSITY_WEIGHT})


def _stable_float(value: float) -> float:
    return float(f"{value:.12g}")


def _gap_midpoint(
    knob_id: OptimizationKnob,
    lower: float,
    upper: float,
    anchor: float,
    excluded: set[bool | int | float],
) -> int | float | None:
    points = sorted(
        {
            lower,
            upper,
            *(float(value) for value in excluded if lower < value < upper),
        }
    )
    if len(points) < 2 or lower >= upper:
        return None
    log_scale = knob_id in _LOG_SCALE_KNOBS
    transform = math.log10 if log_scale else lambda value: value
    left, right = max(
        zip(points, points[1:]),
        key=lambda pair: (
            transform(pair[1]) - transform(pair[0]),
            -min(abs(anchor - pair[0]), abs(anchor - pair[1])),
        ),
    )
    if knob_id == OptimizationKnob.CELL_PADDING_X:
        midpoint = int((left + right) // 2)
        return midpoint if left < midpoint < right else None
    midpoint = (
        10 ** ((transform(left) + transform(right)) / 2)
        if log_scale
        else (left + right) / 2
    )
    return _stable_float(midpoint)


def _direction_candidates(
    knob_id: OptimizationKnob,
    references: tuple[bool | int | float, ...],
    anchor: float,
    boundary: float,
    excluded: set[bool | int | float],
    floor: float | None,
) -> tuple[int | float, ...]:
    lower, upper = sorted((anchor, boundary))
    if floor is not None:
        lower = max(lower, floor)
    if lower >= upper:
        return ()
    decreasing = boundary < anchor
    reference_lower = float(min(references))
    reference_upper = float(max(references))

    def available(value: bool | int | float) -> bool:
        numeric = float(value)
        return (
            type(value) is not bool
            and value not in excluded
            and (
                0 < numeric < 1
                if knob_id == OptimizationKnob.TARGET_OVERFLOW
                else reference_lower <= numeric <= reference_upper
            )
            and lower <= numeric <= upper
            and (floor is None or numeric > floor)
            and ((numeric < anchor) if decreasing else (numeric > anchor))
        )

    ordered_references = sorted(
        (value for value in references if available(value)),
        key=lambda value: (abs(float(value) - anchor), float(value)),
    )
    candidates: list[int | float] = []
    for value in (
        ordered_references[0] if ordered_references else None,
        _gap_midpoint(knob_id, lower, upper, anchor, excluded),
        int(boundary) if knob_id == OptimizationKnob.CELL_PADDING_X else boundary,
        *ordered_references[1:],
    ):
        if value is not None and available(value) and value not in candidates:
            candidates.append(value)
        if len(candidates) == _CANDIDATES_PER_DIRECTION:
            break
    return tuple(candidates)


def _dynamic_requested_values(
    card: ParameterSemanticsCard,
    anchor: bool | int | float,
    excluded: set[bool | int | float],
    thresholds: Iterable[DomainThreshold],
) -> tuple[bool | int | float, ...]:
    references = tuple(card.requested_domain.values)
    if type(anchor) is bool:
        return tuple(
            value
            for value in references
            if type(value) is bool and value not in excluded
        )
    floor = max(
        (item.value for item in thresholds if item.kind == "admission_floor"),
        default=None,
    )
    lower, upper = float(min(references)), float(max(references))
    if card.knob_id == OptimizationKnob.TARGET_OVERFLOW:
        # Open endpoints are virtual anchors for midpoint search, never candidates.
        lower, upper = 0.0, 1.0
    candidates = (
        *_direction_candidates(
            card.knob_id, references, float(anchor), lower, excluded, floor
        ),
        *_direction_candidates(
            card.knob_id, references, float(anchor), upper, excluded, floor
        ),
    )
    return tuple(sorted(dict.fromkeys(candidates), key=float))


def compile_effective_domain(
    card: ParameterSemanticsCard,
    *,
    context: Mapping[str, Any],
    receipts: Iterable[ParameterApplicationReceipt] = (),
    current_receipts: Iterable[ParameterApplicationReceipt] = (),
    attempted: Iterable[RequestedKnobValue] = (),
    baseline_surface_value: bool | int | float | None = None,
) -> EffectiveDomainSnapshot:
    attempted = tuple(attempted)
    bound_context = dict(context)
    card_bindings = {
        "parameter_card_sha256": card_hash(card),
        "tool_source_sha256": card.tool.source_sha256,
    }
    for key, expected in card_bindings.items():
        if key in bound_context and bound_context[key] != expected:
            raise EffectiveDomainError(
                f"effective-domain {key} does not match parameter card"
            )
        bound_context[key] = expected
    context_sha = build_context_fingerprint(bound_context)
    lattice = tuple(item.value for item in requested_lattice(card))
    matching = []
    for receipt in receipts:
        if receipt.requested.get("knob_id") != card.knob_id.value:
            continue
        if not _receipt_matches_context(receipt, bound_context, context_sha):
            continue
        matching.append(receipt)
    matching_keys = {
        (receipt.receipt_id, receipt.evidence_sha256) for receipt in matching
    }
    current_matching = []
    current_value = bound_context["current_values"].get(card.knob_id.value)
    for receipt in current_receipts:
        if receipt.status != "effective":
            continue
        try:
            receipt_coordinate = coordinate_value_from_native_receipt(receipt)
        except ValueError:
            continue
        if (
            receipt.requested.get("knob_id") != card.knob_id.value
            or current_value
            not in (receipt.requested.get("value"), receipt_coordinate)
            or not _receipt_matches_execution_context(receipt, bound_context)
        ):
            continue
        current_matching.append(receipt)
        key = (receipt.receipt_id, receipt.evidence_sha256)
        if key not in matching_keys:
            matching.append(receipt)
            matching_keys.add(key)
    aliases: set[Any] = set()
    thresholds: list[DomainThreshold] = []
    for receipt in matching:
        if receipt.status != "effective":
            continue
        validate_application_receipt(receipt, {card.knob_id: card})
        requested = receipt.requested["value"]
        actual = receipt.actual_value
        floor = receipt.observation.get("utilization_floor")
        if (
            card.knob_id == OptimizationKnob.TARGET_DENSITY
            and type(floor) in {int, float}
            and floor > requested
            and math.isclose(floor, actual, rel_tol=1e-6, abs_tol=1e-7)
        ):
            rule_id = "dreamplace.target_density.utilization_floor"
            thresholds.append(
                DomainThreshold(
                    threshold_id=f"{card.knob_id.value.replace('.', '-')}-{rule_id}",
                    kind="admission_floor",
                    value=float(floor),
                    rule_id=rule_id,
                    evidence_refs=(
                        {
                            "kind": "parameter_card",
                            "ref": f"optimization/{card.knob_id.value}.json",
                            "sha256": card_hash(card),
                        },
                        {
                            "kind": "application_receipt",
                            "ref": receipt.receipt_id,
                            "sha256": receipt.evidence_sha256,
                        },
                    ),
                )
            )
            aliases.update(value for value in lattice if value <= floor)
        elif requested != actual:
            aliases.add(requested)
    aliases.update(item.value for item in attempted if item.knob_id == card.knob_id)
    coordinate = None
    if current_matching:
        latest = current_matching[-1]
        coordinate = {
            "surface_value": latest.requested.get("value"),
            "effective_anchor": latest.actual_value,
            "source_ref": latest.receipt_id,
            "source_sha256": latest.evidence_sha256,
        }
    elif baseline_surface_value is not None:
        coordinate = {"surface_value": baseline_surface_value, "effective_anchor": None}
    if coordinate is None:
        anchor = current_value
    else:
        anchor = coordinate.get("effective_anchor")
        if anchor is None:
            anchor = coordinate.get("surface_value")
    if type(anchor) not in {bool, int, float}:
        raise EffectiveDomainError("effective domain current coordinate is invalid")
    allowed = _dynamic_requested_values(card, anchor, aliases, thresholds)
    surface_values = tuple(
        dict.fromkeys((*lattice, *sorted(aliases, key=str), *allowed))
    )
    payload = {
        "schema_version": "ecos.effective_domain.v3",
        "knob_id": card.knob_id,
        "context_sha256": context_sha,
        "current_coordinate": coordinate,
        "surface_values": surface_values,
        "excluded_aliases": tuple(sorted(aliases, key=str)),
        "allowed_requested_values": allowed,
        "thresholds": [item.model_dump(mode="json") for item in thresholds],
    }
    return EffectiveDomainSnapshot(**payload, snapshot_sha256=canonical_sha256(payload))


def validate_numeric_proposal(
    proposal: Any,
    domain: EffectiveDomainSnapshot,
    *,
    attempted: Iterable[RequestedKnobValue] = (),
) -> None:
    action = getattr(proposal, "action", None)
    if action is None:
        raise EffectiveDomainError("proposal action is missing")
    if (
        action.knob_id != domain.knob_id
        or action.effective_domain_sha256 != domain.snapshot_sha256
    ):
        raise EffectiveDomainError("proposal domain does not match current context")
    if action.requested_value not in domain.allowed_requested_values:
        raise EffectiveDomainError("proposal value is not in the allowlist")
    if any(
        item.knob_id == domain.knob_id and item.value == action.requested_value
        for item in attempted
    ):
        raise EffectiveDomainError("proposal value was already attempted")
    threshold_ids = {threshold.threshold_id for threshold in domain.thresholds}
    if (
        set(action.threshold_refs) != threshold_ids
        or len(action.threshold_refs) != len(threshold_ids)
    ):
        raise EffectiveDomainError("proposal threshold references do not match domain")
    current = domain.current_coordinate
    if type(action.requested_value) is bool:
        if action.direction not in {
            StrategyDirection.ENABLE,
            StrategyDirection.DISABLE,
        }:
            raise EffectiveDomainError("boolean proposal direction is invalid")
        expected = action.direction == StrategyDirection.ENABLE
        if action.requested_value is not expected:
            raise EffectiveDomainError(
                "boolean proposal value does not match direction"
            )
        if current and action.requested_value is current.get("surface_value"):
            raise EffectiveDomainError("boolean proposal is a no-op")
        return
    if action.direction in {StrategyDirection.ENABLE, StrategyDirection.DISABLE}:
        raise EffectiveDomainError(
            "boolean proposal direction requires a boolean value"
        )
    if current and current.get("surface_value") is not None:
        anchor = current.get("effective_anchor")
        baseline = anchor if anchor is not None else current["surface_value"]
        if (
            action.direction == StrategyDirection.INCREASE
            and action.requested_value <= baseline
        ):
            raise EffectiveDomainError("increase proposal is not increasing")
        if (
            action.direction == StrategyDirection.DECREASE
            and action.requested_value >= baseline
        ):
            raise EffectiveDomainError("decrease proposal is not decreasing")


def validate_optimization_proposal_v2(
    payload: Mapping[str, Any],
    domain: EffectiveDomainSnapshot,
    *,
    context_ref: Mapping[str, str],
    attempted: Iterable[RequestedKnobValue] = (),
    supported_action: Mapping[str, Any] | None = None,
) -> OptimizationProposalV2:
    """Parse and validate one exact-value proposal without granting execution authority."""
    try:
        proposal = OptimizationProposalV2.model_validate(payload)
    except (TypeError, ValueError) as exc:
        raise EffectiveDomainError("optimization proposal v2 is invalid") from exc
    if proposal.context_ref.model_dump(mode="json") != dict(context_ref):
        raise EffectiveDomainError("proposal context does not match planning turn")
    validate_numeric_proposal(proposal, domain, attempted=attempted)
    if supported_action is not None:
        _validate_supported_action(proposal, supported_action)
    return proposal


def _validate_supported_action(
    proposal: OptimizationProposalV2, supported_action: Mapping[str, Any]
) -> None:
    action = proposal.action
    if action is None:
        raise EffectiveDomainError("proposal action is missing")
    claim_ref = supported_action.get("claim_ref")
    claim_id = claim_ref.get("entity_id") if isinstance(claim_ref, Mapping) else None
    expected = {
        "claim_id": claim_id,
        "claim_sha256": supported_action.get("claim_sha256"),
        "binding_id": supported_action.get("binding_id"),
        "binding_sha256": supported_action.get("binding_sha256"),
        "knob_id": supported_action.get("knob_id"),
        "direction": supported_action.get("direction"),
        "effective_domain_sha256": supported_action.get("effective_domain_sha256"),
    }
    actual = {
        "claim_id": action.claim_id,
        "claim_sha256": action.claim_sha256,
        "binding_id": action.binding_id,
        "binding_sha256": action.binding_sha256,
        "knob_id": action.knob_id.value,
        "direction": action.direction.value,
        "effective_domain_sha256": action.effective_domain_sha256,
    }
    allowed = supported_action.get("allowed_requested_values")
    if actual != expected or not isinstance(allowed, (tuple, list)):
        raise EffectiveDomainError("proposal does not match compiled knowledge support")
    if action.requested_value not in allowed:
        raise EffectiveDomainError("proposal value is not supported by knowledge action")
