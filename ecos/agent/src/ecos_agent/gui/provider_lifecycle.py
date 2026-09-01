"""GUI session, interaction, and slash-command lifecycle."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.codex.provider import (
    CodexAppServerProposalProvider,
    CodexProviderError,
    create_required_codex_provider,
    validate_required_codex_cli,
)
from ecos_agent.gui.contracts import (
    GuiClarificationOption,
    GuiClarificationProposal,
    GuiChatResponseProposal,
)
from ecos_agent.knowledge.contracts import SourceSearchProposal, StageRoutingProposal
from ecos_agent.workspace.contracts import (
    GuiWorkspaceSetupProposal,
)
from ecos_agent.knowledge.bundle import KnowledgeAnswer
from ecos_agent.knowledge.retriever import GlobalKnowledgeRetriever, load_production_retrieval_config
from ecos_agent.knowledge.source import SourceCodeRetriever, SourceSearchResult
from ecos_agent.knowledge.step import (
    StepKnowledge,
    load_default_general_knowledge_bundles,
    load_default_step_knowledge,
)
from ecos_agent.gui.messages import (
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
from ecos_agent.workspace.setup import (
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
from ecos_agent.workspace.knob_registry import resolve_write
from ecos_agent.workspace.rerun import (
    BOOLEAN_RERUN_KNOBS,
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunDiscovery,
    GuiWorkspaceRerunParameterProposal,
    GuiWorkspaceRerunResolver,
    catalog_end_step,
)
from ecos_agent.gui.support import (
    CreateBootstrap,
    _allowed_operation_options,
    _deterministic_spec_correction,
    _deterministic_operation_choice,
    _explicit_path_tokens,
    _extract_create_bootstrap,
    _flow_steps,
    _gui_workspace_codex_provider,
    _gui_workspace_request_context,
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
    _rerun_completion_message,
    _required_message,
    _validate_workspace_input_roots,
    _validated_path_recommendations,
    _workspace_creation_result,
    _workspace_inputs_payload,
    _workspace_rerun_execution_contract,
)
from ecos_agent.gui.workspace_flow import WorkspaceFlow
from ecos_agent.optimization.contracts import (
    OptimizationEpisodeState,
    OptimizationObjectiveProposal,
)
from ecos_agent.optimization.rules import freeze_optimization_objective
from ecos_agent.optimization.runner import OptimizationEpisodeRunner
from ecos_agent.gui.session import ProviderSession



from ecos_agent.gui.provider_common import (
    PROVIDER_ID,
    _WorkspaceSetupParser,
    _WorkspacePathRecommender,
    _RerunParameterParser,
    _ChatResponseParser,
    _SourceRetrievalParser,
    _StageRoutingParser,
    _OptimizationProviderFactory,
    _OptimizationRunnerFactory,
    _DEFAULT_CHAT_RESPONSE_PARSER,
    _CHAT_GREETING_PREFIXES,
    _GREETING_PATTERN,
    _CHAT_QUESTION_PREFIXES,
    _project_root_for_workspace,
    _is_conversational_input,
    _is_greeting,
    _scope_response,
    _proposal_sha256,
    _freeze_optimization_objective,
    _objective_sha256,
    _objective_primary_metric,
    _activity_identifier,
    _objective_string_tuple,
    _known_projects,
    _design_id_for_workspace,
    _NUMERIC_FIELDS,
    _INTERACTION_UNDO_FIELDS,
    _INTERACTION_UNDO_LIMIT,
    _INTERACTION_UNDO_BARRIER_PHASES,
    _INTERACTION_DESCRIPTION_PHASES,
    _Session,
)


class ProviderLifecycleMixin:
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
        message = _required_message(request.get("message"))
        with session.state_lock:
            if session.pending_interaction is not None:
                raise ValueError("An interaction answer is required for this session.")
            session.interaction_undo.clear()
            optimization_active = self._optimization_thread_active(session)
            if not optimization_active:
                self._reserve_turn_locked(session)
        if optimization_active:
            self._handle_optimization_control(session, message)
            return {
                "messageId": uuid.uuid4().hex,
                "sessionId": session.session_id,
                "turnId": uuid.uuid4().hex,
            }
        return self._run_turn(session, message, turn_reserved=True)

    def get_model_settings(self, request: Mapping[str, Any]) -> dict[str, Any]:
        session = self._session(request)
        return self._chat_provider(session).get_model_settings()

    def set_model_settings(self, request: Mapping[str, Any]) -> dict[str, Any]:
        session = self._session(request)
        with session.state_lock:
            if session.running:
                raise ValueError("Model settings cannot change while the Agent is running.")
        model = _optional_text(request.get("model"))
        reasoning_effort = _optional_text(request.get("reasoningEffort"))
        if model is None and reasoning_effort is None:
            raise ValueError("A model or reasoning effort is required.")
        return self._chat_provider(session).set_model_settings(
            model=model, reasoning_effort=reasoning_effort
        )

    @staticmethod
    def _reserve_turn_locked(session: _Session) -> None:
        if session.running:
            raise ValueError("An ECOS Agent turn is already running for this session.")
        session.running = True

    @classmethod
    def _reserve_turn(cls, session: _Session) -> None:
        with session.state_lock:
            cls._reserve_turn_locked(session)

    @staticmethod
    def _finish_turn(session: _Session) -> None:
        with session.state_lock:
            session.running = False

    def _run_turn(
        self,
        session: _Session,
        message: str,
        handler: Callable[[_Session, str], None] | None = None,
        *,
        turn_reserved: bool = False,
    ) -> dict[str, str]:
        if not turn_reserved:
            self._reserve_turn(session)
        if not session.language_locked:
            session.language = language_for_text(message)
            session.language_locked = True
        turn_id = uuid.uuid4().hex
        session.active_turn_id = turn_id
        session.active_turn_started_at = round(time.time() * 1000)
        session.active_local_activities.clear()
        session.active_tool_message_id = f"{turn_id}-tool"
        session.interrupt_requested = False
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
            session.active_turn_started_at = None
            session.active_local_activities.clear()
            self._finish_turn(session)
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
                self._reserve_turn(session)
                try:
                    return self._undo_interaction(session, None)
                finally:
                    self._finish_turn(session)
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
        if request.get("undo") is True:
            self._reserve_turn(session)
            try:
                return self._undo_interaction(session, pending)
            finally:
                self._finish_turn(session)

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
        self._reserve_turn(session)
        try:
            undo_state = self._capture_interaction_state(session)
            if reversible_selection:
                session.interaction_undo.append(undo_state)
                del session.interaction_undo[:-_INTERACTION_UNDO_LIMIT]
            session.pending_interaction = None
            session.interaction_retry = pending
        except Exception:
            self._finish_turn(session)
            raise

        def run_answer() -> None:
            try:
                self._run_turn(
                    session, str(message), handler, turn_reserved=True
                )
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
            thread = threading.Thread(target=run_answer, daemon=True)
            try:
                thread.start()
            except Exception:
                self._finish_turn(session)
                raise
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
        with session.state_lock:
            running = session.running
            if running:
                session.interrupt_requested = True
            active_interrupt = session.active_interrupt
        if not running:
            self._emit_status(session, self._resting_status(session))
            return
        self._emit_status(session, "interrupted")
        if active_interrupt is not None:
            active_interrupt()

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
