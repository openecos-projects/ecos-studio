import math
import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr, field_validator


class ECCStepName(StrEnum):
    SYNTHESIS = "Synthesis"
    FLOORPLAN = "Floorplan"
    PLACEMENT = "place"
    CTS = "CTS"
    LEGALIZATION = "legalization"
    TIMING_OPT = "Timing optimization"
    ROUTING = "route"
    DRC = "drc"
    LVS = "lvs"
    FILLER = "filler"
    RCX = "RCX"
    STA = "sta"
    HARDEN = "Harden"


_KNOB_ID = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$")
_UNSAFE_VALUE = re.compile(r"[\x00-\x1f`]|(?:\.\.)|[;&|]|\$\(")
ParameterPatchScalar = StrictBool | StrictInt | StrictFloat | StrictStr
ParameterPatchValue = ParameterPatchScalar | list[ParameterPatchScalar]


class ECCParameterPatchItem(BaseModel):
    """A logical ECC parameter change, never a command or config path."""

    model_config = ConfigDict(extra="forbid")

    knob_id: str
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
        if len({item.knob_id for item in value}) != len(value):
            raise ValueError("parameter patch knob_ids must be unique")
        return value
