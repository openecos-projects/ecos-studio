"""Formal RQ2 knowledge experiment: protocol, projection, adaptive behavior."""

from __future__ import annotations

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    LegalAction,
    StageObservation,
)
from ecos_agent.optimization.experiments.knowledge_pilot import (
    apply_treatment,
    freeze_planning_context,
    rebuild_planning_context,
)
from ecos_agent.optimization.experiments.frozen_contexts import build_frozen_context
from ecos_agent.optimization.experiments.knowledge_protocol import (
    RQ2_DESIGNS,
    validate_design_ids,
    validate_rq2_design_ids,
)
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    MECHANISM_ONLY_TREATMENTS,
    RQ2_TREATMENTS,
    STRATUM_ALIASES,
    AdaptiveConfig,
    action_signature_levels,
    adaptive_stopping_decision,
    build_rq2_frozen_context,
    build_rq2_manifest,
    canonical_stratum,
    rq2_treatment_projection,
    upgrade_bank_contexts,
    validate_rq2_context_bank,
    validate_rq2_frozen_context,
    validate_rq2_manifest,
)
from ecos_agent.optimization.knowledge.compiler import (
    StateEvidenceFeature,
    build_state_evidence_request,
    compile_supported_action_view,
)
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainSnapshot,
)
from ecos_agent.optimization.experiments.rq2_adaptive_runner import (
    run_rq2_adaptive_group,
)
from ecos_agent.optimization.experiments.rq2_order_balanced_runner import (
    build_order_balanced_schedule,
    run_order_balanced_worker,
    validate_order_balanced_schedule,
)
from tests.optimization.support import support_catalog

HASH = "sha256:" + "a" * 64
REFERENCE = KnowledgeReference(
    entity_id="strategy.congestion.local_density_spreading.v1",
    chunk_sha256="b" * 64,
)


def _domain() -> EffectiveDomainSnapshot:
    payload = {
        "schema_version": "ecos.effective_domain.v4",
        "knob_id": "place.target_density",
        "context_sha256": HASH,
        "current_coordinate": {"surface_value": 0.85},
        "value_bounds": {
            "type": "number",
            "minimum": 0.05,
            "maximum": 0.95,
            "exclusive_minimum": False,
            "exclusive_maximum": False,
        },
        "attempted_values": (),
    }
    return EffectiveDomainSnapshot(
        **payload, snapshot_sha256=canonical_sha256(payload)
    )


def _observation() -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"route_la_total_overflow": 12.0},
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0)),
    )


def _state(*, feature_value: object = True):
    extra = (
        StateEvidenceFeature(
            feature_id="place_lutrudy_utilization_max",
            value=feature_value,
            evidence_sha256=HASH,
        ),
    ) if feature_value is not None else ()
    return build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
        extra_features=extra,
    )


def _view(*, feature_value: object = True):
    domain = _domain()
    return compile_supported_action_view(
        state=_state(feature_value=feature_value),
        catalog=support_catalog(REFERENCE),
        candidate_refs=(REFERENCE,),
        retrieval_ranked_refs=(REFERENCE,),
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(domain,),
    )


def _planning_context(*, feature_value: object = True):
    observation = _observation()
    domain = _domain()
    view = _view(feature_value=feature_value)
    return rebuild_planning_context(
        {
            "context_ref": {
                "episode_id": "rq2-bank-gcd-cp1",
                "checkpoint_id": "place",
                "input_sha256": HASH,
            },
            "observation_ref": {
                "observation_id": observation.observation_id,
                "sha256": canonical_sha256(observation.model_dump(mode="json")),
            },
            "observation": observation.model_dump(mode="json"),
            "budget": BudgetSnapshot(
                budget=EpisodeBudget.from_reference_rerun(11.0)
            ).model_dump(mode="json"),
            "current_values": {"place.target_density": 0.85},
            "legal_actions": [
                LegalAction(
                    knob_id="place.target_density", direction="decrease"
                ).model_dump(mode="json")
            ],
            "effective_domains": [domain.model_dump(mode="json")],
            "knowledge_chunks": ["spread local movable cells under hotspot pressure"],
            "supported_action_view": view.model_dump(mode="json"),
        }
    )


