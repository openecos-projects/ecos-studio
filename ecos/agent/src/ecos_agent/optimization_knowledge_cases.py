"""Terminal empirical cases and deterministic 0/3-shot selection."""

from __future__ import annotations

from enum import StrEnum
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, field_validator, model_validator

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import TerminalObservation
from ecos_agent.optimization_rules import native_receipt_is_effective
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
Scalar = StrictBool | StrictInt | StrictFloat


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EmpiricalOutcome(StrEnum):
    SUPPORTED = "supported"
    INEFFECTIVE = "ineffective"
    CONTRADICTED = "contradicted"
    GUARDRAIL_FAILURE = "guardrail_failure"
    FAILURE = "failure"


class TerminalEmpiricalCase(_Model):
    """An immutable, terminal-closed overlay; it is never source evidence."""

    schema_version: Literal["ecos.terminal_empirical_case.v1"] = (
        "ecos.terminal_empirical_case.v1"
    )
    case_id: str
    context_fingerprint: str
    claim_id: str
    binding_id: str
    toolchain_ref: str
    requested_value: Scalar
    effective_initial: Scalar | None = None
    activation_status: Literal["used", "not_activated", "unknown"]
    receipt_sha256: str
    terminal_outcome_sha256: str
    terminal_observation_sha256: str | None = None
    guardrail_status: Literal["pass", "fail", "unknown"]
    outcome_class: EmpiricalOutcome
    design_id: str | None = None
    split: Literal["train", "dev", "test", "held_out"] | None = None

    @field_validator("case_id", "claim_id", "binding_id", "design_id")
    @classmethod
    def valid_id(cls, value: str | None) -> str | None:
        if value is not None and not _ID.fullmatch(value):
            raise ValueError("empirical case identifier is invalid")
        return value

    @field_validator("toolchain_ref")
    @classmethod
    def valid_toolchain_ref(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("empirical case toolchain hash is invalid")
        return value

    @field_validator(
        "context_fingerprint",
        "receipt_sha256",
        "terminal_outcome_sha256",
        "terminal_observation_sha256",
    )
    @classmethod
    def valid_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("empirical case hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_semantics(self) -> "TerminalEmpiricalCase":
        if self.outcome_class == EmpiricalOutcome.SUPPORTED and (
            self.activation_status != "used" or self.guardrail_status != "pass"
        ):
            raise ValueError("supported empirical cases require used activation and passing guardrails")
        return self

    @property
    def case_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))

    @property
    def terminal_closed(self) -> bool:
        return self.terminal_observation_sha256 is not None


class EmpiricalCaseSelection(_Model):
    schema_version: Literal["ecos.knowledge_case_selection.v1"] = (
        "ecos.knowledge_case_selection.v1"
    )
    selector_version: Literal["ecos.knowledge_case_selector.v1"] = (
        "ecos.knowledge_case_selector.v1"
    )
    shot_count: Literal[0, 3]
    input_cases_sha256: str
    selected_case_ids: tuple[str, ...] = Field(max_length=3)
    selection_sha256: str

    @field_validator("input_cases_sha256", "selection_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("case selection hash is invalid")
        return value

    @field_validator("selected_case_ids")
    @classmethod
    def valid_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value) or any(not _ID.fullmatch(item) for item in value):
            raise ValueError("selected case ids are invalid")
        return value

    @model_validator(mode="after")
    def verify_hash(self) -> "EmpiricalCaseSelection":
        payload = self.model_dump(mode="json", exclude={"selection_sha256"})
        if self.selection_sha256 != canonical_sha256(payload):
            raise ValueError("case selection hash does not match content")
        if self.shot_count == 0 and self.selected_case_ids:
            raise ValueError("zero-shot selection cannot contain cases")
        if self.shot_count == 3 and len(self.selected_case_ids) > 3:
            raise ValueError("three-shot selection exceeds case limit")
        return self


class EmpiricalCaseAudit(_Model):
    schema_version: Literal["ecos.knowledge_case_selection_audit.v1"] = (
        "ecos.knowledge_case_selection_audit.v1"
    )
    selection: EmpiricalCaseSelection
    selected_case_sha256: tuple[str, ...] = ()
    proposal_refs: tuple[str, ...] = ()
    receipt_refs: tuple[str, ...] = ()
    terminal_refs: tuple[str, ...] = ()

    @model_validator(mode="after")
    def verify_selected_hashes(self) -> "EmpiricalCaseAudit":
        if len(self.selected_case_sha256) != len(self.selection.selected_case_ids):
            raise ValueError("case audit hashes do not match selection")
        if any(not _SHA256.fullmatch(item) for item in self.selected_case_sha256):
            raise ValueError("case audit hash is invalid")
        for refs in (self.proposal_refs, self.receipt_refs, self.terminal_refs):
            if any(not _SHA256.fullmatch(item) for item in refs):
                raise ValueError("case audit evidence hash is invalid")
        return self

    @property
    def audit_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


