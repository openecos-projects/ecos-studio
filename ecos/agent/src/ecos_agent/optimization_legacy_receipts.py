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
    RuntimeObservation,
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
_ITERATION_OVERFLOW = re.compile(r"iteration\s+\d+.*?\bOverflow\s+([0-9.eE+-]+)")
_ROUTABILITY_ROUND = re.compile(
    r"routability optimization round\s+\d+:.*?->\s*\(([01]),\s*([01]),\s*([01])\)"
)
_OLD_MOVABLE_AREA = re.compile(r"old total movable nodes area\s+([0-9.eE+-]+)")
_NEW_MOVABLE_AREA = re.compile(r"new total movable nodes area\s+([0-9.eE+-]+)")
_FLOORPLAN_PARAMETERS = re.compile(
    r"aspect_ratio:\s*([0-9.eE+-]+),\s*utilization:\s*([0-9.eE+-]+)"
)
_MAX_FANOUT = re.compile(r"max_fanout:\s*([0-9]+)")
_FANOUT_RESULT = re.compile(
    r"Total fixed\s+(\d+)\s+nets, inserted\s+(\d+)\s+nets and\s+(\d+)\s+buffers"
)
_TARGET_STEPS = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: "Floorplan",
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "Floorplan",
    OptimizationKnob.SYNTH_MAX_FANOUT: "fixFanout",
}
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_PLACE_KNOBS = frozenset(
    {
        OptimizationKnob.TARGET_DENSITY,
        OptimizationKnob.TARGET_OVERFLOW,
        OptimizationKnob.CELL_PADDING_X,
        OptimizationKnob.ROUTABILITY_OPT,
        OptimizationKnob.DENSITY_WEIGHT,
    }
)


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
    initial, adjustments, final, observations, runtime_evidence = _runtime_values(
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
        runtime_observations=observations,
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
    registry_sha256 = payload.get("registry_sha256")
    if not isinstance(registry_sha256, str) or not _SHA256.fullmatch(registry_sha256):
        raise Gate0ReceiptError("candidate materialization registry hash is invalid")
    patch = [{"knob_id": requested.knob_id.value, "value": written_value}]
    if payload.get("patch") != patch or payload.get("patch_sha256") != canonical_sha256(patch):
        raise Gate0ReceiptError("candidate materialization patch does not match")
    digest_payload = {key: value for key, value in payload.items() if key != "receipt_sha256"}
    if payload.get("receipt_sha256") != canonical_sha256(digest_payload):
        raise Gate0ReceiptError("candidate materialization receipt hash does not match")
    configs = payload.get("configs")
    config_matches = [
        item for item in configs if isinstance(item, dict) and item.get("ref") == target.file
    ] if isinstance(configs, list) else []
    if len(config_matches) != 1:
        raise Gate0ReceiptError("candidate materialization config evidence is invalid")
    config_entry = config_matches[0]
    _validate_hash_fields(config_entry, ("before_sha256", "after_sha256"), "config")
    if config_entry["before_sha256"] == config_entry["after_sha256"]:
        raise Gate0ReceiptError("candidate materialization config was not changed")
    config_path = _candidate_artifact(candidate, config_entry["ref"])
    if file_sha256(config_path) != config_entry["after_sha256"]:
        raise Gate0ReceiptError("candidate materialization config hash does not match")
    snapshots = payload.get("snapshots")
    snapshot_matches = [
        item
        for item in snapshots
        if isinstance(item, dict)
        and item.get("config_key") == config_entry.get("config_key")
        and item.get("before_sha256") == config_entry.get("before_sha256")
        and item.get("after_sha256") == config_entry.get("after_sha256")
    ] if isinstance(snapshots, list) else []
    if len(snapshot_matches) != 1:
        raise Gate0ReceiptError("candidate materialization config snapshot is invalid")
    snapshot_entry = snapshot_matches[0]
    _validate_hash_fields(snapshot_entry, ("before_sha256", "after_sha256"), "snapshot")
    if snapshot_entry["before_sha256"] == snapshot_entry["after_sha256"]:
        raise Gate0ReceiptError("candidate materialization snapshot was not changed")
    before_snapshot = _candidate_artifact(candidate, snapshot_entry.get("before_ref"))
    after_snapshot = _candidate_artifact(candidate, snapshot_entry.get("after_ref"))
    if file_sha256(before_snapshot) != snapshot_entry["before_sha256"]:
        raise Gate0ReceiptError("candidate materialization before hash does not match")
    if file_sha256(after_snapshot) != snapshot_entry["after_sha256"]:
        raise Gate0ReceiptError("candidate materialization after hash does not match")
    if snapshot_entry["before_sha256"] != config_entry["before_sha256"]:
        raise Gate0ReceiptError("candidate materialization before hash is not bound")
    if snapshot_entry["after_sha256"] != config_entry["after_sha256"]:
        raise Gate0ReceiptError("candidate materialization after hash is not bound")
    stored_value = int(written_value) if requested.knob_id == OptimizationKnob.ROUTABILITY_OPT else written_value
    if _target_value(after_snapshot, target) != stored_value:
        raise Gate0ReceiptError("candidate materialization config value does not match")


def _validate_hash_fields(
    payload: dict[str, object], fields: tuple[str, ...], label: str
) -> None:
    if any(
        not isinstance(payload.get(field), str)
        or not _SHA256.fullmatch(payload[field])
        for field in fields
    ):
        raise Gate0ReceiptError(f"candidate materialization {label} hash is invalid")


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
    tuple[RuntimeObservation, ...],
    dict[str, str],
]:
    if requested.knob_id in {
        OptimizationKnob.FLOORPLAN_CORE_UTIL,
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
    }:
        return _floorplan_runtime_values(candidate, requested, written_value)
    if requested.knob_id == OptimizationKnob.SYNTH_MAX_FANOUT:
        return _fixfanout_runtime_values(candidate, requested, written_value)
    if requested.knob_id not in _PLACE_KNOBS:
        raise Gate0ReceiptError("legacy receipt parser does not support this knob")
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
    tuple[RuntimeObservation, ...],
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
    observations = _place_runtime_observations(
        requested, log, initial, final, len(adjusted_values), log_sha256
    )
    return initial, adjustments, final, observations, {"place_log": log_sha256}


