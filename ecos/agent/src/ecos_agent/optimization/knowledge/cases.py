"""Terminal empirical cases and deterministic 0/3-shot selection."""

from __future__ import annotations

import fcntl
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
import re
from typing import Annotated, Iterator, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    ValidationError,
    field_validator,
    model_validator,
)

from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import TerminalObservation
from ecos_agent.optimization.ledger import OptimizationTerminalOutcome
from ecos_agent.optimization.rules import native_receipt_is_effective
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
Scalar = StrictBool | StrictInt | StrictFloat
_CASE_EVIDENCE_HASH_FIELDS = (
    "proposal_sha256",
    "effective_domain_sha256",
    "parameter_card_sha256",
    "materialization_receipt_sha256",
    "receipt_sha256",
    "terminal_outcome_sha256",
    "terminal_observation_sha256",
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EmpiricalOutcome(StrEnum):
    SUPPORTED = "supported"
    INEFFECTIVE = "ineffective"
    CONTRADICTED = "contradicted"
    GUARDRAIL_FAILURE = "guardrail_failure"
    FAILURE = "failure"


class EmpiricalCaseAuditError(ValueError):
    """Base error for the immutable empirical-case audit."""


class EmpiricalCaseAuditIntegrityError(EmpiricalCaseAuditError):
    """The persisted empirical-case chain cannot be trusted."""


class EmpiricalCaseAuditRecoveryRequired(EmpiricalCaseAuditError):
    """The empirical-case audit ended in a torn write."""


class TerminalEmpiricalCase(_Model):
    """An immutable, terminal-closed overlay; it is never source evidence."""

    schema_version: Literal["ecos.terminal_empirical_case.v2"] = (
        "ecos.terminal_empirical_case.v2"
    )
    case_id: str
    context_fingerprint: str
    claim_id: str
    binding_id: str
    toolchain_ref: str
    requested_value: Scalar
    effective_initial: Scalar | None = None
    activation_status: Literal["used", "not_activated", "unknown"]
    proposal_sha256: str
    effective_domain_sha256: str
    parameter_card_sha256: str
    materialization_receipt_sha256: str
    receipt_sha256: str
    terminal_outcome_sha256: str
    terminal_observation_sha256: str
    evidence_status: Literal["current", "stale"] = "current"
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
        "proposal_sha256",
        "effective_domain_sha256",
        "parameter_card_sha256",
        "materialization_receipt_sha256",
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
            raise ValueError(
                "supported empirical cases require used activation and passing guardrails"
            )
        return self

    @property
    def case_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))

    @property
    def terminal_closed(self) -> bool:
        return True


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
    effective_domain_refs: tuple[str, ...] = ()
    parameter_card_refs: tuple[str, ...] = ()
    materialization_refs: tuple[str, ...] = ()
    receipt_refs: tuple[str, ...] = ()
    terminal_outcome_refs: tuple[str, ...] = ()
    terminal_refs: tuple[str, ...] = ()

    @model_validator(mode="after")
    def verify_selected_hashes(self) -> "EmpiricalCaseAudit":
        if len(self.selected_case_sha256) != len(self.selection.selected_case_ids):
            raise ValueError("case audit hashes do not match selection")
        if any(not _SHA256.fullmatch(item) for item in self.selected_case_sha256):
            raise ValueError("case audit hash is invalid")
        refs_by_layer = (
            self.proposal_refs,
            self.effective_domain_refs,
            self.parameter_card_refs,
            self.materialization_refs,
            self.receipt_refs,
            self.terminal_outcome_refs,
            self.terminal_refs,
        )
        if any(
            len(refs) != len(self.selection.selected_case_ids)
            for refs in refs_by_layer
        ):
            raise ValueError("case audit evidence refs do not match selection")
        for refs in refs_by_layer:
            if any(not _SHA256.fullmatch(item) for item in refs):
                raise ValueError("case audit evidence hash is invalid")
        return self

    @property
    def audit_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class EmpiricalCaseDiagnostic(_Model):
    """A fail-closed record explaining why no empirical case was admitted."""

    schema_version: Literal["ecos.knowledge_case_diagnostic.v1"] = (
        "ecos.knowledge_case_diagnostic.v1"
    )
    intervention_id: str
    reason_code: str
    proposal_sha256: str | None = None
    receipt_sha256: str | None = None
    terminal_outcome_sha256: str | None = None
    terminal_observation_sha256: str | None = None

    @field_validator("intervention_id", "reason_code")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("empirical case diagnostic identifier is invalid")
        return value

    @field_validator(
        "proposal_sha256",
        "receipt_sha256",
        "terminal_outcome_sha256",
        "terminal_observation_sha256",
    )
    @classmethod
    def valid_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("empirical case diagnostic hash is invalid")
        return value


