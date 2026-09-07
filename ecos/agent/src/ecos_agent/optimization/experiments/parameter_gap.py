"""Summarize the requested and actual values of the seven controlled knobs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable, Literal

from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt


@dataclass(frozen=True)
class ProbeResult:
    candidate_id: str
    requested_value: bool | int | float
    terminal_closed: bool
    runtime_seconds: float
    receipt_status: Literal["ok", "missing"]
    actual_value: bool | int | float | None
    status: Literal["effective", "inactive", "unknown"]
    reason: str | None = None
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
    ) -> "ProbeResult":
        return cls(
            candidate_id=candidate_id,
            requested_value=requested_value,
            terminal_closed=terminal_closed,
            runtime_seconds=runtime_seconds,
            receipt_status="ok" if receipt else "missing",
            actual_value=receipt.actual_value if receipt else None,
            status=receipt.status if receipt else "unknown",
            reason=receipt.reason if receipt else "Parameter receipt is missing.",
            error=error,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class KnobStatusSummary:
    knob_id: str
    lattice_complete: bool
    tested_requests: tuple[bool | int | float, ...]
    candidate_count: int
    terminal_closed_count: int
    status_counts: dict[str, int]
    failed_candidates: tuple[str, ...]
    ineligible_candidates: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def summarize_knob(
    knob: OptimizationKnob,
    results: Iterable[ProbeResult],
    *,
    lattice_complete: bool = False,
) -> KnobStatusSummary:
    selected = tuple(results)
    return KnobStatusSummary(
        knob_id=knob.value,
        lattice_complete=lattice_complete,
        tested_requests=tuple(dict.fromkeys(item.requested_value for item in selected)),
        candidate_count=len(selected),
        terminal_closed_count=sum(item.terminal_closed for item in selected),
        status_counts={
            status: sum(item.status == status for item in selected)
            for status in ("effective", "inactive", "unknown")
        },
        failed_candidates=tuple(
            item.candidate_id for item in selected
            if item.error is not None or item.receipt_status == "missing"
        ),
        ineligible_candidates=tuple(
            item.candidate_id for item in selected if not item.terminal_closed
        ),
    )
