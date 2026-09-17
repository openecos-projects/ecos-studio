"""Second-objective (overflow) generalization spot-check matrix driver.

FSE 实验补强：线长受控优化的 "state-conditioned support 有效" 需要第二目标
抽查是否是目标特有的结论。本模块把 closed_loop_driver 按小矩阵批量启动：
designs × arms × seeds，默认 objective=overflow（primary
route_la_total_overflow，preserve=DRC+线长），工具链、knob 面、预算与
candidate 终点（Harden）与线长受控优化完全一致，只有 objective contract 不同。

矩阵布局与复用：
- 每个设计的 cell 共享 <run-root>/<design>/ 下的 workspace 与 calibration
  （校准重放按 noise-context 指纹幂等复用），episode 用显式 episode id 隔离；
- cell 汇总已存在即跳过，中断后重跑同一命令即可续跑（进行中的 cell 由
  driver 的 --episode-id resume 语义接管）；
- 同一设计内 LLM arm 先于确定性 baseline arm：baseline 不读 task memory，
  而 task memory 快照按 objective contract 隔离、按 episode 汇集，先 LLM
  可避免 LLM episode 的 planning 上下文混入 baseline episode 的证据。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.experiments.baselines import BaselineMethod
from ecos_agent.optimization.experiments.closed_loop_driver import (
    main as run_episode,
)

_LLM_ARM = "llm"
_ARMS = (_LLM_ARM, *(method.value for method in BaselineMethod))
_SUMMARY_NAME = "episode-summary.v1.json"
_ERROR_LIMIT = 500


def episode_id_for(objective: str, arm: str, seed: int, design: str) -> str:
    return f"{objective}-{arm}-s{seed}-{design}"


def build_cell_argv(
    *,
    objective: str,
    design: str,
    arm: str,
    seed: int,
    run_root: Path,
    designs_root: Path,
    pdk_root: Path,
    model: str,
    reasoning_effort: str,
    geometry_mode: str,
    terminal_timeout_seconds: float,
) -> list[str]:
    """One driver invocation; the explicit episode id keeps cells resumable."""
    argv = [
        "--design", design,
        "--run-root", str(run_root / design),
        "--designs-root", str(designs_root),
        "--pdk-root", str(pdk_root),
        "--objective", objective,
        "--episode-id", episode_id_for(objective, arm, seed, design),
        "--reasoning-effort", reasoning_effort,
        "--geometry-mode", geometry_mode,
        "--terminal-timeout-seconds", str(terminal_timeout_seconds),
        "--seed", str(seed),
    ]
    if arm == _LLM_ARM:
        argv += ["--model", model]
    else:
        argv += ["--baseline-method", arm]
    return argv


def cell_summary_path(run_root: Path, design: str, episode_id: str) -> Path:
    return run_root / design / "reports" / design / episode_id / _SUMMARY_NAME


def matrix_row(
    *,
    design: str,
    arm: str,
    seed: int,
    episode_id: str,
    summary_path: Path,
) -> dict[str, object]:
    summary = json.loads(summary_path.read_text("utf-8"))
    comparison = summary.get("metric_comparison") or {}
    metrics = comparison.get("metrics") or {}
    primary = str(summary.get("primary_metric"))
    return {
        "design_id": design,
        "arm": arm,
        "seed": seed,
        "episode_id": episode_id,
        "objective": summary.get("objective"),
        "primary_metric": primary,
        "best_candidate_id": comparison.get("best_candidate_id"),
        "primary_comparison": metrics.get(primary),
        "preserve_comparisons": {
            key: metrics[key]
            for key in ("drc_count", "route_wirelength", "route_la_total_overflow")
            if key != primary and key in metrics
        },
        "started_candidates": summary.get("started_candidates"),
        "terminal_artifacts_complete": summary.get("terminal_artifacts_complete"),
        "budget": summary.get("budget"),
        "episode_summary_ref": str(summary_path),
        "episode_summary_sha256": file_sha256(summary_path),
    }


def _failed_row(
    design: str, arm: str, seed: int, episode_id: str, error: str
) -> dict[str, object]:
    return {
        "design_id": design,
        "arm": arm,
        "seed": seed,
        "episode_id": episode_id,
        "status": "failed",
        "error": error[-_ERROR_LIMIT:],
    }


def summarize_matrix(run_root: Path, cells: list[dict[str, object]]) -> Path:
    payload = {
        "schema_version": "ecos.generalization_matrix.v1",
        "evidence_class": "engineering_pilot",
        "utility_claim": "not_assessed",
        "cells": cells,
    }
    path = run_root / "matrix-summary.v1.json"
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return path


def parse_matrix_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--designs-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--designs", default="gcd,vm80")
    parser.add_argument(
        "--arms",
        default=",".join(
            (
                _LLM_ARM,
                BaselineMethod.CONTROLLED_COORDINATE.value,
                BaselineMethod.RULE_GUIDED_DIRECTION.value,
            )
        ),
    )
    parser.add_argument("--seeds", default="0")
    parser.add_argument("--objective", default="overflow")
    parser.add_argument("--model", default="glm-5.3-flash")
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--geometry-mode", default="variable")
    parser.add_argument("--terminal-timeout-seconds", type=float, default=1800.0)
    return parser.parse_args(argv)


def _apply_llm_runtime_environment(model: str) -> None:
    # optimization 包不 import codex（依赖方向规则）：provider factory 由
    # 组合根（scripts/run_overflow_generalization_matrix.py）传入，这里只做
    # 模型对应的 CODEX_HOME 装配（GLM→codex-glm，其余→codex-terra）。
    from ecos_agent.optimization.experiments.runner_environment import (
        apply_runner_environment,
    )

    print("[runner-env]", apply_runner_environment(model=model), flush=True)


def main(
    provider_factory, argv: list[str] | None = None
) -> int:
    args = parse_matrix_args(argv)
    designs = [item.strip() for item in args.designs.split(",") if item.strip()]
    arms = [item.strip() for item in args.arms.split(",") if item.strip()]
    seeds = [int(item) for item in args.seeds.split(",") if item.strip()]
    unknown = [arm for arm in arms if arm not in _ARMS]
    if not designs or not arms or not seeds or unknown:
        raise SystemExit(f"matrix arguments are invalid: unknown={unknown}")
    if _LLM_ARM in arms:
        if provider_factory is None:
            raise SystemExit("the llm arm requires a provider factory")
        _apply_llm_runtime_environment(args.model)

    # 同设计内 LLM 先行（见模块 docstring 的 task memory 顺序论证）。
    cells = [
        (design, arm, seed)
        for design in designs
        for arm in sorted(arms, key=lambda arm: arm != _LLM_ARM)
        for seed in seeds
    ]
    run_root = args.run_root.resolve()
    run_root.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, object]] = []
    for design, arm, seed in cells:
        episode_id = episode_id_for(args.objective, arm, seed, design)
        summary_path = cell_summary_path(run_root, design, episode_id)
        if summary_path.is_file():
            row: dict[str, object] = matrix_row(
                design=design,
                arm=arm,
                seed=seed,
                episode_id=episode_id,
                summary_path=summary_path,
            )
            row["status"] = "skipped"
        else:
            cell_argv = build_cell_argv(
                objective=args.objective,
                design=design,
                arm=arm,
                seed=seed,
                run_root=run_root,
                designs_root=args.designs_root.resolve(),
                pdk_root=args.pdk_root.resolve(),
                model=args.model,
                reasoning_effort=args.reasoning_effort,
                geometry_mode=args.geometry_mode,
                terminal_timeout_seconds=args.terminal_timeout_seconds,
            )
            try:
                run_episode(provider_factory, cell_argv)
            except (Exception, SystemExit) as exc:  # cell isolation: 失败不阻断其余 cell
                row = _failed_row(design, arm, seed, episode_id, str(exc))
            else:
                if summary_path.is_file():
                    row = matrix_row(
                        design=design,
                        arm=arm,
                        seed=seed,
                        episode_id=episode_id,
                        summary_path=summary_path,
                    )
                    row["status"] = "completed"
                else:
                    row = _failed_row(
                        design,
                        arm,
                        seed,
                        episode_id,
                        "driver finished without an episode summary",
                    )
        rows.append(row)
        print(
            f"[matrix] {design}/{arm}/s{seed}: {row['status']}",
            flush=True,
        )
    summary_path = summarize_matrix(run_root, rows)
    failed = sum(row["status"] == "failed" for row in rows)
    print(
        f"[matrix] cells={len(rows)} failed={failed} summary={summary_path}",
        flush=True,
    )
    return 1 if failed else 0