CaseAuditPayload = Annotated[
    TerminalEmpiricalCase | EmpiricalCaseAudit | EmpiricalCaseDiagnostic,
    Field(discriminator="schema_version"),
]


class EmpiricalCaseAuditEntry(_Model):
    schema_version: Literal["ecos.knowledge_case_audit_entry.v1"] = (
        "ecos.knowledge_case_audit_entry.v1"
    )
    sequence: StrictInt = Field(ge=1)
    previous_entry_sha256: str | None = None
    payload: CaseAuditPayload
    entry_sha256: str

    @field_validator("previous_entry_sha256", "entry_sha256")
    @classmethod
    def valid_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("case audit entry hash is invalid")
        return value

    @model_validator(mode="after")
    def verify_hash(self) -> "EmpiricalCaseAuditEntry":
        if self.entry_sha256 != _entry_sha256(
            self.sequence, self.previous_entry_sha256, self.payload
        ):
            raise ValueError("case audit entry hash does not match content")
        return self


@dataclass(frozen=True)
class EmpiricalCaseAuditReplay:
    entries: tuple[EmpiricalCaseAuditEntry, ...]
    cases: tuple[TerminalEmpiricalCase, ...]
    selections: tuple[EmpiricalCaseAudit, ...]
    diagnostics: tuple[EmpiricalCaseDiagnostic, ...]
    chain_head_sha256: str | None

    @property
    def event_count(self) -> int:
        return len(self.entries)


