import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    GateResult,
    ObjectiveMetric,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_equal_budget import (
    CandidateTrace,
    EqualBudgetConfig,
    _candidate_resources,
    build_candidate_trace,
    evaluate_equal_budget,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_metric_contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.parameter_evidence_contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    ToolRef,
)

HASH = "sha256:" + "a" * 64


def test_candidate_resources_fail_closed_without_flow_evidence(tmp_path: Path) -> None:
    candidate = tmp_path / ".agent/candidates/candidate-1"
    candidate.mkdir(parents=True)

    with pytest.raises(ValueError, match="candidate resource evidence"):
        _candidate_resources(
            tmp_path,
            ".agent/candidates/candidate-1",
            "place",
        )


def _load_harness():
    path = Path(__file__).parents[1] / "scripts" / "run_equal_budget_harness.py"
    spec = importlib.util.spec_from_file_location("run_equal_budget_harness", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_experiment_runner():
    path = Path(__file__).parents[1] / "scripts" / "run_equal_budget_experiment.py"
    spec = importlib.util.spec_from_file_location("run_equal_budget_experiment", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_functional_smoke_finalizer():
    path = (
        Path(__file__).parents[1]
        / "scripts"
        / "finalize_equal_budget_functional_smoke.py"
    )
    spec = importlib.util.spec_from_file_location(
        "finalize_equal_budget_functional_smoke", path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_equal_budget_counts_receipts_and_aliases() -> None:
    traces = [
        CandidateTrace(
            design_id="gcd",
            candidate_id="c1",
            started=True,
            planning_mode="receipt-aware",
            terminal_success=True,
            terminal_utility=10.0,
            activation_status="used",
            application_signature="a1",
            response_signature="r1",
            alias=True,
            alias_valid=True,
            proposal_outcome="repair",
            runtime_seconds=2.0,
            peak_memory_mb=4.0,
        ),
        CandidateTrace(
            design_id="gcd",
            candidate_id="c2",
            started=True,
            planning_mode="receipt-aware",
            terminal_success=False,
            activation_status="not_activated",
            application_signature="a2",
            response_signature="r2",
            receipt_status="missing",
            proposal_outcome="reject",
            runtime_seconds=3.0,
            peak_memory_mb=8.0,
        ),
        CandidateTrace(
            design_id="gcd",
            candidate_id="c3",
            started=False,
            planning_mode="receipt-aware",
            terminal_success=False,
            alias=True,
            alias_valid=False,
        ),
    ]
    summary = evaluate_equal_budget(
        traces,
        mode="receipt-aware",
        config=EqualBudgetConfig(reference_runtime_seconds=2.0),
        planning_calls=3,
    )
    assert summary.started_candidates == 2
    assert summary.terminal_successes == 1
    assert summary.aliases_saved == 1
    assert summary.wrong_prunes == 1
    assert summary.alias_unassessed == 0
    assert summary.not_activated == 1
    assert summary.overridden_rate == 0.0
    assert summary.ignored_rate == 0.0
    assert summary.not_activated_rate == 0.5
    assert summary.receipt_missing == 1
    assert summary.wall_time_limit_seconds == 44.0
    assert summary.peak_memory_mb == 8.0


def test_requested_only_does_not_claim_alias_savings() -> None:
    trace = CandidateTrace(
        design_id="gcd",
        candidate_id="c1",
        started=False,
        terminal_success=False,
        planning_mode="requested-only",
        alias=True,
    )
    summary = evaluate_equal_budget([trace], mode="requested-only")
    assert summary.aliases_saved == 0
    assert summary.wrong_prunes == 0


def test_receipt_aware_does_not_claim_unverified_aliases() -> None:
    trace = CandidateTrace(
        design_id="gcd",
        candidate_id="c1",
        started=False,
        terminal_success=False,
        planning_mode="receipt-aware",
        alias=True,
    )

    summary = evaluate_equal_budget([trace], mode="receipt-aware")

    assert summary.aliases_saved == 0
    assert summary.wrong_prunes == 0
    assert summary.alias_unassessed == 1


def test_equal_budget_reports_terminal_metrics_and_regret() -> None:
    summary = evaluate_equal_budget(
        [
            CandidateTrace(
                design_id="gcd",
                candidate_id="c1",
                started=True,
                planning_mode="receipt-aware",
                terminal_success=True,
                terminal_utility=8.0,
                reference_utility=10.0,
                ppa=1.2,
                area=12.0,
                dynamic_power=2.5,
                leakage_power=0.4,
                frequency=100.0,
                drc=0.0,
                timing=-0.1,
                congestion=0.3,
            )
        ],
        mode="receipt-aware",
    )
    assert summary.simple_regret == 2.0
    assert summary.ppa == (1.2,)
    assert summary.area == (12.0,)
    assert summary.dynamic_power == (2.5,)
    assert summary.leakage_power == (0.4,)
    assert summary.frequency == (100.0,)
    assert summary.drc == (0.0,)
    assert summary.timing == (-0.1,)
    assert summary.congestion == (0.3,)


def test_equal_budget_computes_simple_regret_per_design() -> None:
    traces = [
        CandidateTrace(
            design_id="d0",
            candidate_id="c0",
            started=True,
            terminal_success=True,
            planning_mode="requested-only",
            terminal_utility=8.0,
            reference_utility=10.0,
        ),
        CandidateTrace(
            design_id="d1",
            candidate_id="c1",
            started=True,
            terminal_success=True,
            planning_mode="requested-only",
            terminal_utility=90.0,
            reference_utility=100.0,
        ),
    ]

    summary = evaluate_equal_budget(traces, mode="requested-only")

    assert summary.simple_regret_by_design == {"d0": 2.0, "d1": 10.0}
    assert summary.simple_regret == 6.0


def test_build_candidate_trace_uses_native_receipt_and_terminal_metrics() -> None:
    receipt_payload = {
        "receipt_id": "receipt-1",
        "tool": ToolRef(name="DREAMPlace", revision="bound"),
        "context": {"stage": "place"},
        "requested": {
            "knob_id": "place.target_density",
            "value": 0.2,
            "unit": "ratio",
        },
        "materialization": MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=HASH,
            config_after_sha256=HASH,
            written_value=0.2,
            unit="ratio",
        ),
        "effective_initial": EffectiveValue(value=0.8, unit="ratio"),
        "transitions": (),
        "application_status": "applied",
        "activation": ActivationEvidence(
            status="used",
            consumers=(
                {
                    "consumer_id": "dreamplace.density_objective",
                    "outcome": "entered",
                    "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                    "evidence_sha256": HASH,
                },
            ),
        ),
        "effective_final": EffectiveValue(value=0.8, unit="ratio"),
    }
    receipt = ParameterApplicationReceipt.model_construct(
        **receipt_payload,
        evidence_sha256=HASH,
    )
    terminal = _terminal_observation()
    reference = terminal.model_copy(
        update={
            "observation_id": "reference",
            "metrics": {
                **terminal.metrics,
                ObjectiveMetric.ROUTE_WIRELENGTH: 5.0,
            },
        }
    )

    trace = build_candidate_trace(
        design_id="gcd",
        candidate_id="episode-1.intervention-1",
        planning_mode="receipt-aware",
        outcome=OptimizationOutcomeKind.IMPROVED,
        receipt=receipt,
        terminal_observation=terminal,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        runtime_seconds=12.0,
        peak_memory_mb=64.0,
    )

    assert trace.terminal_success is True
    assert trace.terminal_utility == -4.0
    assert trace.reference_utility == -5.0
    assert trace.area == 12.0
    assert trace.dynamic_power == 2.5
    assert trace.leakage_power == 0.4
    assert trace.frequency == 100.0
    assert trace.drc == 0.0
    assert trace.timing == 0.0
    assert trace.congestion == 3.0
    assert trace.activation_status == "used"
    assert trace.application_signature is not None
    assert trace.response_signature is not None
    assert trace.receipt_status == "ok"


def _terminal_observation() -> TerminalObservation:
    eligibility_ids = (
        "drc_count",
        "lvs_count",
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "rcx_missing_corner_count",
        "rcx_spef_parse_failure_count",
        "sta_corner_count",
        "sta_expected_corner_count",
        "sta_missing_corner_count",
        "sta_setup_violation_count",
        "sta_hold_violation_count",
        "harden_artifact_missing_count",
    )
    evaluation = [
        TerminalEvaluationMetric(
            metric_id=metric_id,
            value=(
                1.0
                if metric_id
                in {
                    "rcx_expected_corner_count",
                    "rcx_spef_file_count",
                    "sta_corner_count",
                    "sta_expected_corner_count",
                }
                else 0.0
            ),
            unit="count",
            category=EvaluationMetricCategory.ELIGIBILITY,
            role=EvaluationMetricRole.GATE,
            direction=EvaluationMetricDirection.EXACT,
            source_refs=("analysis/terminal.json",),
        )
        for metric_id in eligibility_ids
    ]
    for metric_id, value, unit in (
        ("sta_standard_cell_area", 12.0, "um^2"),
        ("sta_typical_dynamic_power", 2.5, "uW"),
        ("sta_typical_leakage_power", 0.4, "uW"),
        ("sta_frequency", 100.0, "MHz"),
    ):
        evaluation.append(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=value,
                unit=unit,
                category=EvaluationMetricCategory.PPA,
                role=EvaluationMetricRole.REPORT,
                direction=EvaluationMetricDirection.LOWER_IS_BETTER,
                source_refs=("analysis/terminal.json",),
            )
        )
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id="candidate",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 2.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 3.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 4.0,
        },
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
        evaluation_metrics=tuple(evaluation),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )


