from __future__ import annotations

from pathlib import Path

import pytest

from ecos_agent.optimization.contracts import StrategyDirection
from ecos_agent.optimization.ecc.adapter import EccCandidateRerunAdapter
from ecos_agent.optimization.ledger import OptimizationOutcomeKind

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64



from tests.optimization.ecc_adapter_support import (
    CHUNK_HASH,
    HASH,
    _FakeEccRpc,
    _request,
    _running_operation,
    _write_candidate_evidence,
)

@pytest.mark.parametrize(
    ("state", "outcome"),
    [
        ("failed", OptimizationOutcomeKind.EXECUTION_FAILED),
        ("cancelled", OptimizationOutcomeKind.TIMED_OUT_CANCELLED),
    ],
)
def test_adapter_classifies_terminal_execution_outcomes(
    state: str, outcome: OptimizationOutcomeKind
) -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": state,
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.outcome == outcome


def test_adapter_leaves_missing_cancel_receipt_indeterminate_to_controller() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.cancel("operation-1")

    assert receipt.started is True
    assert receipt.outcome is None


def test_adapter_classifies_an_immediate_execution_failure() -> None:
    rpc = _FakeEccRpc({**_running_operation(), "state": "failed"})
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.start(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )

    assert receipt.outcome == OptimizationOutcomeKind.EXECUTION_FAILED


def test_adapter_preserves_immediate_success_for_controller_validation(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path)
    terminal = {
        "operationId": "operation-1",
        "workspaceId": "workspace-1",
        "state": "succeeded",
        "result": {**evidence, "parameterApplicationReceipt": native},
    }
    rpc = _FakeEccRpc(terminal, terminal_response=terminal)
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )

    started = adapter.start(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )
    completed = adapter.wait_for_terminal(started.execution_id)

    assert started.outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED
    assert started.evidence is not None
    assert started.parameter_application_receipt is not None
    assert completed.outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED
    assert completed.evidence is not None
    assert completed.parameter_application_receipt is not None