def _v1_context(*, stratum: str = "knowledge_opportunity") -> dict:
    domain = _domain()
    return build_frozen_context(
        {
            "design_id": "gcd",
            "source_episode_id": "rq2-bank-gcd-cp1",
            "stage": "place",
            "observation_sha256": HASH,
            "objective_contract_sha256": HASH,
            "legal_domain_sha256": domain.snapshot_sha256,
            "knowledge_bundle_sha256": "sha256:" + "e" * 64,
            "stratum": stratum,
            "expected_behavior": "action",
            "label_evidence": "fixture",
            "planning_context": freeze_planning_context(_planning_context()),
        }
    )


def _rq2_context(**overrides) -> dict:
    upgraded, _ = upgrade_bank_contexts(
        [_v1_context()],
        design="gcd",
        checkpoint="cp1",
        source_artifacts=["fixture"],
        toolchain_sha256=HASH,
        prompt_skeleton_sha256=HASH,
        state_rule_manifest_sha256=HASH,
    )
    context = upgraded[0]
    context.update(overrides)
    return build_rq2_frozen_context(context)


@pytest.fixture(autouse=True)
def _synthetic_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the unconditioned recompile at this module's synthetic catalog.

    The production projection rebuilds the real bundle catalog and fails
    closed on any hash drift; the formal G1 acceptance exercise runs against
    the real bank.  Unit tests swap in the fixture catalog so the projection
    ladder itself stays testable in isolation.
    """
    import ecos_agent.optimization.experiments.knowledge_pilot as pilot_module

    monkeypatch.setattr(
        pilot_module,
        "knowledge_support_catalog_from_bundles",
        lambda bundles: support_catalog(REFERENCE),
    )
    monkeypatch.setattr(
        pilot_module, "load_default_general_knowledge_bundles", lambda: ()
    )


class _ScriptedProvider:
    """Claim-bound proposal when a supported view exists; abstain otherwise."""

    def __init__(self, *, outcomes: dict[str, str] | None = None) -> None:
        self.outcomes = outcomes or {}
        self.calls = 0

    def select_model(self, model: str) -> None:
        self.model = model

    def set_model_settings(self, *, reasoning_effort: str | None = None) -> None:
        self.effort = reasoning_effort

    def get_model_settings(self) -> dict:
        return {
            "model": getattr(self, "model", "glm-5.3-flash"),
            "reasoningEffort": getattr(self, "effort", "medium"),
        }

    def close(self) -> None:
        return None

    def propose_v2(self, context, domains):
        self.calls += 1
        mode = self.outcomes.get("mode", "claim_bound")
        if mode == "provider_error":
            raise RuntimeError("provider transport unavailable")
        payload: dict = {
            "schema_version": "ecos.optimization_proposal.v3",
            "context_ref": context.context_ref.model_dump(mode="json"),
            "decision": "continue",
            "reason_code": "rq2_script",
            "rationale_summary": "no supported action",
            "observation_refs": [context.observation_ref.model_dump(mode="json")],
        }
        view = context.supported_action_view
        if mode == "claim_bound" and view is not None and view.actions:
            action = view.actions[0]
            domain = next(item for item in domains if item.knob_id == action.knob_id)
            payload["decision"] = "propose"
            payload["rationale_summary"] = "claim-bound probe"
            payload["action"] = {
                "claim_id": action.claim_ref.entity_id,
                "claim_sha256": action.claim_sha256,
                "binding_id": action.binding_id,
                "binding_sha256": action.binding_sha256,
                "knob_id": action.knob_id.value,
                "direction": action.direction.value,
                "requested_value": 0.4,
                "effective_domain_sha256": domain.snapshot_sha256,
                "expected_effects": [
                    {"metric_id": "route_la_total_overflow", "direction": "decrease"}
                ],
            }
        return payload


def test_rq2_cohort_separates_from_pilot() -> None:
    assert RQ2_DESIGNS == ("dcpu", "gcd", "i2c", "s35932", "vm80", "xtea")
    assert validate_rq2_design_ids(["xtea", "gcd"]) == ("gcd", "xtea")
    with pytest.raises(ValueError, match="frozen cohort"):
        validate_rq2_design_ids(["gcd", "big_design"])
    with pytest.raises(ValueError, match="pilot cohort"):
        validate_design_ids(["dcpu"])


def test_rq2_manifest_freezes_contract_and_rejects_tampering() -> None:
    manifest = build_rq2_manifest(
        model="glm-5.3-flash",
        reasoning_effort="medium",
        seed=0,
        objective="wirelength",
        geometry_mode="variable",
        knowledge_bundle_sha256=HASH,
        state_rule_manifest_sha256=HASH,
        toolchain={"ecc": "sha256:x"},
        prompt_skeleton_sha256=HASH,
    )
    validate_rq2_manifest(manifest)
    assert manifest["treatments"] == list(RQ2_TREATMENTS)
    assert set(MECHANISM_ONLY_TREATMENTS) == {"unconditioned-support-zero-shot"}
    assert manifest["teacher_forced_logprob_supported"] is False
    tampered = {**manifest, "material_shift_threshold": 0.9}
    with pytest.raises(ValueError, match="hash mismatch"):
        validate_rq2_manifest(tampered)


def test_frozen_context_v2_contract() -> None:
    context = _rq2_context()
    validate_rq2_frozen_context(context)
    for key in (
        "objective_contract_sha256",
        "legal_actions_sha256",
        "trajectory_snapshot_sha256",
        "knowledge_bundle_sha256",
        "state_rule_manifest_sha256",
        "toolchain_sha256",
        "prompt_skeleton_sha256",
    ):
        tampered = {**context, key: "sha256:" + "f" * 64}
        with pytest.raises(ValueError, match="hash mismatch"):
            validate_rq2_frozen_context(tampered)
    excluded = _rq2_context(eligibility="excluded", exclusion_reason=None)
    with pytest.raises(ValueError, match="typed reason"):
        validate_rq2_frozen_context(excluded)
    unknown = _rq2_context(state_stratum="unsupported_action")
    with pytest.raises(ValueError, match="stratum"):
        validate_rq2_frozen_context(unknown)
    assert canonical_stratum("missing_observation") == "missing_required_evidence"
    assert STRATUM_ALIASES["unsupported_action"] == "no_supported_action"


def test_context_bank_validation_rejects_mixing_and_repeats() -> None:
    context = _rq2_context()
    bank = {
        "schema_version": "ecos.rq2_context_bank.v1",
        "design": "gcd",
        "contexts": [context],
    }
    validate_rq2_context_bank(bank)
    with pytest.raises(ValueError, match="repeats a context fingerprint"):
        validate_rq2_context_bank({**bank, "contexts": [context, context]})
    other = _rq2_context(design="xtea")
    with pytest.raises(ValueError, match="mixes designs"):
        validate_rq2_context_bank({**bank, "contexts": [context, other]})
    with pytest.raises(ValueError, match="outside the frozen cohort"):
        validate_rq2_context_bank({**bank, "design": "big_design"})


def test_upgrade_records_excluded_strata_with_reasons() -> None:
    contexts, excluded = upgrade_bank_contexts(
        [_v1_context()],
        design="gcd",
        checkpoint="cp1",
        source_artifacts=["fixture"],
        toolchain_sha256=HASH,
        prompt_skeleton_sha256=HASH,
        state_rule_manifest_sha256=HASH,
    )
    assert [item["state_stratum"] for item in contexts] == ["knowledge_opportunity"]
    excluded_strata = {item["state_stratum"] for item in excluded}
    assert "stale_binding" in excluded_strata
    assert "no_supported_action" in excluded_strata
    assert all(item["reason"] for item in excluded)


def test_treatment_projection_moves_only_the_knowledge_layer() -> None:
    context = _rq2_context()
    projections = {
        treatment: rq2_treatment_projection(context, treatment=treatment)
        for treatment in RQ2_TREATMENTS
    }
    hashes = {
        treatment: result["context_treatment_sha256"]
        for treatment, result in projections.items()
    }
    assert len(set(hashes.values())) == len(RQ2_TREATMENTS)
    assert projections["llm-no-knowledge"]["treatment_diff"]["knowledge_refs_count"] == 0
    assert (
        projections["llm-no-knowledge"]["treatment_diff"]["supported_action_view_sha256"]
        is None
    )
    assert (
        projections["current-metric-id-raw-rag"]["treatment_diff"][
            "supported_action_view_sha256"
        ]
        is None
    )
    dual = projections["state-conditioned-dual-layer-zero-shot"]
    uncond = projections["unconditioned-support-zero-shot"]
    assert dual["treatment_diff"]["state_gated"] is True
    assert uncond["treatment_diff"]["state_gated"] is False
    assert dual["treatment_diff"]["correctness_role"] == "gate_scored"
    assert uncond["treatment_diff"]["correctness_role"] == "mechanism_only"
    assert (
        dual["treatment_diff"]["base_supported_action_view_sha256"]
        == uncond["treatment_diff"]["base_supported_action_view_sha256"]
    )
    with pytest.raises(ValueError, match="unknown RQ2 treatment"):
        rq2_treatment_projection(context, treatment="not-a-treatment")


def test_unconditioned_projection_requires_matching_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # feature absent -> the state predicate gate blocks every action
    context = _planning_context(feature_value=None)
    gated = apply_treatment(context, agent_mode="full_agent")
    assert not gated.supported_action_view.actions
    import ecos_agent.optimization.experiments.knowledge_pilot as pilot_module

    monkeypatch.setattr(
        pilot_module,
        "knowledge_support_catalog_from_bundles",
        lambda bundles: support_catalog(REFERENCE),
    )
    monkeypatch.setattr(
        pilot_module, "load_default_general_knowledge_bundles", lambda: ()
    )
    ungated = apply_treatment(context, agent_mode="unconditioned_support")
    assert ungated.supported_action_view.actions
    assert (
        ungated.supported_action_view.catalog_sha256
        == gated.supported_action_view.catalog_sha256
    )
    monkeypatch.setattr(
        pilot_module,
        "knowledge_support_catalog_from_bundles",
        lambda bundles: support_catalog(REFERENCE).model_copy(
            update={"catalog_sha256": "sha256:" + "f" * 64}
        ),
    )
    with pytest.raises(ValueError, match="catalog drifted"):
        apply_treatment(rebuild_planning_context(
            freeze_planning_context(context)
        ), agent_mode="unconditioned_support")
    with pytest.raises(ValueError, match="requires a supported action view"):
        apply_treatment(
            rebuild_planning_context(
                freeze_planning_context(_planning_context())
                | {"supported_action_view": None}
            ),
            agent_mode="unconditioned_support",
        )


def test_action_signature_levels_project_the_registered_ladder() -> None:
    domain = _domain()
    context = _planning_context()
    action = None
    for item in context.supported_action_view.actions:
        if item.knob_id.value == "place.target_density":
            action = item
            break
    assert action is not None

    class _Action:
        knob_id = action.knob_id
        direction = action.direction
        requested_value = 0.4
        claim_id = action.claim_ref.entity_id
        claim_sha256 = action.claim_sha256
        binding_id = action.binding_id
        binding_sha256 = action.binding_sha256

    class _UnboundAction(_Action):
        claim_id = None
        claim_sha256 = None
        binding_id = None
        binding_sha256 = None

    signature = action_signature_levels(
        decision="propose", action=_Action(), effective_domains=(domain,)
    )
    assert signature["L0"] == "propose"
    assert signature["L1"] == "propose:place"
    assert signature["L2"] == "propose:place.target_density:decrease"
    assert signature["L3"].endswith(":mid")
    assert signature["evidence_status"] == "claim_bound"
    unbound = action_signature_levels(
        decision="propose", action=_UnboundAction(), effective_domains=(domain,)
    )
    assert unbound["evidence_status"] == "unbound"
    abstain = action_signature_levels(
        decision="continue", action=None, effective_domains=()
    )
    assert abstain["L1"] == "continue"
    error = action_signature_levels(
        decision="provider_error", action=None, effective_domains=()
    )
    assert error["evidence_status"] == "blocked"


def test_adaptive_stopping_extends_and_classifies() -> None:
    config = AdaptiveConfig(levels=(3, 5, 7), draws=200)
    unanimous = {t: {"propose:place": 3} for t in RQ2_TREATMENTS}
    decision = adaptive_stopping_decision(
        unanimous, config=config, context_fingerprint="cf-1", level=3
    )
    assert decision["stop"] is True
    assert set(decision["stopping_reasons"].values()) == {"concentrated"}
    divergent = {
        "llm-no-knowledge": {"propose:place": 2, "propose:cts": 1},
        "current-metric-id-raw-rag": {"propose:place": 3},
        "unconditioned-support-zero-shot": {"propose:place": 3},
        "state-conditioned-dual-layer-zero-shot": {"abstain": 3},
    }
    extending = adaptive_stopping_decision(
        divergent, config=config, context_fingerprint="cf-1", level=3
    )
    assert extending["stop"] is False
    uncertain = adaptive_stopping_decision(
        divergent, config=config, context_fingerprint="cf-1", level=7
    )
    assert uncertain["stop"] is False
    assert "uncertain" in set(uncertain["stopping_reasons"].values())
    failing = {
        "llm-no-knowledge": {"provider_error": 3},
        "current-metric-id-raw-rag": {"propose:place": 3},
        "unconditioned-support-zero-shot": {"propose:place": 3},
        "state-conditioned-dual-layer-zero-shot": {"propose:place": 3},
    }
    failure = adaptive_stopping_decision(
        failing, config=config, context_fingerprint="cf-1", level=3
    )
    assert failure["stopping_reasons"]["llm-no-knowledge"] == "provider_failure"


def test_adaptive_group_records_rows_samples_and_posteriors() -> None:
    context = _rq2_context()
    provider = _ScriptedProvider()
    config = AdaptiveConfig(draws=200)
    group = run_rq2_adaptive_group(
        provider, context, config=config, worker="0/1"
    )
    # Dual proposes while NoKnow/RawRAG abstain, so the R=3 material-shift
    # probability is not yet resolved at the 0.95 cutoff and the ladder must
    # extend before stopping -- the adaptive schedule doing its job.
    assert group["repeats_used"] == 5
    assert [sample["level"] for sample in group["samples"]] == [3, 5]
    assert group["samples"][-1]["decision"]["stop"] is True
    assert group["samples"][0]["decision"]["stop"] is False
    assert len(group["rows"]) == len(RQ2_TREATMENTS) * 5
    by_treatment = {}
    for row in group["rows"]:
        by_treatment.setdefault(row["treatment"], []).append(row)
    assert set(by_treatment) == set(RQ2_TREATMENTS)
    dual_rows = by_treatment["state-conditioned-dual-layer-zero-shot"]
    assert all(row["schema_status"] == "valid" for row in dual_rows)
    assert all(row["provider_metadata"]["model"] == "glm-5.3-flash" for row in dual_rows)
    assert all(row["request_id"] for row in dual_rows)
    assert all(row["raw_response_sha256"] for row in dual_rows)
    noknow_rows = by_treatment["llm-no-knowledge"]
    assert all(row["levels"]["L1"] == "continue" for row in noknow_rows)
    assert {row["repeat"] for row in dual_rows} == {1, 2, 3, 4, 5}
    dual = by_treatment["state-conditioned-dual-layer-zero-shot"]
    assert any(row["levels"]["L1"] == "propose:place" for row in dual)
    assert any(row["claim_ids"] for row in dual)
    assert len(group["posteriors"]) == len(RQ2_TREATMENTS)
    for posterior in group["posteriors"]:
        assert set(posterior["levels"]) == {"L0", "L1", "L2", "L3"}
        assert posterior["adaptive_repeats_used"] == 5
        assert posterior["stopping_reason"] == "concentrated"
    uncond = next(
        item
        for item in group["posteriors"]
        if item["treatment"] == "unconditioned-support-zero-shot"
    )
    assert uncond["correctness_role"] == "mechanism_only"


def test_provider_errors_stay_in_the_denominator() -> None:
    context = _rq2_context()
    provider = _ScriptedProvider(outcomes={"mode": "provider_error"})
    config = AdaptiveConfig(levels=(3,), draws=200)
    group = run_rq2_adaptive_group(provider, context, config=config, worker="0/1")
    assert len(group["rows"]) == len(RQ2_TREATMENTS) * 3
    assert all(row["schema_status"] == "provider_error" for row in group["rows"])
    assert all(row["invalid_reason"] for row in group["rows"])
    for posterior in group["posteriors"]:
        assert posterior["stopping_reason"] == "provider_failure"
        assert posterior["observation_counts"]["provider_error"] == 3


def test_knowledge_treatment_flag_contract() -> None:
    """--knowledge-treatment pins mode + receipt-aware planning, fail-closed."""
    from ecos_agent.optimization.experiments.closed_loop_driver import main

    base = [
        "--design", "gcd",
        "--run-root", "/tmp/rq2-unused",
        "--designs-root", "/tmp/rq2-designs",
        "--pdk-root", "/tmp/rq2-pdk",
    ]
    with pytest.raises(SystemExit, match="receipt-aware execution contract"):
        main(
            None,
            [
                *base,
                "--planning-evidence", "requested-only",
                "--knowledge-treatment", "llm-no-knowledge",
            ],
        )
    with pytest.raises(SystemExit, match="conflicts with the mode implied"):
        main(
            None,
            [
                *base,
                "--knowledge-treatment", "llm-no-knowledge",
                "--agent-mode", "full_agent",
            ],
        )
    with pytest.raises(SystemExit, match="design id is invalid"):
        # the treatment resolves before any filesystem access; an invalid
        # design id then still fails closed without touching disk
        main(
            None,
            [
                *base,
                "--design", "big design",
                "--knowledge-treatment", "unconditioned-support-zero-shot",
            ],
        )


def _analysis_row(*, design: str, fingerprint: str, treatment: str, signature: str,
                  stratum: str = "knowledge_opportunity", status: str = "valid") -> dict:
    return {
        "design": design,
        "checkpoint": "cp1",
        "state_stratum": stratum,
        "context_fingerprint": fingerprint,
        "treatment": treatment,
        "repeat": 1,
        "schema_status": status,
        "levels": {
            "L0": signature,
            "L1": signature,
            "L2": signature,
            "L3": signature,
            "evidence_status": (
                "claim_bound" if signature.startswith("propose") else "abstain"
            ),
        },
    }


def test_analysis_noise_floor_posterior_and_shift() -> None:
    from ecos_agent.optimization.experiments.rq2_analysis import (
        noise_floor_calibration,
        policy_posterior,
        policy_shift,
        provenance_support,
    )

    dual = "state-conditioned-dual-layer-zero-shot"
    noknow = "llm-no-knowledge"
    rows = []
    # cf-a: Dual proposes place; NoKnow abstains -> material shift
    for repeat in range(3):
        rows.append(_analysis_row(design="gcd", fingerprint="cf-a", treatment=dual,
                                  signature="propose:place"))
        rows.append(_analysis_row(design="gcd", fingerprint="cf-a", treatment=noknow,
                                  signature="continue"))
    # cf-b: both arms identical -> no shift
    for repeat in range(3):
        rows.append(_analysis_row(design="gcd", fingerprint="cf-b", treatment=dual,
                                  signature="propose:cts"))
        rows.append(_analysis_row(design="gcd", fingerprint="cf-b", treatment=noknow,
                                  signature="propose:cts"))
    # provider error row stays in the denominator
    rows.append(_analysis_row(design="gcd", fingerprint="cf-b", treatment=dual,
                              signature="provider_error", status="provider_error"))

    noise = noise_floor_calibration(rows)
    assert noise["attempted_rows"] == 13
    assert noise["provider_error_rows"] == 1
    assert noise["noise_floor_status_overall"] in {"low", "material", "high", "not_estimable"}

    support = provenance_support(rows)
    assert support["treatments"][noknow]["support_exposed"] == "n/a"
    assert support["treatments"][dual]["schema_status_counts"]["provider_error"] == 1

    posterior = policy_posterior(rows, draws=200)
    cells = {(cell["context_fingerprint"], cell["treatment"]): cell for cell in posterior["cells"]}
    assert len(cells) == 4
    assert cells[("cf-a", dual)]["levels"]["L2"]["posterior_action_mass"]["propose:place"]["mean"] == 1.0

    shift = policy_shift(
        rows, draws=200, permutations=100, bootstrap_draws=100
    )
    key = f"L2|{dual}||{noknow}"
    summary = shift["summary"][key]
    assert summary["delta_local_contexts"] == 2
    deltas = [
        context["comparisons"][f"{dual}||{noknow}"]["delta_local_tv"]
        for context in shift["contexts"]
        if context["level"] == "L2"
    ]
    assert len(deltas) == 2
    # cf-a fully shifted (TV=1); cf-b carries one provider error among four
    # Dual outcomes, giving TV=1/4 against the three identical NoKnow calls.
    assert abs(summary["matched_context_tv_mean"] - (1.0 + 0.25) / 2.0) < 1e-9
    assert summary["permutation"]["draws"] == 100


def test_order_balanced_schedule_and_worker_are_registered_and_resumable() -> None:
    contexts = []
    for design in ("gcd", "xtea"):
        for index in range(1, 5):
            context = _rq2_context()
            context.update(
                design=design,
                checkpoint=f"cp{index}",
                context_fingerprint=f"sha256:{design}-{index}",
            )
            contexts.append(context)
    schedule = build_order_balanced_schedule(
        contexts, seed=20260927, repeats=3, workers=4
    )
    validate_order_balanced_schedule(schedule)
    assert len(schedule["observations"]) == 2 * 4 * 3 * len(RQ2_TREATMENTS)
    for design in ("gcd", "xtea"):
        assignments = [
            item for item in schedule["assignments"] if item["design"] == design
        ]
        assert {item["rotation"] for item in assignments} == {"R0", "R1", "R2", "R3"}
        for treatment in RQ2_TREATMENTS:
            assert sorted(
                item["treatments"].index(treatment) + 1 for item in assignments
            ) == [1, 2, 3, 4]

    worker_contexts = []
    for index in range(1, 5):
        context = _rq2_context()
        context.update(
            checkpoint=f"cp{index}",
            context_fingerprint=f"sha256:worker-{index}",
        )
        worker_contexts.append(context)
    worker_schedule = build_order_balanced_schedule(
        worker_contexts, seed=20260927, repeats=1, workers=1
    )
    first_sequence = worker_schedule["observations"][0]["sequence_id"]
    run_ids = {
        row["observation_id"]
        for row in worker_schedule["observations"]
        if row["sequence_id"] == first_sequence
        and row["sequence_position"] in {2, 3, 4}
    }
    completed = {
        row["observation_id"]
        for row in worker_schedule["observations"]
        if row["observation_id"] not in run_ids
    }
    rows = []
    summary = run_order_balanced_worker(
        worker_contexts,
        schedule=worker_schedule,
        worker_index=0,
        provider_factory=_ScriptedProvider,
        config=AdaptiveConfig(levels=(1,), draws=20),
        completed_observation_ids=completed,
        on_observation=rows.append,
    )
    assert summary["planned"] == 16
    assert summary["produced"] == 3
    assert summary["continued"] == 13
    assert summary["ecc_executions"] == 0
    assert [row["sequence_position"] for row in rows] == [2, 3, 4]
    assert all(isinstance(row["context_treatment_sha256"], str) for row in rows)
