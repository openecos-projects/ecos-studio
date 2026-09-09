import pytest

from ecos_agent.optimization.contracts import TerminalObservation
from ecos_agent.optimization.metrics.contracts import (
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.observation_contracts import (
    deterministic_noise_profile,
)
from tests.optimization.experiments.equal_budget_support import (
    _terminal_observation,
)


def _corner_row(metric_id: str, corner: str, value: float, unit: str = "ns"):
    return TerminalEvaluationMetric(
        metric_id=metric_id,
        value=value,
        unit=unit,
        category="corner_robustness",
        role="report",
        direction="higher_is_better",
        source_refs=(f"sta_ecc/feature/{corner}/qor_summary.json",),
        corner=corner,
    )


def _telemetry_row(metric_id: str, value: float, unit: str):
    return TerminalEvaluationMetric(
        metric_id=metric_id,
        value=value,
        unit=unit,
        category="cost",
        role="report",
        direction="lower_is_better",
        source_refs=("home/flow.json",),
    )


def _replay(extra_rows) -> TerminalObservation:
    observation = _terminal_observation()
    return observation.model_copy(
        update={
            "evaluation_metrics": (
                *observation.evaluation_metrics,
                *extra_rows,
            )
        }
    )


def test_noise_profile_excludes_telemetry_and_keeps_corner_keys() -> None:
    replay_a = _replay(
        (
            _corner_row("sta_setup_wns", "MAX_125/Cworst", 8.203),
            _corner_row("sta_setup_wns", "MIN_m40/Cbest", 9.43),
            _telemetry_row("flow_peak_memory", 1061.66, "MB"),
            _telemetry_row("flow_tool_runtime", 254.0, "s"),
        )
    )
    replay_b = _replay(
        (
            _corner_row("sta_setup_wns", "MAX_125/Cworst", 8.203),
            _corner_row("sta_setup_wns", "MIN_m40/Cbest", 9.43),
            _telemetry_row("flow_peak_memory", 1059.191, "MB"),
            _telemetry_row("flow_tool_runtime", 308.5, "s"),
        )
    )

    profile = deterministic_noise_profile([replay_a, replay_b])

    epsilon = profile["epsilon"]
    assert all(not key.startswith("flow_") for key in epsilon)
    # Cross-corner spread stays per corner instead of collapsing into drift.
    assert epsilon["sta_setup_wns@MAX_125/Cworst"] == 0.0
    assert epsilon["sta_setup_wns@MIN_m40/Cbest"] == 0.0
    assert epsilon["sta_typical_leakage_power"] == 0.0
    assert profile["reference"]["sta_typical_leakage_power"] == 0.4


def test_noise_profile_reports_true_qor_drift_per_key() -> None:
    replay_a = _replay((_corner_row("sta_setup_wns", "MAX_125/Cworst", 8.203),))
    replay_b = _replay((_corner_row("sta_setup_wns", "MAX_125/Cworst", 8.5),))

    profile = deterministic_noise_profile([replay_a, replay_b])

    assert profile["epsilon"]["sta_setup_wns@MAX_125/Cworst"] == pytest.approx(0.297)
    assert profile["reference"]["sta_setup_wns@MAX_125/Cworst"] == pytest.approx(
        8.3515
    )


def test_noise_profile_rejects_single_replay_and_structure_drift() -> None:
    replay = _replay((_corner_row("sta_setup_wns", "MAX_125/Cworst", 8.203),))

    with pytest.raises(ValueError, match="at least two"):
        deterministic_noise_profile([replay])

    structurally_different = _terminal_observation()
    with pytest.raises(ValueError, match="structurally aligned"):
        deterministic_noise_profile([replay, structurally_different])
