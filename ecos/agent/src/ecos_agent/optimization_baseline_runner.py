"""Run the frozen non-LLM baseline pilot on canonical gcd/i2c workspaces."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import BoundedSemaphore
from typing import Callable, Mapping, Sequence, TypeVar

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_baselines import (
    ONLINE_BASELINE_METHODS,
    BaselineMethod,
    BaselineSelection,
    rule_guided_policy_manifest,
    select_baseline_candidate,
)
from ecos_agent.optimization_contracts import (
    CANDIDATE_EXECUTION_LIMIT,
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    KnobScalar,
    ObjectiveMetric,
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_ecc_adapter import EccContentLengthRpcClient
from ecos_agent.optimization_gate0 import (
    Gate0Config,
    Gate0Design,
    PilotCandidateExecutionError,
    compare_observations,
    load_gate0_config,
    readiness_report,
    run_pilot_candidate,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_observations import build_terminal_observation
from ecos_agent.optimization_rules import coordinate_value_from_native_receipt
from ecos_agent.optimization_runtime import _current_values
from ecos_agent.optimization_statistics import (
    baseline_design_statistics,
    objective_delta,
    objective_tuple,
    success_curve_auc,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_PILOT_DESIGNS = frozenset({"gcd", "i2c"})
_CANDIDATE_LIMIT = CANDIDATE_EXECUTION_LIMIT
_DEFAULT_SEED = 20260824
_DEFAULT_MAX_WORKERS = 3
_T = TypeVar("_T")


class BaselineRunnerError(RuntimeError):
    """The baseline pilot cannot produce complete comparable evidence."""


@dataclass(frozen=True)
class BaselineCandidateExecution:
    observation: TerminalObservation
    candidate_root_ref: str
    effective_value: KnobScalar | None = None


@dataclass(frozen=True)
class BaselineCandidateFailure:
    execution_id: str
    outcome: OptimizationOutcomeKind | None


CandidateExecutor = Callable[
    [int, BaselineSelection, str | None, TerminalObservation],
    BaselineCandidateExecution | BaselineCandidateFailure,
]


def evaluate_online_method(
    method: BaselineMethod,
    *,
    design_id: str,
    baseline: TerminalObservation,
    current_values: Mapping[str, bool | int | float],
    epsilon: Mapping[str, float],
    random_seed: int,
    execute: CandidateExecutor,
) -> dict[str, object]:
    """Evaluate the fixed side-effect budget with incumbent-only promotion."""
    method = BaselineMethod(method)
    if method not in ONLINE_BASELINE_METHODS:
        raise BaselineRunnerError("baseline method is not online")
    values = dict(current_values)
    attempted: list[RequestedKnobValue] = []
    rows: list[dict[str, object]] = []
    incumbent = baseline
    parent_candidate_root_ref = None
    coordinate_index = 0
    first_improvement = None
    success = False
    failures = 0
    best_so_far: dict[str, dict[str, float]] = {}
    started = time.monotonic()
    for turn_index in range(_CANDIDATE_LIMIT):
        selection = select_baseline_candidate(
            method,
            design_id=design_id,
            turn_index=turn_index,
            coordinate_index=coordinate_index,
            random_seed=random_seed,
            current_values=values,
            attempted=attempted,
            incumbent=incumbent,
        )
        if selection is None:
            raise BaselineRunnerError("baseline exhausted legal candidates before the limit")
        coordinate_index = selection.next_coordinate_index
        attempted.append(selection.requested)
        row = _selection_row(turn_index + 1, selection, parent_candidate_root_ref)
        execution = execute(turn_index + 1, selection, parent_candidate_root_ref, incumbent)
        if isinstance(execution, BaselineCandidateFailure):
            failures += 1
            row.update(
                comparison=(
                    execution.outcome.value
                    if execution.outcome is not None
                    else OptimizationOutcomeKind.INDETERMINATE.value
                ),
                execution_id=execution.execution_id,
            )
        else:
            reference = _terminal_metrics(incumbent)
            comparison = compare_observations(reference, execution.observation, epsilon)
            row["comparison"] = comparison
            row["decisive_metric"] = _decisive_metric(
                reference, execution.observation, epsilon
            )
            row["candidate_delta"] = objective_delta(
                baseline, execution.observation
            )
            row["candidate_root_ref"] = execution.candidate_root_ref
            if comparison == "better":
                success = True
                first_improvement = first_improvement or turn_index + 1
                incumbent = execution.observation
                parent_candidate_root_ref = execution.candidate_root_ref
                values[selection.requested.knob_id.value] = (
                    execution.effective_value
                    if execution.effective_value is not None
                    else selection.requested.value
                )
        row["success_by_candidate"] = success
        row["best_so_far_tuple"] = objective_tuple(incumbent)
        rows.append(row)
        best_so_far[str(turn_index + 1)] = _objective_metrics(incumbent)
    success_at_k = {
        str(row["candidate_index"]): row["success_by_candidate"] for row in rows
    }
    return {
        "schema_version": "ecos.optimization_baseline_method.v2",
        "method": method.value,
        "design_id": design_id,
        "candidate_count": len(rows),
        "failed_candidate_count": failures,
        "first_improvement_candidate_index": first_improvement,
        "lex_success_at_20": success,
        "success_at_k": success_at_k,
        "auc_success_at_20": success_curve_auc(success_at_k),
        "best_so_far_at_k": best_so_far,
        "best_so_far_tuple": objective_tuple(incumbent),
        "best_so_far_delta": objective_delta(baseline, incumbent),
        "planning_call_count": 0,
        "wall_time_seconds": time.monotonic() - started,
        "random_seed": random_seed if method == BaselineMethod.RANDOM_ACTION else None,
        "candidates": rows,
        "best_terminal_observation": incumbent.model_dump(mode="json"),
    }


def run_baseline_pilot(
    config_path: Path,
    results_root: Path,
    *,
    run_id: str,
    workspaces: Mapping[str, Path],
    random_seed: int = _DEFAULT_SEED,
    max_workers: int = _DEFAULT_MAX_WORKERS,
) -> dict[str, object]:
    if not _ID.fullmatch(run_id):
        raise BaselineRunnerError("baseline run id is invalid")
    config_path = Path(config_path).resolve()
    config = load_gate0_config(config_path)
    _validate_scope(config, workspaces, random_seed, max_workers)
    readiness = readiness_report(config_path)
    designs = {item.design_id: item for item in config.designs}
    workspace_bindings = {
        design_id: _workspace_binding(
            config, designs[design_id], Path(workspace), readiness
        )
        for design_id, workspace in sorted(workspaces.items())
    }
    run_root = Path(results_root).resolve() / run_id
    if run_root.exists():
        raise BaselineRunnerError("baseline run directory already exists")
    run_root.mkdir(parents=True)
    _write_json(run_root / "run-manifest.v1.json", {
        "schema_version": "ecos.optimization_baseline_run.v1",
        "run_id": run_id,
        "config_sha256": readiness["config_sha256"],
        "designs": sorted(workspaces),
        "methods": [BaselineMethod.DEFAULT, *ONLINE_BASELINE_METHODS],
        "candidate_execution_limit": _CANDIDATE_LIMIT,
        "random_seed": random_seed,
        "max_workers": max_workers,
        "baseline_replay_counts": {
            design_id: designs[design_id].baseline_replay_count
            for design_id in sorted(workspaces)
        },
        "workspaces": {key: str(Path(value).resolve()) for key, value in sorted(workspaces.items())},
        "workspace_bindings": workspace_bindings,
        "policies": {
            BaselineMethod.RULE_GUIDED_DIRECTION.value: rule_guided_policy_manifest(),
        },
        "readiness": readiness,
    })
    design_ids = sorted(workspaces)
    execution_slots = BoundedSemaphore(max_workers)

    def run_design(design_id: str) -> dict[str, object]:
        return _run_design(
            config,
            design_id,
            Path(workspaces[design_id]),
            run_root / design_id,
            readiness,
            run_id,
            random_seed,
            designs[design_id].baseline_replay_count,
            max_workers,
            execution_slots,
        )

    try:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            summaries = dict(zip(design_ids, executor.map(run_design, design_ids)))
    except KeyboardInterrupt:
        _write_json(run_root / "interrupted.v1.json", {
            "schema_version": "ecos.optimization_baseline_interruption.v1",
            "message": "baseline pilot interrupted before completion",
        })
        raise
    except Exception as exc:
        _write_json(run_root / "failure.v1.json", {
            "error_type": type(exc).__name__,
            "message": "baseline pilot execution failed",
        })
        raise
    summary = {
        "schema_version": "ecos.optimization_baseline_summary.v1",
        "run_id": run_id,
        "designs": summaries,
        "design_block_statistics": baseline_design_statistics(summaries),
    }
    _write_json(run_root / "baseline-summary.v1.json", summary)
    return summary


def _run_design(
    config: Gate0Config,
    design_id: str,
    workspace: Path,
    output: Path,
    readiness: Mapping[str, object],
    run_id: str,
    random_seed: int,
    baseline_replay_count: int,
    max_workers: int,
    execution_slots: BoundedSemaphore,
) -> dict[str, object]:
    workspace = _canonical_workspace(workspace)
    output.mkdir()
    baseline = build_terminal_observation(workspace)
    if not baseline.eligible_for_incumbent:
        raise BaselineRunnerError("baseline workspace is not terminal eligible")
    defaults = _default_replays(
        workspace,
        output,
        config,
        readiness,
        run_id,
        design_id,
        baseline,
        baseline_replay_count,
        max_workers,
        execution_slots,
    )
    profile = _baseline_noise_profile(defaults)
    default_baseline = defaults[0]

    def run_method(method: BaselineMethod) -> dict[str, object]:
        method_output = output / method.value
        return _run_rpc_task(
            workspace,
            readiness,
            execution_slots,
            method_output / "failure.v1.json",
            method.value,
            lambda client, workspace_id: _run_online_method(
                method,
                client,
                workspace_id,
                workspace,
                output / method.value,
                config,
                readiness,
                run_id,
                design_id,
                default_baseline,
                profile["epsilon"],
                random_seed,
            ),
        )

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        online_summaries = tuple(executor.map(run_method, ONLINE_BASELINE_METHODS))
    methods = {
        BaselineMethod.DEFAULT.value: _default_summary(
            design_id, default_baseline, profile
        ),
        **dict(zip((method.value for method in ONLINE_BASELINE_METHODS), online_summaries)),
    }
    summary = {
        "design_id": design_id,
        "baseline_replay_count": baseline_replay_count,
        "canonical_terminal_observation": baseline.model_dump(mode="json"),
        "default_baseline": default_baseline.model_dump(mode="json"),
        "default_replays": [item.model_dump(mode="json") for item in defaults],
        "noise_profile": profile,
        "methods": methods,
    }
    _write_json(output / "design-summary.v1.json", summary)
    return summary


def _default_replays(
    workspace: Path,
    output: Path,
    config: Gate0Config,
    readiness: Mapping[str, object],
    run_id: str,
    design_id: str,
    baseline: TerminalObservation,
    replay_count: int,
    max_workers: int,
    execution_slots: BoundedSemaphore,
) -> tuple[TerminalObservation, ...]:
    if replay_count not in {1, 3}:
        raise BaselineRunnerError("baseline replay count must be 1 or 3")
    (output / "calibration").mkdir()

    def replay(index: int) -> TerminalObservation:
        replay_output = output / "calibration" / f"default-replay-{index}"
        result = _run_rpc_task(
            workspace,
            readiness,
            execution_slots,
            replay_output / "failure.v1.json",
            f"default-replay-{index}",
            lambda client, workspace_id: run_pilot_candidate(
                client,
                workspace_id,
                workspace,
                int(readiness["pdk"]["site_width_dbu"]),  # type: ignore[index]
                baseline,
                RequestedKnobValue(
                    knob_id=OptimizationKnob.TARGET_DENSITY,
                    value=config.baseline.target_density,
                ),
                StrategyDirection.INCREASE,
                f"calibration-{index}",
                replay_output,
                readiness["config_sha256"],
                float(config.terminal_timeout_seconds),
                episode_id=_episode_id(run_id, design_id, "calibration"),
                rationale_summary="Execute one frozen default replay for baseline noise calibration.",
            ),
        )
        return result.observation

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return tuple(executor.map(replay, range(1, replay_count + 1)))


def _baseline_noise_profile(
    default_replays: Sequence[TerminalObservation],
) -> dict[str, dict[str, float]]:
    """Use the first fresh no-op replay as Default and later replays as a band."""
    if not default_replays or any(
        not item.eligible_for_incumbent for item in default_replays
    ):
        raise BaselineRunnerError("default replay cannot define a baseline")
    rows = [_terminal_metrics(item) for item in default_replays]
    keys = tuple(rows[0])
    return {
        "reference": dict(rows[0]),
        "epsilon": {
            key: max(row[key] for row in rows) - min(row[key] for row in rows)
            for key in keys
        },
    }


def _run_online_method(
    method: BaselineMethod,
    client: EccContentLengthRpcClient,
    workspace_id: str,
    workspace: Path,
    output: Path,
    config: Gate0Config,
    readiness: Mapping[str, object],
    run_id: str,
    design_id: str,
    baseline: TerminalObservation,
    epsilon: Mapping[str, float],
    random_seed: int,
) -> dict[str, object]:
    output.mkdir()

    def execute(
        index: int,
        selection: BaselineSelection,
        parent_candidate_root_ref: str | None,
        incumbent: TerminalObservation,
    ) -> BaselineCandidateExecution | BaselineCandidateFailure:
        candidate_output = output / f"candidate-{index}"
        _write_json(output / f"decision-{index}.v1.json", _selection_row(
            index, selection, parent_candidate_root_ref
        ))
        try:
            result = run_pilot_candidate(
                client,
                workspace_id,
                workspace,
                int(readiness["pdk"]["site_width_dbu"]),  # type: ignore[index]
                incumbent,
                selection.requested,
                selection.action.direction,
                f"{method.value}-{index}",
                candidate_output,
                readiness["config_sha256"],
                float(config.terminal_timeout_seconds),
                episode_id=_episode_id(run_id, design_id, method.value),
                parent_candidate_root_ref=parent_candidate_root_ref,
                rationale_summary=f"Execute frozen {method.value} baseline action {index}.",
                knowledge_refs=(selection.knowledge_ref,) if selection.knowledge_ref else (),
            )
        except PilotCandidateExecutionError as exc:
            receipt = exc.receipt
            _write_json(candidate_output / "failure.v1.json", {
                "consumed_candidate": True,
                "execution_id": receipt.execution_id,
                "outcome": receipt.outcome.value if receipt.outcome is not None else None,
            })
            return BaselineCandidateFailure(receipt.execution_id, receipt.outcome)
        except Exception as exc:
            _write_json(candidate_output / "failure.v1.json", {
                "consumed_candidate": False,
                "error_type": type(exc).__name__,
                "message": "candidate failed before a chargeable execution receipt",
            })
            raise
        evidence = result.receipt.evidence
        if evidence is None:
            raise BaselineRunnerError("successful candidate evidence is missing")
        application = result.receipt.parameter_application_receipt
        if application is None:
            raise BaselineRunnerError(
                "successful candidate parameter application receipt is missing"
            )
        effective_value = coordinate_value_from_native_receipt(
            application,
            site_width_dbu=readiness["pdk"]["site_width_dbu"],
        )
        return BaselineCandidateExecution(
            result.observation,
            evidence.candidate_root_ref,
            effective_value,
        )

    summary = evaluate_online_method(
        method,
        design_id=design_id,
        baseline=baseline,
        current_values=_current_values(
            workspace, readiness["pdk"]["site_width_dbu"]
        ),
        epsilon=epsilon,
        random_seed=random_seed,
        execute=execute,
    )
    _write_json(output / "method-summary.v2.json", summary)
    return summary


def _default_summary(
    design_id: str,
    baseline: TerminalObservation,
    profile: Mapping[str, object],
) -> dict[str, object]:
    return {
        "schema_version": "ecos.optimization_baseline_method.v2",
        "method": BaselineMethod.DEFAULT.value,
        "design_id": design_id,
        "candidate_count": 0,
        "planning_call_count": 0,
        "wall_time_seconds": 0.0,
        "noise_profile": profile,
        "terminal_observation": baseline.model_dump(mode="json"),
    }


def _selection_row(
    index: int, selection: BaselineSelection, parent_candidate_root_ref: str | None
) -> dict[str, object]:
    return {
        "candidate_index": index,
        "action": selection.action.model_dump(mode="json"),
        "requested": selection.requested.model_dump(mode="json"),
        "knowledge_ref": (
            selection.knowledge_ref.model_dump(mode="json")
            if selection.knowledge_ref is not None
            else None
        ),
        "parent_candidate_root_ref": parent_candidate_root_ref,
    }


def _terminal_metrics(observation: TerminalObservation) -> dict[str, float]:
    return {
        **{metric.value: float(observation.metrics[metric]) for metric in ObjectiveMetric},
        **{metric.value: float(observation.timing_guardrail[metric]) for metric in TimingMetric},
    }


def _objective_metrics(observation: TerminalObservation) -> dict[str, float]:
    return {
        metric.value: float(observation.metrics[metric])
        for metric in ROUTABILITY_OBJECTIVE_ORDER
    }


def _decisive_metric(
    reference: Mapping[str, float],
    candidate: TerminalObservation,
    epsilon: Mapping[str, float],
) -> str | None:
    if not candidate.eligible_for_incumbent:
        return None
    metrics = _terminal_metrics(candidate)
    for metric in TIMING_GUARDRAIL_ORDER:
        key = metric.value
        if metrics[key] < reference[key] - epsilon[key]:
            return key
    for metric in ROUTABILITY_OBJECTIVE_ORDER:
        key = metric.value
        if (
            metrics[key] < reference[key] - epsilon[key]
            or metrics[key] > reference[key] + epsilon[key]
        ):
            return key
    return None


def _run_rpc_task(
    workspace: Path,
    readiness: Mapping[str, object],
    execution_slots: BoundedSemaphore,
    failure_path: Path,
    task_id: str,
    task: Callable[[EccContentLengthRpcClient, str], _T],
) -> _T:
    try:
        with execution_slots:
            client = EccContentLengthRpcClient(
                Path(readiness["ecc"]["executable"]),  # type: ignore[index]
                response_timeout_seconds=30,
            )
            try:
                return task(client, client.open_workspace(workspace))
            finally:
                client.close()
    except Exception as exc:
        _write_json(failure_path, {
            "task_id": task_id,
            "error_type": type(exc).__name__,
            "message": "parallel baseline task failed",
        })
        raise


def _validate_scope(
    config: Gate0Config,
    workspaces: Mapping[str, Path],
    random_seed: int,
    max_workers: int,
) -> None:
    if {item.design_id for item in config.designs} != _PILOT_DESIGNS:
        raise BaselineRunnerError("baseline pilot config must contain only gcd and i2c")
    if set(workspaces) != _PILOT_DESIGNS:
        raise BaselineRunnerError("baseline pilot requires gcd and i2c workspaces")
    if type(random_seed) is not int:
        raise BaselineRunnerError("baseline random seed is invalid")
    if type(max_workers) is not int or max_workers <= 0:
        raise BaselineRunnerError("baseline max workers must be a positive integer")


def _canonical_workspace(path: Path) -> Path:
    candidate = Path(path).expanduser()
    if not candidate.is_absolute() or candidate.is_symlink() or not candidate.is_dir():
        raise BaselineRunnerError("canonical workspace is unavailable")
    return candidate.resolve()


def _workspace_binding(
    config: Gate0Config,
    design: Gate0Design,
    path: Path,
    readiness: Mapping[str, object],
) -> dict[str, object]:
    workspace = _canonical_workspace(path)
    snapshots = {
        "rtl": _workspace_file(workspace, Path("origin/rtl") / Path(design.rtl.path).name),
        "filelist": _workspace_file(workspace, Path("origin/filelist.f")),
        "sdc": _workspace_file(workspace, Path("origin") / Path(design.sdc.path).name),
    }
    expected_hashes = {
        key: getattr(design, key).sha256 for key in ("rtl", "filelist", "sdc")
    }
    for key, snapshot in snapshots.items():
        if file_sha256(snapshot) != expected_hashes[key]:
            raise BaselineRunnerError(f"{design.design_id} workspace {key} snapshot does not match")
    parameters_path = _workspace_file(workspace, Path("home/parameters.json"))
    flow_path = _workspace_file(workspace, Path("home/flow.json"))
    try:
        parameters = json.loads(parameters_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BaselineRunnerError("workspace parameters are invalid") from exc
    baseline = config.baseline
    site_width = int(readiness["pdk"]["site_width_dbu"])  # type: ignore[index]
    expected_parameters = {
        "Design": design.design_id,
        "Top module": design.top_module,
        "Clock": design.clock_name,
        "Frequency max [MHz]": baseline.frequency_mhz,
        "Max fanout": baseline.max_fanout,
        "Target density": baseline.target_density,
        "Target overflow": baseline.target_overflow,
        "Cell padding x": baseline.cell_padding_sites * site_width,
        "Routability opt flag": int(baseline.routability_opt),
    }
    if not isinstance(parameters, dict) or any(
        parameters.get(key) != value for key, value in expected_parameters.items()
    ):
        raise BaselineRunnerError(f"{design.design_id} workspace parameters do not match")
    core = parameters.get("Core")
    if not isinstance(core, dict) or core.get("Utilitization") != baseline.utilitization:
        raise BaselineRunnerError(f"{design.design_id} workspace utilization does not match")
    if parameters.get("PDK Root") != readiness["pdk"]["root"]:  # type: ignore[index]
        raise BaselineRunnerError(f"{design.design_id} workspace PDK does not match")
    observation = build_terminal_observation(workspace)
    if not observation.eligible_for_incumbent:
        raise BaselineRunnerError(f"{design.design_id} workspace is not terminal eligible")
    return {
        "design_id": design.design_id,
        "workspace": str(workspace),
        "input_sha256": expected_hashes,
        "parameters_sha256": file_sha256(parameters_path),
        "flow_sha256": file_sha256(flow_path),
        "terminal_evidence_manifest_sha256": observation.evidence_manifest_sha256,
    }


def _workspace_file(workspace: Path, relative_path: Path) -> Path:
    candidate = workspace / relative_path
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(workspace)
    except (OSError, ValueError) as exc:
        raise BaselineRunnerError("workspace evidence is unavailable or unsafe") from exc
    if candidate.is_symlink() or not resolved.is_file():
        raise BaselineRunnerError("workspace evidence is unavailable or unsafe")
    return resolved


def _episode_id(run_id: str, design_id: str, method: str) -> str:
    suffix = canonical_sha256(run_id)[7:15]
    return f"baseline-{design_id}-{method}-{suffix}"


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _workspace_argument(value: str) -> tuple[str, Path]:
    design_id, separator, raw_path = value.partition("=")
    if not separator or design_id not in _PILOT_DESIGNS or not raw_path:
        raise argparse.ArgumentTypeError("workspace must be gcd=/absolute/path or i2c=/absolute/path")
    return design_id, Path(raw_path)


def main(argv: Sequence[str] | None = None) -> int:
    agent_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Run gcd/i2c non-LLM optimization baselines")
    parser.add_argument("--config", type=Path, default=agent_root / "experiments/pilot/pilot.v1.json")
    parser.add_argument("--results-root", type=Path, default=agent_root / "experiments/pilot/results")
    parser.add_argument("--run-id", default=time.strftime("baseline-%Y%m%dT%H%M%S", time.gmtime()))
    parser.add_argument("--random-seed", type=int, default=_DEFAULT_SEED)
    parser.add_argument("--max-workers", type=int, default=_DEFAULT_MAX_WORKERS)
    parser.add_argument("--workspace", action="append", type=_workspace_argument, required=True)
    args = parser.parse_args(argv)
    workspaces = dict(args.workspace)
    if len(workspaces) != len(args.workspace):
        parser.error("workspace design ids must be unique")
    try:
        summary = run_baseline_pilot(
            args.config,
            args.results_root,
            run_id=args.run_id,
            workspaces=workspaces,
            random_seed=args.random_seed,
            max_workers=args.max_workers,
        )
    except KeyboardInterrupt:
        print("Baseline pilot interrupted before completion.", file=sys.stderr)
        return 130
    except (BaselineRunnerError, OSError, ValueError) as exc:
        print(f"Baseline pilot failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        design_id: {
            method: result.get("lex_success_at_20")
            for method, result in design["methods"].items()
            if method != BaselineMethod.DEFAULT.value
        }
        for design_id, design in summary["designs"].items()
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
