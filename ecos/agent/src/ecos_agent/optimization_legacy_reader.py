"""Read-only contracts for replaying pre-native optimization receipts."""

from __future__ import annotations

import math
import re

from pydantic import Field, field_validator, model_validator

from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
    KnobScalar,
    RequestedKnobValue,
    _ContractModel,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_METRIC_ID = re.compile(r"^[a-z][a-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


class RuntimeAdjustment(_ContractModel):
    effective_value: AppliedKnobValue
    reason: str
    evidence_sha256: str

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 128 or "\n" in value:
            raise ValueError("runtime adjustment reason is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("runtime adjustment hash is invalid")
        return value


class RuntimeObservation(_ContractModel):
    metric: str
    value: KnobScalar
    evidence_sha256: str

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: KnobScalar) -> KnobScalar:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("runtime observation value is invalid")
        return value

    @field_validator("metric")
    @classmethod
    def validate_metric(cls, value: str) -> str:
        if not _METRIC_ID.fullmatch(value):
            raise ValueError("runtime observation metric is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("runtime observation hash is invalid")
        return value


class KnobApplicationReceipt(_ContractModel):
    receipt_id: str
    requested: RequestedKnobValue
    written: AppliedKnobValue
    effective_initial: AppliedKnobValue
    runtime_adjustments: tuple[RuntimeAdjustment, ...] = Field(default=(), max_length=16)
    runtime_observations: tuple[RuntimeObservation, ...] = Field(
        default=(), max_length=16, exclude_if=lambda value: not value
    )
    effective_final: AppliedKnobValue
    evidence_sha256: str

    @field_validator("receipt_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("receipt id is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("receipt evidence hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_receipt_chain(self) -> "KnobApplicationReceipt":
        values = (self.requested, self.written, self.effective_initial, self.effective_final)
        if any(value.knob_id != self.requested.knob_id for value in values):
            raise ValueError("receipt knob ids must match")
        if any(
            item.effective_value.knob_id != self.requested.knob_id
            for item in self.runtime_adjustments
        ):
            raise ValueError("runtime adjustment knob ids must match")
        metrics = [item.metric for item in self.runtime_observations]
        if len(metrics) != len(set(metrics)):
            raise ValueError("runtime observation metrics must be unique")
        last_value = (
            self.runtime_adjustments[-1].effective_value
            if self.runtime_adjustments
            else self.effective_initial
        )
        if last_value != self.effective_final:
            raise ValueError("receipt final value must match the last effective value")
        return self
