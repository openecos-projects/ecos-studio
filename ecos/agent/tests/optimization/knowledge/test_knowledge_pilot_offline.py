"""Offline knowledge pilot: frozen-context reconstruction and treatment runs."""
from __future__ import annotations

import json

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
    main,
    rebuild_planning_context,
    run_offline_pilot,
)
from ecos_agent.optimization.experiments.frozen_contexts import build_frozen_context
from ecos_agent.optimization.knowledge.compiler import (
    StateEvidenceFeature,
    build_state_evidence_request,
    compile_supported_action_view,
)
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.planning import planning_context_payload
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


def _planning_context(*, with_view: bool = True):
    observation = _observation()
    domain = _domain()
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=observation,
        current_values={"place.target_density": 0.85},
        extra_features=(
            StateEvidenceFeature(
                feature_id="place_lutrudy_utilization_max",
                value=True,
                evidence_sha256=HASH,
            ),
        ),
    )
    view = compile_supported_action_view(
        state=state,
        catalog=support_catalog(REFERENCE),
        candidate_refs=(REFERENCE,),
        retrieval_ranked_refs=(REFERENCE,),
        legal_actions=(LegalAction(knob_id="place.target_density", direction="decrease"),),
        effective_domains=(domain,),
    )
    return rebuild_planning_context(
        {
            "context_ref": {
                "episode_id": "offline-pilot-gcd",
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
            "supported_action_view": (
                view.model_dump(mode="json") if with_view else None
            ),
        }
    )


def _context(
    *,
    stratum: str = "knowledge_opportunity",
    expected: str = "action",
    with_view: bool = True,
) -> dict:
    domain = _domain()
    return build_frozen_context(
        {
            "design_id": "gcd",
            "objective_contract_sha256": HASH,
            "legal_domain_sha256": domain.snapshot_sha256,
            "stratum": stratum,
            "expected_behavior": expected,
            "planning_context": freeze_planning_context(
                _planning_context(with_view=with_view)
            ),
        }
    )


class _ScriptedProvider:
    """Proposes the first supported action claim-bound; abstains without a view."""

    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.calls = 0
        self.models: list[str] = []

    def select_model(self, model: str) -> None:
        self.models.append(model)

    def close(self) -> None:
        self.closed = True

    def propose_v2(self, context, domains):
        self.calls += 1
        if self.calls <= self.failures:
            raise RuntimeError("provider transport unavailable")
        payload: dict = {
            "schema_version": "ecos.optimization_proposal.v3",
            "context_ref": context.context_ref.model_dump(mode="json"),
            "decision": "continue",
            "reason_code": "pilot_script",
            "rationale_summary": "no supported action",
            "observation_refs": [context.observation_ref.model_dump(mode="json")],
        }
        view = context.supported_action_view
        if view is not None and view.actions:
            action = view.actions[0]
            domain = next(
                item for item in domains if item.knob_id == action.knob_id
            )
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


def test_freeze_rebuild_round_trip_preserves_planner_payload() -> None:
    context = _planning_context()
    refrozen = freeze_planning_context(rebuild_planning_context(
        freeze_planning_context(context)
    ))
    rebuilt = rebuild_planning_context(refrozen)
    assert planning_context_payload(rebuilt) == planning_context_payload(context)


def test_rebuild_fails_closed_without_replay_anchors() -> None:
    with pytest.raises(ValueError, match="missing"):
        rebuild_planning_context({"context_ref": {}})


def test_apply_treatment_derives_knowledge_payloads() -> None:
    context = _planning_context()
    no_knowledge = apply_treatment(context, agent_mode="llm_no_knowledge")
    assert no_knowledge.supported_action_view is None
    assert no_knowledge.knowledge_refs == ()
    assert no_knowledge.knowledge_chunks == ()
    raw_rag = apply_treatment(context, agent_mode="raw_rag")
    assert raw_rag.supported_action_view is None
    assert raw_rag.knowledge_chunks == context.knowledge_chunks
    assert apply_treatment(context, agent_mode="full_agent") is context
    with pytest.raises(ValueError, match="agent mode"):
        apply_treatment(context, agent_mode="rule_guided")


def test_offline_pilot_runs_treatments_and_passes_gate() -> None:
    contexts = [
        _context(),
        _context(stratum="no_supported_action", expected="block_reject", with_view=False),
    ]
    provider_factory = _ScriptedProvider
    payload = run_offline_pilot(
        design_id="gcd", contexts=contexts, provider_factory=provider_factory
    )
    rows = payload["rows"]
    assert payload["schema_version"] == "ecos.knowledge_offline_pilot.v1"
    assert len(rows) == 2 * 3
    dual = [
        row
        for row in rows
        if row["treatment"] == "state-conditioned-dual-layer-zero-shot"
    ]
    decisions = {row["stratum"]: row["decision"] for row in dual}
    assert decisions == {
        "knowledge_opportunity": "propose",
        "no_supported_action": "continue",
    }
    opportunity = next(row for row in dual if row["stratum"] == "knowledge_opportunity")
    assert opportunity["claim_bound"] is True
    assert opportunity["support_status"] in {"pass", "weak"}
    assert opportunity["correct"] is True
    gate = payload["gate"]
    assert gate["negative_controls_rejected"] is True
    assert gate["offline_gate_pass"] is True


def test_offline_pilot_keeps_failures_and_blocks_gate() -> None:
    contexts = [_context()]
    payload = run_offline_pilot(
        design_id="gcd",
        contexts=contexts,
        provider_factory=lambda: _ScriptedProvider(failures=3),
    )
    dual = payload["summary"]["treatments"]["state-conditioned-dual-layer-zero-shot"]
    assert dual["decision_counts"]["provider_error"] == 1
    gate = payload["gate"]
    assert gate["divergence_without_repair"] is False
    assert gate["offline_gate_pass"] is False


def test_offline_pilot_records_not_started_cells_within_budget() -> None:
    contexts = [_context(), _context(stratum="stale_binding", expected="block_reject")]
    payload = run_offline_pilot(
        design_id="gcd",
        contexts=contexts,
        provider_factory=_ScriptedProvider,
        planning_call_limit=4,
    )
    decisions = [row["decision"] for row in payload["rows"]]
    assert len(decisions) == 6
    assert decisions.count("not_started") == 2
    assert payload["summary"]["rows"] == 6


def test_offline_cli_writes_payload_from_context_file(tmp_path, capsys) -> None:
    contexts_file = tmp_path / "bank.json"
    contexts_file.write_text(
        json.dumps([_context(), _context(stratum="anti_condition", expected="block_reject", with_view=False)]),
        encoding="utf-8",
    )
    output = tmp_path / "offline.json"
    exit_code = main(
        [
            "offline",
            "--design",
            "gcd",
            "--contexts",
            str(contexts_file),
            "--output",
            str(output),
        ],
        provider_factory=_ScriptedProvider,
    )
    assert exit_code == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["contexts"] == 2
    assert payload["gate"]["offline_gate_pass"] is True


def test_offline_pilot_binds_protocol_manifest() -> None:
    from ecos_agent.optimization.experiments.knowledge_protocol import (
        build_protocol_manifest,
        validate_protocol_manifest,
    )

    manifest = build_protocol_manifest(
        design_ids=["gcd"],
        treatments=["llm-no-knowledge"],
        knowledge_bundle_sha256=HASH,
        state_rule_manifest_sha256=HASH,
        objective_contract_sha256=HASH,
        toolchain={"ecc": "x"},
        model={"name": "m"},
        budget={"planning_call_limit": 60},
        noise_rule={"schema_version": "n"},
    )
    validate_protocol_manifest(manifest)
    payload = run_offline_pilot(
        design_id="gcd",
        contexts=[_context()],
        provider_factory=_ScriptedProvider,
        protocol=manifest,
    )
    assert payload["protocol_hash"] == manifest["protocol_hash"]
    tampered = dict(manifest)
    tampered["budget"] = {"planning_call_limit": 1}
    with pytest.raises(ValueError, match="hash mismatch"):
        validate_protocol_manifest(tampered)
