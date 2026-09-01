"""Controlled, deterministic interaction provider for the ECOS Agent GUI."""

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

from ecos_agent.gui.provider_chat import ProviderChatMixin
from ecos_agent.gui.provider_emission import ProviderEmissionMixin
from ecos_agent.gui.provider_lifecycle import ProviderLifecycleMixin
from ecos_agent.gui.provider_optimization import ProviderOptimizationMixin
from ecos_agent.gui.provider_workspace_lifecycle import ProviderWorkspaceLifecycleMixin
from ecos_agent.gui.provider_workspace_rerun import ProviderWorkspaceRerunMixin
from ecos_agent.gui.provider_workspace_setup import ProviderWorkspaceSetupMixin


class EcosAgentProvider(
    ProviderLifecycleMixin,
    ProviderChatMixin,
    ProviderOptimizationMixin,
    ProviderWorkspaceLifecycleMixin,
    ProviderWorkspaceSetupMixin,
    ProviderWorkspaceRerunMixin,
    ProviderEmissionMixin,
):
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
        self.chat_provider_factory = create_required_codex_provider
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
