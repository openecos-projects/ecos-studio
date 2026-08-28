"""Production assembly for one bounded optimization episode."""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Mapping

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    OptimizationObjectiveContract,
    TerminalObservation,
)
from ecos_agent.optimization_controller import (
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
    build_optimization_artifact_manifest,
)
from ecos_agent.optimization_memory import (
    OptimizationTaskMemoryStore,
    build_task_memory_scope,
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


_OPTIMIZATION_RERUN_STAGES = (
    "Floorplan",
    "fixFanout",
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
_DESIGN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")


def create_optimization_runner(
    context: Mapping[str, Any], planner: object
) -> OptimizationEpisodeRunner:
    workspace = _workspace(context.get("workspace"))
    episode_id = _text(context.get("episode_id"), "episode_id")
    objective = _optimization_objective(context.get("objective"))
    checkpoint_id = "place"
    receipt_aware_planning = context.get("receipt_aware_planning", True)
    if type(receipt_aware_planning) is not bool:
        raise OptimizationRuntimeError("receipt-aware planning flag is invalid")
    baseline_eligibility_exempt = context.get("baseline_eligibility_exempt", False)
    if type(baseline_eligibility_exempt) is not bool:
        raise OptimizationRuntimeError("baseline eligibility exemption is invalid")
    terminal_observation = build_terminal_observation(workspace)
    site_width_dbu = _site_width_dbu(workspace)
    parent_manifest = _parent_manifest_sha256(workspace, terminal_observation)
    try:
        execution_context = _optimization_execution_context(
            workspace, site_width_dbu, context.get("seed", 0), parent_manifest
        )
    except OptimizationRuntimeError:
        if (workspace / "origin").exists():
            raise
        if type(context.get("seed", 0)) is not int:
            raise OptimizationRuntimeError("optimization seed is invalid")
        # Legacy unit fixtures have no materialized inputs; production workspaces do.
        execution_context = {
            "design_sha256": parent_manifest,
            "parent_lineage_sha256": parent_manifest,
            "site_width_dbu": site_width_dbu,
            "seed": context.get("seed", 0),
        }
    design_id = _design_id(workspace)
    routability_objective = freeze_routability_objective(
        terminal_observation,
        allow_ineligible_baseline=baseline_eligibility_exempt,
    )
    reference_runtime = context.get("reference_runtime_seconds")
    if reference_runtime is None:
        reference_runtime = _optimization_rerun_runtime_seconds(workspace)
    if (
        not isinstance(reference_runtime, (int, float))
        or isinstance(reference_runtime, bool)
        or not math.isfinite(reference_runtime)
        or reference_runtime <= 0
    ):
        raise OptimizationRuntimeError("reference runtime is invalid")
    budget = BudgetSnapshot(
        budget=EpisodeBudget.from_reference_rerun(float(reference_runtime))
    )
    ledger_root = workspace / ".agent" / "optimization" / episode_id
    memory_scope = build_task_memory_scope(
        workspace_manifest_sha256=parent_manifest,
        design_id=design_id,
        checkpoint_id=checkpoint_id,
        episode_id=episode_id,
        objective_contract_sha256=objective.contract_sha256,
    )
    memory_store = OptimizationTaskMemoryStore(ledger_root.parent, memory_scope)
    rpc = EccContentLengthRpcClient(_ecc_executable())
    ledger = _ledger(ledger_root)
    try:
        workspace_id = rpc.open_workspace(workspace)
        executor = EccCandidateRerunAdapter(
            rpc,
            workspace_id=workspace_id,
            site_width_dbu=site_width_dbu,
            workspace_root=workspace,
        )
        state_path = ledger_root / "optimization-episode-state.v6.json"
        legacy_state_paths = (
            ledger_root / "optimization-episode-state.v2.json",
            ledger_root / "optimization-episode-state.v3.json",
            ledger_root / "optimization-episode-state.v4.json",
            ledger_root / "optimization-episode-state.v5.json",
        )
        if state_path.is_file():
            memory_store.verify_episode_scope(ledger_root)
            controller = OptimizationEpisodeController.recover(
                planner=planner,
                executor=executor,
                ledger=ledger,
                clock=_monotonic,
                task_memory_scope_sha256=memory_scope.scope_sha256,
                task_memory_supplier=memory_store.snapshot,
                execution_context=execution_context,
                receipt_aware_planning=receipt_aware_planning,
            )
            if controller.objective != objective:
                raise OptimizationRuntimeError(
                    "optimization objective does not match the recovered episode"
                )
            if controller.parent_manifest_sha256 != parent_manifest:
                raise OptimizationRuntimeError(
                    "optimization workspace does not match the recovered episode"
                )
        elif any(path.is_file() for path in legacy_state_paths):
            raise OptimizationRuntimeError(
                "pre-policy episode cannot be recovered; start a new optimization episode"
            )
        elif ledger.ledger_path.is_file() and ledger.ledger_path.stat().st_size:
            raise OptimizationRuntimeError("optimization episode state is missing")
        else:
            memory_store.ensure_episode_scope(ledger_root)
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
                task_memory_scope_sha256=memory_scope.scope_sha256,
                task_memory_supplier=memory_store.snapshot,
                execution_context=execution_context,
                receipt_aware_planning=receipt_aware_planning,
            )
    except Exception:
        rpc.close()
        raise

    retrieval = OptimizationKnowledgeRetriever()
    stop_event = threading.Event()
    current_values = _current_values(
        _incumbent_workspace(workspace, controller.incumbent_candidate_root_ref),
        site_width_dbu,
    )

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
        return _wait_for_terminal_receipt(
            executor,
            execution_id,
            timeout_seconds=min(_terminal_timeout_seconds(), remaining),
            stop_event=stop_event,
        )

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
        objective=routability_objective,
        baseline_eligibility_exempt=baseline_eligibility_exempt,
        stop_event=stop_event,
        site_width_dbu=site_width_dbu,
    )


