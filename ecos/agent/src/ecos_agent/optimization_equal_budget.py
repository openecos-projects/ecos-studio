"""Replayable equal-budget accounting for requested-only and receipt-aware runs."""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Literal


Mode = Literal["requested-only", "receipt-aware"]


@dataclass(frozen=True)
class EqualBudgetConfig:
    candidate_limit: int = 20
    planning_call_limit: int = 60
    reference_runtime_seconds: float = 1.0
    runtime_multiplier: float = 22.0

    def __post_init__(self) -> None:
        if self.candidate_limit != 20 or self.planning_call_limit != 60 or self.runtime_multiplier != 22.0:
            raise ValueError("Phase 8 budget is fixed at 20 candidates, 60 planning calls, and 22*T_d")
        if not math.isfinite(self.reference_runtime_seconds) or self.reference_runtime_seconds <= 0:
            raise ValueError("reference runtime must be positive and finite")

    @property
    def wall_time_limit_seconds(self) -> float:
        return self.reference_runtime_seconds * self.runtime_multiplier


@dataclass(frozen=True)
class CandidateTrace:
    design_id: str
    candidate_id: str
    started: bool
    terminal_success: bool
    terminal_utility: float | None = None
    reference_utility: float | None = None
    ppa: float | None = None
    drc: float | None = None
    timing: float | None = None
    congestion: float | None = None
    requested_value: str | float | int | bool | None = None
    application_status: str | None = None
    activation_status: str | None = None
    application_signature: str | None = None
    response_signature: str | None = None
    transition_status: str | None = None
    alias: bool = False
    alias_valid: bool = True
    stale_rule: bool = False
    fail_closed: bool = False
    proposal_outcome: str | None = None
    receipt_status: str | None = None
    runtime_seconds: float = 0.0
    peak_memory_mb: float = 0.0


