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
import statistics
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
from ecos_agent.optimization.experiments.direction_only_provider import (
    DirectionOnlyProposalProvider,
)
from ecos_agent.optimization.experiments.replay_provider import (
    replay_provider_and_runtime,
)
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    DesignSpec,
    ExperimentManifest,
    _ensure_workspace,
    _filelist_refs,
    _git_identity,
)
from ecos_agent.optimization.experiments.knowledge_mediation import (
    EPISODE_AUDIT_SCHEMA_VERSION,
    audit_episode_mediation,
    missing_evidence_reason_counts,
    read_jsonl,
    summarize_episode_mediation,
)
from ecos_agent.optimization.experiments.knowledge_metrics import (
    decision_level_endpoints,
    state_match_summary,
)
from ecos_agent.optimization.experiments.knowledge_treatments import (
    ZERO_SHOT_GATE_TREATMENTS,
)
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
from ecos_agent.optimization.planning_snapshots import configure_planning_snapshots
from ecos_agent.optimization.runtime import (
    _ecc_executable,
    create_optimization_runner,
    epsilon_artifact_path,
)

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

# wirelength 与 knowledge_treatment_runner._objective 逐字一致（同 goal 文本、
# 同 variable 几何）：默认调用（不带 --objective/--goal-text/--geometry-mode）
# 冻结出与该 runner 完全相同的 objective contract。overflow 是第二目标泛化
# 抽查臂：主/保护指标对调（primary=route_la_total_overflow，preserve=DRC+线
# 长），工具链、knob 面、预算与 candidate 终点 Harden 全部不变，只有 objective
# contract 不同。显式 --geometry-mode fixed 可钉死外框，对齐历史 fixed 批次的
# 口径。
_OBJECTIVES = {
    "wirelength": {
        "goal_text": (
            "Minimize routed wirelength while preserving DRC and "
            "global-routing overflow."
        ),
        "primary_metric": ObjectiveMetric.ROUTE_WIRELENGTH,
        "preserve_metrics": (
            ObjectiveMetric.DRC_COUNT,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
        ),
        "rationale_summary": (
            "Minimize wirelength while preserving final DRC and "
            "global-routing overflow."
        ),
    },
    "overflow": {
        "goal_text": (
            "Minimize global-routing overflow while preserving DRC and "
            "routed wirelength."
        ),
        "primary_metric": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
        "preserve_metrics": (
            ObjectiveMetric.DRC_COUNT,
            ObjectiveMetric.ROUTE_WIRELENGTH,
        ),
        "rationale_summary": (
            "Minimize global-routing overflow while preserving final DRC "
            "and routed wirelength."
        ),
    },
}
_DEFAULT_OBJECTIVE = "wirelength"
# 兼容旧引用（测试/文档）的 wirelength 默认口径。
_DEFAULT_GOAL_TEXT = _OBJECTIVES["wirelength"]["goal_text"]
_DEFAULT_GEOMETRY_MODE = "variable"