def build_terminal_empirical_case(
    *,
    case_id: str,
    context_fingerprint: str,
    claim_id: str,
    binding_id: str,
    toolchain_ref: str,
    receipt: ParameterApplicationReceipt,
    terminal: TerminalObservation | None,
    outcome_class: EmpiricalOutcome,
    guardrail_status: Literal["pass", "fail", "unknown"],
    terminal_outcome_sha256: str | None = None,
    design_id: str | None = None,
    split: Literal["train", "dev", "test", "held_out"] | None = None,
) -> TerminalEmpiricalCase:
    """Create a case only from a native receipt and a terminal observation."""
    if outcome_class == EmpiricalOutcome.SUPPORTED and not native_receipt_is_effective(receipt):
        raise ValueError("supported empirical case requires an effective native receipt")
    if outcome_class == EmpiricalOutcome.SUPPORTED and (
        terminal is None or not terminal.eligible_for_incumbent
    ):
        raise ValueError("supported empirical case requires an eligible terminal observation")
    if terminal is None and terminal_outcome_sha256 is None:
        raise ValueError("empirical case requires terminal outcome evidence")
    requested = receipt.requested.get("value")
    if requested is None:
        raise ValueError("native receipt requested value is missing")
    return TerminalEmpiricalCase(
        case_id=case_id,
        context_fingerprint=context_fingerprint,
        claim_id=claim_id,
        binding_id=binding_id,
        toolchain_ref=toolchain_ref,
        requested_value=requested,
        effective_initial=receipt.effective_initial.value,
        activation_status=receipt.activation.status,
        receipt_sha256=receipt.evidence_sha256,
        terminal_outcome_sha256=terminal_outcome_sha256
        or canonical_sha256(terminal.model_dump(mode="json")),
        terminal_observation_sha256=(
            canonical_sha256(terminal.model_dump(mode="json"))
            if terminal is not None
            else None
        ),
        guardrail_status=guardrail_status,
        outcome_class=outcome_class,
        design_id=design_id,
        split=split,
    )


def select_empirical_cases(
    cases: tuple[TerminalEmpiricalCase, ...] | list[TerminalEmpiricalCase],
    *,
    shot_count: Literal[0, 3],
    context_fingerprint: str | None = None,
    toolchain_ref: str | None = None,
    binding_id: str | None = None,
    held_out_design: str | None = None,
) -> tuple[EmpiricalCaseSelection, tuple[TerminalEmpiricalCase, ...]]:
    """Select at most one case per outcome stratum with a stable case-id tie-break."""
    ordered = tuple(sorted(cases, key=lambda item: item.case_id))
    if len({item.case_id for item in ordered}) != len(ordered):
        raise ValueError("empirical case ids must be unique")
    input_hash = canonical_sha256([item.model_dump(mode="json") for item in ordered])
    if shot_count == 0:
        return _selection(shot_count, input_hash, ()), ()
    eligible = [
        item
        for item in ordered
        if _eligible(item, context_fingerprint, toolchain_ref, binding_id, held_out_design)
    ]
    strata = (
        (EmpiricalOutcome.SUPPORTED,),
        (EmpiricalOutcome.INEFFECTIVE, EmpiricalOutcome.CONTRADICTED),
        (EmpiricalOutcome.GUARDRAIL_FAILURE, EmpiricalOutcome.FAILURE),
    )
    selected = tuple(next((item for item in eligible if item.outcome_class in group), None) for group in strata)
    selected = tuple(item for item in selected if item is not None)
    selection = _selection(shot_count, input_hash, tuple(item.case_id for item in selected))
    return selection, selected


def replay_empirical_case_selection(
    audit: EmpiricalCaseAudit,
    cases: tuple[TerminalEmpiricalCase, ...] | list[TerminalEmpiricalCase],
    **filters: str | None,
) -> tuple[TerminalEmpiricalCase, ...]:
    """Recompute a selection and reject any changed input or output."""
    selected, items = select_empirical_cases(cases, shot_count=audit.selection.shot_count, **filters)
    if selected != audit.selection or tuple(item.case_sha256 for item in items) != audit.selected_case_sha256:
        raise ValueError("empirical case selection replay does not match audit")
    return items


def build_empirical_case_audit(
    selection: EmpiricalCaseSelection,
    selected_cases: tuple[TerminalEmpiricalCase, ...] | list[TerminalEmpiricalCase],
    *,
    proposal_refs: tuple[str, ...] = (),
    receipt_refs: tuple[str, ...] = (),
    terminal_refs: tuple[str, ...] = (),
) -> EmpiricalCaseAudit:
    cases = tuple(selected_cases)
    if tuple(item.case_id for item in cases) != selection.selected_case_ids:
        raise ValueError("selected cases do not match selection")
    return EmpiricalCaseAudit(
        selection=selection,
        selected_case_sha256=tuple(item.case_sha256 for item in cases),
        proposal_refs=proposal_refs,
        receipt_refs=receipt_refs,
        terminal_refs=terminal_refs,
    )


def _eligible(
    case: TerminalEmpiricalCase,
    context_fingerprint: str | None,
    toolchain_ref: str | None,
    binding_id: str | None,
    held_out_design: str | None,
) -> bool:
    return (
        case.activation_status == "used"
        and case.terminal_observation_sha256 is not None
        and case.split != "held_out"
        and (context_fingerprint is None or case.context_fingerprint == context_fingerprint)
        and (toolchain_ref is None or case.toolchain_ref == toolchain_ref)
        and (binding_id is None or case.binding_id == binding_id)
        and (
            held_out_design is None
            or (case.design_id is not None and case.design_id != held_out_design)
        )
    )


def _selection(shot_count: Literal[0, 3], input_hash: str, ids: tuple[str, ...]) -> EmpiricalCaseSelection:
    payload = {
        "schema_version": "ecos.knowledge_case_selection.v1",
        "selector_version": "ecos.knowledge_case_selector.v1",
        "shot_count": shot_count,
        "input_cases_sha256": input_hash,
        "selected_case_ids": ids,
    }
    return EmpiricalCaseSelection(**payload, selection_sha256=canonical_sha256(payload))
