"""GUI-controlled optimization episode lifecycle."""

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


class ProviderOptimizationMixin:
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
