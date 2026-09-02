from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import ecos_agent.optimization.experiments.gate0 as gate0
import pytest
from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    RequestedKnobValue,
    SignoffGates,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
)
from ecos_agent.optimization.experiments.gate0 import (
    Gate0Error,
    PilotCandidateExecutionError,
    compare_observations,
    load_gate0_config,
    noise_profile,
    qualify_design,
    qualify_pool,
    require_terminal_receipt,
    run_pilot_candidate,
)
from ecos_agent.optimization.ledger import OptimizationOutcomeKind

HASH = "sha256:" + "a" * 64


def _terminal(
    violations: float,
    overflow: float,
    wirelength: float,
    *,
    setup_wns: float = 0.0,
) -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-Harden",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: violations,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
        },
        timing_guardrail={
            TimingMetric.STA_SETUP_WNS: setup_wns,
            TimingMetric.STA_SETUP_TNS: 0.0,
            TimingMetric.STA_HOLD_WNS: 0.0,
            TimingMetric.STA_HOLD_TNS: 0.0,
        },
    )


def _config(snapshot: Path, sha256: str) -> dict[str, object]:
    file = {"path": snapshot.name, "sha256": sha256}
    return {
        "schema_version": "ecos.optimization_gate0_config.v1",
        "pdk_root": "../../pdk",
        "default_replays": 3,
        "terminal_timeout_seconds": 900,
        "baseline": {
            "frequency_mhz": 50,
            "max_fanout": 32,
            "utilitization": 0.4,
            "target_density": 0.2,
            "target_overflow": 0,
            "cell_padding_sites": 2,
            "routability_opt": True,
        },
        "probes": [
            {
                "probe_id": "density-decrease",
                "knob_id": "place.target_density",
                "delta": -0.05,
            },
            {
                "probe_id": "density-increase",
                "knob_id": "place.target_density",
                "delta": 0.05,
            },
            {
                "probe_id": "padding-decrease",
                "knob_id": "place.cell_padding_x",
                "delta": -1,
            },
            {
                "probe_id": "padding-increase",
                "knob_id": "place.cell_padding_x",
                "delta": 1,
            },
            {
                "probe_id": "routability-toggle",
                "knob_id": "place.routability_opt",
                "delta": None,
            },
        ],
        "designs": [
            {
                "design_id": "gcd",
                "top_module": "gcd",
                "clock_name": "clk",
                "rtl": file,
                "filelist": file,
                "sdc": file,
            }
        ],
    }


def test_config_hash_locks_every_input(tmp_path: Path) -> None:
    snapshot = tmp_path / "input.v"
    snapshot.write_text("module gcd(input clk); endmodule\n", encoding="utf-8")
    config_path = tmp_path / "pilot.json"
    config_path.write_text(
        json.dumps(_config(snapshot, file_sha256(snapshot))), encoding="utf-8"
    )

    config = load_gate0_config(config_path)

    assert config.designs[0].design_id == "gcd"
    snapshot.write_text("module changed; endmodule\n", encoding="utf-8")
    with pytest.raises(Gate0Error, match="hash"):
        load_gate0_config(config_path)


def test_run_gate0_parallelizes_designs_with_deterministic_order(
    monkeypatch, tmp_path: Path
) -> None:
    config = gate0.Gate0Config.model_validate(_config(tmp_path / "input.v", HASH))
    second = config.designs[0].model_copy(
        update={"design_id": "i2c", "top_module": "i2c"}
    )
    config = config.model_copy(update={"designs": (config.designs[0], second)})
    active = 0
    peak = 0
    lock = threading.Lock()

    def fake_run_design(*args, **kwargs):
        nonlocal active, peak
        design = args[2]
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.03 if design.design_id == "gcd" else 0.01)
        with lock:
            active -= 1
        return {"qualified": True, "best_probe_id": design.design_id}

    monkeypatch.setattr(gate0, "load_gate0_config", lambda _path: config)
    monkeypatch.setattr(
        gate0,
        "readiness_report",
        lambda _path: {"config_sha256": HASH, "ecc": {}, "pdk": {}},
    )
    monkeypatch.setattr(gate0, "_run_design", fake_run_design)

    summary = gate0.run_gate0(
        tmp_path / "pilot.json",
        tmp_path / "results",
        run_id="parallel-designs",
        max_workers=2,
    )

    assert peak == 2
    assert list(summary["designs"]) == ["gcd", "i2c"]
    manifest = json.loads(
        (tmp_path / "results/parallel-designs/run-manifest.v1.json").read_text()
    )
    assert manifest["max_workers"] == 2


