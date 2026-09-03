from __future__ import annotations

from dataclasses import replace

import pytest

from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller import CandidateExecutionRequest
from ecos_agent.optimization.ecc.adapter import (
    EccCandidateRerunAdapter,
    OptimizationEccAdapterError,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64
CARD_HASH = card_hash(load_parameter_cards()[OptimizationKnob.TARGET_DENSITY])



from tests.optimization.ecc_adapter_support import (
    CHUNK_HASH,
    HASH,
    _FakeEccRpc,
    _candidate_call,
    _request,
    _running_operation,
)

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
        ("rpc.hello", {"version": 1}),
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
                "contextSha256": HASH,
                "parameterCardSha256": CARD_HASH,
                "seed": 17,
            },
        ),
    ]


def test_adapter_resumes_only_the_bound_existing_candidate() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.resume(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )

    assert receipt.execution_id == "operation-1"
    assert rpc.calls == [
        ("rpc.hello", {"version": 1}),
        (
            "candidate.resume",
            {
                "workspaceId": "workspace-1",
                "candidateId": "candidate-0c4c4b249d945101-intervention-1",
                "idempotencyKey": "episode-1.intervention-1.resume",
                "contextSha256": HASH,
                "parameterCardSha256": CARD_HASH,
                "seed": 17,
            },
        ),
    ]


def test_adapter_exposes_ecc_revision_from_rpc_hello() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    assert adapter.ecc_revision() == "ecc-test-revision"
    assert rpc.calls == [("rpc.hello", {"version": 1})]


def test_adapter_rejects_unknown_ecc_revision() -> None:
    adapter = EccCandidateRerunAdapter(
        _FakeEccRpc(_running_operation(), ecc_version="unknown"),
        workspace_id="workspace-1",
        site_width_dbu=200,
    )

    with pytest.raises(OptimizationEccAdapterError, match="ECC revision"):
        adapter.ecc_revision()


def test_adapter_rejects_ecc_revision_drift_before_candidate_execution() -> None:
    rpc = _FakeEccRpc(_running_operation(), ecc_version="ecc-drifted-revision")
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(
        OptimizationEccAdapterError, match="ECC revision does not match"
    ):
        adapter.start(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE)
        )

    assert rpc.calls == [("rpc.hello", {"version": 1})]


@pytest.mark.parametrize(
    "knob_id,value,direction,target_step",
    [
        ("floorplan.core_util", 0.6, StrategyDirection.INCREASE, "Floorplan"),
        ("floorplan.aspect_ratio", 1.33, StrategyDirection.INCREASE, "Floorplan"),
        ("cts.max_fanout", 24, StrategyDirection.DECREASE, "CTS"),
        ("place.target_overflow", 0.08, StrategyDirection.DECREASE, "place"),
        ("place.density_weight", 0.001, StrategyDirection.INCREASE, "place"),
    ],
)
def test_adapter_routes_each_knob_from_its_own_stage(
    knob_id: str,
    value: int | float,
    direction: StrategyDirection,
    target_step: str,
) -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(_request(knob_id, value, direction))

    candidate_call = _candidate_call(rpc)
    assert candidate_call[1]["targetStep"] == target_step
    assert candidate_call[1]["endStep"] == "Harden"
    assert candidate_call[1]["patch"] == [{"knob_id": knob_id, "value": value}]


def test_adapter_reruns_from_the_incumbent_candidate_workspace() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(
        replace(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE),
            parent_candidate_root_ref=".agent/candidates/candidate-1",
        )
    )

    assert (
        _candidate_call(rpc)[1]["parentCandidateRootRef"]
        == ".agent/candidates/candidate-1"
    )


def test_adapter_sends_padding_in_surface_sites_for_l1_materialization() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(_request("place.cell_padding_x", 2, StrategyDirection.INCREASE))

    assert _candidate_call(rpc)[1]["patch"] == [
        {"knob_id": "place.cell_padding_x", "value": 2}
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
        context_sha256=HASH,
        seed=17,
        ecc_revision="ecc-test-revision",
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

    with pytest.raises(OptimizationEccAdapterError, match="context hash"):
        EccCandidateRerunAdapter(
            _FakeEccRpc(_running_operation()),
            workspace_id="workspace-1",
            site_width_dbu=200,
        ).start(
            replace(
                _request("place.target_density", 0.65, StrategyDirection.INCREASE),
                context_sha256="sha256:invalid",
            )
        )
