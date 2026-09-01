"""GUI input routing, knowledge answers, and bounded chat."""

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


class ProviderChatMixin:
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

    @staticmethod
    def _ambiguous_stage_execution_request(message: str) -> bool:
        text = message.casefold()
        if "stage" not in text or not any(
            term in text for term in ("execution", "execute", "run", "perform")
        ):
            return False
        return not any(term in text for term in ("rerun", "re-run", "re run", "again", "重跑"))

    def _answer_non_state_input(
        self, session: _Session, message: str, *, allow_operations: bool
    ) -> None:
        answer, scope = self._knowledge_answer(session, message)
        if scope != "in_scope":
            text, intent = _scope_response(message, scope)
            self._emit(
                session,
                "message",
                text,
                contract={
                    "schema_version": "flow-agent.gui_chat_response.v1",
                    "intent": intent,
                    "scope": scope,
                    "operation": None,
                    "evidence_ids": [],
                    "read_only": True,
                    "backend": "local_policy",
                },
            )
            if session.phase in {"home_ready", "operation"}:
                self._emit_phase_choice(session)
            return
        source_result = self._source_code_evidence(session, message, answer)
        self._answer_with_codex(
            session,
            message,
            allow_operations=allow_operations,
            knowledge_answer=answer,
            source_result=source_result,
        )

    def _knowledge_answer(
        self, session: _Session, message: str
    ) -> tuple[KnowledgeAnswer | None, str]:
        if _is_greeting(message):
            return None, "in_scope"
        self._local_activity(
            session,
            "stage-identification",
            "Identify design stage",
            "running",
            progress="Matching the question to the ECOS stage catalog",
        )
        deterministic_scope = self.knowledge_retriever.stage_scope(message)
        stages: tuple[str, ...] = ()
        routing: dict[str, object] = {
            "status": "not_requested",
            "reason": "deterministic_stage_scope",
            "scope": "in_scope",
        }
        if self._started or not self._uses_default_stage_routing:
            stages, routing = self._propose_knowledge_stages(session, message)
        elif not deterministic_scope.candidate_stages:
            routing = {
                "status": "not_requested",
                "reason": "provider_not_started",
                "scope": "in_scope",
            }
        candidate_stages = list(
            dict.fromkeys((*deterministic_scope.candidate_stages, *stages))
        )
        stage_label = (
            f"Identified {', '.join(candidate_stages)} stage"
            if candidate_stages
            else "Checked design stage"
        )
        scope = str(routing.get("scope", "in_scope"))
        self._local_activity(
            session,
            "stage-identification",
            stage_label,
            "completed",
            result={
                "candidate_stages": candidate_stages,
                "reason": deterministic_scope.reason,
                "routing_status": routing.get("status"),
                "scope": scope,
            },
        )
        if scope != "in_scope":
            return None, scope
        retrieval_routing = {key: value for key, value in routing.items() if key != "scope"}
        self._local_activity(
            session,
            "knowledge-search",
            "Search ECOS knowledge",
            "running",
            arguments={"candidate_stages": candidate_stages},
            progress="Searching the verified ECOS knowledge index",
        )
        try:
            baseline = self.knowledge_retriever.reply_global(message)
            answer = self.knowledge_retriever.reply_hybrid(
                message,
                candidate_stages=stages,
                deterministic_scope=deterministic_scope,
                routing=retrieval_routing,
            )
        except Exception as exc:
            self._local_activity(
                session,
                "knowledge-search",
                "Search ECOS knowledge",
                "failed",
                error=str(exc),
            )
            raise
        selected = answer or baseline
        entity_ids = list(selected.entity_ids) if selected is not None else []
        self._local_activity(
            session,
            "knowledge-search",
            "Searched ECOS knowledge",
            "completed",
            result={"match_count": len(entity_ids), "entity_ids": entity_ids},
        )
        return selected, scope

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
                return (), {
                    "status": "rejected",
                    "reason": "unknown_stage",
                    "scope": proposal.scope,
                }
            return stages, {
                "status": "accepted" if stages else "abstained",
                "scope": proposal.scope,
                "candidate_stages": list(stages),
                "proposal_sha256": _proposal_sha256(proposal),
            }
        except (CodexProviderError, ValueError):
            return (), {
                "status": "fallback",
                "reason": "proposal_unavailable",
                "scope": "ambiguous",
            }

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
            queries = [query.model_dump(mode="json") for query in proposal.queries]
            self._local_activity(
                session,
                "source-search",
                "Search workspace sources",
                "running",
                arguments={
                    "roots": list(self.source_retriever.available_root_ids),
                    "queries": queries,
                },
                progress="Searching approved source roots",
            )
            result = self.source_retriever.retrieve(proposal)
            self._local_activity(
                session,
                "source-search",
                "Searched workspace sources",
                "completed",
                result={
                    "evidence_count": len(result.evidence),
                    "paths": list(dict.fromkeys(item.path for item in result.evidence)),
                    "result_limit_reached": result.result_limit_reached,
                },
            )
            return result
        except (CodexProviderError, ValueError) as exc:
            if "local-source-search" in session.active_local_activities:
                self._local_activity(
                    session,
                    "source-search",
                    "Search workspace sources",
                    "failed",
                    error=str(exc),
                )
            return None

    def _select_home_ready(self, session: _Session, message: str, choice: str) -> None:
        if choice == "1":
            self._begin_home_workspace_create(session, message if message.strip() != "1" else "")
            return
        if choice == "2":
            session.phase = "optimization_workspace"
            self._emit(session, "message", optimization_workspace_prompt(session.language))
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
            self._complete_answer_validation(session, "clarification", 0)
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
                    self._local_activity(
                        session,
                        "answer-validation",
                        "Validate answer evidence",
                        "failed",
                        error="The answer cited unavailable source evidence.",
                    )
                    self._emit(session, "error", "The answer cited unavailable source evidence.")
                    return
                contract["source_retrieval"] = source_result.contract()
                contract["source_evidence_ids"] = list(response.evidence_ids)
            self._complete_answer_validation(
                session, "answer", len(response.evidence_ids)
            )
            self._emit(
                session,
                "message",
                response.answer or "",
                contract=contract,
            )
            return
        if self._ambiguous_stage_execution_request(message) and self._resolve_operation_choice(
            session, message
        ) is None:
            options = tuple(
                GuiClarificationOption(id=option["id"], label=option["label"])
                for option in allowed_options
            )
            self._emit_clarification(
                session,
                GuiClarificationProposal(
                    title="Choose an operation",
                    description="This stage request does not identify a specific operation.",
                    options=options,
                ),
                message,
            )
            return
        allowed_ids = {option["id"] for option in allowed_options}
        if response.operation not in allowed_ids:
            self._local_activity(
                session,
                "answer-validation",
                "Validate answer evidence",
                "failed",
                error="The interpreted operation is not available in the current session.",
            )
            self._emit(session, "error", "The interpreted operation is not available in the current session.")
            return
        self._complete_answer_validation(session, "operation", 0)
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
            self._local_activity(
                session,
                "answer-validation",
                "Validate answer evidence",
                "running",
                arguments={"schema": "flow-agent.gui_chat_response.v1"},
                progress="Checking the response schema and evidence references",
            )
            response = GuiChatResponseProposal.model_validate(response_payload)
            self._check_interrupted(session)
        except (CodexProviderError, ValueError) as exc:
            self._check_interrupted(session)
            self._raise_if_interrupted(exc)
            if "local-answer-validation" in session.active_local_activities:
                self._local_activity(
                    session,
                    "answer-validation",
                    "Validate answer evidence",
                    "failed",
                    error=str(exc),
                )
            if report_error:
                self._emit(session, "error", f"Unable to answer the request: {exc}")
            return None
        return response

    def _complete_answer_validation(
        self, session: _Session, route: str, evidence_reference_count: int
    ) -> None:
        self._local_activity(
            session,
            "answer-validation",
            "Validated answer evidence",
            "completed",
            result={
                "schema": "flow-agent.gui_chat_response.v1",
                "route": route,
                "evidence_reference_count": evidence_reference_count,
            },
        )

    def _chat_provider(self, session: _Session) -> CodexAppServerProposalProvider:
        if session.codex_provider is None:
            cwd_value = session.rerun_workspace_path or session.project_root
            cwd = Path(cwd_value).expanduser().resolve() if cwd_value else Path.cwd()
            if not cwd.is_dir():
                cwd = Path.cwd()
            session.codex_provider = self.chat_provider_factory(
                cwd=cwd,
                runtime_workspace_roots=(cwd,),
                progress_callback=lambda text: self._progress(session, text),
                ephemeral=False,
            )
        return session.codex_provider
