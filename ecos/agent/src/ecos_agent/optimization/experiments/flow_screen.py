"""Run the canonical physical-design flow once per design.

Screen-only driver: workspace.create + canonical Harden flow per design, no
calibration replays and no optimization episode. A design passes when all flow
steps report Success (an existing succeeded workspace short-circuits via
_ensure_workspace).
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.closed_loop_driver import BASELINE, load_design
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    ExperimentManifest,
    _ensure_workspace,
)


def _first_bad_stage(workspace: Path) -> str | None:
    flow_path = workspace / "home" / "flow.json"
    if not flow_path.is_file():
        return None
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    for step in flow.get("steps", []):
        if step.get("state") not in ("Success", "Unstart"):
            return f"{step['name']}/{step.get('state')}"
    return None


def screen_one(
    design_id: str, designs_root: Path, pdk_root: Path, run_root: Path, timeout: float
) -> dict:
    workspace = run_root / "workspaces" / design_id
    try:
        design = load_design(designs_root, design_id)
        manifest = ExperimentManifest(
            manifest_sha256=canonical_sha256(
                {"baseline": BASELINE, "design": design_id, "pdk": "ics55"}
            ),
            designs=(design,),
            baseline=dict(BASELINE),
            pdk_name="ics55",
            pdk_root=pdk_root,
        )
        observation = _ensure_workspace(manifest, design, workspace, timeout)
        return {
            "design_id": design_id,
            "result": "pass",
            "top_module": design.top_module,
            "clock": design.clock_name,
            "metrics": {metric.value: value for metric, value in observation.metrics.items()},
            "timing_guardrail": observation.timing_guardrail,
            "harden_artifacts_complete": observation.harden_artifacts_complete,
        }
    except Exception as exc:  # noqa: BLE001 - the screen records every failure
        return {
            "design_id": design_id,
            "result": "fail",
            "failed_stage": _first_bad_stage(workspace),
            "error": f"{type(exc).__name__}: {exc}"[:400],
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--designs", nargs="+", required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--max-workers", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=float, default=1800.0)
    args = parser.parse_args()

    designs_root = args.designs_root.resolve()
    pdk_root = args.pdk_root.resolve()
    run_root = args.run_root.resolve()
    results = []
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.max_workers) as pool:
        futures = {
            pool.submit(
                screen_one, design_id, designs_root, pdk_root, run_root, args.timeout_seconds
            ): design_id
            for design_id in args.designs
        }
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            note = f" ({row.get('failed_stage')})" if row["result"] == "fail" else ""
            print(f"[screen] {row['design_id']}: {row['result']}{note}", flush=True)
    results.sort(key=lambda row: row["design_id"])
    payload = {
        "schema_version": "ecos.flow_screen_results.v1",
        "evidence_class": "engineering_pilot",
        "utility_claim": "not_assessed",
        "scope": "canonical physical-design flow once per design; no calibration, no episode",
        "timeout_seconds": args.timeout_seconds,
        "elapsed_seconds": time.monotonic() - started,
        "designs": results,
    }
    out = run_root / "flow-screen-results.v1.json"
    out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    passed = sum(1 for row in results if row["result"] == "pass")
    print(f"[screen] {passed}/{len(results)} passed; results -> {out}", flush=True)
    return 0
