"""GUI-controlled optimization episode lifecycle."""

from __future__ import annotations

import copy
import hashlib
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.gui.provider_optimization_episode import ProviderOptimizationEpisodeMixin
from ecos_agent.gui.provider_optimization_recovery import (
    ProviderOptimizationRecoveryMixin,
    write_optimization_resume_context,
)
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
    optimization_noise_calibration_message,
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
from ecos_agent.optimization.calibrate_workspace import calibrate
from ecos_agent.optimization.contracts import (
    OptimizationObjectiveContract,
)
from ecos_agent.optimization.observations import build_terminal_observation
from ecos_agent.optimization.runtime import epsilon_artifact_path
from ecos_agent.optimization.rules import geometry_constraint_error
from ecos_agent.optimization.objective_alignment import (
    build_active_objective,
    build_objective_alignment,
)
from ecos_agent.optimization.runner import OptimizationEpisodeRunner
from ecos_agent.gui.session import ProviderSession
from ecos_agent.hashing import canonical_sha256

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

def _optimization_turn_event_payload(
    session: _Session,
    runner: OptimizationEpisodeRunner,
    kind: str,
    detail: Mapping[str, Any],
) -> dict[str, Any]:
    active = session.optimization_active_objective or {}
    return {
        "schema_version": "ecos.optimization_turn_event.v1",
        "episode_id": runner.episode_id,
        "objective_sha256": session.optimization_objective_sha256,
        "active_primary_metric": active.get("active_primary_metric"),
        "recovery_stage": active.get("recovery_stage"),
        "kind": kind,
        **detail,
    }

