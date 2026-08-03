"""Discover and freeze GUI-owned ECOS workspace rerun contracts."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.ecc_contracts import ECCParameterPatch, ECCParameterPatchItem, ECCStepName
from ecos_agent.hashing import file_sha256
from ecos_agent.parameter_authorization import assert_authorized_parameter_patch


_STEP_NAMES = {step.value: step for step in ECCStepName}
_STEP_INDEX = {step: index for index, step in enumerate(_STEP_NAMES)}
_RERUN_SCOPES = ("single_step", "full_flow")
_STAGE_OUTPUT_SUFFIXES = (".def.gz", ".v.gz", ".gds")
_TOOL_NAME = re.compile(r"[A-Za-z0-9_-]+$")
_INTEGER_KNOBS = frozenset(
    {
        "place.num_threads",
        "cts.wirelength_iterations",
        "cts.slew_steps",
        "cts.cap_steps",
        "cts.max_fanout",
        "cts.htree_depth_explore_window",
        "legalization.bndry_padding_x",
        "legalization.bndry_padding_y",
        "legalization.num_threads",
        "route.thread_number",
    }
)
_ZERO_BASED_INTEGER_KNOBS = frozenset(
    {
        "place.cell_padding_x",
        "legalization.cell_padding_x",
    }
)
BOOLEAN_RERUN_KNOBS = frozenset(
    {
        "place.routability_opt",
        "cts.force_branch_buffer",
        "cts.enable_analytical_htree",
        "cts.enable_sink_clustering",
        "legalization.detailed_place_flag",
        "legalization.deterministic",
        "route.enable_timing",
    }
)
_RANGED_KNOBS = {
    "place.target_density": (0.1, 0.95),
    "place.target_overflow": (0.0, 1.0),
    "place.gp_noise_ratio": (0.0, 1.0),
    "cts.skew_bound": (0.0, 1.0),
}


@dataclass(frozen=True)
class GuiWorkspaceRerunSource:
    workspace_path: Path
    design_id: str
    flow_json_sha256: str
    end_step: ECCStepName
    allowed_stages: tuple[str, ...]
    stage_artifact_ref: dict[str, str]
    stage_artifact_sha256: dict[str, str]


@dataclass(frozen=True)
class GuiWorkspaceRerunDiscovery:
    source: GuiWorkspaceRerunSource

    @property
    def allowed_stages(self) -> tuple[str, ...]:
        return self.source.allowed_stages


class GuiWorkspaceRerunContract(BaseModel):
    """Frozen contract consumed by the ECOS GUI workspace-rerun executor."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.workspace_rerun_contract.v1"] = (
        "flow-agent.workspace_rerun_contract.v1"
    )
    source_workspace: str
    target_workspace: str
    rerun_id: str
    design_id: str
    target_step: ECCStepName
    end_step: ECCStepName
    execution_scope: Literal["single_step", "full_flow"]
    source_flow_json_sha256: str
    source_stage_artifact: str
    source_stage_artifact_sha256: str
    parameter_patch: list[ECCParameterPatchItem] = Field(default_factory=list, max_length=16)
    requires_gui_review: Literal[True] = True

    @field_validator("source_workspace", "target_workspace")
    @classmethod
    def require_absolute_workspace_path(cls, value: str) -> str:
        if not Path(value).is_absolute():
            raise ValueError("workspace path must be absolute")
        return value

    @field_validator("source_stage_artifact")
    @classmethod
    def require_relative_artifact_path(cls, value: str) -> str:
        path = Path(value)
        if not value or path.is_absolute() or ".." in path.parts:
            raise ValueError("stage artifact path must be workspace-relative")
        return value

    @model_validator(mode="after")
    def validate_execution_range(self) -> "GuiWorkspaceRerunContract":
        target_index = _STEP_INDEX[self.target_step.value]
        end_index = _STEP_INDEX[self.end_step.value]
        if end_index < target_index:
            raise ValueError("rerun end step precedes the target step")
        if self.execution_scope == "single_step" and self.end_step != self.target_step:
            raise ValueError("single-step rerun end step must match the target step")
        return self


