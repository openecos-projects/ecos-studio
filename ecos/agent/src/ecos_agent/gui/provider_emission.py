"""GUI event, interaction, progress, and reset emission."""

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


class ProviderEmissionMixin:
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
        activity: dict[str, Any] | None = None,
        delta: str | None = None,
        message_id: str | None = None,
    ) -> None:
        event: dict[str, Any] = {
            "providerId": PROVIDER_ID,
            "sessionId": session.session_id,
            "text": text,
            "type": event_type,
        }
        if event_type in {"message", "tool", "activity", "error", "interaction", "optimization"}:
            event["messageId"] = message_id or uuid.uuid4().hex
        if activity is not None:
            event["activity"] = activity
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

    def _progress(self, session: _Session, activity: str | Mapping[str, Any]) -> None:
        self._check_interrupted(session)
        if isinstance(activity, Mapping):
            payload = dict(activity)
            raw_source_turn_id = str(payload.get("turnId") or "")
            source_turn_id = (
                _activity_identifier(raw_source_turn_id) if raw_source_turn_id else ""
            )
            item_id = _activity_identifier(payload.get("itemId"))
            payload["itemId"] = item_id
            if payload.get("turnId") is not None:
                payload["turnId"] = _activity_identifier(payload["turnId"])
            if session.active_turn_id:
                payload["turnId"] = session.active_turn_id
                if session.active_turn_started_at is not None:
                    payload["turnStartedAt"] = session.active_turn_started_at
                if source_turn_id:
                    payload["itemId"] = _activity_identifier(
                        f"{source_turn_id[:64]}-{item_id[:63]}"
                    )
            self._emit(
                session,
                "activity",
                "",
                activity=payload,
                message_id=str(payload["itemId"]),
            )
            return
        self._emit(
            session,
            "tool",
            activity,
            delta=f"{activity}\n",
            message_id=session.active_tool_message_id,
        )

    def _local_activity(
        self,
        session: _Session,
        item_id: str,
        tool: str,
        status: str,
        *,
        arguments: object | None = None,
        progress: str | None = None,
        result: object | None = None,
        error: str | None = None,
    ) -> None:
        key = _activity_identifier(f"local-{item_id}")
        now = round(time.time() * 1000)
        activity = session.active_local_activities.setdefault(
            key,
            {
                "schema_version": "flow-agent.activity.v1",
                "itemId": key,
                "kind": "tool_call",
                "startedAt": now,
                "status": "running",
                "tool": tool,
            },
        )
        activity.update(status=status, tool=tool)
        if arguments is not None:
            activity["arguments"] = json.dumps(
                arguments, ensure_ascii=False, sort_keys=True, indent=2
            )
        if progress is not None:
            activity["progress"] = progress
        if result is not None:
            activity["result"] = json.dumps(
                result, ensure_ascii=False, sort_keys=True, indent=2
            )
        if error is not None:
            activity["error"] = error[:4096]
        if status != "running":
            activity["durationMs"] = max(0, now - int(activity["startedAt"]))
        self._progress(session, activity)

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
