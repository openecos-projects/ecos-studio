#!/usr/bin/env python3
"""Run one headless receipt-aware closed-loop optimization episode on a design.

Overnight driver (docs/overnight-plan-20260908.md). Reuses the Phase-8
treatment harness building blocks; budget is enforced by the frozen
EpisodeBudget contract (20 candidates / 60 planning calls / 22x wall time),
not by this script.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationEpisodeState,
)
from ecos_agent.optimization.experiments.equal_budget import export_episode_traces
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    DesignSpec,
    ExperimentManifest,
    _calibrate,
    _ensure_workspace,
    _filelist_refs,
)
from ecos_agent.optimization.experiments.knowledge_treatment_runner import _objective
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.runtime import create_optimization_runner

# GUI 生产默认（experiments/projects/ws_0001/home/params.toml 实测）。
BASELINE: dict[str, object] = {
    "frequency_mhz": 50,
    "max_fanout": 32,
    "core_utilization": 0.3,
    "core_aspect_ratio": 1.0,
    "target_density": 0.45,
    "target_overflow": 0.1,
    "cell_padding_sites": 2,
    "routability_opt": True,
    "density_weight": 0.0005,
}

# 时钟端口名来自各设计 SDC（已核实：gcd=clk，cia=E_CLK）。
CLOCK = {"gcd": "clk", "cia": "E_CLK"}

_ACTIVE = {
    OptimizationEpisodeState.CREATED,
    OptimizationEpisodeState.PLANNING,
    OptimizationEpisodeState.AWAITING_EXECUTION,
    OptimizationEpisodeState.EXECUTING,
}

_RUN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")


def _self_check() -> None:
    assert set(BASELINE) == {
        "frequency_mhz",
        "max_fanout",
        "core_utilization",
        "core_aspect_ratio",
        "target_density",
        "target_overflow",
        "cell_padding_sites",
        "routability_opt",
        "density_weight",
    }, "baseline keys must match the Phase-8 frozen nine-key set"
    assert type(BASELINE["routability_opt"]) is bool
    assert all(
        _RUN_ID.fullmatch(CLOCK[design]) is None or True for design in CLOCK
    )


def load_design(designs_root: Path, design_id: str) -> DesignSpec:
    root = designs_root / design_id
    filelist = root / "filelist.f"
    sdc = root / f"{design_id}.sdc"
    refs = _filelist_refs(filelist)
    rtl = tuple((filelist.parent / ref).resolve() for ref in refs)
    for path in (filelist, sdc, *rtl):
        if not path.is_file():
            raise SystemExit(f"missing design input: {path}")
    return DesignSpec(
        design_id=design_id,
        top_module=design_id,
        clock_name=CLOCK[design_id],
        filelist=filelist.resolve(),
        rtl_list=rtl,
        sdc=sdc.resolve(),
    )


def main() -> int:
    _self_check()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", required=True, choices=("gcd", "cia"))
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument(
        "--reasoning-effort", default=None, choices=("low", "medium", "high")
    )
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--agent-mode", default="full_agent")
    parser.add_argument("--terminal-timeout-seconds", type=float, default=1800.0)
    parser.add_argument("--episode-id", default=None)  # 同 id 重启 = resume
    args = parser.parse_args()

    design = load_design(args.designs_root.resolve(), args.design)
    manifest = ExperimentManifest(
        manifest_sha256=canonical_sha256(
            {"baseline": BASELINE, "design": args.design, "pdk": "ics55"}
        ),
        designs=(design,),
        baseline=dict(BASELINE),
        pdk_name="ics55",
        pdk_root=args.pdk_root.resolve(),
    )
    run_root = args.run_root.resolve()
    workspace = run_root / "workspaces" / args.design
    output = run_root / "reports" / args.design
    output.mkdir(parents=True, exist_ok=True)
    (output / "effective-manifest.json").write_text(
        json.dumps(
            {
                "baseline": BASELINE,
                "design": {
                    "design_id": design.design_id,
                    "top_module": design.top_module,
                    "clock": design.clock_name,
                    "rtl": [str(p) for p in design.rtl_list],
                    "sdc": str(design.sdc),
                    "filelist": str(design.filelist),
                },
                "pdk_root": str(manifest.pdk_root),
                "manifest_sha256": manifest.manifest_sha256,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    canonical = _ensure_workspace(
        manifest, design, workspace, args.terminal_timeout_seconds
    )
    reference, reference_runtime = _calibrate(
        manifest,
        design,
        workspace,
        canonical,
        output / "calibration",
        args.terminal_timeout_seconds,
    )
    print(
        f"[driver] calibration done: reference_runtime={reference_runtime:.1f}s",
        flush=True,
    )

    episode_id = args.episode_id or (
        f"closeloop-{time.strftime('%Y%m%dT%H%M%S', time.gmtime())}-{args.design}"
    )
    if not _RUN_ID.fullmatch(episode_id):
        raise SystemExit(f"episode id is invalid: {episode_id}")
    episode_root = workspace / ".agent" / "optimization" / episode_id
    if episode_root.exists() and args.episode_id is None:
        raise SystemExit(
            f"episode already exists: {episode_id}; pass --episode-id to resume"
        )

    provider = CodexAppServerProposalProvider(
        cwd=workspace,
        env=dict(os.environ),
        runtime_workspace_roots=(workspace,),
        diagnostics_path=output / "codex-diagnostics.jsonl",
        ephemeral=True,
    )
    try:
        model = args.model
        if args.reasoning_effort:
            # set_model_settings 内部会先 select_model 再校验 effort 合法性
            provider.set_model_settings(
                model=model, reasoning_effort=args.reasoning_effort
            )
        else:
            provider.select_model(model)
        objective = _objective()
        runtime_context = {
            "workspace": str(workspace),
            "episode_id": episode_id,
            "objective": objective.model_dump(mode="json"),
            "objective_alignment": build_objective_alignment(
                objective, reference
            ).model_dump(mode="json"),
            "seed": args.seed,
            "reference_runtime_seconds": reference_runtime,
            "receipt_aware_planning": True,
            "agent_mode": args.agent_mode,
            "knowledge_case_shots": 0,
        }
        runner = create_optimization_runner(runtime_context, provider)
        try:
            while runner.state in _ACTIVE:
                runner.run_turn()
            budget_snapshot = {
                "consumed_candidates": runner.budget.consumed_candidates,
                "consumed_planning_calls": runner.budget.consumed_planning_calls,
                "elapsed_wall_time_seconds": runner.budget.elapsed_wall_time_seconds,
                "final_state": str(runner.state),
            }
        finally:
            runner.close()
    finally:
        provider.close()

    traces, planning_calls, observed_mode = export_episode_traces(
        workspace=workspace,
        episode_root=episode_root,
        design_id=args.design,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
    )
    case_replay = EmpiricalCaseAuditStore(episode_root).verify()
    started_candidates = sum(item.started for item in traces)
    summary = {
        "schema_version": "ecos.overnight_episode_summary.v1",
        "evidence_class": "engineering_pilot",
        "utility_claim": "not_assessed",
        "design_id": args.design,
        "episode_id": episode_id,
        "agent_mode": args.agent_mode,
        "model": model,
        "seed": args.seed,
        "reference_runtime_seconds": reference_runtime,
        "planning_calls": planning_calls,
        "started_candidates": started_candidates,
        "terminal_artifacts_complete": started_candidates
        == budget_snapshot["consumed_candidates"],
        "budget": budget_snapshot,
        "traces": [item.__dict__ for item in traces],
        "case_selections": len(case_replay.selections),
        "episode_state": json.loads(
            (episode_root / "optimization-episode-state.v9.json").read_text("utf-8")
        ),
    }
    (output / "episode-summary.v1.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                key: summary[key]
                for key in (
                    "design_id",
                    "episode_id",
                    "planning_calls",
                    "started_candidates",
                    "terminal_artifacts_complete",
                    "budget",
                )
            },
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
