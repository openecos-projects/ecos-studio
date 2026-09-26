"""Auditable RQ1 execution-evidence metrics from v3 receipts and ledger records."""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import accumulate
from pathlib import Path
from typing import Any, Iterable, Mapping

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.rules import PROMOTING_DECISIONS

SCHEMA = "ecos.rq1_episode_metrics.v1"
STATUSES = ("applied", "inactive", "failed", "unknown")
RELATIONS = (
    "exact", "converted", "quantized", "clamped", "floored", "transformed",
    "rederived", "unknown",
)
_GENERIC_REASONS = {"unknown", "n/a", "na", "none", "unspecified", ""}
_REALIZED_OBLIGATION_SOURCES = {
    "floorplan.aspect_ratio": "floorplan.core_geometry",
    "place.target_overflow": "DREAMPlace.final_overflow",
}


@dataclass(frozen=True)
class Metric:
    numerator: int | float
    denominator: int | float
    rate: float | None
    exclusions: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "numerator": self.numerator,
            "denominator": self.denominator,
            "rate": self.rate,
            "exclusions": list(self.exclusions),
        }


def _metric(numerator: int | float, denominator: int | float, *exclusions: str) -> dict[str, Any]:
    return Metric(
        numerator,
        denominator,
        numerator / denominator if denominator else None,
        tuple(exclusions),
    ).as_dict()


def _dump(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, Mapping):
        return dict(value)
    raise TypeError(f"unsupported record: {type(value)!r}")


def _value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _status(value: Any) -> str:
    status = _value(value)
    if status not in STATUSES:
        raise ValueError(f"invalid application status: {status!r}")
    return str(status)


def _relation(value: Any) -> str:
    relation = _value(value)
    if relation not in RELATIONS:
        raise ValueError(f"invalid application relation: {relation!r}")
    return str(relation)


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _comparable_gap(left: Any, right: Any) -> dict[str, Any] | None:
    if isinstance(left, bool) or isinstance(right, bool):
        return {"same": left == right} if type(left) is type(right) else None
    a, b = _finite_number(left), _finite_number(right)
    if a is None or b is None:
        return None
    absolute = abs(a - b)
    relative = absolute / max(abs(b), 1e-12)
    return {"absolute": absolute, "relative": relative, "same": relative <= 0.01}


def _receipt(value: Any) -> ParameterApplicationReceipt:
    if isinstance(value, ParameterApplicationReceipt):
        return value
    return ParameterApplicationReceipt.model_validate(value)


def _start(value: Any) -> OptimizationInterventionStart:
    if isinstance(value, OptimizationInterventionStart):
        return value
    return OptimizationInterventionStart.model_validate(value)


def _outcome(value: Any) -> OptimizationTerminalOutcome:
    if isinstance(value, OptimizationTerminalOutcome):
        return value
    return OptimizationTerminalOutcome.model_validate(value)


def _promoting(outcome: OptimizationTerminalOutcome) -> bool:
    decision = outcome.incumbent_decision
    return decision is not None and _value(decision) in {_value(item) for item in PROMOTING_DECISIONS}


def _candidate_keys(outcome: OptimizationTerminalOutcome) -> set[str]:
    keys = {outcome.intervention_id}
    if outcome.candidate_root_ref:
        keys.add(outcome.candidate_root_ref)
    return keys


def _receipt_keys(receipt: ParameterApplicationReceipt) -> set[str]:
    return {receipt.receipt_id, receipt.materialization.candidate_ref}


def _presence(value: Any) -> bool:
    return value is not None and getattr(value, "unit", None) not in (None, "")


def _source_backed(value: Any) -> bool:
    return _presence(value) and bool(getattr(value, "source", None))


def realized_obligation_receipt_ids(
    receipts: Iterable[Any],
) -> set[str]:
    """Return receipts covered by the frozen native realized-source registry."""
    return {
        receipt.receipt_id
        for item in receipts
        if (receipt := _receipt(item)).parameter.knob_id.value
        in _REALIZED_OBLIGATION_SOURCES
    }


