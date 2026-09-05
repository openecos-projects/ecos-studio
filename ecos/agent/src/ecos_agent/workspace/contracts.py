import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ecos_agent.ecc_contracts import ECCStepName

GUI_WORKSPACE_FLOW_STEPS = tuple(step.value for step in ECCStepName)
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


class GuiWorkspaceSetupProposal(BaseModel):
    """Non-executable correction proposal for a GUI workspace specification."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.gui_workspace_setup_proposal.v1"]
    workspace_name: str | None
    description: str | None
    design_name: str | None
    top_module: str | None
    clock_name: str | None
    frequency_mhz: float | None
    max_fanout: float | None
    flow_start: str | None
    flow_end: str | None
    die_area_mode: Literal["utilitization_margin", "width_height"] | None
    utilitization: float | None
    margin: float | None
    die_width: float | None
    die_height: float | None
    target_density: float | None
    target_overflow: float | None
    project_root: str | None
    rtl_path: str | None
    filelist_path: str | None
    sdc_path: str | None
    pdk_root: str | None
    summary: str

    @field_validator("workspace_name", "design_name", "top_module", "clock_name")
    @classmethod
    def validate_identifier(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not _IDENTIFIER.fullmatch(value):
            raise ValueError("workspace setup identifier is invalid")
        return value

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > 512:
            raise ValueError("workspace setup description is invalid")
        return value

    @field_validator("project_root", "rtl_path", "filelist_path", "sdc_path", "pdk_root")
    @classmethod
    def validate_path_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if "\x00" in value or len(value) > 4096:
            raise ValueError("workspace setup path is invalid")
        return value

    @field_validator("flow_start", "flow_end")
    @classmethod
    def validate_flow_step(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value not in GUI_WORKSPACE_FLOW_STEPS:
            raise ValueError("workspace setup flow step is invalid")
        return value

    @field_validator(
        "frequency_mhz",
        "max_fanout",
        "utilitization",
        "margin",
        "die_width",
        "die_height",
        "target_density",
        "target_overflow",
    )
    @classmethod
    def validate_finite_number(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("workspace setup numeric value is invalid")
        return value

    @field_validator("summary")
    @classmethod
    def validate_summary(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("workspace setup summary is invalid")
        return value

    @model_validator(mode="after")
    def validate_ranges(self) -> "GuiWorkspaceSetupProposal":
        if self.frequency_mhz is not None and not 1 <= self.frequency_mhz <= 10_000:
            raise ValueError("workspace frequency is outside the supported range")
        if self.max_fanout is not None and not 1 <= self.max_fanout <= 1_000_000:
            raise ValueError("workspace max fanout is outside the supported range")
        if self.utilitization is not None and not 0.01 <= self.utilitization <= 1:
            raise ValueError("workspace utilization is outside the supported range")
        if self.margin is not None and self.margin < 0:
            raise ValueError("workspace margin is invalid")
        if self.die_width is not None and self.die_width <= 0:
            raise ValueError("workspace die width is invalid")
        if self.die_height is not None and self.die_height <= 0:
            raise ValueError("workspace die height is invalid")
        if self.target_density is not None and not 0.01 <= self.target_density <= 1:
            raise ValueError("workspace target density is outside the supported range")
        if self.target_overflow is not None and not 0 <= self.target_overflow <= 1:
            raise ValueError("workspace target overflow is outside the supported range")
        if self.die_area_mode == "width_height" and (
            self.die_width is None or self.die_height is None
        ):
            raise ValueError("workspace die width and height must be provided together")
        return self


def recommended_gui_workspace_setup() -> GuiWorkspaceSetupProposal:
    return GuiWorkspaceSetupProposal(
        schema_version="flow-agent.gui_workspace_setup_proposal.v1",
        workspace_name=None,
        description=None,
        design_name=None,
        top_module=None,
        clock_name=None,
        frequency_mhz=50,
        max_fanout=32,
        flow_start="Synthesis",
        flow_end="Harden",
        die_area_mode="utilitization_margin",
        utilitization=0.3,
        margin=2,
        die_width=None,
        die_height=None,
        target_density=0.2,
        target_overflow=0.1,
        project_root=None,
        rtl_path=None,
        filelist_path=None,
        sdc_path=None,
        pdk_root=None,
        summary="Use the ECOS GUI recommended workspace defaults.",
    )


def resolve_gui_workspace_setup(
    proposal: GuiWorkspaceSetupProposal,
) -> GuiWorkspaceSetupProposal:
    defaults = recommended_gui_workspace_setup().model_dump(mode="json")
    defaults.update(
        {key: value for key, value in proposal.model_dump(mode="json").items() if value is not None}
    )
    return GuiWorkspaceSetupProposal.model_validate(defaults)