@pytest.mark.parametrize("max_workers", [0, -1, True, 1.5])
def test_run_gate0_rejects_invalid_max_workers(
    tmp_path: Path, max_workers: object
) -> None:
    with pytest.raises(Gate0Error, match="max workers"):
        gate0.run_gate0(
            tmp_path / "pilot.json",
            tmp_path / "results",
            run_id="invalid-workers",
            max_workers=max_workers,  # type: ignore[arg-type]
        )


def test_design_candidates_use_parallel_independent_rpc_sessions(
    monkeypatch, tmp_path: Path
) -> None:
    config = gate0.Gate0Config.model_validate(_config(tmp_path / "input.v", HASH))
    design = config.designs[0]
    canonical = _terminal(10, 5, 100)
    lock = threading.Lock()
    created: list[FakeClient] = []
    active = 0
    peak = 0

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            with lock:
                self.index = len(created)
                created.append(self)
            self.closed = False

        def open_workspace(self, workspace: Path) -> str:
            assert workspace == tmp_path / "design/workspace"
            return f"workspace-{self.index}"

        def close(self) -> None:
            self.closed = True

    def fake_canonical(*_args, **_kwargs):
        return {"workspace_id": "workspace-canonical", "observation": canonical}

    def fake_candidate(client, workspace_id, *_args, **_kwargs):
        nonlocal active, peak
        assert workspace_id == f"workspace-{client.index}"
        with lock:
            active += 1
            peak = max(peak, active)
        candidate_id = _args[5]
        time.sleep(0.02 if "default" in candidate_id else 0.01)
        with lock:
            active -= 1
        value = (
            float(candidate_id.rsplit("-", 1)[-1]) if "default" in candidate_id else 0
        )
        return gate0.PilotCandidateRun(_terminal(10, 5, 100 + value), object())

    monkeypatch.setattr(gate0, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(gate0, "_run_canonical", fake_canonical)
    monkeypatch.setattr(gate0, "run_pilot_candidate", fake_candidate)

    report = gate0._run_design(
        tmp_path / "pilot.json",
        config,
        design,
        tmp_path / "design",
        {
            "ecc": {"executable": "/ecc"},
            "pdk": {"site_width_dbu": 200},
            "config_sha256": HASH,
        },
        max_workers=3,
        execution_slots=threading.BoundedSemaphore(3),
    )

    assert peak == 3
    assert [
        item["metrics"]["route_wirelength"] for item in report["default_replays"]
    ] == [101, 102, 103]
    assert list(report["probe_observations"]) == [
        item.probe_id for item in config.probes
    ]
    assert len(created) == 9
    assert all(client.closed for client in created)


def test_noise_profile_and_comparison_use_default_replay_range() -> None:
    defaults = (
        _terminal(10, 5, 100, setup_wns=-0.10),
        _terminal(12, 5, 104, setup_wns=-0.12),
        _terminal(11, 5, 102, setup_wns=-0.11),
    )

    profile = noise_profile(defaults)

    assert profile["reference"]["route_dr_total_violation_count"] == 11
    assert profile["epsilon"]["route_dr_total_violation_count"] == 2
    assert profile["epsilon"]["route_wirelength"] == 4
    assert (
        compare_observations(
            profile["reference"],
            _terminal(8, 5, 120, setup_wns=-0.11),
            profile["epsilon"],
        )
        == "better"
    )
    assert (
        compare_observations(
            profile["reference"],
            _terminal(8, 5, 120, setup_wns=-0.20),
            profile["epsilon"],
        )
        == "timing_regression"
    )
    assert (
        compare_observations(
            profile["reference"],
            _terminal(10, 5, 103, setup_wns=-0.11),
            profile["epsilon"],
        )
        == "noise_tie"
    )


def test_design_and_pool_qualification_require_signal_improvement_and_diversity() -> (
    None
):
    baseline = _terminal(10, 5, 100)
    defaults = (baseline, baseline, baseline)
    gcd = qualify_design(
        baseline,
        defaults,
        {
            "density-decrease": _terminal(8, 5, 101),
            "density-increase": _terminal(14, 5, 99),
            "padding-decrease": baseline,
            "padding-increase": baseline,
            "routability-toggle": baseline,
        },
    )
    cia = qualify_design(
        baseline,
        defaults,
        {
            "density-decrease": baseline,
            "density-increase": baseline,
            "padding-decrease": _terminal(7, 5, 100),
            "padding-increase": _terminal(13, 5, 100),
            "routability-toggle": baseline,
        },
    )

    assert gcd["qualified"] is True
    assert gcd["distinct_probe_count"] == 2
    assert gcd["best_probe_id"] == "density-decrease"
    pool = qualify_pool({"gcd": gcd, "cia": cia, "i2c": cia})
    assert pool == {
        "qualified": True,
        "all_designs_qualified": True,
        "best_probe_diversity": 2,
    }


def test_design_fails_without_two_distinct_probes_and_one_improvement() -> None:
    baseline = _terminal(10, 5, 100)
    report = qualify_design(
        baseline,
        (baseline, baseline, baseline),
        {
            "density-decrease": _terminal(11, 5, 100),
            "density-increase": baseline,
            "padding-decrease": baseline,
            "padding-increase": baseline,
            "routability-toggle": baseline,
        },
    )

    assert report["qualified"] is False
    assert report["distinct_probe_count"] == 1
    assert report["improving_probe_count"] == 0


def test_candidate_receipt_fails_closed_without_bound_terminal_evidence() -> None:
    receipt = CandidateExecutionReceipt(
        execution_id="operation-1",
        started=True,
        outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        evidence=CandidateExecutionEvidence(
            candidate_root_ref=".agent/candidates/candidate-1",
            candidate_manifest_ref=".agent/candidates/candidate-1/candidate-manifest.json",
            candidate_manifest_sha256=HASH,
        ),
    )

    with pytest.raises(Gate0Error, match="native parameter application receipt"):
        require_terminal_receipt(receipt)


def test_recording_rpc_keeps_candidate_call_when_revision_is_checked() -> None:
    client = SimpleNamespace(call=lambda method, params: {"method": method})
    recording = gate0._RecordingRpc(client)

    recording.call("candidate.rerun", {"candidateId": "candidate-1"})
    recording.call("rpc.hello", {"version": 1})

    assert recording.call_record == {
        "method": "candidate.rerun",
        "params": {"candidateId": "candidate-1"},
        "response": {"method": "candidate.rerun"},
    }


def test_success_candidate_rejects_missing_native_parameter_receipt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    class SuccessfulAdapter:
        def __init__(self, *_args, **_kwargs):
            pass

        def start(self, _request):
            return CandidateExecutionReceipt(
                execution_id="execution-1",
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                evidence=CandidateExecutionEvidence(
                    candidate_root_ref=".agent/candidates/candidate-1",
                    candidate_manifest_ref=(
                        ".agent/candidates/candidate-1/analysis/candidate_workspace.v1.json"
                    ),
                    candidate_manifest_sha256=HASH,
                ),
            )

    monkeypatch.setattr(gate0, "EccCandidateRerunAdapter", SuccessfulAdapter)
    monkeypatch.setattr(gate0, "_pilot_context_sha256", lambda *_args: HASH)

    with pytest.raises(Gate0Error, match="native parameter application receipt"):
        run_pilot_candidate(
            SimpleNamespace(ecc_revision=lambda: "ecc-test-revision"),
            "workspace-1",
            tmp_path,
            200,
            _terminal(0, 0, 100),
            RequestedKnobValue(knob_id="place.target_density", value=0.2),
            StrategyDirection.INCREASE,
            "candidate-1",
            tmp_path / "candidate",
            HASH,
            1,
        )


def test_failed_candidate_records_parent_and_chargeable_receipt(
    monkeypatch, tmp_path: Path
) -> None:
    class FailedAdapter:
        def __init__(self, *_args, **_kwargs):
            pass

        def start(self, _request):
            return CandidateExecutionReceipt(
                execution_id="execution-1",
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
            )

    monkeypatch.setattr(gate0, "EccCandidateRerunAdapter", FailedAdapter)
    monkeypatch.setattr(gate0, "_pilot_context_sha256", lambda *_args: HASH)
    output = tmp_path / "candidate"
    parent_ref = ".agent/candidates/incumbent-1"

    with pytest.raises(PilotCandidateExecutionError):
        run_pilot_candidate(
            SimpleNamespace(ecc_revision=lambda: "ecc-test-revision"),
            "workspace-1",
            tmp_path,
            200,
            _terminal(10, 5, 100),
            RequestedKnobValue(knob_id="place.target_density", value=0.15),
            StrategyDirection.DECREASE,
            "candidate-1",
            output,
            HASH,
            60,
            parent_candidate_root_ref=parent_ref,
        )

    request = json.loads(
        (output / "candidate-request.v1.json").read_text(encoding="utf-8")
    )
    receipt = json.loads(
        (output / "execution-receipt.v1.json").read_text(encoding="utf-8")
    )
    assert request["parent_candidate_root_ref"] == parent_ref
    assert request["context_sha256"] == HASH
    assert receipt == {
        "execution_id": "execution-1",
        "outcome": "execution_failed",
        "started": True,
    }


def test_pilot_candidate_uses_resume_rpc_for_existing_workspace(
    monkeypatch, tmp_path: Path
) -> None:
    calls = []

    class ResumeAdapter:
        def __init__(self, *_args, **_kwargs):
            pass

        def resume(self, request):
            calls.append(request.intervention_id)
            return CandidateExecutionReceipt(
                execution_id="execution-1",
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
            )

    monkeypatch.setattr(gate0, "EccCandidateRerunAdapter", ResumeAdapter)
    monkeypatch.setattr(gate0, "_pilot_context_sha256", lambda *_args: HASH)

    with pytest.raises(PilotCandidateExecutionError):
        run_pilot_candidate(
            SimpleNamespace(ecc_revision=lambda: "ecc-test-revision"),
            "workspace-1",
            tmp_path,
            200,
            _terminal(10, 5, 100),
            RequestedKnobValue(knob_id="place.target_density", value=0.15),
            StrategyDirection.DECREASE,
            "candidate-1",
            tmp_path / "resume",
            HASH,
            60,
            resume_existing=True,
        )

    assert calls == ["candidate-1"]


def test_pilot_context_uses_complete_domain_fingerprint(
    monkeypatch, tmp_path: Path
) -> None:
    execution_context = {
        "design_sha256": HASH,
        "rtl_sha256": HASH,
        "filelist_sha256": HASH,
        "sdc_sha256": HASH,
        "pdk_sha256": HASH,
        "parent_lineage_sha256": HASH,
        "parent_manifest_sha256": HASH,
        "ecc_revision": "ecc-test-revision",
        "site_width_dbu": 200,
        "seed": 0,
    }
    current_values = {
        "floorplan.core_util": 0.5,
        "floorplan.aspect_ratio": 1.0,
        "synth.max_fanout": 24,
        "place.target_density": 0.6,
        "place.target_overflow": 0.1,
        "place.cell_padding_x": 1,
        "place.routability_opt": True,
        "place.density_weight": 8e-5,
    }
    monkeypatch.setattr(
        gate0, "_incumbent_workspace", lambda workspace, _ref: workspace
    )
    monkeypatch.setattr(gate0, "_parent_manifest_sha256", lambda *_args: HASH)
    monkeypatch.setattr(
        gate0, "_optimization_execution_context", lambda *_args: execution_context
    )
    monkeypatch.setattr(gate0, "_current_values", lambda *_args: current_values)
    requested = RequestedKnobValue(knob_id="place.target_density", value=0.65)

    first = gate0._pilot_context_sha256(
        tmp_path,
        200,
        _terminal(10, 5, 100),
        requested,
        None,
        "ecc-test-revision",
    )
    second = gate0._pilot_context_sha256(
        tmp_path,
        200,
        _terminal(11, 5, 100),
        requested,
        None,
        "ecc-test-revision",
    )

    assert gate0._SHA256.fullmatch(first)
    assert first != second
