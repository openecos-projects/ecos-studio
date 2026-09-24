"""CLI and report assembly for the RQ1 execution-evidence analyzer."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.rq1_execution_evidence import SCHEMA, analyze_episode, auc20

CASE_SCHEMA = "ecos.rq1_contract_case_matrix.v1"
REPLAY_SCHEMA = "ecos.rq1_replay_fidelity.v1"
REPORT_SCHEMA = "ecos.rq1_six_design_report.v1"
TIER_A_CASE_NAMES = (
    "exact mapping", "converted", "quantized", "clamped", "floored",
    "transformed", "rederived", "inactive", "application failure",
    "downstream execution failure after application", "missing native evidence",
    "stale verifier evidence", "missing receipt", "duplicate requested",
    "duplicate consumed", "tampered hash", "foreign candidate binding", "replay",
)


def replay_fidelity(original: Mapping[str, Any], replay: Mapping[str, Any], *, terminal_tolerance: float = 1e-6) -> dict[str, Any]:
    def compare(left: Any, right: Any) -> dict[str, int]:
        if left == right:
            return {"exact": 1, "within_band": 0, "mismatch": 0}
        if isinstance(left, Mapping) and isinstance(right, Mapping):
            numeric = [
                abs(float(left[key]) - float(right[key])) <= terminal_tolerance
                for key in left.keys() & right.keys()
                if isinstance(left[key], (int, float)) and isinstance(right[key], (int, float))
            ]
            if numeric and all(numeric) and len(left) == len(right):
                return {"exact": 0, "within_band": 1, "mismatch": 0}
        return {"exact": 0, "within_band": 0, "mismatch": 1}
    return {
        "schema_version": REPLAY_SCHEMA,
        "proposal_action": compare(original.get("requested"), replay.get("requested")),
        "receipt_semantics": compare(original.get("receipt_semantics", len(original.get("receipt_ids", []))), replay.get("receipt_semantics", len(replay.get("receipt_ids", [])))),
        "promotion_decision": compare(original.get("primary", {}).get("P10"), replay.get("primary", {}).get("P10")),
        "terminal_metrics": compare(original.get("terminal", {}).get("values"), replay.get("terminal", {}).get("values")),
    }


def build_case_matrix(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    cases = []
    for row in rows:
        expected = row.get("expected")
        observed = row.get("observed")
        if expected is None or observed is None:
            raise ValueError("contract case requires expected and observed verdicts")
        passed = expected == observed
        cases.append({
            "case": row.get("case"),
            "expected": expected,
            "observed": observed,
            "pass": passed,
            "mismatch_reason": None if passed else row.get(
                "mismatch_reason", "expected and observed verdict differ"
            ),
            "evidence_refs": list(row.get("evidence_refs", ())),
            "producer_coverage": row.get("producer_coverage", "fixture-only"),
            "metrics": dict(row.get("metrics", {})),
        })
    names = [row["case"] for row in cases]
    missing = [name for name in TIER_A_CASE_NAMES if name not in names]
    unexpected = [name for name in names if name not in TIER_A_CASE_NAMES]
    duplicate = sorted({name for name in names if names.count(name) > 1})
    metrics = [row["metrics"] for row in cases]
    fail_closed = [
        row for row in cases
        if row["case"] in {
            "missing receipt", "stale verifier evidence", "tampered hash",
            "foreign candidate binding",
        }
    ]
    summary = {
        "registered": len(cases),
        "passed": sum(item["pass"] for item in cases),
        "failed": sum(not item["pass"] for item in cases),
        "missing_tier_a_cases": missing,
        "unexpected_tier_a_cases": unexpected,
        "duplicate_tier_a_cases": duplicate,
        "false_applied": sum(item.get("false_applied", 0) for item in metrics),
        "false_inactive": sum(item.get("false_inactive", 0) for item in metrics),
        "false_promotion": sum(item.get("false_promotion", 0) for item in metrics),
        "promotion_invariant_violations": sum(
            item.get("promotion_invariant_violations", 0) for item in metrics
        ),
        "fail_closed_passed": sum(
            item["metrics"].get("fail_closed") == 1 for item in fail_closed
        ),
        "fail_closed_total": len(fail_closed),
        "fail_closed_rate": (
            sum(item["metrics"].get("fail_closed") == 1 for item in fail_closed)
            / len(fail_closed)
            if fail_closed else None
        ),
        "failure_accounting_conserved": all(
            item.get("failure_accounting_conserved") is True for item in metrics
        ),
        "receipt_semantic_mismatch": sum(
            item.get("receipt_semantic_mismatch", 0) for item in metrics
        ),
    }
    summary["complete"] = (
        not missing
        and not unexpected
        and not duplicate
        and all(item["pass"] for item in cases)
        and summary["false_applied"] == 0
        and summary["false_inactive"] == 0
        and summary["false_promotion"] == 0
        and summary["promotion_invariant_violations"] == 0
        and summary["fail_closed_rate"] == 1.0
        and summary["failure_accounting_conserved"]
        and summary["receipt_semantic_mismatch"] == 0
    )
    return {
        "schema_version": CASE_SCHEMA,
        "cases": cases,
        "summary": summary,
    }


def render_case_matrix_markdown(matrix: Mapping[str, Any]) -> str:
    lines = [
        "# RQ1 Tier-A Contract Case Matrix",
        "",
        "| Case | Pass | Producer coverage | Expected status/relation | "
        "Observed status/relation | Promotion | Mismatch |",
        "|---|---:|---|---|---|---:|---|",
    ]
    for row in matrix.get("cases", ()):
        expected = row.get("expected", {})
        observed = row.get("observed", {})
        lines.append(
            f"| {row.get('case', '')} | {'yes' if row.get('pass') else 'no'} | "
            f"{row.get('producer_coverage', '')} | "
            f"{expected.get('status', '')}/{expected.get('relation', '')} | "
            f"{observed.get('status', '')}/{observed.get('relation', '')} | "
            f"{observed.get('promotion', '')} | {row.get('mismatch_reason') or ''} |"
        )
    summary = matrix.get("summary", {})
    lines.extend((
        "",
        f"Registered: {summary.get('registered', 0)}",
        f"Passed: {summary.get('passed', 0)}",
        f"Failed: {summary.get('failed', 0)}",
        f"Fail-closed: {summary.get('fail_closed_passed', 0)}/"
        f"{summary.get('fail_closed_total', 0)}",
        f"False applied/inactive/promotion: {summary.get('false_applied', 0)}/"
        f"{summary.get('false_inactive', 0)}/{summary.get('false_promotion', 0)}",
        f"Invariant violations: {summary.get('promotion_invariant_violations', 0)}",
        f"Failure accounting conserved: "
        f"{summary.get('failure_accounting_conserved', False)}",
        f"Complete: {summary.get('complete', False)}",
    ))
    return "\n".join(lines) + "\n"

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
                numerator = sum(item["numerator"] for item in pairs if isinstance(item["numerator"], (int, float)))
                denominator = sum(item["denominator"] for item in pairs if isinstance(item["denominator"], (int, float)))
                aggregate[section][metric_id] = {"numerator": numerator, "denominator": denominator, "rate": numerator / denominator if denominator else None, "exclusions": []}
            else:
                aggregate[section][metric_id] = {"episodes": len(metrics), "values": metrics}
    return aggregate


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _self_check() -> None:
    assert auc20([False, True], terminal_complete=True)["value"] == 19 / 20
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
    case.add_argument("--markdown", type=Path)
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
        payload = build_case_matrix(rows)
        if args.markdown:
            args.markdown.parent.mkdir(parents=True, exist_ok=True)
            args.markdown.write_text(render_case_matrix_markdown(payload), encoding="utf-8")
    else:
        payload = aggregate_reports(json.loads(path.read_text()) for path in args.reports)
    if args.output:
        _write_json(args.output, payload)
    else:
        json.dump(payload, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
