"""Run-level candidate comparison metrics: signatures, success@k, mispromotion."""

from __future__ import annotations

import pytest

from ecos_agent.optimization.experiments.equal_budget import (
    CandidateTrace,
    summarize_candidate_metrics,
)
from ecos_agent.optimization.experiments.knowledge_metrics import (
    abstention_rate,
    expected_effect_realization,
    summarize_offline_rows,
    truncation_loss,
)


def _trace(
    candidate_id: str,
    *,
    knob: str | None = "place.target_density",
    requested: float | None = 0.55,
    actual: float | None = None,
    status: str = "effective",
    feasible: bool = False,
    promoted: bool = False,
    utility: float | None = None,
) -> CandidateTrace:
    return CandidateTrace(
        design_id="gcd",
        candidate_id=candidate_id,
        started=True,
        terminal_success=utility is not None,
        terminal_utility=utility,
        requested_value=requested,
        requested_knob=knob,
        actual_value=actual if actual is not None else requested,
        parameter_status=status,  # type: ignore[arg-type]
        feasible=feasible,
        promoted=promoted,
    )


def test_signature_repeats_and_success_curve() -> None:
    traces = [
        _trace("c1", requested=0.55, utility=1.0, feasible=True),
        _trace("c2", requested=0.55, utility=1.5, feasible=True, promoted=True),
        _trace("c3", requested=0.60, actual=0.6678, status="inactive", utility=0.9),
        _trace("c4", requested=0.60, actual=0.6678, status="inactive"),
    ]
    metrics = summarize_candidate_metrics(traces, mode="receipt-aware")
    assert metrics["application_signature_repeats"]["observed"] == 4
    assert metrics["application_signature_repeats"]["unique"] == 2
    assert metrics["application_signature_repeats"]["repeat_rate"] == 0.5
    assert metrics["response_signature_repeats"]["repeat_count"] == 2
    # First candidate is feasible; the curve stays cumulative true.
    assert metrics["success_at_k"] == {1: True, 2: True, 3: True, 4: True}
    assert metrics["auc_success_at_n"] == 1.0
    assert metrics["first_feasible_candidate_index"] == 1
    assert metrics["best_feasible_candidate_id"] == "c2"
    assert metrics["best_feasible_terminal_utility"] == 1.5
    assert metrics["mispromotion_events"] == 0
    spectrum = metrics["requested_actual_deviation_spectrum"]["knobs"][
        "place.target_density"
    ]
    assert spectrum["observed"] == 4
    assert spectrum["zero_delta_count"] == 2
    assert spectrum["min_delta"] == 0.0
    assert spectrum["max_delta"] == pytest.approx(0.6678 - 0.60)


def test_first_feasible_index_and_no_curve_for_empty_episode() -> None:
    metrics = summarize_candidate_metrics([], mode="requested-only")
    assert metrics["success_at_k"] == {}
    assert metrics["auc_success_at_n"] is None
    assert metrics["first_feasible_candidate_index"] is None

    late = [
        _trace("c1", feasible=False, utility=0.5),
        _trace("c2", feasible=True, utility=2.0),
    ]
    metrics = summarize_candidate_metrics(late, mode="requested-only")
    assert metrics["success_at_k"] == {1: False, 2: True}
    assert metrics["auc_success_at_n"] == pytest.approx(0.5)
    assert metrics["first_feasible_candidate_index"] == 2


def test_receipt_aware_mispromotion_fails_loudly() -> None:
    traces = [
        _trace("c1", status="inactive", promoted=True, utility=1.0),
    ]
    with pytest.raises(ValueError, match="without an effective receipt"):
        summarize_candidate_metrics(traces, mode="receipt-aware")
    metrics = summarize_candidate_metrics(traces, mode="requested-only")
    assert metrics["mispromotion_events"] == 1


