from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from ecos_agent.optimization_contracts import (
    ExpectedEffectDirection,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationProposal,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
)
from ecos_agent.optimization_ecc_adapter import (
    EccCandidateRerunAdapter,
    EccContentLengthRpcClient,
    OptimizationEccAdapterError,
    _step_render_ack,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


@dataclass
class _FakeEccRpc:
    candidate_response: dict[str, object]
    terminal_response: dict[str, object] | None = None

    def __post_init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        self.calls.append((method, params))
        if method == "candidate.rerun":
            return self.candidate_response
        if method == "operation.cancel":
            return {
                "accepted": True,
                "operationId": params["operationId"],
                "state": "running",
            }
        raise AssertionError(f"unexpected RPC method: {method}")

    def wait_for_terminal(
        self,
        operation_id: str,
        timeout_seconds: float,
    ) -> dict[str, object] | None:
        assert operation_id == "operation-1"
        assert timeout_seconds == 60.0
        return self.terminal_response


def _proposal(knob_id: str, direction: StrategyDirection) -> OptimizationProposal:
    return OptimizationProposal.model_validate(
        {
            "context_ref": {
                "episode_id": "episode-1",
                "checkpoint_id": "checkpoint-1",
                "input_sha256": HASH,
            },
            "decision": OptimizationDecision.PROPOSE,
            "reason_code": ProposalReason.OBSERVATION,
            "rationale_summary": "Use one legal placement change.",
            "observation_refs": [
                ObservationReference(
                    observation_id="observation-1", sha256=HASH
                ).model_dump()
            ],
            "knowledge_refs": [
                KnowledgeReference(
                    entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH
                ).model_dump()
            ],
            "action": {
                "knob_id": knob_id,
                "direction": direction,
                "expected_effects": [
                    {
                        "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                        "direction": ExpectedEffectDirection.DECREASE,
                    }
                ],
            },
        }
    )


def _request(
    knob_id: str, value: bool | int | float, direction: StrategyDirection
) -> CandidateExecutionRequest:
    return CandidateExecutionRequest(
        intervention_id="intervention-1",
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        proposal=_proposal(knob_id, direction),
        requested=RequestedKnobValue(knob_id=knob_id, value=value),
    )


def _running_operation() -> dict[str, object]:
    return {
        "operationId": "operation-1",
        "workspaceId": "workspace-1",
        "state": "queued",
    }


def test_adapter_starts_only_fixed_full_flow_candidate_rerun() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.start(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )

    assert receipt.execution_id == "operation-1"
    assert receipt.started is True
    assert receipt.outcome is None
    assert rpc.calls == [
        (
            "candidate.rerun",
            {
                "workspaceId": "workspace-1",
                "targetStep": "place",
                "endStep": "Harden",
                "candidateId": "candidate-0c4c4b249d945101-intervention-1",
                "patch": [{"knob_id": "place.target_density", "value": 0.65}],
                "executionScope": "full_flow",
                "idempotencyKey": "episode-1.intervention-1",
            },
        )
    ]


def test_adapter_materializes_logical_padding_sites_to_dbu() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(_request("place.cell_padding_x", 2, StrategyDirection.INCREASE))

    assert rpc.calls[0][1]["patch"] == [
        {"knob_id": "place.cell_padding_x", "value": 400}
    ]


def test_adapter_rejects_mismatched_request_or_foreign_operation() -> None:
    rpc = _FakeEccRpc({**_running_operation(), "workspaceId": "other-workspace"})
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(OptimizationEccAdapterError, match="workspace"):
        adapter.start(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE)
        )

    mismatch = _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    mismatch = CandidateExecutionRequest(
        intervention_id=mismatch.intervention_id,
        episode_id=mismatch.episode_id,
        checkpoint_id=mismatch.checkpoint_id,
        proposal=mismatch.proposal,
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=2),
    )
    with pytest.raises(OptimizationEccAdapterError, match="knob"):
        EccCandidateRerunAdapter(
            _FakeEccRpc(_running_operation()),
            workspace_id="workspace-1",
            site_width_dbu=200,
        ).start(mismatch)

    with pytest.raises(OptimizationEccAdapterError, match="request id"):
        EccCandidateRerunAdapter(
            _FakeEccRpc(_running_operation()),
            workspace_id="workspace-1",
            site_width_dbu=200,
        ).start(
            replace(
                _request("place.target_density", 0.65, StrategyDirection.INCREASE),
                episode_id="..",
            )
        )


def test_adapter_waits_for_terminal_cancel_receipt() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "cancelled",
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.cancel("operation-1")

    assert receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED
    assert rpc.calls == [("operation.cancel", {"operationId": "operation-1"})]


def test_adapter_waits_for_successful_terminal_without_claiming_qor_outcome() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt == CandidateExecutionReceipt(
        execution_id="operation-1",
        started=True,
        outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
    )