def build_terminal_empirical_case(
    *,
    case_id: str,
    proposal: OptimizationProposalV2,
    effective_domain: EffectiveDomainSnapshot,
    receipt: ParameterApplicationReceipt,
    terminal_outcome: OptimizationTerminalOutcome,
    terminal: TerminalObservation,
    outcome_class: EmpiricalOutcome,
    guardrail_status: Literal["pass", "fail", "unknown"],
    context_fingerprint: str | None = None,
    claim_id: str | None = None,
    binding_id: str | None = None,
    toolchain_ref: str | None = None,
    terminal_outcome_sha256: str | None = None,
    design_id: str | None = None,
    split: Literal["train", "dev", "test", "held_out"] | None = None,
) -> TerminalEmpiricalCase:
    """Build a case only after the complete proposal-to-terminal chain matches."""
    action = proposal.action
    if proposal.decision != "propose" or action is None:
        raise ValueError("empirical case requires a propose action")
    if not all(
        (
            action.claim_id,
            action.claim_sha256,
            action.binding_id,
            action.binding_sha256,
        )
    ):
        raise ValueError("empirical case proposal requires claim and binding evidence")
    if action.effective_domain_sha256 != effective_domain.snapshot_sha256:
        raise ValueError("proposal effective domain does not match")
    if action.knob_id != effective_domain.knob_id:
        raise ValueError("proposal knob does not match effective domain")
    if action.requested_value not in effective_domain.allowed_requested_values:
        raise ValueError("proposal value is outside the effective domain")
    if receipt.context.get("context_sha256") != effective_domain.context_sha256:
        raise ValueError("native receipt context does not match effective domain")
    if (
        receipt.requested.get("knob_id") != action.knob_id.value
        or receipt.requested.get("value") != action.requested_value
    ):
        raise ValueError("native receipt request does not match proposal")
    parameter_card_sha256 = receipt.context.get("parameter_card_sha256")
    if not isinstance(parameter_card_sha256, str) or not _SHA256.fullmatch(
        parameter_card_sha256
    ):
        raise ValueError("native receipt parameter card binding is missing")
    if terminal_outcome.parameter_application_receipt != receipt:
        raise ValueError("terminal native receipt does not match")
    terminal_hash = canonical_sha256(terminal.model_dump(mode="json"))
    if (
        terminal_outcome.receipt_sha256 != receipt.evidence_sha256
        or terminal_outcome.parameter_card_sha256 != parameter_card_sha256
        or terminal_outcome.materialization_receipt_sha256
        != receipt.materialization.receipt_sha256
        or terminal_outcome.terminal_observation != terminal
        or terminal_outcome.terminal_observation_sha256 != terminal_hash
    ):
        raise ValueError("terminal outcome evidence chain does not match")
    if outcome_class == EmpiricalOutcome.SUPPORTED and not native_receipt_is_effective(receipt):
        raise ValueError("supported empirical case requires an effective native receipt")
    if outcome_class == EmpiricalOutcome.SUPPORTED and (
        not terminal.eligible_for_incumbent
    ):
        raise ValueError("supported empirical case requires an eligible terminal observation")
    requested = receipt.requested.get("value")
    if requested is None:
        raise ValueError("native receipt requested value is missing")
    derived = {
        "context_fingerprint": effective_domain.context_sha256,
        "claim_id": action.claim_id,
        "binding_id": action.binding_id,
        "toolchain_ref": receipt.tool.source_sha256,
    }
    supplied = {
        "context_fingerprint": context_fingerprint,
        "claim_id": claim_id,
        "binding_id": binding_id,
        "toolchain_ref": toolchain_ref,
    }
    if any(supplied[key] not in {None, value} for key, value in derived.items()):
        raise ValueError("empirical case metadata does not match evidence")
    outcome_hash = canonical_sha256(terminal_outcome.model_dump(mode="json"))
    if terminal_outcome_sha256 not in {None, outcome_hash}:
        raise ValueError("terminal outcome hash does not match content")
    return TerminalEmpiricalCase(
        case_id=case_id,
        **derived,
        requested_value=requested,
        effective_initial=receipt.effective_initial.value,
        activation_status=receipt.activation.status,
        proposal_sha256=canonical_sha256(proposal.model_dump(mode="json")),
        effective_domain_sha256=effective_domain.snapshot_sha256,
        parameter_card_sha256=parameter_card_sha256,
        materialization_receipt_sha256=receipt.materialization.receipt_sha256,
        receipt_sha256=receipt.evidence_sha256,
        terminal_outcome_sha256=outcome_hash,
        terminal_observation_sha256=terminal_hash,
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
    eligible_toolchain_refs: tuple[str, ...] | frozenset[str] | None = None,
    eligible_binding_ids: tuple[str, ...] | frozenset[str] | None = None,
    held_out_design: str | None = None,
) -> tuple[EmpiricalCaseSelection, tuple[TerminalEmpiricalCase, ...]]:
    """Select at most one case per outcome stratum with a stable case-id tie-break."""
    ordered = tuple(sorted(cases, key=lambda item: item.case_id))
    if len({item.case_id for item in ordered}) != len(ordered):
        raise ValueError("empirical case ids must be unique")
    _validate_eligible_filters(eligible_binding_ids, eligible_toolchain_refs)
    input_hash = canonical_sha256([item.model_dump(mode="json") for item in ordered])
    if shot_count == 0:
        return _selection(shot_count, input_hash, ()), ()
    eligible = [
        item
        for item in ordered
        if _eligible(
            item,
            context_fingerprint,
            toolchain_ref,
            binding_id,
            eligible_toolchain_refs,
            eligible_binding_ids,
            held_out_design,
        )
    ]
    strata = (
        (EmpiricalOutcome.SUPPORTED,),
        (EmpiricalOutcome.INEFFECTIVE, EmpiricalOutcome.CONTRADICTED),
        (EmpiricalOutcome.GUARDRAIL_FAILURE, EmpiricalOutcome.FAILURE),
    )
    selected = tuple(
        next((item for item in eligible if item.outcome_class in group), None)
        for group in strata
    )
    selected = tuple(item for item in selected if item is not None)
    selection = _selection(shot_count, input_hash, tuple(item.case_id for item in selected))
    return selection, selected


