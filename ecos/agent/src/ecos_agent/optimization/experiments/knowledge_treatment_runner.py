"""Run the frozen ten-design knowledge-treatment experiment."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationEpisodeState,
    OptimizationObjectiveProposal,
    TerminalObservation,
)
from ecos_agent.optimization.experiments.equal_budget import (
    EqualBudgetConfig,
    _verified_episode_state,
    export_episode_traces,
)
from ecos_agent.optimization.experiments.knowledge_treatments import (
    FEW_SHOT_TREATMENT,
    KNOWLEDGE_TREATMENTS,
    ZERO_SHOT_GATE_TREATMENTS,
    KnowledgeTreatmentConfig,
    build_knowledge_treatment_report,
    build_zero_shot_gate_report,
)
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    DesignSpec,
    ExperimentManifest,
    _calibrate,
    _ensure_workspace,
    load_experiment_manifest,
)
from ecos_agent.optimization.knowledge.cases import EmpiricalCaseAuditStore
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.rules import freeze_optimization_objective
from ecos_agent.optimization.runtime import create_optimization_runner

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_CANDIDATES_PER_DESIGN = 2
_PLANNING_CALLS_PER_DESIGN = 6


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
    provider_factory: Callable[..., Any],
    rule_guided_utility_by_design: Mapping[str, float | int] | None = None,
    knowledge_case_pool_root: Path | None = None,
) -> dict[str, object]:
    if not _ID.fullmatch(run_id) or type(seed) is not int or max_workers <= 0:
        raise ValueError("Phase 8 run arguments are invalid")
    output = Path(output).resolve()
    workspace_root = Path(workspace_root).resolve()
    output.mkdir(parents=True, exist_ok=True)
    workspace_root.mkdir(parents=True, exist_ok=True)
    run_root = output / "runs" / run_id
    if run_root.exists():
        raise ValueError("Phase 8 run id already exists")
    run_root.mkdir(parents=True)
    case_pool_metadata = None
    if knowledge_case_pool_root is not None:
        knowledge_case_pool_root, case_pool_metadata = _snapshot_case_pool(
            knowledge_case_pool_root,
            run_root / "knowledge-case-pool",
        )

    def prepare_design(design: DesignSpec):
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
        return design, workspace, reference, reference_runtime

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        prepared = tuple(executor.map(prepare_design, manifest.designs))

    def run_treatments(treatments: Sequence[KnowledgeTreatmentConfig]):
        def run_design(item):
            design, workspace, reference, reference_runtime = item
            results = {
                treatment.treatment.value: _run_treatment(
                    design,
                    workspace,
                    reference,
                    reference_runtime,
                    run_root / design.design_id / treatment.treatment.value,
                    run_id=run_id,
                    model=model,
                    seed=seed,
                    treatment=treatment,
                    provider_factory=provider_factory,
                    knowledge_case_pool_root=knowledge_case_pool_root,
                )
                for treatment in treatments
            }
            return design.design_id, reference_runtime, results

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            return tuple(executor.map(run_design, prepared))

    gate_results = run_treatments(ZERO_SHOT_GATE_TREATMENTS)
    gate_evidence = _collect_treatment_evidence(
        gate_results, ZERO_SHOT_GATE_TREATMENTS, manifest.designs
    )
    gate_trace_paths = _write_trace_inputs(run_root, gate_evidence["traces"])
    gate_report = build_zero_shot_gate_report(
        gate_evidence["traces"],
        planning_calls_by_treatment=gate_evidence["planning_calls"],
        config=EqualBudgetConfig(
            reference_runtime_seconds=sum(gate_evidence["runtimes"].values())
        ),
        design_ids=tuple(design.design_id for design in manifest.designs),
        rule_guided_utility_by_design=rule_guided_utility_by_design,
        budget_complete_by_treatment=gate_evidence["budget_complete"],
        terminal_artifacts_complete_by_treatment=gate_evidence["terminal_complete"],
        replay_chain_complete_by_treatment=gate_evidence["replay_complete"],
        selected_cases_by_treatment=gate_evidence["selected_cases"],
        case_selection_events_by_treatment=gate_evidence["selection_events"],
        nonempty_case_selection_events_by_treatment=gate_evidence[
            "nonempty_selection_events"
        ],
    )
    gate_report["run_metadata"] = {
        "run_id": run_id,
        "model": model,
        "seed": seed,
        "tool_revision": tool_revision,
        "input_manifest_sha256": manifest.manifest_sha256,
        "design_manifest_ref": str(Path(manifest_path)),
        "design_manifest_file_sha256": file_sha256(Path(manifest_path)),
        "reference_runtime_seconds_by_design": gate_evidence["runtimes"],
        "rule_guided_utility_sha256": (
            canonical_sha256(rule_guided_utility_by_design)
            if rule_guided_utility_by_design is not None
            else None
        ),
        "knowledge_case_pool": case_pool_metadata,
        "episode_evidence": gate_evidence["episode_evidence"],
        "trace_sha256": {
            treatment.value: file_sha256(path)
            for treatment, path in gate_trace_paths.items()
        },
    }
    gate_path = run_root / "zero-shot-gate.v1.json"
    _write_json(gate_path, gate_report)
    gate_receipt = {
        "artifact_ref": gate_path.name,
        "artifact_sha256": file_sha256(gate_path),
        "decision": gate_report["decision"],
    }
    if (
        gate_report["decision"] != "pass"
        or gate_report.get("few_shot_authorized") is not True
    ):
        _write_run_manifest(
            run_root,
            gate_report,
            gate_receipt,
            execution_status="few_shot_blocked",
            planning_calls=gate_evidence["planning_calls"],
            trace_paths=gate_trace_paths,
        )
        return gate_report
    if (
        knowledge_case_pool_root is None
        or not case_pool_metadata
        or not case_pool_metadata.get("case_count")
    ):
        _write_run_manifest(
            run_root,
            gate_report,
            gate_receipt,
            execution_status="few_shot_blocked_missing_case_pool",
            planning_calls=gate_evidence["planning_calls"],
            trace_paths=gate_trace_paths,
        )
        raise ValueError("three-shot treatment requires a nonempty frozen case pool")

    few_shot_results = run_treatments((FEW_SHOT_TREATMENT,))
    few_shot_by_design = {
        design_id: treatments for design_id, _, treatments in few_shot_results
    }
    results = tuple(
        (
            design_id,
            runtime,
            {**treatments, **few_shot_by_design[design_id]},
        )
        for design_id, runtime, treatments in gate_results
    )
    evidence = _collect_treatment_evidence(
        results, KNOWLEDGE_TREATMENTS, manifest.designs
    )
    trace_paths = _write_trace_inputs(run_root, evidence["traces"])
    report = build_knowledge_treatment_report(
        evidence["traces"],
        planning_calls_by_treatment=evidence["planning_calls"],
        config=EqualBudgetConfig(
            reference_runtime_seconds=sum(evidence["runtimes"].values())
        ),
        design_ids=tuple(design.design_id for design in manifest.designs),
        rule_guided_utility_by_design=rule_guided_utility_by_design,
        budget_complete_by_treatment=evidence["budget_complete"],
        terminal_artifacts_complete_by_treatment=evidence["terminal_complete"],
        replay_chain_complete_by_treatment=evidence["replay_complete"],
        selected_cases_by_treatment=evidence["selected_cases"],
        case_selection_events_by_treatment=evidence["selection_events"],
        nonempty_case_selection_events_by_treatment=evidence[
            "nonempty_selection_events"
        ],
    )
    report["protocol_gate_receipt"] = gate_receipt
    report["run_metadata"] = {
        **gate_report["run_metadata"],
        "elapsed_wall_time_seconds_by_treatment": evidence["elapsed_wall_time"],
        "episode_evidence": evidence["episode_evidence"],
    }
    _write_json(output / "knowledge-treatment-report.v2.json", report)
    _write_run_manifest(
        run_root,
        report,
        gate_receipt,
        execution_status="completed",
        planning_calls=evidence["planning_calls"],
        trace_paths=trace_paths,
    )
    return report


def _collect_treatment_evidence(results, treatments, designs) -> dict[str, object]:
    runtimes = {design_id: runtime for design_id, runtime, _ in results}
    traces = {
        treatment.treatment: tuple(
            trace
            for _, _, treatments in results
            for trace in treatments[treatment.treatment.value]["traces"]
        )
        for treatment in treatments
    }
    planning_calls = {
        treatment.treatment: sum(
            treatments[treatment.treatment.value]["planning_calls"]
            for _, _, treatments in results
        )
        for treatment in treatments
    }
    elapsed_wall_time = {
        treatment.treatment.value: {
            design_id: treatments[treatment.treatment.value][
                "elapsed_wall_time_seconds"
            ]
            for design_id, _, treatments in results
        }
        for treatment in treatments
    }
    budget_complete = {
        treatment.treatment: sum(item.started for item in traces[treatment.treatment])
        == EqualBudgetConfig().candidate_limit
        and all(
            sum(
                item.started and item.design_id == design.design_id
                for item in traces[treatment.treatment]
            )
            == _CANDIDATES_PER_DESIGN
            for design in designs
        )
        and planning_calls[treatment.treatment]
        <= _PLANNING_CALLS_PER_DESIGN * len(designs)
        and all(
            treatments[treatment.treatment.value]["planning_calls"]
            <= _PLANNING_CALLS_PER_DESIGN
            for _, _, treatments in results
        )
        and all(
            elapsed_wall_time[treatment.treatment.value][design_id]
            <= 22.0 * runtimes[design_id]
            for design_id in runtimes
        )
        for treatment in treatments
    }
    terminal_complete = {
        treatment.treatment: all(
            treatments[treatment.treatment.value]["terminal_artifacts_complete"]
            for _, _, treatments in results
        )
        for treatment in treatments
    }
    replay_complete = {
        treatment.treatment: all(
            treatments[treatment.treatment.value]["replay_chain_complete"]
            for _, _, treatments in results
        )
        for treatment in treatments
    }
    selected_cases = {
        treatment.treatment: sum(
            treatments[treatment.treatment.value]["selected_case_count"]
            for _, _, treatments in results
        )
        for treatment in treatments
    }
    selection_events = {
        treatment.treatment: sum(
            treatments[treatment.treatment.value]["case_selection_event_count"]
            for _, _, treatments in results
        )
        for treatment in treatments
    }
    nonempty_selection_events = {
        treatment.treatment: sum(
            treatments[treatment.treatment.value][
                "nonempty_case_selection_event_count"
            ]
            for _, _, treatments in results
        )
        for treatment in treatments
    }
    episode_evidence = {
        treatment.treatment.value: {
            design_id: treatments[treatment.treatment.value]["episode_evidence"]
            for design_id, _, treatments in results
        }
        for treatment in treatments
    }
    return {
        "runtimes": runtimes,
        "traces": traces,
        "planning_calls": planning_calls,
        "elapsed_wall_time": elapsed_wall_time,
        "budget_complete": budget_complete,
        "terminal_complete": terminal_complete,
        "replay_complete": replay_complete,
        "selected_cases": selected_cases,
        "selection_events": selection_events,
        "nonempty_selection_events": nonempty_selection_events,
        "episode_evidence": episode_evidence,
    }


def _write_trace_inputs(run_root: Path, traces: Mapping) -> dict:
    paths = {}
    for treatment, rows in traces.items():
        path = run_root / f"{treatment.value}-input.jsonl"
        path.write_text(
            "".join(json.dumps(item.__dict__, sort_keys=True) + "\n" for item in rows),
            encoding="utf-8",
        )
        paths[treatment] = path
    return paths


def _write_run_manifest(
    run_root: Path,
    report: Mapping[str, object],
    gate_receipt: Mapping[str, object],
    *,
    execution_status: str,
    planning_calls: Mapping | None = None,
    trace_paths: Mapping | None = None,
) -> None:
    metadata = report["run_metadata"]
    assert isinstance(metadata, Mapping)
    _write_json(
        run_root / "run-manifest.v2.json",
        {
            "schema_version": "ecos.phase8_execution_run.v2",
            **metadata,
            "protocol_gate_receipt": gate_receipt,
            "execution_status": execution_status,
            "planning_calls": {
                treatment.value: count
                for treatment, count in (planning_calls or {}).items()
            },
            "trace_sha256": {
                treatment.value: file_sha256(path)
                for treatment, path in (trace_paths or {}).items()
            },
            "evaluation_status": report.get("evaluation_status"),
            "research_claim": report.get("research_claim", "not_assessed"),
        },
    )


def _run_treatment(
    design: DesignSpec,
    workspace: Path,
    reference: TerminalObservation,
    reference_runtime: float,
    output: Path,
    *,
    run_id: str,
    model: str,
    seed: int,
    treatment: KnowledgeTreatmentConfig,
    provider_factory: Callable[..., Any],
    knowledge_case_pool_root: Path | None = None,
) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=True)
    episode_id = f"phase8-{run_id}-{design.design_id}-{treatment.treatment.value}"
    episode_root = workspace / ".agent" / "optimization" / episode_id
    if episode_root.exists():
        raise ValueError("Phase 8 treatment episode already exists")
    env = dict(os.environ)
    env["ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2"] = "1"
    provider = provider_factory(
        cwd=workspace,
        env=env,
        runtime_workspace_roots=(workspace,),
        diagnostics_path=output / "codex-diagnostics.jsonl",
        ephemeral=True,
    )
    provider.select_model(model)
    objective = _objective()
    runtime_context = {
        "workspace": str(workspace),
        "episode_id": episode_id,
        "objective": objective.model_dump(mode="json"),
        "objective_alignment": build_objective_alignment(
            objective, reference
        ).model_dump(mode="json"),
        "seed": seed,
        "reference_runtime_seconds": reference_runtime,
        "receipt_aware_planning": treatment.receipt_aware_planning,
        "agent_mode": treatment.agent_mode,
        "knowledge_case_shots": treatment.knowledge_case_shots,
    }
    if treatment.knowledge_case_shots and knowledge_case_pool_root is not None:
        runtime_context["knowledge_case_pool_root"] = str(knowledge_case_pool_root)
    runner = create_optimization_runner(runtime_context, provider)
    try:
        while (
            runner.budget.consumed_candidates < _CANDIDATES_PER_DESIGN
            and runner.budget.consumed_planning_calls < _PLANNING_CALLS_PER_DESIGN
            and runner.state
            in {OptimizationEpisodeState.CREATED, OptimizationEpisodeState.PLANNING}
        ):
            runner.run_turn()
        consumed_candidates = runner.budget.consumed_candidates
        consumed_planning_calls = runner.budget.consumed_planning_calls
        elapsed_wall_time_seconds = runner.budget.elapsed_wall_time_seconds
    finally:
        runner.close()
        provider.close()
    traces, planning_calls, observed_mode = export_episode_traces(
        workspace=workspace,
        episode_root=episode_root,
        design_id=design.design_id,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
    )
    if observed_mode != "receipt-aware":
        raise ValueError("Phase 8 episode planning mode changed")
    case_replay = EmpiricalCaseAuditStore(episode_root).verify()
    selected_case_count = sum(
        len(item.selection.selected_case_ids) for item in case_replay.selections
    )
    case_selection_event_count = len(case_replay.selections)
    nonempty_case_selection_event_count = sum(
        bool(item.selection.selected_case_ids) for item in case_replay.selections
    )
    started_candidates = sum(item.started for item in traces)
    terminal_artifacts_complete = started_candidates == consumed_candidates
    replay_chain_complete = (
        terminal_artifacts_complete and planning_calls == consumed_planning_calls
    )
    episode_evidence = _episode_evidence(workspace, episode_root)
    _write_json(
        output / "summary.v1.json",
        {
            "schema_version": "ecos.knowledge_treatment_design.v1",
            "design_id": design.design_id,
            "treatment": treatment.treatment.value,
            "agent_mode": treatment.agent_mode,
            "knowledge_case_shots": treatment.knowledge_case_shots,
            "episode_id": episode_id,
            "planning_calls": planning_calls,
            "started_candidates": started_candidates,
            "selected_case_count": selected_case_count,
            "case_selection_event_count": case_selection_event_count,
            "nonempty_case_selection_event_count": (
                nonempty_case_selection_event_count
            ),
            "terminal_artifacts_complete": terminal_artifacts_complete,
            "replay_chain_complete": replay_chain_complete,
            "episode_evidence": episode_evidence,
            "elapsed_wall_time_seconds": elapsed_wall_time_seconds,
            "trace_sha256": canonical_sha256([item.__dict__ for item in traces]),
        },
    )
    return {
        "traces": traces,
        "planning_calls": planning_calls,
        "elapsed_wall_time_seconds": elapsed_wall_time_seconds,
        "terminal_artifacts_complete": terminal_artifacts_complete,
        "replay_chain_complete": replay_chain_complete,
        "selected_case_count": selected_case_count,
        "case_selection_event_count": case_selection_event_count,
        "nonempty_case_selection_event_count": nonempty_case_selection_event_count,
        "episode_evidence": episode_evidence,
    }


def _case_pool_metadata(root: Path | None) -> dict[str, object] | None:
    if root is None:
        return None
    path = Path(root).expanduser()
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise ValueError("knowledge case pool must be an existing absolute directory")
    store = EmpiricalCaseAuditStore(path, read_only=True)
    if store.audit_path.is_symlink():
        raise ValueError("knowledge case pool audit must not be a symlink")
    replay = store.verify()
    return {
        "case_count": len(replay.cases),
        "event_count": replay.event_count,
        "chain_head_sha256": replay.chain_head_sha256,
        "audit_file_sha256": (
            file_sha256(store.audit_path) if store.audit_path.is_file() else None
        ),
    }


def _snapshot_case_pool(source: Path, destination: Path) -> tuple[Path, dict[str, object]]:
    source_metadata = _case_pool_metadata(source)
    assert source_metadata is not None
    destination.mkdir(parents=True)
    source_audit = Path(source) / "optimization-knowledge-cases.v1.jsonl"
    if source_audit.is_file():
        shutil.copyfile(source_audit, destination / source_audit.name)
    snapshot_metadata = _case_pool_metadata(destination)
    if snapshot_metadata != source_metadata:
        raise ValueError("knowledge case pool changed while creating the run snapshot")
    assert snapshot_metadata is not None
    snapshot_metadata["artifact_ref"] = "knowledge-case-pool"
    return destination.resolve(), snapshot_metadata


def _episode_evidence(workspace: Path, episode_root: Path) -> dict[str, object]:
    state = _verified_episode_state(episode_root)
    state_path = episode_root / "optimization-episode-state.v7.json"
    chain_names = (
        "ledger",
        "planning_audit",
        "planning_provider_audit",
        "decision_audit",
        "case_audit",
    )
    return {
        "episode_root_ref": str(episode_root.relative_to(workspace)),
        "episode_state_file_sha256": file_sha256(state_path),
        "episode_state_sha256": state["state_sha256"],
        "audit_chains": {
            name: {
                "event_count": state.get(f"{name}_event_count", 0),
                "chain_head_sha256": state.get(f"{name}_chain_head_sha256"),
            }
            for name in chain_names
        },
    }


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


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )


def main(provider_factory: Callable[..., Any]) -> None:
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
    parser.add_argument("--rule-guided-utility-by-design", type=Path)
    parser.add_argument("--knowledge-case-pool-root", type=Path)
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
        provider_factory=provider_factory,
        rule_guided_utility_by_design=(
            json.loads(
                args.rule_guided_utility_by_design.read_text(encoding="utf-8")
            )
            if args.rule_guided_utility_by_design is not None
            else None
        ),
        knowledge_case_pool_root=args.knowledge_case_pool_root,
    )