def _place_runtime_observations(
    requested: RequestedKnobValue,
    log: str,
    initial: AppliedKnobValue,
    final: AppliedKnobValue,
    adjustment_count: int,
    evidence_sha256: str,
) -> tuple[RuntimeObservation, ...]:
    knob_id = requested.knob_id
    if knob_id == OptimizationKnob.TARGET_DENSITY:
        values = {
            "effective_target_density": final.value,
            "target_density_adjustment_count": adjustment_count,
        }
    elif knob_id == OptimizationKnob.TARGET_OVERFLOW:
        overflows = [float(value) for value in _ITERATION_OVERFLOW.findall(log)]
        if not overflows:
            raise Gate0ReceiptError("candidate target-overflow runtime evidence is invalid")
        values = {
            "final_overflow": overflows[-1],
            "minimum_overflow": min(overflows),
            "target_overflow_reached": min(overflows) <= float(requested.value),
        }
    elif knob_id == OptimizationKnob.CELL_PADDING_X:
        values = {
            "applied_cell_padding_dbu": final.value,
            "cell_padding_capacity_cap_count": adjustment_count,
        }
    elif knob_id == OptimizationKnob.ROUTABILITY_OPT:
        values = _routability_observation_values(log, bool(initial.value))
    else:
        values = {
            "final_density_weight": final.value,
            "initial_density_weight": initial.value,
        }
    return tuple(
        RuntimeObservation(metric=metric, value=value, evidence_sha256=evidence_sha256)
        for metric, value in values.items()
    )


