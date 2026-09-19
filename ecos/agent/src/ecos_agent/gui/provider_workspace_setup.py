"""Workspace setup field selection and local defaults."""

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


class ProviderWorkspaceSetupMixin:
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
        session.workspace_setup = recommended_workspace_setup()
        session.workspace_inputs = WorkspaceInputs()
        session.path_recommendations = {}
        session.workspace_setup_id = None
        session.workspace_contract = None
