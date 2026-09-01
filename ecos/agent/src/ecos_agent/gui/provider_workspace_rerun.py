"""Workspace rerun selection and execution confirmation."""

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


class ProviderWorkspaceRerunMixin:
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
        resolver = WorkspaceFlow(session).resolver
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
        resolver = WorkspaceFlow(session).resolver
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
                resolver.validate_patch(
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
        resolver = WorkspaceFlow(session).resolver
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
        if message == "1":
            setup_id = session.workspace_setup_id
            if setup_id is None:
                self._emit(session, "error", "Workspace setup session is invalid.")
                return
            self._emit(
                session,
                "workspace_create",
                workspace_execution_started(session.language),
                workspace_create_setup_id=setup_id,
            )
            session.phase = "workspace_creation_pending"
            return
        if message == "2":
            self._reset(session)
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        try:
            proposed = _deterministic_spec_correction(message)
            if proposed is None:
                proposed = GuiWorkspaceSetupProposal.model_validate(
                    self.workspace_setup_parser(
                        {
                            "schema_version": "flow-agent.gui_workspace_setup_context.v2",
                            "natural_language_choice": message,
                            "stage": "spec",
                            "recommended_defaults": session.workspace_setup.model_dump(
                                mode="json"
                            ),
                            "workspace_inputs": _workspace_inputs_payload(
                                session.workspace_inputs
                            ),
                            "filesystem_roots": list(
                                workspace_search_roots(
                                    session.workspace_inputs.project_root
                                )
                            ),
                            "explicit_paths": _explicit_path_tokens(message),
                            "_progress_callback": lambda text: self._progress(
                                session, text
                            ),
                            "_register_interrupt": lambda callback: self._register_interrupt(
                                session, callback
                            ),
                        }
                    )
                )
                self._check_interrupted(session)
            corrected_setup, corrected_inputs = self._corrected_workspace_state(
                session, proposed, message
            )
            workspace_setup_contract(
                corrected_setup,
                corrected_inputs,
                session.language,
                session.workspace_setup_id or "pending",
            )
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            self._emit(
                session,
                "error",
                f"Unable to correct the workspace specification: {exc}",
            )
            self._emit(
                session,
                "message",
                workspace_confirmation_prompt(session.language),
            )
            self._emit_phase_choice(session)
            return
        session.workspace_setup = corrected_setup
        session.workspace_inputs = corrected_inputs
        self._show_workspace_contract(session)

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
        try:
            result = WorkspaceFlow(session).rerun_result(message)
        except ValueError as exc:
            self._emit(session, "error", str(exc))
            return
        contract = session.workspace_rerun_contract
        assert contract is not None
        if result.status == "succeeded":
            if result.end_step and result.end_step.lower() == "harden":
                self._begin_workspace_signoff(session, contract.target_workspace)
                return
            self._emit(
                session,
                "message",
                _rerun_completion_message(session.language),
            )
            self._reset(session)
            self._emit_phase_choice(session)
            return
        self._emit(session, "error", f"Workspace rerun failed: {result.error}")
        self._emit(session, "message", confirmation_menu(session.language))
        session.phase = "confirmation"
        self._emit_phase_choice(session)