def _routability_observation_values(
    log: str, enabled: bool
) -> dict[str, bool | int | float]:
    rounds = _ROUTABILITY_ROUND.findall(log)
    applied = sum(int(flags[0]) for flags in rounds)
    if not enabled and rounds:
        raise Gate0ReceiptError("candidate routability runtime evidence is invalid")
    values: dict[str, bool | int | float] = {
        "area_adjustment_applied": applied > 0,
        "area_adjustment_count": applied,
        "routability_round_count": len(rounds),
    }
    old_areas = [float(value) for value in _OLD_MOVABLE_AREA.findall(log)]
    new_areas = [float(value) for value in _NEW_MOVABLE_AREA.findall(log)]
    if applied and (not old_areas or not new_areas):
        raise Gate0ReceiptError("candidate routability area evidence is invalid")
    if old_areas and new_areas:
        values.update(
            initial_movable_area=old_areas[0], final_movable_area=new_areas[-1]
        )
    return values


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
    tuple[RuntimeObservation, ...],
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
    feature_path = _candidate_artifact(
        candidate, "Floorplan_ecc/feature/Floorplan.db.json"
    )
    layout = _read_json(feature_path, "candidate Floorplan feature").get(
        "Design Layout"
    )
    if not isinstance(layout, dict):
        raise Gate0ReceiptError("candidate Floorplan feature is invalid")
    core_usage = _finite_float(layout.get("core_usage"), "Floorplan core usage")
    core_width = _finite_float(
        layout.get("core_bounding_width"), "Floorplan core width"
    )
    core_height = _finite_float(
        layout.get("core_bounding_height"), "Floorplan core height"
    )
    if not 0 < core_usage <= 1 or core_width <= 0 or core_height <= 0:
        raise Gate0ReceiptError("candidate Floorplan core geometry is invalid")
    achieved_value = (
        core_usage
        if requested.knob_id == OptimizationKnob.FLOORPLAN_CORE_UTIL
        else core_width / core_height
    )
    feature_sha256 = file_sha256(feature_path)
    evidence["floorplan_feature"] = feature_sha256
    metric = (
        "achieved_core_utilization"
        if requested.knob_id == OptimizationKnob.FLOORPLAN_CORE_UTIL
        else "achieved_core_aspect_ratio"
    )
    observations = (
        RuntimeObservation(
            metric=metric, value=achieved_value, evidence_sha256=feature_sha256
        ),
    )
    return initial, (), initial, observations, evidence


def _fixfanout_runtime_values(
    candidate: Path,
    requested: RequestedKnobValue,
    written_value: bool | int | float,
) -> tuple[
    AppliedKnobValue,
    tuple[RuntimeAdjustment, ...],
    AppliedKnobValue,
    tuple[RuntimeObservation, ...],
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
    result = _FANOUT_RESULT.search(log)
    if result is None:
        raise Gate0ReceiptError("candidate fixFanout action evidence is invalid")
    effective = AppliedKnobValue(knob_id=requested.knob_id, value=int(match.group(1)))
    log_sha256 = file_sha256(log_path)
    fixed_nets, inserted_nets, inserted_buffers = (int(value) for value in result.groups())
    values: dict[str, bool | int] = {
        "fanout_fix_completed": True,
        "fixed_net_count": fixed_nets,
        "inserted_buffer_count": inserted_buffers,
        "inserted_net_count": inserted_nets,
    }
    observations = tuple(
        RuntimeObservation(metric=metric, value=value, evidence_sha256=log_sha256)
        for metric, value in values.items()
    )
    return effective, (), effective, observations, {"fixfanout_log": log_sha256}


def _finite_float(value: object, label: str) -> float:
    if type(value) not in {int, float} or not math.isfinite(float(value)):
        raise Gate0ReceiptError(f"candidate {label} is invalid")
    return float(value)


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
