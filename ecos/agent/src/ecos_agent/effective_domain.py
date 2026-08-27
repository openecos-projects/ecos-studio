"""Context-bound effective-domain compilation and exact-value validation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import re

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import OptimizationKnob, RequestedKnobValue, StrategyDirection
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt, ParameterSemanticsCard
from ecos_agent.parameter_evidence_contracts import OptimizationProposalV2
from ecos_agent.parameter_semantics import requested_lattice


class EffectiveDomainError(ValueError):
    """A domain cannot be compiled or a proposal is outside its authority."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


_EXECUTION_CONTEXT_KEYS = {
    "design_sha256", "rtl_sha256", "filelist_sha256", "sdc_sha256", "pdk_sha256",
    "parent_lineage_sha256", "stage", "backend", "tool_revision", "lattice_version",
    "unit", "site_width_dbu", "seed", "tool_source_sha256",
}
_DOMAIN_CONTEXT_KEYS = _EXECUTION_CONTEXT_KEYS | {
    "incumbent_state_sha256", "parameter_card_sha256", "parent_manifest_sha256",
    "terminal_execution_contract_sha256", "current_values",
}


class DomainThreshold(_Model):
    threshold_id: str
    kind: str
    value: float
    rule_id: str
    evidence_refs: tuple[dict[str, str], ...] = ()


class EffectiveDomainSnapshot(_Model):
    schema_version: str = "ecos.effective_domain.v1"
    knob_id: OptimizationKnob
    context_sha256: str
    current_coordinate: dict[str, Any] | None = None
    surface_values: tuple[bool | int | float, ...]
    excluded_aliases: tuple[bool | int | float, ...] = ()
    allowed_requested_values: tuple[bool | int | float, ...]
    thresholds: tuple[DomainThreshold, ...] = ()
    observed_application_signatures: tuple[str, ...] = ()
    observed_response_signatures: tuple[str, ...] = ()
    snapshot_sha256: str

    @field_validator("context_sha256", "snapshot_sha256")
    @classmethod
    def hashes(cls, value: str) -> str:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", value):
            raise ValueError("effective domain hash is invalid")
        return value

    @model_validator(mode="after")
    def verify(self) -> "EffectiveDomainSnapshot":
        expected = canonical_sha256(self.model_dump(mode="json", exclude={"snapshot_sha256"}))
        if expected != self.snapshot_sha256:
            raise ValueError("effective domain snapshot hash does not match")
        if any(value not in self.surface_values for value in self.allowed_requested_values):
            raise ValueError("effective domain contains a value outside the lattice")
        if set(self.allowed_requested_values) & set(self.excluded_aliases):
            raise ValueError("effective domain aliases are still allowed")
        return self


def build_context_fingerprint(context: Mapping[str, Any]) -> str:
    """Hash the complete execution context; callers must provide all binding fields."""
    if not isinstance(context, Mapping) or not context:
        raise EffectiveDomainError("effective-domain context is empty")
    # run_id identifies one execution, while the domain is reusable across the
    # same design/tool/parent context. Keep it in the receipt, out of the key.
    stable = {key: value for key, value in context.items() if key in _DOMAIN_CONTEXT_KEYS}
    if not stable:
        raise EffectiveDomainError("effective-domain context has no binding fields")
    return canonical_sha256(dict(sorted(stable.items(), key=lambda item: item[0])))


def _receipt_matches_context(
    receipt: ParameterApplicationReceipt,
    context: Mapping[str, Any],
    context_sha256: str,
) -> bool:
    receipt_sha = receipt.context.get("context_sha256")
    if receipt_sha is not None:
        return receipt_sha == context_sha256
    expected = {key: context[key] for key in _EXECUTION_CONTEXT_KEYS if key in context}
    return bool(expected) and all(receipt.context.get(key) == value for key, value in expected.items())


def application_signature(receipt: ParameterApplicationReceipt) -> str:
    return canonical_sha256({
        "requested": receipt.requested,
        "written": receipt.materialization.written_value,
        "effective_initial": receipt.effective_initial.model_dump(mode="json"),
        "context": receipt.context,
    })


def response_signature(receipt: ParameterApplicationReceipt) -> str:
    return canonical_sha256({
        "application": application_signature(receipt),
        "transitions": [item.model_dump(mode="json", by_alias=True) for item in receipt.transitions],
        "activation": receipt.activation.model_dump(mode="json"),
        "effective_final": receipt.effective_final.model_dump(mode="json"),
    })


