"""Production assembly for one bounded optimization episode."""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Callable, Mapping

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BaselineReplay,
    BaselineReplayEvidence,
    BudgetSnapshot,
    EpisodeBudget,
    ObjectiveMetric,
    OptimizationObjectiveContract,
    TimingMetric,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
)
from ecos_agent.optimization_ecc_adapter import (
    EccCandidateRerunAdapter,
    EccContentLengthRpcClient,
)
from ecos_agent.optimization_ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
    _write_json_atomic,
    build_optimization_artifact_manifest,
)
from ecos_agent.optimization_observations import (
    build_candidate_terminal_observation,
    build_stage_observation,
    build_terminal_observation,
)
from ecos_agent.optimization_retrieval import (
    OptimizationKnowledgeRetriever,
    build_optimization_retrieval_request,
)
from ecos_agent.optimization_rules import freeze_routability_objective
from ecos_agent.optimization_runner import OptimizationEpisodeRunner


class OptimizationRuntimeError(ValueError):
    """The workspace cannot be assembled into a trusted production episode."""


_PLACE_TO_HARDEN_STAGES = (
    "place",
    "CTS",
    "legalization",
    "route",
    "drc",
    "lvs",
    "filler",
    "RCX",
    "sta",
    "Harden",
)


def create_optimization_runner(
    context: Mapping[str, Any], planner: object
) -> OptimizationEpisodeRunner:
    workspace = _workspace(context.get("workspace"))
    episode_id = _text(context.get("episode_id"), "episode_id")
    objective = _optimization_objective(context.get("objective"))
    checkpoint_id = "place"
    terminal_observation = build_terminal_observation(workspace)
    site_width_dbu = _site_width_dbu(workspace)
    current_values = _current_values(workspace, site_width_dbu)
    parent_manifest = _parent_manifest_sha256(workspace)
    progress_callback = context.get("progress_callback")
    cancel_requested = context.get("cancel_requested")
    if progress_callback is not None and not callable(progress_callback):
        raise OptimizationRuntimeError("optimization progress callback is invalid")
    if cancel_requested is not None and not callable(cancel_requested):
        raise OptimizationRuntimeError("optimization cancellation callback is invalid")
    ledger_root = workspace / ".agent" / "optimization" / episode_id
    rpc = EccContentLengthRpcClient(_ecc_executable())
    ledger = _ledger(ledger_root)
    try:
        workspace_id = rpc.open_workspace(workspace)
        executor = EccCandidateRerunAdapter(
            rpc,
            workspace_id=workspace_id,
            site_width_dbu=site_width_dbu,
        )
        baseline_path = workspace / ".agent" / "optimization" / "baseline-replays.v2.json"
        if baseline_path.is_file():
            baseline_replays = _load_baseline_replays(workspace, parent_manifest)
        else:
            baseline_replays = _prepare_baseline_replays(
                workspace,
                parent_manifest,
                episode_id,
                executor,
                float(current_values["place.target_density"]),
                progress_callback or (lambda _text: None),
                cancel_requested or (lambda: False),
            )
        budget = BudgetSnapshot(
            budget=EpisodeBudget.from_default_reruns(
                tuple(replay.runtime_seconds for replay in baseline_replays.replays)
            )
        )
        state_path = ledger_root / "optimization-episode-state.v5.json"
        legacy_state_paths = (
            ledger_root / "optimization-episode-state.v2.json",
            ledger_root / "optimization-episode-state.v3.json",
            ledger_root / "optimization-episode-state.v4.json",
        )
        if state_path.is_file():
            controller = OptimizationEpisodeController.recover(
                planner=planner,
                executor=executor,
                ledger=ledger,
                clock=_monotonic,
            )
            if controller.objective != objective:
                raise OptimizationRuntimeError(
                    "optimization objective does not match the recovered episode"
                )
        elif any(path.is_file() for path in legacy_state_paths):
            raise OptimizationRuntimeError(
                "pre-policy episode cannot be recovered; start a new optimization episode"
            )
        elif ledger.ledger_path.is_file() and ledger.ledger_path.stat().st_size:
            raise OptimizationRuntimeError("optimization episode state is missing")
        else:
            controller = OptimizationEpisodeController(
                episode_id=episode_id,
                checkpoint_id=checkpoint_id,
                mode=OptimizationAgentMode.FULL_AGENT,
                budget=budget,
                planner=planner,
                executor=executor,
                ledger=ledger,
                clock=_monotonic,
                incumbent=terminal_observation,
                parent_manifest_sha256=parent_manifest,
                objective=objective,
            )
    except Exception:
        rpc.close()
        raise

    retrieval = OptimizationKnowledgeRetriever()

    def observation_supplier(current_budget: BudgetSnapshot):
        return build_stage_observation(workspace, checkpoint_id, budget=current_budget)

    def retrieval_supplier(observation, previous: OptimizationOutcomeKind | None):
        request = build_optimization_retrieval_request(
            task_id=episode_id,
            observation=observation,
            previous_intervention_outcome=previous,
            primary_metric=objective.primary_metric,
            preserve_metrics=objective.preserve_metrics,
        )
        return retrieval.retrieve(request)

    def terminal_waiter(execution_id: str):
        remaining = controller.budget.remaining_wall_time_seconds
        if remaining <= 0:
            return executor.cancel(execution_id)
        receipt = executor.wait_for_terminal(
            execution_id,
            timeout_seconds=min(_terminal_timeout_seconds(), remaining),
        )
        if receipt.outcome is None:
            return executor.cancel(execution_id)
        return receipt

    def terminal_observation_supplier(_observation, receipt):
        if receipt.evidence is None:
            raise OptimizationRuntimeError("ECC terminal receipt has no candidate evidence")
        return build_candidate_terminal_observation(workspace, receipt.evidence)

    return OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=observation_supplier,
        retrieval_supplier=retrieval_supplier,
        current_values=current_values,
        terminal_waiter=terminal_waiter,
        terminal_observation_supplier=terminal_observation_supplier,
        objective=freeze_routability_objective(
            {
                metric: tuple(
                    replay.terminal_observation.metrics[metric]
                    for replay in baseline_replays.replays
                )
                for metric in ObjectiveMetric
            },
            default_timing_replays={
                metric: tuple(
                    replay.terminal_observation.timing_guardrail[metric]
                    for replay in baseline_replays.replays
                )
                for metric in TimingMetric
            },
        ),
    )


