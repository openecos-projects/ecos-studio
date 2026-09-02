"""Compact, rerunnable artifacts for the RQ1 parameter-gap screen."""

from __future__ import annotations

import csv
import json
import platform
import resource
import time
from pathlib import Path
from typing import Any

from ecos_agent.optimization.contracts import TerminalObservation
from ecos_agent.optimization.experiments.gate0 import noise_profile
from ecos_agent.optimization.experiments.parameter_gap import (
    KnobGapSummary,
    ProbeResult,
)
from ecos_agent.optimization.experiments.parameter_gap_setup import overall_verdict


def build_report(
    run_id: str,
    started_at: str,
    readiness: dict[str, Any],
    baselines: tuple[TerminalObservation, ...],
    current: dict[str, bool | int | float],
    results: tuple[ProbeResult, ...],
    summaries: tuple[KnobGapSummary, ...],
) -> dict[str, Any]:
    return {
        "schema_version": "ecos.rq1_parameter_gap_report.v1",
        "run_id": run_id,
        "started_at": started_at,
        "completed_at": timestamp(),
        "verdict": overall_verdict(summaries),
        "research_scope": "rq1_testability_gate_only",
        "utility_claim": "not_assessed",
        "readiness": readiness,
        "baseline_noise": noise_profile(baselines),
        "baseline_observations": [item.model_dump(mode="json") for item in baselines],
        "current_values": dict(sorted(current.items())),
        "candidate_count": len(results),
        "terminal_closed_count": sum(item.terminal_closed for item in results),
        "knobs": [item.to_dict() for item in summaries],
    }


def write_outputs(
    run_root: Path, report: dict[str, Any], results: tuple[ProbeResult, ...]
) -> None:
    write_json(run_root / "gcd-gap-report.v1.json", report)
    fields = tuple(ProbeResult.__dataclass_fields__)
    with (run_root / "gcd-probes.v1.csv").open(
        "w", encoding="utf-8", newline=""
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for item in results:
            writer.writerow(item.to_dict())
    lines = [
        "# RQ1 gcd Parameter Gap Screen",
        "",
        f"- Verdict: `{report['verdict']}`",
        f"- Candidates: {report['candidate_count']}",
        f"- Terminal closed: {report['terminal_closed_count']}",
        "- Utility claim: `not_assessed`",
        "",
        "| Knob | Verdict | Confirmed gaps | Tested requests |",
        "|---|---|---|---:|",
    ]
    for item in report["knobs"]:
        lines.append(
            f"| `{item['knob_id']}` | `{item['verdict']}` | "
            f"{', '.join(item['confirmed_gap_kinds']) or '-'} | "
            f"{len(item['tested_requests'])} |"
        )
    (run_root / "gcd-gap-summary.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def peak_child_memory_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return float(
        usage / 1024 if platform.system() != "Darwin" else usage / 1024 / 1024
    )


def timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
