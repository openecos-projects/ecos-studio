"""Workspace creation, continuation, signoff, and parameter updates."""

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


class ProviderWorkspaceLifecycleMixin:
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
            workspace_flow = WorkspaceFlow(session)
            parameter_values = workspace_flow.tunable_parameters(source)
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
            workspace_flow.validate_parameter_patch(patch, current_values)
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
