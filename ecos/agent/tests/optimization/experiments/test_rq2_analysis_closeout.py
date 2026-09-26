"""Regression coverage for the RQ2 paper-ready analysis closeout."""

from __future__ import annotations

import json

from ecos_agent.optimization.experiments.rq2_activation_analysis import (
    aggregate_activation,
    episode_activation_record,
)
from ecos_agent.optimization.experiments.rq2_analysis import (
    noise_floor_calibration,
    policy_posterior,
    policy_shift,
)

DUAL = "state-conditioned-dual-layer-zero-shot"
NOKNOW = "llm-no-knowledge"


def _row(
    *,
    fingerprint: str,
    treatment: str,
    signature: str,
    repeat: int,
    status: str = "valid",
) -> dict:
    if signature.startswith("propose:"):
        parts = signature.split(":")
        l1 = f"propose:{parts[1].split('.', 1)[0]}"
        l2 = signature if len(parts) >= 3 else signature
        l3 = f"{l2}:mid" if len(parts) >= 3 else signature
        levels = {"L0": "propose", "L1": l1, "L2": l2, "L3": l3}
    else:
        levels = {level: signature for level in ("L0", "L1", "L2", "L3")}
    return {
        "design": "gcd",
        "checkpoint": "cp1",
        "state_stratum": "knowledge_opportunity",
        "context_fingerprint": fingerprint,
        "treatment": treatment,
        "repeat": repeat,
        "schema_status": status,
        "levels": levels,
    }


def _context(fingerprint: str = "cf-a") -> dict:
    return {
        "design": "gcd",
        "checkpoint": "cp1",
        "state_stratum": "knowledge_opportunity",
        "context_fingerprint": fingerprint,
        "planning_context": {
            "legal_actions": [
                {"knob_id": "place.target_density", "direction": "increase"},
                {"knob_id": "place.target_density", "direction": "decrease"},
            ],
            "effective_domains": [
                {
                    "knob_id": "place.target_density",
                    "value_bounds": {"type": "number"},
                }
            ],
        },
    }


def test_noise_floor_groups_each_context_treatment_cell() -> None:
    rows = [
        *[
            _row(
                fingerprint="cf-a",
                treatment=DUAL,
                signature="propose:place",
                repeat=repeat,
            )
            for repeat in range(1, 4)
        ],
        _row(
            fingerprint="cf-a",
            treatment=NOKNOW,
            signature="continue",
            repeat=1,
        ),
        _row(
            fingerprint="cf-a",
            treatment=NOKNOW,
            signature="propose:place",
            repeat=2,
        ),
        _row(
            fingerprint="cf-a",
            treatment=NOKNOW,
            signature="continue",
            repeat=3,
        ),
    ]

    noise = noise_floor_calibration(rows)

    assert noise["overall_within_treatment_disagreement"]["cells"] == 2
    assert noise["overall_within_treatment_disagreement"]["divergent_cells"] == 1
    assert noise["by_treatment"][DUAL]["divergent_cells"] == 0
    assert noise["by_treatment"][NOKNOW]["divergent_cells"] == 1


def test_fixed_alphabet_and_matched_context_permutation() -> None:
    rows = []
    for repeat in range(1, 4):
        rows.append(
            _row(
                fingerprint="cf-a",
                treatment=DUAL,
                signature="propose:place.target_density:increase",
                repeat=repeat,
            )
        )
        rows.append(
            _row(
                fingerprint="cf-a",
                treatment=NOKNOW,
                signature="continue",
                repeat=repeat,
            )
        )
    rows.append(
        _row(
            fingerprint="cf-a",
            treatment=NOKNOW,
            signature="provider_error",
            repeat=4,
            status="provider_error",
        )
    )

    posterior = policy_posterior(rows, contexts=[_context()], draws=50)
    cells = {
        (cell["context_fingerprint"], cell["treatment"]): cell
        for cell in posterior["cells"]
    }
    dual_l2 = cells[("cf-a", DUAL)]["levels"]["L2"]
    assert dual_l2["vocabulary_source"] == "fixed_legal_action_alphabet"
    assert "propose:place.target_density:decrease" in dual_l2["posterior_action_mass"]
    assert "provider_error" in dual_l2["posterior_action_mass"]

    shift = policy_shift(
        rows,
        contexts=[_context()],
        draws=50,
        permutations=100,
        bootstrap_draws=100,
    )
    key = f"L2|{DUAL}||{NOKNOW}"
    primary = shift["primary_all_outcomes"]["summary"][key]
    sensitivity = shift["valid_only_sensitivity"]["summary"][key]
    assert primary["matched_context_tv_mean"] == 1.0
    assert primary["permutation"]["draws"] == 100
    assert primary["design_block"]["designs"] == 1
    assert primary["leave_one_design_out"] == {}
    assert sensitivity["matched_context_tv_mean"] == 1.0
    assert shift["material_probability_role"] == "descriptive_only_uncalibrated"