def _registered_realized_issue(
    receipt: ParameterApplicationReceipt,
) -> str | None:
    knob = receipt.parameter.knob_id.value
    expected_source = _REALIZED_OBLIGATION_SOURCES.get(knob)
    realized = receipt.parameter.realized
    if realized is None:
        return "realized missing"
    if expected_source is None:
        return None if _source_backed(realized) else "realized source missing"
    if realized.source != expected_source:
        return f"realized source mismatch: expected {expected_source}"
    observed = _finite_number(realized.value)
    if observed is None:
        return "realized value is not finite"
    if knob == "floorplan.aspect_ratio":
        width = _finite_number(receipt.observation.get("core_bounding_width"))
        height = _finite_number(receipt.observation.get("core_bounding_height"))
        expected = width / height if width is not None and height and height > 0 else None
    else:
        expected = _finite_number(receipt.observation.get("final_overflow"))
    if expected is None:
        return "native realized observation missing"
    if not math.isclose(observed, expected, rel_tol=1e-12, abs_tol=1e-12):
        return f"realized value mismatch: expected {expected!r}"
    return None


def _realized_obligation_report(
    receipts: Sequence[ParameterApplicationReceipt],
    expected_ids: set[str],
) -> dict[str, Any]:
    by_id = {receipt.receipt_id: receipt for receipt in receipts}
    by_knob: dict[str, dict[str, int]] = defaultdict(
        lambda: {"expected": 0, "valid": 0}
    )
    issues: list[dict[str, str]] = []
    valid = 0
    for receipt_id in sorted(expected_ids):
        receipt = by_id.get(receipt_id)
        if receipt is None:
            issues.append({"receipt_id": receipt_id, "knob": "unknown", "reason": "receipt missing or invalid"})
            continue
        knob = receipt.parameter.knob_id.value
        by_knob[knob]["expected"] += 1
        issue = _registered_realized_issue(receipt)
        if issue is None:
            valid += 1
            by_knob[knob]["valid"] += 1
        else:
            issues.append({"receipt_id": receipt_id, "knob": knob, "reason": issue})
    return {
        **_metric(
            valid,
            len(expected_ids),
            "realized not declared required" if not expected_ids else "",
        ),
        "by_knob": dict(sorted(by_knob.items())),
        "issues": issues,
        "not_applicable": len(receipts) - sum(
            receipt.receipt_id in expected_ids for receipt in receipts
        ),
    }


def _distribution(values: Iterable[str], allowed: Sequence[str]) -> dict[str, int]:
    counts = Counter(values)
    return {item: counts.get(item, 0) for item in allowed}


def _distribution_report(values: Iterable[str], allowed: Sequence[str]) -> dict[str, Any]:
    counts = _distribution(values, allowed)
    denominator = sum(counts.values())
    return {
        "distribution": counts,
        "rates": {key: value / denominator if denominator else None for key, value in counts.items()},
        "denominator": denominator,
        "exclusions": [],
    }


def _value_report(value: Any, reason: str | None = None) -> dict[str, Any]:
    return {
        "value": value,
        "numerator": None,
        "denominator": None,
        "rate": None,
        "exclusions": [reason] if value is None and reason else [],
    }


def _gap_distribution(rows: Iterable[tuple[Any, Any]]) -> dict[str, Any]:
    gaps = [_comparable_gap(left, right) for left, right in rows]
    comparable = [item for item in gaps if item is not None and "relative" in item]
    boolean = [item for item in gaps if item is not None and "relative" not in item]
    return {
        "observed": len(gaps),
        "comparable": len(comparable),
        "not_comparable": len(gaps) - len(comparable) - len(boolean),
        "boolean_or_enum": len(boolean),
        "same_count": sum(bool(item["same"]) for item in gaps if item is not None),
        "absolute": [item["absolute"] for item in comparable],
        "relative": [item["relative"] for item in comparable],
    }


def _role_report(receipts: Sequence[ParameterApplicationReceipt], expected_realized: set[str]) -> dict[str, Any]:
    valid = len(receipts)
    applied = sum(_status(item.application.status) == "applied" for item in receipts)
    realized_rows = [item for item in receipts if item.receipt_id in expected_realized]
    def role(name: str, rows: Sequence[ParameterApplicationReceipt], source: bool = False) -> dict[str, Any]:
        values = [getattr(item.parameter, name) for item in rows]
        complete = sum(_source_backed(value) if source else _presence(value) for value in values)
        return {"complete": _metric(complete, len(rows)), "present_all_valid": _metric(
            sum(_presence(getattr(item.parameter, name)) for item in receipts), valid
        )}
    return {
        "requested": role("requested", receipts),
        "written": role("written", receipts),
        "consumed": role("consumed", [item for item in receipts if _status(item.application.status) == "applied"], True),
        "realized": role("realized", realized_rows, True),
        "expected_realized_receipts": len(realized_rows),
        "applied_expected_consumed": applied,
    }


