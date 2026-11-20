import math
import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr, field_validator


class ECCStepName(StrEnum):
    """Steps in ECC’s rtl2gds chain, in ledger order."""

    SYNTHESIS = "synthesis"
    PRE_FLOORPLAN = "pre_floorplan"
    MACRO_PLACEMENT = "macro_placement"
    POST_FLOORPLAN = "post_floorplan"
    PREPLACE = "preplace"
    PLACEMENT = "placement"
    DIFF_OPT = "diff_opt"
    DIFF_SIZING = "diff_sizing"
    CTS = "cts"
    LEGALIZATION = "legalization"
    TIMING_OPT = "timing_optimization"
    ROUTING = "routing"
    FILLER = "filler"
    LVS = "lvs"
    DRC = "drc"
    ANTENNA_CHECK = "antenna_check"
    POST_ROUTE_LEC = "post_route_lec"
    RCX = "rcx"
    STA = "sta"
    POWER_ANALYSIS = "power_analysis"
    EMIR = "emir"
    HARDEN = "harden"


def knowledge_phase(step: ECCStepName) -> str:
    if step in (ECCStepName.PRE_FLOORPLAN, ECCStepName.MACRO_PLACEMENT, ECCStepName.POST_FLOORPLAN):
        return "floorplan"
    if step == ECCStepName.PLACEMENT:
        return "place"
    if step == ECCStepName.ROUTING:
        return "route"
    return step.value


_KNOB_ID = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$")
_UNSAFE_VALUE = re.compile(r"[\x00-\x1f`]|(?:\.\.)|[;&|]|\$\(")
ParameterPatchScalar = StrictBool | StrictInt | StrictFloat | StrictStr
ParameterPatchValue = ParameterPatchScalar | list[ParameterPatchScalar]


class ECCParameterPatchItem(BaseModel):
    """A logical ECC parameter change, never a command or config path."""

    model_config = ConfigDict(extra="forbid")

    knob_id: str
    step: ECCStepName | None = Field(default=None, exclude_if=lambda value: value is None)
    value: ParameterPatchValue

    @field_validator("knob_id")
    @classmethod
    def validate_knob_id(cls, value: str) -> str:
        if not _KNOB_ID.fullmatch(value):
            raise ValueError("parameter patch knob_id is invalid")
        return value

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: ParameterPatchValue) -> ParameterPatchValue:
        values = value if isinstance(value, list) else [value]
        if len(values) > 64:
            raise ValueError("parameter patch value list is too large")
        for item in values:
            if isinstance(item, float) and not math.isfinite(item):
                raise ValueError("parameter patch float must be finite")
            if isinstance(item, str) and (len(item) > 256 or _UNSAFE_VALUE.search(item)):
                raise ValueError("parameter patch string value is unsafe")
        return value


class ECCParameterPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ECCParameterPatchItem] = Field(min_length=1, max_length=16)

    @field_validator("items")
    @classmethod
    def require_unique_knobs(cls, value: list[ECCParameterPatchItem]) -> list[ECCParameterPatchItem]:
        if len({(item.step, item.knob_id) for item in value}) != len(value):
            raise ValueError("parameter patch step and knob_id pairs must be unique")
        return value
