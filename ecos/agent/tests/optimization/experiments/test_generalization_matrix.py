import json
from pathlib import Path

import pytest

from ecos_agent.optimization.experiments import generalization_matrix as gm
from ecos_agent.optimization.experiments.baselines import BaselineMethod


def _write_episode_summary(path: Path, primary: str, best: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "ecos.overnight_episode_summary.v1",
                "design_id": path.parts[-3],
                "episode_id": path.parent.name,
                "objective": "overflow",
                "primary_metric": primary,
                "started_candidates": 20,
                "terminal_artifacts_complete": True,
                "budget": {"consumed_candidates": 20},
                "metric_comparison": {
                    "best_candidate_id": "episode.c2",
                    "metrics": {
                        primary: {
                            "reference": 1.0,
                            "best": best,
                            "delta": best - 1.0,
                        },
                        "drc_count": {"reference": 0.0, "best": 0.0},
                        "route_wirelength": {"reference": 4.0, "best": 3.9},
                        "route_la_total_overflow": {"reference": 1.0, "best": best},
                    },
                },
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def test_llm_arm_requires_provider_factory(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(gm, "_apply_llm_runtime_environment", lambda model: None)
    designs_root = tmp_path / "designs"
    designs_root.mkdir()

    with pytest.raises(SystemExit, match="provider factory"):
        gm.main(
            None,
            [
                "--run-root", str(tmp_path / "matrix"),
                "--designs-root", str(designs_root),
                "--pdk-root", str(tmp_path / "pdk"),
                "--arms", "llm",
            ],
        )


def test_baseline_only_matrix_runs_without_glm_environment(
    tmp_path: Path, monkeypatch
) -> None:
    """baseline-only 矩阵不强制 GLM 环境（同 run_baseline_episode.py）。"""
    designs_root = tmp_path / "designs"
    designs_root.mkdir()

    def fake_episode(provider_factory, argv):
        assert provider_factory is None
        cells = dict(zip(argv, argv[1:]))
        _write_episode_summary(
            gm.cell_summary_path(
                tmp_path / "matrix",
                cells["--design"],
                cells["--episode-id"],
            ),
            primary="route_la_total_overflow",
            best=0.5,
        )

    monkeypatch.setattr(gm, "run_episode", fake_episode)

    exit_code = gm.main(
        None,
        [
            "--run-root", str(tmp_path / "matrix"),
            "--designs-root", str(designs_root),
            "--pdk-root", str(tmp_path / "pdk"),
            "--designs", "gcd",
            "--arms", BaselineMethod.CONTROLLED_COORDINATE.value,
            "--seeds", "0",
        ],
    )

    assert exit_code == 0


def test_cell_argv_targets_one_episode_and_arm() -> None:
    common = dict(
        objective="overflow",
        design="gcd",
        seed=0,
        run_root=Path("/tmp/matrix"),
        designs_root=Path("/tmp/designs"),
        pdk_root=Path("/tmp/pdk"),
        model="glm-5.3-flash",
        reasoning_effort="medium",
        geometry_mode="variable",
        terminal_timeout_seconds=1800.0,
    )

    llm = gm.build_cell_argv(arm="llm", **common)
    baseline = gm.build_cell_argv(arm="rule_guided_direction", **common)

    assert "--episode-id" in llm
    assert llm[llm.index("--episode-id") + 1] == "overflow-llm-s0-gcd"
    assert "--objective" in llm
    assert llm[llm.index("--objective") + 1] == "overflow"
    assert llm[llm.index("--run-root") + 1] == str(Path("/tmp/matrix") / "gcd")
    assert llm[llm.index("--model") + 1] == "glm-5.3-flash"
    assert "--baseline-method" not in llm
    assert baseline[baseline.index("--episode-id") + 1] == (
        "overflow-rule_guided_direction-s0-gcd"
    )
    assert "--model" not in baseline
    assert baseline[baseline.index("--baseline-method") + 1] == (
        "rule_guided_direction"
    )


def test_matrix_main_skips_runs_and_isolates_failures(
    tmp_path: Path, monkeypatch
) -> None:
    """已完成的 cell 跳过、失败 cell 不阻断其余 cell，汇总始终落盘。"""
    monkeypatch.setattr(gm, "_apply_llm_runtime_environment", lambda model: None)
    run_root = tmp_path / "matrix"
    designs_root = tmp_path / "designs"
    designs_root.mkdir()
    calls: list[tuple[str, str]] = []

    def fake_episode(provider_factory, argv):
        parser_cells = dict(zip(argv, argv[1:]))
        episode_id = parser_cells["--episode-id"]
        design = parser_cells["--design"]
        calls.append((design, episode_id))
        if "controlled_coordinate" in episode_id:
            raise RuntimeError("boom: isolated cell failure")
        _write_episode_summary(
            gm.cell_summary_path(run_root, design, episode_id),
            primary="route_la_total_overflow",
            best=0.5,
        )

    monkeypatch.setattr(gm, "run_episode", fake_episode)
    # gcd/llm 预先完成 → skip；vm80 的 cell 由 fake 执行。
    _write_episode_summary(
        gm.cell_summary_path(
            run_root, "gcd", "overflow-llm-s0-gcd"
        ),
        primary="route_la_total_overflow",
        best=0.25,
    )

    exit_code = gm.main(
        object(),  # provider factory 只透传给 driver，此处被 fake 替换
        [
            "--run-root", str(run_root),
            "--designs-root", str(designs_root),
            "--pdk-root", str(tmp_path / "pdk"),
            "--designs", "gcd,vm80",
            "--arms", "llm,controlled_coordinate",
            "--seeds", "0",
        ],
    )

    assert exit_code == 1
    # 同设计内 LLM 先行（task memory 顺序论证）；已完成的 gcd/llm 被跳过，
    # 其余 cell 照常尝试，失败不阻断后续 cell。
    assert calls == [
        ("gcd", "overflow-controlled_coordinate-s0-gcd"),
        ("vm80", "overflow-llm-s0-vm80"),
        ("vm80", "overflow-controlled_coordinate-s0-vm80"),
    ]
    payload = json.loads(
        (run_root / "matrix-summary.v1.json").read_text("utf-8")
    )
    assert payload["schema_version"] == "ecos.generalization_matrix.v1"
    rows = {(row["design_id"], row["arm"]): row for row in payload["cells"]}
    assert rows[("gcd", "llm")]["status"] == "skipped"
    assert rows[("gcd", "llm")]["primary_comparison"]["best"] == 0.25
    assert rows[("vm80", "llm")]["status"] == "completed"
    assert rows[("vm80", "llm")]["episode_summary_sha256"]
    assert rows[("vm80", "llm")]["preserve_comparisons"].keys() == {
        "route_wirelength",
        "drc_count",
    }
    assert rows[("gcd", "controlled_coordinate")]["status"] == "failed"
    assert rows[("vm80", "controlled_coordinate")]["status"] == "failed"
    assert "boom" in rows[("vm80", "controlled_coordinate")]["error"]


def test_rerun_after_all_cells_complete_reports_everything_skipped(
    tmp_path: Path, monkeypatch
) -> None:
    """续跑语义：全部 cell 完成后重跑同一命令 → 全部 skipped、exit 0。"""
    monkeypatch.setattr(gm, "_apply_llm_runtime_environment", lambda model: None)
    run_root = tmp_path / "matrix"
    designs_root = tmp_path / "designs"
    designs_root.mkdir()
    for design in ("gcd", "vm80"):
        _write_episode_summary(
            gm.cell_summary_path(run_root, design, f"overflow-llm-s0-{design}"),
            primary="route_la_total_overflow",
            best=0.5,
        )

    exit_code = gm.main(
        object(),
        [
            "--run-root", str(run_root),
            "--designs-root", str(designs_root),
            "--pdk-root", str(tmp_path / "pdk"),
            "--designs", "gcd,vm80",
            "--arms", "llm",
            "--seeds", "0",
        ],
    )

    assert exit_code == 0
    payload = json.loads(
        (run_root / "matrix-summary.v1.json").read_text("utf-8")
    )
    assert [row["status"] for row in payload["cells"]] == ["skipped", "skipped"]