def test_harness_keeps_preexecution_only_trace_not_run(tmp_path) -> None:
    harness = _load_harness()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": [f"d{i}" for i in range(10)]}))
    traces = tmp_path / "traces.jsonl"
    traces.write_text(
        json.dumps(
            {
                "design_id": "d0",
                "candidate_id": "c1",
                "started": False,
                "terminal_success": False,
                "planning_mode": "requested-only",
            }
        )
        + "\n"
    )

    result = harness.run(
        manifest,
        tmp_path / "out",
        traces,
        None,
        requested_only_planning_calls=1,
        receipt_aware_planning_calls=1,
    )

    assert result["status"] == "not_run"


def test_harness_requires_reproducibility_metadata_for_started_trace(tmp_path) -> None:
    harness = _load_harness()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": [f"d{i}" for i in range(10)]}))
    traces = tmp_path / "traces.jsonl"
    traces.write_text(
        json.dumps(
            {
                "design_id": "d0",
                "candidate_id": "c1",
                "started": True,
                "terminal_success": False,
                "planning_mode": "receipt-aware",
                "receipt_status": "ok",
            }
        )
        + "\n"
    )

    with pytest.raises(ValueError, match="reproducibility metadata"):
        harness.run(
            manifest,
            tmp_path / "out",
            None,
            traces,
            requested_only_planning_calls=1,
            receipt_aware_planning_calls=1,
        )


