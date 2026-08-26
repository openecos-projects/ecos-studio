"""Build Gate 0 knob receipts from ECC candidate artifacts."""

from __future__ import annotations

import ast
import json
import math
import re
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.knob_registry import KnobTarget, knob_spec
from ecos_agent.optimization_contracts import (
    AppliedKnobValue,
    KnobApplicationReceipt,
    OptimizationKnob,
    RequestedKnobValue,
    RuntimeAdjustment,
)
from ecos_agent.optimization_controller import CandidateExecutionEvidence

_INITIAL_DENSITY = re.compile(
    r"utilization\s*=\s*[0-9.eE+-]+,\s*target_density\s*=\s*([0-9.eE+-]+)"
)
_ADJUSTED_DENSITY = re.compile(r"new target_density\s+([0-9.eE+-]+)")
_ADJUSTED_PADDING = re.compile(
    r"cell_padding_x\s+[0-9.eE+-]+.*?reducing it to\s+([0-9.eE+-]+)"
)
_RUNTIME_DENSITY_WEIGHT = re.compile(r"density_weight\s*=\s*([0-9.eE+-]+)")
_ITERATION_DENSITY_WEIGHT = re.compile(
    r"iteration\s+\d+.*?DensityWeight\s+([0-9.eE+-]+)"
)
_FLOORPLAN_PARAMETERS = re.compile(
    r"aspect_ratio:\s*([0-9.eE+-]+),\s*utilization:\s*([0-9.eE+-]+)"
)
_MAX_FANOUT = re.compile(r"max_fanout:\s*([0-9]+)")
_TARGET_STEPS = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: "Floorplan",
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "Floorplan",
    OptimizationKnob.SYNTH_MAX_FANOUT: "fixFanout",
}


class Gate0ReceiptError(ValueError):
    """ECC candidate artifacts cannot prove the requested knob application."""


def place_runtime_coordinate_values(
    workspace_root: Path,
    *,
    configured_target_density: int | float,
    configured_cell_padding_dbu: int,
    site_width_dbu: int,
) -> dict[str, float]:
    if type(site_width_dbu) is not int or site_width_dbu <= 0:
        raise Gate0ReceiptError("site width is invalid")
    log_path = _candidate_artifact(
        Path(workspace_root).resolve(), "place_dreamplace/log/place.log"
    )
    log, parameters = _place_log(log_path)
    if (
        parameters.get("target_density") != configured_target_density
        or parameters.get("cell_padding_x") != configured_cell_padding_dbu
    ):
        raise Gate0ReceiptError("place runtime parameters do not match configuration")
    density_initial, density_adjustments = _density_runtime_values(log)
    padding_adjustments = _padding_runtime_values(log, site_width_dbu)
    return {
        OptimizationKnob.TARGET_DENSITY.value: (
            density_adjustments[-1] if density_adjustments else density_initial
        ),
        OptimizationKnob.CELL_PADDING_X.value: (
            padding_adjustments[-1] if padding_adjustments else configured_cell_padding_dbu
        )
        / site_width_dbu,
    }


def build_materialization_application_receipt(
    workspace_root: Path,
    evidence: CandidateExecutionEvidence,
    requested: RequestedKnobValue,
    *,
    site_width_dbu: int,
) -> KnobApplicationReceipt:
    if type(site_width_dbu) is not int or site_width_dbu <= 0:
        raise Gate0ReceiptError("site width is invalid")
    candidate, payload, materialization_path = _load_materialization(
        workspace_root, evidence, requested
    )
    written_value = _written_value(requested, site_width_dbu)
    target = knob_spec(requested.knob_id.value).read_target
    _validate_materialization(candidate, payload, target, requested, written_value)
    initial, adjustments, final, runtime_evidence = _runtime_values(
        candidate, target, requested, written_value, site_width_dbu
    )
    evidence_sha256 = canonical_sha256(
        {
            "materialization": file_sha256(materialization_path),
            **runtime_evidence,
        }
    )
    return KnobApplicationReceipt(
        receipt_id=f"receipt-{evidence_sha256[7:31]}",
        requested=requested,
        written=AppliedKnobValue(knob_id=requested.knob_id, value=written_value),
        effective_initial=initial,
        runtime_adjustments=adjustments,
        effective_final=final,
        evidence_sha256=evidence_sha256,
    )


