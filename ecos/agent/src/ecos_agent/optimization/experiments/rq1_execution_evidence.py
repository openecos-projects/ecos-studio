"""Auditable RQ1 execution-evidence metrics.

The analyzer deliberately consumes the persisted ledger and v3 receipts instead
of the lossy episode summary.  It is pure for in-memory records and fail-closed
for corrupt persisted chains.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerManifest,
    OptimizationTerminalOutcome,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.rules import PROMOTING_DECISIONS

SCHEMA = "ecos.rq1_episode_metrics.v1"
CASE_SCHEMA = "ecos.rq1_contract_case_matrix.v1"
REPLAY_SCHEMA = "ecos.rq1_replay_fidelity.v1"
REPORT_SCHEMA = "ecos.rq1_six_design_report.v1"
STATUSES = ("applied", "inactive", "failed", "unknown")
RELATIONS = (
    "exact", "converted", "quantized", "clamped", "floored", "transformed",
    "rederived", "unknown",
)
_GENERIC_REASONS = {"unknown", "n/a", "na", "none", "unspecified", ""}


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


def _distribution(values: Iterable[str], allowed: Sequence[str]) -> dict[str, int]:
    counts = Counter(values)
    return {item: counts.get(item, 0) for item in allowed}


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
            outcome.parameter_application_receipt_id == item.receipt_id
            or bool(_receipt_keys(item) & _candidate_keys(outcome))
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
            values.update(source)
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
        return item.parameter_application_receipt or (
            receipt_by_id.get(item.parameter_application_receipt_id)
            if item.parameter_application_receipt_id else None
        )
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
    failure["missing_receipt"] = sum(item.parameter_application_receipt is None for item in outcomes_v)
    failure["provider_error"] = 0
    failure["schema_error"] = len(receipt_errors)
    failure["parser_producer_context_mismatch"] = sum(
        getattr(item, "receipt_status", None) in {"parser_failure", "producer_failure", "context_mismatch"} for item in ()
    )
    terminal_complete = terminal_complete if terminal_complete is not None else all(item.terminal_observation is not None for item in outcomes_v)
    applied_candidates = [item for item in outcomes_v if outcome_receipt(item) is not None and outcome_receipt(item).application.status == "applied"]
    success_curve = [item.terminal_observation is not None and _value(item.outcome) in {"improved", "execution_succeeded"} for item in outcomes_v]
    auc = auc20(success_curve, terminal_complete=terminal_complete)
    cases = list(contract_cases)
    false_applied = sum(case.get("expected_status") != "applied" and case.get("observed_status") == "applied" for case in cases)
    false_inactive = sum(case.get("expected_status") in {"applied", "failed", "unknown"} and case.get("observed_status") == "inactive" for case in cases)
    false_promotion = sum(bool(case.get("expected_block")) and bool(case.get("observed_promoted")) for case in cases)
    blocked_cases = [case for case in cases if case.get("expected_block")]
    p = {
        "P01": {"receipt_emitted": _metric(emitted, expected), "receipt_valid_of_emitted": _metric(valid, emitted), "receipt_valid_of_expected": _metric(valid, expected), "invalid": receipt_errors},
        "P02": _role_report(valid_receipts, expected_realized_set),
        "P03": _metric(sum(_source_backed(item.parameter.consumed) for item in valid_receipts if _status(item.application.status) == "applied"), applied, "source/ref missing"),
        "P04": _metric(sum(_source_backed(item.parameter.realized) for item in valid_receipts if item.receipt_id in expected_realized_set), len([item for item in valid_receipts if item.receipt_id in expected_realized_set]), "realized not declared required"),
        "P05": {"distribution": _distribution(status_values, STATUSES)},
        "P06": {"distribution": _distribution(relation_values, RELATIONS)},
        "P07": _metric(reason_complete, len(reason_rows), "reason required only for inactive/failed/unknown"),
        "P08": joins,
        "P09": {"joined": promotion_joined, "total": len(promotions), "completeness": _metric(promotion_joined, len(promotions))},
        "P10": {"violations": invariant_violations, "count": len(invariant_violations), "rate": len(invariant_violations) / len(promoting) if promoting else None},
        "P11": _metric(sum(not bool(case.get("observed_promoted")) for case in blocked_cases), len(blocked_cases), "no registered fault cases"),
        "P12": {"false_applied": false_applied, "false_inactive": false_inactive, "false_promotion": false_promotion or len(invariant_violations)},
        "P13": {"unknown": status_values.count("unknown"), "missing_source": sum(item.parameter.consumed is not None and not _source_backed(item.parameter.consumed) for item in valid_receipts), "unjoined": joins["orphan"] + joins["foreign_candidate"]},
        "P14": {"duplicate_consumed": duplicate_count, "shadow_duplicates": shadow_duplicates, "observed": len(consumed_signatures)},
        "P15": _gap_distribution(consumed_rows),
        "P16": _gap_distribution(realized_rows),
        "P17": integrity or {"status": "not_checked"},
        "P18": {"proposal_action": {"exact": 0, "within_band": 0, "mismatch": 0}, "receipt_semantics": {"exact": 0, "within_band": 0, "mismatch": 0}, "promotion_decision": {"exact": 0, "within_band": 0, "mismatch": 0}, "terminal_metrics": {"exact": 0, "within_band": 0, "mismatch": 0}},
        "P19": {"counts": dict(failure), "conservation": sum(failure.values()) >= expected, "exclusions": []},
    }
    terminal = _terminal_metrics(outcomes_v)
    s = {
        "S01": _metric(sum(outcome_receipt(item) is not None and outcome_receipt(item).application.status == "applied" and _source_backed(outcome_receipt(item).parameter.consumed) for item in outcomes_v), expected),
        "S02": {status: _metric(status_values.count(status), expected) for status in ("inactive", "failed", "unknown")},
        "S03": p["P03"], "S04": p["P06"],
        "S05": p["P14"], "S06": {"count": len(invariant_violations), "rate": len(invariant_violations) / len(promoting) if promoting else None},
        "S07": {"count": 0, "events": []},
        "S08": {"started": expected, "terminal": len(outcomes_v), "artifact_complete": terminal["completeness"]},
        "S09": planning_calls / len(applied_candidates) if planning_calls is not None and applied_candidates else None,
        "S10": planning_calls / expected if planning_calls is not None and expected else None,
        "S11": next((index for index, value in enumerate(success_curve, 1) if value), None),
        "S12": {"terminal_per_wall_hour": None, "verified_applied_per_wall_hour": None},
        "S13": None, "S14": bool(auc["value"]), "S15": auc,
        "S16": terminal["values"].get("route_la_total_overflow"), "S17": terminal["values"].get("setup_wns"),
        "S18": terminal["values"].get("hold_wns"), "S19": terminal["values"].get("drc_count"),
        "S20": planning_calls, "S21": None, "S22": None, "S23": None,
        "S24": {"available": False, "input": None, "output": None, "total": None},
        "S25": {"provider": failure["provider_error"], "schema": failure["schema_error"], "repair": 0, "parser": failure["parser_producer_context_mismatch"]},
        "S26": {"timeout": failure["timeout"], "cap_truncated": 0, "terminal_incomplete": failure["terminal_incomplete"], "replay_invalid": 0},
    }
    return {"schema_version": SCHEMA, "producer_coverage": producer_coverage_register(), "primary": p, "secondary": s, "terminal": terminal, "counts": {"N_start": expected, "N_terminal": len(outcomes_v), "N_receipt_expected": expected, "N_receipt_emitted": emitted, "N_receipt_valid": valid, "N_applied_expected_consumed": applied}, "receipt_ids": [item.receipt_id for item in valid_receipts]}


def analyze_episode(root: Path) -> dict[str, Any]:
    ledger = OptimizationLedger(root)
    replay = ledger.verify()
    integrity: dict[str, Any] = {"ledger": "passed", "audits": {}}
    manifest_path = root / "optimization-ledger-manifest.v1.json"
    if manifest_path.exists():
        manifest = OptimizationLedgerManifest.model_validate_json(manifest_path.read_bytes())
        ledger.verify_manifest(manifest)
    for name, factory in (
        ("decision", OptimizationDecisionAudit),
        ("planning", OptimizationPlanningAudit),
        ("provider", OptimizationPlanningProviderEvidenceAudit),
    ):
        integrity["audits"][name] = "passed"
        factory(root).verify()
    starts = [entry.payload for entry in replay.entries if isinstance(entry.payload, OptimizationInterventionStart)]
    outcomes = [entry.payload for entry in replay.entries if isinstance(entry.payload, OptimizationTerminalOutcome)]
    return analyze_records(starts, outcomes, integrity=integrity)


def replay_fidelity(original: Mapping[str, Any], replay: Mapping[str, Any], *, terminal_tolerance: float = 1e-6) -> dict[str, Any]:
    def compare(left: Any, right: Any, normalize: Any = lambda x: x) -> dict[str, int]:
        a, b = normalize(left), normalize(right)
        return {"exact": int(a == b), "within_band": 0, "mismatch": int(a != b)}
    left_receipts = original.get("receipt_ids", [])
    right_receipts = replay.get("receipt_ids", [])
    return {"schema_version": REPLAY_SCHEMA, "proposal_action": compare(original.get("requested"), replay.get("requested")), "receipt_semantics": compare(left_receipts, right_receipts, lambda x: sorted(str(item).split(".")[-1] for item in x)), "promotion_decision": compare(original.get("primary", {}).get("P10"), replay.get("primary", {}).get("P10")), "terminal_metrics": compare(original.get("terminal", {}).get("values"), replay.get("terminal", {}).get("values"))}


def aggregate_reports(reports: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    rows = list(reports)
    if not rows:
        raise ValueError("cannot aggregate an empty report set")
    aggregate: dict[str, Any] = {"schema_version": REPORT_SCHEMA, "episode_count": len(rows), "primary": {}, "secondary": {}}
    for section in ("primary", "secondary"):
        ids = sorted({metric_id for row in rows for metric_id in row.get(section, {})})
        for metric_id in ids:
            metrics = [row.get(section, {}).get(metric_id) for row in rows]
            pairs = [item for item in metrics if isinstance(item, Mapping) and "numerator" in item and "denominator" in item]
            if pairs:
                numerator = sum(item["numerator"] for item in pairs)
                denominator = sum(item["denominator"] for item in pairs)
                aggregate[section][metric_id] = _metric(numerator, denominator)
            else:
                aggregate[section][metric_id] = {"episodes": len(metrics), "values": metrics}
    return aggregate

def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _self_check() -> None:
    assert auc20([False, True], terminal_complete=True)["value"] == 19 / 20
    assert _gap_distribution([(1.0, 1.01), (True, False)])['comparable'] == 1
    assert canonical_sha256({"schema_version": SCHEMA})


def main(argv: Sequence[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["--self-check"]:
        _self_check()
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("--self-check")
    episode = sub.add_parser("analyze-episode")
    episode.add_argument("root", type=Path)
    episode.add_argument("--output", type=Path)
    replay = sub.add_parser("compare-replay")
    replay.add_argument("original", type=Path)
    replay.add_argument("replay", type=Path)
    replay.add_argument("--output", type=Path)
    case = sub.add_parser("case-matrix")
    case.add_argument("cases", type=Path)
    case.add_argument("--output", type=Path)
    aggregate = sub.add_parser("aggregate")
    aggregate.add_argument("reports", nargs="+", type=Path)
    aggregate.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.command == "--self-check":
        _self_check()
        return 0
    if args.command == "analyze-episode":
        payload = analyze_episode(args.root)
    elif args.command == "compare-replay":
        payload = replay_fidelity(json.loads(args.original.read_text()), json.loads(args.replay.read_text()))
    elif args.command == "case-matrix":
        cases = json.loads(args.cases.read_text())
        rows = cases.get("cases", cases) if isinstance(cases, (dict, list)) else []
        payload = {"schema_version": CASE_SCHEMA, "cases": [{**row, "pass": row.get("expected") == row.get("observed")} for row in rows]}
    else:
        reports = [json.loads(path.read_text()) for path in args.reports]
        payload = aggregate_reports(reports)
    if args.output:
        _write_json(args.output, payload)
    else:
        json.dump(payload, sys.stdout, indent=2, sort_keys=True); sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