def test_harness_requires_two_full_independent_design_covered_runs(tmp_path) -> None:
    harness = _load_harness()
    design_ids = [f"d{i}" for i in range(10)]
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": design_ids}))
    requested = tmp_path / "requested.jsonl"
    receipt = tmp_path / "receipt.jsonl"
    full = "".join(
        json.dumps(
            {
                "design_id": design_ids[index % 10],
                "candidate_id": f"c{index}",
                "started": True,
                "terminal_success": False,
                "planning_mode": "requested-only",
                "receipt_status": "ok",
            }
        )
        + "\n"
        for index in range(20)
    )
    requested.write_text(full)
    receipt.write_text(
        "".join(
            json.dumps(
                {
                    "design_id": design_ids[index % 10],
                    "candidate_id": f"r{index}",
                    "started": True,
                    "terminal_success": False,
                    "planning_mode": "receipt-aware",
                    "activation_status": "used",
                    "application_signature": f"app-{index}",
                    "response_signature": f"resp-{index}",
                    "receipt_status": "ok",
                }
            )
            + "\n"
            for index in range(20)
        )
    )
    metadata = {
        "reference_runtime_seconds_by_design": {
            design_id: 1.0 for design_id in design_ids
        },
        "elapsed_wall_time_seconds_by_mode": {
            mode: {design_id: 1.0 for design_id in design_ids}
            for mode in ("requested_only", "receipt_aware")
        },
        "seed": 0,
        "tool_revision": "ecc-test",
        "input_manifest_sha256": "sha256:" + "a" * 64,
    }

    completed = harness.run(
        manifest,
        tmp_path / "complete",
        requested,
        receipt,
        requested_only_planning_calls=20,
        receipt_aware_planning_calls=20,
        **metadata,
    )
    incomplete = harness.run(
        manifest,
        tmp_path / "incomplete",
        requested,
        None,
        requested_only_planning_calls=20,
        receipt_aware_planning_calls=0,
        **metadata,
    )

    assert completed["status"] == "completed"
    assert completed["requested_only_raw_trace_sha256"] != ""
    assert completed["receipt_aware_raw_trace_sha256"] != ""
    assert completed["wall_time_limit_seconds_by_design"] == {
        design_id: 22.0 for design_id in design_ids
    }
    assert incomplete["status"] == "incomplete"

    over_budget_rows = [json.loads(line) for line in full.splitlines()]
    over_budget_rows[0]["runtime_seconds"] = 23.0
    over_budget = tmp_path / "over-budget.jsonl"
    over_budget.write_text(
        "".join(json.dumps(row) + "\n" for row in over_budget_rows),
        encoding="utf-8",
    )
    exceeded = harness.run(
        manifest,
        tmp_path / "exceeded",
        over_budget,
        receipt,
        requested_only_planning_calls=20,
        receipt_aware_planning_calls=20,
        **metadata,
    )
    assert exceeded["status"] == "incomplete"
    assert exceeded["runtime_seconds_by_design"]["requested_only"]["d0"] == 23.0

    with pytest.raises(ValueError, match="independent candidate executions"):
        overlapping_receipt = tmp_path / "overlap.jsonl"
        overlapping_receipt.write_text(
            full.replace(
                '"planning_mode": "requested-only"',
                '"planning_mode": "receipt-aware"',
            )
        )
        harness.run(
            manifest,
            tmp_path / "reused",
            requested,
            overlapping_receipt,
            requested_only_planning_calls=20,
            receipt_aware_planning_calls=20,
            **metadata,
        )