def _load_materialization(
    workspace_root: Path,
    evidence: CandidateExecutionEvidence,
    requested: RequestedKnobValue,
) -> tuple[Path, dict[str, object], Path]:
    root = Path(workspace_root).resolve()
    try:
        candidate = (root / evidence.candidate_root_ref).resolve(strict=True)
        candidate.relative_to(root)
    except (OSError, ValueError) as exc:
        raise Gate0ReceiptError("candidate materialization path is unsafe") from exc
    path = candidate / "analysis/candidate_materialization.v1.json"
    payload = _read_json(path, "candidate materialization receipt")
    if (
        payload.get("schema") != "ecc.workspace.candidate_materialization.v1"
        or payload.get("schema_version") != 1
        or payload.get("candidate_id") != candidate.name
        or payload.get("target_step") != _TARGET_STEPS.get(requested.knob_id, "place")
        or payload.get("target")
        != {"step": _TARGET_STEPS.get(requested.knob_id, "place")}
    ):
        raise Gate0ReceiptError("candidate materialization receipt is invalid")
    return candidate, payload, path


def _validate_materialization(
    candidate: Path,
    payload: dict[str, object],
    target: KnobTarget,
    requested: RequestedKnobValue,
    written_value: bool | int | float,
) -> None:
    patch = [{"knob_id": requested.knob_id.value, "value": written_value}]
    if payload.get("patch") != patch or payload.get("patch_sha256") != canonical_sha256(patch):
        raise Gate0ReceiptError("candidate materialization patch does not match")
    digest_payload = {key: value for key, value in payload.items() if key != "receipt_sha256"}
    if payload.get("receipt_sha256") != canonical_sha256(digest_payload):
        raise Gate0ReceiptError("candidate materialization receipt hash does not match")
    configs = payload.get("configs")
    matches = [
        item for item in configs if isinstance(item, dict) and item.get("ref") == target.file
    ] if isinstance(configs, list) else []
    if len(matches) != 1:
        raise Gate0ReceiptError("candidate materialization config evidence is invalid")
    snapshots = payload.get("snapshots")
    matches = [
        item
        for item in snapshots
        if isinstance(item, dict)
        and item.get("config_key") == matches[0].get("config_key")
        and item.get("after_sha256") == matches[0].get("after_sha256")
    ] if isinstance(snapshots, list) else []
    if len(matches) != 1 or not isinstance(matches[0].get("after_ref"), str):
        raise Gate0ReceiptError("candidate materialization config snapshot is invalid")
    snapshot = _candidate_artifact(candidate, matches[0]["after_ref"])
    if file_sha256(snapshot) != matches[0].get("after_sha256"):
        raise Gate0ReceiptError("candidate materialization config hash does not match")
    stored_value = int(written_value) if requested.knob_id == OptimizationKnob.ROUTABILITY_OPT else written_value
    if _target_value(snapshot, target) != stored_value:
        raise Gate0ReceiptError("candidate materialization config value does not match")


def _runtime_values(
    candidate: Path,
    target: KnobTarget,
    requested: RequestedKnobValue,
    written_value: bool | int | float,
    site_width_dbu: int,
) -> tuple[
    AppliedKnobValue,
    tuple[RuntimeAdjustment, ...],
    AppliedKnobValue,
    dict[str, str],
]:
    if requested.knob_id in {
        OptimizationKnob.FLOORPLAN_CORE_UTIL,
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
    }:
        return _floorplan_runtime_values(candidate, requested, written_value)
    if requested.knob_id == OptimizationKnob.SYNTH_MAX_FANOUT:
        return _fixfanout_runtime_values(candidate, requested, written_value)
    return _place_runtime_values(
        candidate, target, requested, written_value, site_width_dbu
    )


