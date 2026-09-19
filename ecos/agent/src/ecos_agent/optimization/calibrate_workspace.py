"""Calibrate the per-metric replay noise epsilon for one existing workspace.

Full-agent optimization episodes gate trend predicates on a calibrated
per-metric noise epsilon (``noise-epsilon.v1.json``). This tool produces that
artifact for a completed GUI workspace: it replays the default-parameter flow
two or more times in isolated copies of the workspace, then freezes the
cross-replay noise profile into ``<workspace>/.agent/optimization/
noise-epsilon.v1.json`` where the episode runtime loads it.

Replays inherit the workspace's current parameters. Each replay caches its ECC
flow artifacts behind a fingerprint manifest (ECC revision, PDK, workspace
inputs, observation-code hash): cached replays are reused unchanged while the
inputs match, re-parsed in place when only the observation code changed, and
calibration refuses to run when the toolchain or workspace inputs drifted.
"""

from __future__ import annotations

import argparse
import importlib
import json
import shutil
import time
from collections.abc import Callable
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.host_transport import _require_host_transport
from ecos_agent.optimization.observation_contracts import (
    TerminalObservation,
    deterministic_noise_profile,
)
from ecos_agent.optimization.observations import build_terminal_observation
from ecos_agent.optimization.runtime import (
    OptimizationRuntimeError,
    WorkspaceParametersError,
    _runtime_parameters,
)
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    _workspace_flow_succeeded,
)

_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
_MIN_REPLAYS = 2
_PROGRESS_INTERVAL_SECONDS = 30.0
_CACHE_MANIFEST_SCHEMA = "ecos.replay_cache_manifest.v1"
#: Fingerprint keys that gate the expensive ECC flow rerun and must fail
#: closed on drift. ``parser_sha256`` only gates cheap re-parsing.
_REPLAY_INPUT_KEYS = ("ecc_revision", "origin_sha256", "parameters_sha256", "pdk_sha256")


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
) -> None:
    (replay_root / "terminal-observation.v1.json").write_text(
        observation.model_dump_json(), encoding="utf-8"
    )
    (replay_root / "replay-cache-manifest.v1.json").write_text(
        json.dumps(
            {
                "schema_version": _CACHE_MANIFEST_SCHEMA,
                "provenance": provenance,
                "components": dict(fingerprint),
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


def _run_replay(
    workspace: Path,
    replay_root: Path,
    index: int,
    timeout_seconds: float,
    fingerprint: dict[str, str],
    progress: Callable[[str], None] | None = None,
) -> TerminalObservation:
    observation_path = replay_root / "terminal-observation.v1.json"
    manifest = _load_replay_manifest(replay_root)
    replay_workspace = replay_root / "workspace"
    if observation_path.is_file() and manifest is not None:
        _require_same_inputs(manifest, fingerprint, index)
        if manifest["components"].get("parser_sha256") == fingerprint["parser_sha256"]:
            return TerminalObservation.model_validate_json(observation_path.read_bytes())
        # Only the observation code moved: the cached ECC artifacts stay
        # authoritative, so re-parse them instead of paying for a flow rerun.
        observation = _terminal_observation(replay_workspace)
        _store_replay_cache(replay_root, observation, fingerprint, "reparsed")
        if progress is not None:
            progress("observation code changed; re-parsed the cached flow artifacts")
        return observation
    if replay_workspace.is_dir() and _workspace_flow_succeeded(replay_workspace):
        # Pre-manifest cache from an earlier calibration: adopt the finished
        # flow artifacts, recording that their toolchain provenance is unverified.
        observation = _terminal_observation(replay_workspace)
        _store_replay_cache(replay_root, observation, fingerprint, "adopted")
        if progress is not None:
            progress("re-parsed the finished flow artifacts and adopted the replay cache")
        return observation
    if not replay_workspace.exists():
        shutil.copytree(
            workspace, replay_workspace, ignore=shutil.ignore_patterns(".agent")
        )
    opened = _host_call("workspace.open", {"directory": str(replay_workspace)})
    workspace_handle = opened.get("workspaceHandle")
    revision = opened.get("workspaceRevision")
    if not isinstance(workspace_handle, str) or not workspace_handle.strip():
        raise OptimizationRuntimeError("calibration workspace handle is missing")
    if type(revision) is not int or revision < 1:
        revision = 1
    operation = _host_call(
        "workspace.run",
        {
            "workspaceHandle": workspace_handle.strip(),
            "expectedWorkspaceRevision": revision,
            "rerun": True,
            "idempotencyKey": f"noise-calibration.default-replay-{index}",
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
        started = time.monotonic()
        terminal = None
        while time.monotonic() - started < timeout_seconds:
            status = _host_call(
                "operation.wait",
                {
                    "workspaceHandle": workspace_handle.strip(),
                    "operationId": operation_id,
                },
            )
            if status.get("state") in _TERMINAL_STATES:
                terminal = status
                break
            if heartbeat is not None:
                heartbeat(status)
        if terminal is None:
            raise OptimizationRuntimeError(
                f"default replay {index} timed out after {timeout_seconds}s"
            )
    else:
        terminal = operation
    if terminal.get("state") != "succeeded":
        raise OptimizationRuntimeError(
            f"default replay {index} failed: {terminal.get('state')}"
        )
    observation = _terminal_observation(replay_workspace)
    _store_replay_cache(replay_root, observation, fingerprint, "produced")
    return observation


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
                f"preparing replay {index}/{replays}: copying the workspace and "
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