def test_harness_separates_completed_functional_smoke_from_research_evaluation(
    tmp_path,
) -> None:
    harness = _load_harness()
    design_ids = [f"d{i}" for i in range(10)]
    smoke_ids = design_ids[:6]
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": design_ids}), encoding="utf-8")

    def write_traces(path: Path, mode: str, prefix: str) -> None:
        path.write_text(
            "".join(
                json.dumps(
                        {
                            "design_id": design_id,
                            "candidate_id": f"{prefix}-{design_id}-{index}",
                            "started": True,
                            "terminal_success": True,
                            "planning_mode": mode,
                            "receipt_status": "ok",
                            "application_status": "applied",
                            "activation_status": "used",
                        }
                )
                + "\n"
                for design_id in smoke_ids
                for index in range(2)
            ),
            encoding="utf-8",
        )

    requested = tmp_path / "requested.jsonl"
    receipt = tmp_path / "receipt.jsonl"
    write_traces(requested, "requested-only", "requested")
    write_traces(receipt, "receipt-aware", "receipt")
    runtimes = {design_id: 10.0 for design_id in smoke_ids}
    elapsed = {
        mode: {design_id: 100.0 for design_id in smoke_ids}
        for mode in ("requested_only", "receipt_aware")
    }

    report = harness.run(
        manifest,
        tmp_path / "smoke",
        requested,
        receipt,
        requested_only_planning_calls=12,
        receipt_aware_planning_calls=12,
        reference_runtime_seconds_by_design=runtimes,
        elapsed_wall_time_seconds_by_mode=elapsed,
        functional_smoke_design_ids=tuple(smoke_ids),
        seed=0,
        tool_revision="ecc-test",
        input_manifest_sha256="sha256:" + "a" * 64,
    )

    assert report["status"] == "incomplete"
    assert report["engineering_status"] == "completed"
    assert report["engineering_classification"] == "Engineering Complete"
    assert report["research_evaluation_status"] == "incomplete"
    assert report["research_claim"] == "not_assessed"
    assert report["research_classification"] == "Research Claim Not Assessed"
    assert report["ignored_knobs"] == []
    assert report["design_coverage"] == {
        "observed": smoke_ids,
        "missing": design_ids[6:],
        "required": design_ids,
    }
    assert report["elapsed_wall_time_seconds_by_mode"] == elapsed

    elapsed["receipt_aware"][smoke_ids[0]] = 221.0
    over_budget = harness.run(
        manifest,
        tmp_path / "over-budget-smoke",
        requested,
        receipt,
        requested_only_planning_calls=12,
        receipt_aware_planning_calls=12,
        reference_runtime_seconds_by_design=runtimes,
        elapsed_wall_time_seconds_by_mode=elapsed,
        functional_smoke_design_ids=tuple(smoke_ids),
        seed=0,
        tool_revision="ecc-test",
        input_manifest_sha256="sha256:" + "a" * 64,
    )
    assert over_budget["engineering_status"] == "incomplete"

    elapsed["receipt_aware"][smoke_ids[0]] = 100.0
    rows = [json.loads(line) for line in requested.read_text(encoding="utf-8").splitlines()]
    rows[0]["terminal_success"] = False
    requested.write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )
    failed_terminal = harness.run(
        manifest,
        tmp_path / "failed-terminal-smoke",
        requested,
        receipt,
        requested_only_planning_calls=12,
        receipt_aware_planning_calls=12,
        reference_runtime_seconds_by_design=runtimes,
        elapsed_wall_time_seconds_by_mode=elapsed,
        functional_smoke_design_ids=tuple(smoke_ids),
        seed=0,
        tool_revision="ecc-test",
        input_manifest_sha256="sha256:" + "a" * 64,
    )
    assert failed_terminal["engineering_status"] == "incomplete"