@dataclass(frozen=True)
class EqualBudgetSummary:
    mode: Mode
    candidate_limit: int
    planning_call_limit: int
    wall_time_limit_seconds: float
    started_candidates: int
    terminal_successes: int
    terminal_utility: tuple[float, ...]
    simple_regret: float | None
    ppa: tuple[float, ...]
    drc: tuple[float, ...]
    timing: tuple[float, ...]
    congestion: tuple[float, ...]
    overridden: int
    overridden_rate: float
    ignored: int
    ignored_rate: float
    not_activated: int
    not_activated_rate: float
    unknown: int
    effective_unique_rate: float
    application_signature_count: int
    response_signature_count: int
    aliases_saved: int
    wrong_prunes: int
    stale_rule: int
    fail_closed: int
    proposal_reject: int
    proposal_repair: int
    proposal_fallback: int
    receipt_missing: int
    parser_failure: int
    producer_failure: int
    context_mismatch: int
    runtime_seconds: float
    peak_memory_mb: float

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate_equal_budget(
    traces: Iterable[CandidateTrace],
    *,
    mode: Mode,
    config: EqualBudgetConfig | None = None,
    planning_calls: int = 0,
) -> EqualBudgetSummary:
    """Summarize a deterministic candidate trace under one frozen budget."""
    if mode not in ("requested-only", "receipt-aware"):
        raise ValueError("mode must be requested-only or receipt-aware")
    config = config or EqualBudgetConfig()
    if config.candidate_limit <= 0 or config.planning_call_limit <= 0:
        raise ValueError("budget limits must be positive")
    if planning_calls < 0 or planning_calls > config.planning_call_limit:
        raise ValueError("planning calls exceed the frozen budget")
    selected = list(traces)
    if len(selected) > config.candidate_limit:
        raise ValueError("candidate traces exceed the frozen budget")
    for item in selected:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,127}", item.design_id) or not item.candidate_id:
            raise ValueError("candidate trace identifiers are invalid")
        if not math.isfinite(item.runtime_seconds) or item.runtime_seconds < 0:
            raise ValueError("candidate runtime must be non-negative and finite")
        if not math.isfinite(item.peak_memory_mb) or item.peak_memory_mb < 0:
            raise ValueError("candidate memory must be non-negative and finite")
        metrics = (
            item.terminal_utility,
            item.reference_utility,
            item.ppa,
            item.drc,
            item.timing,
            item.congestion,
        )
        for metric in metrics:
            if metric is not None and not math.isfinite(metric):
                raise ValueError("candidate metrics must be finite")
    started = [item for item in selected if item.started]
    app_signatures = {item.application_signature for item in started if item.application_signature}
    response_signatures = {item.response_signature for item in started if item.response_signature}
    effective = [item for item in started if item.activation_status == "used"]
    aliases_saved = sum(item.alias and item.alias_valid for item in selected)
    wrong_prunes = sum(item.alias and not item.alias_valid for item in selected)
    receipt_missing = sum(item.receipt_status == "missing" for item in selected)
    parser_failure = sum(item.receipt_status == "parser_failure" for item in selected)
    producer_failure = sum(item.receipt_status == "producer_failure" for item in selected)
    context_mismatch = sum(item.receipt_status == "context_mismatch" for item in selected)
    utilities = tuple(
        item.terminal_utility for item in started if item.terminal_success and item.terminal_utility is not None
    )
    references = [item.reference_utility for item in selected if item.reference_utility is not None]
    simple_regret = (
        max(0.0, max(references) - max(utilities))
        if references and utilities
        else None
    )
    return EqualBudgetSummary(
        mode=mode,
        candidate_limit=config.candidate_limit,
        planning_call_limit=config.planning_call_limit,
        wall_time_limit_seconds=config.wall_time_limit_seconds,
        started_candidates=len(started),
        terminal_successes=sum(item.terminal_success for item in started),
        terminal_utility=utilities,
        simple_regret=simple_regret,
        ppa=tuple(item.ppa for item in started if item.ppa is not None),
        drc=tuple(item.drc for item in started if item.drc is not None),
        timing=tuple(item.timing for item in started if item.timing is not None),
        congestion=tuple(item.congestion for item in started if item.congestion is not None),
        overridden=sum(item.transition_status == "overridden" for item in started),
        overridden_rate=(
            sum(item.transition_status == "overridden" for item in started) / len(started)
            if started
            else 0.0
        ),
        ignored=sum(
            item.application_status == "ignored" or item.activation_status == "ignored"
            for item in started
        ),
        ignored_rate=(
            sum(
                item.application_status == "ignored" or item.activation_status == "ignored"
                for item in started
            )
            / len(started)
            if started
            else 0.0
        ),
        not_activated=sum(item.activation_status == "not_activated" for item in started),
        not_activated_rate=(
            sum(item.activation_status == "not_activated" for item in started) / len(started)
            if started
            else 0.0
        ),
        unknown=sum(item.activation_status in (None, "unknown") for item in started),
        effective_unique_rate=(
            len(
                {
                    (item.application_signature, item.response_signature)
                    for item in effective
                    if item.application_signature or item.response_signature
                }
            )
            / len(started)
            if started
            else 0.0
        ),
        application_signature_count=len(app_signatures),
        response_signature_count=len(response_signatures),
        aliases_saved=aliases_saved if mode == "receipt-aware" else 0,
        wrong_prunes=wrong_prunes if mode == "receipt-aware" else 0,
        stale_rule=sum(item.stale_rule for item in selected),
        fail_closed=sum(item.fail_closed for item in selected),
        proposal_reject=sum(item.proposal_outcome == "reject" for item in selected),
        proposal_repair=sum(item.proposal_outcome == "repair" for item in selected),
        proposal_fallback=sum(item.proposal_outcome == "fallback" for item in selected),
        receipt_missing=receipt_missing,
        parser_failure=parser_failure,
        producer_failure=producer_failure,
        context_mismatch=context_mismatch,
        runtime_seconds=sum(item.runtime_seconds for item in selected),
        peak_memory_mb=max((item.peak_memory_mb for item in selected), default=0.0),
    )


def write_equal_budget_report(path: Path, summaries: Iterable[EqualBudgetSummary]) -> None:
    payload = {
        "schema_version": "ecos.optimization_equal_budget_report.v1",
        "summaries": [summary.to_dict() for summary in summaries],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def validate_design_manifest(design_ids: Iterable[str], *, expected_count: int = 10) -> tuple[str, ...]:
    """Require an explicit, unique frozen design set before a Phase 8 run."""
    values = tuple(design_ids)
    if len(values) != expected_count or len(set(values)) != expected_count or any(not value for value in values):
        raise ValueError(f"design manifest must contain exactly {expected_count} unique ids")
    return values
