import pytest
from ecos_agent.optimization.metrics.contracts import (
    TELEMETRY_METRIC_IDS,
    TerminalEvaluationMetric,
    is_telemetry_metric,
    metric_comparison_key,
)
from pydantic import ValidationError


def _metric(**updates: object) -> TerminalEvaluationMetric:
    payload = {
        "metric_id": "sta_setup_wns",
        "value": -0.1,
        "unit": "ns",
        "category": "corner_robustness",
        "role": "report",
        "direction": "higher_is_better",
        "source_refs": ("sta_ecc/feature/MAX_125/Cworst/qor_summary.json",),
        "corner": "MAX_125/Cworst",
    }
    return TerminalEvaluationMetric.model_validate({**payload, **updates})


def test_terminal_metric_allows_negative_timing_slack() -> None:
    assert _metric().value == -0.1


def test_terminal_metric_rejects_unsafe_source_reference() -> None:
    with pytest.raises(ValidationError, match="sources"):
        _metric(source_refs=("../outside.json",))


def test_terminal_metric_rejects_fractional_count() -> None:
    with pytest.raises(ValidationError, match="count"):
        _metric(metric_id="drc_count", value=0.5, unit="count")


def test_flow_telemetry_metrics_are_classified_as_telemetry() -> None:
    runtime = _metric(
        metric_id="flow_tool_runtime",
        value=254.0,
        unit="s",
        category="cost",
        direction="lower_is_better",
        corner=None,
    )
    assert is_telemetry_metric(runtime)
    assert {"flow_tool_runtime", "flow_peak_memory",
            "flow_nonzero_peak_memory_stage_count"} <= TELEMETRY_METRIC_IDS
    assert not is_telemetry_metric(_metric(metric_id="flow_stage_count"))
    assert not is_telemetry_metric(_metric())


def test_comparison_key_distinguishes_corner_rows_of_one_metric_id() -> None:
    worst = _metric()
    best = _metric(corner="MIN_m40/Cbest", value=9.43)
    unscoped = _metric(corner=None)

    assert metric_comparison_key(worst) == ("sta_setup_wns", "MAX_125/Cworst")
    assert metric_comparison_key(best) == ("sta_setup_wns", "MIN_m40/Cbest")
    assert metric_comparison_key(worst) != metric_comparison_key(best)
    assert metric_comparison_key(unscoped) == ("sta_setup_wns", None)