def test_started_trace_requires_mode_and_receipt_measurement(tmp_path) -> None:
    harness = _load_harness()
    design_ids = [f"d{i}" for i in range(10)]
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": design_ids}))
    trace = tmp_path / "trace.jsonl"
    trace.write_text(
        json.dumps(
            {
                "design_id": "d0",
                "candidate_id": "c0",
                "started": True,
                "terminal_success": False,
                "planning_mode": "receipt-aware",
            }
        )
        + "\n"
    )

    with pytest.raises(ValueError, match="started trace lacks receipt measurement"):
        harness.run(
            manifest,
            tmp_path / "out",
            None,
            trace,
            requested_only_planning_calls=0,
            receipt_aware_planning_calls=1,
            reference_runtime_seconds_by_design={
                design_id: 1.0 for design_id in design_ids
            },
            seed=0,
            tool_revision="ecc-test",
            input_manifest_sha256="sha256:" + "a" * 64,
        )


def test_requested_only_trace_keeps_posthoc_receipt_measurement(tmp_path) -> None:
    harness = _load_harness()
    design_ids = [f"d{i}" for i in range(10)]
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": design_ids}))
    trace = tmp_path / "trace.jsonl"
    trace.write_text(
        json.dumps(
            {
                "design_id": "d0",
                "candidate_id": "c0",
                "started": True,
                "terminal_success": False,
                "planning_mode": "requested-only",
                "activation_status": "not_activated",
                "receipt_status": "ok",
            }
        )
        + "\n"
    )

    result = harness.run(
        manifest,
        tmp_path / "out",
        trace,
        None,
        requested_only_planning_calls=1,
        receipt_aware_planning_calls=0,
        reference_runtime_seconds_by_design={
            design_id: 1.0 for design_id in design_ids
        },
        elapsed_wall_time_seconds_by_mode={
            mode: {"d0": 0.0}
            for mode in ("requested_only", "receipt_aware")
        },
        seed=0,
        tool_revision="ecc-test",
        input_manifest_sha256="sha256:" + "a" * 64,
    )

    assert result["requested_only"]["not_activated"] == 1


def test_phase8_runner_loads_hash_bound_ten_design_manifest(tmp_path) -> None:
    runner = _load_experiment_runner()
    benchmark = tmp_path / "benchmarks"
    pdk = tmp_path / "pdk"
    tech = pdk / "prtech/techLEF/N551P6M_ecos.lef"
    tech.parent.mkdir(parents=True)
    tech.write_text("VERSION 5.8 ;\n", encoding="utf-8")
    designs = []
    design_ids = [f"d{i}" for i in range(10)]
    for design_id in design_ids:
        root = benchmark / design_id
        (root / "rtl").mkdir(parents=True)
        rtl = root / "rtl/top.v"
        filelist = root / "filelist.f"
        sdc = root / f"{design_id}.sdc"
        rtl.write_text("module top; endmodule\n", encoding="utf-8")
        filelist.write_text("rtl/top.v\n", encoding="utf-8")
        sdc.write_text("create_clock -period 10 clk\n", encoding="utf-8")
        designs.append(
            {
                "design_id": design_id,
                "top_module": "top",
                "clock_name": "clk",
                "filelist": f"{design_id}/filelist.f",
                "filelist_sha256": runner.file_sha256(filelist),
                "rtl_bundle_sha256": canonical_sha256(
                    {"rtl/top.v": runner.file_sha256(rtl)}
                ),
                "sdc": f"{design_id}/{design_id}.sdc",
                "sdc_sha256": runner.file_sha256(sdc),
            }
        )
    payload = {
        "schema_version": "ecos.frozen_design_manifest.v2",
        "design_ids": design_ids,
        "designs": designs,
        "baseline": {
            "frequency_mhz": 50,
            "max_fanout": 32,
            "core_utilization": 0.4,
            "core_aspect_ratio": 1.0,
            "target_density": 0.2,
            "target_overflow": 0.1,
            "cell_padding_sites": 2,
            "routability_opt": True,
            "density_weight": 0.00085,
        },
        "pdk": {
            "name": "ics55",
            "tech_lef": "prtech/techLEF/N551P6M_ecos.lef",
            "tech_lef_sha256": runner.file_sha256(tech),
        },
    }
    payload["manifest_sha256"] = canonical_sha256(payload)
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")

    loaded = runner.load_experiment_manifest(manifest, benchmark, pdk)

    assert tuple(item.design_id for item in loaded.designs) == tuple(design_ids)
    assert loaded.manifest_sha256 == payload["manifest_sha256"]


