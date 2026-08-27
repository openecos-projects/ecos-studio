"""Run the frozen ten-design requested-only/receipt-aware experiment."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
import statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import NamedTuple

from ecos_agent.codex_provider import CodexAppServerProposalProvider
from ecos_agent.contracts import GUI_WORKSPACE_FLOW_STEPS
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import (
    ObjectiveMetric,
    OptimizationEpisodeState,
    OptimizationKnob,
    OptimizationObjectiveProposal,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization_ecc_adapter import EccContentLengthRpcClient
from ecos_agent.optimization_equal_budget import (
    Mode,
    export_episode_traces,
    validate_design_manifest,
)
from ecos_agent.optimization_gate0 import run_pilot_candidate
from ecos_agent.optimization_observations import build_terminal_observation
from ecos_agent.optimization_rules import freeze_optimization_objective
from ecos_agent.optimization_runtime import (
    _current_values,
    _ecc_executable,
    _site_width_dbu,
    create_optimization_runner,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SETUP_METHODS = frozenset({"workspace.create", "operation.start_flow"})
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
_CANDIDATES_PER_DESIGN = 2
_PLANNING_CALLS_PER_DESIGN = 6
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


def run_experiment(
    manifest: ExperimentManifest,
    manifest_path: Path,
    output: Path,
    workspace_root: Path,
    *,
    run_id: str,
    model: str,
    seed: int,
    tool_revision: str,
    max_workers: int,
    terminal_timeout_seconds: float,
) -> dict[str, object]:
    if not _ID.fullmatch(run_id) or type(seed) is not int or max_workers <= 0:
        raise ValueError("Phase 8 run arguments are invalid")
    output = Path(output).resolve()
    workspace_root = Path(workspace_root).resolve()
    output.mkdir(parents=True, exist_ok=True)
    workspace_root.mkdir(parents=True, exist_ok=True)
    run_root = output / "runs" / run_id
    run_root.mkdir(parents=True, exist_ok=True)

    def run_design(design: DesignSpec):
        workspace = workspace_root / design.design_id
        canonical = _ensure_workspace(
            manifest, design, workspace, terminal_timeout_seconds
        )
        reference, reference_runtime = _calibrate(
            manifest,
            design,
            workspace,
            canonical,
            run_root / design.design_id / "calibration",
            terminal_timeout_seconds,
        )
        modes = {
            mode: _run_mode(
                design,
                workspace,
                reference,
                reference_runtime,
                run_root / design.design_id / mode,
                run_id=run_id,
                model=model,
                seed=seed,
                mode=mode,
            )
            for mode in ("requested-only", "receipt-aware")
        }
        return design.design_id, reference_runtime, modes

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = tuple(executor.map(run_design, manifest.designs))
    runtimes = {design_id: runtime for design_id, runtime, _ in results}
    traces = {
        mode: tuple(
            trace
            for _, _, modes in results
            for trace in modes[mode]["traces"]
        )
        for mode in ("requested-only", "receipt-aware")
    }
    planning_calls = {
        mode: sum(modes[mode]["planning_calls"] for _, _, modes in results)
        for mode in traces
    }
    inputs = {}
    for mode, rows in traces.items():
        path = run_root / f"{mode}-input.jsonl"
        path.write_text(
            "".join(json.dumps(item.__dict__, sort_keys=True) + "\n" for item in rows),
            encoding="utf-8",
        )
        inputs[mode] = path
    harness = _load_harness()
    report = harness.run(
        Path(manifest_path),
        output,
        inputs["requested-only"],
        inputs["receipt-aware"],
        planning_calls["requested-only"],
        planning_calls["receipt-aware"],
        reference_runtime_seconds_by_design=runtimes,
        seed=seed,
        tool_revision=tool_revision,
        input_manifest_sha256=manifest.manifest_sha256,
    )
    _write_json(
        run_root / "run-manifest.v1.json",
        {
            "schema_version": "ecos.phase8_execution_run.v1",
            "run_id": run_id,
            "model": model,
            "seed": seed,
            "tool_revision": tool_revision,
            "input_manifest_sha256": manifest.manifest_sha256,
            "reference_runtime_seconds_by_design": runtimes,
            "planning_calls": planning_calls,
            "trace_sha256": {mode: file_sha256(path) for mode, path in inputs.items()},
            "harness_status": report["status"],
        },
    )
    return report


def _ensure_workspace(
    manifest: ExperimentManifest,
    design: DesignSpec,
    workspace: Path,
    timeout: float,
) -> TerminalObservation:
    if (workspace / "home/flow.json").is_file():
        _verify_workspace_binding(manifest, design, workspace)
        terminal = build_terminal_observation(workspace)
        if terminal.schema_version != "ecos.terminal_observation.v3":
            raise ValueError("Phase 8 workspace terminal evidence is not v3")
        return terminal
    if workspace.exists():
        raise ValueError("incomplete Phase 8 workspace already exists")
    client = EccContentLengthRpcClient(_ecc_executable(), response_timeout_seconds=30)
    try:
        request = _workspace_request(manifest, design, workspace)
        created = _setup_request(client, "workspace.create", request, 120.0)
        workspace_id = created.get("workspaceId")
        if not isinstance(workspace_id, str) or not _ID.fullmatch(workspace_id):
            raise ValueError("Phase 8 workspace id is invalid")
        operation = _setup_request(
            client,
            "operation.start_flow",
            {
                "workspaceId": workspace_id,
                "rerun": False,
                "origin": "gui",
                "idempotencyKey": f"phase8.{design.design_id}.canonical",
            },
            30.0,
        )
        terminal = _wait_operation(client, operation, timeout)
        if terminal.get("state") != "succeeded":
            raise ValueError("Phase 8 canonical flow failed")
    finally:
        client.close()
    _verify_workspace_binding(manifest, design, workspace)
    return build_terminal_observation(workspace)


def _verify_workspace_binding(
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
    _verify_workspace_parameters(manifest, design, workspace)


def _verify_workspace_parameters(
    manifest: ExperimentManifest, design: DesignSpec, workspace: Path
) -> None:
    parameters = _workspace_json(workspace, "home/parameters.json")
    dreamplace = _workspace_json(workspace, "config/dreamplace_ecc.json")
    fixfanout = _workspace_json(workspace, "config/fixfanout_ecc.json")
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
        or fixfanout.get("max_fanout") != baseline["max_fanout"]
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
    site_width = _site_width_dbu(workspace)
    target_density = _current_values(workspace, site_width)[
        OptimizationKnob.TARGET_DENSITY.value
    ]
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
            client = EccContentLengthRpcClient(
                _ecc_executable(), response_timeout_seconds=30
            )
            try:
                workspace_id = client.open_workspace(workspace)
                result = run_pilot_candidate(
                    client,
                    workspace_id,
                    workspace,
                    site_width,
                    canonical,
                    RequestedKnobValue(
                        knob_id=OptimizationKnob.TARGET_DENSITY,
                        value=target_density,
                    ),
                    StrategyDirection.INCREASE,
                    f"default-replay-{index}",
                    replay_root,
                    manifest.manifest_sha256,
                    timeout,
                    episode_id=f"phase8-{design.design_id}-calibration",
                    rationale_summary="Measure one frozen default replay runtime.",
                )
            finally:
                client.close()
            observation = result.observation
            runtime = json.loads(runtime_path.read_text(encoding="utf-8"))[
                "elapsed_seconds"
            ]
        if not isinstance(runtime, (int, float)) or runtime <= 0:
            raise ValueError("Phase 8 default replay runtime is invalid")
        observations.append(observation)
        runtimes.append(float(runtime))
    return observations[0], statistics.median(runtimes)


def _run_mode(
    design: DesignSpec,
    workspace: Path,
    reference: TerminalObservation,
    reference_runtime: float,
    output: Path,
    *,
    run_id: str,
    model: str,
    seed: int,
    mode: Mode,
) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=True)
    episode_id = f"phase8-{run_id}-{design.design_id}-{mode}"
    env = dict(os.environ)
    env["ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2"] = "1"
    provider = CodexAppServerProposalProvider(
        cwd=workspace,
        env=env,
        runtime_workspace_roots=(workspace,),
        diagnostics_path=output / "codex-diagnostics.jsonl",
        ephemeral=True,
    )
    provider.select_model(model)
    runner = create_optimization_runner(
        {
            "workspace": str(workspace),
            "episode_id": episode_id,
            "objective": _objective().model_dump(mode="json"),
            "seed": seed,
            "reference_runtime_seconds": reference_runtime,
            "receipt_aware_planning": mode == "receipt-aware",
        },
        provider,
    )
    try:
        while (
            runner.budget.consumed_candidates < _CANDIDATES_PER_DESIGN
            and runner.budget.consumed_planning_calls < _PLANNING_CALLS_PER_DESIGN
            and runner.state
            in {OptimizationEpisodeState.CREATED, OptimizationEpisodeState.PLANNING}
        ):
            runner.run_turn()
    finally:
        runner.close()
        provider.close()
    episode_root = workspace / ".agent" / "optimization" / episode_id
    traces, planning_calls, observed_mode = export_episode_traces(
        workspace=workspace,
        episode_root=episode_root,
        design_id=design.design_id,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
    )
    if observed_mode != mode:
        raise ValueError("Phase 8 episode planning mode changed")
    _write_json(
        output / "summary.v1.json",
        {
            "schema_version": "ecos.phase8_design_mode.v1",
            "design_id": design.design_id,
            "mode": mode,
            "episode_id": episode_id,
            "planning_calls": planning_calls,
            "started_candidates": sum(item.started for item in traces),
            "trace_sha256": canonical_sha256([item.__dict__ for item in traces]),
        },
    )
    return {"traces": traces, "planning_calls": planning_calls}


def _objective():
    return freeze_optimization_objective(
        "Minimize routed wirelength while preserving DRC and global-routing overflow.",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            ),
            rationale_summary="Use the frozen lexicographic routing objective.",
        ),
    )


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


def _load_harness():
    path = Path(__file__).with_name("run_equal_budget_harness.py")
    spec = importlib.util.spec_from_file_location("phase8_harness", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Phase 8 harness is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--design-manifest", type=Path, required=True)
    parser.add_argument("--benchmark-root", type=Path, required=True)
    parser.add_argument("--pdk-root", type=Path, required=True)
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--seed", type=int, default=20260827)
    parser.add_argument("--tool-revision", required=True)
    parser.add_argument("--max-workers", type=int, default=2)
    parser.add_argument("--terminal-timeout-seconds", type=float, default=900.0)
    args = parser.parse_args()
    manifest = load_experiment_manifest(
        args.design_manifest, args.benchmark_root, args.pdk_root
    )
    run_experiment(
        manifest,
        args.design_manifest,
        args.output,
        args.workspace_root,
        run_id=args.run_id,
        model=args.model,
        seed=args.seed,
        tool_revision=args.tool_revision,
        max_workers=args.max_workers,
        terminal_timeout_seconds=args.terminal_timeout_seconds,
    )


if __name__ == "__main__":
    main()
