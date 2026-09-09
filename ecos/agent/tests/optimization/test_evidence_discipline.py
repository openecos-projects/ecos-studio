"""ECC-QoR draft 3 evidence discipline: consistency, inflation, states, severity."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from ecos_agent.optimization.evidence import (
    DRC_SEVERITY_REFERENCE,
    NVP_SEVERITY_REFERENCE,
    consistency_violations,
    derive_clock_period_ns,
    inflation_engineering_state,
    interconnect_inflation_metrics,
    recovery_severity_entries,
    timing_engineering_state,
)
from ecos_agent.optimization.observations import build_terminal_observation

from tests.optimization.observation_support import (
    _metrics,
    _write_json,
    frozen_workspace,
)


def _metrics_by_path(**overrides: dict[str, float]) -> dict[str, dict[str, float]]:
    base = {
        "place_dreamplace/analysis/qor_metrics.json": {
            "place_hpwl": 3143.52,
            "place_grwl": 3812.0,
            "net_count": 1420.0,
        },
        "route_ecc/analysis/qor_metrics.json": {
            "route_wirelength": 4315.53,
            "route_via_count": 1705.0,
            "net_count": 1420.0,
        },
        "sta_ecc/analysis/qor_metrics.json": {
            "sta_setup_wns": 0.2,
            "sta_setup_violation_count": 0.0,
            "sta_hold_wns": 0.1,
            "sta_hold_violation_count": 0.0,
        },
    }
    for path, values in overrides.items():
        base[path] = {**base.get(path, {}), **values}
    return base


class TestConsistencyViolations:
    def test_consistent_workspace_has_no_violations(self) -> None:
        assert consistency_violations(_metrics_by_path()) == ()

    def test_c1_flags_wirelength_below_hpwl(self) -> None:
        violations = consistency_violations(
            _metrics_by_path(
                **{
                    "route_ecc/analysis/qor_metrics.json": {
                        "route_wirelength": 3000.0,
                    }
                }
            )
        )
        assert violations == ("c1_route_wirelength_below_hpwl",)

    def test_c1_is_not_applicable_across_different_net_populations(self) -> None:
        violations = consistency_violations(
            _metrics_by_path(
                **{
                    "route_ecc/analysis/qor_metrics.json": {
                        "route_wirelength": 3000.0,
                        "net_count": 1422.0,
                    }
                }
            )
        )
        assert violations == ()

    def test_c2_flags_slack_count_contradiction(self) -> None:
        violations = consistency_violations(
            _metrics_by_path(
                **{
                    "sta_ecc/analysis/qor_metrics.json": {
                        "sta_setup_wns": 0.05,
                        "sta_setup_violation_count": 3.0,
                    }
                }
            )
        )
        assert violations == ("c2_setup_slack_violation_contradiction",)

    def test_c2_accepts_negative_slack_with_matching_count(self) -> None:
        violations = consistency_violations(
            _metrics_by_path(
                **{
                    "sta_ecc/analysis/qor_metrics.json": {
                        "sta_setup_wns": -0.25,
                        "sta_setup_violation_count": 4.0,
                    }
                }
            )
        )
        assert violations == ()

    def test_c3_flags_vias_without_wirelength(self) -> None:
        violations = consistency_violations(
            _metrics_by_path(
                **{
                    "route_ecc/analysis/qor_metrics.json": {
                        "route_wirelength": 0.0,
                    }
                }
            )
        )
        assert "c3_via_count_without_wirelength" in violations


class TestInterconnectInflation:
    def test_emits_place_route_total_with_exact_identity(self) -> None:
        records = interconnect_inflation_metrics(_metrics_by_path())
        values = {record.metric_id: record.value for record in records}
        assert set(values) == {
            "interconnect_inflation_place",
            "interconnect_inflation_route",
            "interconnect_inflation_total",
        }
        assert values["interconnect_inflation_place"] == pytest.approx(1.212653)
        assert values["interconnect_inflation_route"] == pytest.approx(1.132091)
        assert values["interconnect_inflation_total"] == pytest.approx(1.372834)
        # Baseline invariance: every record cites the same workspace stages.
        for record in records:
            assert set(record.source_refs) == {
                "place_dreamplace/analysis/qor_metrics.json",
                "route_ecc/analysis/qor_metrics.json",
            }

    def test_missing_place_operands_suppress_the_ratios(self) -> None:
        metrics = _metrics_by_path()
        del metrics["place_dreamplace/analysis/qor_metrics.json"]
        assert interconnect_inflation_metrics(metrics) == ()

    def test_non_positive_denominator_suppresses_the_ratios(self) -> None:
        metrics = _metrics_by_path(
            **{
                "place_dreamplace/analysis/qor_metrics.json": {
                    "place_hpwl": 0.0,
                    "place_grwl": 3812.0,
                }
            }
        )
        assert interconnect_inflation_metrics(metrics) == ()


class TestClockPeriodAndStates:
    def test_clock_period_inverts_the_sta_frequency_definition(self) -> None:
        # frequency_mhz = 1000/(Tclk - WS): 296 MHz with WS +16.622 -> 20 ns.
        assert derive_clock_period_ns(16.622, 296.0) == pytest.approx(20.0, abs=1e-3)

    def test_clock_period_is_unknown_without_operands(self) -> None:
        assert derive_clock_period_ns(None, 296.0) is None
        assert derive_clock_period_ns(1.0, None) is None
        assert derive_clock_period_ns(1.0, 0.0) is None

    def test_timing_states_follow_the_document_triplet(self) -> None:
        period = 20.0  # guardband 1.0 ns, over-provision 4.0 ns
        assert timing_engineering_state(-0.25, period)["state"] == "FAIL"
        assert timing_engineering_state(0.5, period)["state"] == "WATCH"
        assert timing_engineering_state(2.0, period)["state"] == "PASS"
        assert timing_engineering_state(16.622, period)["state"] == "OPPORTUNITY"
        assert timing_engineering_state(2.0, None) is None

    def test_inflation_states_use_the_calibration_band(self) -> None:
        assert inflation_engineering_state(1.05)["state"] == "PREFERRED"
        assert inflation_engineering_state(1.373)["state"] == "WATCH"
        assert inflation_engineering_state(1.9)["state"] == "FAIL"
        assert inflation_engineering_state(None) is None


class TestRecoverySeverity:
    def test_severity_spans_the_document_band_and_orders_by_magnitude(self) -> None:
        entries = recovery_severity_entries(
            drc_count=120.0,
            setup_violation_count=2.0,
            hold_violation_count=0.0,
            setup_ws_ns=-2.5,
            hold_ws_ns=0.1,
            clock_period_ns=20.0,
        )
        assert [entry["metric_id"] for entry in entries] == [
            "drc_count",
            "sta_setup_wns",
            "sta_setup_violation_count",
        ]
        assert entries[0]["severity"] == pytest.approx(1.0)
        # |WS|/tau_fail = 2.5/4.0 -> 0.80 + 0.20*0.625 = 0.925
        assert entries[1]["severity"] == pytest.approx(0.925)
        assert entries[2]["severity"] == pytest.approx(
            0.80 + 0.20 * 2.0 / NVP_SEVERITY_REFERENCE
        )
        for entry in entries:
            assert 0.80 <= float(entry["severity"]) <= 1.0
            assert entry["tier"] == "tier_1_feasibility"

    def test_marginal_violation_still_outranks_the_band_floor(self) -> None:
        entries = recovery_severity_entries(
            drc_count=1.0,
            setup_violation_count=None,
            hold_violation_count=None,
            setup_ws_ns=None,
            hold_ws_ns=None,
            clock_period_ns=None,
        )
        assert entries[0]["severity"] == pytest.approx(
            0.80 + 0.20 / DRC_SEVERITY_REFERENCE
        )

    def test_clean_workspace_has_no_entries(self) -> None:
        assert (
            recovery_severity_entries(
                drc_count=0.0,
                setup_violation_count=0.0,
                hold_violation_count=0.0,
                setup_ws_ns=1.0,
                hold_ws_ns=1.0,
                clock_period_ns=20.0,
            )
            == ()
        )


class TestWorkspaceIntegration:
    def test_inflation_records_attach_to_terminal_observation(
        self, frozen_workspace: Path
    ) -> None:
        _write_json(
            frozen_workspace / "place_dreamplace/analysis/qor_metrics.json",
            _metrics(
                ("place_lutrudy_utilization_max", 0.88),
                ("place_total_wirelength", 123.0),
                ("place_hpwl", 3000.0),
                ("place_grwl", 3600.0),
                ("runtime_seconds", 1.0),
                ("peak_memory_mb", 100.0),
            ),
        )
        observation = build_terminal_observation(frozen_workspace)
        values = {
            metric.metric_id: metric.value
            for metric in observation.evaluation_metrics
            if metric.metric_id.startswith("interconnect_inflation_")
        }
        assert values == {
            "interconnect_inflation_place": pytest.approx(1.2),
            "interconnect_inflation_route": pytest.approx(1.456594),
            "interconnect_inflation_total": pytest.approx(1.747914),
        }
        assert observation.consistency_violations == ()
        assert observation.eligible_for_incumbent

    def test_c1_violation_blocks_eligibility_as_evidence_gap(
        self, frozen_workspace: Path
    ) -> None:
        _write_json(
            frozen_workspace / "place_dreamplace/analysis/qor_metrics.json",
            _metrics(
                ("place_lutrudy_utilization_max", 0.88),
                ("place_total_wirelength", 123.0),
                ("place_hpwl", 9999.0),
                ("place_grwl", 3600.0),
                ("runtime_seconds", 1.0),
                ("peak_memory_mb", 100.0),
            ),
        )
        observation = build_terminal_observation(frozen_workspace)
        assert observation.consistency_violations == (
            "c1_route_wirelength_below_hpwl",
        )
        assert not observation.eligible_for_incumbent
        # A contradiction is an evidence problem, never a physical failure.
        assert observation.evidence_incomplete
        assert not observation.physical_signoff_failure

    def test_physical_failures_are_not_misread_as_evidence_gaps(
        self, frozen_workspace: Path
    ) -> None:
        drc_path = frozen_workspace / "drc_ecc/analysis/qor_metrics.json"
        payload = json.loads(drc_path.read_text(encoding="utf-8"))
        for item in payload["metrics"]:
            if item["id"] == "drc_count":
                item["value"] = 9
        drc_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        checklist = frozen_workspace / "drc_ecc/checklist.json"
        checklist.write_text(
            json.dumps(
                {
                    "status": "ready",
                    "checklist": [{"id": "quality.drc.clean", "state": "fail"}],
                }
            ),
            encoding="utf-8",
        )
        observation = build_terminal_observation(frozen_workspace)
        assert observation.physical_signoff_failure
        assert not observation.evidence_incomplete