def test_phase8_runner_rejects_unsupported_filelist_entry(tmp_path) -> None:
    runner = _load_experiment_runner()
    filelist = tmp_path / "filelist.f"
    filelist.write_text("-f nested.f\n", encoding="utf-8")

    with pytest.raises(ValueError, match="unsupported entry"):
        runner._filelist_refs(filelist)


def test_phase8_runner_uses_gui_origin_for_canonical_flow(tmp_path, monkeypatch) -> None:
    runner = _load_experiment_runner()
    tech = tmp_path / "pdk/prtech/techLEF/N551P6M_ecos.lef"
    tech.parent.mkdir(parents=True)
    tech.write_text(
        "UNITS\n  DATABASE MICRONS 1 ;\nEND UNITS\n"
        "SITE core7\n  SIZE 1 BY 1 ;\nEND core7\n",
        encoding="utf-8",
    )
    baseline = {
        "frequency_mhz": 50,
        "max_fanout": 32,
        "core_utilization": 0.4,
        "core_aspect_ratio": 1.0,
        "target_density": 0.2,
        "target_overflow": 0.1,
        "cell_padding_sites": 2,
        "routability_opt": True,
        "density_weight": 0.00085,
    }
    design = runner.DesignSpec(
        "design",
        "top",
        "clk",
        tmp_path / "filelist.f",
        (tmp_path / "rtl/top.v",),
        tmp_path / "design.sdc",
    )
    manifest = runner.ExperimentManifest(HASH, (design,), baseline, "ics55", tech.parents[2])
    calls = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def _request(self, method, params, *, timeout_seconds):
            calls.append((method, params, timeout_seconds))
            if method == "workspace.create":
                return {"workspaceId": "workspace"}
            return {"operationId": "flow", "state": "succeeded"}

        def close(self) -> None:
            pass

    monkeypatch.setattr(runner, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(runner, "_ecc_executable", lambda: tmp_path / "ecc")
    monkeypatch.setattr(runner, "_verify_workspace_binding", lambda *_args: None)
    monkeypatch.setattr(runner, "_verify_workspace_inputs", lambda *_args: None)
    monkeypatch.setattr(runner, "build_terminal_observation", lambda _workspace: _terminal_observation())

    runner._ensure_workspace(manifest, design, tmp_path / "workspace", 1.0)

    start = next(params for method, params, _ in calls if method == "operation.start_flow")
    assert start["origin"] == "gui"


def test_phase8_runner_resumes_created_unstarted_workspace(
    tmp_path, monkeypatch
) -> None:
    runner = _load_experiment_runner()
    workspace = tmp_path / "workspace"
    (workspace / "home").mkdir(parents=True)
    (workspace / "home/flow.json").write_text(
        json.dumps(
            {
                "steps": [
                    {"name": name, "state": "Unstart"}
                    for name in runner.GUI_WORKSPACE_FLOW_STEPS
                ]
            }
        ),
        encoding="utf-8",
    )
    calls = []
    started = False

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def open_workspace(self, directory):
            calls.append(("workspace.open", directory, None))
            return "workspace"

        def _request(self, method, params, *, timeout_seconds):
            nonlocal started
            calls.append((method, params, timeout_seconds))
            started = True
            return {"operationId": "flow", "state": "succeeded"}

        def close(self) -> None:
            pass

    manifest = object()
    design = runner.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )
    observation = _terminal_observation()
    monkeypatch.setattr(runner, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(runner, "_ecc_executable", lambda: tmp_path / "ecc")
    monkeypatch.setattr(runner, "_verify_workspace_binding", lambda *_args: None)
    monkeypatch.setattr(runner, "_verify_workspace_inputs", lambda *_args: None)
    monkeypatch.setattr(
        runner,
        "build_terminal_observation",
        lambda _workspace: observation
        if started
        else pytest.fail("flow was not resumed"),
    )

    assert runner._ensure_workspace(manifest, design, workspace, 1.0) == observation
    assert calls[0] == ("workspace.open", workspace, None)
    assert calls[1][0] == "operation.start_flow"
    assert calls[1][1]["rerun"] is False


def test_phase8_calibration_uses_three_default_flow_replays(tmp_path, monkeypatch) -> None:
    runner = _load_experiment_runner()
    workspace = tmp_path / "canonical"
    workspace.mkdir()
    (workspace / "marker.txt").write_text("canonical", encoding="utf-8")
    calls = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def open_workspace(self, directory):
            calls.append(("workspace.open", directory, None))
            return "workspace"

        def _request(self, method, params, *, timeout_seconds):
            calls.append((method, params, timeout_seconds))
            return {"operationId": "flow", "state": "succeeded"}

        def close(self) -> None:
            pass

    observation = _terminal_observation()
    design = runner.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )
    monkeypatch.setattr(runner, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(runner, "_ecc_executable", lambda: tmp_path / "ecc")
    monkeypatch.setattr(runner, "_verify_workspace_binding", lambda *_args: None)
    monkeypatch.setattr(runner, "_verify_workspace_inputs", lambda *_args: None)
    monkeypatch.setattr(runner, "build_terminal_observation", lambda _workspace: observation)
    monkeypatch.setattr(runner, "_optimization_rerun_runtime_seconds", lambda _workspace: 12.0)

    reference, runtime = runner._calibrate(
        object(),
        design,
        workspace,
        observation,
        tmp_path / "calibration",
        1.0,
    )

    starts = [params for method, params, _ in calls if method == "operation.start_flow"]
    assert reference == observation
    assert runtime == 12.0
    assert len(starts) == 3
    assert all(item["rerun"] is True for item in starts)
    assert all(item["origin"] == "gui" for item in starts)


def test_phase8_mode_explicitly_exempts_the_reference_baseline(
    tmp_path, monkeypatch
) -> None:
    module = _load_experiment_runner()
    captured = {}

    class FakeProvider:
        def __init__(self, **_kwargs) -> None:
            pass

        def select_model(self, _model) -> None:
            pass

        def close(self) -> None:
            pass

    fake_runner = SimpleNamespace(
        budget=SimpleNamespace(
            consumed_candidates=2,
            consumed_planning_calls=2,
            elapsed_wall_time_seconds=3.0,
        ),
        state=module.OptimizationEpisodeState.PLANNING,
        close=lambda: None,
    )

    def create_runner(context, _provider):
        captured.update(context)
        return fake_runner

    monkeypatch.setattr(module, "CodexAppServerProposalProvider", FakeProvider)
    monkeypatch.setattr(module, "create_optimization_runner", create_runner)
    monkeypatch.setattr(
        module,
        "export_episode_traces",
        lambda **_kwargs: ((), 2, "requested-only"),
    )
    design = module.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )

    module._run_mode(
        design,
        tmp_path / "workspace",
        _terminal_observation(),
        1.0,
        tmp_path / "output",
        run_id="run",
        model="model",
        seed=1,
        mode="requested-only",
    )

    assert captured["baseline_eligibility_exempt"] is True


