import pytest
from pydantic import ValidationError

from ecos_agent.optimization.contracts import AppliedKnobValue, RequestedKnobValue
from ecos_agent.optimization.legacy_reader import (
    KnobApplicationReceipt,
    RuntimeAdjustment,
    RuntimeObservation,
)

HASH = "sha256:" + "a" * 64


def test_legacy_receipt_reader_binds_requested_written_and_runtime_values() -> None:
    receipt = KnobApplicationReceipt(
        receipt_id="receipt-1",
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=2),
        written=AppliedKnobValue(knob_id="place.cell_padding_x", value=400),
        effective_initial=AppliedKnobValue(knob_id="place.cell_padding_x", value=400),
        runtime_adjustments=(
            RuntimeAdjustment(
                effective_value=AppliedKnobValue(knob_id="place.cell_padding_x", value=200),
                reason="capacity_cap",
                evidence_sha256=HASH,
            ),
        ),
        effective_final=AppliedKnobValue(knob_id="place.cell_padding_x", value=200),
        evidence_sha256=HASH,
    )

    assert receipt.effective_final.value == 200
    assert "runtime_observations" not in receipt.model_dump(mode="json")

    with pytest.raises(ValidationError, match="final value"):
        invalid_receipt = receipt.model_dump()
        invalid_receipt["effective_final"] = AppliedKnobValue(
            knob_id="place.cell_padding_x", value=400
        )
        KnobApplicationReceipt.model_validate(invalid_receipt)


def test_legacy_receipt_reader_preserves_density_weight_evidence() -> None:
    receipt = KnobApplicationReceipt(
        receipt_id="receipt-1",
        requested=RequestedKnobValue(knob_id="place.density_weight", value=0.001),
        written=AppliedKnobValue(knob_id="place.density_weight", value=0.001),
        effective_initial=AppliedKnobValue(
            knob_id="place.density_weight", value=4.884961e-07
        ),
        runtime_adjustments=(
            RuntimeAdjustment(
                effective_value=AppliedKnobValue(
                    knob_id="place.density_weight", value=0.0817526
                ),
                reason="adaptive update",
                evidence_sha256=HASH,
            ),
        ),
        effective_final=AppliedKnobValue(
            knob_id="place.density_weight", value=0.0817526
        ),
        evidence_sha256=HASH,
    )

    assert receipt.requested.value == 0.001
    assert receipt.effective_final.value == 0.0817526


def test_knob_receipt_rejects_a_mismatched_runtime_knob() -> None:
    with pytest.raises(ValidationError, match="knob ids"):
        KnobApplicationReceipt(
            receipt_id="receipt-1",
            requested=RequestedKnobValue(knob_id="place.target_density", value=0.2),
            written=AppliedKnobValue(knob_id="place.target_density", value=0.2),
            effective_initial=AppliedKnobValue(knob_id="place.target_density", value=0.2),
            runtime_adjustments=(
                RuntimeAdjustment(
                    effective_value=AppliedKnobValue(knob_id="place.cell_padding_x", value=200),
                    reason="wrong_knob",
                    evidence_sha256=HASH,
                ),
            ),
            effective_final=AppliedKnobValue(knob_id="place.target_density", value=0.2),
            evidence_sha256=HASH,
        )


def test_knob_receipt_rejects_duplicate_runtime_observation_metrics() -> None:
    observation = RuntimeObservation(
        metric="final_overflow", value=0.1, evidence_sha256=HASH
    )
    applied = AppliedKnobValue(knob_id="place.target_overflow", value=0.1)
    with pytest.raises(ValidationError, match="metrics must be unique"):
        KnobApplicationReceipt(
            receipt_id="receipt-1",
            requested=RequestedKnobValue(
                knob_id="place.target_overflow", value=0.1
            ),
            written=applied,
            effective_initial=applied,
            runtime_observations=(observation, observation),
            effective_final=applied,
            evidence_sha256=HASH,
        )

    with pytest.raises(ValidationError, match="observation value"):
        RuntimeObservation(
            metric="final_overflow", value=float("inf"), evidence_sha256=HASH
        )
