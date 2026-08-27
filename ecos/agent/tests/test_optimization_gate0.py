from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

import ecos_agent.optimization_gate0 as gate0
import ecos_agent.optimization_legacy_receipts as legacy_receipts
from ecos_agent.optimization_contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationKnob,
    RequestedKnobValue,
    SignoffGates,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
)
from ecos_agent.optimization_gate0 import (
    Gate0Error,
    PilotCandidateExecutionError,
    build_materialization_application_receipt,
    compare_observations,
    load_gate0_config,
    noise_profile,
    qualify_design,
    qualify_pool,
    require_terminal_receipt,
    run_pilot_candidate,
)
from ecos_agent.optimization_legacy_receipts import Gate0ReceiptError
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_ledger import OptimizationOutcomeKind

HASH = "sha256:" + "a" * 64


def test_legacy_receipt_parser_rejects_unknown_knob() -> None:
    with pytest.raises(Gate0ReceiptError, match="does not support this knob"):
        legacy_receipts._runtime_values(  # type: ignore[attr-defined]
            Path("/tmp"),
            None,  # type: ignore[arg-type]
            SimpleNamespace(knob_id="future.knob"),  # type: ignore[arg-type]
            0,
            1,
        )


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
            {"probe_id": "density-decrease", "knob_id": "place.target_density", "delta": -0.05},
            {"probe_id": "density-increase", "knob_id": "place.target_density", "delta": 0.05},
            {"probe_id": "padding-decrease", "knob_id": "place.cell_padding_x", "delta": -1},
            {"probe_id": "padding-increase", "knob_id": "place.cell_padding_x", "delta": 1},
            {"probe_id": "routability-toggle", "knob_id": "place.routability_opt", "delta": None},
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
        value = float(candidate_id.rsplit("-", 1)[-1]) if "default" in candidate_id else 0
        return gate0.PilotCandidateRun(_terminal(10, 5, 100 + value), object())

    monkeypatch.setattr(gate0, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(gate0, "_run_canonical", fake_canonical)
    monkeypatch.setattr(gate0, "run_pilot_candidate", fake_candidate)

    report = gate0._run_design(
        tmp_path / "pilot.json",
        config,
        design,
        tmp_path / "design",
        {"ecc": {"executable": "/ecc"}, "pdk": {"site_width_dbu": 200}, "config_sha256": HASH},
        max_workers=3,
        execution_slots=threading.BoundedSemaphore(3),
    )

    assert peak == 3
    assert [item["metrics"]["route_wirelength"] for item in report["default_replays"]] == [101, 102, 103]
    assert list(report["probe_observations"]) == [item.probe_id for item in config.probes]
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
    assert compare_observations(
        profile["reference"], _terminal(8, 5, 120, setup_wns=-0.11), profile["epsilon"]
    ) == "better"
    assert compare_observations(
        profile["reference"], _terminal(8, 5, 120, setup_wns=-0.20), profile["epsilon"]
    ) == "timing_regression"
    assert compare_observations(
        profile["reference"], _terminal(10, 5, 103, setup_wns=-0.11), profile["epsilon"]
    ) == "noise_tie"


def test_design_and_pool_qualification_require_signal_improvement_and_diversity() -> None:
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

    with pytest.raises(Gate0Error, match="application receipt"):
        require_terminal_receipt(receipt)


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
    output = tmp_path / "candidate"
    parent_ref = ".agent/candidates/incumbent-1"

    with pytest.raises(PilotCandidateExecutionError):
        run_pilot_candidate(
            object(),
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
    assert receipt == {
        "execution_id": "execution-1",
        "outcome": "execution_failed",
        "started": True,
    }


def test_materialization_receipt_binds_requested_and_written_value(tmp_path: Path) -> None:
    candidate_ref = ".agent/candidates/candidate-gate0-default"
    candidate = tmp_path / candidate_ref
    config = candidate / "config/dreamplace_ecc.json"
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"target_density": 0.2}), encoding="utf-8")
    snapshot = candidate / "analysis/snapshots/dreamplace.after.json"
    snapshot.parent.mkdir(parents=True)
    snapshot.write_text(config.read_text(encoding="utf-8"), encoding="utf-8")
    before_snapshot = candidate / "analysis/snapshots/dreamplace.before.json"
    before_snapshot.write_text("{}", encoding="utf-8")
    before_sha256 = file_sha256(before_snapshot)
    place_log = candidate / "place_dreamplace/log/place.log"
    place_log.parent.mkdir(parents=True)
    place_log.write_text(
        "[INFO] parameters = {'target_density': 0.2}\n"
        "[WARNING] target_density 0.2 is smaller than utilization 0.726439, ignored\n"
        "utilization = 0.676439, target_density = 0.726439\n"
        "[INFO] new target_density 0.758653\n",
        encoding="utf-8",
    )
    patch = [{"knob_id": "place.target_density", "value": 0.2}]
    materialization = {
        "schema": "ecc.workspace.candidate_materialization.v1",
        "schema_version": 1,
        "candidate_id": candidate.name,
        "target_step": "place",
        "target": {"step": "place"},
        "registry_sha256": HASH,
        "patch": patch,
        "patch_sha256": canonical_sha256(patch),
        "configs": [{
            "config_key": "dreamplace",
            "ref": "config/dreamplace_ecc.json",
            "before_sha256": before_sha256,
            "after_sha256": file_sha256(config),
        }],
        "snapshots": [{
            "config_key": "dreamplace",
            "before_ref": "analysis/snapshots/dreamplace.before.json",
            "before_sha256": before_sha256,
            "after_ref": "analysis/snapshots/dreamplace.after.json",
            "after_sha256": file_sha256(snapshot),
        }],
    }
    materialization["receipt_sha256"] = canonical_sha256(materialization)
    receipt_path = candidate / "analysis/candidate_materialization.v1.json"
    receipt_path.parent.mkdir(exist_ok=True)
    receipt_path.write_text(json.dumps(materialization), encoding="utf-8")
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=candidate_ref,
        candidate_manifest_ref=f"{candidate_ref}/analysis/candidate_workspace.v1.json",
        candidate_manifest_sha256=HASH,
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id=OptimizationKnob.TARGET_DENSITY, value=0.2),
        site_width_dbu=200,
    )

    assert receipt.requested.value == 0.2
    assert receipt.written.value == 0.2
    assert receipt.effective_initial.value == 0.726439
    assert receipt.effective_final.value == 0.758653
    assert len(receipt.runtime_adjustments) == 1
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "effective_target_density": 0.758653,
        "target_density_adjustment_count": 1,
    }
    assert receipt.evidence_sha256 == canonical_sha256({
        "materialization": file_sha256(receipt_path),
        "place_log": file_sha256(place_log),
    })

    place_log.write_text("[INFO] parameters = {'target_density': 0.25}\n", encoding="utf-8")
    with pytest.raises(Gate0Error, match="config value"):
        build_materialization_application_receipt(
            tmp_path,
            evidence,
            RequestedKnobValue(knob_id=OptimizationKnob.TARGET_DENSITY, value=0.2),
            site_width_dbu=200,
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("registry_sha256", "registry-drift", "registry hash"),
        ("config_ref", "config/other.json", "config evidence"),
    ],
)
def test_materialization_receipt_rejects_l1_binding_drift(
    tmp_path: Path, field: str, value: str, message: str
) -> None:
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="place.target_density",
        written=0.2,
        target_step="place",
        config_key="dreamplace",
        config_ref="config/dreamplace_ecc.json",
        config_payload={"target_density": 0.2},
    )
    candidate = tmp_path / evidence.candidate_root_ref
    path = candidate / "analysis/candidate_materialization.v1.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    if field == "config_ref":
        payload["configs"][0]["ref"] = value
    else:
        payload[field] = value
    payload["receipt_sha256"] = canonical_sha256(
        {key: item for key, item in payload.items() if key != "receipt_sha256"}
    )
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(Gate0Error, match=message):
        build_materialization_application_receipt(
            tmp_path,
            evidence,
            RequestedKnobValue(knob_id=OptimizationKnob.TARGET_DENSITY, value=0.2),
            site_width_dbu=200,
        )


