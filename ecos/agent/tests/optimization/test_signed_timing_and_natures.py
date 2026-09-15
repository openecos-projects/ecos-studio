"""Signed-slack guardrail semantics and objective-metric epistemic natures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.evidence import (
    METRIC_NATURES,
    PRESERVE_FORBIDDEN_NATURES,
    MetricNature,
)
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.observations import build_terminal_observation
from ecos_agent.optimization.planning import projected_terminal_observation
from ecos_agent.optimization.rules import (
    IncumbentDecision,
    _timing_regression,
    compare_incumbent,
    freeze_optimization_objective,
    freeze_routability_objective,
)

from tests.optimization.observation_support import frozen_workspace

_GUARDRAIL_BASE = {metric: 0.5 for metric in TimingMetric}


def _observation(slack: float, metric: TimingMetric = TimingMetric.STA_SETUP_WNS):
    guardrail = dict(_GUARDRAIL_BASE)
    guardrail[metric] = slack
    return TerminalObservation(
        observation_id="terminal-test",
        evidence_manifest_sha256="sha256:" + "a" * 64,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=__import__(
            "ecos_agent.optimization.contracts", fromlist=["SignoffGates"]
        ).SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 0.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100.0,
        },
        timing_guardrail=guardrail,
    )


class TestSignedTimingGuardrail:
    def test_positive_margin_erosion_is_not_a_veto(self) -> None:
        # Positive-margin erosion is not a guardrail failure; it must not
        # veto a primary-metric improvement (episode-48bc366d #4 ruled a
        # drc improvement degraded on a 0.106 -> 0.093 hold margin).
        assert _timing_regression(_observation(0.5), _observation(0.02)) is None

    def test_failed_slack_is_a_regression(self) -> None:
        regression = _timing_regression(_observation(0.5), _observation(-0.02))
        assert regression is not None
        assert regression.decision == IncumbentDecision.INCUMBENT_RETAINED
        assert regression.decisive_metric == TimingMetric.STA_SETUP_WNS

    def test_failing_slack_getting_worse_is_a_regression(self) -> None:
        regression = _timing_regression(_observation(-0.05), _observation(-0.08))
        assert regression is not None
        assert regression.decision == IncumbentDecision.INCUMBENT_RETAINED

    def test_failing_slack_improving_is_not_a_regression(self) -> None:
        assert _timing_regression(_observation(-0.05), _observation(-0.01)) is None

    def test_improvement_is_not_a_regression(self) -> None:
        assert _timing_regression(_observation(0.5), _observation(0.8)) is None

    def test_narrow_positive_margin_still_beats_negative_margin(self) -> None:
        # Utility of a timing primary metric tracks the signed slack, so a
        # small positive margin outranks any violation (ECC-QoR draft 3,
        # section 7.1: clamped WNS must never feed continuous quality).
        incumbent = _observation(0.5)
        better = _observation(0.9)
        semantic = freeze_optimization_objective(
            "improve setup slack",
            OptimizationObjectiveProposal(
                primary_metric=ObjectiveMetric.STA_SETUP_WNS,
                rationale_summary="Raise signed setup slack.",
            ),
        )
        comparison = compare_incumbent(
            incumbent=incumbent,
            candidate=better,
            objective=freeze_routability_objective(incumbent),
            semantic_objective=semantic,
        )
        assert comparison.decision == IncumbentDecision.CANDIDATE_BETTER


class TestMetricNatures:
    def test_every_objective_metric_has_exactly_one_nature(self) -> None:
        assert set(METRIC_NATURES) == set(ObjectiveMetric)

    def test_hard_counts_and_signed_slack_are_direct_evidence(self) -> None:
        assert METRIC_NATURES[ObjectiveMetric.DRC_COUNT] == MetricNature.HARD_GATE
        assert METRIC_NATURES[ObjectiveMetric.STA_SETUP_WNS] == MetricNature.DIRECT
        assert METRIC_NATURES[ObjectiveMetric.ROUTE_WIRELENGTH] == MetricNature.DIRECT

    def test_power_is_estimated_and_composites_are_derived(self) -> None:
        assert (
            METRIC_NATURES[ObjectiveMetric.STA_TYPICAL_DYNAMIC_POWER]
            == MetricNature.ESTIMATED
        )
        assert (
            METRIC_NATURES[ObjectiveMetric.GUI_OVERALL_QOR_SCORE]
            == MetricNature.DERIVED
        )

    def test_derived_composites_cannot_back_a_preserve_constraint(self) -> None:
        with pytest.raises(ValueError, match="derived composites"):
            OptimizationObjectiveProposal(
                primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
                preserve_metrics=(ObjectiveMetric.GUI_OVERALL_QOR_SCORE,),
                rationale_summary="Keep the composite while tuning wirelength.",
            )

    def test_freeze_rejects_a_derived_preserve_metric(self) -> None:
        proposal = OptimizationObjectiveProposal.model_construct(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.GUI_OVERALL_QOR_SCORE,),
            rationale_summary="constructed directly to bypass proposal validation",
        )
        with pytest.raises(ValueError, match="derived composites"):
            freeze_optimization_objective("reduce wirelength", proposal)

    def test_proxy_overflow_stays_admissible_for_frozen_experiments(self) -> None:
        # route_la_total_overflow is PROXY but not forbidden: the experiment
        # contracts freeze it as a preserve metric.
        assert METRIC_NATURES[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] == (
            MetricNature.PROXY
        )
        assert MetricNature.PROXY not in PRESERVE_FORBIDDEN_NATURES


class TestPlannerProjectionDiscipline:
    def test_projection_carries_engineering_states_and_priorities(
        self, frozen_workspace: Path
    ) -> None:
        observation = build_terminal_observation(frozen_workspace)
        # Degraded DRC is modeled on the routed violation count, the DRC
        # decision metric (the signoff iDRC count is an artifact).
        route_path = frozen_workspace / "route_ecc/analysis/qor_metrics.json"
        route_payload = json.loads(route_path.read_text(encoding="utf-8"))
        for item in route_payload["metrics"]:
            if item["id"] == "route_dr_total_violation_count":
                item["value"] = 9.0
        route_path.write_text(
            json.dumps(route_payload, sort_keys=True), encoding="utf-8"
        )
        degraded = build_terminal_observation(frozen_workspace)
        projection = projected_terminal_observation(degraded)
        states = projection["engineering_states"]
        # Fixture STA corner rows derive Tclk = 1000/313 + 6.8 ~= 9.995 ns,
        # so setup ws 0.2 ns sits below the 0.05*Tclk guardband: WATCH.
        assert states["timing_setup"]["state"] == "WATCH"
        priorities = projection["recovery_priorities"]
        assert priorities[0]["metric_id"] == "route_dr_total_violation_count"
        assert priorities[0]["severity"] == pytest.approx(0.80 + 0.20 * 0.09)
        assert priorities[0]["tier"] == "tier_1_feasibility"
        assert "consistency_violations" not in projection

    def test_clean_observation_has_no_recovery_priorities(
        self, frozen_workspace: Path
    ) -> None:
        projection = projected_terminal_observation(
            build_terminal_observation(frozen_workspace)
        )
        assert "recovery_priorities" not in projection
        assert "qor_dimension_scores" not in projection

    def test_dimension_scores_surface_the_gui_breakdown(
        self, frozen_workspace: Path
    ) -> None:
        path = frozen_workspace / "route_ecc/analysis/qor_metrics.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        for item in payload["metrics"]:
            item.update(
                category="routability_physical",
                direction="lower_is_better",
                scope="final_route",
                corner=None,
                project_role="final",
                step_role="primary",
                analysis_group="route_metrics",
                rating={
                    "gate": False,
                    "score": item["id"] == "route_wirelength",
                    "trend": True,
                },
                source={
                    "kind": "feature",
                    "path": "feature/route_summary.json",
                    "selector": f"/{item['id']}",
                },
            )
        payload["schema_version"] = 3
        path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        observation = build_terminal_observation(frozen_workspace)
        projection = projected_terminal_observation(observation)
        # The composite stays identical (weighted 12.6*0.2 -> 2.5); the
        # breakdown names the unweighted dimension mean that limits it.
        assert observation.objective_metrics[
            ObjectiveMetric.GUI_OVERALL_QOR_SCORE
        ] == pytest.approx(2.5)
        assert projection["qor_dimension_scores"] == {
            "gui_qor_dimension_routability_physical": pytest.approx(12.6)
        }

    def test_over_provisioned_margin_is_an_opportunity_state(
        self, frozen_workspace: Path
    ) -> None:
        observation = build_terminal_observation(frozen_workspace)
        relaxed = observation.model_copy(
            update={
                "timing_guardrail": {
                    **observation.timing_guardrail,
                    TimingMetric.STA_SETUP_WNS: 8.0,
                }
            }
        )
        projection = projected_terminal_observation(relaxed)
        # Tclk ~= 9.995 ns -> over-provision threshold ~= 2.0 ns.
        assert projection["engineering_states"]["timing_setup"]["state"] == (
            "OPPORTUNITY"
        )
