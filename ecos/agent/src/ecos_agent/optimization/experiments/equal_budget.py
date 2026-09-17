"""Replayable equal-budget accounting for requested-only and receipt-aware runs."""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Iterable, Literal

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    TerminalObservation,
    TimingMetric,
    objective_metric_utility,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.execution import candidate_observation_stage
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.experiments.statistics import success_curve_auc
from ecos_agent.optimization.rules import PROMOTING_DECISIONS

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
    wirelength: float | None = None
    die_area: float | None = None
    hold_wns: float | None = None
    qor_score: float | None = None
    place_hpwl: float | None = None
    clock_wirelength: float | None = None
    interconnect_inflation: float | None = None
    qor_timing: float | None = None
    qor_interconnect: float | None = None
    qor_area: float | None = None
    qor_power: float | None = None
    qor_robustness: float | None = None
    qor_summary: float | None = None
    requested_value: str | float | int | bool | None = None
    requested_knob: str | None = None
    actual_value: float | int | bool | None = None
    parameter_status: Literal["effective", "inactive", "unknown"] = "unknown"
    parameter_reason: str | None = None
    # Feasible = signoff-eligible terminal; promoted = became the incumbent.
    feasible: bool = False
    promoted: bool = False
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
    effective: int
    effective_rate: float
    inactive: int
    inactive_rate: float
    unknown: int
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
        wirelength=(
            float(terminal_observation.metrics[ObjectiveMetric.ROUTE_WIRELENGTH])
            if terminal_observation is not None
            else None
        ),
        die_area=_evaluation_value(evaluation, "die_area"),
        hold_wns=(
            float(terminal_observation.timing_guardrail[TimingMetric.STA_HOLD_WNS])
            if terminal_observation is not None
            else None
        ),
        qor_score=_evaluation_value(evaluation, "gui_overall_qor_score"),
        place_hpwl=_evaluation_value(evaluation, "place_hpwl"),
        clock_wirelength=_evaluation_value(evaluation, "total_clock_wirelength"),
        interconnect_inflation=_evaluation_value(
            evaluation, "interconnect_inflation_total"
        ),
        qor_timing=_evaluation_value(evaluation, "qor_timing_quality"),
        qor_interconnect=_evaluation_value(evaluation, "qor_interconnect_quality"),
        qor_area=_evaluation_value(evaluation, "qor_area_quality"),
        qor_power=_evaluation_value(evaluation, "qor_power_quality"),
        qor_robustness=_evaluation_value(evaluation, "qor_robustness_quality"),
        qor_summary=_evaluation_value(evaluation, "qor_summary_balanced"),
        requested_value=(receipt.requested.get("value") if receipt else None),
        requested_knob=(receipt.requested.get("knob_id") if receipt else None),
        actual_value=(receipt.actual_value if receipt else None),
        parameter_status=(receipt.status if receipt else "unknown"),
        parameter_reason=(receipt.reason if receipt else "Parameter receipt is missing."),
        feasible=(
            terminal_success
            and terminal_observation is not None
            and terminal_observation.eligible_for_incumbent
        ),
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
    # A wall-budget stop can cut a started candidate before any terminal is
    # recorded; such pending interventions must trail the merged ones, and
    # only merged candidates produce traces.
    merged_starts = tuple(
        start for start in starts if start.intervention_id in outcomes
    )
    pending_starts = len(starts) - len(merged_starts)
    if pending_starts and starts[-1].intervention_id in outcomes:
        raise ValueError("episode trace contains mid-episode pending interventions")
    if (
        len(candidate_decisions) < len(merged_starts)
        or not set(outcomes) <= {item.intervention_id for item in starts}
    ):
        raise ValueError("episode lifecycle does not match planning decisions")
    # A wall-budget stop can accept one final decision that never begins an
    # intervention; starts and decisions stay chronologically 1:1 up to that
    # trailing tail, so pair only the decisions that actually started.
    candidate_decisions = candidate_decisions[: len(merged_starts)]
    traces: list[CandidateTrace] = []
    episode_id = str(state["episode_id"])
    for start, decision in zip(merged_starts, candidate_decisions, strict=True):
        if start.requested != decision.requested:
            raise ValueError("episode request does not match planning decision")
        outcome = outcomes[start.intervention_id]
        if not outcome.candidate_root_ref:
            # A wall-budget stop can cut the last started candidate before any
            # evidence lands; nothing observable exists for that probe.
            continue
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
                requested_knob=start.requested.knob_id.value,
                promoted=(
                    outcome.incumbent_decision in PROMOTING_DECISIONS
                    if outcome.incumbent_decision is not None
                    else False
                ),
                proposal_outcome=(
                    "repair"
                    if decision.planner_source == "repair"
                    else None
                ),
            )
        )
    traces.extend(_planning_event_traces(design_id, episode_id, mode, decisions))
    return tuple(traces), len(planning.entries), mode