def compile_effective_domain(
    card: ParameterSemanticsCard,
    *,
    context: Mapping[str, Any],
    receipts: Iterable[ParameterApplicationReceipt] = (),
    attempted: Iterable[RequestedKnobValue] = (),
    baseline_surface_value: bool | int | float | None = None,
) -> EffectiveDomainSnapshot:
    context_sha = build_context_fingerprint(context)
    lattice = tuple(item.value for item in requested_lattice(card))
    matching = []
    for receipt in receipts:
        if receipt.requested.get("knob_id") != card.knob_id.value:
            continue
        if not _receipt_matches_context(receipt, context, context_sha):
            continue
        matching.append(receipt)
    aliases: set[Any] = set()
    thresholds: list[DomainThreshold] = []
    for receipt in matching:
        if receipt.activation.status != "used":
            continue
        requested = receipt.requested.get("value")
        effective = receipt.effective_initial.value
        matched_rule = False
        for rule in card.resolution_rules:
            rule_id = rule.get("rule_id")
            trigger = next(
                (
                    transition
                    for transition in receipt.transitions
                    if transition.rule_id == rule_id
                    and transition.to in {"normalized", "clamped", "overridden"}
                    and transition.evidence_ref is not None
                    and transition.evidence_sha256 is not None
                ),
                None,
            )
            if (
                rule.get("kind") == "admission_floor"
                and isinstance(rule_id, str)
                and isinstance(requested, (int, float))
                and isinstance(effective, (int, float))
                and effective > requested
                and trigger is not None
            ):
                matched_rule = True
                thresholds.append(DomainThreshold(
                    threshold_id=f"{card.knob_id.value.replace('.', '-')}-{rule_id}",
                    kind="admission_floor", value=float(effective), rule_id=rule_id,
                    evidence_refs=({"kind": "application_receipt", "ref": receipt.receipt_id, "sha256": receipt.evidence_sha256},),
                ))
                aliases.update(value for value in lattice if isinstance(value, (int, float)) and value <= effective)
        if not matched_rule and requested != effective:
            aliases.add(requested)
    aliases.update(item.value for item in attempted if item.knob_id == card.knob_id)
    allowed = tuple(value for value in lattice if value not in aliases)
    coordinate = None
    if matching:
        latest = matching[-1]
        coordinate = {
            "surface_value": latest.requested.get("value"),
            "effective_anchor": latest.effective_initial.value,
            "response_signature_sha256": response_signature(latest),
            "source_ref": latest.receipt_id,
            "source_sha256": latest.evidence_sha256,
        }
    elif baseline_surface_value is not None:
        coordinate = {"surface_value": baseline_surface_value, "effective_anchor": None}
    payload = {
        "schema_version": "ecos.effective_domain.v1", "knob_id": card.knob_id,
        "context_sha256": context_sha, "current_coordinate": coordinate,
        "surface_values": lattice, "excluded_aliases": tuple(sorted(aliases, key=str)),
        "allowed_requested_values": allowed, "thresholds": [item.model_dump(mode="json") for item in thresholds],
        "observed_application_signatures": tuple(application_signature(r) for r in matching),
        "observed_response_signatures": tuple(response_signature(r) for r in matching),
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
    if action.knob_id != domain.knob_id or action.effective_domain_sha256 != domain.snapshot_sha256:
        raise EffectiveDomainError("proposal domain does not match current context")
    if action.requested_value not in domain.allowed_requested_values:
        raise EffectiveDomainError("proposal value is not in the allowlist")
    if any(item.knob_id == domain.knob_id and item.value == action.requested_value for item in attempted):
        raise EffectiveDomainError("proposal value was already attempted")
    for ref in action.threshold_refs:
        if ref not in {threshold.threshold_id for threshold in domain.thresholds}:
            raise EffectiveDomainError("proposal threshold reference is stale")
    current = domain.current_coordinate
    if current and current.get("surface_value") is not None:
        anchor = current.get("effective_anchor")
        baseline = anchor if anchor is not None else current["surface_value"]
        if action.direction == StrategyDirection.INCREASE and action.requested_value <= baseline:
            raise EffectiveDomainError("increase proposal is not increasing")
        if action.direction == StrategyDirection.DECREASE and action.requested_value >= baseline:
            raise EffectiveDomainError("decrease proposal is not decreasing")


def validate_optimization_proposal_v2(
    payload: Mapping[str, Any],
    domain: EffectiveDomainSnapshot,
    *,
    context_ref: Mapping[str, str],
    attempted: Iterable[RequestedKnobValue] = (),
) -> OptimizationProposalV2:
    """Parse and validate one exact-value proposal without granting execution authority."""
    try:
        proposal = OptimizationProposalV2.model_validate(payload)
    except (TypeError, ValueError) as exc:
        raise EffectiveDomainError("optimization proposal v2 is invalid") from exc
    if proposal.context_ref.model_dump(mode="json") != dict(context_ref):
        raise EffectiveDomainError("proposal context does not match planning turn")
    validate_numeric_proposal(proposal, domain, attempted=attempted)
    return proposal
