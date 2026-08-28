"""Readiness and local-sensitivity gate for the controlled-optimization pilot."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import platform
import re
import statistics
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, Sequence

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    field_validator,
    model_validator,
)

from ecos_agent.contracts import GUI_WORKSPACE_FLOW_STEPS
from ecos_agent.effective_domain import build_context_fingerprint
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import (
    CANDIDATE_EXECUTION_LIMIT,
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    EpisodeBudget,
    ExpectedEffectDirection,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationKnob,
    OptimizationProposal,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
)
from ecos_agent.optimization_ecc_adapter import (
    EccCandidateRerunAdapter,
    EccContentLengthRpcClient,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_observations import (
    build_candidate_terminal_observation,
    build_terminal_observation,
)
from ecos_agent.optimization_runtime import (
    _current_values,
    _ecc_executable,
    _incumbent_workspace,
    _optimization_execution_context,
    _parent_manifest_sha256,
)
from ecos_agent.parameter_semantics import (
    LATTICE_VERSION,
    card_hash,
    load_parameter_cards,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_PILOT_RPC_METHODS = frozenset({"workspace.create", "operation.start_flow"})
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
_EXPECTED_PROBES = {
    ("density-decrease", OptimizationKnob.TARGET_DENSITY, -0.05),
    ("density-increase", OptimizationKnob.TARGET_DENSITY, 0.05),
    ("padding-decrease", OptimizationKnob.CELL_PADDING_X, -1),
    ("padding-increase", OptimizationKnob.CELL_PADDING_X, 1),
    ("routability-toggle", OptimizationKnob.ROUTABILITY_OPT, None),
}


class Gate0Error(RuntimeError):
    """The pilot cannot produce trustworthy Gate 0 evidence."""


class PilotCandidateExecutionError(Gate0Error):
    """A candidate consumed execution budget but did not complete successfully."""

    def __init__(self, receipt: CandidateExecutionReceipt) -> None:
        super().__init__("candidate execution did not succeed")
        self.receipt = receipt


@dataclass(frozen=True)
class PilotCandidateRun:
    observation: TerminalObservation
    receipt: CandidateExecutionReceipt


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Gate0Snapshot(_Model):
    path: str
    sha256: str

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        path = Path(value)
        if not value or path.is_absolute() or ".." in path.parts or "\x00" in value:
            raise ValueError("snapshot path must be safe and relative")
        return value

    @field_validator("sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("snapshot hash is invalid")
        return value


class Gate0Design(_Model):
    design_id: str
    top_module: str
    clock_name: str
    baseline_replay_count: Literal[1, 3] = 3
    rtl: Gate0Snapshot
    filelist: Gate0Snapshot
    sdc: Gate0Snapshot

    @field_validator("design_id", "top_module", "clock_name")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("design identifier is invalid")
        return value


class Gate0Baseline(_Model):
    frequency_mhz: StrictInt | StrictFloat = Field(gt=0)
    max_fanout: StrictInt = Field(gt=0)
    utilitization: StrictFloat = Field(gt=0, le=1)
    target_density: StrictFloat = Field(ge=0.1, le=0.95)
    target_overflow: StrictInt | StrictFloat = Field(ge=0, le=1)
    cell_padding_sites: StrictInt = Field(ge=1, le=2)
    routability_opt: StrictBool


class Gate0Probe(_Model):
    probe_id: str
    knob_id: OptimizationKnob
    delta: StrictInt | StrictFloat | None

    @field_validator("probe_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("probe id is invalid")
        return value


class Gate0Config(_Model):
    schema_version: Literal["ecos.optimization_gate0_config.v1"]
    pdk_root: str
    default_replays: Literal[3]
    terminal_timeout_seconds: StrictInt | StrictFloat = Field(gt=0)
    baseline: Gate0Baseline
    probes: tuple[Gate0Probe, ...] = Field(min_length=5, max_length=5)
    designs: tuple[Gate0Design, ...] = Field(min_length=1)

    @field_validator("pdk_root")
    @classmethod
    def validate_pdk_root(cls, value: str) -> str:
        if not value or "\x00" in value:
            raise ValueError("PDK root is invalid")
        return value

    @model_validator(mode="after")
    def validate_experiment(self) -> "Gate0Config":
        probes = {(item.probe_id, item.knob_id, item.delta) for item in self.probes}
        if probes != _EXPECTED_PROBES:
            raise ValueError("Gate 0 probes do not match the frozen pilot design")
        ids = [item.design_id for item in self.designs]
        if len(ids) != len(set(ids)):
            raise ValueError("Gate 0 design ids must be unique")
        return self


def load_gate0_config(config_path: Path) -> Gate0Config:
    path = Path(config_path).resolve()
    try:
        config = Gate0Config.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Gate0Error("Gate 0 config is invalid") from exc
    for design in config.designs:
        for snapshot in (design.rtl, design.filelist, design.sdc):
            candidate = _snapshot_path(path, snapshot)
            if candidate.is_symlink() or not candidate.is_file():
                raise Gate0Error(f"snapshot is unavailable: {snapshot.path}")
            if file_sha256(candidate) != snapshot.sha256:
                raise Gate0Error(f"snapshot hash does not match: {snapshot.path}")
    return config


def noise_profile(default_replays: Sequence[TerminalObservation]) -> dict[str, dict[str, float]]:
    if len(default_replays) < 2 or any(not item.eligible_for_incumbent for item in default_replays):
        raise Gate0Error("default replays cannot define a noise profile")
    rows = [_all_metrics(item) for item in default_replays]
    keys = tuple(rows[0])
    return {
        "reference": {key: float(statistics.median(row[key] for row in rows)) for key in keys},
        "epsilon": {key: max(row[key] for row in rows) - min(row[key] for row in rows) for key in keys},
    }


def compare_observations(
    reference: Mapping[str, float],
    candidate: TerminalObservation,
    epsilon: Mapping[str, float],
) -> str:
    if not candidate.eligible_for_incumbent:
        return "candidate_ineligible"
    metrics = _all_metrics(candidate)
    required = {item.value for item in (*ROUTABILITY_OBJECTIVE_ORDER, *TIMING_GUARDRAIL_ORDER)}
    if set(reference) != required or set(epsilon) != required:
        raise Gate0Error("noise comparison metrics are incomplete")
    for metric in TIMING_GUARDRAIL_ORDER:
        key = metric.value
        if metrics[key] < reference[key] - epsilon[key]:
            return "timing_regression"
    for metric in ROUTABILITY_OBJECTIVE_ORDER:
        key = metric.value
        if metrics[key] < reference[key] - epsilon[key]:
            return "better"
        if metrics[key] > reference[key] + epsilon[key]:
            return "worse"
    return "noise_tie"


def qualify_design(
    canonical: TerminalObservation,
    default_replays: Sequence[TerminalObservation],
    probes: Mapping[str, TerminalObservation],
) -> dict[str, object]:
    if len(default_replays) != 3 or set(probes) != {item[0] for item in _EXPECTED_PROBES}:
        raise Gate0Error("Gate 0 design evidence is incomplete")
    profile = noise_profile(default_replays)
    reference, epsilon = profile["reference"], profile["epsilon"]
    details = {
        probe_id: {
            "eligible": observation.eligible_for_incumbent,
            "distinct": _is_distinct(reference, observation, epsilon),
            "comparison": compare_observations(reference, observation, epsilon),
        }
        for probe_id, observation in sorted(probes.items())
    }
    distinct = sum(bool(item["distinct"]) for item in details.values())
    improving = [key for key, item in details.items() if item["comparison"] == "better"]
    best = min(improving, key=lambda key: _objective_tuple(probes[key]), default=None)
    defaults_eligible = all(item.eligible_for_incumbent for item in default_replays)
    return {
        "qualified": canonical.eligible_for_incumbent and defaults_eligible and distinct >= 2 and bool(improving),
        "canonical_eligible": canonical.eligible_for_incumbent,
        "default_replays_eligible": defaults_eligible,
        "distinct_probe_count": distinct,
        "improving_probe_count": len(improving),
        "best_probe_id": best,
        "noise_profile": profile,
        "probes": details,
    }


def qualify_pool(designs: Mapping[str, Mapping[str, object]]) -> dict[str, object]:
    all_qualified = bool(designs) and all(item.get("qualified") is True for item in designs.values())
    best = {item.get("best_probe_id") for item in designs.values() if item.get("best_probe_id")}
    return {
        "qualified": all_qualified and len(best) > 1,
        "all_designs_qualified": all_qualified,
        "best_probe_diversity": len(best),
    }


def require_terminal_receipt(receipt: CandidateExecutionReceipt) -> CandidateExecutionEvidence:
    if not receipt.started or receipt.outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED:
        raise Gate0Error("candidate execution did not succeed")
    if receipt.evidence is None:
        raise Gate0Error("candidate terminal evidence is missing")
    if receipt.parameter_application_receipt is None:
        raise Gate0Error("candidate native parameter application receipt is missing")
    return receipt.evidence


def readiness_report(config_path: Path) -> dict[str, object]:
    path = Path(config_path).resolve()
    config = load_gate0_config(path)
    pdk_root = (path.parent / config.pdk_root).resolve()
    required_pdk = (
        "prtech/techLEF/N551P6M_ecos.lef",
        "IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CH/lef/ics55_LLSC_H7CH_ecos.lef",
        "IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CH/liberty/ics55_LLSC_H7CH_typ_tt_1p2_25_nldm.lib",
    )
    if pdk_root.is_symlink() or any(not (pdk_root / item).is_file() for item in required_pdk):
        raise Gate0Error("ICS55 PDK readiness check failed")
    executable = _ecc_executable()
    version = subprocess.run(
        [str(executable), "--version"], check=True, capture_output=True, text=True, timeout=30
    ).stdout.strip()
    budget = EpisodeBudget.from_reference_rerun(1)
    if budget.minimum_candidate_executions != CANDIDATE_EXECUTION_LIMIT:
        raise Gate0Error("pilot minimum candidate budget is inconsistent")
    values = _baseline_values(config.baseline)
    for probe in config.probes:
        _probe_request(probe, values)
    return {
        "schema_version": "ecos.optimization_gate0_readiness.v1",
        "ready": True,
        "config_sha256": file_sha256(path),
        "ecc": {"executable": str(executable), "version": version},
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "pdk": {"root": str(pdk_root), "site_width_dbu": _pdk_site_width_dbu(pdk_root)},
        "pilot_minimum_candidate_executions": budget.minimum_candidate_executions,
        "designs": [
            {
                "design_id": design.design_id,
                "top_module": design.top_module,
                "clock_name": design.clock_name,
                "input_sha256": {
                    key: getattr(design, key).sha256 for key in ("rtl", "filelist", "sdc")
                },
            }
            for design in config.designs
        ],
    }


def run_gate0(
    config_path: Path,
    results_root: Path,
    *,
    run_id: str,
    design_ids: Sequence[str] = (),
    max_workers: int = 3,
) -> dict[str, object]:
    if not _ID.fullmatch(run_id):
        raise Gate0Error("run id is invalid")
    if type(max_workers) is not int or max_workers <= 0:
        raise Gate0Error("max workers must be a positive integer")
    config_path = Path(config_path).resolve()
    config = load_gate0_config(config_path)
    readiness = readiness_report(config_path)
    selected = tuple(item for item in config.designs if not design_ids or item.design_id in design_ids)
    if not selected or set(design_ids) - {item.design_id for item in selected}:
        raise Gate0Error("selected Gate 0 design is invalid")
    run_root = Path(results_root).resolve() / run_id
    if run_root.exists():
        raise Gate0Error("Gate 0 run directory already exists")
    run_root.mkdir(parents=True)
    _write_json(run_root / "run-manifest.v1.json", {
        "schema_version": "ecos.optimization_gate0_run.v1",
        "run_id": run_id,
        "config_sha256": readiness["config_sha256"],
        "design_ids": [item.design_id for item in selected],
        "max_workers": max_workers,
        "readiness": readiness,
    })
    reports: dict[str, dict[str, object]] = {}
    execution_slots = threading.BoundedSemaphore(max_workers)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            results = executor.map(
                lambda design: _run_design(
                    config_path,
                    config,
                    design,
                    run_root / design.design_id,
                    readiness,
                    max_workers=max_workers,
                    execution_slots=execution_slots,
                ),
                selected,
            )
            reports = {
                design.design_id: report for design, report in zip(selected, results)
            }
    except Exception as exc:
        _write_json(run_root / "failure.v1.json", {"error_type": type(exc).__name__, "message": str(exc)})
        raise
    pool = qualify_pool(reports)
    summary = {
        "schema_version": "ecos.optimization_gate0_summary.v1",
        "run_id": run_id,
        "designs": reports,
        "pool": pool,
    }
    _write_json(run_root / "gate0-summary.v1.json", summary)
    return summary


def _run_design(
    config_path: Path,
    config: Gate0Config,
    design: Gate0Design,
    output: Path,
    readiness: Mapping[str, object],
    *,
    max_workers: int,
    execution_slots: threading.Semaphore,
) -> dict[str, object]:
    output.mkdir(parents=True)
    workspace = output / "workspace"
    executable = Path(readiness["ecc"]["executable"])  # type: ignore[index]
    with execution_slots:
        client = EccContentLengthRpcClient(executable, response_timeout_seconds=30)
        try:
            canonical = _run_canonical(
                config_path, config, design, workspace, output, client, readiness
            )
        finally:
            client.close()
    workspace_id = canonical["workspace_id"]
    observation = canonical["observation"]
    if not isinstance(workspace_id, str) or not isinstance(observation, TerminalObservation):
        raise Gate0Error("canonical baseline record is invalid")
    site_width = int(readiness["pdk"]["site_width_dbu"])  # type: ignore[index]
    values = _baseline_values(config.baseline)
    specs = [
        (
            f"default-replay-{index}",
            RequestedKnobValue(
                knob_id=OptimizationKnob.TARGET_DENSITY,
                value=config.baseline.target_density,
            ),
            StrategyDirection.INCREASE,
        )
        for index in range(1, config.default_replays + 1)
    ] + [
        (
            probe.probe_id,
            _probe_request(probe, values),
            _probe_direction(probe, values[probe.knob_id.value]),
        )
        for probe in config.probes
    ]

    def execute(spec: tuple[str, RequestedKnobValue, StrategyDirection]) -> TerminalObservation:
        candidate_id, requested, direction = spec
        with execution_slots:
            candidate_client = EccContentLengthRpcClient(
                executable, response_timeout_seconds=30
            )
            try:
                candidate_workspace_id = candidate_client.open_workspace(workspace)
                return run_pilot_candidate(
                    candidate_client,
                    candidate_workspace_id,
                    workspace,
                    site_width,
                    observation,
                    requested,
                    direction,
                    candidate_id,
                    output / candidate_id,
                    readiness["config_sha256"],
                    float(config.terminal_timeout_seconds),
                ).observation
            finally:
                candidate_client.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        candidate_observations = list(executor.map(execute, specs))
    defaults = candidate_observations[: config.default_replays]
    probes = dict(
        zip(
            (probe.probe_id for probe in config.probes),
            candidate_observations[config.default_replays :],
        )
    )
    report = qualify_design(observation, defaults, probes)
    report["canonical"] = observation.model_dump(mode="json")
    report["default_replays"] = [item.model_dump(mode="json") for item in defaults]
    report["probe_observations"] = {
        key: item.model_dump(mode="json") for key, item in probes.items()
    }
    _write_json(output / "design-summary.v1.json", report)
    return report


def _run_canonical(
    config_path: Path,
    config: Gate0Config,
    design: Gate0Design,
    workspace: Path,
    output: Path,
    client: EccContentLengthRpcClient,
    readiness: Mapping[str, object],
) -> dict[str, object]:
    pdk_root = readiness["pdk"]["root"]  # type: ignore[index]
    site_width = int(readiness["pdk"]["site_width_dbu"])  # type: ignore[index]
    baseline = config.baseline
    create_request = {
        "directory": str(workspace),
        "filelist": str(_snapshot_path(config_path, design.filelist)),
        "flowConfig": {"start_step": "Synthesis", "end_step": "Harden", "steps": list(GUI_WORKSPACE_FLOW_STEPS)},
        "originDef": "",
        "originVerilog": "",
        "parameters": {
            "Clock": design.clock_name,
            "Design": design.design_id,
            "Top module": design.top_module,
            "Frequency max [MHz]": baseline.frequency_mhz,
            "Max fanout": baseline.max_fanout,
            "Target density": baseline.target_density,
            "Target overflow": baseline.target_overflow,
            "Cell padding x": baseline.cell_padding_sites * site_width,
            "Routability opt flag": int(baseline.routability_opt),
            "Core": {"Utilitization": baseline.utilitization},
        },
        "pdk": "ics55",
        "pdkJson": None,
        "pdkRoot": pdk_root,
        "rtlList": [str(_snapshot_path(config_path, design.rtl))],
        "sdc": str(_snapshot_path(config_path, design.sdc)),
    }
    _write_json(output / "workspace-create-request.v1.json", create_request)
    started = time.monotonic()
    created = _pilot_request(client, "workspace.create", create_request, timeout_seconds=120)
    workspace_id = created.get("workspaceId")
    if not isinstance(workspace_id, str) or not _ID.fullmatch(workspace_id):
        raise Gate0Error("workspace.create returned an invalid workspace id")
    flow_request = {
        "workspaceId": workspace_id,
        "rerun": False,
        "origin": "gui",
        "idempotencyKey": f"gate0.{design.design_id}.canonical",
    }
    _write_json(output / "flow-start-request.v1.json", flow_request)
    operation = _pilot_request(client, "operation.start_flow", flow_request, timeout_seconds=30)
    terminal = _wait_operation(client, operation, float(config.terminal_timeout_seconds))
    _write_json(output / "flow-terminal-result.v1.json", terminal)
    if terminal.get("state") != "succeeded":
        raise Gate0Error("canonical flow did not succeed")
    observation = build_terminal_observation(workspace)
    _write_json(output / "canonical-observation.v1.json", observation.model_dump(mode="json"))
    _write_json(output / "canonical-runtime.v1.json", {"elapsed_seconds": time.monotonic() - started})
    if not observation.eligible_for_incumbent:
        raise Gate0Error("canonical baseline is not terminal eligible")
    return {"workspace_id": workspace_id, "observation": observation}


class _RecordingRpc:
    def __init__(self, client: EccContentLengthRpcClient) -> None:
        self.client = client
        self.call_record: dict[str, object] | None = None
        self.terminal_record: dict[str, object] | None = None

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        response = self.client.call(method, params)
        self.call_record = {"method": method, "params": params, "response": response}
        return response

    def wait_for_terminal(self, operation_id: str, timeout_seconds: float) -> dict[str, object] | None:
        self.terminal_record = self.client.wait_for_terminal(operation_id, timeout_seconds)
        return self.terminal_record


def run_pilot_candidate(
    client: EccContentLengthRpcClient,
    workspace_id: str,
    workspace: Path,
    site_width: int,
    baseline: TerminalObservation,
    requested: RequestedKnobValue,
    direction: StrategyDirection,
    candidate_id: str,
    output: Path,
    config_sha256: object,
    timeout_seconds: float,
    *,
    episode_id: str = "gate0-pilot",
    parent_candidate_root_ref: str | None = None,
    rationale_summary: str = "Execute one frozen Gate 0 local-sensitivity probe.",
    knowledge_refs: Sequence[KnowledgeReference] = (),
) -> PilotCandidateRun:
    output.mkdir()
    request = _candidate_execution_request(
        candidate_id,
        requested,
        direction,
        baseline,
        str(config_sha256),
        _pilot_context_sha256(
            workspace,
            site_width,
            baseline,
            requested,
            episode_id,
            parent_candidate_root_ref,
        ),
        episode_id=episode_id,
        parent_candidate_root_ref=parent_candidate_root_ref,
        rationale_summary=rationale_summary,
        knowledge_refs=knowledge_refs,
    )
    _write_json(output / "candidate-request.v1.json", {
        "intervention_id": request.intervention_id,
        "episode_id": request.episode_id,
        "checkpoint_id": request.checkpoint_id,
        "context_sha256": request.context_sha256,
        "parent_candidate_root_ref": request.parent_candidate_root_ref,
        "proposal": request.proposal.model_dump(mode="json"),
        "requested": request.requested.model_dump(mode="json"),
    })
    recording = _RecordingRpc(client)
    adapter = EccCandidateRerunAdapter(
        recording,
        workspace_id=workspace_id,
        site_width_dbu=site_width,
        workspace_root=workspace,
    )
    started = time.monotonic()
    receipt = adapter.start(request)
    if receipt.outcome is None:
        receipt = adapter.wait_for_terminal(receipt.execution_id, timeout_seconds=timeout_seconds)
    _write_json(output / "rpc-call.v1.json", recording.call_record)
    _write_json(output / "terminal-result.v1.json", recording.terminal_record or recording.call_record)
    if receipt.evidence is not None:
        _write_json(output / "candidate-evidence.v1.json", {
            "candidate_root_ref": receipt.evidence.candidate_root_ref,
            "candidate_manifest_ref": receipt.evidence.candidate_manifest_ref,
            "candidate_manifest_sha256": receipt.evidence.candidate_manifest_sha256,
        })
    if receipt.parameter_application_receipt is not None:
        _write_json(
            output / "parameter-application-receipt.v1.json",
            receipt.parameter_application_receipt.model_dump(mode="json"),
        )
    _write_json(output / "execution-receipt.v1.json", {
        "execution_id": receipt.execution_id,
        "started": receipt.started,
        "outcome": receipt.outcome.value if receipt.outcome is not None else None,
    })
    if receipt.started and receipt.outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED:
        _write_json(output / "runtime.v1.json", {"elapsed_seconds": time.monotonic() - started})
        raise PilotCandidateExecutionError(receipt)
    evidence = require_terminal_receipt(receipt)
    observation = build_candidate_terminal_observation(workspace, evidence)
    _write_json(output / "terminal-observation.v1.json", observation.model_dump(mode="json"))
    _write_json(output / "runtime.v1.json", {"elapsed_seconds": time.monotonic() - started})
    return PilotCandidateRun(observation, receipt)


def _candidate_execution_request(
    candidate_id: str,
    requested: RequestedKnobValue,
    direction: StrategyDirection,
    baseline: TerminalObservation,
    config_sha256: str,
    context_sha256: str,
    *,
    episode_id: str,
    parent_candidate_root_ref: str | None,
    rationale_summary: str,
    knowledge_refs: Sequence[KnowledgeReference],
) -> CandidateExecutionRequest:
    proposal = OptimizationProposal.model_validate({
        "context_ref": {"episode_id": episode_id, "checkpoint_id": "canonical", "input_sha256": config_sha256},
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": rationale_summary,
        "observation_refs": [ObservationReference(
            observation_id=baseline.observation_id, sha256=baseline.evidence_manifest_sha256
        ).model_dump()],
        "knowledge_refs": [item.model_dump(mode="json") for item in knowledge_refs],
        "action": {
            "knob_id": requested.knob_id,
            "direction": direction,
            "expected_effects": [{
                "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                "direction": ExpectedEffectDirection.UNKNOWN,
            }],
        },
    })
    return CandidateExecutionRequest(
        intervention_id=candidate_id,
        episode_id=episode_id,
        checkpoint_id="canonical",
        proposal=proposal,
        requested=requested,
        context_sha256=context_sha256,
        parent_candidate_root_ref=parent_candidate_root_ref,
    )


def _pilot_context_sha256(
    workspace: Path,
    site_width_dbu: int,
    baseline: TerminalObservation,
    requested: RequestedKnobValue,
    episode_id: str,
    parent_candidate_root_ref: str | None,
) -> str:
    parent_workspace = _incumbent_workspace(workspace.resolve(), parent_candidate_root_ref)
    parent_manifest_sha256 = (
        file_sha256(parent_workspace / "analysis" / "candidate_workspace.v1.json")
        if parent_candidate_root_ref is not None
        else _parent_manifest_sha256(parent_workspace, baseline)
    )
    execution_context = _optimization_execution_context(
        parent_workspace,
        site_width_dbu,
        0,
        parent_manifest_sha256,
    )
    card = load_parameter_cards()[requested.knob_id]
    target_step = _candidate_target_step(requested.knob_id)
    context = {
        **execution_context,
        "incumbent_state_sha256": canonical_sha256(baseline.model_dump(mode="json")),
        "stage": target_step,
        "backend": "ecc",
        "tool_revision": card.tool.revision,
        "parameter_card_sha256": card_hash(card),
        "lattice_version": LATTICE_VERSION,
        "unit": card.surface.unit,
        "current_values": dict(
            sorted(_current_values(parent_workspace, site_width_dbu).items())
        ),
        "terminal_execution_contract_sha256": canonical_sha256(
            {
                "episode_id": episode_id,
                "checkpoint_id": "canonical",
                "target_step": target_step,
                "end_step": "Harden",
                "execution_scope": "full_flow",
            }
        ),
        "tool_source_sha256": card.tool.source_sha256,
    }
    return build_context_fingerprint(context)


def _candidate_target_step(knob_id: OptimizationKnob) -> str:
    if knob_id in {
        OptimizationKnob.FLOORPLAN_CORE_UTIL,
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
    }:
        return "Floorplan"
    return "fixFanout" if knob_id == OptimizationKnob.SYNTH_MAX_FANOUT else "place"


def _baseline_values(baseline: Gate0Baseline) -> dict[str, bool | int | float]:
    return {
        OptimizationKnob.TARGET_DENSITY.value: baseline.target_density,
        OptimizationKnob.CELL_PADDING_X.value: baseline.cell_padding_sites,
        OptimizationKnob.ROUTABILITY_OPT.value: baseline.routability_opt,
    }


def _probe_request(probe: Gate0Probe, values: Mapping[str, bool | int | float]) -> RequestedKnobValue:
    current = values[probe.knob_id.value]
    value = not current if probe.knob_id == OptimizationKnob.ROUTABILITY_OPT else current + probe.delta  # type: ignore[operator]
    if isinstance(value, float):
        value = round(value, 2)
    return RequestedKnobValue(knob_id=probe.knob_id, value=value)


def _probe_direction(
    probe: Gate0Probe, current: bool | int | float
) -> StrategyDirection:
    if probe.knob_id == OptimizationKnob.ROUTABILITY_OPT:
        return StrategyDirection.ENABLE if not current else StrategyDirection.DISABLE
    return StrategyDirection.DECREASE if probe.delta < 0 else StrategyDirection.INCREASE  # type: ignore[operator]


def _pilot_request(
    client: EccContentLengthRpcClient,
    method: str,
    params: dict[str, object],
    *,
    timeout_seconds: float,
) -> dict[str, object]:
    if method not in _PILOT_RPC_METHODS:
        raise Gate0Error("pilot RPC method is not allowed")
    return client._request(method, params, timeout_seconds=timeout_seconds)


def _wait_operation(
    client: EccContentLengthRpcClient, operation: Mapping[str, object], timeout_seconds: float
) -> dict[str, object]:
    if operation.get("state") in _TERMINAL_STATES:
        return dict(operation)
    operation_id = operation.get("operationId")
    if not isinstance(operation_id, str) or not _ID.fullmatch(operation_id):
        raise Gate0Error("operation id is invalid")
    terminal = client.wait_for_terminal(operation_id, timeout_seconds)
    if terminal is None:
        raise Gate0Error("operation terminal wait timed out")
    return terminal


def _snapshot_path(config_path: Path, snapshot: Gate0Snapshot) -> Path:
    base = Path(config_path).resolve().parent
    path = (base / snapshot.path).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise Gate0Error("snapshot path escapes the pilot directory") from exc
    return path


def _pdk_site_width_dbu(pdk_root: Path) -> int:
    try:
        text = (pdk_root / "prtech/techLEF/N551P6M_ecos.lef").read_text(encoding="utf-8")
    except OSError as exc:
        raise Gate0Error("PDK technology LEF is unavailable") from exc
    units = re.search(r"DATABASE\s+MICRONS\s+(\d+)", text, re.IGNORECASE)
    site = re.search(r"SITE\s+(?:core7|CoreSite)\b(?P<body>.*?)END\s+(?:core7|CoreSite)", text, re.IGNORECASE | re.DOTALL)
    size = re.search(r"SIZE\s+([0-9]+(?:\.[0-9]+)?)\s+BY", site.group("body") if site else "", re.IGNORECASE)
    if not units or not size:
        raise Gate0Error("PDK site width is unavailable")
    width = round(int(units.group(1)) * float(size.group(1)))
    if width <= 0:
        raise Gate0Error("PDK site width is invalid")
    return width


def _all_metrics(observation: TerminalObservation) -> dict[str, float]:
    return {
        **{key.value: float(value) for key, value in observation.metrics.items()},
        **{key.value: float(value) for key, value in observation.timing_guardrail.items()},
    }


def _objective_tuple(observation: TerminalObservation) -> tuple[float, ...]:
    return tuple(float(observation.metrics[key]) for key in ROUTABILITY_OBJECTIVE_ORDER)


def _is_distinct(
    reference: Mapping[str, float], observation: TerminalObservation, epsilon: Mapping[str, float]
) -> bool:
    if not observation.eligible_for_incumbent:
        return False
    return any(abs(value - reference[key]) > epsilon[key] for key, value in _all_metrics(observation).items())


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def main(argv: Sequence[str] | None = None) -> int:
    agent_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Run ECOS optimization Readiness and Gate 0")
    parser.add_argument("--config", type=Path, default=agent_root / "experiments/pilot/pilot.v1.json")
    parser.add_argument("--results-root", type=Path, default=agent_root / "experiments/pilot/results")
    parser.add_argument("--readiness-only", action="store_true")
    parser.add_argument("--run-id", default=time.strftime("gate0-%Y%m%dT%H%M%S", time.gmtime()))
    parser.add_argument("--design", action="append", default=[])
    parser.add_argument("--max-workers", type=int, default=3)
    args = parser.parse_args(argv)
    try:
        if args.readiness_only:
            report = readiness_report(args.config)
            _write_json(args.results_root / "readiness.v1.json", report)
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0
        summary = run_gate0(
            args.config,
            args.results_root,
            run_id=args.run_id,
            design_ids=args.design,
            max_workers=args.max_workers,
        )
        print(json.dumps(summary["pool"], indent=2, sort_keys=True))
        return 0 if summary["pool"]["qualified"] else 2
    except (Gate0Error, OSError, subprocess.SubprocessError, ValueError) as exc:
        print(f"Gate 0 failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
