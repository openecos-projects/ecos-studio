"""Controlled, deterministic interaction provider for the ECOS Agent GUI."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.codex_provider import (
    CodexAppServerProposalProvider,
    CodexProviderError,
    create_required_codex_provider,
    validate_required_codex_cli,
)
from ecos_agent.contracts import (
    GuiChatResponseProposal,
    GuiWorkspaceSetupProposal,
    SourceSearchProposal,
    StageRoutingProposal,
)
from ecos_agent.knowledge_bundle import KnowledgeAnswer
from ecos_agent.knowledge_retriever import GlobalKnowledgeRetriever, load_production_retrieval_config
from ecos_agent.source_retriever import SourceCodeRetriever, SourceSearchResult
from ecos_agent.step_knowledge import StepKnowledge, load_default_general_knowledge, load_default_step_knowledge
from ecos_agent.messages import (
    cancellation_message,
    confirmation_choice,
    confirmation_menu,
    default_value_choice,
    design_name_prompt,
    default_value_prompt,
    flow_end_choice,
    flow_end_prompt,
    home_ready_choice,
    home_ready_prompt,
    invalid_choice,
    invalid_value,
    keep_parameters_choice,
    known_project_choice,
    language_for_text,
    number_default_choice,
    number_prompt,
    mpc_choice,
    mpc_prompt,
    numbered_choice,
    operation_choice,
    operation_prompt,
    optimization_authorization_prompt,
    optimization_started_message,
    optimization_workspace_prompt,
    optional_file_choice,
    optional_file_prompt,
    pdk_prompt,
    project_mode_choice,
    project_mode_prompt,
    project_root_prompt,
    recommended_path_choice,
    unmatched_operation_prompt,
    rerun_no_parameters_prompt,
    rerun_parameter_prompt,
    rerun_scope_prompt,
    rerun_scope_choice,
    resolve_emptyable_answer,
    rerun_design_prompt,
    rerun_stage_prompt,
    rerun_stage_choice,
    rerun_workspace_choice,
    rerun_workspace_prompt,
    rtl_prompt,
    source_run_choice,
    source_run_prompt,
    welcome_message,
    workspace_confirmation_prompt,
    workspace_continue_prompt,
    workspace_continue_title,
    workspace_signoff_confirmation_prompt,
    workspace_signoff_choice,
    workspace_signoff_inspection_prompt,
    workspace_creation_failed,
    workspace_execution_started,
    workspace_name_prompt,
    workspace_parameter_request_prompt,
)
from ecos_agent.workspace_setup import (
    WorkspaceInputs,
    derive_project_name,
    discover_ecos_pdk_paths,
    discover_design_file_candidates,
    infer_design_defaults,
    merge_workspace_inputs,
    merge_workspace_setup,
    normalize_identifier,
    normalize_path,
    optional_path,
    parse_number,
    recommended_workspace_name,
    recommended_workspace_setup,
    workspace_search_roots,
    workspace_setup_contract,
)
from ecos_agent.knob_registry import resolve_write
from ecos_agent.workspace_rerun import (
    BOOLEAN_RERUN_KNOBS,
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunDiscovery,
    GuiWorkspaceRerunParameterProposal,
    GuiWorkspaceRerunResolver,
    catalog_end_step,
)
from ecos_agent.provider_support import (
    CreateBootstrap,
    _allowed_operation_options,
    _confirm_workspace_execution,
    _deterministic_operation_choice,
    _extract_create_bootstrap,
    _flow_steps,
    _gui_workspace_codex_provider,
    _gui_workspace_request_context,
    _handle_workspace_rerun_result,
    _workspace_continue_result,
    _workspace_signoff_inspection_result,
    _workspace_signoff_result,
    _keyword_operation_choice,
    _number_default,
    _operation_choice,
    _optional_text,
    _path_was_explicitly_provided,
    _prompt_for_phase,
    _propose_gui_chat_response,
    _propose_source_retrieval,
    _propose_stage_routing,
    _propose_gui_workspace_path_discovery,
    _propose_gui_workspace_rerun_patch,
    _propose_gui_workspace_setup,
    _recommended_path,
    _rerun_resolver,
    _required_message,
    _tunable_workspace_parameters,
    _validate_workspace_input_roots,
    _validate_workspace_parameter_patch,
    _validated_path_recommendations,
    _workspace_creation_result,
    _workspace_inputs_payload,
    _workspace_rerun_execution_contract,
)
from ecos_agent.optimization_contracts import OptimizationEpisodeState
from ecos_agent.optimization_runner import OptimizationEpisodeRunner


PROVIDER_ID = "ecos_agent"
_WorkspaceSetupParser = Callable[[dict[str, Any]], GuiWorkspaceSetupProposal | dict[str, Any]]
_WorkspacePathRecommender = Callable[[dict[str, Any]], GuiWorkspaceSetupProposal | dict[str, Any]]
_RerunParameterParser = Callable[[dict[str, Any]], GuiWorkspaceRerunParameterProposal | dict[str, Any]]
_ChatResponseParser = Callable[[dict[str, Any]], GuiChatResponseProposal | dict[str, Any]]
_SourceRetrievalParser = Callable[[dict[str, Any]], SourceSearchProposal | dict[str, Any]]
_StageRoutingParser = Callable[[dict[str, Any]], StageRoutingProposal | dict[str, Any]]
_OptimizationProviderFactory = Callable[..., CodexAppServerProposalProvider]
_OptimizationRunnerFactory = Callable[
    [Mapping[str, Any], CodexAppServerProposalProvider], OptimizationEpisodeRunner
]
_CHAT_GREETING_PREFIXES = ("hello", "hi", "hey", "你好", "您好", "嗨")
_GREETING_PATTERN = re.compile(
    r"^(?:hello|hi|hey|你好|您好|嗨)[\s!,.?，。！？]*$", re.IGNORECASE
)
_CHAT_QUESTION_PREFIXES = (
    "what ",
    "why ",
    "how ",
    "can you ",
    "could you ",
    "tell me ",
    "请问",
    "什么",
    "为什么",
    "如何",
    "怎么",
)


def _project_root_for_workspace(workspace: str) -> str | None:
    parent = Path(workspace).expanduser().resolve().parent
    if (parent / "project.json").is_file():
        return str(parent)
    return None


def _is_conversational_input(message: str) -> bool:
    normalized = " ".join(message.casefold().split())
    return (
        normalized.startswith(_CHAT_GREETING_PREFIXES)
        or normalized.startswith(_CHAT_QUESTION_PREFIXES)
        or normalized.endswith(("?", "？"))
    )


def _is_greeting(message: str) -> bool:
    return bool(_GREETING_PATTERN.fullmatch(message))


def _proposal_sha256(proposal: StageRoutingProposal) -> str:
    payload = json.dumps(proposal.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _known_projects(value: object) -> list[tuple[str, str]]:
    if not isinstance(value, list):
        return []
    projects: list[tuple[str, str]] = []
    for item in value[:32]:
        if not isinstance(item, Mapping):
            continue
        path = _optional_text(item.get("path"))
        if not path:
            continue
        name = _optional_text(item.get("name")) or Path(path).name
        projects.append((f"{name} — {path}", path))
    return projects


def _design_id_for_workspace(workspace: str) -> str | None:
    root = Path(workspace)
    parameters_path = root / "home" / "parameters.json"
    if parameters_path.is_file():
        try:
            payload = json.loads(parameters_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = None
        if isinstance(payload, dict):
            design = payload.get("Design")
            if isinstance(design, str) and design.strip():
                return design.strip()
    # Prefer known ECC output locations; avoid full-tree rglob on large workspaces.
    for pattern in (
        "place_dreamplace/output/*_place.*",
        "*/output/*_place.*",
    ):
        for path in root.glob(pattern):
            name = path.name
            marker = "_place."
            if marker in name:
                return name.split(marker, 1)[0]
    dirname = root.name.strip()
    return dirname or None


_NUMERIC_FIELDS = {
    "Frequency Max (MHz)": "frequency_mhz",
    "Max Fanout": "max_fanout",
    "Die Area Utilization": "utilitization",
    "Placement Target Density": "target_density",
    "Placement Target Overflow": "target_overflow",
}


@dataclass
class _Session:
    session_id: str
    phase: str = "home_ready"
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
    workspace_setup: GuiWorkspaceSetupProposal = field(default_factory=recommended_workspace_setup)
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
    interrupt_requested: bool = False
    running: bool = False
    optimization_phase: str = "idle"
    optimization_episode_id: str | None = None
    optimization_runner: OptimizationEpisodeRunner | None = None
    optimization_provider: CodexAppServerProposalProvider | None = None
    optimization_thread: threading.Thread | None = None
    optimization_stop: threading.Event = field(default_factory=threading.Event)
    optimization_pause: threading.Event = field(default_factory=threading.Event)
    optimization_turn_count: int = 0


class EcosAgentProvider:
    """Own the GUI state machine; only frozen contracts can trigger execution."""

    def __init__(
        self,
        *,
        emit: Callable[[dict[str, Any]], None],
        workspace_setup_parser: _WorkspaceSetupParser | None = None,
        workspace_path_recommender: _WorkspacePathRecommender | None = None,
        rerun_parameter_parser: _RerunParameterParser | None = None,
        knowledge: tuple[StepKnowledge, ...] | None = None,
        chat_response_parser: _ChatResponseParser | None = None,
        stage_routing_parser: _StageRoutingParser | None = None,
        source_retrieval_parser: _SourceRetrievalParser | None = None,
        source_retriever: SourceCodeRetriever | None = None,
        optimization_provider_factory: _OptimizationProviderFactory | None = None,
        optimization_runner_factory: _OptimizationRunnerFactory | None = None,
    ) -> None:
        self.emit = emit
        self.workspace_setup_parser = workspace_setup_parser or _propose_gui_workspace_setup
        self._uses_default_workspace_path_discovery = workspace_path_recommender is None
        self.workspace_path_recommender = workspace_path_recommender or _propose_gui_workspace_path_discovery
        self.rerun_parameter_parser = rerun_parameter_parser or _propose_gui_workspace_rerun_patch
        self.knowledge = knowledge or load_default_step_knowledge()
        bundles = self.knowledge if knowledge is not None else (*self.knowledge, load_default_general_knowledge())
        self.knowledge_retriever = GlobalKnowledgeRetriever(
            bundles, config=load_production_retrieval_config()
        )
        self.chat_response_parser = chat_response_parser or _propose_gui_chat_response
        self._uses_default_stage_routing = stage_routing_parser is None
        self.stage_routing_parser = stage_routing_parser or _propose_stage_routing
        self._uses_default_source_retrieval = source_retrieval_parser is None
        self.source_retrieval_parser = source_retrieval_parser or _propose_source_retrieval
        self.source_retriever = source_retriever or SourceCodeRetriever()
        self.optimization_provider_factory = (
            optimization_provider_factory or create_required_codex_provider
        )
        self.optimization_runner_factory = optimization_runner_factory
        self.sessions: dict[str, _Session] = {}
        self.stopped = False
        self._started = False

    def start(self, _request: Mapping[str, Any] | None = None) -> None:
        validate_required_codex_cli()
        self.stopped = False
        self._started = True

    def start_session(self, request: Mapping[str, Any]) -> dict[str, str]:
        session_id = _optional_text(request.get("sessionId")) or uuid.uuid4().hex
        session = self.sessions.setdefault(session_id, _Session(session_id=session_id))
        directory = _optional_text(request.get("directory"))
        if directory:
            session.rerun_workspace_path = directory
        project_root = _optional_text(request.get("projectRoot"))
        if project_root:
            session.project_root = project_root
        elif directory:
            session.project_root = _project_root_for_workspace(directory)
        mode = _optional_text(request.get("mode"))
        if mode in {"home", "workspace"}:
            session.mode = mode
        session.known_projects = _known_projects(request.get("knownProjects"))
        if directory:
            session.inherited_design_name = _design_id_for_workspace(directory)
        # Directory alone is only a rerun default; GUI must pass mode explicitly.
        session.phase = "operation" if session.mode == "workspace" else "home_ready"
        self._emit_status(session, "idle")
        self._emit(
            session,
            "message",
            welcome_message(
                mode=session.mode,
                workspace=session.rerun_workspace_path or "",
                project=session.project_root or "",
            ),
        )
        if session.mode == "home":
            self._emit(session, "message", home_ready_prompt(session.language))
        self._emit_phase_choice(session)
        return {"sessionId": session_id}

    def send_message(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        message = _required_message(request.get("message"))
        if self._optimization_thread_active(session):
            self._handle_optimization_control(session, message)
            return {
                "messageId": uuid.uuid4().hex,
                "sessionId": session.session_id,
                "turnId": uuid.uuid4().hex,
            }
        if session.running:
            raise ValueError("An ECOS Agent turn is already running for this session.")
        if not session.language_locked:
            session.language = language_for_text(message)
            session.language_locked = True
        turn_id = uuid.uuid4().hex
        session.active_turn_id = turn_id
        session.active_tool_message_id = f"{turn_id}-tool"
        session.interrupt_requested = False
        session.running = True
        self._emit_status(session, "running")
        interrupted = False
        try:
            self._handle_input(session, message)
            self._check_interrupted(session)
        except CodexProviderError as exc:
            if exc.failure_class != "interrupted":
                self._emit_status(session, "error")
                raise
            interrupted = True
            self._emit(session, "message", "The current Agent turn was interrupted.")
            self._emit_status(session, "interrupted")
        except Exception:
            self._emit_status(session, "error")
            raise
        finally:
            session.active_interrupt = None
            session.active_tool_message_id = None
            session.active_turn_id = None
            session.running = False
        if not interrupted:
            self._emit_status(session, self._resting_status(session))
        return {"messageId": turn_id, "sessionId": session.session_id, "turnId": turn_id}

    def interrupt(self, request: Mapping[str, Any] | None = None) -> None:
        session = self._session(request or {})
        if self._optimization_thread_active(session):
            session.optimization_stop.set()
            if session.optimization_provider is not None:
                session.optimization_provider.interrupt()
            self._emit_status(session, "interrupted")
            return
        if not session.running:
            self._emit_status(session, self._resting_status(session))
            return
        session.interrupt_requested = True
        self._emit_status(session, "interrupted")
        if session.active_interrupt is not None:
            session.active_interrupt()

    def get_status(self, request: Mapping[str, Any] | None = None) -> dict[str, Any]:
        request = request or {}
        session_id = _optional_text(request.get("sessionId"))
        session = self.sessions.get(session_id) if session_id else None
        result: dict[str, Any] = {
            "activeSessionId": session_id or next(iter(self.sessions), ""),
            "providerId": PROVIDER_ID,
            "state": "stopped" if self.stopped else "ready",
        }
        if session is not None:
            result.update(
                {
                    "optimizationState": session.optimization_phase,
                    "optimizationEpisodeId": session.optimization_episode_id or "",
                    "optimizationTurnCount": session.optimization_turn_count,
                }
            )
        return result

    def set_mode(self, request: Mapping[str, Any]) -> dict[str, str]:
        return self.get_status(request)

    def list_sessions(self, _request: Mapping[str, Any] | None = None) -> dict[str, list[dict[str, str]]]:
        return {
            "sessions": [
                {"sessionId": session.session_id, "title": "ECOS Agent"}
                for session in self.sessions.values()
            ]
        }

    def resume_session(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        self._emit_status(session, self._resting_status(session))
        self._emit(session, "message", _prompt_for_phase(session))
        self._emit_phase_choice(session)
        return {"sessionId": session.session_id}

    def stop(self, _request: Mapping[str, Any] | None = None) -> None:
        for session in self.sessions.values():
            session.optimization_stop.set()
            if session.optimization_provider is not None:
                session.optimization_provider.interrupt()
        self.stopped = True
        self._started = False

    def _handle_input(self, session: _Session, message: str) -> None:
        handlers = {
            "home_ready": self._select_home_ready,
            "operation": self._select_operation,
            "rerun_design": self._select_rerun_design,
            "rerun_source_run": self._select_rerun_source_run,
            "rerun_workspace": self._select_rerun_workspace,
            "rerun_stage": self._select_rerun_stage,
            "rerun_parameter": self._select_rerun_parameter,
            "rerun_scope": self._select_rerun_scope,
            "workspace_project_mode": self._select_project_mode,
            "workspace_project_root": self._select_project_root,
            "workspace_name": self._select_workspace_name,
            "workspace_design": self._select_design_name,
            "workspace_flow_end": self._select_flow_end,
            "workspace_rtl": self._select_rtl,
            "workspace_filelist": self._select_filelist,
            "workspace_sdc": self._select_sdc,
            "workspace_pdk": self._select_pdk,
            "workspace_mpc": self._select_mpc,
            "workspace_top": self._select_top_module,
            "workspace_clock": self._select_clock,
            "workspace_frequency": self._select_frequency,
            "workspace_max_fanout": self._select_max_fanout,
            "workspace_utilization": self._select_utilization,
            "workspace_density": self._select_density,
            "workspace_overflow": self._select_overflow,
            "workspace_confirmation": self._confirm_workspace_execution,
            "workspace_creation_pending": self._handle_workspace_creation_result,
            "workspace_rerun_pending": self._handle_workspace_rerun_result,
            "workspace_continue_confirmation": self._confirm_workspace_continue,
            "workspace_continue_pending": self._handle_workspace_continue_result,
            "workspace_signoff_inspection_pending": self._handle_workspace_signoff_inspection_result,
            "workspace_signoff_confirmation": self._confirm_workspace_signoff,
            "workspace_signoff_export_pending": self._handle_workspace_signoff_result,
            "workspace_parameter_request": self._select_workspace_parameter_request,
            "workspace_parameter_confirmation": self._confirm_workspace_parameter_update,
            "workspace_parameter_pending": self._handle_workspace_parameter_update_result,
            "confirmation": self._confirm_rerun_execution,
            "optimization_workspace": self._select_optimization_workspace,
            "optimization_authorization": self._confirm_optimization_start,
        }
        handler = handlers.get(session.phase)
        if handler is None:
            self._emit(session, "error", "The current ECOS Agent session is not actionable.")
            return
        if session.phase in {"home_ready", "operation"}:
            self._handle_idle_input(session, message)
            return
        if _is_conversational_input(message):
            self._answer_non_state_input(session, message, allow_operations=False)
            return
        handler(session, message)

    def _handle_idle_input(self, session: _Session, message: str) -> None:
        if _is_conversational_input(message):
            self._answer_non_state_input(session, message, allow_operations=False)
            return
        choice = self._resolve_operation_choice(session, message)
        if choice is not None:
            if session.phase == "home_ready":
                self._select_home_ready(session, message, choice)
            else:
                self._select_operation(session, message, choice)
            return
        self._answer_non_state_input(session, message, allow_operations=True)

    def _answer_non_state_input(
        self, session: _Session, message: str, *, allow_operations: bool
    ) -> None:
        answer = self._knowledge_answer(session, message)
        source_result = self._source_code_evidence(session, message, answer)
        self._answer_with_codex(
            session,
            message,
            allow_operations=allow_operations,
            knowledge_answer=answer,
            source_result=source_result,
        )

    def _knowledge_answer(self, session: _Session, message: str) -> KnowledgeAnswer | None:
        if _is_greeting(message):
            return None
        baseline = self.knowledge_retriever.reply_global(message)
        deterministic_scope = self.knowledge_retriever.stage_scope(message)
        stages: tuple[str, ...] = ()
        routing: dict[str, object] = {
            "status": "not_requested",
            "reason": "deterministic_stage_scope",
        }
        if not deterministic_scope.candidate_stages and (
            self._started or not self._uses_default_stage_routing
        ):
            stages, routing = self._propose_knowledge_stages(session, message)
        elif not deterministic_scope.candidate_stages:
            routing = {"status": "not_requested", "reason": "provider_not_started"}
        answer = self.knowledge_retriever.reply_hybrid(
            message,
            candidate_stages=stages,
            deterministic_scope=deterministic_scope,
            routing=routing,
        )
        return answer or baseline

    def _propose_knowledge_stages(
        self, session: _Session, message: str
    ) -> tuple[tuple[str, ...], dict[str, object]]:
        context = {
            "schema_version": "flow-agent.stage_routing_request.v1",
            "natural_language_request": message,
            "stage_catalog": list(self.knowledge_retriever.stage_catalog),
            "_progress_callback": lambda text: self._progress(session, text),
            "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
        }
        try:
            proposal = StageRoutingProposal.model_validate(self.stage_routing_parser(context))
            stages = proposal.candidate_stages
            if any(stage not in self.knowledge_retriever.stage_ids for stage in stages):
                return (), {"status": "rejected", "reason": "unknown_stage"}
            return stages, {
                "status": "accepted" if stages else "abstained",
                "candidate_stages": list(stages),
                "proposal_sha256": _proposal_sha256(proposal),
            }
        except (CodexProviderError, ValueError):
            return (), {"status": "fallback", "reason": "proposal_unavailable"}

    def _source_code_evidence(
        self, session: _Session, message: str, knowledge_answer: KnowledgeAnswer | None
    ) -> SourceSearchResult | None:
        if (
            _is_greeting(message)
            or not self.source_retriever.available_root_ids
            or (self._uses_default_source_retrieval and not self._started)
        ):
            return None
        context: dict[str, Any] = {
            "schema_version": "flow-agent.source_search_request.v1",
            "natural_language_request": message,
            "available_source_roots": list(self.source_retriever.available_root_ids),
            "source_workspace_roots": [
                str(root) for root in self.source_retriever.source_workspace_roots
            ],
            "_progress_callback": lambda text: self._progress(session, text),
            "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
        }
        if knowledge_answer is not None:
            context["retrieved_knowledge"] = {
                **knowledge_answer.contract,
                "entity_ids": list(knowledge_answer.entity_ids),
                "text": knowledge_answer.text,
            }
        try:
            proposal = SourceSearchProposal.model_validate(self.source_retrieval_parser(context))
            return self.source_retriever.retrieve(proposal)
        except (CodexProviderError, ValueError):
            return None

    def _select_home_ready(self, session: _Session, message: str, choice: str) -> None:
        if choice == "1":
            self._begin_home_workspace_create(session, message if message.strip() != "1" else "")
            return
        if choice == "2":
            session.phase = "optimization_workspace"
            self._emit(session, "message", optimization_workspace_prompt(session.language))
            return

    def _select_operation(self, session: _Session, message: str, choice: str) -> None:
        if session.mode == "workspace":
            if choice == "1":
                self._begin_workspace_parameter_update(session)
                if message.strip() != "1":
                    self._select_workspace_parameter_request(session, message)
                return
            if choice == "2":
                self._begin_workspace_scoped_rerun(session)
                return
            if choice == "3":
                self._begin_workspace_continue(session)
                return
            if choice == "4" and session.project_root:
                if not session.project_root:
                    self._emit(
                        session,
                        "message",
                        "This workspace is not under a Project (no project.json parent). "
                        "Associate or create a Project before creating another workspace.",
                    )
                    self._emit_phase_choice(session)
                    return
                self._begin_create_workspace_in_project(session)
                return
            optimization_choice = "5" if session.project_root else "4"
            if choice == optimization_choice:
                self._begin_optimization_authorization(session)
                return
        elif choice == "1":
            self._begin_home_workspace_create(session, message if message.strip() != "1" else "")
            return

    def _begin_optimization_authorization(self, session: _Session) -> None:
        workspace = session.rerun_workspace_path
        if not workspace or not Path(workspace).is_dir():
            self._emit(session, "error", "An existing workspace is required for optimization.")
            self._emit_phase_choice(session)
            return
        session.phase = "optimization_authorization"
        session.optimization_phase = "awaiting_confirmation"
        session.optimization_episode_id = f"episode-{uuid.uuid4().hex}"
        self._emit(
            session,
            "message",
            optimization_authorization_prompt(session.language, workspace),
            optimization={
                "schema_version": "ecos.optimization_authorization.v1",
                "episode_id": session.optimization_episode_id,
                "workspace": workspace,
                "requires_confirmation": True,
                "execution": "fixed candidate.rerun only",
            },
        )
        self._emit_phase_choice(session)

    def _select_optimization_workspace(self, session: _Session, message: str) -> None:
        try:
            workspace = normalize_path(
                message, label="Optimization workspace", require_directory=True
            )
        except ValueError as exc:
            self._emit(
                session,
                "message",
                invalid_value(session.language, "Optimization workspace", str(exc)),
            )
            self._emit(session, "message", optimization_workspace_prompt(session.language))
            return
        session.rerun_workspace_path = workspace
        self._begin_optimization_authorization(session)

    def _confirm_optimization_start(self, session: _Session, message: str) -> None:
        if message != "1":
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            session.optimization_phase = "idle"
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        if self.optimization_runner_factory is None:
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            session.optimization_phase = "unavailable"
            self._emit(
                session,
                "error",
                "Optimization runner is not configured with observation and ECC adapters; execution is blocked.",
            )
            self._emit_phase_choice(session)
            return
        workspace = session.rerun_workspace_path
        if not workspace or session.optimization_episode_id is None:
            raise ValueError("Optimization authorization is incomplete.")
        provider: CodexAppServerProposalProvider | None = None
        try:
            provider = self.optimization_provider_factory(
                cwd=Path(workspace),
                runtime_workspace_roots=(workspace,),
                progress_callback=lambda text: self._progress(session, text),
                diagnostics_path=(
                    Path(workspace)
                    / ".agent"
                    / "optimization"
                    / session.optimization_episode_id
                    / "codex-rpc-diagnostics.v1.jsonl"
                ),
            )
            runner = self.optimization_runner_factory(
                {
                    "session_id": session.session_id,
                    "episode_id": session.optimization_episode_id,
                    "workspace": workspace,
                },
                provider,
            )
            if not isinstance(runner, OptimizationEpisodeRunner):
                raise ValueError("Optimization runner factory returned an invalid runner.")
        except Exception as exc:
            if provider is not None:
                provider.close()
            session.optimization_phase = "unavailable"
            self._emit(session, "error", f"Unable to start optimization: {exc}")
            self._emit_phase_choice(session)
            return
        assert provider is not None
        session.optimization_provider = provider
        session.optimization_runner = runner
        session.optimization_stop.clear()
        session.optimization_pause.clear()
        session.optimization_turn_count = 0
        session.optimization_phase = "running"
        session.phase = "optimization_running"
        session.active_interrupt = provider.interrupt
        self._emit(session, "message", optimization_started_message(session.language))
        self._emit_status(session, "running")
        session.optimization_thread = threading.Thread(
            target=self._run_optimization_episode,
            args=(session,),
            name=f"ecos-optimization-{session.session_id}",
            daemon=True,
        )
        session.optimization_thread.start()

    def _run_optimization_episode(self, session: _Session) -> None:
        runner = session.optimization_runner
        provider = session.optimization_provider
        if runner is None:
            return
        final_phase = "completed"
        try:
            while not session.optimization_stop.is_set():
                while session.optimization_pause.is_set() and not session.optimization_stop.wait(0.1):
                    pass
                if session.optimization_stop.is_set():
                    final_phase = "stopped"
                    break
                turn = runner.run_turn()
                session.optimization_turn_count += 1
                self._emit(
                    session,
                    "optimization",
                    f"Optimization turn {session.optimization_turn_count} finished.",
                    optimization={
                        "schema_version": "ecos.optimization_progress.v1",
                        "episode_id": runner.episode_id,
                        "state": runner.state.value,
                        "turn": session.optimization_turn_count,
                        "planning_state": turn.planning.state.value,
                        "execution_state": turn.execution.state.value if turn.execution else None,
                        "incumbent_decision": (
                            turn.incumbent_comparison.decision.value
                            if turn.incumbent_comparison
                            else None
                        ),
                        "decisive_metric": (
                            turn.incumbent_comparison.decisive_metric.value
                            if turn.incumbent_comparison and turn.incumbent_comparison.decisive_metric
                            else None
                        ),
                        "proposal_decision": (
                            turn.planning.proposal.decision.value
                            if turn.planning.proposal
                            else None
                        ),
                        "proposal_reason": (
                            turn.planning.proposal.reason_code.value
                            if turn.planning.proposal
                            else None
                        ),
                        "rejection_reason": turn.planning.rejection_reason,
                        "action": (
                            turn.planning.proposal.action.model_dump(mode="json")
                            if turn.planning.proposal and turn.planning.proposal.action
                            else None
                        ),
                        "requested": (
                            turn.planning.requested.model_dump(mode="json")
                            if turn.planning.requested
                            else None
                        ),
                        "incumbent_candidate_root_ref": (
                            runner.incumbent_candidate_root_ref
                        ),
                    },
                )
                if runner.state not in {
                    OptimizationEpisodeState.CREATED,
                    OptimizationEpisodeState.PLANNING,
                }:
                    if runner.state == OptimizationEpisodeState.QUARANTINED:
                        final_phase = "quarantined"
                    break
        except Exception as exc:
            final_phase = "error"
            self._emit(session, "error", f"Optimization episode stopped: {exc}")
        finally:
            if runner is not None:
                runner.close()
            if provider is not None:
                provider.close()
            session.active_interrupt = None
            session.optimization_provider = None
            session.optimization_runner = None
            session.optimization_thread = None
            session.optimization_phase = final_phase
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            status = {
                "completed": "idle",
                "stopped": "interrupted",
                "error": "error",
                "quarantined": "error",
            }.get(final_phase, "idle")
            self._emit_status(session, status)
            self._emit_phase_choice(session)

    @staticmethod
    def _optimization_thread_active(session: _Session) -> bool:
        return session.optimization_thread is not None and session.optimization_thread.is_alive()

    def _handle_optimization_control(self, session: _Session, message: str) -> None:
        command = message.strip().casefold()
        if command in {"pause", "暂停"}:
            session.optimization_pause.set()
            session.optimization_phase = "paused"
            self._emit_status(session, "awaiting_choice")
            return
        if command in {"resume", "继续"}:
            session.optimization_pause.clear()
            session.optimization_phase = "running"
            self._emit_status(session, "running")
            return
        if command in {"stop", "停止", "cancel", "取消"}:
            session.optimization_stop.set()
            if session.optimization_provider is not None:
                session.optimization_provider.interrupt()
            session.optimization_phase = "stopping"
            self._emit_status(session, "interrupted")
            return
        self._emit(
            session,
            "message",
            "Optimization is running. Use pause, resume, or stop.",
            optimization={
                "schema_version": "ecos.optimization_status.v1",
                "state": session.optimization_phase,
                "turn_count": session.optimization_turn_count,
            },
        )
    def _resolve_operation_choice(self, session: _Session, message: str) -> str | None:
        resolve_mode = "home" if session.phase == "home_ready" else session.mode
        allowed_options = _allowed_operation_options(
            session.language,
            mode=resolve_mode,
            allow_create_workspace_in_project=bool(session.project_root),
        )
        allowed_ids = {option["id"] for option in allowed_options}
        deterministic = _deterministic_operation_choice(message)
        if deterministic in allowed_ids:
            return deterministic
        keyword = _keyword_operation_choice(
            message, mode=resolve_mode, allowed_ids=allowed_ids
        )
        if keyword is not None:
            return keyword
        return None

    def _answer_with_codex(
        self,
        session: _Session,
        message: str,
        *,
        allow_operations: bool,
        knowledge_answer: KnowledgeAnswer | None,
        source_result: SourceSearchResult | None,
    ) -> None:
        allowed_options = self._chat_allowed_operations(session) if allow_operations else []
        response = self._parse_chat_response(
            session,
            message,
            allowed_options,
            knowledge_answer=knowledge_answer,
            source_result=source_result,
            report_error=knowledge_answer is None,
        )
        if response is None:
            if knowledge_answer is not None:
                contract = dict(knowledge_answer.contract)
                if source_result is not None:
                    contract["source_retrieval"] = source_result.contract()
                    contract["source_evidence_ids"] = []
                self._emit(
                    session, "message", knowledge_answer.text, contract=contract
                )
            return
        if response.operation is None:
            contract: dict[str, Any] = {
                "schema_version": "flow-agent.gui_chat_response.v1",
                "intent": "answer",
                "read_only": True,
                "backend": "local_codex_cli",
            }
            if knowledge_answer is not None:
                contract["knowledge"] = knowledge_answer.contract
            if source_result is not None:
                evidence_ids = {item.evidence_id for item in source_result.evidence}
                if not set(response.evidence_ids).issubset(evidence_ids):
                    self._emit(session, "error", "The answer cited unavailable source evidence.")
                    return
                contract["source_retrieval"] = source_result.contract()
                contract["source_evidence_ids"] = list(response.evidence_ids)
            self._emit(
                session,
                "message",
                response.answer or "",
                contract=contract,
            )
            return
        allowed_ids = {option["id"] for option in allowed_options}
        if response.operation not in allowed_ids:
            self._emit(session, "error", "The interpreted operation is not available in the current session.")
            return
        if session.phase == "home_ready":
            self._select_home_ready(session, message, response.operation)
        else:
            self._select_operation(session, message, response.operation)

    @staticmethod
    def _chat_allowed_operations(session: _Session) -> list[dict[str, str]]:
        if session.phase not in {"home_ready", "operation"}:
            return []
        return _allowed_operation_options(
            session.language,
            mode="home" if session.phase == "home_ready" else session.mode,
            allow_create_workspace_in_project=bool(session.project_root),
        )

    def _parse_chat_response(
        self,
        session: _Session,
        message: str,
        allowed_options: list[dict[str, str]],
        *,
        knowledge_answer: KnowledgeAnswer | None,
        source_result: SourceSearchResult | None,
        report_error: bool,
    ) -> GuiChatResponseProposal | None:
        context: dict[str, Any] = {
            "schema_version": "flow-agent.gui_chat_request_context.v1",
            "natural_language_request": message,
            "response_language": language_for_text(message),
            "mode": session.mode,
            "phase": session.phase,
            "allowed_operations": allowed_options,
            "workspace": session.rerun_workspace_path or "",
            "project_root": session.project_root or "",
            "_progress_callback": lambda text: self._progress(session, text),
            "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
        }
        if knowledge_answer is not None:
            context["retrieved_knowledge"] = {
                **knowledge_answer.contract,
                "entity_ids": list(knowledge_answer.entity_ids),
                "text": knowledge_answer.text,
            }
        if source_result is not None:
            context["retrieved_code"] = source_result.contract()
        try:
            response = GuiChatResponseProposal.model_validate(self.chat_response_parser(context))
            self._check_interrupted(session)
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            if report_error:
                self._emit(session, "error", f"Unable to answer the request: {exc}")
            return None
        return response

    def _begin_home_workspace_create(self, session: _Session, message: str) -> None:
        self._reset_workspace_setup(session)
        session.creating_project = False
        bootstrap = _extract_create_bootstrap(message) if message.strip() else CreateBootstrap()
        mode_explicit = bootstrap.creating_project is not None
        if bootstrap.creating_project is True:
            session.creating_project = True
        elif bootstrap.creating_project is False:
            session.creating_project = False
        if bootstrap.project_root:
            try:
                root = normalize_path(
                    bootstrap.project_root, label="Project Root", require_directory=True
                )
                if not session.creating_project and not (Path(root) / "project.json").is_file():
                    raise ValueError("Existing Project Root must contain project.json")
                session.workspace_inputs.project_root = root
                session.workspace_inputs.project_name = derive_project_name(root)
                session.project_root = root
                pdk_paths = discover_ecos_pdk_paths(root)
                session.path_recommendations = {"pdk": pdk_paths[0]} if pdk_paths else {}
            except ValueError:
                session.workspace_inputs.project_root = ""
                session.workspace_inputs.project_name = ""
        if bootstrap.workspace_name:
            try:
                self._update_workspace_setup(
                    session,
                    workspace_name=normalize_identifier(
                        bootstrap.workspace_name, label="Workspace Name"
                    ),
                )
            except ValueError:
                pass
        if bootstrap.design_name:
            try:
                self._update_workspace_setup(
                    session,
                    design_name=normalize_identifier(bootstrap.design_name, label="Design Name"),
                )
            except ValueError:
                pass
        flow_end_explicit = False
        if bootstrap.flow_end:
            self._update_workspace_setup(
                session, flow_start="Synthesis", flow_end=bootstrap.flow_end
            )
            flow_end_explicit = True
        self._enter_create_flow_phase(
            session,
            mode_explicit=mode_explicit,
            flow_end_explicit=flow_end_explicit,
        )

    def _enter_create_flow_phase(
        self,
        session: _Session,
        *,
        mode_explicit: bool = False,
        flow_end_explicit: bool = False,
    ) -> None:
        if not session.workspace_inputs.project_root:
            if mode_explicit:
                session.phase = "workspace_project_root"
                self._emit(
                    session,
                    "message",
                    project_root_prompt(session.language, creating=session.creating_project),
                )
            else:
                session.phase = "workspace_project_mode"
                self._emit(session, "message", project_mode_prompt(session.language))
            self._emit_phase_choice(session)
            return
        if not session.workspace_setup.workspace_name:
            session.phase = "workspace_name"
            recommendation = recommended_workspace_name(session.workspace_inputs.project_root)
            self._emit(
                session,
                "message",
                workspace_name_prompt(session.language, recommendation),
            )
            self._emit_phase_choice(session)
            return
        if not session.workspace_setup.design_name:
            session.phase = "workspace_design"
            recommendation = (
                session.inherited_design_name or session.workspace_inputs.project_name or ""
            )
            self._emit(
                session,
                "message",
                design_name_prompt(session.language, recommendation),
            )
            self._emit_phase_choice(session)
            return
        if not flow_end_explicit:
            session.phase = "workspace_flow_end"
            self._emit(session, "message", flow_end_prompt(session.language))
            self._emit_phase_choice(session)
            return
        session.phase = "workspace_rtl"
        self._emit(
            session,
            "message",
            rtl_prompt(session.language, _recommended_path(session, "rtl")),
        )
        self._emit_phase_choice(session)

    def _begin_create_workspace_in_project(self, session: _Session) -> None:
        project_root = session.project_root
        if not project_root:
            self._emit(session, "error", "No Project Root is bound to this Agent session.")
            self._emit_phase_choice(session)
            return
        self._reset_workspace_setup(session)
        session.creating_project = False
        session.workspace_inputs.project_root = project_root
        session.workspace_inputs.project_name = derive_project_name(project_root)
        pdk_paths = discover_ecos_pdk_paths(project_root)
        session.path_recommendations = {"pdk": pdk_paths[0]} if pdk_paths else {}
        session.phase = "workspace_name"
        recommendation = recommended_workspace_name(project_root)
        self._emit(
            session,
            "message",
            workspace_name_prompt(session.language, recommendation),
        )
        self._emit_phase_choice(session)

    def _select_project_mode(self, session: _Session, message: str) -> None:
        choice = _operation_choice(message)
        if choice is None:
            text = message.casefold()
            if any(
                key in text
                for key in ("已有 project", "existing project", "使用已有", "已有项目")
            ):
                choice = "1"
            elif any(
                key in text
                for key in ("新建 project", "create project", "new project", "创建项目", "新建项目")
            ):
                choice = "2"
        if choice == "1":
            session.creating_project = False
            session.phase = "workspace_project_root"
            self._emit(session, "message", project_root_prompt(session.language, creating=False))
            self._emit_phase_choice(session)
            return
        if choice == "2":
            session.creating_project = True
            session.phase = "workspace_project_root"
            self._emit(session, "message", project_root_prompt(session.language, creating=True))
            self._emit_phase_choice(session)
            return
        self._emit(session, "message", unmatched_operation_prompt(session.language))
        self._emit(session, "message", project_mode_prompt(session.language))
        self._emit_phase_choice(session)

    def _begin_workspace_scoped_rerun(self, session: _Session) -> None:
        workspace = session.rerun_workspace_path
        if not workspace:
            self._emit(session, "error", "No open workspace is bound to this Agent session.")
            self._emit_phase_choice(session)
            return
        self._progress(session, "Preparing stage rerun…")
        design = (
            session.inherited_design_name
            or session.design_id
            or _design_id_for_workspace(workspace)
        )
        if design is None:
            session.phase = "rerun_design"
            self._emit(session, "message", rerun_design_prompt(session.language))
            return
        session.design_id = design
        session.phase = "rerun_source_run"
        self._emit(
            session,
            "message",
            source_run_prompt(session.language, (workspace,)),
        )
        self._emit_phase_choice(session)

    def _begin_workspace_continue(self, session: _Session) -> None:
        workspace = session.rerun_workspace_path
        if not workspace:
            self._emit(session, "error", "No open workspace is bound to this Agent session.")
            self._emit_phase_choice(session)
            return
        session.workspace_continue_id = uuid.uuid4().hex
        session.phase = "workspace_continue_confirmation"
        self._emit(
            session,
            "contract",
            workspace_continue_prompt(session.language, workspace),
            {
                "schema_version": "flow-agent.resolved_execution_contract.v1",
                "title": workspace_continue_title(session.language),
                "presentation": "workspace_continue",
                # Continue has no reviewable knobs — keep a compact confirm card, not a Key/Value table.
                "fields": [],
            },
        )
        self._emit_phase_choice(session)

    def _confirm_workspace_continue(self, session: _Session, message: str) -> None:
        choice = _operation_choice(message)
        if choice == "2" or message.strip().lower() in {"cancel", "n", "no"}:
            self._reset(session)
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        if choice != "1" and message.strip().lower() not in {"confirm", "y", "yes", ""}:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit_phase_choice(session)
            return
        workspace = session.rerun_workspace_path
        continue_id = session.workspace_continue_id
        if not workspace or not continue_id:
            self._emit(session, "error", "Continue-flow contract is incomplete.")
            return
        session.phase = "workspace_continue_pending"
        self._emit(
            session,
            "workspace_continue",
            "Continuing the unfinished flow in the current workspace.",
            workspace_continue={
                "schema_version": "flow-agent.workspace_continue_contract.v1",
                "continue_id": continue_id,
                "workspace": workspace,
                "rerun": False,
            },
        )

    def _handle_workspace_continue_result(self, session: _Session, message: str) -> None:
        result = _workspace_continue_result(message)
        if result is None or result[0] != session.workspace_continue_id:
            self._emit(session, "error", "Continue-flow result is invalid.")
            return
        _, status, error, end_step = result
        if status == "succeeded" and end_step and end_step.lower() == "harden":
            self._begin_workspace_signoff(session, session.rerun_workspace_path or "")
            return
        self._reset(session)
        if status == "succeeded":
            self._emit(session, "message", "Flow continue finished.")
        else:
            self._emit(session, "message", f"Flow continue did not complete successfully: {error}")
        self._emit_phase_choice(session)

    def _begin_workspace_signoff(self, session: _Session, workspace: str) -> None:
        if not workspace or not workspace.startswith("/"):
            self._emit(session, "error", "Signoff workspace is unavailable.")
            self._reset(session)
            self._emit_phase_choice(session)
            return
        signoff_id = uuid.uuid4().hex
        session.workspace_signoff_id = signoff_id
        session.workspace_signoff_workspace = workspace
        session.phase = "workspace_signoff_inspection_pending"
        self._emit(
            session,
            "workspace_signoff",
            workspace_signoff_inspection_prompt(session.language),
            workspace_signoff={
                "action": "inspect",
                "schema_version": "flow-agent.workspace_signoff_contract.v1",
                "signoff_id": signoff_id,
                "workspace": workspace,
            },
        )

    def _handle_workspace_signoff_inspection_result(
        self, session: _Session, message: str
    ) -> None:
        result = _workspace_signoff_inspection_result(message)
        if result is None or result[0] != session.workspace_signoff_id:
            self._emit(session, "error", "Signoff checklist result is invalid.")
            return
        _, status, error = result
        if status == "blocked":
            self._emit(session, "error", f"Signoff export blocked: {error}")
            self._reset(session)
            self._emit_phase_choice(session)
            return
        session.phase = "workspace_signoff_confirmation"
        self._emit(session, "message", workspace_signoff_confirmation_prompt(session.language, status))
        self._emit_phase_choice(session)

    def _confirm_workspace_signoff(self, session: _Session, message: str) -> None:
        choice = _operation_choice(message)
        if choice == "2" or message.strip().lower() in {"cancel", "n", "no"}:
            self._reset(session)
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        if choice != "1" and message.strip().lower() not in {"confirm", "y", "yes", ""}:
            self._emit(session, "message", confirmation_menu(session.language))
            self._emit_phase_choice(session)
            return
        signoff_id = session.workspace_signoff_id
        workspace = session.workspace_signoff_workspace
        if not signoff_id or not workspace:
            self._emit(session, "error", "Signoff contract is incomplete.")
            return
        session.phase = "workspace_signoff_export_pending"
        self._emit(
            session,
            "workspace_signoff",
            "Exporting the signoff package after the output path is provided.",
            workspace_signoff={
                "action": "export",
                "schema_version": "flow-agent.workspace_signoff_contract.v1",
                "signoff_id": signoff_id,
                "workspace": workspace,
            },
        )

    def _handle_workspace_signoff_result(self, session: _Session, message: str) -> None:
        result = _workspace_signoff_result(message)
        if result is None or result[0] != session.workspace_signoff_id:
            self._emit(session, "error", "Signoff export result is invalid.")
            return
        _, status, error = result
        self._reset(session)
        if status == "succeeded":
            self._emit(session, "message", "Signoff package exported successfully.")
        elif status == "cancelled":
            self._emit(session, "message", cancellation_message(session.language))
        else:
            self._emit(session, "error", f"Signoff package export failed: {error}")
        self._emit_phase_choice(session)

    def _begin_workspace_parameter_update(self, session: _Session) -> None:
        workspace = session.rerun_workspace_path
        if not workspace:
            self._emit(session, "error", "No open workspace is bound to this Agent session.")
            self._emit_phase_choice(session)
            return
        session.phase = "workspace_parameter_request"
        self._emit(
            session,
            "message",
            workspace_parameter_request_prompt(session.language),
        )

    def _select_workspace_parameter_request(self, session: _Session, message: str) -> None:
        workspace = session.rerun_workspace_path
        if not workspace:
            self._emit(session, "error", "No open workspace is bound to this Agent session.")
            return
        if not message.strip():
            self._emit(
                session,
                "message",
                workspace_parameter_request_prompt(session.language),
            )
            return
        design = _design_id_for_workspace(workspace)
        if design is None:
            self._emit(session, "error", "Unable to infer the design name for parameter updates.")
            session.phase = "operation"
            self._emit_phase_choice(session)
            return
        try:
            source = Path(normalize_path(workspace, label="Workspace", require_directory=True))
            parameter_values = _tunable_workspace_parameters(source)
            if not parameter_values:
                raise ValueError("No tunable parameters are available in this workspace yet")
            allowed_knobs = [knob_id for knob_id, _ in parameter_values]
            current_values = {knob_id: value for knob_id, value in parameter_values}
            proposal = GuiWorkspaceRerunParameterProposal.model_validate(
                self.rerun_parameter_parser(
                    {
                        "schema_version": "flow-agent.gui_workspace_rerun_parameter_context.v1",
                        "natural_language_request": message,
                        "allowed_knobs": allowed_knobs,
                        "boolean_knobs": sorted(set(allowed_knobs) & BOOLEAN_RERUN_KNOBS),
                        "workspace": str(source),
                        "_progress_callback": lambda text: self._progress(session, text),
                        "_register_interrupt": lambda callback: self._register_interrupt(
                            session, callback
                        ),
                    }
                )
            )
            self._check_interrupted(session)
            patch = [item.model_dump(mode="json") for item in proposal.parameter_patch]
            _validate_workspace_parameter_patch(patch, current_values)
            writes = [resolve_write(item) for item in proposal.parameter_patch]
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            self._emit(session, "error", f"Unable to validate the parameter change: {exc}")
            self._emit(
                session,
                "message",
                workspace_parameter_request_prompt(session.language),
            )
            return
        update_id = uuid.uuid4().hex
        session.workspace_parameter_update = {
            "schema_version": "flow-agent.workspace_parameter_update_contract.v2",
            "update_id": update_id,
            "workspace": workspace,
            "parameter_patch": patch,
            "writes": writes,
        }
        session.phase = "workspace_parameter_confirmation"
        fields = [
            {"label": "Workspace", "value": workspace},
            *[
                {
                    "label": str(item["knob_id"]),
                    "value": (
                        f"{current_values[item['knob_id']]} → {item['value']}"
                        if item["knob_id"] in current_values
                        else str(item["value"])
                    ),
                }
                for item in patch
            ],
        ]
        self._emit(
            session,
            "contract",
            confirmation_menu(session.language),
            {
                "schema_version": "flow-agent.resolved_execution_contract.v1",
                "title": "Save workspace parameter changes",
                "presentation": "workspace_parameter_update",
                "fields": fields,
            },
        )
        self._emit_phase_choice(session)

    def _confirm_workspace_parameter_update(self, session: _Session, message: str) -> None:
        choice = _operation_choice(message)
        if choice == "2" or message.strip().lower() in {"cancel", "n", "no"}:
            session.workspace_parameter_update = None
            self._reset(session)
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        if choice != "1" and message.strip().lower() not in {"confirm", "y", "yes", ""}:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit_phase_choice(session)
            return
        contract = session.workspace_parameter_update
        if contract is None:
            self._emit(session, "error", "Parameter update contract is missing.")
            return
        session.phase = "workspace_parameter_pending"
        self._emit(
            session,
            "workspace_parameter_update",
            "Saving parameter changes without running the flow.",
            workspace_parameter_update=contract,
        )

    def _handle_workspace_parameter_update_result(self, session: _Session, message: str) -> None:
        if not message.startswith("workspace_parameter_update_result:"):
            self._emit(session, "error", "Parameter update result is invalid.")
            return
        self._reset(session)
        if '"status":"succeeded"' in message or '"status": "succeeded"' in message:
            self._emit(session, "message", "Workspace parameters were saved.")
        else:
            self._emit(session, "message", "Workspace parameter update failed.")
        self._emit_phase_choice(session)

    def _select_project_root(self, session: _Session, message: str) -> None:
        try:
            root = normalize_path(message, label="Project Root", require_directory=True)
            if not session.creating_project and not (Path(root) / "project.json").is_file():
                raise ValueError("Existing Project Root must contain project.json")
            session.workspace_inputs.project_root = root
            session.workspace_inputs.project_name = derive_project_name(root)
            session.project_root = root
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "Project Root",
                str(exc),
                lambda language: project_root_prompt(
                    language, creating=session.creating_project
                ),
            )
            return
        pdk_paths = discover_ecos_pdk_paths(root)
        session.path_recommendations = {"pdk": pdk_paths[0]} if pdk_paths else {}
        session.phase = "workspace_name"
        recommendation = recommended_workspace_name(root)
        self._emit(
            session,
            "message",
            workspace_name_prompt(session.language, recommendation),
        )
        self._emit_phase_choice(session)

    def _select_workspace_name(self, session: _Session, message: str) -> None:
        recommendation = (
            recommended_workspace_name(session.workspace_inputs.project_root)
            if session.workspace_inputs.project_root
            else ""
        )
        bootstrap = _extract_create_bootstrap(message)
        answer = resolve_emptyable_answer(message) or recommendation
        if bootstrap.workspace_name:
            answer = bootstrap.workspace_name
        try:
            workspace_name = normalize_identifier(answer, label="Workspace Name")
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "Workspace Name",
                str(exc),
                lambda language: workspace_name_prompt(language, recommendation),
            )
            return
        self._update_workspace_setup(session, workspace_name=workspace_name)
        flow_end_explicit = False
        if bootstrap.design_name:
            try:
                self._update_workspace_setup(
                    session,
                    design_name=normalize_identifier(bootstrap.design_name, label="Design Name"),
                )
            except ValueError:
                pass
        if bootstrap.flow_end:
            self._update_workspace_setup(
                session, flow_start="Synthesis", flow_end=bootstrap.flow_end
            )
            flow_end_explicit = True
        if session.workspace_setup.design_name:
            self._enter_create_flow_phase(
                session, mode_explicit=True, flow_end_explicit=flow_end_explicit
            )
            return
        design_recommendation = (
            session.inherited_design_name or session.workspace_inputs.project_name or ""
        )
        session.phase = "workspace_design"
        self._emit(
            session,
            "message",
            design_name_prompt(session.language, design_recommendation),
        )
        self._emit_phase_choice(session)

    def _select_flow_end(self, session: _Session, message: str) -> None:
        if message == "0":
            end_step = "Harden"
        else:
            end_step = numbered_choice(message, tuple(_flow_steps()))
        if end_step is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(session, "message", flow_end_prompt(session.language))
            self._emit_phase_choice(session)
            return
        self._update_workspace_setup(session, flow_start="Synthesis", flow_end=end_step)
        session.phase = "workspace_rtl"
        self._emit(session, "message", rtl_prompt(session.language, _recommended_path(session, "rtl")))
        self._emit_phase_choice(session)

    def _select_rtl(self, session: _Session, message: str) -> None:
        try:
            session.workspace_inputs.rtl_path = normalize_path(
                message, label="RTL path", suffixes=(".v", ".sv"), require_file=True
            )
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "RTL path",
                str(exc),
                lambda language: rtl_prompt(language, _recommended_path(session, "rtl")),
            )
            return
        self._apply_detected_defaults(session)
        session.phase = "workspace_filelist"
        self._emit(
            session,
            "message",
            optional_file_prompt(session.language, "filelist", ".f", _recommended_path(session, "filelist")),
        )
        self._emit_phase_choice(session)

    def _select_filelist(self, session: _Session, message: str) -> None:
        try:
            session.workspace_inputs.filelist_path = optional_path(
                resolve_emptyable_answer(message), label="Filelist path", suffixes=(".f",)
            )
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "Filelist path",
                str(exc),
                lambda language: optional_file_prompt(
                    language, "filelist", ".f", _recommended_path(session, "filelist")
                ),
            )
            return
        session.phase = "workspace_sdc"
        self._emit(
            session,
            "message",
            optional_file_prompt(session.language, "SDC", ".sdc", _recommended_path(session, "sdc")),
        )
        self._emit_phase_choice(session)

    def _select_sdc(self, session: _Session, message: str) -> None:
        try:
            session.workspace_inputs.sdc_path = optional_path(
                resolve_emptyable_answer(message), label="SDC path", suffixes=(".sdc",)
            )
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "SDC path",
                str(exc),
                lambda language: optional_file_prompt(
                    language, "SDC", ".sdc", _recommended_path(session, "sdc")
                ),
            )
            return
        self._apply_detected_defaults(session)
        session.phase = "workspace_pdk"
        self._emit(session, "message", pdk_prompt(session.language, _recommended_path(session, "pdk")))
        self._emit_phase_choice(session)

    def _select_pdk(self, session: _Session, message: str) -> None:
        try:
            message = resolve_emptyable_answer(message)
            recommendation = session.path_recommendations.get("pdk")
            if not message and not recommendation:
                raise ValueError("No local PDK recommendation was found; enter an existing PDK path")
            session.workspace_inputs.pdk_root = normalize_path(
                message or recommendation or "", label="PDK path", require_directory=True
            )
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "PDK path",
                str(exc),
                lambda language: pdk_prompt(language, _recommended_path(session, "pdk")),
            )
            return
        session.phase = "workspace_mpc"
        self._emit(
            session,
            "message",
            mpc_prompt(session.language),
        )
        self._emit_phase_choice(session)

    def _select_mpc(self, session: _Session, message: str) -> None:
        choice = numbered_choice(message, ("use", "skip"))
        if choice is None:
            text = message.casefold()
            if any(token in text for token in ("不使用", "不用", "without", "skip", "no")):
                choice = "skip"
            elif any(token in text for token in ("使用", "使用", "use", "yes")):
                choice = "use"
        if choice is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(session, "message", mpc_prompt(session.language))
            self._emit_phase_choice(session)
            return
        session.mpc_selection = choice == "use"
        session.phase = "workspace_top"
        self._emit(
            session,
            "message",
            default_value_prompt(session.language, "Top Module Name", session.workspace_setup.top_module),
        )
        self._emit_phase_choice(session)

    def _select_design_name(self, session: _Session, message: str) -> None:
        recommendation = session.inherited_design_name or session.workspace_inputs.project_name or ""
        answer = resolve_emptyable_answer(message) or recommendation
        try:
            design = normalize_identifier(answer, label="Design Name")
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "Design Name",
                str(exc),
                lambda language: design_name_prompt(language, recommendation),
            )
            return
        self._update_workspace_setup(session, design_name=design)
        self._discover_design_paths(session)
        session.phase = "workspace_flow_end"
        self._emit(session, "message", flow_end_prompt(session.language))
        self._emit_phase_choice(session)

    def _select_top_module(self, session: _Session, message: str) -> None:
        message = resolve_emptyable_answer(message)
        try:
            top_module = (
                normalize_identifier(message, label="Top Module Name")
                if message
                else session.workspace_setup.top_module
            )
        except ValueError as exc:
            self._repeat_setup_default(session, "Top Module Name", str(exc))
            return
        self._update_workspace_setup(session, top_module=top_module)
        session.phase = "workspace_clock"
        self._emit(
            session,
            "message",
            default_value_prompt(session.language, "Clock Signal Name", session.workspace_setup.clock_name),
        )
        self._emit_phase_choice(session)

    def _select_clock(self, session: _Session, message: str) -> None:
        message = resolve_emptyable_answer(message)
        try:
            clock = (
                normalize_identifier(message, label="Clock Signal Name")
                if message
                else session.workspace_setup.clock_name
            )
        except ValueError as exc:
            self._repeat_setup_default(session, "Clock Signal Name", str(exc))
            return
        self._update_workspace_setup(session, clock_name=clock)
        session.phase = "workspace_frequency"
        self._emit(
            session,
            "message",
            number_prompt(
                session.language,
                "Frequency Max (MHz)",
                session.workspace_setup.frequency_mhz,
                1,
                10_000,
            ),
        )
        self._emit_phase_choice(session)

    def _select_frequency(self, session: _Session, message: str) -> None:
        value = self._number_or_repeat(session, message, "Frequency Max (MHz)", 1, 10_000)
        if value is None:
            return
        self._update_workspace_setup(session, frequency_mhz=value)
        session.phase = "workspace_max_fanout"
        self._emit(
            session,
            "message",
            number_prompt(session.language, "Max Fanout", session.workspace_setup.max_fanout, 1, 1_000_000),
        )
        self._emit_phase_choice(session)

    def _select_max_fanout(self, session: _Session, message: str) -> None:
        value = self._number_or_repeat(session, message, "Max Fanout", 1, 1_000_000)
        if value is None:
            return
        self._update_workspace_setup(session, max_fanout=value)
        session.phase = "workspace_utilization"
        self._emit(
            session,
            "message",
            number_prompt(session.language, "Die Area Utilization", session.workspace_setup.utilitization, 0.01, 1),
        )
        self._emit_phase_choice(session)

    def _select_utilization(self, session: _Session, message: str) -> None:
        value = self._number_or_repeat(session, message, "Die Area Utilization", 0.01, 1)
        if value is None:
            return
        self._update_workspace_setup(session, utilitization=value)
        session.phase = "workspace_density"
        self._emit(
            session,
            "message",
            number_prompt(session.language, "Placement Target Density", session.workspace_setup.target_density, 0.01, 1),
        )
        self._emit_phase_choice(session)

    def _select_density(self, session: _Session, message: str) -> None:
        value = self._number_or_repeat(session, message, "Placement Target Density", 0.01, 1)
        if value is None:
            return
        self._update_workspace_setup(session, target_density=value)
        session.phase = "workspace_overflow"
        self._emit(
            session,
            "message",
            number_prompt(session.language, "Placement Target Overflow", session.workspace_setup.target_overflow, 0, 1),
        )
        self._emit_phase_choice(session)

    def _select_overflow(self, session: _Session, message: str) -> None:
        value = self._number_or_repeat(session, message, "Placement Target Overflow", 0, 1)
        if value is None:
            return
        self._update_workspace_setup(session, target_overflow=value)
        self._show_workspace_contract(session)

    def _select_rerun_design(self, session: _Session, message: str) -> None:
        try:
            design = normalize_identifier(message, label="Design Name")
        except ValueError as exc:
            self._emit(session, "message", invalid_value(session.language, "Design Name", str(exc)))
            self._emit(session, "message", rerun_design_prompt(session.language))
            return
        session.design_id = design
        if session.rerun_workspace_path:
            session.phase = "rerun_source_run"
            self._emit(
                session,
                "message",
                source_run_prompt(session.language, (session.rerun_workspace_path,)),
            )
            self._emit_phase_choice(session)
            return
        session.phase = "rerun_workspace"
        self._emit(
            session,
            "message",
            rerun_workspace_prompt(session.language, session.rerun_workspace_path),
        )
        self._emit_phase_choice(session)

    def _select_rerun_source_run(self, session: _Session, message: str) -> None:
        selected = session.rerun_workspace_path if message in {"", "1"} else message
        session.phase = "rerun_workspace"
        self._select_rerun_workspace(session, selected or "")

    def _select_rerun_workspace(self, session: _Session, message: str) -> None:
        design = session.design_id
        workspace_path = message.strip() or session.rerun_workspace_path
        if design is None or workspace_path is None:
            self._emit(
                session,
                "message",
                invalid_value(
                    session.language, "Rerun workspace", "an existing workspace path is required"
                ),
            )
            self._emit(
                session,
                "message",
                rerun_workspace_prompt(session.language, session.rerun_workspace_path),
            )
            self._emit_phase_choice(session)
            return
        try:
            source = Path(
                normalize_path(workspace_path, label="Rerun workspace", require_directory=True)
            )
            resolver = GuiWorkspaceRerunResolver(source.parent)
            discovery = resolver.discover_workspace(source, design)
        except ValueError as exc:
            self._emit(
                session,
                "message",
                invalid_value(session.language, "Rerun workspace", str(exc)),
            )
            self._emit(
                session,
                "message",
                rerun_workspace_prompt(session.language, session.rerun_workspace_path),
            )
            self._emit_phase_choice(session)
            return
        session.rerun_resolver = resolver
        session.rerun_discovery = discovery
        session.phase = "rerun_stage"
        self._emit(session, "message", rerun_stage_prompt(session.language, discovery.allowed_stages))
        self._emit_phase_choice(session)

    def _select_rerun_stage(self, session: _Session, message: str) -> None:
        resolver = _rerun_resolver(session)
        discovery = session.rerun_discovery
        stage = None if discovery is None else numbered_choice(message, discovery.allowed_stages)
        if stage is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(
                session,
                "message",
                rerun_stage_prompt(session.language, () if discovery is None else discovery.allowed_stages),
            )
            self._emit_phase_choice(session)
            return
        session.rerun_stage = stage
        parameter_values = resolver.parameter_values(discovery.source, stage)
        if not parameter_values:
            # Stages like fixFanout are rerunnable but have no authorized knobs yet.
            session.rerun_parameter_patch = []
            session.phase = "rerun_scope"
            self._emit(
                session,
                "message",
                rerun_no_parameters_prompt(
                    session.language, catalog_end_step().value
                ),
            )
            self._emit_phase_choice(session)
            return
        session.phase = "rerun_parameter"
        self._emit(
            session,
            "message",
            rerun_parameter_prompt(session.language, parameter_values),
        )
        self._emit_phase_choice(session)

    def _select_rerun_parameter(self, session: _Session, message: str) -> None:
        resolver = _rerun_resolver(session)
        discovery = session.rerun_discovery
        stage = session.rerun_stage
        if discovery is None or stage is None:
            self._reset(session)
            self._emit(session, "error", "The workspace rerun state is invalid.")
            return
        message = resolve_emptyable_answer(message)
        if not message:
            session.rerun_parameter_patch = []
        else:
            try:
                parameter_values = resolver.parameter_values(
                    discovery.source, stage
                )
                if not parameter_values:
                    raise ValueError("No config-backed parameters are available for this rerun stage")
                allowed_knobs = [knob_id for knob_id, _ in parameter_values]
                proposal = GuiWorkspaceRerunParameterProposal.model_validate(
                    self.rerun_parameter_parser(
                        {
                            "schema_version": "flow-agent.gui_workspace_rerun_parameter_context.v1",
                            "natural_language_request": message,
                            "target_step": stage,
                            "allowed_knobs": allowed_knobs,
                            "boolean_knobs": sorted(set(allowed_knobs) & BOOLEAN_RERUN_KNOBS),
                            "workspace": str(discovery.source.workspace_path),
                            "_progress_callback": lambda text: self._progress(session, text),
                            "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
                        }
                    )
                )
                self._check_interrupted(session)
                resolver._validate_patch(
                    stage, [item.model_dump(mode="json") for item in proposal.parameter_patch]
                )
            except (CodexProviderError, ValueError) as exc:
                self._check_interrupted(session)
                self._raise_if_interrupted(exc)
                self._emit(session, "error", f"Unable to validate the rerun parameter change: {exc}")
                self._emit(
                    session,
                    "message",
                    rerun_parameter_prompt(
                        session.language,
                        resolver.parameter_values(discovery.source, stage),
                    ),
                )
                self._emit_phase_choice(session)
                return
            session.rerun_parameter_patch = [item.model_dump(mode="json") for item in proposal.parameter_patch]
            if session.rerun_parameter_patch:
                effective_values = dict(parameter_values)
                effective_values.update(
                    {item["knob_id"]: item["value"] for item in session.rerun_parameter_patch}
                )
                self._emit(
                    session,
                    "message",
                    rerun_parameter_prompt(session.language, tuple(sorted(effective_values.items()))),
                )
        session.phase = "rerun_scope"
        self._emit(
            session,
            "message",
            rerun_scope_prompt(session.language, catalog_end_step().value),
        )
        self._emit_phase_choice(session)

    def _select_rerun_scope(self, session: _Session, message: str) -> None:
        resolver = _rerun_resolver(session)
        scope = numbered_choice(message, ("single_step", "full_flow"))
        if scope is None or session.rerun_discovery is None or session.rerun_stage is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(
                session,
                "message",
                rerun_scope_prompt(session.language, catalog_end_step().value),
            )
            self._emit_phase_choice(session)
            return
        try:
            session.workspace_rerun_contract = resolver.freeze(
                session.rerun_discovery.source,
                session.rerun_stage,
                session.rerun_parameter_patch,
                scope,
            )
        except ValueError as exc:
            self._emit(session, "error", f"Unable to resolve the rerun contract: {exc}")
            return
        session.phase = "confirmation"
        parameter_values = resolver.parameter_values(
            session.rerun_discovery.source, session.rerun_stage
        )
        self._emit(
            session,
            "contract",
            confirmation_menu(session.language),
            _workspace_rerun_execution_contract(
                session.workspace_rerun_contract, session.language, parameter_values
            ),
        )
        self._emit_phase_choice(session)

    def _show_workspace_contract(self, session: _Session) -> None:
        session.workspace_setup_id = session.workspace_setup_id or uuid.uuid4().hex
        try:
            contract = workspace_setup_contract(
                session.workspace_setup,
                session.workspace_inputs,
                session.language,
                session.workspace_setup_id,
                mpc_enabled=session.mpc_selection,
            )
        except ValueError as exc:
            self._emit(session, "message", invalid_value(session.language, "Workspace specification", str(exc)))
            session.phase = "workspace_top" if "Top Module" in str(exc) else "workspace_project_root"
            self._emit(
                session,
                "message",
                default_value_prompt(session.language, "Top Module Name", session.workspace_setup.top_module)
                if session.phase == "workspace_top"
                else project_root_prompt(session.language, creating=session.creating_project),
            )
            self._emit_phase_choice(session)
            return
        session.phase = "workspace_confirmation"
        session.workspace_contract = contract
        self._emit(
            session,
            "workspace_setup",
            workspace_confirmation_prompt(session.language),
            workspace_setup=contract,
        )
        self._emit_phase_choice(session)

    def _confirm_workspace_execution(self, session: _Session, message: str) -> None:
        _confirm_workspace_execution(self, session, message)

    def _handle_workspace_creation_result(self, session: _Session, message: str) -> None:
        result = _workspace_creation_result(message)
        if result is None or result[0] != session.workspace_setup_id:
            self._emit(session, "error", "Workspace creation result is invalid.")
            return
        _, status, error, end_step, workspace = result
        if status == "succeeded":
            session.mode = "workspace"
            workspace_path = workspace
            if session.workspace_contract and isinstance(session.workspace_contract, dict):
                directory = session.workspace_contract.get("directory")
                if isinstance(directory, str) and directory.strip():
                    workspace_path = workspace_path or directory
            if workspace_path:
                session.rerun_workspace_path = workspace_path
            if end_step and end_step.lower() == "harden":
                self._begin_workspace_signoff(session, workspace_path or "")
                return
            self._reset(session)
            self._emit(
                session,
                "message",
                welcome_message(
                    mode=session.mode, workspace=session.rerun_workspace_path or ""
                ),
            )
            self._emit_phase_choice(session)
            return
        contract = session.workspace_contract
        if contract is None:
            self._emit(session, "error", "Workspace creation contract is missing.")
            return
        session.phase = "workspace_confirmation"
        self._emit(
            session,
            "workspace_setup",
            "\n\n".join(
                [
                    workspace_creation_failed(session.language, error),
                    workspace_confirmation_prompt(session.language),
                ]
            ),
            workspace_setup=contract,
        )
        self._emit_phase_choice(session)

    def _confirm_rerun_execution(self, session: _Session, message: str) -> None:
        if message == "2":
            self._reset(session)
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        if message != "1":
            self._emit(session, "message", confirmation_menu(session.language))
            self._emit_phase_choice(session)
            return
        contract = session.workspace_rerun_contract
        if contract is None:
            self._emit(session, "error", "The workspace rerun contract is missing.")
            return
        self._emit(
            session,
            "workspace_rerun",
            workspace_execution_started(session.language),
            workspace_rerun=contract.model_dump(mode="json"),
        )
        session.phase = "workspace_rerun_pending"

    def _handle_workspace_rerun_result(self, session: _Session, message: str) -> None:
        _handle_workspace_rerun_result(self, session, message)

    def _number_or_repeat(
        self, session: _Session, message: str, label: str, lower: float, upper: float
    ) -> float | None:
        current = _number_default(session.workspace_setup, label)
        message = resolve_emptyable_answer(message)
        try:
            return parse_number(message, label=label, lower=lower, upper=upper, default=current)
        except ValueError:
            pass
        try:
            field = _NUMERIC_FIELDS[label]
            proposal = GuiWorkspaceSetupProposal.model_validate(
                self.workspace_setup_parser(
                    {
                        "schema_version": "flow-agent.gui_workspace_setup_context.v2",
                        "stage": "numeric",
                        "numeric_field": field,
                        "numeric_label": label,
                        "numeric_bounds": {"lower": lower, "upper": upper},
                        "default_value": current,
                        "natural_language_choice": message,
                        "recommended_defaults": session.workspace_setup.model_dump(mode="json"),
                        "workspace_inputs": _workspace_inputs_payload(session.workspace_inputs),
                        "filesystem_roots": list(workspace_search_roots(session.workspace_inputs.project_root)),
                        "_progress_callback": lambda text: self._progress(session, text),
                        "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
                    }
                )
            )
            self._check_interrupted(session)
            value = getattr(proposal, field)
            if value is None:
                raise ValueError("Codex did not provide a value for this field")
            return parse_number(str(value), label=label, lower=lower, upper=upper, default=current)
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            self._emit(
                session,
                "message",
                invalid_value(session.language, label, "Unable to interpret a valid in-range value"),
            )
            self._emit(session, "message", number_prompt(session.language, label, current, lower, upper))
            self._emit_phase_choice(session)
            return None

    def _repeat_setup_default(self, session: _Session, label: str, error: str) -> None:
        self._emit(session, "message", invalid_value(session.language, label, error))
        values = {
            "Design Name": session.workspace_setup.design_name,
            "Top Module Name": session.workspace_setup.top_module,
            "Clock Signal Name": session.workspace_setup.clock_name,
        }
        self._emit(session, "message", default_value_prompt(session.language, label, values[label]))
        self._emit_phase_choice(session)

    def _repeat_invalid(self, session: _Session, label: str, error: str, prompt) -> None:
        self._emit(session, "message", invalid_value(session.language, label, error))
        self._emit(session, "message", prompt(session.language))
        self._emit_phase_choice(session)

    def _apply_detected_defaults(self, session: _Session) -> None:
        defaults = infer_design_defaults(
            session.workspace_inputs.rtl_path,
            session.workspace_inputs.sdc_path,
            session.workspace_setup.design_name or "",
        )
        self._update_workspace_setup(session, **defaults)

    def _corrected_workspace_state(
        self, session: _Session, proposal: GuiWorkspaceSetupProposal, message: str
    ) -> tuple[GuiWorkspaceSetupProposal, WorkspaceInputs]:
        setup = merge_workspace_setup(session.workspace_setup, proposal, "spec")
        inputs = merge_workspace_inputs(session.workspace_inputs, proposal)
        _validate_workspace_input_roots(
            proposal, inputs, workspace_search_roots(session.workspace_inputs.project_root), message
        )
        if proposal.rtl_path is None and proposal.sdc_path is None:
            return setup, inputs
        defaults = infer_design_defaults(inputs.rtl_path, inputs.sdc_path, setup.design_name or "")
        updates = {key: value for key, value in defaults.items() if getattr(proposal, key) is None}
        return GuiWorkspaceSetupProposal.model_validate({**setup.model_dump(mode="json"), **updates}), inputs

    def _discover_design_paths(self, session: _Session) -> None:
        roots = workspace_search_roots(session.workspace_inputs.project_root)
        candidates = discover_design_file_candidates(session.workspace_setup.design_name or "", roots)
        local_recommendations = {
            field: paths[0]
            for field, paths in candidates.items()
            if paths
        }
        if self._uses_default_workspace_path_discovery:
            session.path_recommendations.update(local_recommendations)
            return
        try:
            proposal = GuiWorkspaceSetupProposal.model_validate(
                self.workspace_path_recommender(
                    {
                        "schema_version": "flow-agent.gui_workspace_path_discovery.v1",
                        "design_name": session.workspace_setup.design_name,
                        "project_root": session.workspace_inputs.project_root,
                        "filesystem_roots": list(roots),
                        "discovered_candidates": candidates,
                        "_progress_callback": lambda text: self._progress(session, text),
                        "_register_interrupt": lambda callback: self._register_interrupt(session, callback),
                    }
                )
            )
            self._check_interrupted(session)
            session.path_recommendations.update(_validated_path_recommendations(proposal, roots))
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            session.path_recommendations = {
                **{
                    field: path
                    for field, path in session.path_recommendations.items()
                    if field == "pdk"
                },
                **local_recommendations,
            }

    def _update_workspace_setup(self, session: _Session, **updates: Any) -> None:
        payload = session.workspace_setup.model_dump(mode="json")
        payload.update(updates)
        session.workspace_setup = GuiWorkspaceSetupProposal.model_validate(payload)

    def _reset_workspace_setup(self, session: _Session) -> None:
        session.workspace_setup = recommended_workspace_setup()
        session.workspace_inputs = WorkspaceInputs()
        session.path_recommendations = {}
        session.workspace_setup_id = None
        session.workspace_contract = None

    def _session(self, request: Mapping[str, Any]) -> _Session:
        session_id = _optional_text(request.get("sessionId"))
        if session_id is None or session_id not in self.sessions:
            raise ValueError("Unknown ECOS Agent session.")
        return self.sessions[session_id]

    def _emit(
        self,
        session: _Session,
        event_type: str,
        text: str,
        contract: dict[str, Any] | None = None,
        optimization: dict[str, Any] | None = None,
        workspace_setup: dict[str, Any] | None = None,
        workspace_create_setup_id: str | None = None,
        workspace_rerun: dict[str, Any] | None = None,
        workspace_continue: dict[str, Any] | None = None,
        workspace_parameter_update: dict[str, Any] | None = None,
        workspace_signoff: dict[str, Any] | None = None,
        choice: dict[str, Any] | None = None,
        delta: str | None = None,
        message_id: str | None = None,
    ) -> None:
        event: dict[str, Any] = {
            "providerId": PROVIDER_ID,
            "sessionId": session.session_id,
            "text": text,
            "type": event_type,
        }
        if event_type in {"message", "tool", "error", "choice", "optimization"}:
            event["messageId"] = message_id or uuid.uuid4().hex
        if choice is not None:
            event["choice"] = choice
        if delta is not None:
            event["delta"] = delta
        if contract is not None:
            event["contract"] = contract
        if optimization is not None:
            event["optimization"] = optimization
        if workspace_setup is not None:
            event["workspaceSetup"] = workspace_setup
        if workspace_create_setup_id is not None:
            event["workspaceCreateSetupId"] = workspace_create_setup_id
        if workspace_rerun is not None:
            event["workspaceRerun"] = workspace_rerun
        if workspace_continue is not None:
            event["workspaceContinue"] = workspace_continue
        if workspace_parameter_update is not None:
            event["workspaceParameterUpdate"] = workspace_parameter_update
        if workspace_signoff is not None:
            event["workspaceSignoff"] = workspace_signoff
        self.emit(event)

    def _emit_status(self, session: _Session, state: str) -> None:
        self.emit(
            {
                "providerId": PROVIDER_ID,
                "sessionId": session.session_id,
                "status": state,
                "text": state,
                "type": "status",
            }
        )

    def _emit_phase_choice(self, session: _Session) -> None:
        prompt_id = uuid.uuid4().hex
        choice = None
        if session.phase == "home_ready":
            choice = home_ready_choice(session.language, prompt_id)
        elif session.phase == "operation":
            choice = operation_choice(
                session.language,
                prompt_id,
                mode=session.mode,
                allow_create_workspace_in_project=bool(session.project_root),
            )
        elif session.phase == "workspace_project_mode":
            choice = project_mode_choice(session.language, prompt_id)
        elif (
            session.phase == "workspace_project_root"
            and not session.creating_project
            and session.known_projects
        ):
            choice = known_project_choice(
                session.language,
                prompt_id,
                tuple(session.known_projects),
            )
        elif session.phase == "workspace_name" and session.workspace_inputs.project_root:
            recommendation = recommended_workspace_name(session.workspace_inputs.project_root)
            choice = default_value_choice(
                session.language,
                prompt_id,
                "Workspace Name",
                recommendation,
            )
        elif session.phase == "workspace_design" and (
            session.inherited_design_name or session.workspace_inputs.project_name
        ):
            recommendation = (
                session.inherited_design_name or session.workspace_inputs.project_name or ""
            )
            choice = default_value_choice(
                session.language,
                prompt_id,
                "Design Name",
                recommendation,
            )
        elif session.phase == "rerun_source_run" and session.rerun_workspace_path:
            choice = source_run_choice(
                session.language, prompt_id, (session.rerun_workspace_path,)
            )
        elif session.phase == "rerun_workspace" and session.rerun_workspace_path:
            choice = rerun_workspace_choice(
                session.language, prompt_id, session.rerun_workspace_path
            )
        elif session.phase == "workspace_flow_end":
            choice = flow_end_choice(session.language, prompt_id)
        elif session.phase == "rerun_stage" and session.rerun_discovery is not None:
            choice = rerun_stage_choice(
                session.language, prompt_id, session.rerun_discovery.allowed_stages
            )
        elif session.phase == "rerun_parameter":
            choice = keep_parameters_choice(session.language, prompt_id)
        elif session.phase == "rerun_scope":
            choice = rerun_scope_choice(
                session.language, prompt_id, catalog_end_step().value
            )
        elif session.phase == "workspace_rtl":
            recommendation = _recommended_path(session, "rtl")
            if recommendation:
                choice = recommended_path_choice(
                    session.language,
                    prompt_id,
                    recommendation,
                    field="RTL",
                )
        elif session.phase == "workspace_filelist":
            choice = optional_file_choice(
                session.language,
                prompt_id,
                "filelist",
                _recommended_path(session, "filelist"),
            )
        elif session.phase == "workspace_sdc":
            choice = optional_file_choice(
                session.language,
                prompt_id,
                "SDC",
                _recommended_path(session, "sdc"),
            )
        elif session.phase == "workspace_pdk":
            recommendation = _recommended_path(session, "pdk")
            if recommendation:
                choice = recommended_path_choice(
                    session.language,
                    prompt_id,
                    recommendation,
                    field="PDK",
                )
        elif session.phase == "workspace_mpc":
            choice = mpc_choice(session.language, prompt_id)
        elif session.phase == "workspace_top":
            choice = default_value_choice(
                session.language,
                prompt_id,
                "Top Module Name",
                session.workspace_setup.top_module,
            )
        elif session.phase == "workspace_clock":
            choice = default_value_choice(
                session.language,
                prompt_id,
                "Clock Signal Name",
                session.workspace_setup.clock_name,
            )
        elif session.phase == "workspace_frequency":
            choice = number_default_choice(
                session.language,
                prompt_id,
                "Frequency Max (MHz)",
                session.workspace_setup.frequency_mhz,
            )
        elif session.phase == "workspace_max_fanout":
            choice = number_default_choice(
                session.language,
                prompt_id,
                "Max Fanout",
                session.workspace_setup.max_fanout,
            )
        elif session.phase == "workspace_utilization":
            choice = number_default_choice(
                session.language,
                prompt_id,
                "Die Area Utilization",
                session.workspace_setup.utilitization,
            )
        elif session.phase == "workspace_density":
            choice = number_default_choice(
                session.language,
                prompt_id,
                "Placement Target Density",
                session.workspace_setup.target_density,
            )
        elif session.phase == "workspace_overflow":
            choice = number_default_choice(
                session.language,
                prompt_id,
                "Placement Target Overflow",
                session.workspace_setup.target_overflow,
            )
        elif session.phase == "workspace_confirmation":
            choice = confirmation_choice(session.language, prompt_id, allow_free_text=True)
        elif session.phase == "optimization_authorization":
            choice = confirmation_choice(session.language, prompt_id, allow_free_text=False)
        elif session.phase == "workspace_signoff_confirmation":
            choice = workspace_signoff_choice(session.language, prompt_id)
        elif session.phase in {
            "confirmation",
            "workspace_continue_confirmation",
            "workspace_parameter_confirmation",
        }:
            choice = confirmation_choice(session.language, prompt_id, allow_free_text=False)
        if choice is not None:
            self._emit(session, "choice", choice["title"], choice=choice)

    def _progress(self, session: _Session, text: str) -> None:
        self._check_interrupted(session)
        self._emit(
            session,
            "tool",
            text,
            delta=f"{text}\n",
            message_id=session.active_tool_message_id,
        )

    @staticmethod
    def _register_interrupt(session: _Session, callback: Callable[[], None] | None) -> None:
        session.active_interrupt = callback
        if callback is not None and session.interrupt_requested:
            callback()

    @staticmethod
    def _check_interrupted(session: _Session) -> None:
        if session.interrupt_requested:
            raise CodexProviderError("Agent turn interrupted", failure_class="interrupted")

    @staticmethod
    def _raise_if_interrupted(error: Exception) -> None:
        if isinstance(error, CodexProviderError) and error.failure_class == "interrupted":
            raise error

    @staticmethod
    def _resting_status(session: _Session) -> str:
        if session.phase == "workspace_pdk" and not _recommended_path(session, "pdk"):
            return "idle"
        if session.phase == "workspace_rtl" and not _recommended_path(session, "rtl"):
            return "idle"
        if session.phase == "workspace_project_root":
            return (
                "awaiting_choice"
                if not session.creating_project and session.known_projects
                else "idle"
            )
        if session.phase == "workspace_name":
            return "awaiting_choice" if session.workspace_inputs.project_root else "idle"
        if session.phase == "workspace_design":
            return (
                "awaiting_choice"
                if session.inherited_design_name or session.workspace_inputs.project_name
                else "idle"
            )
        if session.phase == "rerun_workspace":
            return "awaiting_choice" if session.rerun_workspace_path else "idle"
        return (
            "awaiting_choice"
            if session.phase
            in {
                "home_ready",
                "operation",
                "workspace_project_mode",
                "rerun_source_run",
                "rerun_stage",
                "rerun_parameter",
                "rerun_scope",
                "workspace_flow_end",
                "workspace_rtl",
                "workspace_filelist",
                "workspace_sdc",
                "workspace_pdk",
                "workspace_mpc",
                "workspace_top",
                "workspace_clock",
                "workspace_frequency",
                "workspace_max_fanout",
                "workspace_utilization",
                "workspace_density",
                "workspace_overflow",
                "workspace_confirmation",
                "workspace_continue_confirmation",
                "workspace_parameter_confirmation",
                "workspace_signoff_confirmation",
                "confirmation",
            }
            else "idle"
        )

    @staticmethod
    def _reset(session: _Session) -> None:
        language = session.language
        language_locked = session.language_locked
        mode = session.mode
        rerun_workspace_path = session.rerun_workspace_path
        project_root = session.project_root
        known_projects = session.known_projects
        inherited_design_name = session.inherited_design_name
        session.phase = "home_ready" if mode == "home" else "operation"
        session.language = language
        session.language_locked = language_locked
        session.mode = mode
        session.rerun_workspace_path = rerun_workspace_path
        session.project_root = project_root
        session.known_projects = known_projects
        session.inherited_design_name = inherited_design_name
        session.creating_project = False
        session.design_id = None
        session.rerun_stage = None
        session.rerun_resolver = None
        session.rerun_discovery = None
        session.rerun_parameter_patch = []
        session.workspace_rerun_contract = None
        session.workspace_setup = recommended_workspace_setup()
        session.workspace_inputs = WorkspaceInputs()
        session.path_recommendations = {}
        session.workspace_setup_id = None
        session.mpc_selection = None
        session.workspace_contract = None
        session.workspace_continue_id = None
        session.workspace_parameter_update = None
        session.workspace_signoff_id = None
        session.workspace_signoff_workspace = None


def main() -> int:
    from ecos_agent.protocol import EcosAgentProtocolServer

    return EcosAgentProtocolServer().serve()


if __name__ == "__main__":
    raise SystemExit(main())
