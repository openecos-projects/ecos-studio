"""Classify requested, tool-adopted, and activated parameter gaps."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Literal

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.parameters.semantics import load_parameter_cards

GapVerdict = Literal[
    "gap_confirmed",
    "gap_unconfirmed",
    "no_gap_observed",
    "screening_incomplete",
    "indeterminate",
]

_GAP_KINDS = frozenset(
    {
        "materialization_gap",
        "application_gap",
        "adoption_gap",
        "activation_gap",
        "runtime_adjustment",
    }
)
_VOLATILE_KEYS = frozenset(
    {
        "candidate_id",
        "context_sha256",
        "evidence_ref",
        "evidence_sha256",
        "receipt_id",
    }
)


@dataclass(frozen=True)
class ProbeResult:
    candidate_id: str
    requested_value: bool | int | float
    terminal_closed: bool
    runtime_seconds: float
    receipt_status: Literal["ok", "missing"]
    application_status: str | None
    activation_status: str | None
    effective_initial: bool | int | float | None
    effective_final: bool | int | float | None
    gap_kinds: tuple[str, ...]
    application_semantic_sha256: str | None
    response_semantic_sha256: str | None
    typed_rule_ids: tuple[str, ...]
    error: str | None = None

    @classmethod
    def from_receipt(
        cls,
        *,
        candidate_id: str,
        requested_value: bool | int | float,
        receipt: ParameterApplicationReceipt | None,
        terminal_closed: bool,
        runtime_seconds: float,
        error: str | None,
        site_width_dbu: int,
    ) -> "ProbeResult":
        if receipt is None:
            return cls(
                candidate_id,
                requested_value,
                terminal_closed,
                runtime_seconds,
                "missing",
                None,
                None,
                None,
                None,
                (),
                None,
                None,
                (),
                error,
            )
        return cls(
            candidate_id=candidate_id,
            requested_value=requested_value,
            terminal_closed=terminal_closed,
            runtime_seconds=runtime_seconds,
            receipt_status="ok",
            application_status=receipt.application_status,
            activation_status=receipt.activation.status,
            effective_initial=receipt.effective_initial.value,
            effective_final=receipt.effective_final.value,
            gap_kinds=classify_receipt(receipt, site_width_dbu=site_width_dbu),
            application_semantic_sha256=semantic_application_signature(receipt),
            response_semantic_sha256=semantic_response_signature(receipt),
            typed_rule_ids=tuple(
                sorted({item.rule_id for item in receipt.transitions if item.rule_id})
            ),
            error=error,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class KnobGapSummary:
    knob_id: str
    verdict: GapVerdict
    lattice_complete: bool
    tested_requests: tuple[bool | int | float, ...]
    candidate_count: int
    terminal_closed_count: int
    confirmed_gap_kinds: tuple[str, ...]
    gap_kind_counts: dict[str, int]
    typed_alias_groups: tuple[tuple[bool | int | float, ...], ...]
    observed_equivalence_groups: tuple[tuple[bool | int | float, ...], ...]
    failed_candidates: tuple[str, ...]
    ineligible_candidates: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_receipt(
    receipt: ParameterApplicationReceipt, *, site_width_dbu: int
) -> tuple[str, ...]:
    knob = OptimizationKnob(receipt.requested["knob_id"])
    card = load_parameter_cards()[knob]
    requested = receipt.requested["value"]
    written = receipt.materialization.written_value
    expected_written = (
        requested * site_width_dbu
        if card.write_mapping.get("kind") == "site_to_dbu"
        else requested
    )
    mapping_only = written != requested and written == expected_written
    gaps: list[str] = []
    if written != expected_written:
        gaps.append("materialization_gap")
    if receipt.application_status != "applied":
        gaps.append("application_gap")
    if written != receipt.effective_initial.value or any(
        item.to in {"normalized", "clamped", "overridden"}
        for item in receipt.transitions
    ):
        gaps.append("adoption_gap")
    valid_false_arm = (
        knob == OptimizationKnob.ROUTABILITY_OPT
        and requested is False
        and receipt.application_status == "applied"
        and receipt.activation.status == "not_activated"
    )
    if receipt.activation.status != "used" and not valid_false_arm:
        gaps.append("activation_gap")
    if receipt.effective_initial.value != receipt.effective_final.value or any(
        item.to in {"adjusted", "superseded", "restored"}
        for item in receipt.transitions
    ):
        gaps.append("runtime_adjustment")
    if not gaps and mapping_only:
        return ("mapping_only",)
    return tuple(gaps)


def semantic_application_signature(receipt: ParameterApplicationReceipt) -> str:
    return canonical_sha256(
        {
            "knob_id": receipt.requested["knob_id"],
            "application_status": receipt.application_status,
            "effective_initial": receipt.effective_initial.model_dump(mode="json"),
        }
    )


def semantic_response_signature(receipt: ParameterApplicationReceipt) -> str:
    payload = {
        "application": semantic_application_signature(receipt),
        "transitions": [
            {
                "to": item.to,
                "value": item.value,
                "reason": item.reason,
                "rule_id": item.rule_id,
                "iteration": item.iteration,
            }
            for item in receipt.transitions
        ],
        "activation": {
            "status": receipt.activation.status,
            "consumers": [
                {"consumer_id": item.consumer_id, "outcome": item.outcome}
                for item in receipt.activation.consumers
            ],
        },
        "consumer_observation": _strip_volatile(receipt.consumer_observation),
        "effective_final": receipt.effective_final.model_dump(mode="json"),
    }
    return canonical_sha256(payload)


def summarize_knob(
    knob: OptimizationKnob,
    results: Iterable[ProbeResult],
    *,
    lattice_complete: bool = False,
) -> KnobGapSummary:
    selected = tuple(results)
    closed = tuple(item for item in selected if item.terminal_closed)
    gap_counts = Counter(
        kind for item in closed for kind in item.gap_kinds if kind in _GAP_KINDS
    )
    confirmed = _confirmed_gap_kinds(closed)
    failures = tuple(
        item.candidate_id
        for item in selected
        if item.error is not None or item.receipt_status == "missing"
    )
    ineligible = tuple(
        item.candidate_id for item in selected if not item.terminal_closed
    )
    any_gap = bool(gap_counts)
    if confirmed:
        verdict: GapVerdict = "gap_confirmed"
    elif failures or ineligible:
        verdict = "indeterminate"
    elif lattice_complete and not any_gap:
        verdict = "no_gap_observed"
    elif any_gap:
        verdict = "gap_unconfirmed"
    else:
        verdict = "screening_incomplete"
    return KnobGapSummary(
        knob_id=knob.value,
        verdict=verdict,
        lattice_complete=lattice_complete,
        tested_requests=tuple(dict.fromkeys(item.requested_value for item in selected)),
        candidate_count=len(selected),
        terminal_closed_count=len(closed),
        confirmed_gap_kinds=confirmed,
        gap_kind_counts=dict(sorted(gap_counts.items())),
        typed_alias_groups=_equivalence_groups(closed, knob=knob, typed=True),
        observed_equivalence_groups=_equivalence_groups(
            closed, knob=knob, typed=False
        ),
        failed_candidates=failures,
        ineligible_candidates=ineligible,
    )


def _confirmed_gap_kinds(results: tuple[ProbeResult, ...]) -> tuple[str, ...]:
    by_request: dict[bool | int | float, list[ProbeResult]] = defaultdict(list)
    for item in results:
        by_request[item.requested_value].append(item)
    confirmed = {
        kind
        for repeats in by_request.values()
        if len(repeats) >= 3
        for kind in _GAP_KINDS
        if sum(kind in item.gap_kinds for item in repeats[:3]) >= 2
    }
    return tuple(sorted(confirmed))


def _equivalence_groups(
    results: tuple[ProbeResult, ...], *, knob: OptimizationKnob, typed: bool
) -> tuple[tuple[bool | int | float, ...], ...]:
    allowed_rules = {
        rule.get("rule_id")
        for rule in load_parameter_cards()[knob].resolution_rules
    }
    groups: dict[str, set[bool | int | float]] = defaultdict(set)
    for item in results:
        signature = (
            item.application_semantic_sha256
            if typed
            else item.response_semantic_sha256
        )
        if signature is None:
            continue
        if typed:
            if not set(item.typed_rule_ids) & allowed_rules:
                continue
        groups[signature].add(item.requested_value)
    return tuple(
        sorted(
            (tuple(sorted(values, key=str)) for values in groups.values() if len(values) > 1),
            key=str,
        )
    )


def _strip_volatile(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_volatile(item)
            for key, item in sorted(value.items())
            if key not in _VOLATILE_KEYS
            and not key.endswith("_ref")
            and not key.endswith("_sha256")
        }
    if isinstance(value, list):
        return [_strip_volatile(item) for item in value]
    return value
