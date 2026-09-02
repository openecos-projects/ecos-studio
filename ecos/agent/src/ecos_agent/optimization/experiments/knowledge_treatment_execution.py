"""Validate inputs and execute ECC workspaces for knowledge treatments."""

from __future__ import annotations

import json
import math
import re
import shutil
import statistics
import time
from pathlib import Path
from typing import NamedTuple

from ecos_agent.workspace.contracts import GUI_WORKSPACE_FLOW_STEPS
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import (
    TerminalObservation,
)
from ecos_agent.optimization.ecc.adapter import EccContentLengthRpcClient
from ecos_agent.optimization.experiments.equal_budget import (
    validate_design_manifest,
)
from ecos_agent.optimization.observations import build_terminal_observation
from ecos_agent.optimization.runtime import (
    _ecc_executable,
    _optimization_rerun_runtime_seconds,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SETUP_METHODS = frozenset({"workspace.create", "operation.start_flow"})
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
_DEFAULT_REPLAYS = 3


class DesignSpec(NamedTuple):
    design_id: str
    top_module: str
    clock_name: str
    filelist: Path
    rtl_list: tuple[Path, ...]
    sdc: Path


class ExperimentManifest(NamedTuple):
    manifest_sha256: str
    designs: tuple[DesignSpec, ...]
    baseline: dict[str, object]
    pdk_name: str
    pdk_root: Path


def load_experiment_manifest(
    path: Path, benchmark_root: Path, pdk_root: Path
) -> ExperimentManifest:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schema_version") != "ecos.frozen_design_manifest.v2":
        raise ValueError("Phase 8 manifest schema is invalid")
    declared_hash = payload.get("manifest_sha256")
    expected_hash = canonical_sha256(
        {key: value for key, value in payload.items() if key != "manifest_sha256"}
    )
    if declared_hash != expected_hash:
        raise ValueError("Phase 8 manifest hash does not match")
    design_ids = validate_design_manifest(payload.get("design_ids", ()))
    rows = payload.get("designs")
    if not isinstance(rows, list) or [item.get("design_id") for item in rows] != list(
        design_ids
    ):
        raise ValueError("Phase 8 design records do not match frozen ids")
    benchmark_root = Path(benchmark_root).resolve()
    designs = tuple(_load_design(row, benchmark_root) for row in rows)
    baseline = payload.get("baseline")
    _validate_baseline(baseline)
    pdk = payload.get("pdk")
    if not isinstance(pdk, dict) or pdk.get("name") != "ics55":
        raise ValueError("Phase 8 PDK record is invalid")
    pdk_root = Path(pdk_root).resolve()
    tech_lef = _safe_path(pdk_root, pdk.get("tech_lef"))
    if file_sha256(tech_lef) != pdk.get("tech_lef_sha256"):
        raise ValueError("Phase 8 PDK hash does not match")
    return ExperimentManifest(
        declared_hash, designs, dict(baseline), str(pdk["name"]), pdk_root
    )


def _load_design(row: object, benchmark_root: Path) -> DesignSpec:
    if not isinstance(row, dict):
        raise ValueError("Phase 8 design record is invalid")
    design_id = row.get("design_id")
    top_module = row.get("top_module")
    clock_name = row.get("clock_name")
    if not all(isinstance(item, str) and _ID.fullmatch(item) for item in (design_id, top_module, clock_name)):
        raise ValueError("Phase 8 design identifiers are invalid")
    filelist = _safe_path(benchmark_root, row.get("filelist"))
    sdc = _safe_path(benchmark_root, row.get("sdc"))
    if file_sha256(filelist) != row.get("filelist_sha256") or file_sha256(sdc) != row.get("sdc_sha256"):
        raise ValueError("Phase 8 design input hash does not match")
    design_root = filelist.parent
    rtl_refs = _filelist_refs(filelist)
    rtl_list = tuple(_safe_path(design_root, ref) for ref in rtl_refs)
    bundle = canonical_sha256(
        {ref: file_sha256(rtl) for ref, rtl in zip(rtl_refs, rtl_list, strict=True)}
    )
    if bundle != row.get("rtl_bundle_sha256"):
        raise ValueError("Phase 8 RTL bundle hash does not match")
    return DesignSpec(design_id, top_module, clock_name, filelist, rtl_list, sdc)


def _filelist_refs(path: Path) -> tuple[str, ...]:
    refs = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        value = raw.strip()
        if not value or value == "+incdir+./rtl":
            continue
        if (
            value.startswith(("+", "-"))
            or any(char.isspace() for char in value)
            or not _safe_ref(value)
        ):
            raise ValueError("Phase 8 filelist contains an unsupported entry")
        refs.append(value)
    if not refs:
        raise ValueError("Phase 8 filelist has no RTL inputs")
    return tuple(refs)


def _safe_ref(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and not value.startswith("/")
        and "\\" not in value
        and all(part not in {"", ".", ".."} for part in value.split("/"))
    )


def _safe_path(root: Path, value: object) -> Path:
    if not _safe_ref(value):
        raise ValueError("Phase 8 input reference is invalid")
    path = (root / str(value)).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Phase 8 input reference escapes its root") from exc
    if not path.is_file() or path.is_symlink():
        raise ValueError("Phase 8 input file is unavailable")
    return path


def _validate_baseline(value: object) -> None:
    required = {
        "frequency_mhz",
        "max_fanout",
        "core_utilization",
        "core_aspect_ratio",
        "target_density",
        "target_overflow",
        "cell_padding_sites",
        "routability_opt",
        "density_weight",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("Phase 8 baseline is invalid")
    if type(value["routability_opt"]) is not bool or any(
        not isinstance(value[key], (int, float))
        or isinstance(value[key], bool)
        or not math.isfinite(value[key])
        for key in required - {"routability_opt"}
    ):
        raise ValueError("Phase 8 baseline values are invalid")


def _ensure_workspace(
    manifest: ExperimentManifest,
    design: DesignSpec,
    workspace: Path,
    timeout: float,
) -> TerminalObservation:
    if (workspace / "home/flow.json").is_file():
        if _workspace_flow_succeeded(workspace):
            _verify_workspace_inputs(manifest, design, workspace)
            return _terminal_observation(workspace)
        _verify_workspace_binding(manifest, design, workspace)
        client = EccContentLengthRpcClient(
            _ecc_executable(), response_timeout_seconds=30
        )
        try:
            workspace_id = client.open_workspace(workspace)
            _run_canonical_flow(client, workspace_id, design.design_id, timeout)
        finally:
            client.close()
        _verify_workspace_inputs(manifest, design, workspace)
        return _terminal_observation(workspace)
    if workspace.exists():
        raise ValueError("incomplete Phase 8 workspace already exists")
    client = EccContentLengthRpcClient(_ecc_executable(), response_timeout_seconds=30)
    try:
        request = _workspace_request(manifest, design, workspace)
        created = _setup_request(client, "workspace.create", request, 120.0)
        workspace_id = created.get("workspaceId")
        if not isinstance(workspace_id, str) or not _ID.fullmatch(workspace_id):
            raise ValueError("Phase 8 workspace id is invalid")
        _run_canonical_flow(client, workspace_id, design.design_id, timeout)
    finally:
        client.close()
    _verify_workspace_inputs(manifest, design, workspace)
    return _terminal_observation(workspace)


def _workspace_flow_succeeded(workspace: Path) -> bool:
    flow = _workspace_json(workspace, "home/flow.json")
    steps = flow.get("steps")
    if not isinstance(steps, list) or [
        item.get("name") for item in steps if isinstance(item, dict)
    ] != list(GUI_WORKSPACE_FLOW_STEPS):
        raise ValueError("Phase 8 workspace flow is invalid")
    return all(item.get("state") == "Success" for item in steps)


def _run_canonical_flow(
    client: EccContentLengthRpcClient,
    workspace_id: str,
    design_id: str,
    timeout: float,
) -> None:
    operation = _setup_request(
        client,
        "operation.start_flow",
        {
            "workspaceId": workspace_id,
            "rerun": False,
            "origin": "gui",
            "idempotencyKey": f"phase8.{design_id}.canonical",
        },
        30.0,
    )
    terminal = _wait_operation(client, operation, timeout)
    if terminal.get("state") != "succeeded":
        raise ValueError("Phase 8 canonical flow failed")


def _terminal_observation(workspace: Path) -> TerminalObservation:
    terminal = build_terminal_observation(workspace)
    if terminal.schema_version != "ecos.terminal_observation.v3":
        raise ValueError("Phase 8 workspace terminal evidence is not v3")
    return terminal


def _verify_workspace_binding(
    manifest: ExperimentManifest, design: DesignSpec, workspace: Path
) -> None:
    _verify_workspace_inputs(manifest, design, workspace)
    _verify_workspace_parameters(manifest, design, workspace)


def _verify_workspace_inputs(
    manifest: ExperimentManifest, design: DesignSpec, workspace: Path
) -> None:
    filelist = _workspace_file(workspace, Path("origin/filelist.f"))
    sdc = _workspace_file(workspace, Path("origin") / design.sdc.name)
    refs = _filelist_refs(filelist)
    rtl = tuple(_workspace_file(workspace, Path("origin") / ref) for ref in refs)
    source_refs = _filelist_refs(design.filelist)
    if file_sha256(filelist) != file_sha256(design.filelist):
        raise ValueError("Phase 8 workspace filelist does not match")
    if file_sha256(sdc) != file_sha256(design.sdc):
        raise ValueError("Phase 8 workspace SDC does not match")
    actual_bundle = canonical_sha256(
        {ref: file_sha256(path) for ref, path in zip(refs, rtl, strict=True)}
    )
    expected_bundle = canonical_sha256(
        {
            ref: file_sha256(path)
            for ref, path in zip(source_refs, design.rtl_list, strict=True)
        }
    )
    if refs != source_refs or actual_bundle != expected_bundle:
        raise ValueError("Phase 8 workspace RTL bundle does not match")


def _verify_workspace_parameters(
    manifest: ExperimentManifest, design: DesignSpec, workspace: Path
) -> None:
    parameters = _workspace_json(workspace, "home/parameters.json")
    dreamplace = _workspace_json(workspace, "config/dreamplace_ecc.json")
    cts = _workspace_json(workspace, "config/cts_ecc.json")
    floorplan = _workspace_json(workspace, "config/floorplan_ecc.json")
    baseline = manifest.baseline
    site_width = _site_width_dbu_from_pdk(manifest.pdk_root)
    expected_parameters = {
        "Design": design.design_id,
        "Top module": design.top_module,
        "Clock": design.clock_name,
        "Frequency max [MHz]": baseline["frequency_mhz"],
    }
    expected_dreamplace = {
        "target_density": baseline["target_density"],
        "stop_overflow": baseline["target_overflow"],
        "cell_padding_x": baseline["cell_padding_sites"] * site_width,
        "routability_opt_flag": int(bool(baseline["routability_opt"])),
        "density_weight": baseline["density_weight"],
    }
    die_util = floorplan.get("die_builder", {}).get("die_util", {})
    if (
        any(parameters.get(key) != value for key, value in expected_parameters.items())
        or Path(str(parameters.get("PDK Root"))).resolve() != manifest.pdk_root
        or any(dreamplace.get(key) != value for key, value in expected_dreamplace.items())
        or cts.get("max_fanout") != baseline["max_fanout"]
        or die_util.get("utilization") != baseline["core_utilization"]
        or die_util.get("aspect_ratio") != baseline["core_aspect_ratio"]
    ):
        raise ValueError("Phase 8 workspace parameters do not match")


def _workspace_json(workspace: Path, relative: str) -> dict[str, object]:
    try:
        payload = json.loads(
            _workspace_file(workspace, Path(relative)).read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Phase 8 workspace parameters are invalid") from exc
    if not isinstance(payload, dict):
        raise ValueError("Phase 8 workspace parameters are invalid")
    return payload


def _workspace_file(workspace: Path, relative: Path) -> Path:
    candidate = workspace / relative
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(workspace.resolve())
    except (OSError, ValueError) as exc:
        raise ValueError("Phase 8 workspace evidence is unavailable") from exc
    if candidate.is_symlink() or not resolved.is_file():
        raise ValueError("Phase 8 workspace evidence is unavailable")
    return resolved


def _workspace_request(
    manifest: ExperimentManifest, design: DesignSpec, workspace: Path
) -> dict[str, object]:
    baseline = manifest.baseline
    site_width = _site_width_dbu_from_pdk(manifest.pdk_root)
    return {
        "directory": str(workspace),
        "filelist": str(design.filelist),
        "flowConfig": {
            "start_step": "Synthesis",
            "end_step": "Harden",
            "steps": list(GUI_WORKSPACE_FLOW_STEPS),
        },
        "originDef": "",
        "originVerilog": "",
        "parameters": {
            "Clock": design.clock_name,
            "Design": design.design_id,
            "Top module": design.top_module,
            "Frequency max [MHz]": baseline["frequency_mhz"],
            "Max fanout": baseline["max_fanout"],
            "Target density": baseline["target_density"],
            "Target overflow": baseline["target_overflow"],
            "Cell padding x": baseline["cell_padding_sites"] * site_width,
            "Routability opt flag": int(bool(baseline["routability_opt"])),
            "Density weight": baseline["density_weight"],
            "Core": {
                "Utilitization": baseline["core_utilization"],
                "Aspect ratio": baseline["core_aspect_ratio"],
            },
        },
        "pdk": manifest.pdk_name,
        "pdkJson": None,
        "pdkRoot": str(manifest.pdk_root),
        "rtlList": [str(path) for path in design.rtl_list],
        "sdc": str(design.sdc),
    }


def _calibrate(
    manifest: ExperimentManifest,
    design: DesignSpec,
    workspace: Path,
    canonical: TerminalObservation,
    output: Path,
    timeout: float,
) -> tuple[TerminalObservation, float]:
    output.mkdir(parents=True, exist_ok=True)
    observations = []
    runtimes = []
    for index in range(1, _DEFAULT_REPLAYS + 1):
        replay_root = output / f"default-replay-{index}"
        observation_path = replay_root / "terminal-observation.v1.json"
        runtime_path = replay_root / "runtime.v1.json"
        if observation_path.is_file() and runtime_path.is_file():
            observation = TerminalObservation.model_validate_json(
                observation_path.read_bytes()
            )
            runtime = json.loads(runtime_path.read_text(encoding="utf-8"))[
                "elapsed_seconds"
            ]
        else:
            observation, runtime = _run_default_replay(
                manifest,
                design,
                workspace,
                replay_root,
                timeout,
                index,
            )
        if not isinstance(runtime, (int, float)) or runtime <= 0:
            raise ValueError("Phase 8 default replay runtime is invalid")
        observations.append(observation)
        runtimes.append(float(runtime))
    return observations[0], statistics.median(runtimes)


def _run_default_replay(
    manifest: ExperimentManifest,
    design: DesignSpec,
    workspace: Path,
    output: Path,
    timeout: float,
    index: int,
) -> tuple[TerminalObservation, float]:
    output.mkdir(parents=True, exist_ok=True)
    replay_workspace = output / "workspace"
    if not replay_workspace.exists():
        shutil.copytree(
            workspace,
            replay_workspace,
            ignore=shutil.ignore_patterns(".agent"),
        )
    _verify_workspace_inputs(manifest, design, replay_workspace)
    terminal_path = output / "flow-terminal-result.v1.json"
    terminal = (
        json.loads(terminal_path.read_text(encoding="utf-8"))
        if terminal_path.is_file()
        else None
    )
    started = time.monotonic()
    if not isinstance(terminal, dict) or terminal.get("state") != "succeeded":
        client = EccContentLengthRpcClient(
            _ecc_executable(), response_timeout_seconds=30
        )
        request = {
            "workspaceId": client.open_workspace(replay_workspace),
            "rerun": True,
            "origin": "gui",
            "idempotencyKey": f"phase8.{design.design_id}.default-replay-{index}",
        }
        _write_json(output / "flow-start-request.v1.json", request)
        try:
            operation = _setup_request(client, "operation.start_flow", request, 30.0)
            terminal = _wait_operation(client, operation, timeout)
        finally:
            client.close()
        _write_json(terminal_path, terminal)
    if terminal.get("state") != "succeeded":
        raise ValueError("Phase 8 default replay failed")
    _verify_workspace_inputs(manifest, design, replay_workspace)
    observation = _terminal_observation(replay_workspace)
    runtime = _optimization_rerun_runtime_seconds(replay_workspace)
    _write_json(output / "terminal-observation.v1.json", observation.model_dump(mode="json"))
    _write_json(
        output / "runtime.v1.json",
        {
            "elapsed_seconds": runtime,
            "wall_elapsed_seconds": time.monotonic() - started,
        },
    )
    return observation, runtime


def _setup_request(
    client: EccContentLengthRpcClient,
    method: str,
    params: dict[str, object],
    timeout: float,
) -> dict[str, object]:
    if method not in _SETUP_METHODS:
        raise ValueError("Phase 8 setup RPC method is not allowed")
    return client._request(method, params, timeout_seconds=timeout)


def _wait_operation(
    client: EccContentLengthRpcClient,
    operation: dict[str, object],
    timeout: float,
) -> dict[str, object]:
    if operation.get("state") in _TERMINAL_STATES:
        return operation
    operation_id = operation.get("operationId")
    if not isinstance(operation_id, str) or not _ID.fullmatch(operation_id):
        raise ValueError("Phase 8 operation id is invalid")
    terminal = client.wait_for_terminal(operation_id, timeout)
    if terminal is None:
        raise ValueError("Phase 8 operation timed out")
    return terminal


def _site_width_dbu_from_pdk(pdk_root: Path) -> int:
    text = (pdk_root / "prtech/techLEF/N551P6M_ecos.lef").read_text(
        encoding="utf-8"
    )
    units = re.search(r"DATABASE\s+MICRONS\s+(\d+)", text, re.IGNORECASE)
    site = re.search(
        r"SITE\s+(?:core7|CoreSite)\b(?P<body>.*?)END\s+(?:core7|CoreSite)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    size = re.search(
        r"SIZE\s+([0-9]+(?:\.[0-9]+)?)\s+BY",
        site.group("body") if site else "",
        re.IGNORECASE,
    )
    if not units or not size:
        raise ValueError("Phase 8 PDK site width is unavailable")
    return round(int(units.group(1)) * float(size.group(1)))


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