def _episode_objective(
    objective_name: str, goal_text: str, geometry_mode: str
):
    spec = _OBJECTIVES[objective_name]
    return freeze_optimization_objective(
        goal_text,
        OptimizationObjectiveProposal(
            primary_metric=spec["primary_metric"],
            preserve_metrics=spec["preserve_metrics"],
            parameter_policy=OptimizationParameterPolicy(
                geometry_mode=geometry_mode
            ),
            rationale_summary=spec["rationale_summary"],
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
    objective_metric: ObjectiveMetric,
    treatment: str = "closed_loop_episode",
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
            value = metric_epsilon.get(objective_metric.value)
            if isinstance(value, (int, float)):
                epsilon = float(value)
    proposal_rows = read_jsonl(observation_path)
    calls = audit_episode_mediation(
        design_id=design_id,
        planning_entries=planning.entries,
        proposal_rows=proposal_rows,
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
        objective_metric=objective_metric.value,
        epsilon=epsilon,
        treatment=treatment,
    )
    return {
        "schema_version": EPISODE_AUDIT_SCHEMA_VERSION,
        "design_id": design_id,
        "objective_metric": objective_metric.value,
        "treatment": treatment,
        "calls": calls,
        "summary": summarize_episode_mediation(calls),
        "state_match": state_match_summary(calls),
        "decision_level_endpoints": decision_level_endpoints(
            calls,
            proposal_rows,
            objective_metric=objective_metric.value,
        ),
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


def _episode_exit_code(final_state: str, complete: bool) -> int:
    return int(final_state == "quarantined" or not complete)


def _native_design_id(logical_design_id: str) -> str:
    """Use a slash-free short native identifier; retain the logical ID in reports."""
    return "d-" + canonical_sha256({"logical_design_id": logical_design_id})[7:19]


def _workspace_calibration(workspace: Path) -> tuple[float, dict[str, object]]:
    """Median seeded replay tool runtime plus the frozen noise epsilon.

    The replay runtime comes from each replay's own ``flow_tool_runtime``
    telemetry (calibrate_workspace replays carry no runtime artifact); it is
    the tool-reported duration, marginally tighter than the old wall-clock
    replay time and honest for the 22x budget.

    Batch preparation seeds ``.agent/optimization/noise-calibration/`` (two
    default replays behind replay-cache manifests) and
    ``noise-epsilon.v1.json`` in every per-attempt workspace. A missing or
    thin calibration fails closed here; the episode itself never replays.
    """
    calibration_root = workspace / ".agent" / "optimization" / "noise-calibration"
    replays = sorted(calibration_root.glob("default-replay-*/terminal-observation.v1.json"))
    runtimes = []
    for path in replays:
        metrics = {
            item["metric_id"]: item["value"]
            for item in json.loads(path.read_text(encoding="utf-8"))["evaluation_metrics"]
        }
        value = metrics.get("flow_tool_runtime")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise SystemExit(f"invalid flow_tool_runtime telemetry: {path}")
        runtimes.append(float(value))
    if len(runtimes) < 2:
        raise SystemExit(
            "workspace lacks the seeded default-replay calibration "
            f"(found {len(runtimes)} replays, need >= 2): {calibration_root}"
        )
    epsilon_path = epsilon_artifact_path(workspace)
    if not epsilon_path.is_file():
        raise SystemExit("workspace lacks the seeded noise-epsilon artifact")
    payload = json.loads(epsilon_path.read_text(encoding="utf-8"))
    epsilon = payload.get("epsilon")
    if (
        payload.get("schema_version") != "ecos.noise_epsilon.v1"
        or not isinstance(epsilon, dict)
        or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in epsilon.values())
    ):
        raise SystemExit("seeded noise-epsilon artifact is invalid")
    return statistics.median(runtimes), {
        "artifact": str(epsilon_path),
        "replay_count": payload.get("replay_count"),
        "epsilon": epsilon,
        "drifting_metric_keys": sorted(
            key for key, value in epsilon.items() if value > 0
        ),
    }


def _validate_treatment_combination(
    knowledge_treatment: str | None, planning_evidence: str,
) -> None:
    if knowledge_treatment is not None and planning_evidence != "receipt-aware":
        dual = "state-conditioned-dual-layer-zero-shot"
        if not (knowledge_treatment == dual and planning_evidence == "requested-only"):
            raise SystemExit(
                "RQ2 knowledge treatments require receipt-aware planning, except "
                "Dual zero-shot with requested-only RO"
            )


def _run_episode_with_cap(runner: Any, stop_after_started: int | None) -> None:
    """Stop only after a full turn absorbed its terminal feedback."""
    while runner.state in _ACTIVE:
        runner.run_turn()
        if (
            stop_after_started is not None
            and runner.budget.consumed_candidates >= stop_after_started
        ):
            runner.request_stop()
            # The second turn absorbs any in-flight terminal and prevents a
            # third start; the shared 20-start budget remains untouched.
            runner.run_turn()
            runner.finalize_stop()
            return


def main(provider_factory: Callable[..., Any] | None, argv: list[str] | None = None) -> int:
    _self_check()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--model", default="glm-5.3-flash")
    parser.add_argument(
        "--objective",
        choices=sorted(_OBJECTIVES),
        default=_DEFAULT_OBJECTIVE,
        help="frozen objective contract; 'overflow' is the second-objective "
        "generalization probe (primary route_la_total_overflow, DRC and "
        "routed wirelength preserved) on an otherwise identical contract: "
        "same toolchain, knob surface, budget, and Harden candidate endpoint",
    )
    parser.add_argument(
        "--reasoning-effort",
        default="medium",
        choices=("low", "medium", "high"),
        help="optimization planner reasoning effort; applied by the shared "
        "runtime (create_optimization_runner), not by this driver",
    )
    parser.add_argument(
        "--goal-text",
        default=None,
        help="natural-language goal frozen into the objective contract "
        "(hashed as source_goal_sha256); defaults to the canonical text of "
        "the selected --objective",
    )
    parser.add_argument(
        "--geometry-mode",
        choices=("fixed", "variable"),
        default=_DEFAULT_GEOMETRY_MODE,
        help="floorplan knob domain; variable (default) opens the two "
        "floorplan knobs and matches the knowledge_treatment_runner "
        "freeze, fixed pins the outline",
    )
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--agent-mode",
        default=None,
        help="controller agent mode; defaults to full_agent, or to the mode "
        "implied by --knowledge-treatment",
    )
    parser.add_argument(
        "--knowledge-treatment",
        default=None,
        choices=tuple(
            config.treatment.value for config in ZERO_SHOT_GATE_TREATMENTS
        ),
        help="RQ2 canonical treatment id; enters provider/context construction "
        "through the single runtime-context entry point and stamps the "
        "mediation audit and episode summary (never a shell prompt edit)",
    )
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
    parser.add_argument(
        "--value-policy",
        choices=("model", "lattice"),
        default="model",
        help="LLM-arm value policy: 'model' lets the planner pick the exact "
        "probe value; 'lattice' keeps the planner's (knob, direction) but "
        "rewrites the value through the frozen lattice selector, the same "
        "value mechanism as the deterministic baselines (direction-only "
        "ablation arm)",
    )
    parser.add_argument(
        "--replay-proposals",
        type=Path,
        default=None,
        help="shadow-duplicate arm: JSON list of stored proposal specs; the "
        "episode replays them verbatim instead of calling a model, so any "
        "terminal delta versus the source episode is machine/load drift",
    )
    parser.add_argument("--terminal-timeout-seconds", type=float, default=1800.0)
    parser.add_argument(
        "--stop-after-started",
        type=int,
        default=None,
        help="q1 smoke cap only: after this many fully observed starts, request "
        "stop and perform one terminal-collection turn; omitted for formal runs",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate CLI wiring and print dispatch-free inputs; no provider/native",
    )
    parser.add_argument(
        "--max-in-flight-candidates",
        type=int,
        default=4,
        help="episode-internal candidate dispatch depth (1-8); >1 overlaps "
        "LLM planning with in-flight EDA evaluations",
    )
    parser.add_argument("--episode-id", default=None)  # 同 id 重启 = resume
    args = parser.parse_args(argv)
    if not _RUN_ID.fullmatch(args.design):
        raise SystemExit(f"design id is invalid: {args.design}")
    if args.stop_after_started is not None and not 1 <= args.stop_after_started <= 20:
        raise SystemExit("--stop-after-started must be between 1 and the frozen 20-start budget")
    _validate_treatment_combination(args.knowledge_treatment, args.planning_evidence)
    if args.dry_run:
        print(json.dumps({
            "dispatch": "disabled",
            "provider": "disabled",
            "native": "disabled",
            "calibration_mode": "seeded-workspace-calibration",
            "stop_after_started": args.stop_after_started,
        }, sort_keys=True))
        return 0
    treatment_modes = {
        config.treatment.value: config.agent_mode
        for config in ZERO_SHOT_GATE_TREATMENTS
    }
    if args.knowledge_treatment is not None:
        if args.agent_mode not in (None, treatment_modes[args.knowledge_treatment]):
            raise SystemExit(
                "--agent-mode conflicts with the mode implied by --knowledge-treatment"
            )
        args.agent_mode = treatment_modes[args.knowledge_treatment]
    elif args.agent_mode is None:
        args.agent_mode = "full_agent"
    goal_text = args.goal_text or _OBJECTIVES[args.objective]["goal_text"]

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
                    "native_id": _native_design_id(design.design_id),
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

    # The workspace arrives with its default-replay calibration seeded by the
    # batch preparation (one canonical run per design; two replays behind
    # replay-cache manifests). This driver never replays the flow itself: it
    # verifies the workspace, reads the seeded calibration, and fails closed
    # when either is missing.
    canonical = _ensure_workspace(manifest, design, workspace, args.terminal_timeout_seconds)
    reference_runtime, noise_epsilon = _workspace_calibration(workspace)
    print(
        f"[driver] calibration done: reference_runtime={reference_runtime:.1f}s "
        f"noise_epsilon_drifting_keys={len(noise_epsilon['drifting_metric_keys'])}",
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
    # Keep each episode's reports isolated from later runs of the same design.
    episode_output = output / episode_id
    episode_output.mkdir(parents=True, exist_ok=True)
    if os.environ.get("ECOS_PROVIDER_HTTP_AUDIT_DIR"):
        # Batch processes launch many cells from one scheduler environment;
        # the audit join keys are per episode, so bind them here, before the
        # provider resolves the boundary. from_env re-validates the result.
        os.environ["ECOS_PROVIDER_HTTP_AUDIT_EPISODE_ID"] = episode_id
        os.environ.setdefault(
            "ECOS_PROVIDER_HTTP_AUDIT_PLANNING_REQUEST_ID", f"{episode_id}-p0"
        )

    replay_specs: list[dict[str, object]] | None = None
    replay_runtime: dict[str, object] = {}
    if args.replay_proposals is not None:
        if args.baseline_method:
            raise SystemExit("--replay-proposals drives the LLM arm only")
        replay_specs = json.loads(
            args.replay_proposals.read_text(encoding="utf-8")
        )
        provider, replay_runtime = replay_provider_and_runtime(replay_specs, episode_root)
    elif args.baseline_method:
        if args.value_policy != "model":
            raise SystemExit(
                "--value-policy applies to the LLM arm only; baselines always "
                "select lattice values"
            )
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
        if args.value_policy == "lattice":
            provider = DirectionOnlyProposalProvider(provider)
    else:
        raise SystemExit(
            "either --baseline-method or an LLM provider factory is required"
        )
    provider_policy = (
        "replay"
        if replay_specs is not None
        else ("baseline" if args.baseline_method else "llm")
    )
    try:
        model = args.model
        if args.baseline_method or replay_specs is not None:
            model = None
        else:
            # reasoning effort is applied by create_optimization_runner from
            # the runtime context below, shared with the GUI episode path
            provider.select_model(model)
        objective = _episode_objective(
            args.objective, goal_text, args.geometry_mode
        )
        primary_metric = _OBJECTIVES[args.objective]["primary_metric"]
        # Alignment anchors to canonical workspace evidence; replay telemetry drifts.
        # The reference observation is used only for the 22x wall-clock budget.
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
            "max_in_flight_candidates": args.max_in_flight_candidates,
        }
        runtime_context.update(replay_runtime)
        runner = create_optimization_runner(runtime_context, provider)
        if args.baseline_method is None and replay_specs is None:
            # Every LLM candidate must leave a pre-planner snapshot; recovery
            # with consumed planning calls cannot bootstrap one, so it fails.
            try:
                configure_planning_snapshots(
                    runner.controller,
                    root=episode_output / "planning-snapshots",
                    source_identity={
                        "episode_id": episode_id,
                        "design_id": design.design_id,
                        "model": args.model,
                        "planning_evidence": args.planning_evidence,
                        "agent_mode": args.agent_mode,
                        "q": 1,
                        "ecos_revision": _git_identity(
                            Path(__file__).resolve().parents[6]
                        ),
                        "ecc_revision": _git_identity(
                            _ecc_executable().parents[2]
                        ),
                        "pdk_revision": _git_identity(manifest.pdk_root),
                    },
                    planner_readable_roots=(workspace,),
                )
            except ValueError as exc:
                raise SystemExit(f"planning snapshots unavailable: {exc}") from exc
        try:
            _run_episode_with_cap(runner, args.stop_after_started)
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
        reference_observation=canonical,
        objective_metric=primary_metric,
    )
    metric_comparison = build_metric_comparison(
        canonical,
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
        objective_metric=primary_metric,
        treatment=(
            args.knowledge_treatment
            if args.knowledge_treatment is not None
            else "closed_loop_episode"
        ),
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
        "native_design_id": _native_design_id(args.design),
        "episode_id": episode_id,
        "stop_after_started": args.stop_after_started,
        "objective": args.objective,
        "primary_metric": primary_metric.value,
        "goal_text": goal_text,
        "agent_mode": args.agent_mode,
        "knowledge_treatment": args.knowledge_treatment,
        "planning_evidence": args.planning_evidence,
        "planner_policy": (
            f"baseline:{args.baseline_method}"
            if args.baseline_method
            else "llm"
        ),
        "value_policy": args.value_policy,
        "provider_policy": provider_policy,
        "replayed_proposals": (
            getattr(provider, "consumed", None)
            if provider_policy == "replay"
            else None
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
    return _episode_exit_code(str(budget_snapshot["final_state"]), bool(summary["terminal_artifacts_complete"]))


if __name__ == "__main__":
    raise SystemExit(main(None))