def _runtime_receipt_fixture(
    tmp_path: Path,
    *,
    knob_id: str,
    written: object,
    target_step: str,
    config_key: str,
    config_ref: str,
    config_payload: dict[str, object],
) -> CandidateExecutionEvidence:
    candidate_ref = f".agent/candidates/candidate-{knob_id.replace('.', '-')}"
    candidate = tmp_path / candidate_ref
    config = candidate / config_ref
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps(config_payload), encoding="utf-8")
    snapshot = candidate / f"analysis/snapshots/{config_key}.after.json"
    snapshot.parent.mkdir(parents=True)
    snapshot.write_text(config.read_text(encoding="utf-8"), encoding="utf-8")
    before_snapshot = candidate / f"analysis/snapshots/{config_key}.before.json"
    before_snapshot.write_text("{}", encoding="utf-8")
    before_sha256 = file_sha256(before_snapshot)
    patch = [{"knob_id": knob_id, "value": written}]
    materialization = {
        "schema": "ecc.workspace.candidate_materialization.v1",
        "schema_version": 1,
        "candidate_id": candidate.name,
        "target_step": target_step,
        "target": {"step": target_step},
        "registry_sha256": HASH,
        "patch": patch,
        "patch_sha256": canonical_sha256(patch),
        "configs": [{
            "config_key": config_key,
            "ref": config_ref,
            "before_sha256": before_sha256,
            "after_sha256": file_sha256(config),
        }],
        "snapshots": [{
            "config_key": config_key,
            "before_ref": f"analysis/snapshots/{config_key}.before.json",
            "before_sha256": before_sha256,
            "after_ref": f"analysis/snapshots/{config_key}.after.json",
            "after_sha256": file_sha256(snapshot),
        }],
    }
    materialization["receipt_sha256"] = canonical_sha256(materialization)
    (candidate / "analysis/candidate_materialization.v1.json").write_text(
        json.dumps(materialization), encoding="utf-8"
    )
    return CandidateExecutionEvidence(
        candidate_root_ref=candidate_ref,
        candidate_manifest_ref=f"{candidate_ref}/analysis/candidate_workspace.v1.json",
        candidate_manifest_sha256=HASH,
    )


