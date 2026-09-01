"""Pure statistics for fixed-budget optimization experiments."""

from __future__ import annotations

import math
import random
import statistics
from itertools import combinations, product
from typing import Mapping, Sequence

from ecos_agent.optimization.experiments.baselines import ONLINE_BASELINE_METHODS, BaselineMethod
from ecos_agent.optimization.contracts import (
    ROUTABILITY_OBJECTIVE_ORDER,
    ObjectiveMetric,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.experiments.gate0 import compare_observations

_MAX_EXACT_BLOCKS = 20
_BOOTSTRAP_SAMPLES = 10_000
_BOOTSTRAP_SEED = 20260824


def baseline_design_statistics(
    designs: Mapping[str, Mapping[str, object]],
) -> dict[str, object]:
    """Aggregate completed baseline methods with designs as paired blocks."""
    if not designs:
        raise ValueError("baseline design statistics cannot be empty")
    if any(not isinstance(design_id, str) or not design_id for design_id in designs):
        raise ValueError("design ids must be non-empty strings")
    methods = [method.value for method in ONLINE_BASELINE_METHODS]
    method_statistics = {
        method: _baseline_method_statistics(method, designs) for method in methods
    }
    comparisons = _paired_auc_comparisons({
        method: summary["auc_success_at_20_by_design"]  # type: ignore[index]
        for method, summary in method_statistics.items()
    })
    adjusted = holm_adjust({
        key: float(summary["p_value"]) for key, summary in comparisons.items()
    })
    for key, p_value in adjusted.items():
        comparisons[key]["holm_adjusted_p_value"] = p_value
    return {
        "schema_version": "ecos.optimization_design_block_statistics.v1",
        "methods": method_statistics,
        "paired_auc_permutation_tests": comparisons,
    }


def objective_tuple(observation: TerminalObservation) -> list[float]:
    return [float(observation.metrics[metric]) for metric in ROUTABILITY_OBJECTIVE_ORDER]


def objective_delta(
    baseline: TerminalObservation, candidate: TerminalObservation
) -> dict[str, float]:
    return {
        metric.value: float(candidate.metrics[metric]) - float(baseline.metrics[metric])
        for metric in ROUTABILITY_OBJECTIVE_ORDER
    }


def _baseline_method_statistics(
    method: str, designs: Mapping[str, Mapping[str, object]]
) -> dict[str, object]:
    rows = {
        design_id: _baseline_design_row(method, design)
        for design_id, design in sorted(designs.items())
    }
    auc = {
        design_id: float(row["auc_success_at_20"])
        for design_id, row in rows.items()
    }
    lex = {
        design_id: bool(row["lex_success_at_20"])
        for design_id, row in rows.items()
    }
    wins = {
        "win": sum(row["comparison_vs_default"] == "better" for row in rows.values()),
        "tie": sum(row["comparison_vs_default"] == "noise_tie" for row in rows.values()),
        "loss": sum(
            row["comparison_vs_default"] not in {"better", "noise_tie"}
            for row in rows.values()
        ),
    }
    return {
        "design_count": len(rows),
        "auc_success_at_20_by_design": auc,
        "median_auc_success_at_20": statistics.median(auc.values()),
        "lex_success_at_20_by_design": lex,
        "lex_success_at_20_count": sum(lex.values()),
        "win_tie_loss_vs_default": wins,
        "by_design": rows,
    }


def _baseline_design_row(
    method: str, design: Mapping[str, object]
) -> dict[str, object]:
    methods = design.get("methods")
    profile = design.get("noise_profile")
    if not isinstance(methods, Mapping) or not isinstance(profile, Mapping):
        raise ValueError("baseline design statistics are incomplete")
    default = methods.get(BaselineMethod.DEFAULT.value)
    current = methods.get(method)
    epsilon = profile.get("epsilon")
    if not isinstance(default, Mapping) or not isinstance(current, Mapping):
        raise ValueError("baseline method statistics are incomplete")
    if not isinstance(epsilon, Mapping):
        raise ValueError("design epsilon statistics are missing")
    baseline = TerminalObservation.model_validate(default.get("terminal_observation"))
    best = TerminalObservation.model_validate(current.get("best_terminal_observation"))
    auc = _unit_interval(current.get("auc_success_at_20"))
    lex_success = _boolean(current.get("lex_success_at_20"))
    comparison = compare_observations(_terminal_metrics(baseline), best, epsilon)
    if lex_success != (auc > 0.0) or lex_success != (comparison == "better"):
        raise ValueError("baseline method success statistics are inconsistent")
    return {
        "auc_success_at_20": auc,
        "lex_success_at_20": lex_success,
        "comparison_vs_default": comparison,
        "best_so_far_tuple": objective_tuple(best),
        "best_so_far_delta": objective_delta(baseline, best),
    }


def _paired_auc_comparisons(
    auc_by_method: Mapping[str, Mapping[str, float]],
) -> dict[str, dict[str, object]]:
    result = {}
    for treatment, reference in combinations(sorted(auc_by_method), 2):
        summary = paired_design_statistics(
            auc_by_method[treatment], auc_by_method[reference]
        )
        result[f"{treatment}__vs__{reference}"] = {
            "n_designs": summary["design_count"],
            "paired_auc_deltas_by_design": summary["differences"],
            "win_tie_loss": summary["win_tie_loss"],
            "effect_size_mean_auc_delta": summary["mean_paired_difference"],
            "effect_size_median_auc_delta": summary["median_paired_difference"],
            "mean_auc_delta_confidence_interval_95": summary["confidence_interval"],
            "p_value": summary["exact_permutation_p_value"],
        }
    return result


def _terminal_metrics(observation: TerminalObservation) -> dict[str, float]:
    return {
        **{metric.value: float(observation.metrics[metric]) for metric in ObjectiveMetric},
        **{
            metric.value: float(observation.timing_guardrail[metric])
            for metric in TimingMetric
        },
    }


def _unit_interval(value: object) -> float:
    result = _finite(value)
    if not 0.0 <= result <= 1.0:
        raise ValueError("AUC(success@20) must be in [0, 1]")
    return result


def _boolean(value: object) -> bool:
    if type(value) is not bool:
        raise ValueError("lex_success@20 must be boolean")
    return value


def success_curve_auc(success_at_k: Mapping[str | int, bool]) -> float:
    """Return normalized discrete area under a cumulative success curve."""
    normalized: dict[int, bool] = {}
    for key, value in success_at_k.items():
        if isinstance(key, bool) or not isinstance(key, (str, int)):
            raise ValueError("success curve indices must be positive integers")
        try:
            index = int(key)
        except ValueError as exc:
            raise ValueError("success curve indices must be positive integers") from exc
        if index <= 0 or str(index) != str(key) or index in normalized:
            raise ValueError("success curve indices must be unique positive integers")
        if type(value) is not bool:
            raise ValueError("success curve values must be booleans")
        normalized[index] = value
    if set(normalized) != set(range(1, len(normalized) + 1)):
        raise ValueError("success curve indices must be contiguous from one")
    curve = [normalized[index] for index in range(1, len(normalized) + 1)]
    if not curve:
        raise ValueError("success curve cannot be empty")
    if any(current and not following for current, following in zip(curve, curve[1:])):
        raise ValueError("success curve must be cumulative")
    return sum(curve) / len(curve)


def summarize_design_blocks(
    episodes_by_design: Mapping[str, Sequence[float | int | None]],
) -> dict[str, dict[str, object]]:
    """Aggregate repeated episodes within each independent design block."""
    if not episodes_by_design:
        raise ValueError("design blocks cannot be empty")
    if any(
        not isinstance(design_id, str) or not design_id
        for design_id in episodes_by_design
    ):
        raise ValueError("design ids must be non-empty strings")
    summary: dict[str, dict[str, object]] = {}
    episode_counts = set()
    for design_id, raw_values in sorted(episodes_by_design.items()):
        if not raw_values:
            raise ValueError("each named design block must contain episodes")
        episode_counts.add(len(raw_values))
        raw = [None if value is None else _finite(value) for value in raw_values]
        completed = [value for value in raw if value is not None]
        failed = len(raw) - len(completed)
        summary[design_id] = {
            "raw_values": raw,
            "completed_episode_count": len(completed),
            "failed_episode_count": failed,
            "failure_rate": failed / len(raw),
            "median": statistics.median(completed) if completed else None,
            "iqr": _iqr(completed) if completed else None,
        }
    if len(episode_counts) != 1:
        raise ValueError("design blocks must contain the same episode count")
    return summary


def exact_paired_permutation_p_value(differences: Sequence[float | int]) -> float:
    """Compute a two-sided exact sign-flip p-value over paired design effects."""
    values = _finite_values(differences)
    if len(values) > _MAX_EXACT_BLOCKS:
        raise ValueError("exact permutation supports at most 20 design blocks")
    observed = abs(statistics.fmean(values))
    tolerance = 1e-12 * max(1.0, observed)
    extreme = sum(
        abs(statistics.fmean(sign * value for sign, value in zip(signs, values)))
        >= observed - tolerance
        for signs in product((-1.0, 1.0), repeat=len(values))
    )
    return extreme / (2 ** len(values))


def paired_design_statistics(
    treatment: Mapping[str, float | int],
    reference: Mapping[str, float | int],
    *,
    higher_is_better: bool = True,
    tie_tolerance: float = 0.0,
    bootstrap_samples: int = _BOOTSTRAP_SAMPLES,
    bootstrap_seed: int = _BOOTSTRAP_SEED,
) -> dict[str, object]:
    """Summarize one pre-registered paired comparison at the design level."""
    if not treatment or set(treatment) != set(reference):
        raise ValueError("paired comparisons must contain the same designs")
    if any(not isinstance(design_id, str) or not design_id for design_id in treatment):
        raise ValueError("design ids must be non-empty strings")
    if type(higher_is_better) is not bool:
        raise ValueError("higher_is_better must be boolean")
    tolerance = _finite(tie_tolerance)
    if tolerance < 0:
        raise ValueError("tie tolerance must be non-negative")
    design_ids = sorted(treatment)
    differences = {
        design_id: _finite(treatment[design_id]) - _finite(reference[design_id])
        for design_id in design_ids
    }
    values = list(differences.values())
    oriented = values if higher_is_better else [-value for value in values]
    return {
        "design_count": len(design_ids),
        "differences": differences,
        "win_tie_loss": {
            "win": sum(value > tolerance for value in oriented),
            "tie": sum(abs(value) <= tolerance for value in values),
            "loss": sum(value < -tolerance for value in oriented),
        },
        "mean_paired_difference": statistics.fmean(values),
        "median_paired_difference": statistics.median(values),
        "confidence_interval": _bootstrap_mean_interval(
            values, bootstrap_samples, bootstrap_seed
        ),
        "exact_permutation_p_value": exact_paired_permutation_p_value(values),
    }


def holm_adjust(p_values: Mapping[str, float | int]) -> dict[str, float]:
    """Adjust a pre-registered family of p-values with Holm's method."""
    validated = {name: _finite(value) for name, value in p_values.items()}
    if any(not isinstance(name, str) or not name for name in validated) or any(
        value < 0 or value > 1 for value in validated.values()
    ):
        raise ValueError("Holm inputs must be named p-values between zero and one")
    adjusted: dict[str, float] = {}
    running = 0.0
    count = len(validated)
    for rank, (name, value) in enumerate(
        sorted(validated.items(), key=lambda item: item[1])
    ):
        running = max(running, min(1.0, (count - rank) * value))
        adjusted[name] = running
    return {name: adjusted[name] for name in validated}


def _iqr(values: Sequence[float]) -> dict[str, float]:
    if len(values) == 1:
        q1 = q3 = values[0]
    else:
        q1, _, q3 = statistics.quantiles(values, n=4, method="inclusive")
    return {"q1": q1, "q3": q3, "width": q3 - q1}


def _bootstrap_mean_interval(
    values: Sequence[float], samples: int, seed: int
) -> dict[str, float | int | str]:
    if type(samples) is not int or samples <= 0 or type(seed) is not int:
        raise ValueError("bootstrap samples and seed must be integers")
    generator = random.Random(seed)
    means = sorted(
        statistics.fmean(generator.choices(values, k=len(values))) for _ in range(samples)
    )
    return {
        "method": "design_block_percentile_bootstrap",
        "confidence_level": 0.95,
        "lower": _percentile(means, 0.025),
        "upper": _percentile(means, 0.975),
        "bootstrap_samples": samples,
        "bootstrap_seed": seed,
    }


def _percentile(sorted_values: Sequence[float], probability: float) -> float:
    position = (len(sorted_values) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    return sorted_values[lower] + (position - lower) * (
        sorted_values[upper] - sorted_values[lower]
    )


def _finite_values(values: Sequence[float | int]) -> list[float]:
    if not values:
        raise ValueError("paired differences cannot be empty")
    return [_finite(value) for value in values]


def _finite(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("statistics values must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("statistics values must be finite")
    return result
