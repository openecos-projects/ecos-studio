"""Workspace authorization and result validation owned outside the GUI provider."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.knob_registry import KNOB_SPECS
from ecos_agent.provider_session import ProviderSession
from ecos_agent.workspace_rerun import GuiWorkspaceRerunResolver

_RERUN_RESULT_PREFIX = "workspace_rerun_result:"


@dataclass(frozen=True)
class WorkspaceRerunResult:
    status: Literal["succeeded", "failed"]
    error: str
    end_step: str | None


class WorkspaceFlow:
    def __init__(self, session: ProviderSession) -> None:
        self.session = session

    @property
    def resolver(self) -> GuiWorkspaceRerunResolver:
        resolver = self.session.rerun_resolver
        if resolver is None:
            raise ValueError("Rerun workspace recommendation is missing")
        return resolver

    def tunable_parameters(self, workspace: Path) -> tuple[tuple[str, object], ...]:
        merged: dict[str, object] = {}
        for step in ECCStepName:
            try:
                values = GuiWorkspaceRerunResolver.stage_parameter_values(
                    workspace, step.value
                )
            except ValueError:
                continue
            for knob_id, value in values:
                merged.setdefault(knob_id, value)
        return tuple(merged.items())

    def validate_parameter_patch(
        self,
        patch: list[dict[str, object]],
        available: Mapping[str, object],
    ) -> None:
        if not patch:
            raise ValueError(
                "no parameter changes were proposed; describe a concrete knob change "
                "such as lower target density"
            )
        by_step: dict[str, list[dict[str, object]]] = {}
        for item in patch:
            knob_id = str(item.get("knob_id", ""))
            if knob_id not in available or knob_id not in KNOB_SPECS:
                raise ValueError(
                    f"parameter {knob_id} is not available in this workspace"
                )
            by_step.setdefault(KNOB_SPECS[knob_id].step.value, []).append(item)
        for step, items in by_step.items():
            GuiWorkspaceRerunResolver.validate_patch(step, items)

    def rerun_result(self, message: str) -> WorkspaceRerunResult:
        parsed = _parse_rerun_result(message)
        if parsed is None:
            raise ValueError("Workspace rerun result is malformed.")
        contract = self.session.workspace_rerun_contract
        if contract is None:
            raise ValueError("Workspace rerun contract is missing.")
        rerun_id, status, error, end_step = parsed
        if rerun_id != contract.rerun_id:
            raise ValueError(
                "Workspace rerun result does not match the pending contract."
            )
        return WorkspaceRerunResult(status=status, error=error, end_step=end_step)


def _parse_rerun_result(
    message: str,
) -> tuple[str, Literal["succeeded", "failed"], str, str | None] | None:
    if not message.startswith(_RERUN_RESULT_PREFIX):
        return None
    try:
        payload = json.loads(message.removeprefix(_RERUN_RESULT_PREFIX))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or not {
        "rerun_id",
        "status",
        "error",
    }.issubset(payload):
        return None
    if set(payload) - {"rerun_id", "status", "error", "end_step"}:
        return None
    rerun_id = payload.get("rerun_id")
    status = payload.get("status")
    error = payload.get("error")
    if (
        not isinstance(rerun_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", rerun_id)
        or status not in {"succeeded", "failed"}
        or not isinstance(error, str)
    ):
        return None
    normalized_error = re.sub(r"[\x00-\x1f\x7f]+", " ", error).strip()[:512]
    if status == "failed" and not normalized_error:
        return None
    end_step = payload.get("end_step")
    if end_step is not None and (
        not isinstance(end_step, str) or len(end_step) > 64 or not end_step.strip()
    ):
        return None
    return rerun_id, status, normalized_error, end_step.strip() if end_step else None
