"""Finalize the six-design functional smoke from existing audited episodes."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import statistics
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import ObjectiveMetric, TerminalObservation
from ecos_agent.optimization_equal_budget import Mode, export_episode_traces

FUNCTIONAL_SMOKE_DESIGN_IDS = ("gcd", "i2c", "cia", "zipdiv", "cordic", "xtea")


def _load_experiment_runner():
    path = Path(__file__).with_name("run_equal_budget_experiment.py")
    spec = importlib.util.spec_from_file_location("phase8_experiment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Phase 8 experiment runner is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


experiment = _load_experiment_runner()


def finalize_functional_smoke(
    manifest: experiment.ExperimentManifest,
    manifest_path: Path,
    output: Path,
    workspace_root: Path,
    *,
    run_id: str,
    seed: int,
    tool_revision: str,
    model: str = "gpt-5.6-sol",
) -> dict[str, object]:
    """Rebuild compact reports without starting EDA work."""
    designs = tuple(
        design
        for design in manifest.designs
        if design.design_id in FUNCTIONAL_SMOKE_DESIGN_IDS
    )
    if tuple(design.design_id for design in designs) != FUNCTIONAL_SMOKE_DESIGN_IDS:
        raise ValueError(
            "Phase 8 functional smoke designs do not match the frozen manifest"
        )
    output = Path(output).resolve()
    workspace_root = Path(workspace_root).resolve()
    run_root = output / "runs" / run_id
    if not run_root.is_dir():
        raise ValueError("Phase 8 functional smoke run is unavailable")

    runtimes: dict[str, float] = {}
    mode_rows = {"requested-only": [], "receipt-aware": []}
    planning_calls = {"requested-only": 0, "receipt-aware": 0}
    elapsed: dict[str, dict[str, float]] = {
        "requested_only": {},
        "receipt_aware": {},
    }
    for design in designs:
        workspace = workspace_root / design.design_id
        experiment._verify_workspace_binding(manifest, design, workspace)
        reference, runtime = _load_existing_calibration(
            run_root / design.design_id / "calibration"
        )
        runtimes[design.design_id] = runtime
        for mode in mode_rows:
            exported = _export_existing_mode(
                workspace=workspace,
                run_root=run_root,
                run_id=run_id,
                design_id=design.design_id,
                mode=mode,
                reference=reference,
            )
            mode_rows[mode].extend(exported["traces"])
            planning_calls[mode] += exported["planning_calls"]
            elapsed[mode.replace("-", "_")][design.design_id] = exported[
                "elapsed_wall_time_seconds"
            ]

    inputs = {}
    for mode, rows in mode_rows.items():
        path = run_root / f"{mode}-input.jsonl"
        path.write_text(
            "".join(json.dumps(item.__dict__, sort_keys=True) + "\n" for item in rows),
            encoding="utf-8",
        )
        inputs[mode] = path
    report = experiment._load_harness().run(
        Path(manifest_path),
        output,
        inputs["requested-only"],
        inputs["receipt-aware"],
        planning_calls["requested-only"],
        planning_calls["receipt-aware"],
        reference_runtime_seconds_by_design=runtimes,
        elapsed_wall_time_seconds_by_mode=elapsed,
        functional_smoke_design_ids=FUNCTIONAL_SMOKE_DESIGN_IDS,
        seed=seed,
        tool_revision=tool_revision,
        input_manifest_sha256=manifest.manifest_sha256,
    )
    if (
        report.get("engineering_status") != "completed"
        or report.get("research_evaluation_status") != "incomplete"
    ):
        raise ValueError("Phase 8 functional smoke evidence is incomplete")
    experiment._write_json(
        run_root / "run-manifest.v1.json",
        {
            "schema_version": "ecos.phase8_execution_run.v1",
            "run_id": run_id,
            "model": model,
            "seed": seed,
            "tool_revision": tool_revision,
            "input_manifest_sha256": manifest.manifest_sha256,
            "execution_design_ids": list(FUNCTIONAL_SMOKE_DESIGN_IDS),
            "ignored_knobs": ["place.routability_opt"],
            "reference_runtime_seconds_by_design": runtimes,
            "planning_calls": planning_calls,
            "elapsed_wall_time_seconds_by_mode": elapsed,
            "trace_sha256": {mode: file_sha256(path) for mode, path in inputs.items()},
            "engineering_status": report["engineering_status"],
            "research_evaluation_status": report["research_evaluation_status"],
            "finalized_from_existing": True,
        },
    )
    return report


def _load_existing_calibration(output: Path) -> tuple[TerminalObservation, float]:
    observations = []
    runtimes = []
    for index in range(1, experiment._DEFAULT_REPLAYS + 1):
        replay = output / f"default-replay-{index}"
        try:
            observation = TerminalObservation.model_validate_json(
                (replay / "terminal-observation.v1.json").read_bytes()
            )
            runtime = json.loads(
                (replay / "runtime.v1.json").read_text(encoding="utf-8")
            )["elapsed_seconds"]
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(
                "Phase 8 functional smoke calibration is unavailable"
            ) from exc
        if (
            observation.schema_version != "ecos.terminal_observation.v3"
            or not observation.evidence_valid
            or not observation.harden_artifacts_complete
            or not observation.evaluation_metrics_complete
            or not isinstance(runtime, (int, float))
            or isinstance(runtime, bool)
            or not math.isfinite(runtime)
            or runtime <= 0
        ):
            raise ValueError("Phase 8 functional smoke calibration is invalid")
        observations.append(observation)
        runtimes.append(float(runtime))
    return observations[0], statistics.median(runtimes)


def _export_existing_mode(
    *,
    workspace: Path,
    run_root: Path,
    run_id: str,
    design_id: str,
    mode: Mode,
    reference: TerminalObservation,
) -> dict[str, object]:
    episode_id = f"phase8-{run_id}-{design_id}-{mode}"
    episode_root = workspace / ".agent" / "optimization" / episode_id
    traces, planning_calls, observed_mode = export_episode_traces(
        workspace=workspace,
        episode_root=episode_root,
        design_id=design_id,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
    )
    summary = experiment._workspace_json(run_root / design_id / mode, "summary.v1.json")
    started = sum(item.started for item in traces)
    trace_sha256 = canonical_sha256([item.__dict__ for item in traces])
    if (
        observed_mode != mode
        or summary.get("episode_id") != episode_id
        or summary.get("planning_calls") != planning_calls
        or summary.get("started_candidates") != started
        or summary.get("trace_sha256") != trace_sha256
    ):
        raise ValueError("Phase 8 functional smoke summary does not match its episode")
    elapsed, consumed_candidates, consumed_planning = _episode_budget(episode_root)
    if consumed_candidates != started or consumed_planning != planning_calls:
        raise ValueError("Phase 8 functional smoke budget does not match its episode")
    return {
        "traces": traces,
        "planning_calls": planning_calls,
        "elapsed_wall_time_seconds": elapsed,
    }


def _episode_budget(episode_root: Path) -> tuple[float, int, int]:
    try:
        payload = json.loads(
            (episode_root / "optimization-episode-state.v6.json").read_text(
                encoding="utf-8"
            )
        )
        state_sha256 = payload.pop("state_sha256")
        budget = payload["budget"]
        values = (
            budget["elapsed_wall_time_seconds"],
            budget["consumed_candidates"],
            budget["consumed_planning_calls"],
        )
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(
            "Phase 8 functional smoke episode state is unavailable"
        ) from exc
    if state_sha256 != canonical_sha256(payload):
        raise ValueError("Phase 8 functional smoke episode state hash does not match")
    elapsed, candidates, planning = values
    if (
        not isinstance(elapsed, (int, float))
        or isinstance(elapsed, bool)
        or not math.isfinite(elapsed)
        or elapsed < 0
        or type(candidates) is not int
        or candidates < 0
        or type(planning) is not int
        or planning < 0
    ):
        raise ValueError("Phase 8 functional smoke episode budget is invalid")
    return float(elapsed), candidates, planning


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--design-manifest", type=Path, required=True)
    parser.add_argument("--benchmark-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--seed", type=int, default=20260827)
    parser.add_argument("--tool-revision", required=True)
    args = parser.parse_args()
    manifest = experiment.load_experiment_manifest(
        args.design_manifest, args.benchmark_root, args.pdk_root
    )
    finalize_functional_smoke(
        manifest,
        args.design_manifest,
        args.output,
        args.workspace_root,
        run_id=args.run_id,
        model=args.model,
        seed=args.seed,
        tool_revision=args.tool_revision,
    )


if __name__ == "__main__":
    main()
