"""Noise-aware trend features and the manifest scope/calibration gates."""

from __future__ import annotations

import pytest

from tests.optimization.knowledge.test_action_support_compiler import _observation

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    StageObservation,
)
from ecos_agent.optimization.controller_models import OptimizationAgentMode
from ecos_agent.optimization.controller import (
    OptimizationEpisodeController,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.knowledge.compiler_runtime import (
    build_state_evidence_request,
)


def _observation_with_metric(metric_id: str, value: float) -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=canonical_sha256({"observation": "place"}),
        metrics={metric_id: value},
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0)),
    )


def _state(metric_id, value, history, trend_epsilon):
    return build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256="sha256:" + "1" * 64,
        observation=_observation_with_metric(metric_id, value),
        current_values={},
        historical_metrics=tuple(history),
        trend_epsilon=trend_epsilon,
    )


def test_trend_uses_per_metric_calibrated_epsilon() -> None:
    history = [{"route_wirelength": 100.0, "route_la_total_overflow": 10.0}]
    epsilon = {"route_wirelength": 5.0, "route_la_total_overflow": 0.5}
    state = _state("route_wirelength", 103.0, history, epsilon)
    features = {item.feature_id: item.value for item in state.features}
    # wirelength delta 3.0 is inside its 5.0 epsilon; overflow delta 2.0 is
    # beyond its 0.5 epsilon: per-metric tolerances apply independently.
    assert features["trend.route_wirelength"] == "stable"
    overflow = _state("route_la_total_overflow", 12.0, history, epsilon)
    overflow_features = {item.feature_id: item.value for item in overflow.features}
    assert overflow_features["trend.route_la_total_overflow"] == "increasing"


def test_missing_metric_epsilon_fails_closed() -> None:
    history = [{"route_wirelength": 100.0}]
    with pytest.raises(ValueError, match="route_wirelength"):
        _state(
            "route_wirelength",
            103.0,
            history,
            {"route_la_total_overflow": 0.5},
        )


def test_negative_epsilon_entries_are_rejected() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        build_state_evidence_request(
            task_id="task-1",
            retrieval_request_sha256="sha256:" + "1" * 64,
            observation=_observation(),
            current_values={},
            trend_epsilon={"route_wirelength": -1.0},
        )


def test_controller_rejects_invalid_epsilon_entries() -> None:
    controller = _bare_controller(OptimizationAgentMode.FULL_AGENT)
    with pytest.raises(
        OptimizationEpisodeControllerError, match="finite and non-negative"
    ):
        controller._validated_trend_noise_epsilon({"route_wirelength": -2.0})
    with pytest.raises(
        OptimizationEpisodeControllerError, match="finite and non-negative"
    ):
        controller._validated_trend_noise_epsilon({"": 1.0})
    assert (
        controller._validated_trend_noise_epsilon(
            {"route_wirelength": 0.0, "route_la_total_overflow": 1.5}
        )
        == {"route_wirelength": 0.0, "route_la_total_overflow": 1.5}
    )


def _bare_controller(mode: OptimizationAgentMode) -> OptimizationEpisodeController:
    controller = OptimizationEpisodeController.__new__(OptimizationEpisodeController)
    controller.mode = mode
    return controller


def test_manifest_scope_gate_fails_closed() -> None:
    controller = _bare_controller(OptimizationAgentMode.FULL_AGENT)
    controller._trend_noise_epsilon = None
    # A scoped design without calibrated epsilon is rejected.
    with pytest.raises(OptimizationEpisodeControllerError, match="noise-epsilon"):
        controller._manifest_scope_check("gcd")
    controller._trend_noise_epsilon = {"route_wirelength": 0.0}
    assert controller._manifest_scope_check("gcd") == "gcd"
    # An unscoped design is rejected even with epsilon.
    with pytest.raises(
        OptimizationEpisodeControllerError, match="outside the frozen state-rule"
    ):
        controller._manifest_scope_check("not-a-cohort-design")
    # Episodes without a design id (unit fixtures) stay ungated.
    assert controller._manifest_scope_check(None) is None
