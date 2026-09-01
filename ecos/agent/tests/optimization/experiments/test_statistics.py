from __future__ import annotations

import pytest

from ecos_agent.optimization.experiments.statistics import (
    exact_paired_permutation_p_value,
    holm_adjust,
    paired_design_statistics,
    success_curve_auc,
    summarize_design_blocks,
)


def test_success_curve_auc_uses_every_candidate_in_the_fixed_budget() -> None:
    assert success_curve_auc({str(k): k >= 2 for k in range(1, 21)}) == pytest.approx(
        19 / 20
    )
    assert success_curve_auc({str(k): False for k in range(1, 21)}) == 0.0


@pytest.mark.parametrize(
    "curve",
    [
        {"1": False, "3": True},
        {"1": True, "2": False},
        {"1": 0},
    ],
)
def test_success_curve_auc_rejects_invalid_cumulative_curves(curve) -> None:
    with pytest.raises(ValueError):
        success_curve_auc(curve)


def test_design_blocks_preserve_raw_values_failures_and_iqr() -> None:
    summary = summarize_design_blocks(
        {
            "gcd": [1.0, 2.0, 3.0, 4.0, 5.0],
            "i2c": [1.0, None, 2.0, None, 3.0],
        }
    )

    assert summary["gcd"] == {
        "raw_values": [1.0, 2.0, 3.0, 4.0, 5.0],
        "completed_episode_count": 5,
        "failed_episode_count": 0,
        "failure_rate": 0.0,
        "median": 3.0,
        "iqr": {"q1": 2.0, "q3": 4.0, "width": 2.0},
    }
    assert summary["i2c"]["raw_values"] == [1.0, None, 2.0, None, 3.0]
    assert summary["i2c"]["failure_rate"] == pytest.approx(0.4)
    assert summary["i2c"]["median"] == 2.0


def test_paired_design_statistics_keep_designs_as_the_independent_units() -> None:
    summary = paired_design_statistics(
        treatment={"a": 0.8, "b": 0.4, "c": 0.2},
        reference={"a": 0.5, "b": 0.4, "c": 0.5},
        bootstrap_samples=200,
        bootstrap_seed=7,
    )

    assert summary["design_count"] == 3
    assert summary["win_tie_loss"] == {"win": 1, "tie": 1, "loss": 1}
    assert summary["differences"] == pytest.approx({"a": 0.3, "b": 0.0, "c": -0.3})
    assert summary["mean_paired_difference"] == pytest.approx(0.0)
    assert summary["confidence_interval"]["bootstrap_seed"] == 7


def test_paired_statistics_constant_effect_has_exact_bootstrap_interval() -> None:
    summary = paired_design_statistics(
        treatment={"a": 2.0, "b": 3.0, "c": 4.0},
        reference={"a": 1.0, "b": 2.0, "c": 3.0},
        bootstrap_samples=100,
    )

    assert summary["confidence_interval"]["lower"] == 1.0
    assert summary["confidence_interval"]["upper"] == 1.0


def test_exact_paired_permutation_enumerates_all_sign_flips() -> None:
    assert exact_paired_permutation_p_value([1.0, 1.0]) == 0.5
    assert exact_paired_permutation_p_value([0.0, 0.0]) == 1.0


def test_holm_adjustment_is_monotone_in_sorted_p_values() -> None:
    assert holm_adjust({"a": 0.01, "b": 0.04, "c": 0.03}) == pytest.approx(
        {"a": 0.03, "b": 0.06, "c": 0.06}
    )


def test_paired_statistics_reject_unpaired_designs() -> None:
    with pytest.raises(ValueError, match="same designs"):
        paired_design_statistics({"a": 1.0}, {"b": 1.0})
