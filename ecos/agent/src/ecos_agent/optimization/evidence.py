"""Evidence discipline shared by observation building and planner projection.

The rules here follow the ECC-QoR draft 3 specification
(ecos/agent/docs/ecc_QoR_v3.pdf) without changing the frozen acceptance
semantics of ``ecos.incumbent_acceptance.v3``:

* missing or contradictory measurement evidence is never a physical failure
  (C1-C3 consistency checks, ``evidence`` semantics);
* interconnect inflation decomposes as ``I_total = I_place * I_route`` with
  strict positive denominators, and every operand comes from the same
  workspace (baseline invariance);
* signed worst slack drives timing states: a small positive margin is WATCH,
  an over-provisioned margin is an OPPORTUNITY, and violation severity scales
  with the normalized violation magnitude.
"""

from __future__ import annotations

import math
from enum import StrEnum
from typing import TYPE_CHECKING

from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.metrics.extraction import metric_record

if TYPE_CHECKING:
    from ecos_agent.optimization.contracts import ObjectiveMetric


class MetricNature(StrEnum):
    """Epistemic class of an objective metric (ECC-QoR draft 3, section 3.1).

    Hard signoff constraints and direct measurements can back binding
    decisions; estimated and proxy measurements carry extraction
    uncertainty; derived composites are policy projections.
    """

    HARD_GATE = "hard_gate"
    DIRECT = "direct"
    ESTIMATED = "estimated"
    PROXY = "proxy"
    DERIVED = "derived"


#: Every ObjectiveMetric value carries exactly one nature; the map must stay
#: exhaustive when the enum grows (StrEnum members equal their values).
METRIC_NATURES: dict[str, MetricNature] = {
    "drc_count": MetricNature.HARD_GATE,
    "sta_setup_violation_count": MetricNature.HARD_GATE,
    "sta_hold_violation_count": MetricNature.HARD_GATE,
    "route_dr_total_violation_count": MetricNature.DIRECT,
    "route_la_total_overflow": MetricNature.PROXY,
    "route_wirelength": MetricNature.DIRECT,
    "die_area": MetricNature.DIRECT,
    "core_area": MetricNature.DIRECT,
    "synthesis_cell_area": MetricNature.DIRECT,
    "sta_standard_cell_area": MetricNature.DIRECT,
    "sta_setup_wns": MetricNature.DIRECT,
    "sta_setup_tns": MetricNature.DIRECT,
    "sta_hold_wns": MetricNature.DIRECT,
    "sta_hold_tns": MetricNature.DIRECT,
    "sta_typical_dynamic_power": MetricNature.ESTIMATED,
    "sta_typical_leakage_power": MetricNature.ESTIMATED,
    "sta_worst_dynamic_power": MetricNature.ESTIMATED,
    "sta_worst_leakage_power": MetricNature.ESTIMATED,
    "sta_frequency": MetricNature.DIRECT,
    "gui_overall_qor_score": MetricNature.DERIVED,
}

#: Natures that must never back a binding preserve constraint.  A derived
#: composite (the GUI overall score) is a weighted projection, so preserving
#: it while optimizing another metric is circular.  Proxy and estimated
#: metrics stay admissible because the frozen experiment contracts preserve
#: route_la_total_overflow; their uncertainty is surfaced to the planner
#: through the nature labels instead.
PRESERVE_FORBIDDEN_NATURES = frozenset({MetricNature.DERIVED})


def preserve_metric_is_forbidden(metric: "ObjectiveMetric") -> bool:
    return METRIC_NATURES[metric.value] in PRESERVE_FORBIDDEN_NATURES

_PLACE_QOR = "place_dreamplace/analysis/qor_metrics.json"
_ROUTE_QOR = "route_ecc/analysis/qor_metrics.json"
_STA_QOR = "sta_ecc/analysis/qor_metrics.json"