def test_phase8_functional_smoke_finalizer_never_starts_eda(
    tmp_path, monkeypatch
) -> None:
    module = _load_functional_smoke_finalizer()
    runner = module.experiment
    design_ids = ("gcd", "i2c", "cia", "zipdiv", "cordic", "xtea")
    designs = tuple(
        runner.DesignSpec(
            design_id,
            "top",
            "clk",
            tmp_path / f"{design_id}.f",
            (),
            tmp_path / f"{design_id}.sdc",
        )
        for design_id in design_ids
    )
    manifest = runner.ExperimentManifest(HASH, designs, {}, "ics55", tmp_path)
    output = tmp_path / "output"
    run_root = output / "runs" / "run"
    run_root.mkdir(parents=True)
    captured = {}

    class FakeHarness:
        @staticmethod
        def run(*_args, **kwargs):
            captured.update(kwargs)
            return {
                "status": "incomplete",
                "engineering_status": "completed",
                "research_evaluation_status": "incomplete",
            }

    monkeypatch.setattr(
        runner,
        "_verify_workspace_binding",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        module,
        "_load_existing_calibration",
        lambda _path: (_terminal_observation(), 10.0),
    )
    monkeypatch.setattr(
        module,
        "_export_existing_mode",
        lambda *_args, **kwargs: {
            "traces": (
                SimpleNamespace(
                    design_id=kwargs["design_id"],
                    candidate_id=f"{kwargs['mode']}-1",
                    started=True,
                ),
                SimpleNamespace(
                    design_id=kwargs["design_id"],
                    candidate_id=f"{kwargs['mode']}-2",
                    started=True,
                ),
            ),
            "planning_calls": 2,
            "elapsed_wall_time_seconds": 100.0,
        },
    )
    monkeypatch.setattr(runner, "_load_harness", lambda: FakeHarness)
    monkeypatch.setattr(
        runner,
        "_ensure_workspace",
        lambda *_args, **_kwargs: pytest.fail("finalization started EDA"),
    )

    report = module.finalize_functional_smoke(
        manifest,
        tmp_path / "manifest.json",
        output,
        tmp_path / "workspaces",
        run_id="run",
        seed=1,
        tool_revision="ecc-test",
    )

    assert report["engineering_status"] == "completed"
    assert captured["functional_smoke_design_ids"] == design_ids
    assert captured["reference_runtime_seconds_by_design"] == {
        design_id: 10.0 for design_id in design_ids
    }
    assert captured["elapsed_wall_time_seconds_by_mode"] == {
        mode: {design_id: 100.0 for design_id in design_ids}
        for mode in ("requested_only", "receipt_aware")
    }
    assert (run_root / "run-manifest.v1.json").is_file()