def _place_runtime_values(
    candidate: Path,
    target: KnobTarget,
    requested: RequestedKnobValue,
    written_value: bool | int | float,
    site_width_dbu: int,
) -> tuple[
    AppliedKnobValue,
    tuple[RuntimeAdjustment, ...],
    AppliedKnobValue,
    dict[str, str],
]:
    log_path = _candidate_artifact(candidate, "place_dreamplace/log/place.log")
    log, parameters = _place_log(log_path)
    stored_value = int(written_value) if requested.knob_id == OptimizationKnob.ROUTABILITY_OPT else written_value
    if not isinstance(parameters, dict) or _mapping_value(parameters, target) != stored_value:
        raise Gate0ReceiptError("candidate materialization config value does not match runtime")
    initial_value = written_value
    adjusted_values: list[float | int] = []
    adjustment_reason = "DreamPlace routability density adjustment"
    if requested.knob_id == OptimizationKnob.TARGET_DENSITY:
        initial_value, adjusted_values = _density_runtime_values(log)
    elif requested.knob_id == OptimizationKnob.DENSITY_WEIGHT:
        initial_values = [float(value) for value in _RUNTIME_DENSITY_WEIGHT.findall(log)]
        iteration_values = [float(value) for value in _ITERATION_DENSITY_WEIGHT.findall(log)]
        if not initial_values or not iteration_values:
            raise Gate0ReceiptError("candidate density-weight runtime evidence is invalid")
        initial_value = initial_values[0]
        final_value = iteration_values[-1]
        adjusted_values = [] if math.isclose(initial_value, final_value) else [final_value]
        adjustment_reason = "DreamPlace adaptive density-weight update"
    elif requested.knob_id == OptimizationKnob.CELL_PADDING_X:
        adjusted_values = _padding_runtime_values(log, site_width_dbu)
        adjustment_reason = "DreamPlace cell-padding capacity cap"
    if len(adjusted_values) > 16:
        raise Gate0ReceiptError("candidate runtime adjustment evidence is too large")
    log_sha256 = file_sha256(log_path)
    initial = AppliedKnobValue(knob_id=requested.knob_id, value=initial_value)
    adjustments = tuple(
        RuntimeAdjustment(
            effective_value=AppliedKnobValue(knob_id=requested.knob_id, value=value),
            reason=adjustment_reason,
            evidence_sha256=log_sha256,
        )
        for value in adjusted_values
    )
    final = adjustments[-1].effective_value if adjustments else initial
    return initial, adjustments, final, {"place_log": log_sha256}


def _place_log(log_path: Path) -> tuple[str, dict[str, object]]:
    try:
        log = log_path.read_text(encoding="utf-8")
        parameters_line = next(line for line in log.splitlines() if "parameters = " in line)
        parameters = ast.literal_eval(parameters_line.split("parameters = ", 1)[1])
    except (OSError, StopIteration, SyntaxError, TypeError, ValueError) as exc:
        raise Gate0ReceiptError("candidate place runtime evidence is invalid") from exc
    if not isinstance(parameters, dict):
        raise Gate0ReceiptError("candidate place runtime evidence is invalid")
    return log, parameters


def _density_runtime_values(log: str) -> tuple[float, list[float]]:
    initial = _INITIAL_DENSITY.search(log)
    if initial is None:
        raise Gate0ReceiptError("candidate target-density runtime evidence is invalid")
    return float(initial.group(1)), [
        float(value) for value in _ADJUSTED_DENSITY.findall(log)
    ]


def _padding_runtime_values(log: str, site_width_dbu: int) -> list[int]:
    return [
        int(round(float(value) * site_width_dbu))
        for value in _ADJUSTED_PADDING.findall(log)
    ]


