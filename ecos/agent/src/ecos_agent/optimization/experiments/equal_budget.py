"""Replayable equal-budget accounting for requested-only and receipt-aware runs."""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Iterable, Literal

from ecos_agent.optimization.parameters.effective_domain import application_signature, response_signature
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    TerminalObservation,
    TimingMetric,
    objective_metric_utility,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt

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
    planning_mode: Mode | None = None
    # Higher-is-better frozen objective utility.
    terminal_utility: float | None = None
    reference_utility: float | None = None
    ppa: float | None = None
    area: float | None = None
    dynamic_power: float | None = None
    leakage_power: float | None = None
    frequency: float | None = None
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
    alias_valid: bool | None = None
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
    simple_regret_by_design: dict[str, float | None]
    ppa: tuple[float, ...]
    area: tuple[float, ...]
    dynamic_power: tuple[float, ...]
    leakage_power: tuple[float, ...]
    frequency: tuple[float, ...]
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
    alias_unassessed: int
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


def build_candidate_trace(
    *,
    design_id: str,
    candidate_id: str,
    planning_mode: Mode,
    outcome: OptimizationOutcomeKind,
    receipt: ParameterApplicationReceipt | None,
    terminal_observation: TerminalObservation | None,
    reference_observation: TerminalObservation,
    objective_metric: ObjectiveMetric,
    runtime_seconds: float,
    peak_memory_mb: float,
) -> CandidateTrace:
    """Project one verified terminal ledger record into the Phase 8 trace."""
    terminal_success = terminal_observation is not None and outcome in {
        OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        OptimizationOutcomeKind.IMPROVED,
        OptimizationOutcomeKind.DEGRADED,
        OptimizationOutcomeKind.TRADEOFF,
    }
    evaluation = terminal_observation.evaluation_metrics if terminal_observation else ()
    transition_status = None
    if receipt is not None and receipt.transitions:
        transition_status = (
            "overridden"
            if any(item.to == "overridden" for item in receipt.transitions)
            else receipt.transitions[-1].to
        )
    return CandidateTrace(
        design_id=design_id,
        candidate_id=candidate_id,
        started=True,
        terminal_success=terminal_success,
        planning_mode=planning_mode,
        terminal_utility=(
            objective_metric_utility(
                objective_metric,
                float(terminal_observation.objective_metrics[objective_metric]),
            )
            if terminal_success and terminal_observation is not None
            else None
        ),
        reference_utility=objective_metric_utility(
            objective_metric,
            float(reference_observation.objective_metrics[objective_metric]),
        ),
        area=_evaluation_value(evaluation, "sta_standard_cell_area"),
        dynamic_power=_evaluation_value(evaluation, "sta_typical_dynamic_power"),
        leakage_power=_evaluation_value(evaluation, "sta_typical_leakage_power"),
        frequency=_evaluation_value(evaluation, "sta_frequency"),
        drc=_evaluation_value(evaluation, "drc_count"),
        timing=(
            float(terminal_observation.timing_guardrail[TimingMetric.STA_SETUP_WNS])
            if terminal_observation is not None
            else None
        ),
        congestion=(
            float(
                terminal_observation.metrics[
                    ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
                ]
            )
            if terminal_observation is not None
            else None
        ),
        requested_value=(receipt.requested.get("value") if receipt else None),
        application_status=(receipt.application_status if receipt else None),
        activation_status=(receipt.activation.status if receipt else None),
        application_signature=(application_signature(receipt) if receipt else None),
        response_signature=(response_signature(receipt) if receipt else None),
        transition_status=transition_status,
        receipt_status="ok" if receipt else "missing",
        runtime_seconds=runtime_seconds,
        peak_memory_mb=peak_memory_mb,
    )


def _evaluation_value(metrics: Iterable[object], metric_id: str) -> float | None:
    matches = [
        item
        for item in metrics
        if getattr(item, "metric_id", None) == metric_id
    ]
    if not matches:
        return None
    preferred = next(
        (
            item
            for item in matches
            if getattr(item, "corner", None) in {None, "TYP_25/TYPICAL"}
        ),
        matches[0],
    )
    return float(getattr(preferred, "value"))


