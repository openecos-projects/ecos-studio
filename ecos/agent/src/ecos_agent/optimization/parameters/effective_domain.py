"""Context-bound legal ranges and exact-value proposal validation."""

from __future__ import annotations

import math
import re
from typing import Any, Iterable, Literal, Mapping

from pydantic import (
    BaseModel, ConfigDict, StrictBool, StrictFloat, StrictInt,
    field_validator, model_validator,
)

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    OptimizationKnob, RequestedKnobValue, StrategyDirection,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2, ParameterSemanticsCard, Scalar,
)
from ecos_agent.optimization.parameters.semantics import card_hash


class EffectiveDomainError(ValueError):
    """A domain cannot be compiled or a proposal is outside its authority."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


_DOMAIN_CONTEXT_KEYS = {
    "design_sha256", "rtl_sha256", "filelist_sha256", "sdc_sha256", "pdk_sha256",
    "parent_lineage_sha256", "stage", "backend", "ecc_revision", "tool_revision",
    "lattice_version", "unit", "site_width_dbu", "seed", "incumbent_state_sha256",
    "parameter_card_sha256", "parent_manifest_sha256", "terminal_execution_contract_sha256",
    "current_values", "tool_source_sha256",
}


class RequestedValueBounds(_Model):
    type: Literal["boolean", "integer", "number"]
    minimum: StrictInt | StrictFloat | None = None
    maximum: StrictInt | StrictFloat | None = None
    exclusive_minimum: StrictBool = False
    exclusive_maximum: StrictBool = False

    @model_validator(mode="after")
    def valid_bounds(self) -> "RequestedValueBounds":
        if any(
            type(value) is float and not math.isfinite(value)
            for value in (self.minimum, self.maximum)
        ):
            raise ValueError("requested value bounds must be finite")
        if self.type == "boolean" and (
            self.minimum is not None or self.maximum is not None
        ):
            raise ValueError("boolean bounds cannot contain numeric endpoints")
        if (self.exclusive_minimum and self.minimum is None) or (
            self.exclusive_maximum and self.maximum is None
        ):
            raise ValueError("exclusive bounds require endpoints")
        if self.minimum is not None and self.maximum is not None and (
            self.minimum > self.maximum
            or (
                self.minimum == self.maximum
                and (self.exclusive_minimum or self.exclusive_maximum)
            )
        ):
            raise ValueError("requested value bounds are empty")
        return self

    def contains(self, value: Any) -> bool:
        if self.type == "boolean":
            return type(value) is bool
        if type(value) not in ({int} if self.type == "integer" else {int, float}):
            return False
        if type(value) is float and not math.isfinite(value):
            return False
        if self.minimum is not None and (
            value < self.minimum or (self.exclusive_minimum and value == self.minimum)
        ):
            return False
        if self.maximum is not None and (
            value > self.maximum or (self.exclusive_maximum and value == self.maximum)
        ):
            return False
        return True

    def json_schema(self) -> dict[str, Any]:
        schema: dict[str, Any] = {"type": self.type}
        if self.minimum is not None:
            schema["exclusiveMinimum" if self.exclusive_minimum else "minimum"] = self.minimum
        if self.maximum is not None:
            schema["exclusiveMaximum" if self.exclusive_maximum else "maximum"] = self.maximum
        return schema


class EffectiveDomainSnapshot(_Model):
    schema_version: Literal["ecos.effective_domain.v4"] = "ecos.effective_domain.v4"
    knob_id: OptimizationKnob
    context_sha256: str
    current_coordinate: dict[str, Any] | None = None
    value_bounds: RequestedValueBounds
    attempted_values: tuple[Scalar, ...] = ()
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
        return self

    def accepts(self, value: Any) -> bool:
        return self.value_bounds.contains(value) and value not in self.attempted_values

    def direction_schema(
        self, direction: StrategyDirection | str
    ) -> dict[str, Any] | None:
        """Intersect a direction with static bounds without selecting probe values."""
        current = (self.current_coordinate or {}).get("surface_value")
        if self.value_bounds.type == "boolean":
            if direction not in {StrategyDirection.ENABLE, StrategyDirection.DISABLE}:
                return None
            value = direction == StrategyDirection.ENABLE
            if value is current or not self.accepts(value):
                return None
            return {"type": "boolean", "enum": [value]}
        if direction not in {StrategyDirection.INCREASE, StrategyDirection.DECREASE}:
            return None
        bounds = self.value_bounds.model_dump()
        if current is not None:
            if type(current) not in {int, float} or (
                type(current) is float and not math.isfinite(current)
            ):
                raise EffectiveDomainError("effective domain current coordinate is invalid")
            if direction == StrategyDirection.INCREASE and (
                bounds["minimum"] is None or current >= bounds["minimum"]
            ):
                bounds.update(minimum=current, exclusive_minimum=True)
            if direction == StrategyDirection.DECREASE and (
                bounds["maximum"] is None or current <= bounds["maximum"]
            ):
                bounds.update(maximum=current, exclusive_maximum=True)
        try:
            directional = RequestedValueBounds(**bounds)
        except ValueError:
            return None
        if (
            directional.type == "integer"
            and directional.minimum is not None
            and directional.maximum is not None
        ):
            lower = (
                math.floor(directional.minimum) + 1
                if directional.exclusive_minimum else math.ceil(directional.minimum)
            )
            upper = (
                math.ceil(directional.maximum) - 1
                if directional.exclusive_maximum else math.floor(directional.maximum)
            )
            attempted_count = len({
                value for value in self.attempted_values
                if type(value) is int and lower <= value <= upper
            })
            if lower > upper or attempted_count == upper - lower + 1:
                return None
        return directional.json_schema()


def build_context_fingerprint(context: Mapping[str, Any]) -> str:
    """Hash the complete execution context; callers must provide all binding fields."""
    if not isinstance(context, Mapping) or not context:
        raise EffectiveDomainError("effective-domain context is empty")
    missing = sorted(
        key for key in _DOMAIN_CONTEXT_KEYS if key not in context or context[key] is None
    )
    if missing:
        raise EffectiveDomainError(
            f"effective-domain context is missing binding fields: {', '.join(missing)}"
        )
    # A run identifier is evidence provenance, not a change of execution context.
    return canonical_sha256({key: context[key] for key in sorted(_DOMAIN_CONTEXT_KEYS)})


def compile_effective_domain(
    card: ParameterSemanticsCard,
    *,
    context: Mapping[str, Any],
    attempted: Iterable[RequestedKnobValue] = (),
    baseline_surface_value: bool | int | float | None = None,
) -> EffectiveDomainSnapshot:
    bound_context = dict(context)
    for key, expected in {
        "parameter_card_sha256": card_hash(card),
        "tool_source_sha256": card.tool.source_sha256,
    }.items():
        if key in bound_context and bound_context[key] != expected:
            raise EffectiveDomainError(
                f"effective-domain {key} does not match parameter card"
            )
        bound_context[key] = expected
    context_sha = build_context_fingerprint(bound_context)
    scalar_type = {"bool": "boolean", "int": "integer", "float": "number"}.get(
        card.surface.type
    )
    if scalar_type is None:
        raise EffectiveDomainError("parameter card is not a scalar optimization parameter")
    bounds: dict[str, Any] = {"type": scalar_type}
    if scalar_type != "boolean":
        bounds.update(
            minimum=min(card.requested_domain.values),
            maximum=max(card.requested_domain.values),
        )
    if card.knob_id == OptimizationKnob.TARGET_OVERFLOW:
        bounds.update(
            minimum=0.0, maximum=1.0, exclusive_minimum=True, exclusive_maximum=True
        )
    current = baseline_surface_value
    if current is None:
        current = bound_context["current_values"].get(card.knob_id.value)
    coordinate_types = {
        "boolean": {bool}, "integer": {int, float}, "number": {int, float}
    }
    if type(current) not in coordinate_types[scalar_type] or (
        type(current) is float and not math.isfinite(current)
    ):
        raise EffectiveDomainError("effective domain current coordinate is invalid")
    attempted_values = tuple(dict.fromkeys(
        item.value for item in attempted if item.knob_id == card.knob_id
    ))
    payload = {
        "schema_version": "ecos.effective_domain.v4",
        "knob_id": card.knob_id,
        "context_sha256": context_sha,
        "current_coordinate": {"surface_value": current},
        "value_bounds": RequestedValueBounds(**bounds).model_dump(mode="json"),
        "attempted_values": attempted_values,
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
    if not domain.value_bounds.contains(action.requested_value):
        raise EffectiveDomainError("proposal value is outside the legal bounds or type")
    if action.requested_value in domain.attempted_values or any(
        item.knob_id == domain.knob_id and item.value == action.requested_value
        for item in attempted
    ):
        raise EffectiveDomainError("proposal value was already attempted")
    schema = domain.direction_schema(action.direction)
    if schema is None:
        raise EffectiveDomainError("proposal direction has no legal values or is a no-op")
    if domain.value_bounds.type == "boolean":
        if action.requested_value not in schema["enum"]:
            raise EffectiveDomainError("boolean proposal value does not match direction")
        return
    current = (domain.current_coordinate or {}).get("surface_value")
    if current is not None and (
        (
            action.direction == StrategyDirection.INCREASE
            and action.requested_value <= current
        )
        or (
            action.direction == StrategyDirection.DECREASE
            and action.requested_value >= current
        )
    ):
        raise EffectiveDomainError("proposal value does not match direction")


def validate_optimization_proposal_v2(
    payload: Mapping[str, Any],
    domain: EffectiveDomainSnapshot,
    *,
    context_ref: Mapping[str, str],
    attempted: Iterable[RequestedKnobValue] = (),
    supported_action: Mapping[str, Any] | None = None,
) -> OptimizationProposalV2:
    """Validate one range-bound proposal without granting execution authority."""
    try:
        proposal = OptimizationProposalV2.model_validate(payload)
    except (TypeError, ValueError) as exc:
        raise EffectiveDomainError("optimization proposal v3 is invalid") from exc
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
    expected = {
        "claim_id": claim_ref.get("entity_id") if isinstance(claim_ref, Mapping) else None,
        "claim_sha256": supported_action.get("claim_sha256"),
        "binding_id": supported_action.get("binding_id"),
        "binding_sha256": supported_action.get("binding_sha256"),
        "knob_id": supported_action.get("knob_id"),
        "direction": supported_action.get("direction"),
        "effective_domain_sha256": supported_action.get("effective_domain_sha256"),
    }
    actual = {key: getattr(action, key) for key in expected}
    if actual != expected:
        raise EffectiveDomainError("proposal does not match compiled knowledge support")
    try:
        bounds = RequestedValueBounds.model_validate(
            supported_action.get("requested_value_bounds")
        )
    except ValueError as exc:
        raise EffectiveDomainError("proposal does not match compiled knowledge support") from exc
    if not bounds.contains(action.requested_value):
        raise EffectiveDomainError("proposal value is not supported by knowledge action")