def test_expected_effect_realization_counts_contradictions() -> None:
    proposal_rows = [
        {
            "planning_entry_sha256": "sha256:a",
            "expected_effects": [
                {"metric_id": "route_wirelength", "direction": "decrease"}
            ],
        },
        {
            "planning_entry_sha256": "sha256:b",
            "expected_effects": [],
        },
    ]
    mediation_calls = [
        # Promoted, declared decrease, terminal increased: contradicted.
        {
            "planning_entry_sha256": "sha256:a",
            "promotion_decision": "candidate_better",
            "terminal_delta": 12.0,
            "terminal_delta_vs_epsilon": "outside",
        },
        # Promoted without declared effects: outside the denominator.
        {
            "planning_entry_sha256": "sha256:b",
            "promotion_decision": "candidate_better",
            "terminal_delta": -3.0,
            "terminal_delta_vs_epsilon": "outside",
        },
        # Declared decrease, realized: realized bucket.
        {
            "planning_entry_sha256": "sha256:a",
            "promotion_decision": "recovery_progress",
            "terminal_delta": -8.0,
            "terminal_delta_vs_epsilon": "outside",
        },
    ]
    rates = expected_effect_realization(
        proposal_rows, mediation_calls, objective_metric="route_wirelength"
    )
    assert rates["promoted_with_declared_effects"] == 2
    assert rates["realized"] == 1
    assert rates["contradicted"] == 1
    assert rates["contradicted_rate"] == 0.5


def test_abstention_and_truncation_rates() -> None:
    rows = [
        {"expected_behavior": "action", "correct": True},
        {"expected_behavior": "blocked", "correct": True},
        {"expected_behavior": "unknown", "correct": False},
        {"expected_behavior": "abstain"},
    ]
    abstention = abstention_rate(rows)
    assert abstention["scored_rows"] == 2
    assert abstention["correct_abstention_ratio"] == 0.5

    views = [
        {"truncated_claim_refs": ["claim-3"]},
        {"truncated_claim_refs": []},
    ]
    truncation = truncation_loss(views)
    assert truncation["rows_with_truncation"] == 1
    assert truncation["truncated_claim_ref_count"] == 1
    assert truncation["truncation_row_ratio"] == 0.5
    assert truncation_loss([])["truncation_row_ratio"] is None


def test_offline_summary_splits_claim_bound_and_unbound() -> None:
    rows = [
        {
            "treatment": "t",
            "decision": "propose",
            "context_fingerprint": "c1",
            "claim_bound": True,
            "knob": "k",
            "direction": "down",
            "requested_value": 0.5,
        },
        {
            "treatment": "t",
            "decision": "propose",
            "context_fingerprint": "c1",
            "claim_bound": True,
            "knob": "k",
            "direction": "down",
            "requested_value": 0.6,
        },
        {
            "treatment": "t",
            "decision": "propose",
            "context_fingerprint": "c1",
            "claim_bound": False,
            "knob": "k",
            "direction": "down",
            "requested_value": 0.5,
        },
        {"treatment": "t", "decision": "abstain", "context_fingerprint": "c1"},
    ]
    treatment = summarize_offline_rows(rows)["treatments"]["t"]
    assert treatment["claim_bound_proposals"] == 2
    assert treatment["claim_bound_ratio"] == pytest.approx(2 / 3)
    assert treatment["claim_bound_exact_action_divergence"]["unique_actions"] == 2
    assert treatment["claim_bound_within_treatment_disagreement"] == 1
    assert treatment["unbound_exact_action_divergence"]["unique_actions"] == 1
    assert treatment["unbound_within_treatment_disagreement"] == 0


def test_misleading_steps_count_probes_until_next_promotion() -> None:
    traces = [
        _trace("c1", promoted=True, status="effective"),
        # mispromotion #1: two probes run against the wrong incumbent
        _trace("c2", promoted=True, status="inactive"),
        _trace("c3"),
        _trace("c4"),
        _trace("c5", promoted=True, status="effective"),
        # mispromotion #2: runs until the episode ends
        _trace("c6", promoted=True, status="unknown"),
        _trace("c7"),
    ]
    metrics = summarize_candidate_metrics(traces, mode="requested-only")
    assert metrics["mispromotion_events"] == 2
    assert metrics["mispromotion_misleading_steps"] == {
        "events": 2,
        "steps_by_event": [2, 1],
        "total_steps": 3,
    }