def export_episode_traces(
    *,
    workspace: Path,
    episode_root: Path,
    design_id: str,
    reference_observation: TerminalObservation,
    objective_metric: ObjectiveMetric,
) -> tuple[tuple[CandidateTrace, ...], int, Mode]:
    """Verify one persisted episode and export auditable Phase 8 traces."""
    state = _verified_episode_state(Path(episode_root))
    ledger = OptimizationLedger(episode_root).replay()
    planning = OptimizationPlanningAudit(episode_root).replay()
    provider = OptimizationPlanningProviderEvidenceAudit(episode_root).replay()
    decisions = OptimizationDecisionAudit(episode_root).replay()
    cases = EmpiricalCaseAuditStore(episode_root).replay()
    _verify_episode_heads(state, ledger, planning, provider, decisions, cases)
    if ledger.pending_intervention_ids:
        raise ValueError("episode trace contains pending interventions")
    mode: Mode = (
        "receipt-aware"
        if state.get("receipt_aware_planning", True)
        else "requested-only"
    )
    starts = tuple(
        entry.payload
        for entry in ledger.entries
        if isinstance(entry.payload, OptimizationInterventionStart)
    )
    outcomes = {item.intervention_id: item for item in ledger.terminal_outcomes}
    candidate_decisions = tuple(
        item
        for item in decisions.entries
        if item.requested is not None and item.state.value == "awaiting_execution"
    )
    if len(starts) != len(candidate_decisions) or set(outcomes) != {
        item.intervention_id for item in starts
    }:
        raise ValueError("episode lifecycle does not match planning decisions")
    traces: list[CandidateTrace] = []
    episode_id = str(state["episode_id"])
    for start, decision in zip(starts, candidate_decisions, strict=True):
        if start.requested != decision.requested:
            raise ValueError("episode request does not match planning decision")
        outcome = outcomes[start.intervention_id]
        runtime, memory = _candidate_resources(
            Path(workspace), outcome.candidate_root_ref, start.target_step
        )
        trace = build_candidate_trace(
            design_id=design_id,
            candidate_id=f"{episode_id}.{start.intervention_id}",
            planning_mode=mode,
            outcome=outcome.outcome,
            receipt=outcome.parameter_application_receipt,
            terminal_observation=outcome.terminal_observation,
            reference_observation=reference_observation,
            objective_metric=objective_metric,
            runtime_seconds=runtime,
            peak_memory_mb=memory,
        )
        traces.append(
            replace(
                trace,
                requested_value=start.requested.value,
                proposal_outcome=(
                    "repair"
                    if decision.planner_source == "repair"
                    else "fallback"
                    if decision.planner_source == "local_fallback"
                    else None
                ),
            )
        )
    traces.extend(_planning_event_traces(design_id, episode_id, mode, planning, decisions))
    return tuple(traces), len(planning.entries), mode


def _verified_episode_state(episode_root: Path) -> dict[str, object]:
    path = episode_root / "optimization-episode-state.v6.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        state_hash = payload.pop("state_sha256")
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("episode state is unavailable") from exc
    if state_hash != canonical_sha256(payload):
        raise ValueError("episode state hash does not match")
    payload["state_sha256"] = state_hash
    return payload


def _verify_episode_heads(state, ledger, planning, provider, decisions, cases) -> None:
    expected = (
        ("ledger", len(ledger.entries), ledger.chain_head_sha256),
        ("planning_audit", len(planning.entries), planning.chain_head_sha256),
        (
            "planning_provider_audit",
            len(provider.entries),
            provider.chain_head_sha256,
        ),
        ("decision_audit", len(decisions.entries), decisions.chain_head_sha256),
    )
    for prefix, count, head in expected:
        if (
            state.get(f"{prefix}_event_count") != count
            or state.get(f"{prefix}_chain_head_sha256") != head
        ):
            raise ValueError("episode state does not match its audit chains")
    if (
        state.get("case_audit_event_count", 0) != cases.event_count
        or state.get("case_audit_chain_head_sha256") != cases.chain_head_sha256
    ):
        raise ValueError("episode state does not match its empirical case audit")


def _planning_event_traces(
    design_id: str,
    episode_id: str,
    mode: Mode,
    planning,
    decisions,
) -> tuple[CandidateTrace, ...]:
    traces: list[CandidateTrace] = []
    seen_aliases: set[tuple[str, str]] = set()
    for planning_entry, decision in zip(
        planning.entries, decisions.entries, strict=True
    ):
        prior_requests = {
            (item.requested.knob_id.value, json.dumps(item.requested.value))
            for item in decisions.entries
            if item.sequence < decision.sequence and item.requested is not None
        }
        for domain in planning_entry.effective_domains:
            for value in domain.excluded_aliases:
                key = (domain.knob_id.value, json.dumps(value))
                if key in prior_requests or key in seen_aliases:
                    continue
                seen_aliases.add(key)
                traces.append(
                    CandidateTrace(
                        design_id=design_id,
                        candidate_id=f"{episode_id}.alias-{len(seen_aliases)}",
                        started=False,
                        terminal_success=False,
                        planning_mode=mode,
                        requested_value=value,
                        alias=True,
                    )
                )
        if decision.validation_result == "rejected":
            reason = decision.rejection_reason or ""
            traces.append(
                CandidateTrace(
                    design_id=design_id,
                    candidate_id=f"{episode_id}.plan-{decision.sequence}",
                    started=False,
                    terminal_success=False,
                    planning_mode=mode,
                    stale_rule="stale" in reason,
                    fail_closed=reason
                    not in {"minimum_candidates_not_met", "planner_continue"},
                    proposal_outcome="reject",
                )
            )
    return tuple(traces)


