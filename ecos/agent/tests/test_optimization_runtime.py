from __future__ import annotations

import json
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.controller import CandidateExecutionReceipt
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.rules import freeze_optimization_objective
from ecos_agent.optimization.runtime import (
    OptimizationRuntimeContext,
    OptimizationRuntimeError,
    _current_values,
    _design_id,
    _incumbent_workspace,
    _knowledge_case_pool_root,
    _optimization_execution_context,
    _optimization_objective,
    _optimization_rerun_runtime_seconds,
    _parent_manifest_sha256,
    _wait_for_terminal_receipt,
    create_optimization_runner,
)

_STAGES = (
    "Floorplan",
    "fixFanout",
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


def test_optimization_runtime_uses_the_earliest_rerun_stage(tmp_path: Path) -> None:
    _write_flow(tmp_path)

    assert _optimization_rerun_runtime_seconds(tmp_path) == sum(range(12))


def test_optimization_runtime_fails_closed_on_incomplete_stage(tmp_path: Path) -> None:
    _write_flow(tmp_path, states={"place": "Ongoing"})

    with pytest.raises(OptimizationRuntimeError, match="flow completion evidence"):
        _optimization_rerun_runtime_seconds(tmp_path)


def test_design_id_comes_from_workspace_parameters_and_fails_closed(
    tmp_path: Path,
) -> None:
    (tmp_path / "home").mkdir()
    parameters = tmp_path / "home" / "parameters.json"
    parameters.write_text(json.dumps({"Design": "aes_core"}), encoding="utf-8")
    assert _design_id(tmp_path) == "aes_core"

    parameters.write_text(json.dumps({"Design": "../other"}), encoding="utf-8")
    with pytest.raises(OptimizationRuntimeError, match="identifier is invalid"):
        _design_id(tmp_path)


def test_current_values_read_the_eight_runtime_knob_surfaces(tmp_path: Path) -> None:
    (tmp_path / "home").mkdir()
    (tmp_path / "config").mkdir()
    (tmp_path / "home" / "parameters.json").write_text(
        json.dumps(
            {
                "Core": {"Utilitization": 0.6, "Aspect ratio": 1.33},
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "config" / "dreamplace_ecc.json").write_text(
        json.dumps(
            {
                "target_density": 0.65,
                "stop_overflow": 0.08,
                "cell_padding_x": 400,
                "routability_opt_flag": 1,
                "density_weight": 0.001,
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "config" / "fixfanout_ecc.json").write_text(
        json.dumps({"max_fanout": 24}), encoding="utf-8"
    )
    place_log = tmp_path / "place_dreamplace/log/place.log"
    place_log.parent.mkdir(parents=True)
    place_log.write_text(
        "[INFO] parameters = {'target_density': 0.65, 'cell_padding_x': 400}\n"
        "utilization = 0.67, target_density = 0.68\n"
        "[INFO] new target_density 0.72\n"
        "[WARNING] cell_padding_x 2 would increase movable area; reducing it to 1\n",
        encoding="utf-8",
    )

    assert _current_values(tmp_path, 200) == {
        "place.target_density": 0.65,
        "place.target_overflow": 0.08,
        "place.cell_padding_x": 2,
        "place.routability_opt": True,
        "place.density_weight": 0.001,
        "floorplan.core_util": 0.6,
        "floorplan.aspect_ratio": 1.33,
        "synth.max_fanout": 24,
    }


def test_incumbent_workspace_resolves_only_registered_candidate_roots(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    candidate = workspace / ".agent" / "candidates" / "candidate-1"
    candidate.mkdir(parents=True)

    assert _incumbent_workspace(workspace, None) == workspace
    assert _incumbent_workspace(workspace, ".agent/candidates/candidate-1") == candidate
    with pytest.raises(OptimizationRuntimeError, match="incumbent candidate workspace"):
        _incumbent_workspace(workspace, "../outside")


def test_knowledge_case_pool_root_accepts_only_real_absolute_directories(
    tmp_path: Path,
) -> None:
    pool = tmp_path / "case-pool"
    pool.mkdir()
    assert _knowledge_case_pool_root(str(pool)) == pool.resolve()

    with pytest.raises(OptimizationRuntimeError, match="knowledge case pool root"):
        _knowledge_case_pool_root("relative/cases")
    with pytest.raises(OptimizationRuntimeError, match="knowledge case pool root"):
        _knowledge_case_pool_root(str(tmp_path / "missing"))

    link = tmp_path / "pool-link"
    link.symlink_to(pool, target_is_directory=True)
    with pytest.raises(OptimizationRuntimeError, match="knowledge case pool root"):
        _knowledge_case_pool_root(str(link))


def test_parent_manifest_binds_terminal_evidence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime.build_optimization_artifact_manifest",
        lambda *_args: SimpleNamespace(manifest_sha256=_HASH),
    )

    baseline = _terminal()
    changed_terminal = baseline.model_copy(
        update={"evidence_manifest_sha256": "sha256:" + "b" * 64}
    )

    assert _parent_manifest_sha256(tmp_path, baseline) != _parent_manifest_sha256(
        tmp_path, changed_terminal
    )


def test_execution_context_matches_ecc_design_hash_for_multiple_inputs(
    tmp_path: Path,
) -> None:
    origin = tmp_path / "origin"
    rtl = origin / "rtl"
    rtl.mkdir(parents=True)
    (rtl / "a.v").write_text("module a; endmodule\n", encoding="utf-8")
    (rtl / "b.v").write_text("module b; endmodule\n", encoding="utf-8")
    (origin / "a.sdc").write_text("create_clock -period 10 clk\n", encoding="utf-8")
    (origin / "b.sdc").write_text("set_false_path -from rst\n", encoding="utf-8")
    filelist = origin / "filelist.f"
    filelist.write_text("rtl/a.v\nrtl/b.v\n", encoding="utf-8")
    pdk = tmp_path / "pdk"
    tech_lef = pdk / "prtech" / "techLEF" / "N551P6M_ecos.lef"
    tech_lef.parent.mkdir(parents=True)
    tech_lef.write_text("VERSION 5.8 ;\n", encoding="utf-8")
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "parameters.json").write_text(
        json.dumps({"Design": "design-a", "PDK Root": str(pdk)}), encoding="utf-8"
    )
    (tmp_path / "home" / "flow.json").write_text("{}\n", encoding="utf-8")

    context = _optimization_execution_context(
        tmp_path, 200, 17, _HASH, "ecc-test-revision"
    )

    assert context["design_id"] == "design-a"
    assert context["rtl_sha256"] == canonical_sha256(
        {"files": [file_sha256(rtl / "a.v"), file_sha256(rtl / "b.v")]}
    )
    assert context["sdc_sha256"] == canonical_sha256(
        {
            "files": [
                file_sha256(origin / "a.sdc"),
                file_sha256(origin / "b.sdc"),
            ]
        }
    )
    assert context["design_sha256"] == canonical_sha256(
        {
            "rtl_sha256": context["rtl_sha256"],
            "filelist_sha256": file_sha256(filelist),
            "sdc_sha256": context["sdc_sha256"],
        }
    )


def test_runtime_requires_a_hash_bound_optimization_objective() -> None:
    objective = _semantic_objective()

    assert (
        _optimization_objective(objective).primary_metric
        == ObjectiveMetric.ROUTE_WIRELENGTH
    )
    with pytest.raises(
        OptimizationRuntimeError, match="optimization objective is missing"
    ):
        _optimization_objective(None)
    objective["primary_metric"] = ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    with pytest.raises(
        OptimizationRuntimeError, match="optimization objective is invalid"
    ):
        _optimization_objective(objective)


def test_runtime_context_rejects_unknown_and_coerced_fields(tmp_path: Path) -> None:
    payload = {
        "workspace": str(tmp_path),
        "episode_id": "episode-1",
        "objective": _semantic_objective(),
    }

    context = OptimizationRuntimeContext.model_validate(payload)

    assert context.seed == 0
    assert context.receipt_aware_planning is True
    with pytest.raises(ValidationError, match="extra_forbidden"):
        OptimizationRuntimeContext.model_validate({**payload, "unknown": 1})
    with pytest.raises(ValidationError, match="seed"):
        OptimizationRuntimeContext.model_validate({**payload, "seed": True})


def test_terminal_waiter_propagates_stop_to_cancel_and_returns_terminal_receipt() -> (
    None
):
    events: list[str] = []
    stop = threading.Event()
    stop.set()

    class Executor:
        def wait_for_terminal(self, *_args: object, **_kwargs: object):
            events.append("wait")
            return CandidateExecutionReceipt(execution_id="operation-1", started=True)

        def cancel(self, execution_id: str):
            events.extend(("operation.cancel", "terminal.receipt"))
            return CandidateExecutionReceipt(
                execution_id=execution_id,
                started=True,
                outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
            )

    receipt = _wait_for_terminal_receipt(
        Executor(),
        "operation-1",
        timeout_seconds=5.0,
        stop_event=stop,
    )

    assert events == ["operation.cancel", "terminal.receipt"]
    assert receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED


def test_terminal_waiter_cancels_when_timeout_expires_between_clock_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    clock = iter((0.0, 0.05, 0.2))
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime._monotonic", lambda: next(clock)
    )

    class Executor:
        def wait_for_terminal(self, *_args: object, **_kwargs: object):
            calls.append("wait")
            raise AssertionError("expired timeout must not reach ECC wait")

        def cancel(self, execution_id: str):
            calls.append("cancel")
            return CandidateExecutionReceipt(
                execution_id=execution_id,
                started=True,
                outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
            )

    receipt = _wait_for_terminal_receipt(
        Executor(),
        "operation-1",
        timeout_seconds=0.1,
        stop_event=threading.Event(),
    )

    assert calls == ["cancel"]
    assert receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED


class _FakeRpc:
    def __init__(self, _executable: Path) -> None:
        self.calls: list[Path] = []
        self.closed = False

    def open_workspace(self, workspace: Path) -> str:
        self.calls.append(workspace)
        return "workspace-1"

    def ecc_revision(self) -> str:
        return "ecc-test-revision"

    def close(self) -> None:
        self.closed = True


def test_runner_uses_parent_terminal_baseline_without_replaying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "home").mkdir()
    (workspace / "home" / "parameters.json").write_text(
        json.dumps({"Design": "design-a"}), encoding="utf-8"
    )
    rpc = _FakeRpc(Path("ecc"))
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime.EccContentLengthRpcClient", lambda _path: rpc
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime.build_terminal_observation",
        lambda _path: _terminal(),
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime._site_width_dbu", lambda _path: 200
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime._current_values",
        lambda _path, _site_width: {
            "place.target_density": 0.5,
            "place.cell_padding_x": 0,
            "place.routability_opt": True,
        },
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime._parent_manifest_sha256",
        lambda _path, _terminal: _HASH,
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime._optimization_rerun_runtime_seconds",
        lambda _path: 10.0,
    )

    runner = create_optimization_runner(
        {
            "workspace": str(workspace),
            "episode_id": "episode-new",
            "objective": _semantic_objective(),
            "reference_runtime_seconds": 12.0,
            "agent_mode": "llm_no_knowledge",
            "knowledge_case_shots": 0,
        },
        planner=object(),
    )

    assert rpc.calls == [workspace]
    assert not (workspace / ".agent/optimization/baseline-replays.v2.json").exists()
    episode_root = workspace / ".agent" / "optimization" / "episode-new"
    assert (episode_root / "optimization-task-memory-scope.v1.json").is_file()
    state = json.loads(
        (episode_root / "optimization-episode-state.v6.json").read_text(
            encoding="utf-8"
        )
    )
    assert state["task_memory_scope_sha256"].startswith("sha256:")
    assert state["mode"] == "llm_no_knowledge"
    assert state.get("knowledge_case_shots", 0) == 0
    assert runner.budget.budget.wall_time_limit_seconds == 264.0
    runner.close()
    assert rpc.closed is True
