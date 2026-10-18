"""Completion and runtime evidence for optimization candidate flows."""

import json
import re
from pathlib import Path

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.optimization.execution import CANDIDATE_END_STEP

# Candidate budget stages: the ECC catalog minus the synthesis entry stages
# (candidates always start from an existing synthesized workspace) and
# postRouteLec (skipped inside isolated candidate reruns).
_CANDIDATE_SKIPPED_STAGES = frozenset(
    {ECCStepName.SYNTHESIS, ECCStepName.LEC, ECCStepName.POST_ROUTE_LEC}
)
_ADVISORY_STAGES = frozenset({ECCStepName.ANTENNA_CHECK.value, ECCStepName.EMIR.value})
_OPTIMIZATION_RERUN_STAGES = tuple(
    step.value for step in ECCStepName if step not in _CANDIDATE_SKIPPED_STAGES
)
assert _OPTIMIZATION_RERUN_STAGES[-1] == CANDIDATE_END_STEP


def _optimization_rerun_runtime_seconds(workspace: Path) -> float:
    from ecos_agent.optimization.runtime import OptimizationRuntimeError

    try:
        payload = json.loads(
            (workspace / "home" / "flow.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError(
            "optimization rerun flow evidence is unavailable"
        ) from exc
    steps = payload.get("steps")
    if not isinstance(steps, list):
        raise OptimizationRuntimeError(
            "optimization rerun flow completion evidence is invalid"
        )
    total = 0.0
    for stage in _OPTIMIZATION_RERUN_STAGES:
        # Optional analyses do not invalidate legacy or attention-only flows.
        # Include their runtime when successful evidence is available.
        if stage in _ADVISORY_STAGES and not any(
            isinstance(step, dict)
            and step.get("name") == stage
            and step.get("state") == "Success"
            for step in steps
        ):
            continue
        total += _successful_flow_stage_runtime_seconds(steps, stage)
    if total <= 0:
        raise OptimizationRuntimeError("optimization rerun runtime evidence is invalid")
    return total


def _successful_flow_stage_runtime_seconds(steps: list[object], stage: str) -> float:
    from ecos_agent.optimization.runtime import OptimizationRuntimeError

    matches = [
        item for item in steps if isinstance(item, dict) and item.get("name") == stage
    ]
    if len(matches) != 1 or matches[0].get("state") != "Success":
        raise OptimizationRuntimeError(
            "optimization rerun flow completion evidence is invalid"
        )
    runtime = matches[0].get("runtime")
    if not isinstance(runtime, str):
        raise OptimizationRuntimeError("optimization rerun runtime evidence is invalid")
    match = re.fullmatch(r"(\d+):(\d+):(\d+)", runtime.strip())
    if match is None:
        raise OptimizationRuntimeError("optimization rerun runtime evidence is invalid")
    hours, minutes, seconds = (int(part) for part in match.groups())
    if minutes >= 60 or seconds >= 60:
        raise OptimizationRuntimeError("place-to-Harden runtime evidence is invalid")
    return float(hours * 3600 + minutes * 60 + seconds)