def _verified_episode_state(episode_root: Path) -> dict[str, object]:
    path = episode_root / "optimization-episode-state.v10.json"
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
    decisions,
) -> tuple[CandidateTrace, ...]:
    traces: list[CandidateTrace] = []
    for decision in decisions.entries:
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
    # Floorplan candidates target the RPC-level "Floorplan" name, which never
    # appears in the flow ledger; their resource evidence lives on the
    # postFloorplan sub-step (see candidate_observation_stage).
    target_step = candidate_observation_stage(target_step)
    start = next(
        (index for index, item in enumerate(steps) if item.get("name") == target_step),
        None,
    )
    if start is None:
        raise ValueError("candidate resource evidence lacks the target step")
    selected = steps[start:]
    # A failed candidate stops mid-flow: steps that never ran carry an empty
    # runtime and no peak memory, and contribute no resource evidence.
    runtime = 0.0
    memory_values: list[float] = []
    ran_any_step = False
    for item in selected:
        raw_runtime = item.get("runtime")
        if raw_runtime is None or raw_runtime == "":
            continue
        runtime += _runtime_seconds(raw_runtime)
        ran_any_step = True
        memory = item.get("peak memory (mb)")
        if (
            type(memory) not in {int, float}
            or not math.isfinite(float(memory))
            or float(memory) < 0
        ):
            raise ValueError("candidate resource evidence is invalid")
        memory_values.append(float(memory))
    if not ran_any_step or runtime <= 0 or not memory_values:
        raise ValueError("candidate resource evidence is invalid")
    memory = max(memory_values)
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
        if item.parameter_status not in {"effective", "inactive", "unknown"}:
            raise ValueError("candidate parameter status is invalid")
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
    effective = sum(item.parameter_status == "effective" for item in started)
    inactive = sum(item.parameter_status == "inactive" for item in started)
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
        effective=effective,
        effective_rate=effective / len(started) if started else 0.0,
        inactive=inactive,
        inactive_rate=inactive / len(started) if started else 0.0,
        unknown=sum(item.parameter_status == "unknown" for item in started),
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


def summarize_candidate_metrics(
    traces: Iterable[CandidateTrace],
    *,
    mode: Mode,
) -> dict[str, object]:
    """Run-level comparison metrics over one episode's candidate sequence.

    Produces the RQ1 comparison-layer quantities the raw ledger stores but no
    other module aggregates: application/response signature repeats,
    success@k (cumulative over started candidates, feasible = signoff-eligible
    terminal), first feasible candidate index, best feasible QoR utility, the
    requested-vs-actual deviation spectrum, and mispromotion events.  A
    promoted candidate without an effective receipt is an implementation
    defect on the receipt-aware path and fails loudly here.
    """
    started = [item for item in traces if item.started]
    application_signatures = [
        (item.requested_knob, item.requested_value)
        for item in started
        if item.requested_knob is not None and item.requested_value is not None
    ]
    response_signatures = [
        (item.requested_knob, item.actual_value, item.parameter_status)
        for item in started
        if item.requested_knob is not None
    ]

    def _repeat_report(signatures: list[tuple[object, ...]]) -> dict[str, object]:
        unique = len(set(signatures))
        repeats = len(signatures) - unique
        return {
            "observed": len(signatures),
            "unique": unique,
            "repeat_count": repeats,
            "repeat_rate": repeats / len(signatures) if signatures else 0.0,
        }

    feasible_indices = [
        index for index, item in enumerate(started, 1) if item.feasible
    ]
    success_at_k = {
        k: any(item.feasible for item in started[:k])
        for k in range(1, len(started) + 1)
    }
    feasible_rows = [item for item in started if item.feasible]
    best_feasible = (
        max(feasible_rows, key=lambda item: item.terminal_utility)
        if feasible_rows and all(
            item.terminal_utility is not None for item in feasible_rows
        )
        else None
    )
    if feasible_rows and any(
        item.terminal_utility is None for item in feasible_rows
    ):
        raise ValueError("feasible candidate traces must carry terminal utility")
    mispromotions = [
        item for item in started
        if item.promoted and item.parameter_status != "effective"
    ]
    if mode == "receipt-aware" and mispromotions:
        raise ValueError(
            "receipt-aware episode promoted candidates without an effective "
            "receipt: "
            + ", ".join(item.candidate_id for item in mispromotions)
        )
    misleading_steps = _misleading_step_counts(started)
    return {
        "schema_version": "ecos.optimization_candidate_metrics.v1",
        "mode": mode,
        "started_candidates": len(started),
        "application_signature_repeats": _repeat_report(application_signatures),
        "response_signature_repeats": _repeat_report(response_signatures),
        "success_at_k": success_at_k,
        "auc_success_at_n": (
            success_curve_auc(success_at_k) if success_at_k else None
        ),
        "first_feasible_candidate_index": (
            feasible_indices[0] if feasible_indices else None
        ),
        "best_feasible_candidate_id": (
            best_feasible.candidate_id if best_feasible is not None else None
        ),
        "best_feasible_terminal_utility": (
            best_feasible.terminal_utility if best_feasible is not None else None
        ),
        "feasible_candidates": len(feasible_rows),
        "mispromotion_events": len(mispromotions),
        "mispromotion_misleading_steps": {
            "events": len(misleading_steps),
            "steps_by_event": misleading_steps,
            "total_steps": sum(misleading_steps),
        },
        "requested_actual_deviation_spectrum": _deviation_spectrum(started),
    }