def _candidate_resources(
    workspace: Path, candidate_root_ref: str | None, target_step: str
) -> tuple[float, float]:
    if not candidate_root_ref:
        raise ValueError("candidate resource evidence is unavailable")
    workspace = workspace.resolve()
    candidate = (workspace / candidate_root_ref).resolve()
    try:
        candidate.relative_to(workspace)
        payload = json.loads(
            (candidate / "home" / "flow.json").read_text(encoding="utf-8")
        )
        steps = payload["steps"]
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("candidate resource evidence is unavailable") from exc
    if not isinstance(steps, list) or any(not isinstance(item, dict) for item in steps):
        raise ValueError("candidate resource evidence is invalid")
    start = next(
        (index for index, item in enumerate(steps) if item.get("name") == target_step),
        None,
    )
    if start is None:
        raise ValueError("candidate resource evidence lacks the target step")
    selected = steps[start:]
    runtime = sum(_runtime_seconds(item.get("runtime")) for item in selected)
    memory_values = [item.get("peak memory (mb)") for item in selected]
    if runtime <= 0 or any(
        type(value) not in {int, float}
        or not math.isfinite(float(value))
        or float(value) < 0
        for value in memory_values
    ):
        raise ValueError("candidate resource evidence is invalid")
    memory = max(float(value) for value in memory_values)
    return runtime, memory


def _runtime_seconds(value: object) -> float:
    match = re.fullmatch(r"(\d+):(\d+):(\d+)", value) if isinstance(value, str) else None
    if match is None:
        raise ValueError("candidate step runtime is invalid")
    hours, minutes, seconds = (int(item) for item in match.groups())
    return float(hours * 3600 + minutes * 60 + seconds)




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
    for item in selected:
        if item.planning_mode != mode:
            raise ValueError("candidate trace planning mode does not match evaluation mode")
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
            item.area,
            item.dynamic_power,
            item.leakage_power,
            item.frequency,
            item.drc,
            item.timing,
            item.congestion,
        )
        for metric in metrics:
            if metric is not None and not math.isfinite(metric):
                raise ValueError("candidate metrics must be finite")
    started = [item for item in selected if item.started]
    if len(started) > config.candidate_limit:
        raise ValueError("started candidate traces exceed the frozen budget")
    app_signatures = {item.application_signature for item in started if item.application_signature}
    response_signatures = {item.response_signature for item in started if item.response_signature}
    effective = [
        item
        for item in started
        if item.activation_status == "used"
        or (
            item.requested_value is False
            and item.application_status == "applied"
            and item.activation_status == "not_activated"
        )
    ]
    aliases_saved = sum(item.alias and item.alias_valid is True for item in selected)
    wrong_prunes = sum(item.alias and item.alias_valid is False for item in selected)
    alias_unassessed = sum(item.alias and item.alias_valid is None for item in selected)
    receipt_missing = sum(item.receipt_status == "missing" for item in selected)
    parser_failure = sum(item.receipt_status == "parser_failure" for item in selected)
    producer_failure = sum(item.receipt_status == "producer_failure" for item in selected)
    context_mismatch = sum(item.receipt_status == "context_mismatch" for item in selected)
    utilities = tuple(
        item.terminal_utility for item in started if item.terminal_success and item.terminal_utility is not None
    )
    simple_regret_by_design = _simple_regret_by_design(started)
    measured_regrets = [
        value for value in simple_regret_by_design.values() if value is not None
    ]
    simple_regret = (
        sum(measured_regrets) / len(measured_regrets) if measured_regrets else None
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
        simple_regret_by_design=simple_regret_by_design,
        ppa=tuple(item.ppa for item in started if item.ppa is not None),
        area=tuple(item.area for item in started if item.area is not None),
        dynamic_power=tuple(
            item.dynamic_power for item in started if item.dynamic_power is not None
        ),
        leakage_power=tuple(
            item.leakage_power for item in started if item.leakage_power is not None
        ),
        frequency=tuple(
            item.frequency for item in started if item.frequency is not None
        ),
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
        alias_unassessed=alias_unassessed if mode == "receipt-aware" else 0,
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


def _simple_regret_by_design(
    traces: Iterable[CandidateTrace],
) -> dict[str, float | None]:
    rows = tuple(traces)
    result: dict[str, float | None] = {}
    for design_id in sorted({item.design_id for item in rows}):
        design_rows = tuple(item for item in rows if item.design_id == design_id)
        references = {
            item.reference_utility
            for item in design_rows
            if item.reference_utility is not None
        }
        if len(references) > 1:
            raise ValueError("candidate traces disagree on design reference utility")
        utilities = [
            item.terminal_utility
            for item in design_rows
            if item.terminal_success and item.terminal_utility is not None
        ]
        result[design_id] = (
            max(0.0, next(iter(references)) - max(utilities))
            if references and utilities
            else None
        )
    return result


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
