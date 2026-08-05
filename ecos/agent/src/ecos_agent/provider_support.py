"""Validation and proposal helpers for the ECOS Agent state machine."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.codex_provider import CodexProviderError, create_required_codex_provider
from ecos_agent.contracts import GUI_WORKSPACE_FLOW_STEPS, GuiWorkspaceSetupProposal
from ecos_agent.messages import (
    cancellation_message,
    confirmation_menu,
    default_value_prompt,
    design_name_prompt,
    flow_end_prompt,
    number_prompt,
    operation_prompt,
    optional_file_prompt,
    pdk_prompt,
    project_mode_prompt,
    project_root_prompt,
    rerun_design_prompt,
    rerun_parameter_prompt,
    rerun_scope_prompt,
    rerun_stage_prompt,
    rerun_workspace_prompt,
    rtl_prompt,
    source_run_prompt,
    workspace_confirmation_prompt,
    workspace_execution_started,
    workspace_name_prompt,
)
from ecos_agent.workspace_rerun import (
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunParameterProposal,
    GuiWorkspaceRerunResolver,
)
from ecos_agent.workspace_setup import (
    WorkspaceInputs,
    display_path,
    normalize_path,
    workspace_search_roots,
    workspace_setup_contract,
)


_EXPLICIT_PATH_TOKEN = re.compile(r"(?<!\S)(?:~|/|\.?\.?/)\S+")
_WORKSPACE_CREATE_RESULT_PREFIX = "workspace_create_result:"
_WORKSPACE_RERUN_RESULT_PREFIX = "workspace_rerun_result:"


def _confirm_workspace_execution(provider: Any, session: Any, message: str) -> None:
    if message == "1":
        setup_id = session.workspace_setup_id
        if setup_id is None:
            provider._emit(session, "error", "Workspace setup session is invalid.")
            return
        provider._emit(
            session,
            "workspace_create",
            workspace_execution_started(session.language),
            workspace_create_setup_id=setup_id,
        )
        session.phase = "workspace_creation_pending"
        return
    if message == "2":
        provider._reset(session)
        provider._emit(session, "message", cancellation_message(session.language))
        provider._emit_phase_choice(session)
        return
    try:
        proposed = GuiWorkspaceSetupProposal.model_validate(
            provider.workspace_setup_parser(
                {
                    "schema_version": "flow-agent.gui_workspace_setup_context.v2",
                    "natural_language_choice": message,
                    "stage": "spec",
                    "recommended_defaults": session.workspace_setup.model_dump(mode="json"),
                    "workspace_inputs": _workspace_inputs_payload(session.workspace_inputs),
                    "filesystem_roots": list(workspace_search_roots(session.workspace_inputs.project_root)),
                    "_progress_callback": lambda text: provider._progress(session, text),
                    "_register_interrupt": lambda callback: provider._register_interrupt(session, callback),
                }
            )
        )
        provider._check_interrupted(session)
        corrected_setup, corrected_inputs = provider._corrected_workspace_state(session, proposed, message)
        workspace_setup_contract(
            corrected_setup,
            corrected_inputs,
            session.language,
            session.workspace_setup_id or "pending",
        )
    except (CodexProviderError, ValueError) as exc:
        provider._check_interrupted(session)
        provider._raise_if_interrupted(exc)
        provider._emit(session, "error", f"Unable to correct the workspace specification: {exc}")
        provider._emit(session, "message", workspace_confirmation_prompt(session.language))
        provider._emit_phase_choice(session)
        return
    session.workspace_setup = corrected_setup
    session.workspace_inputs = corrected_inputs
    provider._show_workspace_contract(session)


def _handle_workspace_rerun_result(provider: Any, session: Any, message: str) -> None:
    result = _workspace_rerun_result(message)
    contract = session.workspace_rerun_contract
    if result is None:
        provider._emit(session, "error", "Workspace rerun result is malformed.")
        return
    if contract is None:
        provider._emit(session, "error", "Workspace rerun contract is missing.")
        return
    if result[0] != contract.rerun_id:
        provider._emit(session, "error", "Workspace rerun result does not match the pending contract.")
        return
    _, status, error = result
    if status == "succeeded":
        provider._emit(session, "message", _rerun_completion_message(session.language))
        provider._reset(session)
        return
    provider._emit(session, "error", f"Workspace rerun failed: {error}")
    provider._emit(session, "message", confirmation_menu(session.language))
    session.phase = "confirmation"
    provider._emit_phase_choice(session)


def _rerun_resolver(session: Any) -> GuiWorkspaceRerunResolver:
    if session.rerun_resolver is None:
        raise ValueError("Rerun workspace recommendation is missing")
    return session.rerun_resolver


def _propose_gui_workspace_setup(context: dict[str, Any]) -> GuiWorkspaceSetupProposal:
    progress_callback, register_interrupt, request_context = _gui_workspace_request_context(context)
    provider = _gui_workspace_codex_provider(request_context, progress_callback)
    register_interrupt(provider.interrupt)
    try:
        return GuiWorkspaceSetupProposal.model_validate(provider.propose_gui_workspace_setup(request_context))
    finally:
        register_interrupt(None)
        provider.close()


def _propose_gui_workspace_path_discovery(context: dict[str, Any]) -> GuiWorkspaceSetupProposal:
    progress_callback, register_interrupt, request_context = _gui_workspace_request_context(context)
    provider = _gui_workspace_codex_provider(request_context, progress_callback)
    register_interrupt(provider.interrupt)
    try:
        return GuiWorkspaceSetupProposal.model_validate(provider.propose_gui_workspace_path_discovery(request_context))
    finally:
        register_interrupt(None)
        provider.close()


def _propose_gui_workspace_rerun_patch(
    context: dict[str, Any],
) -> GuiWorkspaceRerunParameterProposal:
    progress_callback, register_interrupt, request_context = _gui_workspace_request_context(context)
    workspace = request_context.get("workspace")
    if not isinstance(workspace, str) or not workspace:
        raise CodexProviderError("GUI rerun workspace is missing", failure_class="missing_input")
    source = Path(workspace).resolve()
    if not source.is_dir():
        raise CodexProviderError("GUI rerun workspace is unavailable", failure_class="missing_input")
    provider = create_required_codex_provider(
        cwd=source,
        runtime_workspace_roots=(source,),
        progress_callback=progress_callback,
    )
    register_interrupt(provider.interrupt)
    try:
        return GuiWorkspaceRerunParameterProposal.model_validate(
            provider.propose_gui_workspace_rerun_patch(request_context)
        )
    finally:
        register_interrupt(None)
        provider.close()


def _gui_workspace_request_context(
    context: Mapping[str, Any],
) -> tuple[Callable[[str], None] | None, Callable[[Callable[[], None] | None], None], dict[str, Any]]:
    callback = context.get("_progress_callback")
    register_interrupt = context.get("_register_interrupt")
    return (
        callback if callable(callback) else None,
        register_interrupt if callable(register_interrupt) else lambda _callback: None,
        {key: value for key, value in context.items() if not key.startswith("_")},
    )


def _gui_workspace_codex_provider(
    context: Mapping[str, Any], progress_callback: Callable[[str], None] | None
):
    workspace_inputs = context.get("workspace_inputs")
    project_root = (
        workspace_inputs.get("project_root")
        if isinstance(workspace_inputs, Mapping)
        else context.get("project_root")
    )
    if not isinstance(project_root, str):
        raise CodexProviderError("GUI workspace filesystem roots are missing", failure_class="missing_input")
    roots = workspace_search_roots(project_root)
    return create_required_codex_provider(
        cwd=Path(roots[0]), runtime_workspace_roots=roots, progress_callback=progress_callback
    )


def _workspace_inputs_payload(inputs: WorkspaceInputs) -> dict[str, str]:
    return {
        "project_root": inputs.project_root,
        "rtl_path": inputs.rtl_path,
        "filelist_path": inputs.filelist_path,
        "sdc_path": inputs.sdc_path,
        "pdk_root": inputs.pdk_root,
    }


def _validated_path_recommendations(
    proposal: GuiWorkspaceSetupProposal, roots: tuple[str, ...]
) -> dict[str, str]:
    recommendations = {
        "rtl": _validated_recommendation(proposal.rtl_path, "RTL path", (".v", ".sv"), roots),
        "filelist": _validated_recommendation(proposal.filelist_path, "Filelist path", (".f",), roots),
        "sdc": _validated_recommendation(proposal.sdc_path, "SDC path", (".sdc",), roots),
    }
    return {field: path for field, path in recommendations.items() if path is not None}


def _validated_recommendation(
    value: str | None, label: str, suffixes: tuple[str, ...], roots: tuple[str, ...]
) -> str | None:
    if value is None:
        return None
    path = normalize_path(value, label=label, suffixes=suffixes, require_file=True)
    resolved = Path(path)
    if not any(resolved.is_relative_to(Path(root)) for root in roots):
        raise ValueError(f"{label} recommendation is outside the authorized filesystem roots")
    return path


def _validate_workspace_input_roots(
    proposal: GuiWorkspaceSetupProposal, inputs: WorkspaceInputs, roots: tuple[str, ...], message: str
) -> None:
    path_updates = {
        "project_root": inputs.project_root,
        "rtl_path": inputs.rtl_path,
        "filelist_path": inputs.filelist_path,
        "sdc_path": inputs.sdc_path,
        "pdk_root": inputs.pdk_root,
    }
    for field, path in path_updates.items():
        if getattr(proposal, field) is not None and not any(
            Path(path).is_relative_to(Path(root)) for root in roots
        ) and not _path_was_explicitly_provided(message, path):
            raise ValueError(f"{field} is outside the authorized filesystem roots")


def _path_was_explicitly_provided(message: str, path: str) -> bool:
    expected = Path(path).expanduser().resolve()
    for raw_path in _EXPLICIT_PATH_TOKEN.findall(message):
        if expected == Path(raw_path.rstrip(".,;:!?)]}")).expanduser().resolve():
            return True
    return False


def _workspace_rerun_execution_contract(
    contract: GuiWorkspaceRerunContract,
    language: str,
    parameter_values: tuple[tuple[str, object], ...],
) -> dict[str, Any]:
    effective_values = dict(parameter_values)
    effective_values.update({item.knob_id: item.value for item in contract.parameter_patch})
    parameter_fields = [
        {"label": knob_id, "value": str(value)}
        for knob_id, value in sorted(effective_values.items())
    ]
    if not parameter_fields:
        parameter_fields = [
            {
                "label": "Parameters" if language == "en" else "参数",
                "value": "none" if language == "en" else "无",
            }
        ]
    if language == "zh":
        scope = (
            "隔离 workspace 中该阶段后停止"
            if contract.execution_scope == "single_step"
            else "隔离 workspace 中执行至 flow 结束"
        )
        fields = [
            {"label": "Design", "value": contract.design_id},
            {"label": "源 workspace", "value": contract.source_workspace},
            {"label": "目标 workspace", "value": contract.target_workspace},
            {"label": "重跑阶段", "value": contract.target_step.value},
            {"label": "终止阶段", "value": contract.end_step.value},
            {"label": "执行范围", "value": scope},
            *parameter_fields,
            {"label": "确认", "value": "required"},
        ]
        title = "冻结的重跑执行合同"
    else:
        scope = (
            "stop after this stage in an isolated workspace"
            if contract.execution_scope == "single_step"
            else "continue to the end of the flow in an isolated workspace"
        )
        fields = [
            {"label": "Design", "value": contract.design_id},
            {"label": "Source workspace", "value": contract.source_workspace},
            {"label": "Target workspace", "value": contract.target_workspace},
            {"label": "Rerun stage", "value": contract.target_step.value},
            {"label": "End stage", "value": contract.end_step.value},
            {"label": "Execution scope", "value": scope},
            *parameter_fields,
            {"label": "Confirmation", "value": "required"},
        ]
        title = "Frozen workspace rerun contract"
    return {
        "presentation": "workspace_rerun",
        "schema_version": "flow-agent.resolved_execution_contract.v1",
        "title": title,
        "fields": fields,
    }


def _rerun_completion_message(language: str) -> str:
    if language == "zh":
        return "GUI 已切换到重跑 workspace。"
    return "The GUI switched to the rerun workspace."


def _prompt_for_phase(session: _Session) -> str:
    prompts = {
        "operation": operation_prompt(session.language),
        "rerun_design": rerun_design_prompt(session.language),
        "rerun_source_run": source_run_prompt(
            session.language,
            (session.rerun_workspace_path,) if session.rerun_workspace_path else (),
        ),
        "rerun_workspace": rerun_workspace_prompt(
            session.language, session.rerun_workspace_path
        ),
        "rerun_stage": rerun_stage_prompt(
            session.language,
            () if session.rerun_discovery is None else session.rerun_discovery.allowed_stages,
        ),
        "rerun_parameter": rerun_parameter_prompt(
            session.language,
            (),
        ),
        "rerun_scope": rerun_scope_prompt(session.language),
        "workspace_project_mode": project_mode_prompt(session.language),
        "workspace_project_root": project_root_prompt(
            session.language, creating=session.creating_project
        ),
        "workspace_name": workspace_name_prompt(session.language),
        "workspace_design": design_name_prompt(
            session.language,
            session.inherited_design_name or session.workspace_inputs.project_name or "",
        ),
        "workspace_flow_end": flow_end_prompt(session.language),
        "workspace_rtl": rtl_prompt(session.language, _recommended_path(session, "rtl")),
        "workspace_filelist": optional_file_prompt(
            session.language, "filelist", ".f", _recommended_path(session, "filelist")
        ),
        "workspace_sdc": optional_file_prompt(
            session.language, "SDC", ".sdc", _recommended_path(session, "sdc")
        ),
        "workspace_pdk": pdk_prompt(session.language, _recommended_path(session, "pdk")),
        "workspace_top": default_value_prompt(session.language, "Top Module Name", session.workspace_setup.top_module),
        "workspace_clock": default_value_prompt(session.language, "Clock Signal Name", session.workspace_setup.clock_name),
        "workspace_frequency": number_prompt(session.language, "Frequency Max (MHz)", session.workspace_setup.frequency_mhz, 1, 10_000),
        "workspace_max_fanout": number_prompt(session.language, "Max Fanout", session.workspace_setup.max_fanout, 1, 1_000_000),
        "workspace_utilization": number_prompt(session.language, "Die Area Utilization", session.workspace_setup.utilitization, 0.01, 1),
        "workspace_density": number_prompt(session.language, "Placement Target Density", session.workspace_setup.target_density, 0.01, 1),
        "workspace_overflow": number_prompt(session.language, "Placement Target Overflow", session.workspace_setup.target_overflow, 0, 1),
        "workspace_confirmation": workspace_confirmation_prompt(session.language),
        "confirmation": confirmation_menu(session.language),
    }
    return prompts.get(session.phase, operation_prompt(session.language))


def _number_default(proposal: GuiWorkspaceSetupProposal, label: str) -> float:
    values = {
        "Frequency Max (MHz)": proposal.frequency_mhz,
        "Max Fanout": proposal.max_fanout,
        "Die Area Utilization": proposal.utilitization,
        "Placement Target Density": proposal.target_density,
        "Placement Target Overflow": proposal.target_overflow,
    }
    value = values[label]
    if value is None:
        raise ValueError(f"{label} has no default")
    return value


def _recommended_path(session: _Session, field: str) -> str:
    recommendation = session.path_recommendations.get(field, "")
    return display_path(recommendation) if recommendation else ""


def _flow_steps() -> list[str]:
    return list(GUI_WORKSPACE_FLOW_STEPS)


def _operation_choice(message: str) -> str | None:
    match = re.search(r"(?<![0-9])([1234])(?![0-9])", message)
    return match.group(1) if match else None


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _workspace_creation_result(message: str) -> tuple[str, str, str] | None:
    if not message.startswith(_WORKSPACE_CREATE_RESULT_PREFIX):
        return None
    try:
        payload = json.loads(message.removeprefix(_WORKSPACE_CREATE_RESULT_PREFIX))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or set(payload) != {"setup_id", "status", "error"}:
        return None
    setup_id = payload.get("setup_id")
    status = payload.get("status")
    error = payload.get("error")
    if (
        not isinstance(setup_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", setup_id)
        or status not in {"succeeded", "failed"}
        or not isinstance(error, str)
    ):
        return None
    normalized_error = re.sub(r"[\x00-\x1f\x7f]+", " ", error).strip()[:512]
    if status == "failed" and not normalized_error:
        return None
    return setup_id, status, normalized_error


def _workspace_rerun_result(message: str) -> tuple[str, str, str] | None:
    if not message.startswith(_WORKSPACE_RERUN_RESULT_PREFIX):
        return None
    try:
        payload = json.loads(message.removeprefix(_WORKSPACE_RERUN_RESULT_PREFIX))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or set(payload) != {"rerun_id", "status", "error"}:
        return None
    rerun_id, status, error = payload.get("rerun_id"), payload.get("status"), payload.get("error")
    if (
        not isinstance(rerun_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", rerun_id)
        or status not in {"succeeded", "failed"}
        or not isinstance(error, str)
    ):
        return None
    normalized_error = re.sub(r"[\x00-\x1f\x7f]+", " ", error).strip()[:512]
    if status == "failed" and not normalized_error:
        return None
    return rerun_id, status, normalized_error


def _required_message(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Agent message must be a string.")
    if len(value) > 4096:
        raise ValueError("Agent message exceeds 4096 characters.")
    return value.strip()