def test_activation_uses_proposal_denominator_and_exact_count_merge() -> None:
    records = [
        {
            "design": "gcd",
            "episode_id": "ep-1",
            "treatment": DUAL,
            "planning_rows": 5,
            "proposals": 2,
            "claim_bound_proposals": 1,
            "executed": 1,
            "receipts": 1,
            "verified_applied": 1,
            "terminal_joined": 1,
            "promotion_joined": 1,
            "complete_attribution_chain": 1,
            "claim_bound_source_backed_activation": 1,
            "application_status_counts": {"applied": 1, "None": 4},
            "missing_evidence_reason_counts": {"receipt_link": 1},
            "expected_effect_realization": {"realized": 1},
        },
        {
            "design": "xtea",
            "episode_id": "ep-2",
            "treatment": DUAL,
            "planning_rows": 4,
            "proposals": 2,
            "claim_bound_proposals": 1,
            "executed": 2,
            "receipts": 2,
            "verified_applied": 2,
            "terminal_joined": 2,
            "promotion_joined": 2,
            "complete_attribution_chain": 2,
            "claim_bound_source_backed_activation": 1,
            "application_status_counts": {"applied": 2, "None": 2},
            "missing_evidence_reason_counts": {"receipt_link": 2},
            "expected_effect_realization": {"realized": 2},
        },
    ]

    result = aggregate_activation(records)["by_treatment"][DUAL]

    assert result["complete_attribution_join_rate"]["numerator"] == 3
    assert result["complete_attribution_join_rate"]["denominator"] == 4
    assert result["application_status_counts"] == {"None": 6, "applied": 3}
    assert result["missing_join_reason_counts"] == {"receipt_link": 3}
    assert result["claim_bound_source_backed_activation"]["numerator"] == 2
    assert result["claim_bound_source_backed_activation"]["denominator"] == 2
    assert result["expected_effect_realization"]["role"] == "diagnostic_only"


def test_episode_activation_joins_source_backed_receipt(tmp_path) -> None:
    episode = tmp_path / "report"
    episode.mkdir()
    (episode / "knowledge-mediation-audit.v1.json").write_text(
        json.dumps(
            {
                "calls": [
                    {
                        "knob": "place.target_density",
                        "direction": "increase",
                        "claim_bound": True,
                        "intervention_id": "intervention-1",
                        "application_status": "applied",
                        "consumed_value": 0.7,
                        "terminal_delta_vs_epsilon": "outside",
                        "promotion_decision": "candidate_better",
                        "counts_toward_knowledge_attribution": True,
                    }
                ],
                "decision_level_endpoints": {"expected_effect_realization": {}},
                "missing_evidence_reason_counts": {},
                "state_match": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes = tmp_path / "optimization-outcomes.v1.jsonl"
    outcomes.write_text(
        json.dumps(
            {
                "payload": {
                    "record_type": "terminal_outcome",
                    "intervention_id": "intervention-1",
                    "parameter_application_receipt": {
                        "application": {"status": "applied"},
                        "evidence_sha256": "sha256:receipt",
                        "parameter": {
                            "knob_id": "place.target_density",
                            "consumed": {
                                "value": 0.7,
                                "unit": "ratio",
                                "source": "DREAMPlace.params.target_density",
                            },
                        },
                    },
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )

    record = episode_activation_record(
        episode_root=episode,
        design="gcd",
        episode_id="ep",
        treatment=DUAL,
        outcomes_path=outcomes,
    )

    assert record["claim_bound_proposals"] == 1
    assert record["claim_bound_source_backed_activation"] == 1