def replay_empirical_case_selection(
    audit: EmpiricalCaseAudit,
    cases: tuple[TerminalEmpiricalCase, ...] | list[TerminalEmpiricalCase],
    **filters: object,
) -> tuple[TerminalEmpiricalCase, ...]:
    """Recompute a selection and reject any changed input or output."""
    selected, items = select_empirical_cases(
        cases, shot_count=audit.selection.shot_count, **filters
    )
    if (
        selected != audit.selection
        or tuple(item.case_sha256 for item in items) != audit.selected_case_sha256
        or _audit_refs(items) != _stored_audit_refs(audit)
    ):
        raise ValueError("empirical case selection replay does not match audit")
    return items


def build_empirical_case_audit(
    selection: EmpiricalCaseSelection,
    selected_cases: tuple[TerminalEmpiricalCase, ...] | list[TerminalEmpiricalCase],
    *,
    proposal_refs: tuple[str, ...] | None = None,
    receipt_refs: tuple[str, ...] | None = None,
    terminal_refs: tuple[str, ...] | None = None,
) -> EmpiricalCaseAudit:
    cases = tuple(selected_cases)
    if tuple(item.case_id for item in cases) != selection.selected_case_ids:
        raise ValueError("selected cases do not match selection")
    if any(not _case_is_selectable(item) for item in cases):
        raise ValueError("selected case evidence is stale or incomplete")
    derived = _audit_refs(cases)
    supplied = (proposal_refs, receipt_refs, terminal_refs)
    for actual, expected in zip(supplied, (derived[0], derived[4], derived[6])):
        if actual is not None and actual != expected:
            raise ValueError("case audit evidence refs do not match selected cases")
    return EmpiricalCaseAudit(
        selection=selection,
        selected_case_sha256=tuple(item.case_sha256 for item in cases),
        proposal_refs=derived[0],
        effective_domain_refs=derived[1],
        parameter_card_refs=derived[2],
        materialization_refs=derived[3],
        receipt_refs=derived[4],
        terminal_outcome_refs=derived[5],
        terminal_refs=derived[6],
    )


def _eligible(
    case: TerminalEmpiricalCase,
    context_fingerprint: str | None,
    toolchain_ref: str | None,
    binding_id: str | None,
    eligible_toolchain_refs: tuple[str, ...] | frozenset[str] | None,
    eligible_binding_ids: tuple[str, ...] | frozenset[str] | None,
    held_out_design: str | None,
) -> bool:
    return (
        _case_is_selectable(case)
        and (context_fingerprint is None or case.context_fingerprint == context_fingerprint)
        and (toolchain_ref is None or case.toolchain_ref == toolchain_ref)
        and (binding_id is None or case.binding_id == binding_id)
        and (
            eligible_toolchain_refs is None
            or case.toolchain_ref in eligible_toolchain_refs
        )
        and (
            eligible_binding_ids is None or case.binding_id in eligible_binding_ids
        )
        and (
            held_out_design is None
            or (case.design_id is not None and case.design_id != held_out_design)
        )
    )


def _selection(
    shot_count: Literal[0, 3], input_hash: str, ids: tuple[str, ...]
) -> EmpiricalCaseSelection:
    payload = {
        "schema_version": "ecos.knowledge_case_selection.v1",
        "selector_version": "ecos.knowledge_case_selector.v1",
        "shot_count": shot_count,
        "input_cases_sha256": input_hash,
        "selected_case_ids": ids,
    }
    return EmpiricalCaseSelection(**payload, selection_sha256=canonical_sha256(payload))


