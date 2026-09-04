"""Typed mutable state owned by one GUI provider session."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.workspace.contracts import GuiWorkspaceSetupProposal
from ecos_agent.optimization.runner import OptimizationEpisodeRunner
from ecos_agent.workspace.rerun import (
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunDiscovery,
    GuiWorkspaceRerunResolver,
)
from ecos_agent.workspace.setup import (
    WorkspaceInputs,
    recommended_workspace_setup,
)


class GuiPhase(StrEnum):
    HOME_READY = "home_ready"
    OPERATION = "operation"
    RERUN_DESIGN = "rerun_design"
    RERUN_SOURCE_RUN = "rerun_source_run"
    RERUN_WORKSPACE = "rerun_workspace"
    RERUN_STAGE = "rerun_stage"
    RERUN_PARAMETER = "rerun_parameter"
    RERUN_SCOPE = "rerun_scope"
    CONFIRMATION = "confirmation"
    WORKSPACE_PROJECT_MODE = "workspace_project_mode"
    WORKSPACE_PROJECT_ROOT = "workspace_project_root"
    WORKSPACE_NAME = "workspace_name"
    WORKSPACE_DESIGN = "workspace_design"
    WORKSPACE_FLOW_END = "workspace_flow_end"
    WORKSPACE_RTL = "workspace_rtl"
    WORKSPACE_FILELIST = "workspace_filelist"
    WORKSPACE_SDC = "workspace_sdc"
    WORKSPACE_PDK = "workspace_pdk"
    WORKSPACE_MPC = "workspace_mpc"
    WORKSPACE_TOP = "workspace_top"
    WORKSPACE_CLOCK = "workspace_clock"
    WORKSPACE_FREQUENCY = "workspace_frequency"
    WORKSPACE_MAX_FANOUT = "workspace_max_fanout"
    WORKSPACE_UTILIZATION = "workspace_utilization"
    WORKSPACE_DENSITY = "workspace_density"
    WORKSPACE_OVERFLOW = "workspace_overflow"
    WORKSPACE_CONFIRMATION = "workspace_confirmation"
    WORKSPACE_CREATION_PENDING = "workspace_creation_pending"
    WORKSPACE_RERUN_PENDING = "workspace_rerun_pending"
    WORKSPACE_CONTINUE_CONFIRMATION = "workspace_continue_confirmation"
    WORKSPACE_CONTINUE_PENDING = "workspace_continue_pending"
    WORKSPACE_SIGNOFF_INSPECTION_PENDING = "workspace_signoff_inspection_pending"
    WORKSPACE_SIGNOFF_CONFIRMATION = "workspace_signoff_confirmation"
    WORKSPACE_SIGNOFF_EXPORT_PENDING = "workspace_signoff_export_pending"
    WORKSPACE_PARAMETER_REQUEST = "workspace_parameter_request"
    WORKSPACE_PARAMETER_CONFIRMATION = "workspace_parameter_confirmation"
    WORKSPACE_PARAMETER_PENDING = "workspace_parameter_pending"
    OPTIMIZATION_WORKSPACE = "optimization_workspace"
    OPTIMIZATION_OBJECTIVE = "optimization_objective"
    OPTIMIZATION_AUTHORIZATION = "optimization_authorization"
    OPTIMIZATION_PREPARING = "optimization_preparing"
    OPTIMIZATION_RUNNING = "optimization_running"


class OptimizationUiPhase(StrEnum):
    IDLE = "idle"
    AWAITING_OBJECTIVE = "awaiting_objective"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    COMPLETED = "completed"
    STOPPED = "stopped"
    ERROR = "error"
    QUARANTINED = "quarantined"
    UNAVAILABLE = "unavailable"


@dataclass
class ProviderSession:
    session_id: str
    phase: GuiPhase = GuiPhase.HOME_READY
    mode: str = "home"
    language: str = "en"
    language_locked: bool = False
    project_root: str | None = None
    known_projects: list[tuple[str, str]] = field(default_factory=list)
    creating_project: bool = False
    design_id: str | None = None
    inherited_design_name: str | None = None
    rerun_stage: str | None = None
    rerun_resolver: GuiWorkspaceRerunResolver | None = None
    rerun_workspace_path: str | None = None
    rerun_discovery: GuiWorkspaceRerunDiscovery | None = None
    rerun_parameter_patch: list[dict[str, Any]] = field(default_factory=list)
    workspace_rerun_contract: GuiWorkspaceRerunContract | None = None
    workspace_setup: GuiWorkspaceSetupProposal = field(
        default_factory=recommended_workspace_setup
    )
    workspace_inputs: WorkspaceInputs = field(default_factory=WorkspaceInputs)
    path_recommendations: dict[str, str] = field(default_factory=dict)
    workspace_setup_id: str | None = None
    mpc_selection: bool | None = None
    workspace_contract: dict[str, Any] | None = None
    workspace_continue_id: str | None = None
    workspace_parameter_update: dict[str, Any] | None = None
    workspace_signoff_id: str | None = None
    workspace_signoff_workspace: str | None = None
    active_interrupt: Callable[[], None] | None = None
    active_tool_message_id: str | None = None
    active_turn_id: str | None = None
    active_turn_started_at: int | None = None
    active_local_activities: dict[str, dict[str, Any]] = field(default_factory=dict)
    interrupt_requested: bool = False
    running: bool = False
    optimization_phase: OptimizationUiPhase = OptimizationUiPhase.IDLE
    optimization_episode_id: str | None = None
    optimization_runner: OptimizationEpisodeRunner | None = None
    optimization_provider: CodexAppServerProposalProvider | None = None
    optimization_thread: threading.Thread | None = None
    optimization_stop: threading.Event = field(default_factory=threading.Event)
    optimization_pause: threading.Event = field(default_factory=threading.Event)
    optimization_turn_count: int = 0
    optimization_objective: dict[str, Any] | None = None
    optimization_objective_sha256: str | None = None
    optimization_primary_metric: str | None = None
    optimization_objective_alignment: dict[str, Any] | None = None
    optimization_active_objective: dict[str, Any] | None = None
    codex_provider: CodexAppServerProposalProvider | None = None
    pending_interaction: dict[str, Any] | None = None
    interaction_retry: dict[str, Any] | None = None
    interaction_history: dict[str, str] = field(default_factory=dict)
    interaction_undo: list[dict[str, Any]] = field(default_factory=list)
    state_lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def __setattr__(self, name: str, value: object) -> None:
        if name == "phase":
            try:
                value = GuiPhase(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"unknown GUI phase: {value}") from exc
        elif name == "optimization_phase":
            try:
                value = OptimizationUiPhase(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"unknown optimization UI phase: {value}") from exc
        super().__setattr__(name, value)