class GuiWorkspaceRerunParameterProposal(BaseModel):
    """Untrusted Codex interpretation of one GUI parameter request."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.gui_workspace_rerun_parameter_proposal.v1"] = (
        "flow-agent.gui_workspace_rerun_parameter_proposal.v1"
    )
    parameter_patch: list[ECCParameterPatchItem] = Field(default_factory=list, max_length=16)
    summary: str = Field(min_length=1, max_length=512)

    @field_validator("parameter_patch", mode="before")
    @classmethod
    def normalize_boolean_values(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        return [
            {**item, "value": bool(item["value"])}
            if (
                isinstance(item, dict)
                and item.get("knob_id") in BOOLEAN_RERUN_KNOBS
                and type(item.get("value")) is int
                and item["value"] in {0, 1}
            )
            else item
            for item in value
        ]


class GuiWorkspaceRerunResolver:
    """Derive GUI rerun contracts from completed ECOS workspace evidence."""

    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()

    def discover(self, design_id: str) -> GuiWorkspaceRerunDiscovery:
        source = self._find_workspace(design_id)
        return self.discover_workspace(source, design_id)

    def discover_workspace(
        self, workspace_path: Path, design_id: str
    ) -> GuiWorkspaceRerunDiscovery:
        source = workspace_path.resolve()
        if (
            not source.is_relative_to(self.workspace_root)
            or not source.is_dir()
            or not (source / "home" / "flow.json").is_file()
        ):
            raise ValueError("source workspace is invalid")
        flow_path = source / "home" / "flow.json"
        flow = self._read_flow(flow_path)
        end_step = self._flow_end_step(flow)
        completed = self._completed_steps(flow, design_id, source)
        if not completed:
            raise ValueError(f"No completed rerun stages in ECOS workspace: {source}")
        return GuiWorkspaceRerunDiscovery(
            GuiWorkspaceRerunSource(
                workspace_path=source,
                design_id=design_id,
                flow_json_sha256=file_sha256(flow_path),
                end_step=end_step,
                allowed_stages=tuple(completed),
                stage_artifact_ref={
                    step: artifact.relative_to(source).as_posix()
                    for step, artifact in completed.items()
                },
                stage_artifact_sha256={
                    step: file_sha256(artifact) for step, artifact in completed.items()
                },
            )
        )

    def freeze(
        self,
        source: GuiWorkspaceRerunSource,
        target_step: str,
        parameter_patch: list[dict[str, object]],
        execution_scope: str,
    ) -> GuiWorkspaceRerunContract:
        if target_step not in source.allowed_stages:
            raise ValueError(f"{target_step} is not an allowed completed stage")
        if execution_scope not in _RERUN_SCOPES:
            raise ValueError("rerun execution scope is invalid")
        target = source.workspace_path.with_name(
            f"{source.workspace_path.name}_rerun_{target_step.lower()}"
        )
        if target.exists():
            raise ValueError(f"rerun target already exists: {target}")
        patch = self._validate_patch(target_step, parameter_patch)
        return GuiWorkspaceRerunContract(
            source_workspace=str(source.workspace_path),
            target_workspace=str(target),
            rerun_id=target.name,
            design_id=source.design_id,
            target_step=_STEP_NAMES[target_step],
            end_step=(
                _STEP_NAMES[target_step]
                if execution_scope == "single_step"
                else source.end_step
            ),
            execution_scope=execution_scope,
            source_flow_json_sha256=source.flow_json_sha256,
            source_stage_artifact=source.stage_artifact_ref[target_step],
            source_stage_artifact_sha256=source.stage_artifact_sha256[target_step],
            parameter_patch=[] if patch is None else patch.items,
        )

    def parameter_values(
        self, source: GuiWorkspaceRerunSource, target_step: str
    ) -> tuple[tuple[str, object], ...]:
        step = _STEP_NAMES.get(target_step)
        if step is None or target_step not in source.allowed_stages:
            raise ValueError("rerun stage is invalid")
        values = []
        for knob_id in _authorized_knobs_for_step(step):
            value = _current_parameter_value(source.workspace_path, knob_id)
            if value is not _MISSING:
                values.append((knob_id, value))
        return tuple(values)

    def _find_workspace(self, design_id: str) -> Path:
        candidates = [
            path
            for path in self.workspace_root.iterdir()
            if path.is_dir() and path.name == design_id and (path / "home" / "flow.json").is_file()
        ] if self.workspace_root.is_dir() else []
        if len(candidates) != 1:
            raise ValueError(f"No ECOS workspace found for design {design_id}; run a full flow first")
        return candidates[0].resolve()

    @staticmethod
    def _read_flow(path: Path) -> dict[str, object]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"workspace flow.json is invalid: {exc}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("steps"), list):
            raise ValueError("workspace flow.json has no step list")
        return payload

    def _completed_steps(self, flow: dict[str, object], design_id: str, source: Path) -> dict[str, Path]:
        stages: dict[str, Path] = {}
        for record in flow["steps"]:
            if not isinstance(record, dict) or record.get("state") != "Success":
                continue
            step, tool = record.get("name"), record.get("tool")
            if not isinstance(step, str) or step not in _STEP_NAMES or not isinstance(tool, str):
                continue
            try:
                stages[step] = self._stage_output(source, design_id, step, tool)
            except ValueError:
                continue
        return stages

    @staticmethod
    def _flow_end_step(flow: dict[str, object]) -> ECCStepName:
        for record in reversed(flow["steps"]):
            if not isinstance(record, dict):
                continue
            step = record.get("name")
            if isinstance(step, str) and step in _STEP_NAMES:
                return _STEP_NAMES[step]
        raise ValueError("workspace flow has no supported end step")

    @staticmethod
    def _stage_output(source: Path, design_id: str, step: str, tool: str) -> Path:
        if not _TOOL_NAME.fullmatch(tool):
            raise ValueError(f"completed stage {step} has an invalid tool")
        output_dir = source / f"{step}_{tool}" / "output"
        try:
            output_dir.resolve().relative_to(source)
        except ValueError as exc:
            raise ValueError(f"completed stage {step} output escapes workspace") from exc
        for suffix in _STAGE_OUTPUT_SUFFIXES:
            output = output_dir / f"{design_id}_{step}{suffix}"
            if output.is_file() and not output.is_symlink():
                return output
        raise ValueError(f"completed stage {step} has no matching output artifact")

    @staticmethod
    def _validate_patch(target_step: str, items: list[dict[str, object]]) -> ECCParameterPatch | None:
        if not items:
            return None
        step = _STEP_NAMES[target_step]
        patch = ECCParameterPatch(items=items)
        assert_authorized_parameter_patch(step, patch)
        for item in patch.items:
            _validate_value(item)
        return patch


_MISSING = object()


def _authorized_knobs_for_step(step: ECCStepName) -> tuple[str, ...]:
    from ecos_agent.parameter_authorization import _AUTHORIZED_KNOBS

    return tuple(sorted(_AUTHORIZED_KNOBS.get(step, ())))


def _current_parameter_value(workspace: Path, knob_id: str) -> object:
    # Mirrors the ECC candidate registry's config_key and json_path fields.
    config_name, json_path = _parameter_config_location(knob_id)
    config_path = workspace / "config" / config_name
    try:
        config_path.resolve().relative_to(workspace)
        if config_path.is_symlink() or not config_path.is_file():
            return _MISSING
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _MISSING
    current: object = config
    for key in json_path:
        if not isinstance(current, dict) or key not in current:
            return _MISSING
        current = current[key]
    return current


def _parameter_config_location(knob_id: str) -> tuple[str, tuple[str, ...]]:
    prefix, name = knob_id.split(".", 1)
    if prefix in {"place", "legalization"}:
        aliases = {
            "target_overflow": "stop_overflow",
            "routability_opt": "routability_opt_flag",
            "detailed_place_flag": "detailed_place_flag",
            "deterministic": "deterministic_flag",
        }
        return "dreamplace.json", (aliases.get(name, name),)
    if prefix == "cts":
        return "cts_default_config.json", (name,)
    if prefix == "route":
        aliases = {
            "bottom_layer": "-bottom_routing_layer",
            "top_layer": "-top_routing_layer",
            "thread_number": "-thread_number",
            "enable_timing": "-enable_timing",
        }
        return "rt_default_config.json", ("RT", aliases[name])
    raise ValueError(f"unsupported rerun parameter: {knob_id}")


def _validate_value(item: ECCParameterPatchItem) -> None:
    value = item.value
    if item.knob_id in _RANGED_KNOBS:
        lower, upper = _RANGED_KNOBS[item.knob_id]
        if type(value) not in {int, float} or not lower <= value <= upper:
            raise ValueError(f"{item.knob_id} is outside {lower:g}..{upper:g}")
    elif item.knob_id in _ZERO_BASED_INTEGER_KNOBS:
        if type(value) is not int or value < 0:
            raise ValueError(f"{item.knob_id} must be an integer >= 0")
    elif item.knob_id in _INTEGER_KNOBS:
        if type(value) is not int or value < 1:
            raise ValueError(f"{item.knob_id} must be an integer >= 1")
    elif item.knob_id in BOOLEAN_RERUN_KNOBS:
        if type(value) is not bool:
            raise ValueError(f"{item.knob_id} must be a boolean")
    elif item.knob_id == "cts.routing_layer":
        if (
            not isinstance(value, list)
            or not value
            or len(value) != len(set(value))
            or any(type(layer) is not int or layer < 1 for layer in value)
        ):
            raise ValueError("cts.routing_layer must be a non-empty unique integer list >= 1")
    elif item.knob_id == "cts.buffer_type":
        if (
            not isinstance(value, list)
            or not value
            or len(value) != len(set(value))
            or any(type(buffer) is not str or not buffer.strip() for buffer in value)
        ):
            raise ValueError("cts.buffer_type must be a non-empty unique PDK buffer list")
    elif item.knob_id in {"route.bottom_layer", "route.top_layer"}:
        if type(value) is not str or not value.strip():
            raise ValueError(f"{item.knob_id} must be a non-empty PDK routing-layer name")
    elif type(value) not in {int, float} or not math.isfinite(value) or value < 0:
        raise ValueError(f"{item.knob_id} must be a finite number >= 0")
