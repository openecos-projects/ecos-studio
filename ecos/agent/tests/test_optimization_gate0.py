from __future__ import annotations

import json
from pathlib import Path

import pytest

import ecos_agent.optimization_gate0 as gate0
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
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_ledger import OptimizationOutcomeKind

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
            "before_sha256": HASH,
            "after_sha256": file_sha256(config),
        }],
        "snapshots": [{
            "config_key": "dreamplace",
            "before_ref": "analysis/snapshots/dreamplace.before.json",
            "before_sha256": HASH,
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