def _optimization_objective(value: object) -> OptimizationObjectiveContract:
    if value is None:
        raise OptimizationRuntimeError("optimization objective is missing")
    try:
        return OptimizationObjectiveContract.model_validate(value)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationRuntimeError("optimization objective is invalid") from exc


def _parent_manifest_sha256(workspace: Path) -> str:
    return build_optimization_artifact_manifest(
        workspace,
        (
            "home/flow.json",
            "home/parameters.json",
            "place_dreamplace/analysis/qor_metrics.json",
        ),
    ).manifest_sha256


def _prepare_baseline_replays(
    workspace: Path,
    parent_manifest_sha256: str,
    episode_id: str,
    executor: EccCandidateRerunAdapter,
    target_density: float,
    progress_callback: Callable[[str], None],
    cancel_requested: Callable[[], bool],
) -> BaselineReplayEvidence:
    replays: list[BaselineReplay] = []
    for replay_number in range(1, 4):
        if cancel_requested():
            raise OptimizationRuntimeError("baseline replay preparation was interrupted")
        progress_callback(f"Preparing baseline replay {replay_number}/3.")
        replays.append(
            _execute_baseline_replay(
                workspace,
                episode_id,
                replay_number,
                executor,
                target_density,
                cancel_requested,
            )
        )
        progress_callback(f"Baseline replay {replay_number}/3 completed.")
    if _parent_manifest_sha256(workspace) != parent_manifest_sha256:
        raise OptimizationRuntimeError("workspace changed during baseline replay preparation")
    payload = {
        "schema_version": "ecos.optimization_baseline_replays.v2",
        "parent_manifest_sha256": parent_manifest_sha256,
        "replays": [replay.model_dump(mode="json") for replay in replays],
    }
    payload["artifact_sha256"] = canonical_sha256(payload)
    try:
        evidence = BaselineReplayEvidence.model_validate(payload)
    except ValidationError as exc:
        raise OptimizationRuntimeError("baseline replay evidence is invalid") from exc
    _write_json_atomic(
        workspace / ".agent" / "optimization" / "baseline-replays.v2.json",
        evidence.model_dump(mode="json"),
    )
    return _load_baseline_replays(workspace, parent_manifest_sha256)