#: Document defaults: tau_guardband = 0.05*Tclk, tau_over_provision =
#: 0.20*Tclk, tau_timing_fail = 0.20*Tclk (section 7.2).
TIMING_GUARDBAND_RATIO = 0.05
TIMING_OVER_PROVISION_RATIO = 0.20
TIMING_FAIL_RATIO = 0.20
#: Document defaults for interconnect inflation calibration (section 8.2.2).
INFLATION_PREFERRED = 1.25
INFLATION_FAIL = 1.75
#: tau_drc_ref = 100 from the document severity formulation (section 11.3);
#: NVP normalization uses a calibrated reference because the endpoint count
#: is not part of the terminal observation.
DRC_SEVERITY_REFERENCE = 100.0
NVP_SEVERITY_REFERENCE = 10.0


def consistency_violations(
    metrics_by_path: Mapping[str, Mapping[str, float]],
) -> tuple[str, ...]:
    """Run the C1-C3 same-workspace sanity checks from section 10.4.

    Every check reads operands from one workspace only, so a violation means
    the stage artifacts contradict each other, not that one candidate is
    worse than another.  Checks with missing operands or unreconciled net
    populations evaluate to not-applicable, mirroring the document.
    """
    place = metrics_by_path.get(_PLACE_QOR, {})
    route = metrics_by_path.get(_ROUTE_QOR, {})
    sta = metrics_by_path.get(_STA_QOR, {})
    violations: list[str] = []
    hpwl = place.get("place_hpwl")
    rwl = route.get("route_wirelength")
    place_nets = place.get("net_count")
    route_nets = route.get("net_count")
    # C1: routed wirelength cannot fall below the HPWL geometric lower bound
    # once both stages report the same net population.
    if (
        hpwl is not None
        and rwl is not None
        and not (place_nets is not None and route_nets is not None and place_nets != route_nets)
        and rwl < hpwl
    ):
        violations.append("c1_route_wirelength_below_hpwl")
    # C2: a non-negative worst slack and a zero violation count must agree
    # when both aggregates cover the same STA corner set.
    for check, slack_id, count_id in (
        ("c2_setup_slack_violation_contradiction", "sta_setup_wns", "sta_setup_violation_count"),
        ("c2_hold_slack_violation_contradiction", "sta_hold_wns", "sta_hold_violation_count"),
    ):
        slack = sta.get(slack_id)
        count = sta.get(count_id)
        if slack is not None and count is not None and (slack >= 0) != (count == 0):
            violations.append(check)
    # C3: vias without wirelength is a topological impossibility.
    via_count = route.get("route_via_count")
    if via_count is not None and via_count > 0 and (rwl is None or rwl <= 0):
        violations.append("c3_via_count_without_wirelength")
    return tuple(violations)


def interconnect_inflation_metrics(
    metrics_by_path: Mapping[str, Mapping[str, float]],
) -> tuple[TerminalEvaluationMetric, ...]:
    """Emit I_place, I_route, and I_total from one workspace (section 4.2).

    Positive-denominator preconditions: HPWL > 0 and GRWL > 0.  Missing or
    non-positive operands suppress the ratios (UNKNOWN), they never produce
    padded denominators, and the telescoping identity
    ``I_total == I_place * I_route`` holds exactly because every operand is
    read from the same stage payloads.
    """
    place = metrics_by_path.get(_PLACE_QOR, {})
    route = metrics_by_path.get(_ROUTE_QOR, {})
    hpwl = place.get("place_hpwl")
    grwl = place.get("place_grwl")
    rwl = route.get("route_wirelength")
    if hpwl is None or grwl is None or rwl is None:
        return ()
    if hpwl <= 0 or grwl <= 0 or rwl < 0:
        return ()
    sources = (_PLACE_QOR, _ROUTE_QOR)
    records = (
        ("interconnect_inflation_place", grwl / hpwl),
        ("interconnect_inflation_route", rwl / grwl),
        ("interconnect_inflation_total", rwl / hpwl),
    )
    return tuple(
        metric_record(
            metric_id,
            _ratio(value),
            "ratio",
            EvaluationMetricCategory.ROUTING_DIAGNOSTIC,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.LOWER_IS_BETTER,
            sources,
        )
        for metric_id, value in records
    )


def _ratio(value: float) -> float:
    return round(value, 6)


