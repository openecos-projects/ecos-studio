"""ECC-QoR draft 3 physical quality record (Qphys) scoring.

Pure calibration layer over terminal measurements (sections 3.2, 8, 9):
one-sided monotone costs and two-sided target intervals never mix, every
dimension may evaluate to null (UNKNOWN), and the scalar summary is a
profile projection that an active physical signoff failure vetoes to zero.
Quality stays strictly separate from feasibility and evidence completeness;
missing operands yield null, never a guessed score.
"""

from __future__ import annotations

from ecos_agent.optimization.evidence import (
    INFLATION_FAIL,
    INFLATION_PREFERRED,
    TIMING_FAIL_RATIO,
    TIMING_GUARDBAND_RATIO,
    derive_clock_period_ns,
)

#: Congestion severity references (section 6.3, equation 21).
RUDY_FAIL = 1.0
EGR_MAX_FAIL = 20.0
EGR_TOTAL_FAIL = 100.0
#: Area quality target interval (section 8.2.3).
CORE_UTIL_PREFERRED_MIN = 0.45
CORE_UTIL_PREFERRED_MAX = 0.70
CORE_UTIL_FAIL_MAX = 0.85
#: Balanced design-intent profile weights (section 9.2, table 5).
BALANCED_PROFILE = {
    "timing": 0.30,
    "interconnect": 0.25,
    "area": 0.15,
    "power": 0.15,
    "robustness": 0.15,
}


def monotone_cost_score(
    value: float, preferred: float, fail: float
) -> float:
    """One-sided monotone lower-is-better calibration (equation 10)."""
    if value <= preferred:
        return 1.0
    if value >= fail:
        return 0.0
    return (fail - value) / (fail - preferred)


def target_interval_score(
    value: float, preferred_min: float, preferred_max: float, fail_max: float
) -> float:
    """Two-sided target-interval calibration (equation 11)."""
    if value < preferred_min:
        return value / preferred_min
    if value <= preferred_max:
        return 1.0
    return max(0.0, (fail_max - value) / (fail_max - preferred_max))


def congestion_severity(
    rudy_max: float | None, egr_max: float | None, egr_total: float | None
) -> float:
    """Canonical congestion severity over available operands (equation 21)."""
    ratios = [
        value / limit
        for value, limit in (
            (rudy_max, RUDY_FAIL),
            (egr_max, EGR_MAX_FAIL),
            (egr_total, EGR_TOTAL_FAIL),
        )
        if value is not None
    ]
    return max(ratios, default=0.0)


def timing_period_ns(
    frequency_max_mhz: float | None,
    corner_setup_ws_ns: float | None,
    corner_frequency_mhz: float | None,
) -> float | None:
    """Tclk from the declared cap, else inverted from one corner's evidence."""
    if frequency_max_mhz is not None and frequency_max_mhz > 0:
        return 1000.0 / frequency_max_mhz
    return derive_clock_period_ns(corner_setup_ws_ns, corner_frequency_mhz)


def timing_quality(
    setup_ws_ns: float, clock_period_ns: float | None
) -> float | None:
    """Continuous signed-headroom timing quality (equation 26)."""
    if clock_period_ns is None or clock_period_ns <= 0:
        return None
    guardband = TIMING_GUARDBAND_RATIO * clock_period_ns
    fail = TIMING_FAIL_RATIO * clock_period_ns
    if setup_ws_ns < 0:
        return 50.0 * max(0.0, 1.0 - (-setup_ws_ns) / fail)
    return 50.0 + 50.0 * min(1.0, max(0.0, setup_ws_ns / guardband))


def interconnect_quality(
    inflation_total: float | None, severity: float
) -> float | None:
    """Inflation cost scaled by congestion severity (equation 27)."""
    if inflation_total is None:
        return None
    return 100.0 * monotone_cost_score(
        inflation_total, INFLATION_PREFERRED, INFLATION_FAIL
    ) * (1.0 - min(1.0, severity))


def area_quality(core_utilization: float | None) -> float | None:
    """Placed core utilization target interval (equation 29)."""
    if core_utilization is None:
        return None
    return 100.0 * target_interval_score(
        core_utilization,
        CORE_UTIL_PREFERRED_MIN,
        CORE_UTIL_PREFERRED_MAX,
        CORE_UTIL_FAIL_MAX,
    )


def power_quality(
    total_power_uw: float | None, budget_uw: float | None
) -> float | None:
    """Budget-consumption quality (equation 30); null without a budget."""
    if budget_uw is None or budget_uw <= 0 or total_power_uw is None:
        return None
    return 100.0 * min(1.0, max(0.0, (budget_uw - total_power_uw) / budget_uw))


def robustness_quality(
    cts_imbalance: float | None,
    pvt_dispersion_ratio: float | None,
) -> float | None:
    """Clock-tree imbalance and PVT dispersion, 50/50 (equation 34).

    Unmeasured CTS depths re-normalize the PVT weight to 1.0 instead of
    guessing a structural component.
    """
    if pvt_dispersion_ratio is None:
        return None
    penalty = min(1.0, pvt_dispersion_ratio)
    if cts_imbalance is not None:
        penalty = 0.5 * cts_imbalance + 0.5 * penalty
    return 100.0 * (1.0 - penalty)


def scalar_summary(
    dimension_scores: dict[str, float | None], physical_failure: bool
) -> float | None:
    """Profile-dependent projection over evaluated dimensions (equation 35)."""
    if physical_failure:
        return 0.0
    evaluated = {
        dimension: score
        for dimension, score in dimension_scores.items()
        if score is not None
    }
    weight = sum(BALANCED_PROFILE[dimension] for dimension in evaluated)
    if not evaluated or weight <= 0:
        return None
    return (
        sum(BALANCED_PROFILE[d] * s for d, s in evaluated.items()) / weight
    )