def test_state_match_summary_aggregates_coverage_and_precision() -> None:
    from ecos_agent.optimization.experiments.knowledge_metrics import (
        state_match_summary,
    )

    rows = [
        {
            "matched_claim_ids": ["claim-1"],
            "claim_bound": True,
            "support_status": "matched",
        },
        {
            "matched_claim_ids": ["claim-2"],
            "claim_bound": False,
            "support_status": "matched",
        },
        {
            "matched_claim_ids": [],
            "claim_bound": False,
            "support_status": "unknown",
        },
    ]
    summary = state_match_summary(rows)
    assert summary["planning_rows"] == 3
    assert summary["matched_rows"] == 2
    assert summary["state_match_coverage"] == pytest.approx(2 / 3)
    assert summary["claim_bound_rows"] == 1
    assert summary["state_match_precision"] == pytest.approx(0.5)
    assert summary["unknown_ratio"] == pytest.approx(1 / 3)

    empty = state_match_summary([])
    assert empty["state_match_coverage"] is None
    assert empty["state_match_precision"] is None


def test_episode_final_states_counts_escalations() -> None:
    from ecos_agent.optimization.experiments.equal_budget import (
        summarize_episode_final_states,
    )

    summary = summarize_episode_final_states(
        ["stopped", "escalated", "escalated", "quarantined"]
    )
    assert summary["episodes"] == 4
    assert summary["final_state_counts"] == {
        "escalated": 2,
        "quarantined": 1,
        "stopped": 1,
    }
    assert summary["escalated_episodes"] == 2
    assert summary["escalation_rate"] == pytest.approx(0.5)


def test_shadow_duplicates_and_divergence_counters() -> None:
    """The PPU prototype: requests 0.3 and 0.2 both applied 0.4509 — the
    second probe explored nothing new, and a requested-only planner cannot
    perceive that.  Divergence counts meaningful (protection-tolerance)
    requested-vs-actual gaps; grid-snap-sized wobble stays unadjusted."""
    traces = [
        _trace("c1", requested=0.3, actual=0.4509, feasible=True, utility=1.0),
        _trace("c2", requested=0.2, actual=0.4509),
        _trace("c3", requested=0.55, actual=0.55),
        _trace("c4", requested=0.65, actual=0.65, promoted=True),
        # grid snap within the protection tolerance is not a divergence
        _trace("c5", requested=0.67, actual=0.6722),
    ]
    metrics = summarize_candidate_metrics(traces, mode="requested-only")
    assert metrics["requested_actual_divergence"] == {
        "observed": 5,
        "adjusted": 2,
        "adjusted_rate": pytest.approx(0.4),
    }
    shadow = metrics["shadow_duplicate_configs"]
    assert shadow["count"] == 1
    assert shadow["events"] == [
        {
            "candidate_id": "c2",
            "requested": 0.2,
            "actual": 0.4509,
            "first_requested": 0.3,
        }
    ]


def test_shadow_duplicate_ignores_exact_request_repeats() -> None:
    """An identical requested value repeated is an application-signature
    repeat (already counted elsewhere), not a shadow duplicate."""
    traces = [
        _trace("c1", requested=0.3, actual=0.4509),
        _trace("c2", requested=0.3, actual=0.4509),
    ]
    metrics = summarize_candidate_metrics(traces, mode="requested-only")
    assert metrics["shadow_duplicate_configs"]["count"] == 0


def test_divergence_counters_are_empty_without_numeric_pairs() -> None:
    traces = [
        _trace("c1", knob="place.routability_opt", requested=False, actual=False),
        _trace("c2", knob=None, requested=None, actual=None),
    ]
    metrics = summarize_candidate_metrics(traces, mode="requested-only")
    assert metrics["requested_actual_divergence"] == {
        "observed": 0,
        "adjusted": 0,
        "adjusted_rate": 0.0,
    }
    assert metrics["shadow_duplicate_configs"]["count"] == 0