def derive_clock_period_ns(
    setup_wns_ns: float | None, frequency_mhz: float | None
) -> float | None:
    """Recover Tclk from the STA-derived frequency of the same corner.

    ECC defines ``frequency_mhz = 1000/(Tclk - WS_setup)``, so the inversion
    ``Tclk = 1000/frequency + WS_setup`` is exact per corner by construction.
    Returns None when either operand is missing or produces a non-finite
    clock period (UNKNOWN, never a guess).
    """
    if setup_wns_ns is None or frequency_mhz is None:
        return None
    if frequency_mhz <= 0:
        return None
    period = 1000.0 / frequency_mhz + setup_wns_ns
    if not math.isfinite(period) or period <= 0:
        return None
    return period


def timing_engineering_state(
    ws_ns: float, clock_period_ns: float | None
) -> dict[str, float | str] | None:
    """Classify signed worst slack: FAIL / WATCH / PASS / OPPORTUNITY.

    Thresholds follow the document parameter triplet relative to Tclk.
    Without a derivable clock period the classification is UNKNOWN and the
    caller omits the state instead of guessing an absolute threshold.
    """
    if clock_period_ns is None:
        return None
    guardband = TIMING_GUARDBAND_RATIO * clock_period_ns
    over_provision = TIMING_OVER_PROVISION_RATIO * clock_period_ns
    if ws_ns < 0:
        state = "FAIL"
    elif ws_ns < guardband:
        state = "WATCH"
    elif ws_ns > over_provision:
        state = "OPPORTUNITY"
    else:
        state = "PASS"
    return {
        "state": state,
        "ws_ns": round(ws_ns, 6),
        "guardband_ns": round(guardband, 6),
        "over_provision_ns": round(over_provision, 6),
    }


def inflation_engineering_state(ratio: float | None) -> dict[str, float | str] | None:
    """Classify total interconnect inflation against the calibration band."""
    if ratio is None:
        return None
    if ratio <= INFLATION_PREFERRED:
        state = "PREFERRED"
    elif ratio >= INFLATION_FAIL:
        state = "FAIL"
    else:
        state = "WATCH"
    return {"state": state, "ratio": _ratio(ratio)}


def recovery_severity_entries(
    *,
    drc_count: float | None,
    setup_violation_count: float | None,
    hold_violation_count: float | None,
    setup_ws_ns: float | None,
    hold_ws_ns: float | None,
    clock_period_ns: float | None,
) -> tuple[dict[str, float | str], ...]:
    """Deterministic Tier-1 severity ranking (section 11.3).

    Severity spans [0.80, 1.00] for active feasibility blockers so any of
    them outranks non-blocking quality limiters, while the normalized
    violation magnitude still orders a catastrophic failure ahead of a
    marginal one.  This ranking is planner evidence only: it never changes
    the frozen incumbent acceptance rule.
    """
    entries: list[dict[str, float | str]] = []
    timing_fail_ns = (
        TIMING_FAIL_RATIO * clock_period_ns if clock_period_ns is not None else None
    )
    specifications = (
        # ``drc_count`` here carries the routed design-rule violation count
        # (the objective-trio DRC member), not the signoff iDRC count.
        ("route_dr_total_violation_count", drc_count, DRC_SEVERITY_REFERENCE),
        ("sta_setup_violation_count", setup_violation_count, NVP_SEVERITY_REFERENCE),
        ("sta_hold_violation_count", hold_violation_count, NVP_SEVERITY_REFERENCE),
    )
    for metric_id, count, reference in specifications:
        if count is None or count <= 0:
            continue
        entries.append(_severity_entry(metric_id, count / reference))
    for metric_id, slack in (
        ("sta_setup_wns", setup_ws_ns),
        ("sta_hold_wns", hold_ws_ns),
    ):
        if slack is None or slack >= 0 or timing_fail_ns is None:
            continue
        entries.append(_severity_entry(metric_id, abs(slack) / timing_fail_ns))
    return tuple(sorted(entries, key=lambda entry: -float(entry["severity"])))


def _severity_entry(metric_id: str, magnitude: float) -> dict[str, float | str]:
    clamped = max(0.0, min(1.0, magnitude))
    return {
        "metric_id": metric_id,
        "tier": "tier_1_feasibility",
        "magnitude": round(clamped, 6),
        "severity": round(0.80 + 0.20 * clamped, 6),
    }
