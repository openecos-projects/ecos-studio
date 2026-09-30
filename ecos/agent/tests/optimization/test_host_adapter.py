from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from ecos_agent.optimization.ecc.adapter import EccCandidateRerunAdapter
from ecos_agent.optimization.host_transport import (
    ProtocolHostTransport,
    open_execution_adapter,
)
from ecos_agent.optimization.runtime import (
    OptimizationRuntimeContext,
    create_optimization_runner,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards
from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    StrategyDirection,
)
from tests.optimization.ecc_adapter_support import HASH, _request
from tests.optimization.test_runtime_artifacts import (
    _alignment,
    _semantic_objective,
    _terminal,
)


CARD_HASH = card_hash(load_parameter_cards()[OptimizationKnob.TARGET_DENSITY])


class _FakeHost:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        self.calls.append((method, params))
        if method == "rpc.hello":
            return {"eccVersion": "ecc-test-revision"}
        if method == "candidate.rerun":
            return {
                "operationId": "operation-1",
                "state": "running",
                "workspaceId": "ws-1::candidate::candidate-1",
            }
        if method == "operation.status":
            return {
                "operationId": params["operationId"],
                "state": "succeeded",
                "workspaceId": "workspace-1",
                "result": None,
            }
        if method == "operation.wait":
            return {
                "operationId": params["operationId"],
                "state": "succeeded",
                "workspaceId": "workspace-1",
                "result": None,
            }
        if method == "operation.cancel":
            return {
                "accepted": True,
                "operationId": params["operationId"],
                "state": "cancelled",
            }
        if method == "workspace.open":
            return {
                "workspaceHandle": "handle-replay",
                "workspaceRevision": 1,
                "directory": str(params.get("directory", "")),
            }
        if method == "workspace.run":
            return {
                "operationId": "operation-replay",
                "state": "succeeded",
                "workspaceId": "workspace-replay",
            }
        raise AssertionError(f"unexpected host method {method}")


def test_production_runtime_opens_host_adapter_without_spawning_ecc(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "home").mkdir()
    (workspace / "home" / "parameters.json").write_text(
        '{"Design": "design-a"}', encoding="utf-8"
    )
    host = _FakeHost()
    monkeypatch.setattr(
        "ecos_agent.optimization.host_transport._require_host_transport", lambda: host
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
        lambda _path, _terminal: HASH,
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime._optimization_rerun_runtime_seconds",
        lambda _path: 10.0,
    )

    def fail_spawn(*_args, **_kwargs):
        raise AssertionError("production runtime must not spawn ECC")

    monkeypatch.setattr(
        "ecos_agent.optimization.ecc.rpc_client.EccContentLengthRpcClient.__init__",
        fail_spawn,
    )

    runner = create_optimization_runner(
        {
            "workspace": str(workspace),
            "workspace_handle": "handle-1",
            "expected_workspace_revision": 3,
            "episode_id": "episode-new",
            "objective": _semantic_objective(),
            "objective_alignment": _alignment(_semantic_objective()),
            "reference_runtime_seconds": 12.0,
            "agent_mode": "llm_no_knowledge",
            "knowledge_case_shots": 0,
        },
        planner=object(),
    )

    assert isinstance(runner._controller.executor, EccCandidateRerunAdapter)
    assert ("rpc.hello", {"version": 1}) in host.calls
    assert not any(method == "workspace.open" for method, _params in host.calls)
    runner.close()


def test_host_adapter_starts_candidate_rerun_through_product_command() -> None:
    host = _FakeHost()
    adapter = EccCandidateRerunAdapter(
        ProtocolHostTransport(host),
        workspace_id="handle-1",
        site_width_dbu=200,
        expected_workspace_revision=4,
    )

    receipt = adapter.start(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )

    assert receipt.execution_id == "operation-1"
    assert host.calls[-1] == (
        "candidate.rerun",
        {
            "workspaceHandle": "handle-1",
            "expectedWorkspaceRevision": 4,
            "candidateId": "candidate-0c4c4b249d945101-intervention-1",
            "targetStep": "place",
            "endStep": "Harden",
            "patch": [{"knob_id": "place.target_density", "value": 0.65}],
            "executionScope": "full_flow",
            "idempotencyKey": "episode-1.intervention-1",
            "contextSha256": HASH,
            "parameterCardSha256": CARD_HASH,
            "seed": 17,
        },
    )


def test_calibration_opens_replay_workspace_through_product_command() -> None:
    host = _FakeHost()
    transport = ProtocolHostTransport(host, expected_workspace_revision=3)

    opened = transport.call(
        "workspace.open",
        {"directory": "/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace"},
    )
    started = transport.call(
        "workspace.run",
        {
            "workspaceHandle": "handle-replay",
            "expectedWorkspaceRevision": 1,
            "rerun": True,
            "idempotencyKey": "noise-calibration.default-replay-1",
        },
    )

    assert opened["workspaceHandle"] == "handle-replay"
    assert started["operationId"] == "operation-replay"
    assert host.calls[0][0] == "workspace.open"
    assert "workspaceHandle" not in host.calls[0][1]
    assert host.calls[1] == (
        "workspace.run",
        {
            "workspaceHandle": "handle-replay",
            "expectedWorkspaceRevision": 1,
            "rerun": True,
            "idempotencyKey": "noise-calibration.default-replay-1",
        },
    )


def test_runtime_source_does_not_resolve_agent_rpc_executable() -> None:
    import ecos_agent.optimization.runtime as runtime_module

    source = inspect.getsource(runtime_module)
    assert "EccContentLengthRpcClient" not in source
    assert "_ecc_executable" not in source
    assert "ECOS_AGENT_ECC_RPC_BIN" not in source
    assert "ecc-agent-rpc" not in source
    adapter_source = inspect.getsource(open_execution_adapter)
    assert "EccContentLengthRpcClient" not in adapter_source
    import ecos_agent.optimization.calibrate_workspace as calibrate_module

    calibrate_source = inspect.getsource(calibrate_module)
    assert "EccContentLengthRpcClient" not in calibrate_source
    assert "ecc_rpc_serve_executable" not in calibrate_source
    context_source = inspect.getsource(OptimizationRuntimeContext)
    assert "workspace_handle" in context_source
    assert "expected_workspace_revision" in context_source
