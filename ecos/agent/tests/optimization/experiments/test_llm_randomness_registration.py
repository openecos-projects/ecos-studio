"""LLM-randomness registration: Wilson CI, paired divergence, replay arms.

Covers the A1/A2/A3/B3/C1 code deliverables of the LLM-randomness control
plan: provider/protocol registration fields, the offline divergence-rate
judgment with Wilson intervals, decision-level co-primary endpoints, the
deterministic shadow-duplicate replay provider, and repeat sensitivity.
"""

from __future__ import annotations

import math
from types import SimpleNamespace

import pytest

from tests.optimization.parameters.effectiveness_support import (
    HASH,
    domain_context,
)

from ecos_agent.optimization.contracts import (
    ObservationReference,
    OptimizationKnob,
    ProposalContextRef,
)
from ecos_agent.optimization.experiments.knowledge_metrics import (
    decision_level_endpoints,
    paired_action_divergence,
    wilson_score_interval,
)
from ecos_agent.optimization.experiments.knowledge_protocol import (
    THREATS_REGISTRATION,
    build_protocol_manifest,
    validate_protocol_manifest,
)
from ecos_agent.optimization.experiments.replay_provider import (
    ReplayProposalProvider,
)
from ecos_agent.optimization.experiments.statistics import repeat_sensitivity
from ecos_agent.optimization.parameters.effective_domain import (
    compile_effective_domain,
    validate_optimization_proposal_v2,
)
from ecos_agent.optimization.parameters.semantics import load_parameter_cards


def _density_domain(attempted=()):
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    return compile_effective_domain(
        card,
        context=domain_context(attempted_values=tuple(attempted)),
        attempted=tuple(attempted),
        baseline_surface_value=0.2,
    )


def _replay_context():
    return SimpleNamespace(
        context_ref=ProposalContextRef(
            episode_id="episode-1",
            checkpoint_id="place",
            input_sha256=HASH,
        ),
        observation_ref=ObservationReference(observation_id="obs-1", sha256=HASH),
    )


def test_wilson_interval_bounds() -> None:
    single = wilson_score_interval(1, 15)
    assert single["lo"] > 0.0
    assert single["hi"] < 1.0
    assert single["lo"] < single["rate"] < single["hi"]
    assert wilson_score_interval(0, 15)["lo"] == 0.0
    assert wilson_score_interval(15, 15)["hi"] == 1.0
    empty = wilson_score_interval(0, 0)
    assert empty["rate"] is None and empty["lo"] is None
    for successes, total in ((0, 4), (1, 4), (4, 4)):
        row = wilson_score_interval(successes, total)
        assert 0.0 <= row["lo"] <= row["hi"] <= 1.0


def _offline_row(treatment, fingerprint, repeat, knob, direction, value, decision="propose"):
    return {
        "treatment": treatment,
        "context_fingerprint": fingerprint,
        "repeat": repeat,
        "decision": decision,
        "knob": knob,
        "direction": direction,
        "requested_value": value,
    }


def test_paired_divergence_counts_matched_cells_only() -> None:
    dual = "state-conditioned-dual-layer-zero-shot"
    base = "llm-no-knowledge"
    rows = [
        _offline_row(dual, "ctx-a", 1, "place.target_density", "decrease", 0.4),
        _offline_row(base, "ctx-a", 1, "place.target_density", "increase", 0.5),
        _offline_row(dual, "ctx-b", 1, "place.target_overflow", "decrease", 0.08),
        _offline_row(base, "ctx-b", 1, "place.target_overflow", "decrease", 0.08),
        # ctx-c is proposed by only one arm: unmatched, stays out of the rate.
        _offline_row(dual, "ctx-c", 1, "place.cell_padding_x", "increase", 4),
    ]
    report = paired_action_divergence(rows, base_treatment=base, target_treatment=dual)
    assert report["matched_cells"] == 2
    assert report["divergent_cells"] == 1
    assert report["rate"] == 0.5
    assert 0.0 < report["lo"] < report["hi"] < 1.0


