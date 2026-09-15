#!/usr/bin/env python3
"""Build the default-baseline summary table from a baseline run root.

Read-only: consumes flow-screen results, workspace flow evidence, frozen noise
epsilons, and per-replay terminal observations.  Emits one row per design x
run (canonical screen + every default replay) as CSV plus a design-level
Markdown summary.  No ECC or LLM is involved.

``scripts/build_baseline_summary.py`` is the thin CLI entry point.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from ecos_agent.optimization.observations import build_terminal_observation

_METRIC_COLUMNS = (
    "route_wirelength",
    "route_la_total_overflow",
    "route_dr_total_violation_count",
)
_TIMING_COLUMNS = (
    "sta_setup_wns",
    "sta_setup_tns",
    "sta_hold_wns",
    "sta_hold_tns",
)
_EVALUATION_COLUMNS = (
    "die_area",
    "core_area",
    "sta_standard_cell_area",
    "synthesis_cell_area",
    "sta_typical_dynamic_power",
    "sta_typical_leakage_power",
    "sta_worst_dynamic_power",
    "sta_worst_leakage_power",
    "sta_internal_power",
    "sta_switching_power",
    "sta_dynamic_power",
    "sta_leakage_power",
    "drc_count",
    "lvs_count",
    "flow_tool_runtime",
    "flow_peak_memory",
)
_GATE_COLUMNS = ("drc_clean", "lvs_clean", "sta_setup_closed", "sta_hold_closed")


def _evaluation_values(observation) -> dict[str, float]:
    # Corner-family metrics repeat per corner; keep the first (typical) value.
    values: dict[str, float] = {}
    for metric in observation.evaluation_metrics:
        values.setdefault(metric.metric_id, metric.value)
    return values


def _row(design_id: str, run: str, observation, epsilon_present: bool) -> dict:
    evaluation = _evaluation_values(observation)
    gates = {
        name: getattr(observation.signoff_gates, name).value
        for name in _GATE_COLUMNS
    }
    eligible = bool(
        observation.evidence_valid
        and observation.harden_artifacts_complete
        and epsilon_present
    )
    return {
        "design": design_id,
        "run": run,
        "evidence_valid": observation.evidence_valid,
        "harden_artifacts_complete": observation.harden_artifacts_complete,
        "epsilon_present": epsilon_present,
        # Baseline-anchor eligibility: complete signoff-eligible evidence with
        # a frozen noise profile.  Signoff gate states are reported separately
        # in their own columns and do not gate eligibility.
        "eligible": eligible,
        **{column: observation.metrics.get(column) for column in _METRIC_COLUMNS},
        **{column: observation.timing_guardrail.get(column) for column in _TIMING_COLUMNS},
        **{column: evaluation.get(column) for column in _EVALUATION_COLUMNS},
        **gates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs", nargs="+", required=True)
    parser.add_argument("--replays", type=int, default=3)
    args = parser.parse_args()
    run_root = args.run_root.resolve()

    rows = []
    for design_id in args.designs:
        workspace = run_root / "workspaces" / design_id
        calibration_root = workspace / ".agent" / "optimization"
        epsilon_present = (calibration_root / "noise-epsilon.v1.json").is_file()
        try:
            canonical_observation = build_terminal_observation(workspace)
        except Exception as exc:  # noqa: BLE001 - failed designs stay in the table
            rows.append(
                {
                    "design": design_id,
                    "run": "canonical",
                    "evidence_valid": False,
                    "harden_artifacts_complete": False,
                    "epsilon_present": epsilon_present,
                    "eligible": False,
                    "error": f"{type(exc).__name__}: {exc}"[:200],
                    **{column: "" for column in _METRIC_COLUMNS},
                    **{column: "" for column in _TIMING_COLUMNS},
                    **{column: "" for column in _EVALUATION_COLUMNS},
                    **{column: "" for column in _GATE_COLUMNS},
                }
            )
            canonical_observation = None
        else:
            rows.append(
                _row(design_id, "canonical", canonical_observation, epsilon_present)
            )
        for replay in range(1, args.replays + 1):
            observation_path = (
                calibration_root
                / "noise-calibration" / f"default-replay-{replay}"
                / "terminal-observation.v1.json"
            )
            if not observation_path.is_file():
                rows.append(
                    {
                        "design": design_id,
                        "run": f"replay-{replay}",
                        "evidence_valid": False,
                        "harden_artifacts_complete": False,
                        "epsilon_present": epsilon_present,
                        "eligible": False,
                        **{column: "" for column in _METRIC_COLUMNS},
                        **{column: "" for column in _TIMING_COLUMNS},
                        **{column: "" for column in _EVALUATION_COLUMNS},
                        **{column: "" for column in _GATE_COLUMNS},
                    }
                )
                continue
            observation = type(canonical_observation).model_validate_json(
                observation_path.read_bytes()
            )
            rows.append(
                _row(design_id, f"replay-{replay}", observation, epsilon_present)
            )

    columns = list(dict.fromkeys(key for row in rows for key in row.keys()))
    out_csv = run_root / "baseline-summary.csv"
    with out_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# Baseline summary: ten-design default flow + replay noise",
        "",
        "Treatment-independent Default-ECOS anchor. `canonical` = the one",
        "screen run per design; `replay-N` = default-parameter calibration",
        "replays. Runtime/memory columns are the flow evidence totals",
        "(flow_tool_runtime, flow_peak_memory).",
        "",
    ]
    numeric = _METRIC_COLUMNS + _TIMING_COLUMNS + (
        "die_area",
        "sta_typical_dynamic_power",
        "sta_worst_leakage_power",
        "flow_tool_runtime",
        "flow_peak_memory",
    )
    for design_id in args.designs:
        design_rows = [row for row in rows if row["design"] == design_id]
        canonical = design_rows[0]
        if canonical.get("error"):
            lines.append(f"## {design_id}")
            lines.append("")
            lines.append(
                f"Canonical observation unavailable: {canonical['error']}"
            )
            lines.append("")
            continue
        lines.append(f"## {design_id}")
        lines.append("")
        header = "| run | " + " | ".join(numeric) + " |"
        split = "|---" * (len(numeric) + 1) + "|"
        lines += [header, split]
        for row in design_rows:
            cells = [
                str(row[column]) if row[column] != "" else "-"
                for column in numeric
            ]
            lines.append(f"| {row['run']} | " + " | ".join(cells) + " |")
        lines.append("")
        gates = {name: canonical[name] for name in _GATE_COLUMNS}
        lines.append(
            f"Signoff gates (canonical): {gates}; "
            f"evidence_valid={canonical['evidence_valid']}, "
            f"harden_complete={canonical['harden_artifacts_complete']}, "
            f"epsilon={canonical['epsilon_present']}."
        )
        lines.append("")
    out_md = run_root / "baseline-summary.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"[baseline] {len(rows)} rows -> {out_csv.name}, {out_md.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
