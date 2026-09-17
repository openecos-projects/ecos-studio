"""Tests for the real-candidate activation runner (G1 wiring)."""

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    SignoffGates,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.experiments.activation_runner import (
    build_activation_request,
    ecc_activation_candidate_runner,
    evaluate_activation_outcome,
    parse_activation_action,
)

HASH = "sha256:" + "1" * 64
EPSILON = "sha256:" + "2" * 64
ROW = {
    "design_id": "gcd",
    "stratum": "knowledge_opportunity",
    "decision": "propose",
    "claim_bound": True,
    "claim_id": "claim-1",
    "claim_sha256": HASH,
    "binding_id": "binding-1",
    "binding_sha256": EPSILON,
    "knob": "place.target_density",
    "direction": "decrease",
    "requested_value": 0.4,
    "support_status": "pass",
    "context_fingerprint": "sha256:" + "c" * 64,
}


def _observation(
    wirelength: float, *, eligible: bool = True
) -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-Harden",
        evidence_manifest_sha256=HASH,
        evidence_valid=eligible,
        harden_artifacts_complete=eligible,
        signoff_gates=SignoffGates.all(GateResult.PASS if eligible else GateResult.FAIL),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 1.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
        },
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
    )


NOISE_EPSILON = {
    "route_dr_total_violation_count": 0.0,
    "route_la_total_overflow": 0.0,
    "route_wirelength": 1.0,
    **{metric.value: 0.0 for metric in TimingMetric},
}


def test_parse_activation_action_decodes_native_triple() -> None:
    knob, direction, value = parse_activation_action(ROW)
    assert knob.value == "place.target_density"
    assert direction is StrategyDirection.DECREASE
    assert value == 0.4


def test_parse_activation_action_rejects_unknown_knob() -> None:
    with pytest.raises(ValueError):
        parse_activation_action({**ROW, "knob": "not.a.knob"})
    with pytest.raises(ValueError):
        parse_activation_action({**ROW, "requested_value": "small"})


def test_request_binds_parent_checkpoint_and_proposal_content() -> None:
    request = build_activation_request(
        ROW,
        episode_id="activation-1",
        checkpoint_id="place",
        parent_checkpoint="sha256:" + "d" * 64,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        seed=7,
        ecc_revision="ecc-test",
    )
    assert request.episode_id == "activation-1"
    assert request.requested.knob_id.value == "place.target_density"
    assert request.requested.value == 0.4
    assert request.seed == 7
    assert request.ecc_revision == "ecc-test"
    # proposal context hash covers the parent checkpoint binding
    assert request.proposal.context_ref.input_sha256 == canonical_sha256(
        {
            "parent_checkpoint": "sha256:" + "d" * 64,
            "knob": "place.target_density",
            "direction": "decrease",
            "value": 0.4,
        }
    )


def test_effective_improving_probe_maps_to_promote() -> None:
    class _Receipt:
        status = "effective"
        actual_value = 0.4

    outcome = evaluate_activation_outcome(
        parent_observation=_observation(1000.0),
        candidate_observation=_observation(900.0),
        native_receipt=_Receipt(),
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        noise_epsilon=NOISE_EPSILON,
    )
    assert outcome["receipt_status"] == "effective"
    assert outcome["actual_value"] == 0.4
    assert outcome["terminal_delta"] == pytest.approx(-100.0)
    assert outcome["promotion_decision"] == "promote"
    assert outcome["terminal_observation_hash"] == HASH


def test_ineffective_receipt_blocks_promotion_despite_gain() -> None:
    class _Receipt:
        status = None
        actual_value = None

    outcome = evaluate_activation_outcome(
        parent_observation=_observation(1000.0),
        candidate_observation=_observation(900.0),
        native_receipt=_Receipt(),
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        noise_epsilon=NOISE_EPSILON,
    )
    assert outcome["promotion_decision"] == "better"
    assert outcome["receipt_status"] is None


@pytest.mark.parametrize(
    ("wirelength", "expected"),
    [(1000.0, "noise_tie"), (1100.0, "worse")],
)
def test_non_improving_probes_keep_the_comparison_label(
    wirelength: float, expected: str
) -> None:
    class _Receipt:
        status = "effective"
        actual_value = 0.4

    outcome = evaluate_activation_outcome(
        parent_observation=_observation(1000.0),
        candidate_observation=_observation(wirelength),
        native_receipt=_Receipt(),
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        noise_epsilon=NOISE_EPSILON,
    )
    assert outcome["promotion_decision"] == expected


def test_runner_glue_executes_probe_and_closes_rpc() -> None:
    parent = _observation(1000.0)
    candidate = _observation(900.0)
    closed = []
    started_ids = []

    class _Started:
        execution_id = "exec-1"

    class _Adapter:
        def ecc_revision(self):
            return "ecc-test"

        def start(self, request):
            started_ids.append(request)
            return _Started()

        def wait_for_terminal(self, execution_id, timeout_seconds=1.0):
            class _Receipt:
                outcome = object()  # terminal: ends the wait loop immediately
                parameter_application_receipt = type(
                    "R", (), {"status": "effective", "actual_value": 0.4}
                )()

                class evidence:
                    candidate_root_ref = "candidates/candidate-x"

            return _Receipt()

        def cancel(self, execution_id):
            raise AssertionError("probe must not be cancelled in this test")

    class _Rpc:
        def close(self):
            closed.append(True)

    calls = {}

    def _fake_parent(workspace):
        calls["parent"] = workspace
        return parent

    def _fake_candidate(workspace, evidence):
        calls["candidate"] = evidence.candidate_root_ref
        return candidate

    import ecos_agent.optimization.experiments.activation_runner as module

    original = (module.build_terminal_observation, module.build_candidate_terminal_observation)
    module.build_terminal_observation = _fake_parent
    module.build_candidate_terminal_observation = _fake_candidate
    try:
        run = ecc_activation_candidate_runner(
            __import__("pathlib").Path("/tmp/ws"),
            objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            noise_epsilon=NOISE_EPSILON,
            adapter_factory=lambda rpc, *, workspace_root: _Adapter(),
            rpc_factory=_Rpc,
        )
        result = run(design_id="gcd", parent_checkpoint="place", row=ROW)
    finally:
        module.build_terminal_observation, module.build_candidate_terminal_observation = original

    assert closed == [True]
    assert result["promotion_decision"] == "promote"
    assert result["terminal_delta"] == pytest.approx(-100.0)
    assert started_ids and started_ids[0].seed >= 2900


def test_runner_factory_requires_noise_epsilon() -> None:
    import pathlib

    with pytest.raises(ValueError):
        ecc_activation_candidate_runner(
            pathlib.Path("/tmp/ws"),
            objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            noise_epsilon={},
        )