def test_target_overflow_receipt_records_runtime_threshold_result(tmp_path: Path) -> None:
    requested = 0.08
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="place.target_overflow",
        written=requested,
        target_step="place",
        config_key="dreamplace",
        config_ref="config/dreamplace_ecc.json",
        config_payload={"stop_overflow": requested},
    )
    log = tmp_path / evidence.candidate_root_ref / "place_dreamplace/log/place.log"
    log.parent.mkdir(parents=True)
    log.write_text(
        "[INFO] parameters = {'stop_overflow': 0.08}\n"
        "[INFO] iteration 1, DensityWeight 1E-03, Overflow 1.2E-01\n"
        "[INFO] iteration 2, DensityWeight 2E-03, Overflow 7.5E-02\n"
        "[INFO] iteration 3, DensityWeight 3E-03, Overflow 9.0E-02\n",
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id="place.target_overflow", value=requested),
        site_width_dbu=200,
    )

    assert receipt.effective_initial.value == requested
    assert receipt.effective_final.value == requested
    assert receipt.runtime_adjustments == ()
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "final_overflow": 0.09,
        "minimum_overflow": 0.075,
        "target_overflow_reached": True,
    }


def test_routability_receipt_records_runtime_area_adjustments(tmp_path: Path) -> None:
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="place.routability_opt",
        written=True,
        target_step="place",
        config_key="dreamplace",
        config_ref="config/dreamplace_ecc.json",
        config_payload={"routability_opt_flag": 1},
    )
    log = tmp_path / evidence.candidate_root_ref / "place_dreamplace/log/place.log"
    log.parent.mkdir(parents=True)
    log.write_text(
        "[INFO] parameters = {'routability_opt_flag': 1}\n"
        "[INFO] old total movable nodes area 1.000E+02, filler area 1\n"
        "[INFO] new total movable nodes area 1.100E+02, filler area 1\n"
        "[INFO] routability optimization round 0: adjust area flags = "
        "(1, 1, 0) -> (1, 1, 0)\n",
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id="place.routability_opt", value=True),
        site_width_dbu=200,
    )

    assert receipt.effective_initial.value is True
    assert receipt.effective_final.value is True
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "area_adjustment_applied": True,
        "area_adjustment_count": 1,
        "final_movable_area": 110.0,
        "initial_movable_area": 100.0,
        "routability_round_count": 1,
    }


def test_enabled_routability_receipt_records_when_no_action_occurs(tmp_path: Path) -> None:
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="place.routability_opt",
        written=True,
        target_step="place",
        config_key="dreamplace",
        config_ref="config/dreamplace_ecc.json",
        config_payload={"routability_opt_flag": 1},
    )
    log = tmp_path / evidence.candidate_root_ref / "place_dreamplace/log/place.log"
    log.parent.mkdir(parents=True)
    log.write_text(
        "[INFO] parameters = {'routability_opt_flag': 1}\n",
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id="place.routability_opt", value=True),
        site_width_dbu=200,
    )

    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "area_adjustment_applied": False,
        "area_adjustment_count": 0,
        "routability_round_count": 0,
    }