def _misleading_step_counts(started: list[CandidateTrace]) -> list[int]:
    """Started probes misled by each mispromotion, until the next promotion.

    A mispromoted candidate poisons the incumbent: every later probe that
    starts before any next promotion runs against the wrong incumbent.  The
    next promotion (effective or not) closes the window; episode end closes
    it too.
    """
    counts: list[int] = []
    window_open = False
    steps = 0
    for item in started:
        if item.promoted:
            if window_open:
                counts.append(steps)
                window_open = False
            steps = 0
            window_open = item.parameter_status != "effective"
        elif window_open:
            steps += 1
    if window_open:
        counts.append(steps)
    return counts


def summarize_episode_final_states(
    final_states: Iterable[object],
) -> dict[str, object]:
    """Run-level escalation accounting over episode terminal states."""
    states = Counter(str(state) for state in final_states)
    escalated = sum(
        count for state, count in states.items() if state.endswith("escalated")
    )
    return {
        "schema_version": "ecos.optimization_episode_final_states.v1",
        "episodes": sum(states.values()),
        "final_state_counts": dict(sorted(states.items())),
        "escalated_episodes": escalated,
        "escalation_rate": escalated / sum(states.values()) if states else None,
    }


def _deviation_spectrum(started: list[CandidateTrace]) -> dict[str, object]:
    """Per-knob requested-vs-actual deviation statistics (numeric knobs only)."""
    by_knob: dict[str, list[float]] = {}
    skipped_boolean = 0
    for item in started:
        if (
            item.requested_knob is None
            or item.actual_value is None
            or isinstance(item.requested_value, bool)
            or isinstance(item.actual_value, bool)
            or not isinstance(item.requested_value, (int, float))
        ):
            if item.requested_knob is not None and isinstance(
                item.actual_value, bool
            ):
                skipped_boolean += 1
            continue
        by_knob.setdefault(item.requested_knob, []).append(
            float(item.actual_value) - float(item.requested_value)
        )
    spectrum: dict[str, object] = {}
    for knob, deltas in sorted(by_knob.items()):
        spectrum[knob] = {
            "observed": len(deltas),
            "min_delta": min(deltas),
            "median_delta": sorted(deltas)[len(deltas) // 2]
            if len(deltas) % 2
            else (
                sorted(deltas)[len(deltas) // 2 - 1]
                + sorted(deltas)[len(deltas) // 2]
            )
            / 2,
            "max_delta": max(deltas),
            "zero_delta_count": sum(delta == 0 for delta in deltas),
        }
    return {
        "knobs": spectrum,
        "boolean_knob_values_skipped": skipped_boolean,
    }


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
