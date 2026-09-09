import pytest

from ecos_agent.optimization.qor_quality import (
    area_quality,
    congestion_severity,
    interconnect_quality,
    monotone_cost_score,
    power_quality,
    robustness_quality,
    scalar_summary,
    target_interval_score,
    timing_period_ns,
    timing_quality,
)


def test_monotone_cost_has_preferred_plateau_and_fail_cliff() -> None:
    assert monotone_cost_score(1.0, 1.25, 1.75) == 1.0
    assert monotone_cost_score(1.5, 1.25, 1.75) == pytest.approx(0.5)
    assert monotone_cost_score(1.75, 1.25, 1.75) == 0.0
    assert monotone_cost_score(1.1, 1.25, 1.75) == 1.0


def test_target_interval_penalizes_both_directions() -> None:
    assert target_interval_score(0.52, 0.45, 0.70, 0.85) == 1.0
    assert target_interval_score(0.225, 0.45, 0.70, 0.85) == pytest.approx(0.5)
    assert target_interval_score(0.775, 0.45, 0.70, 0.85) == pytest.approx(0.5)
    assert target_interval_score(0.90, 0.45, 0.70, 0.85) == 0.0


def test_interconnect_quality_matches_the_reference_fixture() -> None:
    # Section 12.1: I_total = 1.37283 with Scong = 0 scores 75.4.
    assert interconnect_quality(1.37283, 0.0) == pytest.approx(75.434, abs=0.01)
    assert interconnect_quality(1.37283, 1.0) == 0.0
    assert interconnect_quality(None, 0.0) is None


def test_timing_quality_is_continuous_across_zero_slack() -> None:
    assert timing_quality(0.0, 10.0) == 50.0
    assert timing_quality(-0.5, 10.0) == pytest.approx(37.5)
    assert timing_quality(0.25, 10.0) == pytest.approx(75.0)
    assert timing_quality(0.5, 10.0) == 100.0
    # Section 12.1: WS = +16.622 ns over tau_guardband = 1.0 ns saturates.
    assert timing_quality(16.622, 20.0) == 100.0
    assert timing_quality(1.0, None) is None


def test_timing_period_prefers_declared_cap_and_falls_back_to_sta() -> None:
    assert timing_period_ns(100.0, None, None) == pytest.approx(10.0)
    # frequency_mhz = 1000/(Tclk - WS) inverts exactly.
    assert timing_period_ns(None, 2.358, 410.0) == pytest.approx(1000.0 / 410.0 + 2.358)
    assert timing_period_ns(None, None, None) is None


def test_congestion_severity_takes_the_worst_available_operand() -> None:
    assert congestion_severity(None, 4.0, 80.0) == pytest.approx(0.8)
    assert congestion_severity(0.9, 4.0, 80.0) == pytest.approx(0.9)
    assert congestion_severity(None, None, None) == 0.0


def test_area_quality_penalizes_waste_and_congestion_risk() -> None:
    assert area_quality(0.52) == 100.0
    assert area_quality(0.40) == pytest.approx(100.0 * 0.40 / 0.45)
    assert area_quality(0.85) == 0.0
    assert area_quality(None) is None


def test_power_quality_needs_a_declared_budget() -> None:
    assert power_quality(0.0, 100.0) == 100.0
    assert power_quality(50.0, 100.0) == 50.0
    assert power_quality(120.0, 100.0) == 0.0
    assert power_quality(50.0, None) is None
    assert power_quality(None, 100.0) is None


def test_robustness_renormalizes_without_cts_depths() -> None:
    # Section 12.1: imbalance 0.0, dPVT 0.1179 -> 94.1.
    assert robustness_quality(0.0, 0.1179) == pytest.approx(94.105)
    assert robustness_quality(None, 0.1179) == pytest.approx(100.0 - 11.79)
    assert robustness_quality(0.5, None) is None


def test_scalar_summary_renormalizes_and_vetoes_physical_failure() -> None:
    scores = {
        "timing": 100.0,
        "interconnect": 75.434,
        "area": 100.0,
        "power": None,
        "robustness": 94.105,
    }
    # Section 12.1: balanced projection over evaluated dimensions (the
    # document's "91.7" is its one-decimal display rounding of 91.734).
    assert scalar_summary(scores, physical_failure=False) == pytest.approx(
        91.734, abs=0.01
    )
    assert scalar_summary(scores, physical_failure=True) == 0.0
    assert scalar_summary({name: None for name in scores}, physical_failure=False) is None
