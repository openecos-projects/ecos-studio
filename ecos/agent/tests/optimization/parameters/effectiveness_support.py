from __future__ import annotations

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters.contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    RuntimeTransition,
    ToolRef,
)
from ecos_agent.optimization.parameters.effective_domain import build_context_fingerprint
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards


HASH = "sha256:" + "a" * 64


def domain_context(**updates: object) -> dict[str, object]:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context: dict[str, object] = {
        "design_sha256": HASH,
        "rtl_sha256": HASH,
        "filelist_sha256": HASH,
        "sdc_sha256": HASH,
        "pdk_sha256": HASH,
        "parent_lineage_sha256": HASH,
        "stage": "place",
        "backend": "ecc",
        "ecc_revision": "0.1.0-alpha.11",
        "tool_revision": card.tool.revision,
        "lattice_version": "ecos.optimization_lattice.v1",
        "unit": "ratio",
        "site_width_dbu": 200,
        "seed": 0,
        "tool_source_sha256": card.tool.source_sha256,
        "incumbent_state_sha256": HASH,
        "parameter_card_sha256": card_hash(card),
        "parent_manifest_sha256": HASH,
        "terminal_execution_contract_sha256": HASH,
        "current_values": {"place.target_density": 0.2},
    }
    context.update(updates)
    return context


def density_receipt(
    context: dict[str, object], *, with_runtime_trigger: bool = True
) -> ParameterApplicationReceipt:
    receipt_context = {
        key: context[key]
        for key in (
            "design_sha256",
            "rtl_sha256",
            "filelist_sha256",
            "sdc_sha256",
            "pdk_sha256",
            "parent_lineage_sha256",
            "stage",
            "backend",
            "ecc_revision",
            "tool_revision",
            "lattice_version",
            "unit",
            "site_width_dbu",
            "seed",
        )
    }
    receipt_context["context_sha256"] = build_context_fingerprint(context)
    observation = {
        "requested_target_density": 0.2,
        "effective_target_density": 0.8,
        "density_tensor_value": 0.8,
        "placement_iteration_count": 4,
        "evidence_complete": True,
    }
    consumer_evidence = {
        "consumer_id": "dreamplace.density_objective",
        "outcome": "entered",
        "evidence_ref": "analysis/density.json",
        "evidence_sha256": canonical_sha256(
            {
                "consumer_id": "dreamplace.density_objective",
                "outcome": "entered",
                "consumer_observation": observation,
            }
        ),
    }
    payload = dict(
        receipt_id="parameter-receipt-1",
        tool=ToolRef(
            name="DREAMPlace",
            revision=str(context["tool_revision"]),
            source_sha256=str(context["tool_source_sha256"]),
        ),
        context=receipt_context,
        requested={"knob_id": "place.target_density", "value": 0.2, "unit": "ratio"},
        materialization=MaterializationRef(
            receipt_ref="analysis/materialization.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="workspace",
            config_before_sha256=HASH,
            config_after_sha256="sha256:" + "b" * 64,
            written_value=0.2,
            unit="ratio",
        ),
        effective_initial=EffectiveValue(value=0.8, unit="ratio"),
        transitions=(
            RuntimeTransition(
                sequence=0,
                **{"from": "materialized"},
                to="overridden",
                value=0.8,
                reason="utilization lower bound",
                rule_id="dreamplace.target_density.utilization_floor",
                evidence_ref=consumer_evidence["evidence_ref"],
                evidence_sha256=consumer_evidence["evidence_sha256"],
            ),
        )
        if with_runtime_trigger
        else (),
        application_status="applied",
        activation=ActivationEvidence(status="used", consumers=(consumer_evidence,)),
        consumer_observation=observation,
        effective_final=EffectiveValue(value=0.8, unit="ratio"),
    )
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(
            draft.model_dump(mode="json", exclude={"evidence_sha256"})
        ),
    )


def routability_false_receipt(
    *, with_consumer: bool = True, with_observation: bool = True
) -> ParameterApplicationReceipt:
    card = load_parameter_cards()[OptimizationKnob.ROUTABILITY_OPT]
    observation = {
        "branch_round_count": 0,
        "evidence_complete": True,
    }
    evidence_sha256 = canonical_sha256(
        {
            "consumer_id": "dreamplace.routability_branch",
            "outcome": "evaluated",
            "consumer_observation": observation,
        }
    )
    payload = dict(
        receipt_id="parameter-receipt-routability-false",
        tool=ToolRef(
            name=card.tool.name,
            revision=card.tool.revision,
            source_sha256=card.tool.source_sha256,
        ),
        context={"stage": "place", "lattice_version": "ecos.optimization_lattice.v1"},
        requested={
            "knob_id": "place.routability_opt",
            "value": False,
            "unit": "boolean",
        },
        materialization=MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=HASH,
            config_after_sha256="sha256:" + "b" * 64,
            written_value=False,
            unit="boolean",
        ),
        effective_initial=EffectiveValue(value=False, unit="boolean"),
        application_status="applied",
        activation=ActivationEvidence(
            status="not_activated",
            consumers=(
                {
                    "consumer_id": "dreamplace.routability_branch",
                    "outcome": "evaluated",
                    "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                    "evidence_sha256": evidence_sha256,
                },
            )
            if with_consumer
            else (),
        ),
        effective_final=EffectiveValue(value=False, unit="boolean"),
    )
    if with_observation:
        payload["consumer_observation"] = observation
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    hash_payload = draft.model_dump(mode="json", exclude={"evidence_sha256"})
    if not with_observation:
        hash_payload.pop("consumer_observation", None)
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(hash_payload),
    )
