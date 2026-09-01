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


def _scope_response(message: str, scope: str) -> tuple[str, str]:
    is_chinese = language_for_text(message) == "zh"
    if scope == "out_of_scope":
        return (
            "该问题与 IC/EDA 或 ECOS Studio 无关。ECOS Agent 仅协助芯片设计流程、工程配置、结果分析及相关工具问题。"
            if is_chinese
            else "This request is outside IC/EDA and ECOS Studio. ECOS Agent only assists with chip-design flows, engineering configuration, result analysis, and related tools.",
            "scope_refusal",
        )
    return (
        "请说明该问题与当前 IC/EDA 或 ECOS Studio 任务的关系。"
        if is_chinese
        else "Please explain how this request relates to the current IC/EDA or ECOS Studio task.",
        "scope_clarification",
    )


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


def _activity_identifier(value: object, fallback: str | None = None) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_-]+", "-", str(value or "")).strip("-_")
    return (normalized or fallback or uuid.uuid4().hex)[:128]


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


_Session = ProviderSession