def test_adapter_retains_valid_candidate_manifest_evidence() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {
                "candidateRootRef": ".agent/candidates/candidate-0c4c4b249d945101-intervention-1",
                "candidateManifestRef": (
                    ".agent/candidates/candidate-0c4c4b249d945101-intervention-1/analysis/candidate_workspace.v1.json"
                ),
                "candidateManifestSha256": HASH,
            },
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.evidence is not None
    assert receipt.evidence.candidate_manifest_sha256 == HASH
    assert receipt.outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED


def test_adapter_rejects_absolute_candidate_evidence_reference() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {
                "candidateRootRef": "/tmp/candidate",
                "candidateManifestRef": "/tmp/candidate/manifest.json",
                "candidateManifestSha256": HASH,
            },
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(OptimizationEccAdapterError, match="evidence"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_rejects_foreign_terminal_operation() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "other-workspace",
            "state": "failed",
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(OptimizationEccAdapterError, match="workspace"):
        adapter.wait_for_terminal("operation-1")


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


def test_step_completed_event_has_one_fixed_render_ack() -> None:
    assert _step_render_ack(
        {
            "type": "step.completed",
            "eventId": "event-1",
            "operationId": "operation-1",
            "payload": {
                "state": "Success",
                "stepCommitId": "operation-1:step:1",
                "workspaceRevision": 1,
            },
        }
    ) == {
        "operationId": "operation-1",
        "eventId": "event-1",
        "stepCommitId": "operation-1:step:1",
        "workspaceRevision": 1,
    }
    assert (
        _step_render_ack(
            {
                "type": "step.completed",
                "eventId": "event-1",
                "operationId": "operation-1",
                "payload": {"state": "Failed"},
            }
        )
        is None
    )


def test_stdio_client_requires_an_absolute_executable_path(tmp_path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)

    with pytest.raises(OptimizationEccAdapterError, match="absolute"):
        EccContentLengthRpcClient(Path("ecc"))

    client = EccContentLengthRpcClient(executable)

    assert client.command == (str(executable), "rpc", "serve", "--stdio", "--agent")


def test_stdio_client_acknowledges_successful_step_events(tmp_path: Path) -> None:
    acknowledgement = tmp_path / "ack.json"
    executable = tmp_path / "fake-ecc"
    executable.write_text(
        f"""#!{sys.executable}
import json
from pathlib import Path
import sys

def read_frame():
    header = b''
    while not header.endswith(b'\\r\\n\\r\\n'):
        header += sys.stdin.buffer.read(1)
    length = int(header.split(b':', 1)[1].split(b'\\r\\n', 1)[0])
    return json.loads(sys.stdin.buffer.read(length))

def write_frame(payload):
    body = json.dumps(payload).encode()
    sys.stdout.buffer.write(b'Content-Length: %d\\r\\n\\r\\n' % len(body) + body)
    sys.stdout.buffer.flush()

request = read_frame()
write_frame({{"jsonrpc": "2.0", "method": "runtime.event", "params": {{
    "type": "step.completed", "eventId": "event-1", "operationId": "operation-1",
    "payload": {{"state": "Success", "stepCommitId": "operation-1:step:1", "workspaceRevision": 1}},
}}}})
write_frame({{"jsonrpc": "2.0", "id": request["id"], "result": {{"operationId": "operation-1", "state": "running"}}}})
Path({str(acknowledgement)!r}).write_text(json.dumps(read_frame()), encoding="utf-8")
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)

    assert (
        client.call("operation.status", {"operationId": "operation-1"})["state"]
        == "running"
    )
    for _ in range(20):
        if acknowledgement.exists():
            break
        time.sleep(0.01)
    client.close()

    assert json.loads(acknowledgement.read_text(encoding="utf-8")) == {
        "jsonrpc": "2.0",
        "method": "operation.ack_step_rendered",
        "params": {
            "operationId": "operation-1",
            "eventId": "event-1",
            "stepCommitId": "operation-1:step:1",
            "workspaceRevision": 1,
        },
    }


def test_stdio_client_reports_safe_ecc_rejection_details(tmp_path: Path) -> None:
    executable = tmp_path / "fake-ecc"
    executable.write_text(
        f"""#!{sys.executable}
import json
import sys

header = b''
while not header.endswith(b'\\r\\n\\r\\n'):
    header += sys.stdin.buffer.read(1)
length = int(header.split(b':', 1)[1].split(b'\\r\\n', 1)[0])
request = json.loads(sys.stdin.buffer.read(length))
payload = json.dumps({{
    "jsonrpc": "2.0",
    "id": request["id"],
    "error": {{
        "code": -32602,
        "message": "invalid_request",
        "data": {{"message": "operation not found: operation-1"}},
    }},
}}).encode()
sys.stdout.buffer.write(b"Content-Length: %d\\r\\n\\r\\n" % len(payload) + payload)
sys.stdout.buffer.flush()
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)

    with pytest.raises(OptimizationEccAdapterError, match="operation not found"):
        client.call("operation.status", {"operationId": "operation-1"})

    client.close()