def _case_chain_complete(case: TerminalEmpiricalCase) -> bool:
    return all(
        isinstance(getattr(case, field, None), str)
        and _SHA256.fullmatch(getattr(case, field))
        for field in _CASE_EVIDENCE_HASH_FIELDS
    )


def _case_is_selectable(case: TerminalEmpiricalCase) -> bool:
    return (
        _case_chain_complete(case)
        and case.evidence_status == "current"
        and case.activation_status == "used"
        and case.split != "held_out"
    )


def _validate_eligible_filters(
    binding_ids: tuple[str, ...] | frozenset[str] | None,
    toolchain_refs: tuple[str, ...] | frozenset[str] | None,
) -> None:
    if binding_ids is not None and any(not _ID.fullmatch(item) for item in binding_ids):
        raise ValueError("eligible empirical binding id is invalid")
    if toolchain_refs is not None and any(
        not _SHA256.fullmatch(item) for item in toolchain_refs
    ):
        raise ValueError("eligible empirical toolchain ref is invalid")


def _audit_refs(
    cases: tuple[TerminalEmpiricalCase, ...],
) -> tuple[tuple[str, ...], ...]:
    return tuple(
        tuple(getattr(case, field) for case in cases)
        for field in _CASE_EVIDENCE_HASH_FIELDS
    )


def _stored_audit_refs(audit: EmpiricalCaseAudit) -> tuple[tuple[str, ...], ...]:
    return (
        audit.proposal_refs,
        audit.effective_domain_refs,
        audit.parameter_card_refs,
        audit.materialization_refs,
        audit.receipt_refs,
        audit.terminal_outcome_refs,
        audit.terminal_refs,
    )


