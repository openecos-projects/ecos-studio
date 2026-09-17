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
    OptimizationObjectiveProposal,
    ROUTABILITY_OBJECTIVE_ORDER,
    TerminalObservation,
    TIMING_GUARDRAIL_ORDER,
    TimingMetric,
)
from ecos_agent.optimization.experiments.equal_budget import (
    CandidateTrace,
    _evaluation_value,
    export_episode_traces,
    summarize_candidate_metrics,
)
from ecos_agent.optimization.experiments.baseline_provider import (
    BaselineProposalProvider,
)
from ecos_agent.optimization.experiments.baselines import BaselineMethod
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    DesignSpec,
    ExperimentManifest,
    _calibrate,
    _ensure_workspace,
    _filelist_refs,
)
from ecos_agent.optimization.experiments.knowledge_mediation import (
    EPISODE_AUDIT_SCHEMA_VERSION,
    audit_episode_mediation,
    missing_evidence_reason_counts,
    read_jsonl,
    summarize_episode_mediation,
)
from ecos_agent.optimization.experiments.knowledge_metrics import state_match_summary
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationPlanningAudit,
)
from ecos_agent.optimization.metrics.contracts import TELEMETRY_METRIC_IDS
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.objective_intent import OptimizationParameterPolicy
from ecos_agent.optimization.observation_contracts import deterministic_noise_profile
from ecos_agent.optimization.rules import freeze_optimization_objective
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

# 与 knowledge_treatment_runner._objective 的硬编码目标逐字一致；显式传
# --geometry-mode fixed 时不带 --goal-text 仍冻结出与该 runner 完全相同的
# objective contract。几何默认是 variable（打开 floorplan 旋钮），而该
# runner 冻结的是 fixed，跨这两条管线做对照时必须对齐口径。
_DEFAULT_GOAL_TEXT = (
    "Minimize routed wirelength while preserving DRC and global-routing overflow."
)
_DEFAULT_GEOMETRY_MODE = "variable"


