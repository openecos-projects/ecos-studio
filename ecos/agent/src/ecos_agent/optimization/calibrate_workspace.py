"""Calibrate the per-metric replay noise epsilon for one existing workspace.

Full-agent optimization episodes gate trend predicates on a calibrated
per-metric noise epsilon (``noise-epsilon.v1.json``). This tool produces that
artifact for a completed GUI workspace: it replays the default-parameter flow
two or more times in isolated copies of the workspace, then freezes the
cross-replay noise profile into ``<workspace>/.agent/optimization/
noise-epsilon.v1.json`` where the episode runtime loads it.

Replays inherit the workspace's current parameters; recalibrate whenever the
toolchain, PDK, or workspace inputs change.
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from collections.abc import Callable
from pathlib import Path

from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
from ecos_agent.optimization.observation_contracts import (
    TerminalObservation,
    deterministic_noise_profile,
)
from ecos_agent.optimization.observations import build_terminal_observation
from ecos_agent.optimization.runtime import OptimizationRuntimeError, _ecc_executable

_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
_MIN_REPLAYS = 2
_PROGRESS_INTERVAL_SECONDS = 30.0


def write_noise_epsilon_artifact(
    observations: tuple[TerminalObservation, ...], artifact_path: Path
) -> dict[str, object]:
    profile = deterministic_noise_profile(observations)
    payload = {
        "schema_version": "ecos.noise_epsilon.v1",
        "comparison_key": "(metric_id, corner)",
        "replay_count": len(observations),
        "reference": profile["reference"],
        "epsilon": dict(profile["epsilon"]),
    }
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


def _run_replay(
    workspace: Path,
    replay_root: Path,
    index: int,
    timeout_seconds: float,
    progress: Callable[[str], None] | None = None,
) -> TerminalObservation:
    observation_path = replay_root / "terminal-observation.v1.json"
    if observation_path.is_file():
        return TerminalObservation.model_validate_json(observation_path.read_bytes())
    replay_workspace = replay_root / "workspace"
    if not replay_workspace.exists():
        shutil.copytree(
            workspace, replay_workspace, ignore=shutil.ignore_patterns(".agent")
        )
    client = EccContentLengthRpcClient(_ecc_executable())
    request = {
        "workspaceId": client.open_workspace(replay_workspace),
        "rerun": True,
        "origin": "gui",
        "idempotencyKey": f"noise-calibration.default-replay-{index}",
    }
    try:
        operation = client._request(
            "operation.start_flow", request, timeout_seconds=30.0
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
            terminal = client.wait_for_terminal(
                operation_id, timeout_seconds, poll_callback=heartbeat
            )
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
    finally:
        client.close()
    observation = _terminal_observation(replay_workspace)
    observation_path.write_text(
        observation.model_dump_json(), encoding="utf-8"
    )
    return observation


def calibrate(
    workspace: Path,
    replays: int = 3,
    timeout_seconds: float = 1800.0,
    *,
    should_stop: Callable[[], bool] | None = None,
    progress: Callable[[str], None] | None = None,
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
    observations = []
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
        observations.append(
            _run_replay(
                workspace,
                calibration_dir / f"default-replay-{index}",
                index,
                timeout_seconds,
                progress=scoped,
            )
        )
        if progress is not None:
            progress(f"replay {index}/{replays} finished")
    payload = write_noise_epsilon_artifact(
        tuple(observations), optimization_root / "noise-epsilon.v1.json"
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
