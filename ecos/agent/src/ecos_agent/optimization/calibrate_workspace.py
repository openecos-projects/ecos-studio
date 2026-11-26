"""Calibrate the per-metric replay noise epsilon for one existing workspace.

Full-agent optimization episodes gate trend predicates on a calibrated
per-metric noise epsilon (``noise-epsilon.v1.json``). This tool produces that
artifact for a completed GUI workspace: it replays the default-parameter flow
two or more times in isolated copies of the workspace, then freezes the
cross-replay noise profile into ``<workspace>/.agent/optimization/
noise-epsilon.v1.json`` where the episode runtime loads it.

Replays inherit the workspace's current parameters. Each replay saves a terminal
observation and fingerprint before releasing its Workspace. Coverage analysis
also retains the first planning context for designs in the state-rule scope. Matching observations
are reused, and a parser change triggers a fresh replay once the raw artifacts
have been removed. Calibration rejects caches produced by different flow inputs.
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import time
from uuid import uuid4
from collections.abc import Callable
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.controller_helpers import _write_json_atomic
from ecos_agent.optimization.host_transport import _require_host_transport
from ecos_agent.optimization.observation_contracts import (
    TerminalObservation,
    deterministic_noise_profile,
)
from ecos_agent.optimization.observations import build_terminal_observation
from ecos_agent.optimization.runtime import (
    OptimizationRuntimeError,
    WorkspaceParametersError,
    _design_id,
    _runtime_parameters,
)
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    _workspace_flow_succeeded,
)

_TERMINAL_STATES = frozenset(
    {"succeeded", "failed", "cancelled", "interrupted", "unknown"}
)
_MIN_REPLAYS = 2
_PROGRESS_INTERVAL_SECONDS = 30.0
_CACHE_MANIFEST_SCHEMA = "ecos.replay_cache_manifest.v1"
_REPLAY_INPUT_KEYS = ("ecc_revision", "origin_sha256", "parameters_sha256", "pdk_sha256")
_LOGGER = logging.getLogger(__name__)


def write_noise_epsilon_artifact(
    observations: tuple[TerminalObservation, ...],
    artifact_path: Path,
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    profile = deterministic_noise_profile(observations)
    payload = {
        "schema_version": "ecos.noise_epsilon.v1",
        "comparison_key": "(metric_id, corner)",
        "replay_count": len(observations),
        "reference": profile["reference"],
        "epsilon": dict(profile["epsilon"]),
    }
    if metadata:
        payload.update(metadata)
    artifact_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return payload


def _terminal_observation(workspace: Path) -> TerminalObservation:
    observation = build_terminal_observation(workspace)
    if observation.schema_version != "ecos.terminal_observation.v3":
        raise OptimizationRuntimeError(
            "workspace terminal evidence is not v3; rerun the flow before calibrating"
        )
    return observation


def _scoped_progress(
    progress: Callable[[str], None], index: int, replays: int
) -> Callable[[str], None]:
    prefix = f"noise calibration replay {index}/{replays}: "
    return lambda message: progress(prefix + message)


def _heartbeat_emitter(
    progress: Callable[[str], None]
) -> Callable[[dict[str, object] | None], None]:
    started = time.monotonic()
    last_report = [0.0]

    def heartbeat(status: dict[str, object] | None) -> None:
        now = time.monotonic()
        if now - last_report[0] < _PROGRESS_INTERVAL_SECONDS:
            return
        last_report[0] = now
        elapsed = int(now - started)
        state = status.get("state") if isinstance(status, dict) else None
        suffix = f", ECC state: {state}" if isinstance(state, str) else ""
        progress(f"flow running, elapsed {elapsed // 60}m{elapsed % 60:02d}s{suffix}")

    return heartbeat


def _parser_sha256() -> str:
    # Lazy module lookup: importing these eagerly would reorder the package's
    # circular-prone initialization (contracts <-> observation_contracts).
    module_files = (
        Path(importlib.import_module("ecos_agent.optimization.observation_contracts").__file__),
        Path(importlib.import_module("ecos_agent.optimization.observations").__file__),
    )
    return canonical_sha256({"files": [file_sha256(path) for path in module_files]})


def _tree_sha256(root: Path) -> str:
    return canonical_sha256(
        {
            str(path.relative_to(root)): file_sha256(path)
            for path in sorted(root.rglob("*"))
            if path.is_file()
        }
    )


def _host_call(method: str, params: dict[str, object]) -> dict[str, object]:
    host = _require_host_transport()
    if callable(host) and not hasattr(host, "call"):
        result = host(method, params)
    else:
        invoke = getattr(host, "call", None)
        if not callable(invoke):
            raise OptimizationRuntimeError("host Product Command caller is invalid")
        result = invoke(method, params)
    if not isinstance(result, dict):
        raise OptimizationRuntimeError("host Product Command result is invalid")
    return result


def _environment_fingerprint(workspace: Path) -> dict[str, str]:
    """Identify every input that decides cached-replay reusability.

    The ECC handshake is cheap (one ``rpc.hello``) and runs even on the
    full-cache path so that a drifted toolchain is never silently accepted.
    """
    revision = _host_call("rpc.hello", {"version": 1}).get("eccVersion")
    if not isinstance(revision, str) or not revision.strip():
        raise OptimizationRuntimeError("ECC revision is invalid")
    ecc_revision = revision.strip()
    try:
        parameters_ref, parameters = _runtime_parameters(workspace)
        pdk_root = Path(parameters["pdk_root"])
        pdk_sha256 = file_sha256(pdk_root / "prtech" / "techLEF" / "N551P6M_ecos.lef")
    except (KeyError, OSError, TypeError, ValueError, WorkspaceParametersError) as exc:
        raise OptimizationRuntimeError(
            "workspace parameters or PDK evidence are unavailable for replay cache validation"
        ) from exc
    return {
        "ecc_revision": ecc_revision,
        "origin_sha256": _tree_sha256(workspace / "origin"),
        "parameters_sha256": file_sha256(workspace / parameters_ref),
        "pdk_sha256": pdk_sha256,
        "parser_sha256": _parser_sha256(),
    }


def _load_replay_manifest(replay_root: Path) -> dict[str, object] | None:
    try:
        payload = json.loads(
            (replay_root / "replay-cache-manifest.v1.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return None
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != _CACHE_MANIFEST_SCHEMA
        or not isinstance(payload.get("components"), dict)
    ):
        return None
    return payload


def _store_replay_cache(
    replay_root: Path,
    observation: TerminalObservation,
    fingerprint: dict[str, str],
    provenance: str,
    workspace: Path | None = None,
) -> None:
    replay_root.mkdir(parents=True, exist_ok=True)
    (replay_root / "terminal-observation.v1.json").write_text(
        observation.model_dump_json(), encoding="utf-8"
    )
    (replay_root / "replay-cache-manifest.v1.json").write_text(
        json.dumps(
            {
                "schema_version": _CACHE_MANIFEST_SCHEMA,
                "provenance": provenance,
                "components": dict(fingerprint),
                **({"workspace": str(workspace)} if workspace is not None else {}),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _require_same_inputs(
    manifest: dict[str, object], fingerprint: dict[str, str], index: int
) -> None:
    components = manifest["components"]
    drifted = [
        key for key in _REPLAY_INPUT_KEYS if components.get(key) != fingerprint[key]
    ]
    if drifted:
        raise OptimizationRuntimeError(
            f"default replay {index} was produced by different inputs "
            f"({', '.join(drifted)}); re-run the flow screen for this workspace "
            "and calibrate again"
        )


def _store_opportunity_context(
    replay_root: Path, workspace: Path, index: int, ecc_revision: str
) -> None:
    from ecos_agent.optimization.experiments.frozen_contexts import OPPORTUNITY_CONTEXT_FILE
    from ecos_agent.optimization.experiments.knowledge_pilot import build_context_bank
    from ecos_agent.optimization.knowledge.compiler import load_state_rule_manifest

    design_id = _design_id(workspace)
    if design_id not in load_state_rule_manifest().scope:
        return
    context = build_context_bank(
        workspace=workspace,
        design_id=design_id,
        episode_id=f"opportunity-{design_id}-r{index}",
        ecc_revision=ecc_revision,
        # An initial planning turn has no history to compare for trends.
        trend_noise_epsilon={},
    )[0]
    replay_root.mkdir(parents=True, exist_ok=True)
    _write_json_atomic(replay_root / OPPORTUNITY_CONTEXT_FILE, context)


def _can_adopt_replay(workspace: Path) -> bool:
    if not workspace.is_dir():
        return False
    try:
        return _workspace_flow_succeeded(workspace)
    except ValueError:
        # Pre-manifest caches may contain an older flow ledger or an incomplete write.
        return False


def _run_replay(
    workspace: Path,
    replay_root: Path,
    index: int,
    timeout_seconds: float,
    fingerprint: dict[str, str],
    progress: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> TerminalObservation:
    observation_path = replay_root / "terminal-observation.v1.json"
    manifest = _load_replay_manifest(replay_root)
    replay_workspace = replay_root / "workspace"
    if observation_path.is_file() and manifest is not None:
        managed = isinstance(manifest.get("workspace"), str)
        if managed:
            replay_workspace = Path(manifest["workspace"])
        _require_same_inputs(manifest, fingerprint, index)
        if manifest["components"].get("parser_sha256") == fingerprint["parser_sha256"]:
            observation = TerminalObservation.model_validate_json(observation_path.read_bytes())
            if managed and replay_workspace.is_dir():
                _release_replay(workspace, _replay_key(workspace, fingerprint, index))
            return observation
        if replay_workspace.is_dir():
            observation = _terminal_observation(replay_workspace)
            _store_replay_cache(
                replay_root, observation, fingerprint, "reparsed",
                replay_workspace if managed else None,
            )
            if managed:
                _release_replay(workspace, _replay_key(workspace, fingerprint, index))
            if progress is not None:
                progress("observation code changed; re-parsed the cached flow artifacts")
            return observation
    if _can_adopt_replay(replay_workspace):
        # Pre-manifest cache from an earlier calibration: adopt the finished
        # flow artifacts, recording that their toolchain provenance is unverified.
        observation = _terminal_observation(replay_workspace)
        _store_replay_cache(replay_root, observation, fingerprint, "adopted")
        if progress is not None:
            progress("re-parsed the finished flow artifacts and adopted the replay cache")
        return observation
    source_handle = _open_source(workspace)
    replay_key = _replay_key(workspace, fingerprint, index)
    try:
        opened = _host_call(
            "workspace.deriveCalibrationReplay",
            {"workspaceHandle": source_handle, "replayKey": replay_key},
        )
        directory = _execute_replay(opened, index, timeout_seconds, progress, should_stop)
        observation = _terminal_observation(directory)
        _store_opportunity_context(replay_root, directory, index, fingerprint["ecc_revision"])
        _store_replay_cache(replay_root, observation, fingerprint, "produced", directory)
        return observation
    finally:
        _release_replay(workspace, replay_key, source_handle)


def _replay_key(workspace: Path, fingerprint: dict[str, str], index: int) -> str:
    return canonical_sha256(
        {
            "workspace": str(workspace),
            "inputs": {key: fingerprint[key] for key in _REPLAY_INPUT_KEYS if key in fingerprint},
            "replay": index,
        }
    ).removeprefix("sha256:")


def _open_source(workspace: Path) -> str:
    source = _host_call("workspace.open", {"directory": str(workspace)})
    source_handle = source.get("workspaceHandle")
    if not isinstance(source_handle, str) or not source_handle:
        raise OptimizationRuntimeError("calibration source handle is missing")
    return source_handle


def _release_replay(workspace: Path, replay_key: str, source_handle: str | None = None) -> None:
    try:
        _host_call(
            "workspace.releaseCalibrationReplay",
            {"workspaceHandle": source_handle or _open_source(workspace), "replayKey": replay_key},
        )
    except Exception as exc:
        _LOGGER.warning("Could not clean up calibration replay %s: %s", replay_key, exc)


def _execute_replay(
    opened: dict[str, object],
    index: int,
    timeout_seconds: float,
    progress: Callable[[str], None] | None,
    should_stop: Callable[[], bool] | None,
) -> Path:
    workspace_handle = opened.get("workspaceHandle")
    revision = opened.get("workspaceRevision")
    if not isinstance(workspace_handle, str) or not workspace_handle.strip():
        raise OptimizationRuntimeError("calibration workspace handle is missing")
    directory = opened.get("directory")
    if type(revision) is not int or revision < 1 or not isinstance(directory, str):
        raise OptimizationRuntimeError("calibration workspace identity is missing")
    if should_stop is not None and should_stop():
        raise OptimizationRuntimeError("noise calibration cancelled")
    operation = _host_call(
        "workspace.run",
        {
            "workspaceHandle": workspace_handle.strip(),
            "expectedWorkspaceRevision": revision,
            "rerun": True,
            "idempotencyKey": f"noise-calibration.default-replay-{index}.{uuid4().hex}",
        },
    )
    if progress is not None:
        progress("flow rerun started")
    if operation.get("state") not in _TERMINAL_STATES:
        operation_id = operation.get("operationId")
        if not isinstance(operation_id, str) or not operation_id:
            raise OptimizationRuntimeError(
                "ECC start_flow response has no operation id"
            )
        heartbeat = _heartbeat_emitter(progress) if progress is not None else None
        deadline = time.monotonic() + timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            stopped = should_stop is not None and should_stop()
            if stopped or remaining <= 0:
                _host_call(
                    "operation.cancel",
                    {"workspaceHandle": workspace_handle, "operationId": operation_id},
                )
                if stopped:
                    raise OptimizationRuntimeError("noise calibration cancelled")
                raise OptimizationRuntimeError(
                    f"default replay {index} timed out after {timeout_seconds}s"
                )
            status = _host_call(
                "operation.wait",
                {
                    "workspaceHandle": workspace_handle.strip(),
                    "operationId": operation_id,
                    "timeoutMs": min(1000, max(1, remaining * 1000)),
                },
            )
            if status.get("state") in _TERMINAL_STATES:
                terminal = status
                break
            if heartbeat is not None:
                heartbeat(status)
    else:
        terminal = operation
    if terminal.get("state") != "succeeded":
        raise OptimizationRuntimeError(
            f"default replay {index} failed: {terminal.get('state')}"
        )
    return Path(directory)


def calibrate(
    workspace: Path,
    replays: int = 3,
    timeout_seconds: float = 1800.0,
    *,
    should_stop: Callable[[], bool] | None = None,
    progress: Callable[[str], None] | None = None,
    replay_progress: Callable[[int, int, str], None] | None = None,
) -> dict[str, object]:
    workspace = workspace.resolve()
    if not workspace.is_dir():
        raise SystemExit(f"workspace is unavailable: {workspace}")
    if replays < _MIN_REPLAYS:
        raise SystemExit(
            f"noise calibration needs at least {_MIN_REPLAYS} replays"
        )
    optimization_root = workspace / ".agent" / "optimization"
    calibration_dir = optimization_root / "noise-calibration"
    calibration_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = _environment_fingerprint(workspace)
    observations: list[TerminalObservation] = []
    provenances: dict[str, str] = {}
    for index in range(1, replays + 1):
        if should_stop is not None and should_stop():
            raise OptimizationRuntimeError("noise calibration cancelled")
        scoped = (
            _scoped_progress(progress, index, replays)
            if progress is not None
            else None
        )
        if progress is not None:
            progress(
                f"preparing replay {index}/{replays}: deriving a workspace and "
                "rerunning the default-parameter flow"
            )
        if replay_progress is not None:
            replay_progress(index - 1, replays, "running")
        observations.append(
            _run_replay(
                workspace,
                calibration_dir / f"default-replay-{index}",
                index,
                timeout_seconds,
                fingerprint,
                progress=scoped,
                should_stop=should_stop,
            )
        )
        manifest = _load_replay_manifest(calibration_dir / f"default-replay-{index}")
        provenances[str(index)] = (
            str(manifest["provenance"]) if manifest is not None else "unknown"
        )
        if progress is not None:
            progress(f"replay {index}/{replays} finished")
        if replay_progress is not None:
            replay_progress(index, replays, "completed")
    payload = write_noise_epsilon_artifact(
        tuple(observations),
        optimization_root / "noise-epsilon.v1.json",
        metadata={
            "calibration_fingerprint": dict(fingerprint),
            "replay_provenance": provenances,
        },
    )
    return {
        "artifact": str(optimization_root / "noise-epsilon.v1.json"),
        "replay_count": payload["replay_count"],
        "metric_key_count": len(payload["epsilon"]),
        "epsilon": payload["epsilon"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument(
        "--replays",
        type=int,
        default=3,
        help="default-parameter flow replays used for the noise profile",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=1800.0,
        help="per-replay flow completion timeout",
    )
    args = parser.parse_args(argv)
    summary = calibrate(args.workspace, args.replays, args.timeout_seconds)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