def test_phase8_runner_rejects_workspace_input_drift(tmp_path) -> None:
    runner = _load_experiment_runner()
    workspace = tmp_path / "workspace"
    source = tmp_path / "source"
    pdk = tmp_path / "pdk"
    for root in (
        workspace / "origin/rtl",
        workspace / "home",
        workspace / "config",
        source / "rtl",
    ):
        root.mkdir(parents=True)
    tech = pdk / "prtech/techLEF/N551P6M_ecos.lef"
    tech.parent.mkdir(parents=True)
    tech.write_text(
        "UNITS\n  DATABASE MICRONS 1 ;\nEND UNITS\n"
        "SITE core7\n  SIZE 1 BY 1 ;\nEND core7\n",
        encoding="utf-8",
    )
    (workspace / "origin/rtl/top.v").write_text(
        "module top; endmodule\n", encoding="utf-8"
    )
    (workspace / "origin/filelist.f").write_text("rtl/top.v\n", encoding="utf-8")
    (workspace / "origin/design.sdc").write_text("create_clock clk\n", encoding="utf-8")
    (source / "rtl/top.v").write_text("module top; endmodule\n", encoding="utf-8")
    (source / "filelist.f").write_text("rtl/top.v\n", encoding="utf-8")
    (source / "design.sdc").write_text("create_clock clk\n", encoding="utf-8")
    baseline = {
        "frequency_mhz": 50,
        "max_fanout": 32,
        "core_utilization": 0.4,
        "core_aspect_ratio": 1.0,
        "target_density": 0.2,
        "target_overflow": 0.1,
        "cell_padding_sites": 2,
        "routability_opt": True,
        "density_weight": 0.00085,
    }
    (workspace / "home/parameters.json").write_text(
        json.dumps(
            {
                "Design": "design",
                "Top module": "top",
                "Clock": "clk",
                "PDK Root": str(pdk),
                "Frequency max [MHz]": 50,
            }
        ),
        encoding="utf-8",
    )
    (workspace / "config/dreamplace_ecc.json").write_text(
        json.dumps(
            {
                "target_density": 0.2,
                "stop_overflow": 0.1,
                "cell_padding_x": 2,
                "routability_opt_flag": 1,
                "density_weight": 0.00085,
            }
        ),
        encoding="utf-8",
    )
    (workspace / "config/fixfanout_ecc.json").write_text(
        json.dumps({"max_fanout": 32}), encoding="utf-8"
    )
    (workspace / "config/floorplan_ecc.json").write_text(
        json.dumps(
            {
                "die_builder": {
                    "die_util": {"utilization": 0.4, "aspect_ratio": 1.0}
                }
            }
        ),
        encoding="utf-8",
    )
    design = runner.DesignSpec(
        "design",
        "top",
        "clk",
        source / "filelist.f",
        (source / "rtl/top.v",),
        source / "design.sdc",
    )
    manifest = runner.ExperimentManifest(HASH, (design,), baseline, "ics55", pdk)

    runner._verify_workspace_binding(manifest, design, workspace)
    (workspace / "origin/rtl/top.v").write_text("module drift; endmodule\n")

    with pytest.raises(ValueError, match="workspace RTL bundle does not match"):
        runner._verify_workspace_binding(manifest, design, workspace)