def test_density_weight_receipt_records_runtime_derived_values(tmp_path: Path) -> None:
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="place.density_weight",
        written=0.001,
        target_step="place",
        config_key="dreamplace",
        config_ref="config/dreamplace_ecc.json",
        config_payload={"density_weight": 0.001},
    )
    log = tmp_path / evidence.candidate_root_ref / "place_dreamplace/log/place.log"
    log.parent.mkdir(parents=True)
    log.write_text(
        "[INFO] parameters = {'density_weight': 0.001}\n"
        "[INFO] density_weight = 4.302304E-07\n"
        "[INFO] iteration 1, DensityWeight 4.302304E-07, HPWL 10\n"
        "[INFO] iteration 2, DensityWeight 2.717005E-03, HPWL 9\n",
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id="place.density_weight", value=0.001),
        site_width_dbu=200,
    )

    assert receipt.written.value == 0.001
    assert receipt.effective_initial.value == 4.302304e-07
    assert receipt.effective_final.value == 0.002717005
    assert len(receipt.runtime_adjustments) == 1
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "final_density_weight": 0.002717005,
        "initial_density_weight": 4.302304e-07,
    }


def test_cell_padding_receipt_records_the_runtime_capacity_cap(tmp_path: Path) -> None:
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="place.cell_padding_x",
        written=400,
        target_step="place",
        config_key="dreamplace",
        config_ref="config/dreamplace_ecc.json",
        config_payload={"cell_padding_x": 400},
    )
    log = tmp_path / evidence.candidate_root_ref / "place_dreamplace/log/place.log"
    log.parent.mkdir(parents=True)
    log.write_text(
        "[INFO] parameters = {'cell_padding_x': 400}\n"
        "[WARNING] cell_padding_x 2 would increase movable area; reducing it to 1\n",
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id="place.cell_padding_x", value=2),
        site_width_dbu=200,
    )

    assert receipt.written.value == 400
    assert receipt.effective_initial.value == 400
    assert receipt.effective_final.value == 200
    assert receipt.runtime_adjustments[0].reason == "DreamPlace cell-padding capacity cap"
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "applied_cell_padding_dbu": 200,
        "cell_padding_capacity_cap_count": 1,
    }


@pytest.mark.parametrize(
    "knob_id,requested,achieved_value",
    [
        ("floorplan.core_util", 0.6, 0.58),
        ("floorplan.aspect_ratio", 1.33, 1.28),
    ],
)
def test_floorplan_receipt_uses_ifp_runtime_and_layout_result(
    tmp_path: Path, knob_id: str, requested: float, achieved_value: float
) -> None:
    core_key = "Utilitization" if knob_id.endswith("core_util") else "Aspect ratio"
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id=knob_id,
        written=requested,
        target_step="Floorplan",
        config_key="parameters",
        config_ref="home/parameters.json",
        config_payload={"Core": {core_key: requested}},
    )
    candidate = tmp_path / evidence.candidate_root_ref
    (candidate / "Floorplan_ecc/log").mkdir(parents=True)
    (candidate / "Floorplan_ecc/log/Floorplan.log").write_text(
        "aspect_ratio: 1.33, utilization: 0.6\n", encoding="utf-8"
    )
    feature = candidate / "Floorplan_ecc/feature/Floorplan.db.json"
    feature.parent.mkdir(parents=True)
    feature.write_text(
        json.dumps({
            "Design Layout": {
                "core_usage": 0.58,
                "core_bounding_width": 64.0,
                "core_bounding_height": 50.0,
            }
        }),
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id=knob_id, value=requested),
        site_width_dbu=200,
    )

    assert receipt.effective_initial.value == requested
    assert receipt.effective_final.value == requested
    assert receipt.runtime_adjustments == ()
    expected_metric = (
        "achieved_core_utilization"
        if knob_id == "floorplan.core_util"
        else "achieved_core_aspect_ratio"
    )
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        expected_metric: achieved_value
    }


def test_fixfanout_receipt_uses_the_native_runtime_limit(tmp_path: Path) -> None:
    evidence = _runtime_receipt_fixture(
        tmp_path,
        knob_id="synth.max_fanout",
        written=24,
        target_step="fixFanout",
        config_key="fixFanout",
        config_ref="config/fixfanout_ecc.json",
        config_payload={"max_fanout": 24},
    )
    log = tmp_path / evidence.candidate_root_ref / "fixFanout_ecc/log/fixFanout.log"
    log.parent.mkdir(parents=True)
    log.write_text(
        "ZH fixFanout\n"
        "  max_fanout: 24\n"
        "Total fixed 2 nets, inserted 4 nets and 4 buffers\n",
        encoding="utf-8",
    )

    receipt = build_materialization_application_receipt(
        tmp_path,
        evidence,
        RequestedKnobValue(knob_id="synth.max_fanout", value=24),
        site_width_dbu=200,
    )

    assert receipt.effective_initial.value == 24
    assert receipt.effective_final.value == 24
    assert {item.metric: item.value for item in receipt.runtime_observations} == {
        "fanout_fix_completed": True,
        "fixed_net_count": 2,
        "inserted_buffer_count": 4,
        "inserted_net_count": 4,
    }
