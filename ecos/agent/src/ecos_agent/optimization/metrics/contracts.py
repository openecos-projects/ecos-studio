"""Typed report and gate metrics attached to terminal optimization evidence."""

from __future__ import annotations

import math
import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

_METRIC_ID = re.compile(r"^[a-z][a-z0-9_]*$")


class EvaluationMetricCategory(StrEnum):
    ELIGIBILITY = "eligibility"
    PPA = "ppa"
    ROUTING_DIAGNOSTIC = "routing_diagnostic"
    COST = "cost"
    CORNER_ROBUSTNESS = "corner_robustness"


class EvaluationMetricRole(StrEnum):
    GATE = "gate"
    REPORT = "report"


class EvaluationMetricDirection(StrEnum):
    LOWER_IS_BETTER = "lower_is_better"
    HIGHER_IS_BETTER = "higher_is_better"
    EXACT = "exact"
    TREND_ONLY = "trend_only"


class TerminalEvaluationMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_id: str
    value: float
    unit: str
    category: EvaluationMetricCategory
    role: EvaluationMetricRole
    direction: EvaluationMetricDirection
    source_refs: tuple[str, ...]
    corner: str | None = None

    @field_validator("metric_id")
    @classmethod
    def validate_metric_id(cls, value: str) -> str:
        if not _METRIC_ID.fullmatch(value):
            raise ValueError("terminal evaluation metric id is invalid")
        return value

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("terminal evaluation metric value is invalid")
        return value

    @field_validator("unit")
    @classmethod
    def validate_unit(cls, value: str) -> str:
        if not value or len(value) > 16 or not value.isascii():
            raise ValueError("terminal evaluation metric unit is invalid")
        return value

    @field_validator("source_refs")
    @classmethod
    def validate_source_refs(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if not value or value != tuple(dict.fromkeys(value)) or any(
            not safe_relative_ref(item) for item in value
        ):
            raise ValueError("terminal evaluation metric sources are invalid")
        return value

    @field_validator("corner")
    @classmethod
    def validate_corner(cls, value: str | None) -> str | None:
        if value is not None and not safe_relative_ref(value):
            raise ValueError("terminal evaluation metric corner is invalid")
        return value

    @model_validator(mode="after")
    def validate_role(self) -> "TerminalEvaluationMetric":
        if self.unit == "count" and (self.value < 0 or not self.value.is_integer()):
            raise ValueError("terminal count metric is invalid")
        if (
            self.role == EvaluationMetricRole.GATE
            and self.category != EvaluationMetricCategory.ELIGIBILITY
        ):
            raise ValueError("only eligibility metrics can be gates")
        return self


def safe_relative_ref(value: str) -> bool:
    parts = value.split("/")
    return bool(value) and not value.startswith("/") and all(
        part not in {"", ".", ".."} and "\\" not in part for part in parts
    )
