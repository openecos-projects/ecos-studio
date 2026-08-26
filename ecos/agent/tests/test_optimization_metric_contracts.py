import pytest
from ecos_agent.optimization_metric_contracts import TerminalEvaluationMetric
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
