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
import time
from pathlib import Path
from typing import Any, Callable

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationEpisodeState,
    TerminalObservation,
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
from ecos_agent.optimization.metrics.contracts import TELEMETRY_METRIC_IDS
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.observation_contracts import deterministic_noise_profile
from ecos_agent.optimization.runtime import create_optimization_runner

# 频率取各设计 SDC 的原始约束 100 MHz：ECC cf5db256 起 refresh_generated_sdc 会把
# 带 "# Auto-generated SDC file" 标记的 SDC 改写为 frequency_max 参数值，基线必须
# 与 SDC 一致，否则 workspace.create 后 origin SDC 哈希校验必然失配。
BASELINE: dict[str, object] = {
    "frequency_mhz": 100,
    "max_fanout": 32,
    "core_utilization": 0.3,
    "core_aspect_ratio": 1.0,
    "target_density": 0.45,
    "target_overflow": 0.1,
    "cell_padding_sites": 2,
    "routability_opt": True,
    # ECC workspace.create 的实际默认（dreamplace_ecc.json 实测）；不是参数卡参考值。
    "density_weight": 0.00085,
}

# 顶层模块名与设计 id 不同的设计（对照 rtl/ 源码与 defined-not-instantiated 分析核实），
# 其余默认 design_id。stage_d_* 系列取编号同名模块；24090015 的 RTL 无单一顶层，
# 取首个顶层候选，预期该设计失败。
TOP_MODULE = {
    "cordic": "CORDIC",
    "ov7670": "top",
    "aes": "aes_cipher_top",
    "dcpu": "dcpu16_cpu",
    "fft": "FFT",
    "qmcore": "ysyx_core1",
    "rle": "RLE",
    "vm80": "vm80_wb",
    "ysyx_210101": "ysyx_210101",
    "stage_d_ysyx_24080018": "ysyx_24080018",
    "stage_d_ysyx_24090003": "ysyx_24090003",
    "stage_d_ysyx_24090010": "ysyx_24090010_exu",
    "stage_d_ysyx_24090015": "ysyx_24090015_csr_addr_mux",
    "stage_d_ysyx_25010003": "ysyx_25010003",
    "stage_d_ysyx_25010009": "ysyx_25010009",
    "stage_d_ysyx_25010028": "ysyx_25010028",
    "stage_d_ysyx_25020039": "ysyx_25020039",
    "stage_d_ysyx_25020042": "ysyx_25020042",
    "stage_d_ysyx_25070194": "ysyx_25070194",
    "stage_d_ysyx_25070198": "ysyx_25070198",
    "stage_d_ysyx_25080201": "ysyx_25080201",
    "stage_d_ysyx_25080202": "ysyx_25080202",
    "stage_d_ysyx_25080207": "ysyx_25080207",
}

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
        _RUN_ID.fullmatch(item) for item in TOP_MODULE
    ), "top-module override keys must be valid design ids"


def _clock_from_sdc(sdc: Path) -> str:
    for line in sdc.read_text(encoding="utf-8").splitlines():
        match = re.match(r"\s*set\s+clk_port_name\s+(\S+)", line)
        if match:
            return match.group(1)
    raise SystemExit(f"SDC has no clk_port_name: {sdc}")


def write_noise_epsilon(calibration_dir: Path) -> dict[str, object]:
    """Code-computed replay noise for the calibration replays.

    Keys are (metric_id, corner) pairs and telemetry metrics are excluded, so
    cross-corner PVT spread is never reported as replay drift (the 20260908
    overnight manifest misattributed exactly that; see the erratum in
    docs/overnight-report-20260908.md).
    """
    observation_paths = sorted(
        calibration_dir.glob("default-replay-*/terminal-observation.v1.json")
    )
    if len(observation_paths) < 2:
        raise SystemExit(
            f"noise epsilon needs at least two replays under {calibration_dir}"
        )
    observations = [
        TerminalObservation.model_validate_json(path.read_bytes())
        for path in observation_paths
    ]
    profile = deterministic_noise_profile(observations)
    nonzero_epsilon_keys = sorted(
        key for key, value in profile["epsilon"].items() if value > 0
    )
    payload = {
        "schema_version": "ecos.noise_epsilon.v1",
        "comparison_key": "(metric_id, corner)",
        "telemetry_excluded_metric_ids": sorted(TELEMETRY_METRIC_IDS),
        "replay_count": len(observations),
        "reference": profile["reference"],
        "epsilon": profile["epsilon"],
        "nonzero_epsilon_keys": nonzero_epsilon_keys,
    }
    artifact = calibration_dir / "noise-epsilon.v1.json"
    artifact.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return {
        "artifact": str(artifact),
        "replay_count": len(observations),
        "metric_key_count": len(profile["epsilon"]),
        "drifting_metric_keys": nonzero_epsilon_keys,
    }


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
        top_module=TOP_MODULE.get(design_id, design_id),
        clock_name=_clock_from_sdc(sdc),
        filelist=filelist.resolve(),
        rtl_list=rtl,
        sdc=sdc.resolve(),
    )


def main(provider_factory: Callable[..., Any]) -> int:
    _self_check()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", required=True)
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
    parser.add_argument(
        "--calibration-replays",
        type=int,
        default=3,
        help="default replay count for calibration; 1 skips the noise-epsilon artifact",
    )
    parser.add_argument("--episode-id", default=None)  # 同 id 重启 = resume
    args = parser.parse_args()
    if not _RUN_ID.fullmatch(args.design):
        raise SystemExit(f"design id is invalid: {args.design}")

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
        replays=args.calibration_replays,
    )
    noise_epsilon = (
        write_noise_epsilon(output / "calibration")
        if args.calibration_replays >= 2
        else None
    )
    print(
        f"[driver] calibration done: reference_runtime={reference_runtime:.1f}s "
        + (
            f"noise_epsilon_drifting_keys={len(noise_epsilon['drifting_metric_keys'])}"
            if noise_epsilon
            else "noise_epsilon=skipped"
        ),
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

    provider = provider_factory(
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
        # alignment 必须锚定 workspace 本体（canonical）观测：runner 启动时用
        # build_terminal_observation(workspace) 重建 alignment 并做整对象比较，而
        # terminal observation 含 flow_tool_runtime/flow_peak_memory 等易变遥测，
        # 用 replay clone 的观测构建必然失配。reference 只用于墙钟预算（22x 中位数）。
        runtime_context = {
            "workspace": str(workspace),
            "episode_id": episode_id,
            "objective": objective.model_dump(mode="json"),
            "objective_alignment": build_objective_alignment(
                objective, canonical
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
    state_files = sorted(episode_root.glob("optimization-episode-state.v*.json"))
    if not state_files:
        raise SystemExit(f"episode state file missing under {episode_root}")
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
        "noise_epsilon": noise_epsilon,
        "planning_calls": planning_calls,
        "started_candidates": started_candidates,
        "terminal_artifacts_complete": started_candidates
        == budget_snapshot["consumed_candidates"],
        "budget": budget_snapshot,
        "traces": [item.__dict__ for item in traces],
        "case_selections": len(case_replay.selections),
        "episode_state": json.loads(
            state_files[-1].read_text("utf-8")
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
