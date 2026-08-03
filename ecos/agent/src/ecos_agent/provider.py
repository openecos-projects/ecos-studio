"""Controlled, deterministic interaction provider for the ECOS Agent GUI."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.codex_provider import CodexProviderError
from ecos_agent.contracts import GuiWorkspaceSetupProposal
from ecos_agent.messages import (
    cancellation_message,
    confirmation_menu,
    contract_ready_message,
    design_name_prompt,
    default_value_prompt,
    flow_end_prompt,
    invalid_choice,
    invalid_value,
    language_for_text,
    no_source_run_message,
    number_prompt,
    numbered_choice,
    operation_prompt,
    optional_file_prompt,
    pdk_prompt,
    rerun_parameter_prompt,
    rerun_scope_prompt,
    project_root_prompt,
    rerun_design_prompt,
    rerun_stage_prompt,
    rtl_prompt,
    welcome_message,
    workspace_confirmation_prompt,
    workspace_creation_failed,
    workspace_execution_started,
)
from ecos_agent.workspace_setup import (
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
    recommended_workspace_setup,
    workspace_search_roots,
    workspace_setup_contract,
)
from ecos_agent.workspace_rerun import (
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunDiscovery,
    GuiWorkspaceRerunParameterProposal,
    GuiWorkspaceRerunPathProposal,
    GuiWorkspaceRerunResolver,
)
from ecos_agent.provider_support import (
    _confirm_workspace_execution,
    _flow_steps,
    _gui_workspace_codex_provider,
    _gui_workspace_request_context,
    _handle_workspace_rerun_result,
    _number_default,
    _operation_choice,
    _optional_text,
    _path_was_explicitly_provided,
    _prompt_for_phase,
    _propose_gui_workspace_path_discovery,
    _propose_gui_workspace_rerun_patch,
    _propose_gui_workspace_rerun_path,
    _propose_gui_workspace_setup,
    _recommended_path,
    _rerun_resolver,
    _required_message,
    _rerun_workspace_recommendation,
    _validate_workspace_input_roots,
    _validated_path_recommendations,
    _workspace_creation_result,
    _workspace_inputs_payload,
    _workspace_rerun_execution_contract,
)


PROVIDER_ID = "ecos_agent"
_WorkspaceSetupParser = Callable[[dict[str, Any]], GuiWorkspaceSetupProposal | dict[str, Any]]
_WorkspacePathRecommender = Callable[[dict[str, Any]], GuiWorkspaceSetupProposal | dict[str, Any]]
_RerunParameterParser = Callable[[dict[str, Any]], GuiWorkspaceRerunParameterProposal | dict[str, Any]]
_RerunWorkspaceRecommender = Callable[[dict[str, Any]], GuiWorkspaceRerunPathProposal | dict[str, Any]]
_NUMERIC_FIELDS = {
    "Frequency Max (MHz)": "frequency_mhz",
    "Max Fanout": "max_fanout",
    "Die Area Utilization": "utilitization",
    "Placement Target Density": "target_density",
    "Placement Target Overflow": "target_overflow",
}


@dataclass
class _Session:
    session_id: str
    phase: str = "operation"
    language: str = "en"
    language_locked: bool = False
    design_id: str | None = None
    rerun_stage: str | None = None
    rerun_resolver: GuiWorkspaceRerunResolver | None = None
    rerun_search_root: Path | None = None
    rerun_discovery: GuiWorkspaceRerunDiscovery | None = None
    rerun_parameter_patch: list[dict[str, Any]] = field(default_factory=list)
    workspace_rerun_contract: GuiWorkspaceRerunContract | None = None
    workspace_setup: GuiWorkspaceSetupProposal = field(default_factory=recommended_workspace_setup)
    workspace_inputs: WorkspaceInputs = field(default_factory=WorkspaceInputs)
    path_recommendations: dict[str, str] = field(default_factory=dict)
    workspace_setup_id: str | None = None
    workspace_contract: dict[str, Any] | None = None


class EcosAgentProvider:
    """Own the GUI state machine; only frozen contracts can trigger execution."""

    def __init__(
        self,
        *,
        emit: Callable[[dict[str, Any]], None],
        workspace_setup_parser: _WorkspaceSetupParser | None = None,
        workspace_path_recommender: _WorkspacePathRecommender | None = None,
        rerun_parameter_parser: _RerunParameterParser | None = None,
        rerun_workspace_recommender: _RerunWorkspaceRecommender | None = None,
    ) -> None:
        self.emit = emit
        self.workspace_setup_parser = workspace_setup_parser or _propose_gui_workspace_setup
        self.workspace_path_recommender = workspace_path_recommender or _propose_gui_workspace_path_discovery
        self.rerun_parameter_parser = rerun_parameter_parser or _propose_gui_workspace_rerun_patch
        self.rerun_workspace_recommender = rerun_workspace_recommender or _propose_gui_workspace_rerun_path
        self.sessions: dict[str, _Session] = {}
        self.stopped = False

    def start(self, _request: Mapping[str, Any] | None = None) -> None:
        self.stopped = False

    def start_session(self, request: Mapping[str, Any]) -> dict[str, str]:
        session_id = _optional_text(request.get("sessionId")) or uuid.uuid4().hex
        session = self.sessions.setdefault(session_id, _Session(session_id=session_id))
        session.rerun_search_root = _rerun_search_root(request.get("directory"))
        self._emit_status(session, "ready")
        self._emit(session, "message", welcome_message())
        return {"sessionId": session_id}

    def send_message(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        message = _required_message(request.get("message"))
        if not session.language_locked:
            session.language = language_for_text(message)
            session.language_locked = True
        self._handle_input(session, message)
        return {"messageId": uuid.uuid4().hex, "sessionId": session.session_id}

    def interrupt(self, request: Mapping[str, Any] | None = None) -> None:
        session = self._session(request or {})
        self._emit(
            session,
            "error",
            "ECOS Agent does not expose direct process interruption through the GUI provider.",
        )

    def get_status(self, request: Mapping[str, Any] | None = None) -> dict[str, str]:
        session_id = _optional_text((request or {}).get("sessionId"))
        return {
            "activeSessionId": session_id or next(iter(self.sessions), ""),
            "providerId": PROVIDER_ID,
            "state": "stopped" if self.stopped else "ready",
        }

    def set_mode(self, request: Mapping[str, Any]) -> dict[str, str]:
        return self.get_status(request)

    def list_sessions(self, _request: Mapping[str, Any] | None = None) -> dict[str, list[dict[str, str]]]:
        return {
            "sessions": [
                {"sessionId": session.session_id, "title": "ECOS Agent"}
                for session in self.sessions.values()
            ]
        }

    def resume_session(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        self._emit_status(session, "ready")
        self._emit(session, "message", _prompt_for_phase(session))
        return {"sessionId": session.session_id}

    def stop(self, _request: Mapping[str, Any] | None = None) -> None:
        self.stopped = True

    def _handle_input(self, session: _Session, message: str) -> None:
        handlers = {
            "operation": self._select_operation,
            "rerun_design": self._select_rerun_design,
            "rerun_stage": self._select_rerun_stage,
            "rerun_parameter": self._select_rerun_parameter,
            "rerun_scope": self._select_rerun_scope,
            "workspace_project_root": self._select_project_root,
            "workspace_flow_end": self._select_flow_end,
            "workspace_rtl": self._select_rtl,
            "workspace_filelist": self._select_filelist,
            "workspace_sdc": self._select_sdc,
            "workspace_pdk": self._select_pdk,
            "workspace_design": self._select_design_name,
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
            "confirmation": self._confirm_rerun_execution,
        }
        handler = handlers.get(session.phase)
        if handler is None:
            self._emit(session, "error", "The current ECOS Agent session is not actionable.")
            return
        handler(session, message)

    def _select_operation(self, session: _Session, message: str) -> None:
        choice = _operation_choice(message)
        if choice == "1":
            self._reset_workspace_setup(session)
            session.phase = "workspace_project_root"
            self._emit(session, "message", project_root_prompt(session.language))
            return
        if choice == "2":
            session.phase = "rerun_design"
            self._emit(session, "message", rerun_design_prompt(session.language))
            return
        self._emit(session, "message", invalid_choice(session.language))
        self._emit(session, "message", operation_prompt(session.language))

    def _select_project_root(self, session: _Session, message: str) -> None:
        try:
            root = normalize_path(message, label="Project Root", require_directory=True)
            session.workspace_inputs.project_root = root
            session.workspace_inputs.project_name = derive_project_name(root)
        except ValueError as exc:
            self._repeat_invalid(session, "Project Root", str(exc), project_root_prompt)
            return
        self._update_workspace_setup(session, workspace_name=session.workspace_inputs.project_name)
        pdk_paths = discover_ecos_pdk_paths(root)
        session.path_recommendations = {"pdk": pdk_paths[0]} if pdk_paths else {}
        session.phase = "workspace_flow_end"
        self._emit(session, "message", flow_end_prompt(session.language))

    def _select_flow_end(self, session: _Session, message: str) -> None:
        if message == "0":
            end_step = "Harden"
        else:
            end_step = numbered_choice(message, tuple(_flow_steps()))
        if end_step is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(session, "message", flow_end_prompt(session.language))
            return
        self._update_workspace_setup(session, flow_start="Synthesis", flow_end=end_step)
        session.phase = "workspace_design"
        self._emit(session, "message", design_name_prompt(session.language))

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

    def _select_filelist(self, session: _Session, message: str) -> None:
        try:
            session.workspace_inputs.filelist_path = optional_path(
                message, label="Filelist path", suffixes=(".f",)
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

    def _select_sdc(self, session: _Session, message: str) -> None:
        try:
            session.workspace_inputs.sdc_path = optional_path(
                message, label="SDC path", suffixes=(".sdc",)
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

    def _select_pdk(self, session: _Session, message: str) -> None:
        try:
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
        session.phase = "workspace_top"
        self._emit(
            session,
            "message",
            default_value_prompt(session.language, "Top Module Name", session.workspace_setup.top_module),
        )

    def _select_design_name(self, session: _Session, message: str) -> None:
        try:
            design = normalize_identifier(message, label="Design Name")
        except ValueError as exc:
            self._repeat_invalid(session, "Design Name", str(exc), design_name_prompt)
            return
        self._update_workspace_setup(session, design_name=design)
        self._discover_design_paths(session)
        session.phase = "workspace_rtl"
        self._emit(session, "message", rtl_prompt(session.language, _recommended_path(session, "rtl")))

    def _select_top_module(self, session: _Session, message: str) -> None:
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

    def _select_clock(self, session: _Session, message: str) -> None:
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

    def _select_overflow(self, session: _Session, message: str) -> None:
        value = self._number_or_repeat(session, message, "Placement Target Overflow", 0, 1)
        if value is None:
            return
        self._update_workspace_setup(session, target_overflow=value)
        self._show_workspace_contract(session)

    def _select_rerun_design(self, session: _Session, message: str) -> None:
        design = message.strip()
        root = session.rerun_search_root
        if root is None:
            self._emit(session, "error", "Open an ECOS workspace before choosing a rerun design.")
            self._emit(session, "message", rerun_design_prompt(session.language))
            return
        try:
            proposal = GuiWorkspaceRerunPathProposal.model_validate(
                self.rerun_workspace_recommender(
                    {
                        "schema_version": "flow-agent.gui_workspace_rerun_path_context.v1",
                        "design_name": design,
                        "filesystem_roots": [str(root)],
                        "_progress_callback": lambda text: self._emit(session, "tool", text),
                    }
                )
            )
            if proposal.source_workspace is None:
                raise ValueError("Codex did not recommend a source workspace")
            source = Path(proposal.source_workspace).expanduser().resolve()
            if not source.is_relative_to(root):
                raise ValueError("recommended workspace is outside the authorized search root")
            resolver = GuiWorkspaceRerunResolver(root)
            discovery = resolver.discover_workspace(source, design)
        except CodexProviderError as exc:
            self._emit(session, "error", f"Unable to recommend a rerun workspace: {exc}")
            self._emit(session, "message", rerun_design_prompt(session.language))
            return
        except ValueError:
            self._reset(session)
            self._emit(session, "error", no_source_run_message(session.language))
            return
        session.rerun_resolver = resolver
        session.design_id = design
        session.rerun_discovery = discovery
        session.phase = "rerun_stage"
        self._emit(
            session,
            "message",
            _rerun_workspace_recommendation(session.language),
        )
        self._emit(session, "message", rerun_stage_prompt(session.language, discovery.allowed_stages))

    def _select_rerun_stage(self, session: _Session, message: str) -> None:
        resolver = _rerun_resolver(session)
        discovery = session.rerun_discovery
        stage = None if discovery is None else numbered_choice(message, discovery.allowed_stages)
        if stage is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(
                session,
                "message",
                rerun_stage_prompt(session.language, () if discovery is None else discovery.allowed_stages),
            )
            return
        session.rerun_stage = stage
        session.phase = "rerun_parameter"
        self._emit(
            session,
            "message",
            rerun_parameter_prompt(
                session.language,
                resolver.parameter_values(discovery.source, stage),
            ),
        )

    def _select_rerun_parameter(self, session: _Session, message: str) -> None:
        resolver = _rerun_resolver(session)
        discovery = session.rerun_discovery
        stage = session.rerun_stage
        if discovery is None or stage is None:
            self._reset(session)
            self._emit(session, "error", "The workspace rerun state is invalid.")
            return
        if not message:
            session.rerun_parameter_patch = []
        else:
            try:
                parameter_values = resolver.parameter_values(
                    discovery.source, stage
                )
                if not parameter_values:
                    raise ValueError("No config-backed parameters are available for this rerun stage")
                proposal = GuiWorkspaceRerunParameterProposal.model_validate(
                    self.rerun_parameter_parser(
                        {
                            "schema_version": "flow-agent.gui_workspace_rerun_parameter_context.v1",
                            "natural_language_request": message,
                            "target_step": stage,
                            "allowed_knobs": [knob_id for knob_id, _ in parameter_values],
                            "workspace": str(discovery.source.workspace_path),
                            "_progress_callback": lambda text: self._emit(session, "tool", text),
                        }
                    )
                )
                resolver._validate_patch(
                    stage, [item.model_dump(mode="json") for item in proposal.parameter_patch]
                )
            except (CodexProviderError, ValueError) as exc:
                self._emit(session, "error", f"Unable to validate the rerun parameter change: {exc}")
                self._emit(
                    session,
                    "message",
                    rerun_parameter_prompt(
                        session.language,
                        resolver.parameter_values(discovery.source, stage),
                    ),
                )
                return
            session.rerun_parameter_patch = [item.model_dump(mode="json") for item in proposal.parameter_patch]
        session.phase = "rerun_scope"
        self._emit(session, "message", rerun_scope_prompt(session.language))

    def _select_rerun_scope(self, session: _Session, message: str) -> None:
        resolver = _rerun_resolver(session)
        scope = numbered_choice(message, ("single_step", "full_flow"))
        if scope is None or session.rerun_discovery is None or session.rerun_stage is None:
            self._emit(session, "message", invalid_choice(session.language))
            self._emit(session, "message", rerun_scope_prompt(session.language))
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
            contract_ready_message(session.language),
            _workspace_rerun_execution_contract(
                session.workspace_rerun_contract, session.language, parameter_values
            ),
        )
        self._emit(session, "message", confirmation_menu(session.language))

    def _show_workspace_contract(self, session: _Session) -> None:
        session.workspace_setup_id = session.workspace_setup_id or uuid.uuid4().hex
        try:
            contract = workspace_setup_contract(
                session.workspace_setup,
                session.workspace_inputs,
                session.language,
                session.workspace_setup_id,
            )
        except ValueError as exc:
            self._emit(session, "message", invalid_value(session.language, "Workspace specification", str(exc)))
            session.phase = "workspace_top" if "Top Module" in str(exc) else "workspace_project_root"
            self._emit(
                session,
                "message",
                default_value_prompt(session.language, "Top Module Name", session.workspace_setup.top_module)
                if session.phase == "workspace_top"
                else project_root_prompt(session.language),
            )
            return
        session.phase = "workspace_confirmation"
        session.workspace_contract = contract
        self._emit(
            session,
            "workspace_setup",
            workspace_confirmation_prompt(session.language),
            workspace_setup=contract,
        )

    def _confirm_workspace_execution(self, session: _Session, message: str) -> None:
        _confirm_workspace_execution(self, session, message)

    def _handle_workspace_creation_result(self, session: _Session, message: str) -> None:
        result = _workspace_creation_result(message)
        if result is None or result[0] != session.workspace_setup_id:
            self._emit(session, "error", "Workspace creation result is invalid.")
            return
        _, status, error = result
        if status == "succeeded":
            self._reset(session)
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

    def _confirm_rerun_execution(self, session: _Session, message: str) -> None:
        if message == "2":
            self._reset(session)
            self._emit(session, "message", cancellation_message(session.language))
            return
        if message != "1":
            self._emit(session, "message", confirmation_menu(session.language))
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
        _handle_workspace_rerun_result(self, session, message)

    def _number_or_repeat(
        self, session: _Session, message: str, label: str, lower: float, upper: float
    ) -> float | None:
        current = _number_default(session.workspace_setup, label)
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
                        "_progress_callback": lambda text: self._emit(session, "tool", text),
                    }
                )
            )
            value = getattr(proposal, field)
            if value is None:
                raise ValueError("Codex did not provide a value for this field")
            return parse_number(str(value), label=label, lower=lower, upper=upper, default=current)
        except (CodexProviderError, ValueError):
            self._emit(
                session,
                "message",
                invalid_value(session.language, label, "Unable to interpret a valid in-range value"),
            )
            self._emit(session, "message", number_prompt(session.language, label, current, lower, upper))
            return None

    def _repeat_setup_default(self, session: _Session, label: str, error: str) -> None:
        self._emit(session, "message", invalid_value(session.language, label, error))
        values = {
            "Design Name": session.workspace_setup.design_name,
            "Top Module Name": session.workspace_setup.top_module,
            "Clock Signal Name": session.workspace_setup.clock_name,
        }
        self._emit(session, "message", default_value_prompt(session.language, label, values[label]))

    def _repeat_invalid(self, session: _Session, label: str, error: str, prompt) -> None:
        self._emit(session, "message", invalid_value(session.language, label, error))
        self._emit(session, "message", prompt(session.language))

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
        try:
            proposal = GuiWorkspaceSetupProposal.model_validate(
                self.workspace_path_recommender(
                    {
                        "schema_version": "flow-agent.gui_workspace_path_discovery.v1",
                        "design_name": session.workspace_setup.design_name,
                        "project_root": session.workspace_inputs.project_root,
                        "filesystem_roots": list(roots),
                        "discovered_candidates": candidates,
                        "_progress_callback": lambda text: self._emit(session, "tool", text),
                    }
                )
            )
            session.path_recommendations.update(_validated_path_recommendations(proposal, roots))
        except (CodexProviderError, ValueError) as exc:
            session.path_recommendations = {
                field: path for field, path in session.path_recommendations.items() if field == "pdk"
            }
            self._emit(session, "error", f"Unable to discover local design files: {exc}")

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
        workspace_setup: dict[str, Any] | None = None,
        workspace_create_setup_id: str | None = None,
        workspace_rerun: dict[str, Any] | None = None,
    ) -> None:
        event: dict[str, Any] = {
            "providerId": PROVIDER_ID,
            "sessionId": session.session_id,
            "text": text,
            "type": event_type,
        }
        if contract is not None:
            event["contract"] = contract
        if workspace_setup is not None:
            event["workspaceSetup"] = workspace_setup
        if workspace_create_setup_id is not None:
            event["workspaceCreateSetupId"] = workspace_create_setup_id
        if workspace_rerun is not None:
            event["workspaceRerun"] = workspace_rerun
        self.emit(event)

    def _emit_status(self, session: _Session, state: str) -> None:
        self.emit({"providerId": PROVIDER_ID, "sessionId": session.session_id, "text": state, "type": "status"})

    @staticmethod
    def _reset(session: _Session) -> None:
        language = session.language
        language_locked = session.language_locked
        session.phase = "operation"
        session.language = language
        session.language_locked = language_locked
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
        session.workspace_contract = None


def _rerun_search_root(value: object) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    directory = Path(value).expanduser().resolve()
    if not directory.is_dir():
        return None
    return directory.parent if (directory / "home" / "flow.json").is_file() else directory


def main() -> int:
    from ecos_agent.protocol import EcosAgentProtocolServer

    return EcosAgentProtocolServer().serve()


if __name__ == "__main__":
    raise SystemExit(main())