def _floorplan_runtime_values(
    candidate: Path,
    requested: RequestedKnobValue,
    written_value: bool | int | float,
) -> tuple[
    AppliedKnobValue,
    tuple[RuntimeAdjustment, ...],
    AppliedKnobValue,
    dict[str, str],
]:
    log_path = _candidate_artifact(candidate, "Floorplan_ecc/log/Floorplan.log")
    try:
        log = log_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise Gate0ReceiptError("candidate Floorplan runtime evidence is invalid") from exc
    match = _FLOORPLAN_PARAMETERS.search(log)
    if match is None:
        raise Gate0ReceiptError("candidate Floorplan runtime evidence is invalid")
    aspect_ratio, core_util = (float(value) for value in match.groups())
    initial_value = (
        core_util
        if requested.knob_id == OptimizationKnob.FLOORPLAN_CORE_UTIL
        else aspect_ratio
    )
    if not math.isclose(float(written_value), initial_value, abs_tol=1e-12):
        raise Gate0ReceiptError("candidate materialization config value does not match runtime")
    initial = AppliedKnobValue(knob_id=requested.knob_id, value=initial_value)
    evidence = {"floorplan_log": file_sha256(log_path)}
    if requested.knob_id == OptimizationKnob.FLOORPLAN_CORE_UTIL:
        return initial, (), initial, evidence
    parameters_path = _candidate_artifact(candidate, "home/parameters.json")
    target = knob_spec(requested.knob_id.value).read_target
    final_value = _mapping_value(
        _read_json(parameters_path, "candidate final parameters"), target
    )
    final = AppliedKnobValue(knob_id=requested.knob_id, value=final_value)
    evidence["final_parameters"] = file_sha256(parameters_path)
    if final == initial:
        return initial, (), final, evidence
    adjustment = RuntimeAdjustment(
        effective_value=final,
        reason="Floorplan layout-derived aspect ratio",
        evidence_sha256=evidence["final_parameters"],
    )
    return initial, (adjustment,), final, evidence


def _fixfanout_runtime_values(
    candidate: Path,
    requested: RequestedKnobValue,
    written_value: bool | int | float,
) -> tuple[
    AppliedKnobValue,
    tuple[RuntimeAdjustment, ...],
    AppliedKnobValue,
    dict[str, str],
]:
    log_path = _candidate_artifact(candidate, "fixFanout_ecc/log/fixFanout.log")
    try:
        log = log_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise Gate0ReceiptError("candidate fixFanout runtime evidence is invalid") from exc
    match = _MAX_FANOUT.search(log)
    if match is None or int(match.group(1)) != written_value:
        raise Gate0ReceiptError("candidate materialization config value does not match runtime")
    effective = AppliedKnobValue(knob_id=requested.knob_id, value=int(match.group(1)))
    return effective, (), effective, {"fixfanout_log": file_sha256(log_path)}


def _written_value(requested: RequestedKnobValue, site_width_dbu: int) -> bool | int | float:
    value = requested.value
    return value * site_width_dbu if requested.knob_id == OptimizationKnob.CELL_PADDING_X else value


def _candidate_artifact(candidate: Path, ref: object) -> Path:
    if not isinstance(ref, str):
        raise Gate0ReceiptError("candidate artifact reference is invalid")
    try:
        path = (candidate / ref).resolve(strict=True)
        path.relative_to(candidate)
    except (OSError, ValueError) as exc:
        raise Gate0ReceiptError("candidate artifact path is unsafe") from exc
    if not path.is_file():
        raise Gate0ReceiptError("candidate artifact is unavailable")
    return path


def _read_json(path: Path, label: str) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Gate0ReceiptError(f"{label} is invalid") from exc
    if not isinstance(payload, dict):
        raise Gate0ReceiptError(f"{label} is invalid")
    return payload


def _target_value(path: Path, target: KnobTarget) -> object:
    return _mapping_value(_read_json(path, "candidate config snapshot"), target)


def _mapping_value(payload: object, target: KnobTarget) -> object:
    try:
        value = payload
        for key in target.json_path:
            value = value[key]  # type: ignore[index]
        return value
    except (KeyError, IndexError, TypeError) as exc:
        raise Gate0ReceiptError("candidate materialization config value is invalid") from exc
