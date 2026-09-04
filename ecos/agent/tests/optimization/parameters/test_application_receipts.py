from __future__ import annotations

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters.contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    ToolRef,
)
from ecos_agent.optimization.parameters.semantics import (
    ParameterSemanticsError,
    load_parameter_cards,
    validate_application_receipt,
)
from tests.optimization.parameters.effectiveness_support import (
    HASH,
    density_receipt,
    domain_context,
    routability_false_receipt,
)


def _runtime_receipt(
    knob: OptimizationKnob,
    *,
    requested: int | float,
    effective_initial: int | float,
    effective_final: int | float,
    effective_unit: str,
    consumer_id: str,
    outcome: str,
    observation: dict,
) -> ParameterApplicationReceipt:
    card = load_parameter_cards()[knob]
    payload = density_receipt(domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload.update(
        receipt_id=f"parameter-receipt-{knob.value.replace('.', '-')}",
        tool=card.tool.model_dump(mode="json"),
        context={
            "stage": card.stage,
            "lattice_version": "ecos.optimization_lattice.v1",
        },
        requested={
            "knob_id": knob.value,
            "value": requested,
            "unit": card.surface.unit,
        },
        effective_initial={"value": effective_initial, "unit": effective_unit},
        effective_final={"value": effective_final, "unit": effective_unit},
        transitions=[],
        consumer_observation=observation,
    )
    payload["materialization"].update(
        written_value=requested,
        unit=card.surface.unit,
    )
    evidence = {
        "consumer_id": consumer_id,
        "outcome": outcome,
        "evidence_ref": "analysis/parameter_runtime_report.v1.json",
        "evidence_sha256": canonical_sha256(
            {
                "consumer_id": consumer_id,
                "outcome": outcome,
                "consumer_observation": observation,
            }
        ),
    }
    payload["activation"] = {"status": "used", "consumers": [evidence]}
    return ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(payload),
    )


def test_dreamplace_used_receipt_requires_consumer_observation() -> None:
    cards = load_parameter_cards()
    context = domain_context()
    payload = density_receipt(context).model_dump(
        mode="json", exclude={"consumer_observation", "evidence_sha256"}
    )
    receipt = ParameterApplicationReceipt(
        **payload, evidence_sha256=canonical_sha256(payload)
    )

    with pytest.raises(ParameterSemanticsError, match="consumer observation"):
        validate_application_receipt(receipt, cards)


@pytest.mark.parametrize(
    "field,value",
    (
        ("evidence_ref", "analysis/other.json"),
        ("evidence_sha256", "sha256:" + "b" * 64),
    ),
)
def test_density_floor_transition_requires_bound_consumer_evidence(
    field: str,
    value: str,
) -> None:
    cards = load_parameter_cards()
    payload = density_receipt(domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload["transitions"][0][field] = value
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(payload),
    )

    with pytest.raises(ParameterSemanticsError, match="transition evidence"):
        validate_application_receipt(receipt, cards)


def test_dreamplace_consumer_evidence_hash_is_observation_bound() -> None:
    cards = load_parameter_cards()
    payload = density_receipt(domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload["activation"]["consumers"][0]["evidence_sha256"] = "sha256:" + "b" * 64
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(payload),
    )

    with pytest.raises(ParameterSemanticsError, match="consumer evidence"):
        validate_application_receipt(receipt, cards)


def test_application_receipt_requires_card_bound_tool_source() -> None:
    cards = load_parameter_cards()
    payload = density_receipt(domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload["tool"]["source_sha256"] = None
    payload["materialization"]["config_after_sha256"] = "sha256:" + "b" * 64
    receipt = ParameterApplicationReceipt(
        **payload, evidence_sha256=canonical_sha256(payload)
    )

    with pytest.raises(ParameterSemanticsError, match="tool source"):
        validate_application_receipt(receipt, cards)


@pytest.mark.parametrize("missing", ("stage", "lattice_version"))
def test_application_receipt_requires_stage_and_lattice_context(missing: str) -> None:
    cards = load_parameter_cards()
    payload = density_receipt(domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    del payload["context"][missing]
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(payload),
    )

    with pytest.raises(ParameterSemanticsError, match=missing.replace("_", " ")):
        validate_application_receipt(receipt, cards)


def test_application_receipt_consumer_event_matches_card() -> None:
    cards = load_parameter_cards()
    payload = density_receipt(domain_context()).model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    consumer = payload["activation"]["consumers"][0]
    consumer["outcome"] = "evaluated"
    consumer["evidence_sha256"] = canonical_sha256(
        {
            "consumer_id": consumer["consumer_id"],
            "outcome": consumer["outcome"],
            "consumer_observation": payload["consumer_observation"],
        }
    )
    payload["transitions"][0]["evidence_sha256"] = consumer["evidence_sha256"]
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(payload),
    )

    with pytest.raises(ParameterSemanticsError, match="consumer event"):
        validate_application_receipt(receipt, cards)