def test_decision_level_endpoints_aggregates_planning_calls() -> None:
    promoted = {
        "planning_entry_sha256": "entry-1",
        "promotion_decision": "candidate_better",
        "claim_bound": True,
        "knob": "place.target_density",
        "direction": "decrease",
        "requested_value": 0.4,
        "terminal_delta": -12.0,
        "terminal_delta_vs_epsilon": "outside",
    }
    unbound = {
        "promotion_decision": "incumbent_retained",
        "claim_bound": False,
        "knob": "place.cell_padding_x",
        "direction": "increase",
        "requested_value": 4,
        "terminal_delta": 0.0,
        "terminal_delta_vs_epsilon": "within",
    }
    no_proposal = {"promotion_decision": None, "claim_bound": False, "knob": None, "direction": None}
    proposal_rows = [
        {
            "planning_entry_sha256": "entry-1",
            "expected_effects": [
                {"metric_id": "route_wirelength", "direction": "decrease"}
            ],
        }
    ]
    endpoints = decision_level_endpoints(
        [promoted, unbound, no_proposal],
        proposal_rows,
        objective_metric="route_wirelength",
    )
    assert endpoints["planning_rows"] == 3
    assert endpoints["proposals"] == 2
    assert endpoints["non_proposal_rate"] == pytest.approx(1 / 3)
    assert endpoints["claim_bound_rate"] == 0.5
    effects = endpoints["expected_effect_realization"]
    assert effects["realized"] == 1
    assert effects["contradicted"] == 0


def test_repeat_sensitivity_drops_extremes() -> None:
    report = repeat_sensitivity([-10.0, 1.0, 2.0, 3.0, 40.0], epsilon=5.0)
    assert report["middle_values"] == [1.0, 2.0, 3.0]
    assert report["full_range"] == 50.0
    assert report["middle_range"] == 2.0
    assert report["middle_stable_within_epsilon"] is True
    wide = repeat_sensitivity([0.0, 1.0, 5.0, 9.0], epsilon=2.0)
    assert wide["middle_values"] == [1.0, 5.0]
    assert wide["middle_stable_within_epsilon"] is False
    with pytest.raises(ValueError):
        repeat_sensitivity([1.0, 2.0])


def test_protocol_manifest_registers_randomness_facts() -> None:
    manifest = build_protocol_manifest(
        design_ids=["gcd"],
        treatments=["llm-no-knowledge"],
        knowledge_bundle_sha256=HASH,
        state_rule_manifest_sha256=HASH,
        objective_contract_sha256=HASH,
        toolchain={"ecc_executable_sha256": HASH},
        model={
            "name": "glm-5.3-flash",
            "reasoning_effort": "medium",
            "planner_seed": 0,
            "planner_seed_note": (
                "registration only; provider sampling cannot be seeded"
            ),
        },
        budget={"candidate_limit": 0, "planning_call_limit": 60, "repeats": 5},
        bank={"context_count": 10, "strata_counts": {"knowledge_opportunity": 4}},
        prompt_skeleton={"knowledge_pilot_module_sha256": HASH},
        noise_rule={"schema_version": "ecos.offline_pilot_noise.v1"},
    )
    assert manifest["threats_registration"] == list(THREATS_REGISTRATION)
    assert manifest["bank"]["context_count"] == 10
    assert manifest["prompt_skeleton"]["knowledge_pilot_module_sha256"] == HASH
    assert "cannot be seeded" in manifest["model"]["planner_seed_note"]
    validate_protocol_manifest(manifest)


def _replay_spec(**overrides):
    spec = {
        "knob_id": "place.target_density",
        "direction": "increase",
        "requested_value": 0.55,
        "expected_effects": [
            {"metric_id": "route_wirelength", "direction": "decrease"}
        ],
    }
    spec.update(overrides)
    return spec


def test_replay_provider_rebuilds_a_valid_v3_proposal() -> None:
    domain = _density_domain()
    provider = ReplayProposalProvider([_replay_spec()])
    payload = provider.propose_v2(_replay_context(), (domain,))
    assert payload["decision"] == "propose"
    assert payload["action"]["requested_value"] == 0.55
    assert payload["action"]["effective_domain_sha256"] == domain.snapshot_sha256
    validated = validate_optimization_proposal_v2(
        payload,
        domain,
        context_ref=_replay_context().context_ref.model_dump(mode="json"),
        attempted=domain.attempted_values,
    )
    assert validated.action.requested_value == 0.55
    assert provider.consumed == 1


def test_replay_provider_requires_expected_effects_and_exhausts_cleanly() -> None:
    with pytest.raises(ValueError):
        ReplayProposalProvider([_replay_spec(expected_effects=[])])
    provider = ReplayProposalProvider([_replay_spec()])
    provider.propose_v2(_replay_context(), (_density_domain(),))
    tail = provider.propose_v2(_replay_context(), (_density_domain(),))
    assert tail["decision"] == "continue"
    assert provider.consumed == 1


def test_replay_provider_rejects_partial_knowledge_binding() -> None:
    provider = ReplayProposalProvider(
        [_replay_spec(claim_id="claim-1", binding_id=None)]
    )
    with pytest.raises(ValueError):
        provider.propose_v2(_replay_context(), (_density_domain(),))