def _execute_baseline_replay(
    workspace: Path,
    episode_id: str,
    replay_number: int,
    executor: EccCandidateRerunAdapter,
    target_density: float,
    cancel_requested: Callable[[], bool],
) -> BaselineReplay:
    receipt = executor.start_baseline(episode_id, replay_number, target_density)
    receipt = _wait_for_baseline_terminal(executor, receipt, cancel_requested)
    if receipt.outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED or receipt.evidence is None:
        raise OptimizationRuntimeError(f"baseline replay {replay_number} failed")
    try:
        observation = build_candidate_terminal_observation(workspace, receipt.evidence)
        return BaselineReplay(
            replay_id=f"baseline-{replay_number}",
            candidate_root_ref=receipt.evidence.candidate_root_ref,
            candidate_manifest_ref=receipt.evidence.candidate_manifest_ref,
            candidate_manifest_sha256=receipt.evidence.candidate_manifest_sha256,
            runtime_seconds=_place_to_harden_runtime_seconds(
                workspace / receipt.evidence.candidate_root_ref
            ),
            terminal_observation=observation,
        )
    except (OSError, ValueError) as exc:
        raise OptimizationRuntimeError(
            f"baseline replay {replay_number} evidence is invalid"
        ) from exc


def _wait_for_baseline_terminal(
    executor: EccCandidateRerunAdapter,
    receipt: CandidateExecutionReceipt,
    cancel_requested: Callable[[], bool],
) -> CandidateExecutionReceipt:
    if not receipt.started:
        raise OptimizationRuntimeError("baseline replay did not start")
    if receipt.outcome is not None:
        return receipt
    deadline = _monotonic() + _terminal_timeout_seconds()
    while (remaining := deadline - _monotonic()) > 0:
        if cancel_requested():
            executor.cancel(receipt.execution_id)
            raise OptimizationRuntimeError("baseline replay preparation was interrupted")
        terminal = executor.wait_for_terminal(
            receipt.execution_id,
            timeout_seconds=min(5.0, remaining),
        )
        if terminal.outcome is not None:
            return terminal
    executor.cancel(receipt.execution_id)
    raise OptimizationRuntimeError("baseline replay timed out")


def _load_baseline_replays(
    workspace: Path, parent_manifest_sha256: str
) -> BaselineReplayEvidence:
    path = workspace / ".agent" / "optimization" / "baseline-replays.v2.json"
    if not path.is_file():
        raise OptimizationRuntimeError("baseline replay evidence is unavailable")
    try:
        evidence = BaselineReplayEvidence.model_validate_json(path.read_bytes())
    except (OSError, ValidationError) as exc:
        raise OptimizationRuntimeError("baseline replay evidence is invalid") from exc
    if evidence.parent_manifest_sha256 != parent_manifest_sha256:
        raise OptimizationRuntimeError("baseline replay evidence does not match the workspace")
    try:
        observed = tuple(
            build_candidate_terminal_observation(
                workspace,
                CandidateExecutionEvidence(
                    replay.candidate_root_ref,
                    replay.candidate_manifest_ref,
                    replay.candidate_manifest_sha256,
                ),
            )
            for replay in evidence.replays
        )
    except (OSError, ValueError) as exc:
        raise OptimizationRuntimeError("baseline replay candidate evidence is invalid") from exc
    if observed != tuple(replay.terminal_observation for replay in evidence.replays):
        raise OptimizationRuntimeError("baseline replay terminal evidence does not match candidates")
    return evidence


def _workspace(value: object) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise OptimizationRuntimeError("optimization workspace is missing")
    path = Path(value).expanduser()
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise OptimizationRuntimeError("optimization workspace is unavailable")
    return path.resolve()


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OptimizationRuntimeError(f"optimization {label} is missing")
    return value.strip()