def test_routability_false_receipt_requires_gate_evaluation_evidence() -> None:
    receipt = routability_false_receipt(
        with_consumer=False,
        with_observation=False,
    )

    with pytest.raises(ParameterSemanticsError, match="routability gate"):
        validate_application_receipt(receipt, load_parameter_cards())


def test_routability_false_receipt_accepts_gate_evaluated_negative_arm() -> None:
    validate_application_receipt(
        routability_false_receipt(),
        load_parameter_cards(),
    )


def test_routability_false_receipt_requires_observation_bound_consumer_hash() -> None:
    payload = routability_false_receipt().model_dump(
        mode="json", exclude={"evidence_sha256"}
    )
    payload["activation"]["consumers"][0]["evidence_sha256"] = HASH
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(payload),
    )

    with pytest.raises(ParameterSemanticsError, match="consumer evidence"):
        validate_application_receipt(receipt, load_parameter_cards())


def test_padding_materialization_keeps_surface_and_written_units_distinct() -> None:
    tool = load_parameter_cards()[OptimizationKnob.CELL_PADDING_X].tool
    payload = dict(
        receipt_id="parameter-receipt-padding-1",
        tool=ToolRef(
            name=tool.name, revision=tool.revision, source_sha256=tool.source_sha256
        ),
        context={"stage": "place", "lattice_version": "ecos.optimization_lattice.v1"},
        requested={"knob_id": "place.cell_padding_x", "value": 2, "unit": "site"},
        materialization=MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref=".agent/candidates/candidate-1",
            workspace_ref=".agent/candidates/candidate-1",
            target_step="place",
            config_ref="config/dreamplace_ecc.json",
            config_before_sha256=HASH,
            config_after_sha256="sha256:" + "b" * 64,
            before_snapshot_ref="analysis/snapshots/dreamplace.before.json",
            before_snapshot_sha256=HASH,
            after_snapshot_ref="analysis/snapshots/dreamplace.after.json",
            after_snapshot_sha256="sha256:" + "b" * 64,
            written_value=400,
            unit="dbu",
        ),
        effective_initial=EffectiveValue(value=400, unit="dbu"),
        application_status="applied",
        activation=ActivationEvidence(status="unknown"),
        effective_final=EffectiveValue(value=400, unit="dbu"),
    )
    draft = ParameterApplicationReceipt.model_construct(**payload, evidence_sha256=HASH)
    hash_payload = draft.model_dump(mode="json", exclude={"evidence_sha256"})
    hash_payload.pop("consumer_observation", None)
    receipt = ParameterApplicationReceipt(
        **payload,
        evidence_sha256=canonical_sha256(hash_payload),
    )

    validate_application_receipt(receipt, load_parameter_cards())
    assert receipt.requested["unit"] == "site"
    assert receipt.materialization.unit == "dbu"


def test_density_weight_receipt_binds_internal_initial_and_final_values() -> None:
    observation = {
        "configured_density_weight": 0.001,
        "internal_initial_density_weight": 0.004,
        "final_internal_density_weight": 0.009,
        "placement_iteration_count": 5,
        "evidence_complete": True,
        "lifecycle": [
            {"phase": "adopted", "value": 0.004},
            {"phase": "evolved", "value": 0.009},
        ],
    }
    receipt = _runtime_receipt(
        OptimizationKnob.DENSITY_WEIGHT,
        requested=0.001,
        effective_initial=0.004,
        effective_final=0.009,
        effective_unit="internal_objective_weight",
        consumer_id="dreamplace.density_preconditioner",
        outcome="entered",
        observation=observation,
    )

    validate_application_receipt(receipt, load_parameter_cards())


def test_floorplan_receipt_rejects_unbound_realized_geometry() -> None:
    observation = {
        "configured_value": 0.8,
        "realized_core_utilization": 0.79,
        "realized_aspect_ratio": 2.0,
        "evidence_complete": True,
        "lifecycle": [
            {"phase": "adopted", "value": 0.8},
            {"phase": "consumed", "value": 0.8},
            {"phase": "realized", "value": 0.79},
        ],
    }
    receipt = _runtime_receipt(
        OptimizationKnob.FLOORPLAN_CORE_UTIL,
        requested=0.8,
        effective_initial=0.8,
        effective_final=0.75,
        effective_unit="ratio",
        consumer_id="ifp.die_builder.die_utilization",
        outcome="geometry_constructed",
        observation=observation,
    )

    with pytest.raises(ParameterSemanticsError, match="realized geometry"):
        validate_application_receipt(receipt, load_parameter_cards())