class ProviderOptimizationMixin(
    ProviderOptimizationRecoveryMixin, ProviderOptimizationEpisodeMixin
):
    def _emit_optimization_status(
        self, session: _Session, state: str | None = None
    ) -> None:
        episode_id = session.optimization_episode_id
        if episode_id is None:
            return
        active = session.optimization_active_objective or {}
        runner = session.optimization_runner
        pending = getattr(runner, "pending_execution_ids", ()) if runner is not None else ()
        self._emit(
            session,
            "optimization",
            f"Optimization episode {state or session.optimization_phase}.",
            optimization={
                "schema_version": "ecos.optimization_status.v2",
                "episode_id": episode_id,
                "workspace": session.rerun_workspace_path,
                "state": state or str(session.optimization_phase),
                "phase": str(session.optimization_phase),
                "turn_count": session.optimization_turn_count,
                "in_flight": len(pending),
                "calibration_completed": session.optimization_calibration_completed,
                "calibration_required": session.optimization_calibration_required,
                "objective_sha256": session.optimization_objective_sha256,
                "active_primary_metric": active.get("active_primary_metric"),
                "recovery_stage": active.get("recovery_stage"),
                "violation_counts": {
                    key: active.get(key)
                    for key in (
                        "drc_count",
                        "sta_setup_violation_count",
                        "sta_hold_violation_count",
                    )
                    if active.get(key) is not None
                },
            },
        )

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
        session.optimization_objective_alignment = None
        session.optimization_active_objective = None
        self._emit(session, "message", optimization_objective_prompt(session.language))
    def _begin_optimization_authorization(self, session: _Session) -> None:
        workspace = session.rerun_workspace_path
        if not workspace or not Path(workspace).is_dir():
            self._emit(session, "error", "An existing workspace is required for optimization.")
            self._emit_phase_choice(session)
            return
        session.phase = "optimization_authorization"
        session.optimization_phase = "awaiting_confirmation"
        # The episode id and its diagnostics file are created with the
        # objective provider so the episode reuses that provider.
        session.optimization_episode_id = (
            session.optimization_episode_id or f"episode-{uuid.uuid4().hex}"
        )
        active = session.optimization_active_objective
        alignment = session.optimization_objective_alignment
        if active is None or alignment is None or session.optimization_objective is None:
            raise ValueError("Optimization objective alignment is incomplete.")
        counts = {
            key: int(active[key])
            for key in (
                "drc_count",
                "sta_setup_violation_count",
                "sta_hold_violation_count",
            )
        }
        self._emit(
            session,
            "message",
            optimization_authorization_prompt(
                session.language,
                workspace,
                original_primary_metric=str(active["original_primary_metric"]),
                active_primary_metric=str(active["active_primary_metric"]),
                recovery_stage=str(active["recovery_stage"]),
                violation_counts=counts,
            ),
            optimization={
                "schema_version": "ecos.optimization_authorization.v2",
                "episode_id": session.optimization_episode_id,
                "workspace": workspace,
                "original_objective": session.optimization_objective,
                "objective_sha256": session.optimization_objective_sha256,
                "alignment_sha256": alignment["alignment_contract_sha256"],
                "original_primary_metric": active["original_primary_metric"],
                "active_primary_metric": active["active_primary_metric"],
                "active_preserve_metrics": active["active_preserve_metrics"],
                "violation_counts": counts,
                "recovery_stage": active["recovery_stage"],
                "requires_confirmation": True,
                "execution": "fixed candidate.rerun only",
            },
        )
        self._emit_optimization_status(session, "awaiting_confirmation")
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
    @staticmethod
    def _inherit_chat_model_settings(session: _Session, provider: Any) -> None:
        """Copy the GUI-selected model/effort from the chat provider.

        Proposal providers start unconfigured and would otherwise use the
        app-server default model, ignoring the user's GUI selection.
        """
        chat = session.codex_provider
        inherit = getattr(provider, "inherit_model_settings", None)
        if chat is not None and inherit is not None:
            inherit(chat)

    @classmethod
    def _close_idle_optimization_provider(cls, session: _Session) -> None:
        """Release a pre-started provider no episode thread is using."""
        provider = session.optimization_provider
        if provider is not None and not cls._optimization_thread_active(session):
            provider.close()
            session.optimization_provider = None

    def _select_optimization_objective(self, session: _Session, message: str) -> None:
        goal = message.strip()
        if not goal:
            self._emit(session, "message", optimization_objective_prompt(session.language))
            return
        workspace = session.rerun_workspace_path
        if not workspace:
            raise ValueError("Optimization objective requires a workspace.")
        self._close_idle_optimization_provider(session)
        session.optimization_episode_id = f"episode-{uuid.uuid4().hex}"
        provider: CodexAppServerProposalProvider | None = None
        # The baseline scan reads only workspace reports and the objective
        # parse only reads the goal text; run them concurrently.
        with ThreadPoolExecutor(max_workers=1) as baseline_pool:
            baseline_future = baseline_pool.submit(
                build_terminal_observation, Path(workspace)
            )
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
                self._inherit_chat_model_settings(session, provider)
                session.active_interrupt = provider.interrupt
                proposal = provider.propose_optimization_objective(goal)
                contract = _freeze_optimization_objective(proposal, goal)
            except Exception as exc:
                if provider is not None:
                    provider.close()
                session.phase = "operation" if session.mode == "workspace" else "home_ready"
                session.optimization_phase = "unavailable"
                self._emit(session, "error", f"Unable to parse optimization objective: {exc}")
                self._emit_phase_choice(session)
                return
            finally:
                session.active_interrupt = None
            # Keep the provider alive: the episode reuses it after
            # confirmation instead of paying a second app-server start.
            session.optimization_provider = provider
            session.optimization_objective = contract
            session.optimization_objective_sha256 = _objective_sha256(contract)
            session.optimization_parameter_policy_sha256 = canonical_sha256(
                contract["parameter_policy"]
            )
            session.optimization_primary_metric = _objective_primary_metric(contract)
            try:
                objective = OptimizationObjectiveContract.model_validate(contract)
                baseline = baseline_future.result()
                geometry_error = geometry_constraint_error(objective, baseline.geometry, baseline)
                if geometry_error is not None:
                    raise ValueError(geometry_error)
                alignment = build_objective_alignment(objective, baseline)
                active = build_active_objective(alignment, objective, baseline)
            except Exception as exc:
                # A fresh objective parse creates a new provider, so a failed
                # alignment must not leave this one lingering.
                self._close_idle_optimization_provider(session)
                session.phase = "operation" if session.mode == "workspace" else "home_ready"
                session.optimization_phase = "unavailable"
                self._emit(
                    session,
                    "error",
                    f"Unable to align optimization objective with baseline: {exc}",
                )
                self._emit_phase_choice(session)
                return
            session.optimization_objective_alignment = alignment.model_dump(mode="json")
            session.optimization_active_objective = active.model_dump(mode="json")
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
                geometry_mode=contract["parameter_policy"]["geometry_mode"],
                advanced_parameters_enabled=contract["parameter_policy"]["advanced_parameters_enabled"],
            ),
        )
        self._begin_optimization_authorization(session)

    def _confirm_optimization_start(self, session: _Session, message: str) -> None:
        if message != "1":
            self._close_idle_optimization_provider(session)
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            session.optimization_phase = "idle"
            self._emit(session, "message", cancellation_message(session.language))
            self._emit_phase_choice(session)
            return
        if self.optimization_runner_factory is None:
            self._close_idle_optimization_provider(session)
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
        workspace_path = Path(workspace)
        try:
            write_optimization_resume_context(session)
        except Exception as exc:
            self._close_idle_optimization_provider(session)
            session.optimization_phase = "needs_attention"
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            self._emit(session, "error", f"Unable to persist optimization recovery context: {exc}")
            self._emit_optimization_status(session, "needs_attention")
            self._emit_phase_choice(session)
            return
        if not epsilon_artifact_path(workspace_path).is_file():
            self._calibrate_then_start_optimization(session, workspace_path)
            return
        self._launch_optimization_episode(session, workspace_path)

    def _calibrate_then_start_optimization(
        self, session: _Session, workspace_path: Path
    ) -> None:
        self._emit(
            session,
            "message",
            optimization_noise_calibration_message(session.language),
        )
        session.optimization_phase = "calibrating"
        session.optimization_calibration_completed = 0
        session.optimization_calibration_required = 3
        session.phase = "optimization_preparing"
        session.optimization_stop.clear()
        session.optimization_pause.clear()
        session.optimization_shutdown.clear()
        self._emit_status(session, "calibrating")
        self._emit_optimization_status(session, "calibrating")
        session.active_tool_message_id = (
            f"optimization-progress-{session.session_id}"
        )

        def replay_progress(completed: int, required: int, _state: str) -> None:
            session.optimization_calibration_completed = completed
            session.optimization_calibration_required = required
            self._emit_optimization_status(session, "calibrating")

        def run() -> None:
            try:
                calibrate(
                    workspace_path,
                    should_stop=session.optimization_stop.is_set,
                    progress=lambda text: self._progress(session, text),
                    replay_progress=replay_progress,
                )
            except Exception as exc:
                cancelled = session.optimization_stop.is_set()
                session.optimization_phase = "stopped" if cancelled else "needs_attention"
                session.phase = (
                    "operation" if session.mode == "workspace" else "home_ready"
                )
                session.active_tool_message_id = None
                if cancelled:
                    self._emit(session, "message", cancellation_message(session.language))
                else:
                    self._emit(
                        session,
                        "error",
                        f"Unable to calibrate noise epsilon: {exc}",
                    )
                self._emit_optimization_status(
                    session, "stopped" if cancelled else "needs_attention"
                )
                self._emit_phase_choice(session)
                session.optimization_thread = None
                return
            if session.optimization_shutdown.is_set():
                self._close_idle_optimization_provider(session)
                session.optimization_phase = "interrupted"
                session.phase = "operation" if session.mode == "workspace" else "home_ready"
                session.active_tool_message_id = None
                session.optimization_thread = None
                self._emit_optimization_status(session, "interrupted")
                self._emit_status(session, "interrupted")
                self._emit_phase_choice(session)
                return
            self._launch_optimization_episode(session, str(workspace_path))

        session.optimization_thread = threading.Thread(
            target=run,
            name=f"ecos-noise-calibration-{session.session_id}",
            daemon=True,
        )
        session.optimization_thread.start()

    def _launch_optimization_episode(
        self,
        session: _Session,
        workspace: str | Path,
        *,
        stop_before_dispatch: bool = False,
    ) -> None:
        workspace = str(workspace)
        session.optimization_phase = "starting"
        session.phase = "optimization_preparing"
        provider = session.optimization_provider
        try:
            write_optimization_resume_context(session)
            if provider is None:
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
                self._inherit_chat_model_settings(session, provider)
            runner_context: dict[str, Any] = {
                "session_id": session.session_id,
                "episode_id": session.optimization_episode_id,
                "workspace": workspace,
                "objective": session.optimization_objective,
                "objective_alignment": session.optimization_objective_alignment,
            }
            if session.workspace_handle:
                runner_context["workspace_handle"] = session.workspace_handle
            if session.workspace_revision is not None:
                runner_context["expected_workspace_revision"] = session.workspace_revision
            if session.optimization_ecc_revision is not None:
                runner_context["expected_ecc_revision"] = session.optimization_ecc_revision
            runner = self.optimization_runner_factory(runner_context, provider)
            if not isinstance(runner, OptimizationEpisodeRunner):
                raise ValueError("Optimization runner factory returned an invalid runner.")
        except Exception as exc:
            if provider is not None:
                provider.close()
            session.optimization_provider = None
            session.optimization_phase = "unavailable"
            session.phase = "operation" if session.mode == "workspace" else "home_ready"
            self._emit(session, "error", f"Unable to start optimization: {exc}")
            self._emit_phase_choice(session)
            return
        assert provider is not None
        controller = getattr(runner, "_controller", None)
        execution_context = getattr(controller, "_execution_context", {})
        ecc_revision = (
            execution_context.get("ecc_revision")
            if isinstance(execution_context, dict)
            else None
        ) or getattr(runner, "ecc_revision", None)
        if isinstance(ecc_revision, str) and ecc_revision:
            session.optimization_ecc_revision = ecc_revision
        if session.optimization_ecc_revision is None:
            raise ValueError("Optimization Episode ECC revision is unavailable.")
        write_optimization_resume_context(session)
        session.optimization_provider = provider
        session.optimization_runner = runner
        active_objective = getattr(runner, "active_objective", None)
        if active_objective is not None:
            session.optimization_active_objective = active_objective.model_dump(mode="json")
        if stop_before_dispatch:
            session.optimization_stop.set()
            runner.request_stop()
        else:
            session.optimization_stop.clear()
        session.optimization_pause.clear()
        session.optimization_shutdown.clear()
        session.optimization_turn_count = 0
        session.optimization_phase = "stopping" if stop_before_dispatch else "running"
        session.phase = "optimization_running"
        session.active_interrupt = provider.interrupt
        if not stop_before_dispatch:
            self._emit(session, "message", optimization_started_message(session.language))
        self._emit_status(session, "interrupted" if stop_before_dispatch else "running")
        self._emit_optimization_status(
            session, "stopping" if stop_before_dispatch else "running"
        )
        # Collapse planner progress lines into one tool message; per-turn
        # status lives on the optimization card, not in chat text.
        session.active_tool_message_id = (
            f"optimization-progress-{session.session_id}"
        )
        session.optimization_thread = threading.Thread(
            target=self._run_optimization_episode,
            args=(session,),
            name=f"ecos-optimization-{session.session_id}",
            daemon=True,
        )
        session.optimization_thread.start()

    def _emit_optimization_turn_event(
        self,
        session: _Session,
        runner: OptimizationEpisodeRunner,
        kind: str,
        detail: Mapping[str, Any],
    ) -> None:
        payload = _optimization_turn_event_payload(session, runner, kind, detail)
        if kind == "proposal":
            action = detail.get("action") or {}
            requested = detail.get("requested") or {}
            rationale = str(detail.get("rationale_summary") or "")
            if action:
                text = (
                    f"Turn {session.optimization_turn_count + 1} proposal: "
                    f"{action.get('direction')} {action.get('knob_id')}"
                )
                if requested:
                    text += f" to {requested.get('value')}"
                if rationale:
                    text += f" — {rationale}"
            else:
                text = (
                    f"Turn {session.optimization_turn_count + 1} proposal: "
                    f"{detail.get('proposal_decision')} "
                    f"({detail.get('proposal_reason')})"
                )
        elif kind == "dispatched":
            requested = detail.get("requested") or {}
            text = (
                f"Candidate dispatched: {requested.get('knob_id', 'unknown knob')}; "
                f"{detail.get('in_flight', 0)} in flight"
            )
        elif kind == "terminal":
            text = (
                f"Candidate finished: {detail.get('outcome')} "
                f"({detail.get('incumbent_decision') or 'no comparison'})"
            )
        elif kind == "ecc_step":
            self._emit_ecc_step_activity(session, detail)
            return
        else:
            text = f"Optimization event: {kind}"
        self._emit(session, "optimization", text, optimization=payload)

    def _emit_ecc_step_activity(
        self, session: _Session, detail: Mapping[str, Any]
    ) -> None:
        operation_id = str(detail.get("operation_id") or "unknown")
        step = str(detail.get("step") or "")
        tool = str(detail.get("tool") or "")
        event_type = str(detail.get("event_type") or "")
        if event_type == "operation.rerun_prepared":
            self._local_activity(
                session,
                f"ecc-{operation_id}-prepared",
                "candidate-rerun",
                "running",
                progress="Preparing candidate rerun workspace",
            )
            return
        label = " · ".join(part for part in (step, tool) if part) or event_type
        if event_type == "step.completed":
            status = (
                "completed"
                if str(detail.get("step_state") or "") == "Success"
                else "failed"
            )
        else:
            status = "running"
        self._local_activity(
            session,
            f"ecc-{operation_id}-{step or event_type}",
            "candidate-rerun",
            status,
            progress=label,
        )

    @staticmethod
    def _optimization_thread_active(session: _Session) -> bool:
        return session.optimization_thread is not None and session.optimization_thread.is_alive()

    def _handle_optimization_control(self, session: _Session, message: str) -> None:
        command = message.strip().casefold()
        if command in {"pause", "暂停"}:
            session.optimization_pause.set()
            session.optimization_phase = "paused"
            self._emit_status(session, "awaiting_choice")
            self._emit_optimization_status(session, "paused")
            return
        if command in {"resume", "继续"}:
            session.optimization_pause.clear()
            session.optimization_phase = "running"
            self._emit_status(session, "running")
            self._emit_optimization_status(session, "running")
            return
        if command in {"stop", "停止", "cancel", "取消"}:
            self._request_optimization_stop(session)
            session.optimization_phase = "stopping"
            self._emit_status(session, "interrupted")
            self._emit_optimization_status(session, "stopping")
            return
        self._emit(
            session,
            "message",
            "Optimization is active. Use pause, resume, or stop.",
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
        if session.optimization_runner is not None and session.optimization_provider is not None:
            # Interrupt only aborts an in-flight planning turn; with no runner
            # (e.g. during noise calibration) it would leave the reused
            # provider marked interrupted for the next episode.
            session.optimization_provider.interrupt()