def _episode_objective(goal_text: str, geometry_mode: str):
    return freeze_optimization_objective(
        goal_text,
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(
                ObjectiveMetric.DRC_COUNT,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            ),
            parameter_policy=OptimizationParameterPolicy(
                geometry_mode=geometry_mode
            ),
            rationale_summary=(
                "Minimize wirelength while preserving final DRC and "
                "global-routing overflow."
            ),
        ),
    )

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

    Keys span the full candidate comparison space: non-telemetry evaluation
    metrics (corner rows keep their own key), the routability objective trio,
    and the timing guardrail, so every candidate-vs-reference delta —
    overflow, power, area, frequency, WNS included — can be judged against a
    replay epsilon (the 20260908 overnight manifest misattributed
    cross-corner PVT spread as replay drift; see the erratum in
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
    context_path = calibration_dir / "noise-context.v1.json"
    fingerprint = None
    if context_path.is_file():
        try:
            fingerprint = json.loads(context_path.read_text(encoding="utf-8")).get(
                "fingerprint"
            )
        except (OSError, ValueError):
            fingerprint = None
    payload = {
        "schema_version": "ecos.noise_epsilon.v1",
        "comparison_key": "(metric_id, corner)",
        "noise_context_fingerprint": fingerprint,
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
        "epsilon": profile["epsilon"],
    }


def _build_mediation_audit(
    *,
    episode_root: Path,
    design_id: str,
    reference_observation: TerminalObservation,
    noise_epsilon: dict[str, object] | None,
) -> dict[str, object] | None:
    """Join the episode's persisted chains into one mediation audit artifact."""
    observation_path = episode_root / "optimization-proposal-observations.v1.jsonl"
    if not observation_path.is_file():
        return None
    ledger = OptimizationLedger(episode_root).replay()
    planning = OptimizationPlanningAudit(episode_root).replay()
    decisions = OptimizationDecisionAudit(episode_root).replay()
    epsilon = None
    if noise_epsilon:
        metric_epsilon = noise_epsilon.get("epsilon")
        if isinstance(metric_epsilon, dict):
            value = metric_epsilon.get(ObjectiveMetric.ROUTE_WIRELENGTH.value)
            if isinstance(value, (int, float)):
                epsilon = float(value)
    calls = audit_episode_mediation(
        design_id=design_id,
        planning_entries=planning.entries,
        proposal_rows=read_jsonl(observation_path),
        decision_rows=decisions.entries,
        starts=tuple(
            entry.payload
            for entry in ledger.entries
            if isinstance(entry.payload, OptimizationInterventionStart)
        ),
        outcomes={
            item.intervention_id: item for item in ledger.terminal_outcomes
        },
        reference_observation=reference_observation,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH.value,
        epsilon=epsilon,
    )
    return {
        "schema_version": EPISODE_AUDIT_SCHEMA_VERSION,
        "design_id": design_id,
        "objective_metric": ObjectiveMetric.ROUTE_WIRELENGTH.value,
        "calls": calls,
        "summary": summarize_episode_mediation(calls),
        "state_match": state_match_summary(calls),
        "missing_evidence_reason_counts": missing_evidence_reason_counts(calls),
    }


# Candidate-vs-reference comparison keys in episode summaries: metric key in
# the noise profile -> CandidateTrace column carrying the candidate value.
_COMPARISON_KEYS = (
    ("route_wirelength", "wirelength"),
    ("route_la_total_overflow", "congestion"),
    ("drc_count", "drc"),
    ("die_area", "die_area"),
    ("sta_standard_cell_area", "area"),
    ("sta_typical_dynamic_power", "dynamic_power"),
    ("sta_typical_leakage_power", "leakage_power"),
    ("sta_frequency", "frequency"),
    ("sta_setup_wns", "timing"),
    ("sta_hold_wns", "hold_wns"),
    ("gui_overall_qor_score", "qor_score"),
    ("place_hpwl", "place_hpwl"),
    ("total_clock_wirelength", "clock_wirelength"),
    ("interconnect_inflation_total", "interconnect_inflation"),
    ("qor_timing_quality", "qor_timing"),
    ("qor_interconnect_quality", "qor_interconnect"),
    ("qor_area_quality", "qor_area"),
    ("qor_power_quality", "qor_power"),
    ("qor_robustness_quality", "qor_robustness"),
    ("qor_summary_balanced", "qor_summary"),
)


def build_metric_comparison(
    reference: TerminalObservation,
    traces: tuple[CandidateTrace, ...],
    epsilon: dict[str, float],
) -> dict[str, object]:
    """Free-run-style comparison table: calibration replay reference vs best
    candidate.

    The best candidate is the terminal-success candidate with the highest
    frozen objective utility. ``beyond_noise`` is None where the key has no
    replay epsilon or the candidate value is missing.
    """
    routability_keys = {metric.value for metric in ROUTABILITY_OBJECTIVE_ORDER}
    guardrail_keys = {metric.value for metric in TIMING_GUARDRAIL_ORDER}

    def reference_value(key: str) -> float | None:
        if key in routability_keys:
            return float(reference.metrics[ObjectiveMetric(key)])
        if key in guardrail_keys:
            return float(reference.timing_guardrail[TimingMetric(key)])
        return _evaluation_value(reference.evaluation_metrics, key)

    started = [
        trace
        for trace in traces
        if trace.terminal_success and trace.terminal_utility is not None
    ]
    best = max(started, key=lambda trace: trace.terminal_utility, default=None)
    rows: dict[str, object] = {}
    for key, column in _COMPARISON_KEYS:
        base = reference_value(key)
        best_value = getattr(best, column) if best is not None else None
        delta = (
            best_value - base
            if best_value is not None and base is not None
            else None
        )
        rows[key] = {
            "reference": base,
            "best": best_value,
            "delta": delta,
            "epsilon": epsilon.get(key),
            "beyond_noise": (
                abs(delta) > epsilon[key]
                if delta is not None and key in epsilon
                else None
            ),
        }
    return {
        "best_candidate_id": best.candidate_id if best is not None else None,
        "metrics": rows,
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


def write_episode_reports(
    design_report_root: Path,
    summary: dict[str, object],
    mediation: dict[str, object] | None,
) -> Path:
    """Persist episode-scoped reports under reports/<design>/<episode-id>/.

    The episode id comes from the summary itself so resume/re-export of one
    episode can never overwrite a different episode's artifacts.
    """
    episode_id = str(summary["episode_id"])
    episode_output = design_report_root / episode_id
    episode_output.mkdir(parents=True, exist_ok=True)
    (episode_output / "episode-summary.v1.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    if mediation is not None:
        (episode_output / "knowledge-mediation-audit.v1.json").write_text(
            json.dumps(mediation, indent=2, sort_keys=True, default=str) + "\n",
            encoding="utf-8",
        )
    return episode_output


def main(provider_factory: Callable[..., Any] | None) -> int:
    _self_check()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--model", default="glm-5.3-flash")
    parser.add_argument(
        "--reasoning-effort",
        default="medium",
        choices=("low", "medium", "high"),
        help="optimization planner reasoning effort; applied by the shared "
        "runtime (create_optimization_runner), not by this driver",
    )
    parser.add_argument(
        "--goal-text",
        default=_DEFAULT_GOAL_TEXT,
        help="natural-language goal frozen into the objective contract "
        "(hashed as source_goal_sha256)",
    )
    parser.add_argument(
        "--geometry-mode",
        choices=("fixed", "variable"),
        default=_DEFAULT_GEOMETRY_MODE,
        help="floorplan knob domain; variable (default) opens the two "
        "floorplan knobs, fixed pins the outline and matches the "
        "knowledge_treatment_runner freeze",
    )
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--agent-mode", default="full_agent")
    parser.add_argument(
        "--baseline-method",
        choices=tuple(method.value for method in BaselineMethod),
        default=None,
        help="drive the episode with a deterministic baseline policy instead "
        "of the LLM provider (Agent-necessity arm); same execution contract",
    )
    parser.add_argument(
        "--planning-evidence",
        choices=("receipt-aware", "requested-only"),
        default="receipt-aware",
        help="RQ1 system-level arm: requested-only also drops the "
        "effective-receipt promotion gate (D1 ablation)",
    )
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
    reference, reference_runtime, _calibration_epsilon = _calibrate(
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
    # Episode-scoped reports live in their own directory so a second episode
    # of the same design can never overwrite the first one's summary
    # (glm4→glm8→glm9 overwrote each other three times under the old layout).
    episode_output = output / episode_id
    episode_output.mkdir(parents=True, exist_ok=True)

    if args.baseline_method:
        provider = BaselineProposalProvider(
            args.baseline_method, design_id=args.design, seed=args.seed
        )
    elif provider_factory is not None:
        provider = provider_factory(
            cwd=workspace,
            env=dict(os.environ),
            runtime_workspace_roots=(workspace,),
            diagnostics_path=episode_output / "codex-diagnostics.jsonl",
            ephemeral=True,
        )
    else:
        raise SystemExit(
            "either --baseline-method or an LLM provider factory is required"
        )
    try:
        model = args.model
        if args.baseline_method:
            model = None
        else:
            # reasoning effort is applied by create_optimization_runner from
            # the runtime context below, shared with the GUI episode path
            provider.select_model(model)
        objective = _episode_objective(args.goal_text, args.geometry_mode)
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
            "receipt_aware_planning": args.planning_evidence == "receipt-aware",
            "trend_noise_epsilon": (
                noise_epsilon["epsilon"] if noise_epsilon else None
            ),
            "agent_mode": args.agent_mode,
            "knowledge_case_shots": 0,
            "planner_reasoning_effort": args.reasoning_effort,
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
    metric_comparison = build_metric_comparison(
        reference,
        traces,
        noise_epsilon["epsilon"] if noise_epsilon else {},
    )
    candidate_metrics = summarize_candidate_metrics(traces, mode=observed_mode)
    case_replay = EmpiricalCaseAuditStore(episode_root).verify()
    mediation = _build_mediation_audit(
        episode_root=episode_root,
        design_id=args.design,
        reference_observation=canonical,
        noise_epsilon=noise_epsilon,
    )
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
        "planning_evidence": args.planning_evidence,
        "planner_policy": (
            f"baseline:{args.baseline_method}"
            if args.baseline_method
            else "llm"
        ),
        "model": model,
        "seed": args.seed,
        "reference_runtime_seconds": reference_runtime,
        "noise_epsilon": noise_epsilon,
        "metric_comparison": metric_comparison,
        "candidate_metrics": candidate_metrics,
        "planning_calls": planning_calls,
        "started_candidates": started_candidates,
        "terminal_artifacts_complete": started_candidates
        == budget_snapshot["consumed_candidates"],
        "budget": budget_snapshot,
        "traces": [item.__dict__ for item in traces],
        "case_selections": len(case_replay.selections),
        "knowledge_mediation": mediation,
        "episode_state": json.loads(
            state_files[-1].read_text("utf-8")
        ),
    }
    write_episode_reports(output, summary, mediation)
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
