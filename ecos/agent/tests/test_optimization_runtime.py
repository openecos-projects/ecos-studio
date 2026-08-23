from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.optimization_contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_runtime import (
    OptimizationRuntimeError,
    _optimization_objective,
    _parent_manifest_sha256,
    _place_to_harden_runtime_seconds,
    create_optimization_runner,
)
from ecos_agent.optimization_rules import freeze_optimization_objective


_STAGES = (
    "place",
    "CTS",
    "legalization",
    "route",
    "drc",
    "lvs",
    "filler",
    "RCX",
    "sta",
    "Harden",
)
_HASH = "sha256:" + "a" * 64


def _write_flow(tmp_path: Path, *, states: dict[str, str] | None = None) -> None:
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "flow.json").write_text(
        json.dumps(
            {
                "steps": [
                    {
                        "name": stage,
                        "state": (states or {}).get(stage, "Success"),
                        "runtime": f"0:0:{index}",
                    }
                    for index, stage in enumerate(_STAGES)
                ]
            }
        ),
        encoding="utf-8",
    )


def _terminal() -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-Harden",
        evidence_manifest_sha256=_HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100,
        },
        timing_guardrail={metric: 0 for metric in TimingMetric},
    )


def _semantic_objective() -> dict[str, object]:
    return freeze_optimization_objective(
        "Minimize wirelength without routing regressions.",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            ),
            rationale_summary="Keep routing constraints while reducing wirelength.",
        ),
    ).model_dump(mode="json")


def test_place_to_harden_runtime_uses_successful_flow_records(tmp_path: Path) -> None:
    _write_flow(tmp_path)

    assert _place_to_harden_runtime_seconds(tmp_path) == sum(range(10))


def test_place_to_harden_runtime_fails_closed_on_incomplete_stage(tmp_path: Path) -> None:
    _write_flow(tmp_path, states={"place": "Ongoing"})

    with pytest.raises(OptimizationRuntimeError, match="flow completion evidence"):
        _place_to_harden_runtime_seconds(tmp_path)


def test_parent_manifest_binds_terminal_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime.build_optimization_artifact_manifest",
        lambda *_args: SimpleNamespace(manifest_sha256=_HASH),
    )

    baseline = _terminal()
    changed_terminal = baseline.model_copy(
        update={"evidence_manifest_sha256": "sha256:" + "b" * 64}
    )

    assert _parent_manifest_sha256(tmp_path, baseline) != _parent_manifest_sha256(
        tmp_path, changed_terminal
    )


def test_runtime_requires_a_hash_bound_optimization_objective() -> None:
    objective = _semantic_objective()

    assert _optimization_objective(objective).primary_metric == ObjectiveMetric.ROUTE_WIRELENGTH
    with pytest.raises(OptimizationRuntimeError, match="optimization objective is missing"):
        _optimization_objective(None)
    objective["primary_metric"] = ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    with pytest.raises(OptimizationRuntimeError, match="optimization objective is invalid"):
        _optimization_objective(objective)


class _FakeRpc:
    def __init__(self, _executable: Path) -> None:
        self.calls: list[Path] = []
        self.closed = False

    def open_workspace(self, workspace: Path) -> str:
        self.calls.append(workspace)
        return "workspace-1"

    def close(self) -> None:
        self.closed = True


def test_runner_uses_parent_terminal_baseline_without_replaying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    rpc = _FakeRpc(Path("ecc"))
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime.EccContentLengthRpcClient", lambda _path: rpc
    )
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime.build_terminal_observation", lambda _path: _terminal()
    )
    monkeypatch.setattr("ecos_agent.optimization_runtime._site_width_dbu", lambda _path: 200)
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime._current_values",
        lambda _path, _site_width: {
            "place.target_density": 0.5,
            "place.cell_padding_x": 0,
            "place.routability_opt": True,
        },
    )
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime._parent_manifest_sha256", lambda _path, _terminal: _HASH
    )
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime._place_to_harden_runtime_seconds", lambda _path: 10.0
    )

    runner = create_optimization_runner(
        {
            "workspace": str(workspace),
            "episode_id": "episode-new",
            "objective": _semantic_objective(),
        },
        planner=object(),
    )

    assert rpc.calls == [workspace]
    assert not (workspace / ".agent/optimization/baseline-replays.v2.json").exists()
    runner.close()
    assert rpc.closed is True