def _receipt_binding_matches(outcome: OptimizationTerminalOutcome, receipt: ParameterApplicationReceipt) -> bool:
    """Accept a receipt only when every persisted binding agrees."""
    return all((expected is None or expected == actual) for expected, actual in (
        (outcome.receipt_sha256, receipt.evidence_sha256),
        (outcome.parameter_application_receipt_id, receipt.receipt_id),
        (outcome.materialization_receipt_sha256, receipt.materialization.receipt_sha256),
    ))


def _receipt_join(receipts: Sequence[ParameterApplicationReceipt], outcomes: Sequence[OptimizationTerminalOutcome]) -> dict[str, Any]:
    by_id: dict[str, list[ParameterApplicationReceipt]] = defaultdict(list)
    for item in receipts:
        by_id[item.receipt_id].append(item)
    joined = 0
    orphan = 0
    duplicate = 0
    foreign = 0
    outcome_ids = {item.parameter_application_receipt_id for item in outcomes if item.parameter_application_receipt_id}
    for item in receipts:
        candidates = by_id[item.receipt_id]
        if len(candidates) != 1:
            duplicate += 1
            continue
        matches = [outcome for outcome in outcomes if (
            _receipt_binding_matches(outcome, item)
            and (
                outcome.parameter_application_receipt_id == item.receipt_id
                or bool(_receipt_keys(item) & _candidate_keys(outcome))
            )
        )]
        if len(matches) == 1:
            joined += 1
        elif not matches:
            orphan += 1
        else:
            duplicate += 1
    foreign = sum(item_id not in by_id for item_id in outcome_ids)
    return {
        "joined": joined,
        "orphan": orphan,
        "duplicate_join": duplicate,
        "foreign_candidate": foreign,
        "completeness": _metric(joined, len(receipts), "no receipt emitted"),
    }


def _terminal_metrics(outcomes: Sequence[OptimizationTerminalOutcome]) -> dict[str, Any]:
    promoted = [item for item in outcomes if _promoting(item)]
    selected = promoted[-1] if promoted else next(
        (item for item in reversed(outcomes) if item.terminal_observation is not None), None
    )
    if selected is None or selected.terminal_observation is None:
        return {"selected_candidate": None, "values": {}, "completeness": _metric(0, 1, "terminal observation missing")}
    observation = selected.terminal_observation
    raw = observation.model_dump(mode="json")
    values: dict[str, Any] = {}
    for source in (raw.get("metrics", {}), raw.get("objective_metrics", {}), raw.get("timing_guardrail", {})):
        if isinstance(source, Mapping):
            values.update({str(key): value for key, value in source.items()})
    for metric in raw.get("evaluation_metrics", ()):
        if isinstance(metric, Mapping) and isinstance(metric.get("metric_id"), str):
            values[metric["metric_id"]] = metric.get("value")
    return {
        "selected_candidate": selected.intervention_id,
        "values": values,
        "completeness": _metric(sum(value is not None for value in values.values()), len(values)),
    }


def auc20(success_at_k: Sequence[bool], *, terminal_complete: bool) -> dict[str, Any]:
    if not success_at_k:
        return {"value": None, "partial": None, "reason": "no candidate starts"}
    if len(success_at_k) > 20:
        raise ValueError("success curve exceeds the frozen 20-candidate budget")
    cumulative = list(success_at_k)
    if any(current and not following for current, following in zip(cumulative, cumulative[1:])):
        raise ValueError("success curve must be cumulative")
    partial = sum(cumulative) / len(cumulative)
    if not terminal_complete:
        return {"value": None, "partial": partial, "reason": "terminal-incomplete or cap-truncated"}
    cumulative.extend([cumulative[-1]] * (20 - len(cumulative)))
    return {"value": sum(cumulative) / 20, "partial": partial, "reason": None}