def _wait_for_terminal_receipt(
    executor: EccCandidateRerunAdapter,
    execution_id: str,
    *,
    timeout_seconds: float,
    stop_event: threading.Event,
) -> CandidateExecutionReceipt:
    deadline = _monotonic() + max(0.0, timeout_seconds)
    while not stop_event.is_set() and _monotonic() < deadline:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            break
        try:
            receipt = executor.wait_for_terminal(
                execution_id, timeout_seconds=min(1.0, remaining)
            )
        except Exception:
            if stop_event.is_set():
                return executor.cancel(execution_id)
            raise
        if receipt.outcome is not None:
            return receipt
        stop_event.wait(min(0.05, max(0.0, deadline - _monotonic())))
    return executor.cancel(execution_id)


def _optimization_objective(value: object) -> OptimizationObjectiveContract:
    if value is None:
        raise OptimizationRuntimeError("optimization objective is missing")
    try:
        return OptimizationObjectiveContract.model_validate(value)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationRuntimeError("optimization objective is invalid") from exc


def _parent_manifest_sha256(workspace: Path, terminal: TerminalObservation) -> str:
    checkpoint_manifest = build_optimization_artifact_manifest(
        workspace,
        (
            "home/flow.json",
            "home/parameters.json",
            "place_dreamplace/analysis/qor_metrics.json",
        ),
    )
    return canonical_sha256(
        {
            "checkpoint_manifest_sha256": checkpoint_manifest.manifest_sha256,
            "terminal_manifest_sha256": terminal.evidence_manifest_sha256,
        }
    )


def _optimization_execution_context(
    workspace: Path, site_width_dbu: int, seed: object, parent_manifest: str
) -> dict[str, object]:
    """Return only immutable, reproducible inputs used by domain fingerprints."""
    if type(seed) is not int:
        raise OptimizationRuntimeError("optimization seed is invalid")
    origin = workspace / "origin"
    input_hashes: dict[str, str] = {}
    for key, relative in (
        ("rtl_sha256", "rtl"),
        ("filelist_sha256", "filelist.f"),
        ("sdc_sha256", ""),
    ):
        if relative == "rtl":
            candidates = sorted((origin / relative).glob("*"))
        elif relative:
            candidates = [origin / relative]
        else:
            candidates = sorted(origin.glob("*.sdc"))
        files = [path for path in candidates if path.is_file()]
        if not files:
            raise OptimizationRuntimeError(f"optimization {key} input is unavailable")
        hashes = [file_sha256(path) for path in files]
        input_hashes[key] = hashes[0] if len(hashes) == 1 else canonical_sha256({"files": hashes})
    try:
        parameters = json.loads(
            (workspace / "home" / "parameters.json").read_text(encoding="utf-8")
        )
        pdk_root = Path(parameters["PDK Root"])
        tech_lef = pdk_root / "prtech" / "techLEF" / "N551P6M_ecos.lef"
        pdk_sha256 = file_sha256(tech_lef)
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("optimization PDK evidence is unavailable") from exc
    design_sha256 = canonical_sha256(
        {key: input_hashes[key] for key in ("rtl_sha256", "filelist_sha256", "sdc_sha256")}
    )
    return {
        **input_hashes,
        "design_sha256": design_sha256,
        "pdk_sha256": pdk_sha256,
        "parent_lineage_sha256": file_sha256(workspace / "home" / "flow.json"),
        "parent_manifest_sha256": parent_manifest,
        "site_width_dbu": site_width_dbu,
        "seed": seed,
    }


