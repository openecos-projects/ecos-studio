"""Compact, rerunnable artifacts for the seven-knob parameter-status screen."""

from __future__ import annotations

import csv
import json
import time
from pathlib import Path
from typing import Any

from ecos_agent.optimization.contracts import TerminalObservation
from ecos_agent.optimization.experiments.gate0 import noise_profile
from ecos_agent.optimization.experiments.parameter_gap import (
    KnobStatusSummary,
    ProbeResult,
)


def build_report(
    run_id: str,
    started_at: str,
    readiness: dict[str, Any],
    baselines: tuple[TerminalObservation, ...],
    current: dict[str, bool | int | float],
    results: tuple[ProbeResult, ...],
    summaries: tuple[KnobStatusSummary, ...],
) -> dict[str, Any]:
    return {
        "schema_version": "ecos.rq1_parameter_gap_report.v2",
        "run_id": run_id,
        "started_at": started_at,
        "completed_at": timestamp(),
        "status_counts": {
            status: sum(item.status == status for item in results)
            for status in ("effective", "inactive", "unknown")
        },
        "research_scope": "rq1_testability_gate_only",
        "utility_claim": "not_assessed",
        "readiness": readiness,
        "baseline_noise": noise_profile(baselines, require_eligible=False),
        "baseline_observations": [item.model_dump(mode="json") for item in baselines],
        "current_values": dict(sorted(current.items())),
        "candidate_count": len(results),
        "terminal_closed_count": sum(item.terminal_closed for item in results),
        "knobs": [item.to_dict() for item in summaries],
    }


def write_outputs(
    run_root: Path, report: dict[str, Any], results: tuple[ProbeResult, ...]
) -> None:
    write_json(run_root / "gcd-status-report.v2.json", report)
    fields = tuple(ProbeResult.__dataclass_fields__)
    with (run_root / "gcd-probes.v2.csv").open(
        "w", encoding="utf-8", newline=""
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for item in results:
            writer.writerow(item.to_dict())
    lines = [
        "# Seven-Knob Parameter Status Screen",
        "",
        f"- Status counts: {report['status_counts']}",
        f"- Candidates: {report['candidate_count']}",
        f"- Terminal closed: {report['terminal_closed_count']}",
        "- Utility claim: `not_assessed`",
        "",
        "| Knob | Effective | Inactive | Unknown | Tested requests |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in report["knobs"]:
        lines.append(
            f"| `{item['knob_id']}` | {item['status_counts']['effective']} | "
            f"{item['status_counts']['inactive']} | {item['status_counts']['unknown']} | "
            f"{len(item['tested_requests'])} |"
        )
    (run_root / "gcd-status-summary.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def flow_peak_memory_mb(output: Path) -> float | None:
    path = output / "terminal-observation.v1.json"
    if not path.is_file():
        return None
    observation = TerminalObservation.model_validate_json(path.read_text(encoding="utf-8"))
    return next(
        (
            float(metric.value)
            for metric in observation.evaluation_metrics
            if metric.metric_id == "flow_peak_memory"
        ),
        None,
    )


def timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