def _place_to_harden_runtime_seconds(workspace: Path) -> float:
    try:
        payload = json.loads((workspace / "home" / "flow.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("place-to-Harden flow evidence is unavailable") from exc
    steps = payload.get("steps")
    if not isinstance(steps, list):
        raise OptimizationRuntimeError("place-to-Harden flow completion evidence is invalid")
    total = 0.0
    for stage in _PLACE_TO_HARDEN_STAGES:
        total += _successful_flow_stage_runtime_seconds(steps, stage)
    if total <= 0:
        raise OptimizationRuntimeError("place-to-Harden runtime evidence is invalid")
    return total


def _successful_flow_stage_runtime_seconds(steps: list[object], stage: str) -> float:
    matches = [item for item in steps if isinstance(item, dict) and item.get("name") == stage]
    if len(matches) != 1 or matches[0].get("state") != "Success":
        raise OptimizationRuntimeError("place-to-Harden flow completion evidence is invalid")
    runtime = matches[0].get("runtime")
    if not isinstance(runtime, str):
        raise OptimizationRuntimeError("place-to-Harden runtime evidence is invalid")
    match = re.fullmatch(r"(\d+):(\d+):(\d+)", runtime.strip())
    if match is None:
        raise OptimizationRuntimeError("place-to-Harden runtime evidence is invalid")
    hours, minutes, seconds = (int(part) for part in match.groups())
    if minutes >= 60 or seconds >= 60:
        raise OptimizationRuntimeError("place-to-Harden runtime evidence is invalid")
    return float(hours * 3600 + minutes * 60 + seconds)


def _current_values(workspace: Path, site_width_dbu: int) -> dict[str, bool | int | float]:
    try:
        payload = json.loads((workspace / "home" / "parameters.json").read_text(encoding="utf-8"))
        values = {
            "place.target_density": payload["Target density"],
            "place.cell_padding_x": payload["Cell padding x"] / site_width_dbu,
            "place.routability_opt": bool(payload["Routability opt flag"]),
        }
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("placement parameters are invalid") from exc
    if not isinstance(values["place.target_density"], (int, float)) or isinstance(
        values["place.target_density"], bool
    ):
        raise OptimizationRuntimeError("target density parameter is invalid")
    if type(values["place.cell_padding_x"]) not in {int, float} or values["place.cell_padding_x"] < 0:
        raise OptimizationRuntimeError("cell padding parameter is invalid")
    return values


def _ledger(root: Path):
    return OptimizationLedger(root)


def _ecc_executable() -> Path:
    candidate = os.environ.get("ECOS_AGENT_ECC_BIN", "").strip()
    if candidate:
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return path.resolve()
        raise OptimizationRuntimeError("ECOS_AGENT_ECC_BIN is not executable")
    resolved = shutil.which("ecc")
    if resolved:
        return Path(resolved).resolve()
    repo_root = Path(__file__).resolve().parents[4]
    for relative in ("ecc/.venv/bin/ecc", "ecc/build/ecc/ecc", "ecc/dist/ecc/ecc"):
        path = repo_root / relative
        if path.is_file() and os.access(path, os.X_OK):
            return path.resolve()
    raise OptimizationRuntimeError("ECC executable is unavailable")


def _site_width_dbu(workspace: Path) -> int:
    try:
        params = json.loads((workspace / "home" / "parameters.json").read_text(encoding="utf-8"))
        pdk_root = Path(params["PDK Root"])
        lef = pdk_root / "prtech" / "techLEF" / "N551P6M_ecos.lef"
        text = lef.read_text(encoding="utf-8")
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("PDK technology LEF is unavailable") from exc
    units_match = re.search(r"DATABASE\s+MICRONS\s+(\d+)", text, re.IGNORECASE)
    site_match = re.search(r"SITE\s+(?:core7|CoreSite)\b(?P<body>.*?)END\s+(?:core7|CoreSite)", text, re.IGNORECASE | re.DOTALL)
    size_match = re.search(r"SIZE\s+([0-9]+(?:\.[0-9]+)?)\s+BY", site_match.group("body") if site_match else "", re.IGNORECASE)
    if not units_match or not size_match:
        raise OptimizationRuntimeError("PDK site width is unavailable")
    width = round(float(units_match.group(1)) * float(size_match.group(1)))
    if width <= 0:
        raise OptimizationRuntimeError("PDK site width is invalid")
    return width


def _terminal_timeout_seconds() -> float:
    raw = os.environ.get("ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS", "900")
    try:
        value = float(raw)
    except ValueError as exc:
        raise OptimizationRuntimeError("ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS is invalid") from exc
    if value <= 0:
        raise OptimizationRuntimeError("ECOS_AGENT_ECC_TERMINAL_TIMEOUT_SECONDS is invalid")
    return value


def _monotonic() -> float:
    import time

    return time.monotonic()