def _workspace(value: object) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise OptimizationRuntimeError("optimization workspace is missing")
    path = Path(value).expanduser()
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise OptimizationRuntimeError("optimization workspace is unavailable")
    return path.resolve()


def _incumbent_workspace(workspace: Path, candidate_root_ref: str | None) -> Path:
    if candidate_root_ref is None:
        return workspace
    parts = Path(candidate_root_ref).parts
    if len(parts) != 3 or parts[:2] != (".agent", "candidates") or not parts[2]:
        raise OptimizationRuntimeError("incumbent candidate workspace is invalid")
    candidate = workspace
    for part in parts:
        candidate /= part
        if candidate.is_symlink():
            raise OptimizationRuntimeError("incumbent candidate workspace is invalid")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(workspace)
    except (OSError, ValueError) as exc:
        raise OptimizationRuntimeError("incumbent candidate workspace is invalid") from exc
    if not resolved.is_dir():
        raise OptimizationRuntimeError("incumbent candidate workspace is invalid")
    return resolved


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OptimizationRuntimeError(f"optimization {label} is missing")
    return value.strip()


def _design_id(workspace: Path) -> str:
    try:
        payload = json.loads(
            (workspace / "home" / "parameters.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("workspace design identifier is unavailable") from exc
    value = payload.get("Design")
    if not isinstance(value, str) or not _DESIGN_ID.fullmatch(value):
        raise OptimizationRuntimeError("workspace design identifier is invalid")
    return value


def _optimization_rerun_runtime_seconds(workspace: Path) -> float:
    try:
        payload = json.loads((workspace / "home" / "flow.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("optimization rerun flow evidence is unavailable") from exc
    steps = payload.get("steps")
    if not isinstance(steps, list):
        raise OptimizationRuntimeError("optimization rerun flow completion evidence is invalid")
    total = 0.0
    for stage in _OPTIMIZATION_RERUN_STAGES:
        total += _successful_flow_stage_runtime_seconds(steps, stage)
    if total <= 0:
        raise OptimizationRuntimeError("optimization rerun runtime evidence is invalid")
    return total


def _successful_flow_stage_runtime_seconds(steps: list[object], stage: str) -> float:
    matches = [item for item in steps if isinstance(item, dict) and item.get("name") == stage]
    if len(matches) != 1 or matches[0].get("state") != "Success":
        raise OptimizationRuntimeError("optimization rerun flow completion evidence is invalid")
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


def _current_values(workspace: Path, site_width_dbu: int) -> dict[str, bool | int | float]:
    try:
        parameters = json.loads(
            (workspace / "home" / "parameters.json").read_text(encoding="utf-8")
        )
        dreamplace = json.loads(
            (workspace / "config" / "dreamplace_ecc.json").read_text(encoding="utf-8")
        )
        fixfanout = json.loads(
            (workspace / "config" / "fixfanout_ecc.json").read_text(encoding="utf-8")
        )
        values = {
            "place.target_density": dreamplace["target_density"],
            "place.target_overflow": dreamplace["stop_overflow"],
            "place.cell_padding_x": dreamplace["cell_padding_x"] / site_width_dbu,
            "place.routability_opt": bool(dreamplace["routability_opt_flag"]),
            "place.density_weight": dreamplace["density_weight"],
            "floorplan.core_util": parameters["Core"]["Utilitization"],
            "floorplan.aspect_ratio": parameters["Core"]["Aspect ratio"],
            "synth.max_fanout": fixfanout["max_fanout"],
        }
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationRuntimeError("optimization parameters are invalid") from exc
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