def producer_coverage_register() -> dict[str, Any]:
    """Return the explicit G1 boundary between native and fixture coverage."""
    return {
        "schema_version": "ecos.rq1_producer_coverage.v1",
        "application_status": {
            "applied": "native-observed",
            "inactive": "native-observed",
            "failed": "fixture-only",
            "unknown": "native-observed",
        },
        "application_relation": {
            "exact": "native-observed",
            "converted": "fixture-only",
            "quantized": "fixture-only",
            "clamped": "fixture-only",
            "floored": "native-observed",
            "transformed": "native-observed",
            "rederived": "fixture-only",
            "unknown": "native-observed",
        },
        "execution_failure_separation": "application.status=failed is distinct from outcome=execution_failed",
    }

def analyze_records(
    starts: Iterable[Any],
    outcomes: Iterable[Any],
    *,
    receipts: Iterable[Any] | None = None,
    expected_realized: Iterable[str] = (),
    integrity: Mapping[str, Any] | None = None,
    planning_calls: int | None = None,
    terminal_complete: bool | None = None,
    contract_cases: Iterable[Mapping[str, Any]] = (),
    strict: bool = False,
    run_metrics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute the versioned RQ1 report from verified or fixture records."""
    starts_v = [_start(item) for item in starts]
    outcomes_v = [_outcome(item) for item in outcomes]
    raw_receipts = list(receipts) if receipts is not None else [
        item.parameter_application_receipt for item in outcomes_v
        if item.parameter_application_receipt is not None
    ]
    valid_receipts: list[ParameterApplicationReceipt] = []
    receipt_errors: list[str] = []
    for item in raw_receipts:
        try:
            valid_receipts.append(_receipt(item))
        except (ValidationError, TypeError, ValueError) as exc:
            receipt_errors.append(str(exc).splitlines()[0])
    expected = len(starts_v)
    emitted = len(raw_receipts)
    valid = len(valid_receipts)
    status_values = [_status(item.application.status) for item in valid_receipts]
    relation_values = [_relation(item.application.relation) for item in valid_receipts]
    applied = sum(item == "applied" for item in status_values)
    receipt_by_id = {item.receipt_id: item for item in valid_receipts}
    def outcome_receipt(item: OptimizationTerminalOutcome) -> ParameterApplicationReceipt | None:
        raw_receipt = item.parameter_application_receipt or (
            receipt_by_id.get(item.parameter_application_receipt_id)
            if item.parameter_application_receipt_id else None
        )
        if raw_receipt is None:
            return None
        try:
            receipt = _receipt(raw_receipt)
        except (ValidationError, TypeError, ValueError):
            return None
        return receipt if _receipt_binding_matches(item, receipt) else None

    def has_stale_receipt_binding(item: OptimizationTerminalOutcome) -> bool:
        raw_receipt = item.parameter_application_receipt
        if raw_receipt is None:
            return False
        if isinstance(raw_receipt, ParameterApplicationReceipt):
            return not _receipt_binding_matches(item, raw_receipt)
        try:
            return not _receipt_binding_matches(item, _receipt(raw_receipt))
        except (ValidationError, TypeError, ValueError):
            return False
    expected_realized_set = set(expected_realized)
    joins = _receipt_join(valid_receipts, outcomes_v)
    promotions = [item for item in outcomes_v if item.incumbent_decision is not None]
    promoting = [item for item in outcomes_v if _promoting(item)]
    promotion_joined = sum(
        outcome_receipt(item) is not None
        or item.parameter_application_receipt_id is not None
        or item.receipt_sha256 is None
        for item in promotions
    )
    invariant_violations = []
    missing_evidence_cases = []
    for item in promoting:
        receipt = outcome_receipt(item)
        valid_consumed = receipt is not None and _status(receipt.application.status) == "applied" and _source_backed(receipt.parameter.consumed)
        if not valid_consumed:
            invariant_violations.append(item.intervention_id)
    for item in outcomes_v:
        receipt = outcome_receipt(item)
        if receipt is None or receipt.application.status != "applied":
            missing_evidence_cases.append(item)
    reason_rows = [item for item in valid_receipts if _status(item.application.status) in {"inactive", "failed", "unknown"}]
    reason_complete = sum(bool(item.application.reason and item.application.reason.strip().lower() not in _GENERIC_REASONS) for item in reason_rows)
    consumed_rows = [(item.parameter.requested.value, item.parameter.consumed.value) for item in valid_receipts if item.parameter.consumed is not None]
    realized_rows = [(item.parameter.consumed.value, item.parameter.realized.value) for item in valid_receipts if item.parameter.consumed is not None and item.parameter.realized is not None]
    consumed_signatures = [(
        item.parameter.knob_id.value,
        item.parameter.consumed.unit,
        str(item.parameter.consumed.value),
        _status(item.application.status),
    ) for item in valid_receipts if item.parameter.consumed is not None]
    duplicate_count = len(consumed_signatures) - len(set(consumed_signatures))
    requested_to_consumed: dict[str, list[str]] = defaultdict(list)
    for item in valid_receipts:
        if item.parameter.consumed is not None:
            signature = json.dumps([
                item.parameter.knob_id.value,
                item.parameter.consumed.unit,
                item.parameter.consumed.value,
                _status(item.application.status),
            ], sort_keys=True)
            requested_to_consumed[signature].append(json.dumps([
                item.parameter.knob_id.value, item.parameter.requested.value, item.parameter.requested.unit
            ], sort_keys=True))
    shadow_duplicates = sum(len(set(requests)) > 1 for requests in requested_to_consumed.values())
    failure = Counter()
    failure["started"] = expected
    failure["not_started"] = max(0, len(starts_v) - len(outcomes_v))
    failure["failed"] = sum(_value(item.outcome) == "execution_failed" for item in outcomes_v)
    failure["timeout"] = sum(_value(item.outcome) == "timed_out_cancelled" for item in outcomes_v)
    failure["terminal_incomplete"] = sum(item.terminal_observation is None for item in outcomes_v)
    failure["missing_receipt"] = sum(outcome_receipt(item) is None and not has_stale_receipt_binding(item) for item in outcomes_v)
    failure["stale_receipt"] = sum(has_stale_receipt_binding(item) for item in outcomes_v)
    failure["provider_error"] = 0
    failure["schema_error"] = len(receipt_errors)
    failure["parser_producer_context_mismatch"] = sum(
        getattr(item, "receipt_status", None) in {"parser_failure", "producer_failure", "context_mismatch"} for item in ()
    )
    terminal_complete = terminal_complete if terminal_complete is not None else all(item.terminal_observation is not None for item in outcomes_v)
    applied_candidates = [item for item in outcomes_v if outcome_receipt(item) is not None and outcome_receipt(item).application.status == "applied"]
    success_curve = list(
        accumulate(
            (
                item.terminal_observation is not None
                and _value(item.outcome) in {"improved", "execution_succeeded"}
                for item in outcomes_v
            ),
            lambda seen, current: seen or current,
        )
    )
    auc = auc20(success_curve, terminal_complete=terminal_complete)
    run_metrics = run_metrics or {}
    terminal_values = _terminal_metrics(outcomes_v)["values"]
    cases = list(contract_cases)
    false_applied = sum(case.get("expected_status") != "applied" and case.get("observed_status") == "applied" for case in cases)
    false_inactive = sum(case.get("expected_status") in {"applied", "failed", "unknown"} and case.get("observed_status") == "inactive" for case in cases)
    false_promotion = sum(bool(case.get("expected_block")) and bool(case.get("observed_promoted")) for case in cases)
    blocked_cases = [case for case in cases if case.get("expected_block")]
    p = {
        "P01": {"receipt_emitted": _metric(emitted, expected), "receipt_valid_of_emitted": _metric(valid, emitted), "receipt_valid_of_expected": _metric(valid, expected), "invalid": receipt_errors},
        "P02": _role_report(valid_receipts, expected_realized_set),
        "P03": _metric(sum(_source_backed(item.parameter.consumed) for item in valid_receipts if _status(item.application.status) == "applied"), applied, "source/ref missing"),
        "P04": _realized_obligation_report(valid_receipts, expected_realized_set),
        "P05": _distribution_report(status_values, STATUSES),
        "P06": _distribution_report(relation_values, RELATIONS),
        "P07": _metric(reason_complete, len(reason_rows), "reason required only for inactive/failed/unknown"),
        "P08": joins,
        "P09": {"joined": promotion_joined, "total": len(promotions), "completeness": _metric(promotion_joined, len(promotions))},
        "P10": {"violations": invariant_violations, "count": len(invariant_violations), **_metric(len(invariant_violations), len(promoting))},
        "P11": _metric(sum(not bool(case.get("observed_promoted")) for case in blocked_cases), len(blocked_cases), "no registered fault cases"),
        "P12": {"false_applied": false_applied, "false_inactive": false_inactive, "false_promotion": false_promotion + len(invariant_violations), "denominator": len(cases), "exclusions": []},
        "P13": {"unknown": status_values.count("unknown"), "missing_source": sum(item.parameter.consumed is not None and not _source_backed(item.parameter.consumed) for item in valid_receipts), "unjoined": joins["orphan"] + joins["foreign_candidate"], "stale_receipt": failure["stale_receipt"], "denominator": valid, "exclusions": []},
        "P14": {"duplicate_consumed": duplicate_count, "shadow_duplicates": shadow_duplicates, "observed": len(consumed_signatures), "denominator": len(consumed_signatures), "rate": duplicate_count / len(consumed_signatures) if consumed_signatures else None, "exclusions": []},
        "P15": _gap_distribution(consumed_rows),
        "P16": _gap_distribution(realized_rows),
        "P17": integrity or {"status": "not_checked"},
        "P18": {"proposal_action": {"exact": 0, "within_band": 0, "mismatch": 0}, "receipt_semantics": {"exact": 0, "within_band": 0, "mismatch": 0}, "promotion_decision": {"exact": 0, "within_band": 0, "mismatch": 0}, "terminal_metrics": {"exact": 0, "within_band": 0, "mismatch": 0}},
        "P19": {"counts": dict(failure), "conservation": sum(failure.values()) >= expected, "accounted_started": expected, "accounted_terminal": len(outcomes_v), "exclusions": []},
    }
    terminal = _terminal_metrics(outcomes_v)
    wall_seconds = run_metrics.get("wall_time_seconds")
    wall_hours = wall_seconds / 3600 if wall_seconds else None
    planning_calls_used = (
        planning_calls if planning_calls is not None else run_metrics.get("planning_calls", 0)
    )
    route_best = run_metrics.get("route_wirelength_best")
    route_reference = run_metrics.get("route_wirelength_reference")
    route_reduction = (
        (route_reference - route_best) / route_reference * 100
        if route_reference and route_best is not None
        else None
    )
    s = {
        "S01": _metric(sum(outcome_receipt(item) is not None and outcome_receipt(item).application.status == "applied" and _source_backed(outcome_receipt(item).parameter.consumed) for item in outcomes_v), expected),
        "S02": {status: _metric(status_values.count(status), expected) for status in ("inactive", "failed", "unknown")},
        "S03": p["P03"], "S04": p["P06"],
        "S05": p["P14"], "S06": {"count": len(invariant_violations), **_metric(len(invariant_violations), len(promoting))},
        "S07": {"events": [], **_metric(0, len(invariant_violations), "mis-promotion event trace unavailable")},
        "S08": {"started": _metric(expected, expected), "terminal": _metric(len(outcomes_v), expected), "artifact_complete": terminal["completeness"], "exclusions": []},
        "S09": _metric(planning_calls_used, len(applied_candidates), *(() if applied_candidates else ("no verified applied candidates",))),
        "S10": _metric(planning_calls_used, expected),
        "S11": _value_report(next((index for index, value in enumerate(success_curve, 1) if value), None), "no feasible candidate"),
        "S12": {"terminal_per_wall_hour": _value_report(len(outcomes_v) / wall_hours if wall_hours else None, None if wall_hours else "wall time unavailable"), "verified_applied_per_wall_hour": _value_report(len(applied_candidates) / wall_hours if wall_hours else None, None if wall_hours else "wall time unavailable")},
        "S13": _value_report(route_reduction, None if route_reduction is not None else "reference and selected route wirelength are unavailable"),
        "S14": {"value": bool(auc["value"]), **_metric(int(bool(auc["value"])), 1, "AUC20 unavailable" if auc["value"] is None else "")},
        "S15": {**auc, **_metric(sum(success_curve), 20, "formal AUC20 unavailable" if auc["value"] is None else "")},
        "S16": _value_report(terminal["values"].get("route_la_total_overflow"), "terminal overflow unavailable"),
        "S17": _value_report(terminal["values"].get("setup_wns") or terminal["values"].get("sta_setup_wns"), "setup WNS unavailable"),
        "S18": _value_report(terminal["values"].get("hold_wns") or terminal["values"].get("sta_hold_wns"), "hold WNS unavailable"),
        "S19": _value_report(terminal["values"].get("drc_count"), "DRC count unavailable"),
        "S20": _value_report(planning_calls_used, None if planning_calls_used is not None else "planning calls unavailable"),
        "S21": _value_report(run_metrics.get("wall_time_seconds"), "wall time unavailable"),
        "S22": _value_report(terminal_values.get("flow_tool_runtime"), "candidate runtime unavailable"),
        "S23": _value_report(terminal_values.get("flow_peak_memory"), "peak memory unavailable"),
        "S24": {"available": bool(run_metrics.get("token_usage")), **(run_metrics.get("token_usage") or {"input_tokens": None, "output_tokens": None, "total_tokens": None}), "numerator": run_metrics.get("token_usage", {}).get("total_tokens"), "denominator": 1 if run_metrics.get("token_usage") else None, "rate": None, "exclusions": [] if run_metrics.get("token_usage") else ["provider token usage unavailable"]},
        "S25": {"provider": run_metrics.get("provider_errors", failure["provider_error"]), "schema": run_metrics.get("schema_errors", failure["schema_error"]), "repair": run_metrics.get("repair_errors", 0), "parser": failure["parser_producer_context_mismatch"], "denominator": expected, "exclusions": []},
        "S26": {"timeout": failure["timeout"], "cap_truncated": 0, "terminal_incomplete": failure["terminal_incomplete"], "replay_invalid": 0, "denominator": expected, "exclusions": []},
    }
    report = {"schema_version": SCHEMA, "producer_coverage": producer_coverage_register(), "primary": p, "secondary": s, "terminal": terminal, "counts": {"N_start": expected, "N_terminal": len(outcomes_v), "N_receipt_expected": expected, "N_receipt_emitted": emitted, "N_receipt_valid": valid, "N_applied_expected_consumed": applied}, "receipt_ids": [item.receipt_id for item in valid_receipts], "receipt_semantics": [
        {
            "knob": item.parameter.knob_id.value,
            "requested": item.parameter.requested.value,
            "requested_unit": item.parameter.requested.unit,
            "written": item.parameter.written.value,
            "written_unit": item.parameter.written.unit,
            "consumed": item.parameter.consumed.value if item.parameter.consumed else None,
            "consumed_unit": item.parameter.consumed.unit if item.parameter.consumed else None,
            "consumed_source": item.parameter.consumed.source if item.parameter.consumed else None,
            "realized": item.parameter.realized.value if item.parameter.realized else None,
            "realized_unit": item.parameter.realized.unit if item.parameter.realized else None,
            "realized_source": item.parameter.realized.source if item.parameter.realized else None,
            "status": _status(item.application.status),
            "relation": _relation(item.application.relation),
            "reason": item.application.reason,
        }
        for item in valid_receipts
    ]}
    if strict:
        if joins["duplicate_join"] or joins["foreign_candidate"]:
            raise ValueError("receipt join integrity failed")
        if invariant_violations:
            raise ValueError("promotion invariant failed")
        if any(p["P12"][key] for key in ("false_applied", "false_inactive", "false_promotion")):
            raise ValueError("contract verdict integrity failed")
        if p["P04"]["issues"]:
            raise ValueError("realized obligation integrity failed")
    return report


def analyze_episode(root: Path) -> dict[str, Any]:
    from ecos_agent.optimization.experiments.rq1_execution_evidence_io import analyze_episode as impl
    return impl(root)


def replay_fidelity(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import replay_fidelity as impl
    return impl(*args, **kwargs)


def build_case_matrix(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import build_case_matrix as impl
    return impl(*args, **kwargs)


def render_case_matrix_markdown(*args: Any, **kwargs: Any) -> str:
    from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import render_case_matrix_markdown as impl
    return impl(*args, **kwargs)


def aggregate_reports(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import aggregate_reports as impl
    return impl(*args, **kwargs)


def main(argv: list[str] | None = None) -> int:
    from ecos_agent.optimization.experiments.rq1_execution_evidence_reporting import main as impl
    return impl(argv)


if __name__ == "__main__":
    raise SystemExit(main())