class EmpiricalCaseAuditStore:
    """Append-only JSONL storage for cases and their deterministic selections."""

    def __init__(self, root: Path, *, read_only: bool = False) -> None:
        path = Path(root).expanduser()
        if read_only and (path.is_symlink() or not path.is_dir()):
            raise EmpiricalCaseAuditError("read-only empirical case pool is unavailable")
        self.root = path.resolve()
        self._read_only = read_only
        if not read_only:
            self.root.mkdir(parents=True, exist_ok=True)
        self.audit_path = self.root / "optimization-knowledge-cases.v1.jsonl"
        self._lock_path = self.root / ".optimization-knowledge-cases.lock"

    def append_case(self, case: TerminalEmpiricalCase) -> EmpiricalCaseAuditEntry:
        self._require_writable()
        with self._exclusive_lock():
            replay = self._verify_locked()
            if not _case_chain_complete(case):
                raise EmpiricalCaseAuditIntegrityError(
                    "empirical case evidence chain is incomplete"
                )
            if any(item.case_id == case.case_id for item in replay.cases):
                raise EmpiricalCaseAuditIntegrityError("empirical case already exists")
            return self._append_locked(replay, case)

    def append_selection(self, audit: EmpiricalCaseAudit) -> EmpiricalCaseAuditEntry:
        self._require_writable()
        with self._exclusive_lock():
            replay = self._verify_locked()
            _verify_selection_audit(audit, replay.cases)
            return self._append_locked(replay, audit)

    def append_diagnostic(
        self, diagnostic: EmpiricalCaseDiagnostic
    ) -> EmpiricalCaseAuditEntry:
        self._require_writable()
        with self._exclusive_lock():
            return self._append_locked(self._verify_locked(), diagnostic)

    def verify(self) -> EmpiricalCaseAuditReplay:
        if self._read_only:
            return self._verify_locked()
        with self._exclusive_lock():
            return self._verify_locked()

    replay = verify

    def _require_writable(self) -> None:
        if self._read_only:
            raise EmpiricalCaseAuditError("empirical case pool is read-only")

    def _append_locked(
        self,
        replay: EmpiricalCaseAuditReplay,
        payload: CaseAuditPayload,
    ) -> EmpiricalCaseAuditEntry:
        sequence = replay.event_count + 1
        entry = EmpiricalCaseAuditEntry(
            sequence=sequence,
            previous_entry_sha256=replay.chain_head_sha256,
            payload=payload,
            entry_sha256=_entry_sha256(
                sequence, replay.chain_head_sha256, payload
            ),
        )
        encoded = _canonical_json(entry.model_dump(mode="json")) + b"\n"
        with self.audit_path.open("ab") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        _fsync_directory(self.root)
        return entry

    def _verify_locked(self) -> EmpiricalCaseAuditReplay:
        if not self.audit_path.exists():
            return EmpiricalCaseAuditReplay((), (), (), (), None)
        content = self.audit_path.read_bytes()
        if content and not content.endswith(b"\n"):
            raise EmpiricalCaseAuditRecoveryRequired(
                "empirical case audit has a torn final record"
            )
        try:
            entries = tuple(
                EmpiricalCaseAuditEntry.model_validate_json(line)
                for line in content.splitlines()
                if line
            )
        except ValidationError as exc:
            raise EmpiricalCaseAuditIntegrityError(
                "empirical case audit record is invalid"
            ) from exc
        return _replay_audit_entries(entries)

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        with self._lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _replay_audit_entries(
    entries: tuple[EmpiricalCaseAuditEntry, ...],
) -> EmpiricalCaseAuditReplay:
    previous = None
    cases: list[TerminalEmpiricalCase] = []
    selections: list[EmpiricalCaseAudit] = []
    diagnostics: list[EmpiricalCaseDiagnostic] = []
    for expected, entry in enumerate(entries, start=1):
        if entry.sequence != expected or entry.previous_entry_sha256 != previous:
            raise EmpiricalCaseAuditIntegrityError(
                "empirical case audit hash chain is broken"
            )
        if isinstance(entry.payload, TerminalEmpiricalCase):
            if any(item.case_id == entry.payload.case_id for item in cases):
                raise EmpiricalCaseAuditIntegrityError(
                    "empirical case audit contains a duplicate case"
                )
            cases.append(entry.payload)
        elif isinstance(entry.payload, EmpiricalCaseAudit):
            _verify_selection_audit(entry.payload, tuple(cases))
            selections.append(entry.payload)
        else:
            diagnostics.append(entry.payload)
        previous = entry.entry_sha256
    return EmpiricalCaseAuditReplay(
        entries, tuple(cases), tuple(selections), tuple(diagnostics), previous
    )


def _verify_selection_audit(
    audit: EmpiricalCaseAudit,
    cases: tuple[TerminalEmpiricalCase, ...],
) -> None:
    if audit.selection.input_cases_sha256 != canonical_sha256(
        [item.model_dump(mode="json") for item in sorted(cases, key=lambda item: item.case_id)]
    ):
        raise EmpiricalCaseAuditIntegrityError(
            "case selection input does not match persisted cases"
        )
    indexed = {case.case_id: case for case in cases}
    try:
        selected = tuple(indexed[case_id] for case_id in audit.selection.selected_case_ids)
    except KeyError as exc:
        raise EmpiricalCaseAuditIntegrityError(
            "case selection references an unavailable case"
        ) from exc
    if (
        tuple(case.case_sha256 for case in selected) != audit.selected_case_sha256
        or _audit_refs(selected) != _stored_audit_refs(audit)
        or any(not _case_is_selectable(case) for case in selected)
    ):
        raise EmpiricalCaseAuditIntegrityError(
            "case selection evidence does not match persisted cases"
        )


def _entry_sha256(
    sequence: int,
    previous_entry_sha256: str | None,
    payload: CaseAuditPayload,
) -> str:
    return canonical_sha256(
        {
            "sequence": sequence,
            "previous_entry_sha256": previous_entry_sha256,
            "payload": payload.model_dump(mode="json"),
        }
    )


def _canonical_json(payload: object) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("ascii")


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
