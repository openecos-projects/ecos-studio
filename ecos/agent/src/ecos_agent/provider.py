"""Controlled, deterministic interaction provider for the ECOS Agent GUI."""

from __future__ import annotations

import copy
import hashlib
import json
import os
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
from ecos_agent.step_knowledge import (
    StepKnowledge,
    load_default_general_knowledge_bundles,
    load_default_step_knowledge,
)
from ecos_agent.messages import (
    EMPTY_CHOICE_VALUE,
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
    optimization_objective_prompt,
    optimization_objective_summary_message,
    optimization_started_message,
    optimization_workspace_prompt,
    optional_file_choice,
    optional_file_prompt,
    pdk_prompt,
    project_mode_choice,
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
from ecos_agent.optimization_contracts import (
    OptimizationEpisodeState,
    OptimizationObjectiveProposal,
)
from ecos_agent.optimization_rules import freeze_optimization_objective
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
_DEFAULT_CHAT_RESPONSE_PARSER = _propose_gui_chat_response
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


def _freeze_optimization_objective(proposal: object, source_goal: str) -> dict[str, Any]:
    contract = freeze_optimization_objective(
        source_goal,
        OptimizationObjectiveProposal.model_validate(proposal),
    )
    return contract.model_dump(mode="json")


def _objective_sha256(contract: Mapping[str, Any]) -> str:
    contract_sha256 = contract.get("contract_sha256")
    if isinstance(contract_sha256, str) and contract_sha256.startswith("sha256:"):
        return contract_sha256
    raise ValueError("optimization objective contract hash is invalid")


def _objective_primary_metric(contract: Mapping[str, Any]) -> str | None:
    value = contract.get("primary_metric")
    return value if isinstance(value, str) else None


def _objective_string_tuple(contract: Mapping[str, Any], key: str) -> tuple[str, ...]:
    value = contract.get(key)
    if isinstance(value, list):
        return tuple(item for item in value if isinstance(item, str))
    if isinstance(value, tuple):
        return tuple(item for item in value if isinstance(item, str))
    return ()


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

_INTERACTION_UNDO_FIELDS = (
    "phase",
    "language",
    "language_locked",
    "project_root",
    "quick_setup",
    "creating_project",
    "design_id",
    "inherited_design_name",
    "rerun_stage",
    "rerun_resolver",
    "rerun_workspace_path",
    "rerun_discovery",
    "rerun_parameter_patch",
    "workspace_rerun_contract",
    "workspace_setup",
    "workspace_inputs",
    "path_recommendations",
    "workspace_setup_id",
    "mpc_selection",
    "workspace_contract",
    "workspace_continue_id",
    "workspace_parameter_update",
    "workspace_signoff_id",
    "workspace_signoff_workspace",
    "optimization_phase",
    "optimization_episode_id",
    "optimization_turn_count",
    "optimization_objective",
    "optimization_objective_sha256",
    "optimization_primary_metric",
    "pending_interaction",
    "interaction_history",
)
_INTERACTION_UNDO_LIMIT = 20
_INTERACTION_UNDO_BARRIER_PHASES = {
    "optimization_preparing",
    "optimization_running",
    "workspace_continue_pending",
    "workspace_creation_pending",
    "workspace_parameter_pending",
    "workspace_rerun_pending",
    "workspace_signoff_export_pending",
}
_INTERACTION_DESCRIPTION_PHASES = {
    "home_ready",
    "operation",
    "rerun_source_run",
    "rerun_stage",
    "rerun_parameter",
    "rerun_scope",
    "rerun_workspace",
    "workspace_clock",
    "workspace_confirmation",
    "workspace_density",
    "workspace_design",
    "workspace_filelist",
    "workspace_flow_end",
    "workspace_frequency",
    "workspace_max_fanout",
    "workspace_mpc",
    "workspace_name",
    "workspace_overflow",
    "workspace_pdk",
    "workspace_project_mode",
    "workspace_rtl",
    "workspace_sdc",
    "workspace_top",
    "workspace_utilization",
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
    quick_run_project_root: str | None = None
    quick_setup: bool = False
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
    optimization_objective: dict[str, Any] | None = None
    optimization_objective_sha256: str | None = None
    optimization_primary_metric: str | None = None
    codex_provider: CodexAppServerProposalProvider | None = None
    pending_interaction: dict[str, Any] | None = None
    interaction_retry: dict[str, Any] | None = None
    interaction_history: dict[str, str] = field(default_factory=dict)
    interaction_undo: list[dict[str, Any]] = field(default_factory=list)


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
        bundles = (
            self.knowledge
            if knowledge is not None
            else (*self.knowledge, *load_default_general_knowledge_bundles())
        )
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

    def start_session(self, request: Mapping[str, Any]) -> dict[str, Any]:
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
        session.quick_run_project_root = _optional_text(request.get("quickRunProjectRoot"))
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
        return {
            "sessionId": session_id,
            "pendingInteraction": session.pending_interaction and session.pending_interaction["request"],
        }

    def send_message(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        if session.pending_interaction is not None:
            raise ValueError("An interaction answer is required for this session.")
        message = _required_message(request.get("message"))
        session.interaction_undo.clear()
        if self._optimization_thread_active(session):
            self._handle_optimization_control(session, message)
            return {
                "messageId": uuid.uuid4().hex,
                "sessionId": session.session_id,
                "turnId": uuid.uuid4().hex,
            }
        if session.running:
            raise ValueError("An ECOS Agent turn is already running for this session.")
        return self._run_turn(session, message)

    def _run_turn(
        self,
        session: _Session,
        message: str,
        handler: Callable[[_Session, str], None] | None = None,
    ) -> dict[str, str]:
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
            (handler or self._handle_input)(session, message)
            self._check_interrupted(session)
            if session.phase in _INTERACTION_UNDO_BARRIER_PHASES:
                session.interaction_undo.clear()
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
            if session.codex_provider is not None:
                session.codex_provider.clear_interrupted()
            session.active_tool_message_id = None
            session.active_turn_id = None
            session.running = False
        if not interrupted:
            self._emit_status(session, self._resting_status(session))
        return {"messageId": turn_id, "sessionId": session.session_id, "turnId": turn_id}

    def answer_interaction(
        self, request: Mapping[str, Any], *, defer: bool = False
    ) -> dict[str, Any]:
        session = self._session(request)
        pending = session.pending_interaction
        if pending is None:
            if request.get("undo") is True:
                state = session.interaction_undo[-1] if session.interaction_undo else None
                restored = state.get("pending_interaction") if state is not None else None
                restored_request = restored.get("request") if isinstance(restored, dict) else None
                if (
                    not isinstance(restored_request, dict)
                    or request.get("requestId") != restored_request.get("requestId")
                    or request.get("kind") != restored_request.get("kind")
                ):
                    raise ValueError("No interaction selection is available to undo.")
                if session.running:
                    raise ValueError("An ECOS Agent turn is already running for this session.")
                return self._undo_interaction(session, None)
            request_id = _optional_text(request.get("requestId"))
            if request_id and session.interaction_history.get(request_id) == "superseded":
                raise ValueError("Interaction request was superseded.")
            if request_id and session.interaction_history.get(request_id) == "answered":
                raise ValueError("Interaction request was already answered.")
            if request_id and session.interaction_history.get(request_id) == "cancelled":
                raise ValueError("Interaction request was already cancelled.")
            raise ValueError("Interaction is not pending.")
        request_id = _optional_text(request.get("requestId"))
        if request_id and session.interaction_history.get(request_id) == "superseded":
            raise ValueError("Interaction request was superseded.")
        if request_id and session.interaction_history.get(request_id) == "answered":
            raise ValueError("Interaction request was already answered.")
        if request_id and session.interaction_history.get(request_id) == "cancelled":
            raise ValueError("Interaction request was already cancelled.")
        if request.get("requestId") != pending["request"]["requestId"]:
            raise ValueError("Interaction request is expired or superseded.")
        if request.get("kind") != pending["request"]["kind"]:
            raise ValueError("Interaction kind does not match the pending request.")
        if session.running:
            raise ValueError("An ECOS Agent turn is already running for this session.")
        if request.get("undo") is True:
            return self._undo_interaction(session, pending)

        reversible_selection = False
        if pending["request"]["kind"] == "form":
            values = request.get("values")
            if not isinstance(values, dict):
                raise ValueError("Form interaction values must be an object.")
            field_ids = {field["id"] for field in pending["request"]["interaction"]["fields"]}
            if set(values) != field_ids:
                raise ValueError("Form interaction values do not match the request schema.")
            for field in pending["request"]["interaction"]["fields"]:
                value = values[field["id"]]
                if field.get("required") and (value is None or value == ""):
                    raise ValueError(f"Form field '{field['id']}' is required.")
                if field["kind"] == "number" and value is not None and value != "":
                    try:
                        float(str(value))
                    except ValueError as exc:
                        raise ValueError(f"Form field '{field['id']}' must be a number.") from exc
                if field["kind"] == "select" and (
                    not isinstance(value, str)
                    or value not in {option["id"] for option in field["options"]}
                ):
                    raise ValueError(f"Form field '{field['id']}' has an invalid option.")
                if field["kind"] in {"text", "path"} and value is not None and not isinstance(value, str):
                    raise ValueError(f"Form field '{field['id']}' must be text.")
                if session.phase == "workspace_rtl" and field["kind"] == "path":
                    try:
                        normalize_path(
                            value,
                            label="RTL path",
                            suffixes=(".v", ".sv"),
                            require_file=True,
                        )
                    except ValueError as exc:
                        raise ValueError(f"Form field '{field['id']}' is invalid: {exc}") from exc
            if len(values) != 1:
                raise ValueError("This execution phase accepts one form field at a time.")
            message = str(next(iter(values.values()), "") or "")
        else:
            option_id = request.get("optionId")
            typed_text = request.get("text")
            if option_id is not None and typed_text is not None:
                raise ValueError("Interaction answer must use an option or text, not both.")
            if option_id is not None:
                if not isinstance(option_id, str):
                    raise ValueError("Interaction option is not available.")
                message = pending["values"].get(option_id)
                if message is None:
                    raise ValueError("Interaction option is not available.")
                reversible_selection = True
            elif isinstance(typed_text, str) and typed_text.strip():
                message = typed_text.strip()
            else:
                raise ValueError("Interaction option or text answer is required.")

        undo_state = self._capture_interaction_state(session)
        if reversible_selection:
            session.interaction_undo.append(undo_state)
            del session.interaction_undo[:-_INTERACTION_UNDO_LIMIT]
        session.pending_interaction = None
        session.interaction_retry = pending
        continuation = pending.get("continuation")
        if pending["request"]["purpose"] == "clarification":
            if not isinstance(continuation, str) or not continuation:
                raise ValueError("Clarification continuation is unavailable.")
            message = f"{continuation}\n\nUser clarification answer: {message}"
            handler: Callable[[_Session, str], None] | None = (
                lambda current, answer: self._answer_non_state_input(
                    current, answer, allow_operations=False
                )
            )
        else:
            handler = None
        def run_answer() -> None:
            try:
                self._run_turn(session, str(message), handler)
            except Exception:
                if session.interaction_retry is pending:
                    self._restore_interaction_state(session, undo_state)
                    session.interaction_retry = None
                    if session.interaction_undo and session.interaction_undo[-1] is undo_state:
                        session.interaction_undo.pop()
                raise
            if session.pending_interaction is pending:
                session.interaction_retry = None
                if session.interaction_undo and session.interaction_undo[-1] is undo_state:
                    session.interaction_undo.pop()
                return
            if session.interaction_retry is pending:
                session.interaction_history[pending["request"]["requestId"]] = (
                    "cancelled"
                    if pending["request"]["kind"] == "confirm" and str(message) == "2"
                    else "answered"
                )
                session.interaction_retry = None
        if defer:
            session.running = True
            thread = threading.Thread(target=run_answer, daemon=True)
            thread.start()
        else:
            run_answer()
        result = {
            "accepted": True,
            "requestId": pending["request"]["requestId"],
            "sessionId": session.session_id,
        }
        if reversible_selection and session.interaction_undo:
            result["canUndo"] = True
        return result

    @staticmethod
    def _capture_interaction_state(session: _Session) -> dict[str, Any]:
        return {
            name: copy.deepcopy(getattr(session, name))
            for name in _INTERACTION_UNDO_FIELDS
        }

    @staticmethod
    def _restore_interaction_state(session: _Session, state: Mapping[str, Any]) -> None:
        for name in _INTERACTION_UNDO_FIELDS:
            setattr(session, name, copy.deepcopy(state[name]))

    def _undo_interaction(
        self, session: _Session, current: dict[str, Any] | None
    ) -> dict[str, Any]:
        if not session.interaction_undo or (
            current is not None and current["request"].get("canUndo") is not True
        ):
            raise ValueError("No interaction selection is available to undo.")
        state = session.interaction_undo.pop()
        restored_before_undo = state.get("pending_interaction")
        if not isinstance(restored_before_undo, dict):
            raise ValueError("The previous interaction is unavailable.")
        current_request_id = (
            current["request"]["requestId"]
            if current is not None
            else restored_before_undo["request"]["requestId"]
        )
        self._restore_interaction_state(session, state)
        restored = session.pending_interaction
        if restored is None:
            raise ValueError("The previous interaction is unavailable.")
        if session.interaction_undo:
            restored["request"]["canUndo"] = True
        else:
            restored["request"].pop("canUndo", None)
        if current is not None:
            session.interaction_history[current_request_id] = "superseded"
        request = restored["request"]
        self._emit(session, "interaction", request["title"], interaction=request)
        return {
            "accepted": True,
            "requestId": current_request_id,
            "sessionId": session.session_id,
            "undoneRequestId": request["requestId"],
        }

    def interrupt(self, request: Mapping[str, Any] | None = None) -> None:
        session = self._session(request or {})
        if self._optimization_thread_active(session):
            self._request_optimization_stop(session)
            session.optimization_phase = "stopping"
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

    def resume_session(self, request: Mapping[str, Any]) -> dict[str, Any]:
        session = self._session(request)
        self._emit_status(session, self._resting_status(session))
        self._emit(session, "message", _prompt_for_phase(session))
        self._emit_phase_choice(session, reuse_pending=True)
        return {
            "sessionId": session.session_id,
            "pendingInteraction": session.pending_interaction and session.pending_interaction["request"],
        }

    def stop(self, _request: Mapping[str, Any] | None = None) -> None:
        optimization_threads = []
        for session in self.sessions.values():
            self._request_optimization_stop(session)
            if self._optimization_thread_active(session):
                optimization_threads.append(session.optimization_thread)
        for thread in optimization_threads:
            if thread is not None and thread is not threading.current_thread():
                thread.join()
        for session in self.sessions.values():
            if session.codex_provider is not None:
                session.codex_provider.close()
        self.stopped = True
        self._started = False

    def _handle_input(self, session: _Session, message: str) -> None:
        if re.match(r"^/[A-Za-z][A-Za-z0-9_-]*(?:\s|$)", message):
            self._handle_slash_command(session, message)
            return
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
            "optimization_objective": self._select_optimization_objective,
            "optimization_authorization": self._confirm_optimization_start,
        }
        handler = handlers.get(session.phase)
        if handler is None:
            self._emit(session, "error", "The current ECOS Agent session is not actionable.")
            return
        if session.phase in {"home_ready", "operation"}:
            self._handle_idle_input(session, message)
            return
        if session.phase != "optimization_objective" and _is_conversational_input(message):
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
        if choice == "3":
            self._begin_quick_workspace_create(session)
            return

    def _select_operation(self, session: _Session, message: str, choice: str) -> None:
        if session.mode == "workspace":
            if choice == "parameter":
                self._begin_workspace_parameter_update(session)
                self._select_workspace_parameter_request(session, message)
                return
            if choice == "1":
                self._begin_workspace_scoped_rerun(session)
                return
            if choice == "2":
                self._begin_workspace_continue(session)
                return
            if choice == "3" and session.project_root:
                self._begin_create_workspace_in_project(session)
                return
            optimization_choice = "4" if session.project_root else "3"
            if choice == optimization_choice:
                self._begin_optimization_objective(session)
                return
        elif choice == "1":
            self._begin_home_workspace_create(session, message if message.strip() != "1" else "")
            return

    def _begin_optimization_objective(self, session: _Session) -> None:
        workspace = session.rerun_workspace_path
        if not workspace or not Path(workspace).is_dir():
            self._emit(session, "error", "An existing workspace is required for optimization.")
            self._emit_phase_choice(session)
            return
        session.phase = "optimization_objective"
        session.optimization_phase = "awaiting_objective"
        session.optimization_objective = None
        session.optimization_objective_sha256 = None
        session.optimization_primary_metric = None
        self._emit(session, "message", optimization_objective_prompt(session.language))

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
        self._begin_optimization_objective(session)

    def _select_optimization_objective(self, session: _Session, message: str) -> None:
        goal = message.strip()
        if not goal:
            self._emit(session, "message", optimization_objective_prompt(session.language))
            return
        workspace = session.rerun_workspace_path
        if not workspace:
            raise ValueError("Optimization objective requires a workspace.")
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
                    / "objective-codex-rpc-diagnostics.v1.jsonl"
                ),
            )
            session.active_interrupt = provider.interrupt
            proposal = provider.propose_optimization_objective(goal)
            contract = _freeze_optimization_objective(proposal, goal)
        except Exception as exc:
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            session.optimization_phase = "unavailable"
            self._emit(session, "error", f"Unable to parse optimization objective: {exc}")
            self._emit_phase_choice(session)
            return
        finally:
            session.active_interrupt = None
            if provider is not None:
                provider.close()
        session.optimization_objective = contract
        session.optimization_objective_sha256 = _objective_sha256(contract)
        session.optimization_primary_metric = _objective_primary_metric(contract)
        self._emit(
            session,
            "message",
            optimization_objective_summary_message(
                session.language,
                primary_metric=session.optimization_primary_metric or "(unknown)",
                preserve_metrics=_objective_string_tuple(contract, "preserve_metrics"),
                signoff_gates=_objective_string_tuple(contract, "required_signoff_gates"),
                rationale_summary=str(contract["rationale_summary"]),
                objective_sha256=session.optimization_objective_sha256,
            ),
        )
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
        session.optimization_phase = "starting"
        session.phase = "optimization_preparing"
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
                    "objective": session.optimization_objective,
                },
                provider,
            )
            if not isinstance(runner, OptimizationEpisodeRunner):
                raise ValueError("Optimization runner factory returned an invalid runner.")
        except Exception as exc:
            if provider is not None:
                provider.close()
            session.optimization_phase = "unavailable"
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
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
                    (
                        f"Optimization turn {session.optimization_turn_count} finished for "
                        f"primary objective {session.optimization_primary_metric}."
                    ),
                    optimization={
                        "schema_version": "ecos.optimization_progress.v1",
                        "episode_id": runner.episode_id,
                        "objective_sha256": session.optimization_objective_sha256,
                        "primary_metric": session.optimization_primary_metric,
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
                if runner.state == OptimizationEpisodeState.QUARANTINED:
                    final_phase = "quarantined"
                    break
                if session.optimization_stop.is_set():
                    final_phase = "stopped"
                    break
                if runner.state not in {
                    OptimizationEpisodeState.CREATED,
                    OptimizationEpisodeState.PLANNING,
                }:
                    break
        except Exception as exc:
            if (
                session.optimization_stop.is_set()
                and runner.state != OptimizationEpisodeState.EXECUTING
            ):
                final_phase = "stopped"
            else:
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
            self._request_optimization_stop(session)
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

    @staticmethod
    def _request_optimization_stop(session: _Session) -> None:
        session.optimization_stop.set()
        if session.optimization_runner is not None:
            session.optimization_runner.request_stop()
        if session.optimization_provider is not None:
            session.optimization_provider.interrupt()

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
        if response.clarification is not None:
            self._emit_clarification(session, response.clarification, message)
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
            if self.chat_response_parser is _DEFAULT_CHAT_RESPONSE_PARSER:
                provider = self._chat_provider(session)
                self._register_interrupt(session, provider.interrupt)
                request_context = {
                    key: value for key, value in context.items() if not key.startswith("_")
                }
                response_payload = provider.respond_to_gui_chat(request_context)
                self._register_interrupt(session, None)
            else:
                response_payload = self.chat_response_parser(context)
            response = GuiChatResponseProposal.model_validate(response_payload)
            self._check_interrupted(session)
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            if report_error:
                self._emit(session, "error", f"Unable to answer the request: {exc}")
            return None
        return response

    def _chat_provider(self, session: _Session) -> CodexAppServerProposalProvider:
        if session.codex_provider is None:
            cwd_value = session.rerun_workspace_path or session.project_root
            cwd = Path(cwd_value).expanduser().resolve() if cwd_value else Path.cwd()
            if not cwd.is_dir():
                cwd = Path.cwd()
            session.codex_provider = create_required_codex_provider(
                cwd=cwd,
                runtime_workspace_roots=(cwd,),
                progress_callback=lambda text: self._progress(session, text),
                ephemeral=False,
            )
        return session.codex_provider

    def _handle_slash_command(self, session: _Session, message: str) -> None:
        command, _, argument = message.partition(" ")
        handlers: dict[str, Callable[[_Session, str], None]] = {
            "/compact": self._slash_compact,
            "/fork": self._slash_fork,
            "/goal": self._slash_goal,
            "/help": self._slash_help,
            "/model": self._slash_model,
            "/new": self._slash_new,
            "/permissions": self._slash_permissions,
            "/rename": self._slash_rename,
            "/resume": self._slash_resume,
            "/review": self._slash_review,
            "/status": self._slash_status,
        }
        handler = handlers.get(command.casefold())
        if handler is None:
            detail = (
                "Shell execution is not exposed in Agent Chat."
                if command.casefold() in {"/command", "/exec", "/shell", "/terminal"}
                else "Type /help for supported commands."
            )
            self._emit(session, "error", f"Unsupported slash command: {command}. {detail}")
            return
        try:
            handler(session, argument.strip())
        except (CodexProviderError, ValueError) as exc:
            self._emit(session, "error", str(exc))

    def _slash_help(self, session: _Session, _argument: str) -> None:
        self._emit(
            session,
            "message",
            "Supported: /model, /goal, /compact, /review, /new, /resume, "
            "/fork, /rename, /status, /permissions. Terminal-only commands "
            "such as /theme and /keymap do not apply to Agent Chat.",
        )

    def _slash_model(self, session: _Session, argument: str) -> None:
        provider = self._chat_provider(session)
        if argument:
            model = provider.select_model(argument)
            name = model.get("displayName") or model.get("model")
            self._emit(session, "message", f"Model set to {name}.")
            return
        models = provider.list_models()
        options = [
            {
                "id": str(index),
                "label": str(item.get("displayName") or item.get("model") or item.get("id")),
                "value": f"/model {item.get('model') or item.get('id')}",
            }
            for index, item in enumerate(models, start=1)
        ]
        self._emit_command_choice(session, "Select a Codex model", options)

    def _slash_goal(self, session: _Session, argument: str) -> None:
        provider = self._chat_provider(session)
        if not argument:
            goal = provider.get_goal()
            self._emit(session, "message", self._goal_text(goal))
            return
        action, _, value = argument.partition(" ")
        if action == "clear":
            provider.clear_goal()
            self._emit(session, "message", "Goal cleared.")
        elif action in {"pause", "resume"}:
            goal = provider.set_goal(status="paused" if action == "pause" else "active")
            self._emit(session, "message", self._goal_text(goal))
        elif action == "edit":
            if not value.strip():
                raise ValueError("Usage: /goal edit <objective>")
            goal = provider.set_goal(objective=value.strip())
            self._emit(session, "message", self._goal_text(goal))
        else:
            goal = provider.set_goal(objective=argument)
            self._emit(session, "message", self._goal_text(goal))

    @staticmethod
    def _goal_text(goal: Mapping[str, Any] | None) -> str:
        if goal is None:
            return "No active goal."
        return f"Goal ({goal.get('status', 'active')}): {goal.get('objective', '')}"

    def _slash_compact(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /compact")
        self._chat_provider(session).compact()
        self._emit(session, "message", "Compaction started for this Chat thread.")

    def _slash_review(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /review")
        review = self._chat_provider(session).review_uncommitted_changes()
        self._emit(session, "message", review or "Review completed with no findings.")

    def _slash_new(self, session: _Session, argument: str) -> None:
        thread_id = self._chat_provider(session).start_new_thread(argument or None)
        self._emit(session, "message", f"Started a new Codex thread: {thread_id}")

    def _slash_fork(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /fork")
        thread_id = self._chat_provider(session).fork_thread()
        self._emit(session, "message", f"Forked into Codex thread: {thread_id}")

    def _slash_rename(self, session: _Session, argument: str) -> None:
        if not argument:
            raise ValueError("Usage: /rename <name>")
        self._chat_provider(session).rename_thread(argument)
        self._emit(session, "message", f"Chat renamed to {argument}.")

    def _slash_resume(self, session: _Session, argument: str) -> None:
        provider = self._chat_provider(session)
        if argument:
            thread_id = provider.resume_thread(argument)
            self._emit(session, "message", f"Resumed Codex thread: {thread_id}")
            return
        options = [
            {
                "id": str(index),
                "label": str(item.get("name") or item.get("preview") or item.get("id")),
                "value": f"/resume {item.get('id')}",
            }
            for index, item in enumerate(provider.list_threads(), start=1)
            if item.get("id")
        ]
        self._emit_command_choice(session, "Resume a Codex thread", options)

    def _slash_status(self, session: _Session, argument: str) -> None:
        if argument:
            raise ValueError("Usage: /status")
        provider = self._chat_provider(session)
        thread_id = provider.thread_id or "not started"
        model = provider.model or "default"
        self._emit(
            session,
            "message",
            f"Thread: {thread_id}\nModel: {model}\nPermissions: read-only, approvals disabled",
        )

    def _slash_permissions(self, session: _Session, _argument: str) -> None:
        self._emit(
            session,
            "message",
            "ECOS Agent Chat is fixed to read-only Codex access. Execution remains behind "
            "typed ECOS contracts, local validation, and explicit GUI confirmation.",
        )

    def _emit_command_choice(
        self, session: _Session, title: str, options: list[dict[str, str]]
    ) -> None:
        if not options:
            raise ValueError(f"{title}: no options are available")
        request, values = self._interaction_for_choice(
            session,
            {
                "promptId": uuid.uuid4().hex,
                "title": title,
                "options": options,
                "allowFreeText": False,
                "variant": "list",
            },
        )
        self._validate_interaction_budget(request)
        session.pending_interaction = {"request": request, "values": values}
        self._emit(session, "interaction", title, interaction=request)

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

    def _begin_quick_workspace_create(self, session: _Session) -> None:
        self._reset_workspace_setup(session)
        root = session.quick_run_project_root
        if not root or not Path(root).is_dir():
            self._emit(session, "error", "Quick setup storage is unavailable.")
            self._emit_phase_choice(session)
            return
        session.quick_setup = True
        session.creating_project = True
        session.workspace_inputs.project_root = root
        session.workspace_inputs.project_name = derive_project_name(root)
        self._update_workspace_setup(
            session,
            workspace_name=recommended_workspace_name(root),
        )
        pdk_root = _optional_text(os.environ.get("ICS55_PDK_ROOT"))
        if pdk_root and Path(pdk_root).is_dir():
            session.path_recommendations = {"pdk": pdk_root}
        session.phase = "workspace_rtl"
        self._emit(session, "message", rtl_prompt(session.language))
        self._emit_phase_choice(session)

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
            self._emit(
                session,
                "message",
                design_name_prompt(session.language),
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
        session.phase = "workspace_design"
        self._emit(
            session,
            "message",
            design_name_prompt(session.language),
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
        if session.quick_setup and session.workspace_inputs.rtl_path:
            pdk_root = _recommended_path(session, "pdk")
            if pdk_root:
                session.workspace_inputs.pdk_root = pdk_root
                session.mpc_selection = True
                self._show_workspace_contract(session)
                return
            session.phase = "workspace_pdk"
            self._emit(session, "message", pdk_prompt(session.language, ""))
            self._emit_phase_choice(session)
            return
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
        if session.quick_setup:
            self._update_workspace_setup(
                session,
                design_name=session.workspace_setup.top_module,
            )
            session.phase = "workspace_flow_end"
            self._emit(session, "message", flow_end_prompt(session.language))
            self._emit_phase_choice(session)
            return
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
        if session.quick_setup:
            session.mpc_selection = True
            self._show_workspace_contract(session)
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
        answer = resolve_emptyable_answer(message)
        try:
            design = normalize_identifier(answer, label="Design Name")
        except ValueError as exc:
            self._repeat_invalid(
                session,
                "Design Name",
                str(exc),
                lambda language: design_name_prompt(language),
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
            self._emit_retry_or_phase_choice(session)
            return None

    def _repeat_setup_default(self, session: _Session, label: str, error: str) -> None:
        self._emit(session, "message", invalid_value(session.language, label, error))
        values = {
            "Design Name": session.workspace_setup.design_name,
            "Top Module Name": session.workspace_setup.top_module,
            "Clock Signal Name": session.workspace_setup.clock_name,
        }
        self._emit(session, "message", default_value_prompt(session.language, label, values[label]))
        self._emit_retry_or_phase_choice(session)

    def _repeat_invalid(self, session: _Session, label: str, error: str, prompt) -> None:
        self._emit(session, "message", invalid_value(session.language, label, error))
        self._emit(session, "message", prompt(session.language))
        self._emit_retry_or_phase_choice(session)

    def _emit_retry_or_phase_choice(self, session: _Session) -> None:
        pending = session.interaction_retry
        if pending is None:
            self._emit_phase_choice(session)
            return
        session.pending_interaction = pending
        session.interaction_retry = None
        request = pending["request"]
        self._emit(session, "interaction", request["title"], interaction=request)

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
        session.quick_setup = False
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
        interaction: dict[str, Any] | None = None,
        delta: str | None = None,
        message_id: str | None = None,
    ) -> None:
        event: dict[str, Any] = {
            "providerId": PROVIDER_ID,
            "sessionId": session.session_id,
            "text": text,
            "type": event_type,
        }
        if event_type in {"message", "tool", "error", "interaction", "optimization"}:
            event["messageId"] = message_id or uuid.uuid4().hex
        if interaction is not None:
            event["interaction"] = interaction
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

    def _emit_phase_choice(self, session: _Session, *, reuse_pending: bool = False) -> None:
        if reuse_pending and session.pending_interaction is not None:
            request = session.pending_interaction["request"]
            self._emit(session, "interaction", request["title"], interaction=request)
            return
        if session.pending_interaction is not None:
            session.interaction_history[session.pending_interaction["request"]["requestId"]] = "superseded"
        session.pending_interaction = None
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
        elif session.phase == "workspace_design":
            choice = default_value_choice(
                session.language,
                prompt_id,
                "Design Name",
                "",
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
            request, values = self._interaction_for_choice(session, choice)
            self._validate_interaction_budget(request)
            session.pending_interaction = {"request": request, "values": values}
            self._emit(session, "interaction", request["title"], interaction=request)

    def _interaction_for_choice(
        self, session: _Session, choice: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, str]]:
        request_id = uuid.uuid4().hex
        options = choice["options"]
        option_ids = {option["id"]: f"option-{uuid.uuid4().hex}" for option in options}
        values = {option_ids[option["id"]]: option["value"] for option in options}
        if session.phase in {
            "workspace_confirmation",
            "confirmation",
            "workspace_continue_confirmation",
            "workspace_parameter_confirmation",
            "workspace_signoff_confirmation",
        }:
            interaction = {
                "cancel": {"id": option_ids[options[1]["id"]], "label": options[1]["label"]},
                "confirm": {"id": option_ids[options[0]["id"]], "label": options[0]["label"]},
                "kind": "confirm",
            }
            kind = "confirm"
        elif choice.get("allowFreeText") and session.phase not in {
            "home_ready",
            "operation",
            "workspace_project_root",
            "workspace_filelist",
            "workspace_sdc",
        }:
            field_kind = "number" if session.phase in {
                "workspace_frequency",
                "workspace_max_fanout",
                "workspace_utilization",
                "workspace_density",
                "workspace_overflow",
            } else "path" if session.phase in {
                "workspace_project_root",
                "workspace_rtl",
                "workspace_filelist",
                "workspace_sdc",
                "workspace_pdk",
                "rerun_source_run",
                "rerun_workspace",
            } else "text"
            default = next(
                (
                    option["label"] if session.phase == "rerun_source_run" else option["value"]
                    for option in options
                    if option["value"] != EMPTY_CHOICE_VALUE
                ),
                "",
            )
            field: dict[str, Any] = {
                "id": "value",
                "kind": field_kind,
                "label": choice["title"],
                "required": session.phase not in {"workspace_filelist", "workspace_sdc", "rerun_parameter"},
            }
            if default:
                field["defaultValue"] = (
                    float(default)
                    if field_kind == "number" and "." in str(default)
                    else int(default)
                    if field_kind == "number"
                    else default
                )
            if session.phase == "workspace_rtl":
                field["extensions"] = ["v", "sv"]
            interaction = {"fields": [field], "kind": "form"}
            kind = "form"
        else:
            interaction = {
                "kind": "choice",
                "options": [
                    {"id": option_ids[option["id"]], "label": option["label"]} for option in options
                ],
                "variant": choice["variant"],
            }
            kind = "choice"
        request = {
            "interaction": interaction,
            "kind": kind,
            "purpose": "execution",
            "requestId": request_id,
            "schema_version": "flow-agent.interaction_request.v1",
            "status": "pending",
            "title": choice["title"],
        }
        if session.interaction_undo:
            request["canUndo"] = True
        if choice.get("description"):
            request["description"] = choice["description"]
        elif session.phase in _INTERACTION_DESCRIPTION_PHASES:
            request["description"] = _prompt_for_phase(session)
        return request, values

    def _emit_clarification(
        self, session: _Session, clarification: Any, continuation: str
    ) -> None:
        request_id = uuid.uuid4().hex
        options = [
            {"id": f"clarification-{uuid.uuid4().hex}", "label": option.label}
            for option in clarification.options
        ]
        request = {
            "description": clarification.description,
            "interaction": {"kind": "choice", "options": options, "variant": "list"},
            "kind": "choice",
            "purpose": "clarification",
            "requestId": request_id,
            "schema_version": "flow-agent.interaction_request.v1",
            "status": "pending",
            "title": clarification.title,
        }
        self._validate_interaction_budget(request)
        session.pending_interaction = {
            "continuation": continuation,
            "request": request,
            "values": {
                option["id"]: source.label
                for option, source in zip(options, clarification.options, strict=True)
            },
        }
        self._emit(
            session,
            "message",
            clarification.description or clarification.title,
        )
        self._emit(session, "interaction", clarification.title, interaction=request)


    @staticmethod
    def _validate_interaction_budget(request: dict[str, Any]) -> None:
        if len(str(request.get("title", ""))) > 512 or len(
            str(request.get("description") or "")
        ) > 512:
            raise ValueError("Interaction text exceeds the protocol budget.")
        interaction = request.get("interaction", {})
        if request.get("kind") == "choice":
            options = interaction.get("options", [])
            if not 1 <= len(options) <= 32 or any(
                len(str(option.get("id", ""))) > 128
                or len(str(option.get("label", ""))) > 256
                for option in options
            ):
                raise ValueError("Interaction options exceed the protocol budget.")
        elif request.get("kind") == "confirm":
            options = [interaction.get("confirm", {}), interaction.get("cancel", {})]
            if any(
                len(str(option.get("id", ""))) > 128
                or len(str(option.get("label", ""))) > 256
                for option in options
            ):
                raise ValueError("Interaction options exceed the protocol budget.")
        elif request.get("kind") == "form":
            fields = interaction.get("fields", [])
            if not 1 <= len(fields) <= 16:
                raise ValueError("Interaction fields exceed the protocol budget.")
            for field in fields:
                if len(str(field.get("label", ""))) > 256:
                    raise ValueError("Interaction field text exceeds the protocol budget.")
                options = field.get("options", [])
                if len(options) > 32 or any(len(str(option.get("label", ""))) > 256 for option in options):
                    raise ValueError("Interaction select options exceed the protocol budget.")
        payload = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > 64 * 1024:
            raise ValueError("Interaction payload exceeds the protocol budget.")

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
                "awaiting_interaction"
                if not session.creating_project and session.known_projects
                else "idle"
            )
        if session.phase == "workspace_name":
            return "awaiting_interaction" if session.workspace_inputs.project_root else "idle"
        if session.phase == "workspace_design":
            return "awaiting_interaction"
        if session.phase == "rerun_workspace":
            return "awaiting_interaction" if session.rerun_workspace_path else "idle"
        return (
            "awaiting_interaction"
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
        session.quick_setup = False
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
        session.interaction_undo.clear()


def main() -> int:
    from ecos_agent.protocol import EcosAgentProtocolServer

    return EcosAgentProtocolServer().serve()


if __name__ == "__main__":
    raise SystemExit(main())
