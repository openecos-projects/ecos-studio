"""Validation and proposal helpers for the ECOS Agent state machine."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from ecos_agent.codex_provider import CodexProviderError, create_required_codex_provider
from ecos_agent.contracts import (
    GUI_WORKSPACE_FLOW_STEPS,
    GuiChatResponseProposal,
    GuiWorkspaceSetupProposal,
)
from ecos_agent.messages import (
    cancellation_message,
    confirmation_menu,
    default_value_prompt,
    design_name_prompt,
    flow_end_prompt,
    home_ready_prompt,
    number_prompt,
    operation_choice,
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
    workspace_parameter_request_prompt,
)
from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.knob_registry import KNOB_SPECS
from ecos_agent.workspace_rerun import (
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunParameterProposal,
    GuiWorkspaceRerunResolver,
    catalog_end_step,
)
from ecos_agent.workspace_setup import (
    WorkspaceInputs,
    display_path,
    normalize_path,
    recommended_workspace_name,
    workspace_search_roots,
    workspace_setup_contract,
)


# Allow paths after whitespace or common separators such as ':' / fullwidth '：'.
_EXPLICIT_PATH_TOKEN = re.compile(r"(?:(?<!\S)|(?<=[:：=]))(?:~|/|\.?\.?/)\S+")
_NUMBER_TOKEN = re.compile(r"(?<![0-9.])(\d+(?:\.\d+)?)(?![0-9.])")
_WORKSPACE_NAME_TOKEN = re.compile(r"\b(ws_\d{1,8})\b", re.IGNORECASE)
_SPEC_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_WORKSPACE_CREATE_RESULT_PREFIX = "workspace_create_result:"
_WORKSPACE_RERUN_RESULT_PREFIX = "workspace_rerun_result:"
_PATH_FIELD_HINTS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("pdk", "工艺库", "工艺"), "pdk_root", "directory"),
    (("project root", "project_root", "项目根", "project"), "project_root", "directory"),
    (("rtl", "verilog", ".v", "网表"), "rtl_path", "rtl"),
    (("filelist", "文件列表", ".f"), "filelist_path", "filelist"),
    (("sdc", "约束"), "sdc_path", "sdc"),
)
_NUMBER_FIELD_HINTS: tuple[tuple[tuple[str, ...], str, float, float], ...] = (
    (("frequency", "频率", "mhz"), "frequency_mhz", 1.0, 10_000.0),
    (("fanout", "扇出"), "max_fanout", 1.0, 1_000_000.0),
    (("utilization", "utilitization", "利用率"), "utilitization", 0.01, 1.0),
    (("density", "密度"), "target_density", 0.01, 1.0),
    (("overflow", "溢出"), "target_overflow", 0.0, 1.0),
    (("margin", "边距"), "margin", 0.0, 1_000_000.0),
)
_TEXT_FIELD_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("workspace name", "workspace_name", "工作区名", "workspace"), "workspace_name"),
    (("design name", "design_name", "设计名", "design"), "design_name"),
    (("top module", "top_module", "顶层", "top"), "top_module"),
    (("clock", "时钟"), "clock_name"),
)


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
        proposed = _deterministic_spec_correction(message)
        if proposed is None:
            proposed = GuiWorkspaceSetupProposal.model_validate(
                provider.workspace_setup_parser(
                    {
                        "schema_version": "flow-agent.gui_workspace_setup_context.v2",
                        "natural_language_choice": message,
                        "stage": "spec",
                        "recommended_defaults": session.workspace_setup.model_dump(mode="json"),
                        "workspace_inputs": _workspace_inputs_payload(session.workspace_inputs),
                        "filesystem_roots": list(
                            workspace_search_roots(session.workspace_inputs.project_root)
                        ),
                        "explicit_paths": _explicit_path_tokens(message),
                        "_progress_callback": lambda text: provider._progress(session, text),
                        "_register_interrupt": lambda callback: provider._register_interrupt(
                            session, callback
                        ),
                    }
                )
            )
            provider._check_interrupted(session)
        corrected_setup, corrected_inputs = provider._corrected_workspace_state(
            session, proposed, message
        )
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
        provider._emit_phase_choice(session)
        return
    provider._emit(session, "error", f"Workspace rerun failed: {error}")
    provider._emit(session, "message", confirmation_menu(session.language))
    session.phase = "confirmation"
    provider._emit_phase_choice(session)


def _rerun_resolver(session: Any) -> GuiWorkspaceRerunResolver:
    if session.rerun_resolver is None:
        raise ValueError("Rerun workspace recommendation is missing")
    return session.rerun_resolver


def _tunable_workspace_parameters(workspace_path: Path) -> tuple[tuple[str, object], ...]:
    """Every readable knob in the workspace.

    Rerun needs completed-stage evidence; changing a parameter does not, so this
    spans all steps rather than only the ones that have already run.
    """
    merged: dict[str, object] = {}
    for step in ECCStepName:
        try:
            values = GuiWorkspaceRerunResolver.stage_parameter_values(workspace_path, step.value)
        except ValueError:
            continue
        for knob_id, value in values:
            merged.setdefault(knob_id, value)
    return tuple(merged.items())


def _validate_workspace_parameter_patch(
    patch: list[dict[str, object]],
    available: Mapping[str, object],
) -> None:
    if not patch:
        raise ValueError(
            "no parameter changes were proposed; describe a concrete knob change such as lower target density"
        )
    by_step: dict[str, list[dict[str, object]]] = {}
    for item in patch:
        knob_id = str(item.get("knob_id", ""))
        if knob_id not in available or knob_id not in KNOB_SPECS:
            raise ValueError(f"parameter {knob_id} is not available in this workspace")
        by_step.setdefault(KNOB_SPECS[knob_id].step.value, []).append(item)
    for step, items in by_step.items():
        GuiWorkspaceRerunResolver._validate_patch(step, items)


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


def _explicit_path_tokens(message: str) -> list[str]:
    tokens: list[str] = []
    for raw_path in _EXPLICIT_PATH_TOKEN.findall(message):
        cleaned = raw_path.rstrip(".,;:!?)]}，。；")
        if cleaned and cleaned not in tokens:
            tokens.append(cleaned)
    return tokens


def _path_was_explicitly_provided(message: str, path: str) -> bool:
    expected = Path(path).expanduser().resolve()
    expected_text = str(expected)
    if expected_text in message or path in message:
        return True
    for raw_path in _explicit_path_tokens(message):
        try:
            candidate = Path(raw_path).expanduser().resolve()
        except OSError:
            continue
        if expected == candidate:
            return True
    return False


def _text_field_value(message: str, hints: tuple[str, ...]) -> str | None:
    """Extract an identifier after a field hint, separator, or quotes."""
    quoted = re.search(r"""['"]([A-Za-z_][A-Za-z0-9_]*)['"]""", message)
    if quoted and _SPEC_IDENTIFIER.fullmatch(quoted.group(1)):
        return quoted.group(1)
    bare = re.search(
        r"(?:[:：=]|为|to|is)\s*([A-Za-z_][A-Za-z0-9_]*)\b",
        message,
        flags=re.IGNORECASE,
    )
    if bare and _SPEC_IDENTIFIER.fullmatch(bare.group(1)):
        return bare.group(1)
    for hint in sorted(hints, key=len, reverse=True):
        pattern = re.compile(
            rf"(?:(?<![a-z0-9_]){re.escape(hint)}(?![a-z0-9_]))\s*[:：=]?\s*"
            r"([A-Za-z_][A-Za-z0-9_]*)\b",
            flags=re.IGNORECASE,
        )
        match = pattern.search(message)
        if match and _SPEC_IDENTIFIER.fullmatch(match.group(1)):
            return match.group(1)
    return None


def _message_has_hint(text: str, hint: str) -> bool:
    if not hint:
        return False
    if hint.isascii() and hint.isalpha() and len(hint) <= 4:
        return (
            re.search(rf"(?<![a-z0-9_]){re.escape(hint)}(?![a-z0-9_])", text) is not None
        )
    return hint in text


def _deterministic_spec_correction(message: str) -> GuiWorkspaceSetupProposal | None:
    """Apply unambiguous Spec corrections before Codex (paths, numbers, identifiers)."""
    text = message.casefold()
    updates: dict[str, object] = {}
    path_updates = _deterministic_path_field_updates(text, message)
    if path_updates is None:
        return None
    updates.update(path_updates)
    number_updates = _deterministic_number_field_updates(text, message)
    if number_updates is None:
        return None
    updates.update(number_updates)
    workspace_name = _WORKSPACE_NAME_TOKEN.search(message)
    if workspace_name and any(
        _message_has_hint(text, hint) for hint in ("workspace", "工作区", "ws_")
    ):
        updates["workspace_name"] = workspace_name.group(1).lower()
    for hints, field in _TEXT_FIELD_HINTS:
        if field == "workspace_name" or field in updates:
            continue
        if not any(_message_has_hint(text, hint) for hint in hints):
            continue
        value = _text_field_value(message, hints)
        if value is not None:
            updates[field] = value
    for step in GUI_WORKSPACE_FLOW_STEPS:
        if step.casefold() in text and any(
            _message_has_hint(text, hint)
            for hint in ("flow end", "终点", "结束阶段", "end")
        ):
            updates["flow_end"] = step
            break
    if not updates:
        return None
    summary = ", ".join(f"{key}={value}" for key, value in updates.items())
    return _spec_field_correction(**updates, summary=f"Set {summary}.")


def _deterministic_path_field_updates(text: str, message: str) -> dict[str, str] | None:
    """Return path updates, or None when a path token is ambiguous across fields."""
    matched_fields: list[tuple[str, str]] = []
    for token in _explicit_path_tokens(message):
        candidate = Path(token).expanduser().resolve()
        resolved = str(candidate)
        token_matches: list[tuple[str, str]] = []
        for hints, field, kind in _PATH_FIELD_HINTS:
            if not any(_message_has_hint(text, hint) for hint in hints):
                continue
            if kind == "directory" and candidate.is_dir():
                token_matches.append((field, resolved))
            elif kind == "rtl" and candidate.is_file() and resolved.lower().endswith((".v", ".sv")):
                token_matches.append((field, resolved))
            elif kind == "filelist" and candidate.is_file() and resolved.lower().endswith(".f"):
                token_matches.append((field, resolved))
            elif kind == "sdc" and candidate.is_file() and resolved.lower().endswith(".sdc"):
                token_matches.append((field, resolved))
        unique_for_token = list(dict.fromkeys(token_matches))
        if len(unique_for_token) > 1:
            return None
        matched_fields.extend(unique_for_token)
    by_field: dict[str, str] = {}
    for field, path in matched_fields:
        if field in by_field and by_field[field] != path:
            return None
        by_field[field] = path
    return by_field


def _deterministic_number_field_updates(text: str, message: str) -> dict[str, float] | None:
    """Return number updates, or None when a number is ambiguous across fields."""
    numbers = [float(match.group(1)) for match in _NUMBER_TOKEN.finditer(message)]
    if not numbers:
        return {}
    updates: dict[str, float] = {}
    claimed_values: set[float] = set()
    for hints, field, lower, upper in _NUMBER_FIELD_HINTS:
        if not any(_message_has_hint(text, hint) for hint in hints):
            continue
        candidates = [value for value in numbers if lower <= value <= upper]
        if len(candidates) != 1:
            return None
        value = candidates[0]
        if value in claimed_values and field not in updates:
            return None
        updates[field] = value
        claimed_values.add(value)
    return updates


def _spec_field_correction(**overrides: object) -> GuiWorkspaceSetupProposal:
    payload: dict[str, object] = {
        "schema_version": "flow-agent.gui_workspace_setup_proposal.v1",
        "workspace_name": None,
        "description": None,
        "design_name": None,
        "top_module": None,
        "clock_name": None,
        "frequency_mhz": None,
        "max_fanout": None,
        "flow_start": None,
        "flow_end": None,
        "die_area_mode": None,
        "utilitization": None,
        "margin": None,
        "die_width": None,
        "die_height": None,
        "target_density": None,
        "target_overflow": None,
        "project_root": None,
        "rtl_path": None,
        "filelist_path": None,
        "sdc_path": None,
        "pdk_root": None,
        "summary": "No correction.",
    }
    payload.update(overrides)
    return GuiWorkspaceSetupProposal.model_validate(payload)


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
            "只重跑所选阶段，然后停止"
            if contract.execution_scope == "single_step"
            else (
                f"从所选阶段重跑，并继续到标准流程终点"
                f"（{contract.end_step.value}）"
            )
        )
        fields = [
            {"label": "Design", "value": contract.design_id},
            {"label": "源 workspace", "value": contract.source_workspace},
            {"label": "目标 workspace", "value": contract.target_workspace},
            {"label": "起始阶段", "value": contract.target_step.value},
            {"label": "终点阶段", "value": contract.end_step.value},
            {"label": "执行范围", "value": scope},
            *parameter_fields,
            {"label": "确认", "value": "required"},
        ]
        title = "Workspace 重跑方案"
    else:
        scope = (
            "rerun only the selected stage, then stop"
            if contract.execution_scope == "single_step"
            else (
                "rerun from the selected stage through the standard flow end "
                f"({contract.end_step.value})"
            )
        )
        fields = [
            {"label": "Design", "value": contract.design_id},
            {"label": "Source workspace", "value": contract.source_workspace},
            {"label": "Target workspace", "value": contract.target_workspace},
            {"label": "Start stage", "value": contract.target_step.value},
            {"label": "End stage", "value": contract.end_step.value},
            {"label": "Execution scope", "value": scope},
            *parameter_fields,
            {"label": "Confirmation", "value": "required"},
        ]
        title = "Workspace rerun plan"
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


def _prompt_for_phase(session: Any) -> str:
    prompts = {
        "home_ready": home_ready_prompt(session.language),
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
            ()
            if session.rerun_discovery is None or session.rerun_stage is None
            else _rerun_resolver(session).parameter_values(
                session.rerun_discovery.source, session.rerun_stage
            ),
        ),
        "rerun_scope": rerun_scope_prompt(
            session.language, catalog_end_step().value
        ),
        "workspace_project_mode": project_mode_prompt(session.language),
        "workspace_project_root": project_root_prompt(
            session.language, creating=session.creating_project
        ),
        "workspace_name": workspace_name_prompt(
            session.language,
            recommended_workspace_name(session.workspace_inputs.project_root)
            if session.workspace_inputs.project_root
            else "",
        ),
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
        "workspace_parameter_request": workspace_parameter_request_prompt(session.language),
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


def _deterministic_operation_choice(message: str) -> str | None:
    """Exact numbered GUI choice values only — avoid digit false positives in free text."""
    stripped = message.strip()
    return stripped if stripped in {"1", "2", "3", "4"} else None


def _keyword_operation_choice(
    message: str, *, mode: str, allowed_ids: set[str]
) -> str | None:
    text = message.casefold()
    if mode == "workspace":
        candidates: tuple[tuple[str, tuple[str, ...]], ...] = (
            (
                "1",
                (
                    "parameter",
                    "参数",
                    "density",
                    "overflow",
                    "fanout",
                    "utilization",
                    "utilitization",
                ),
            ),
            ("2", ("rerun", "重跑", "re-run", "re run")),
            ("3", ("continue", "继续", "unfinished")),
            (
                "4",
                (
                    "another workspace",
                    "新建 workspace",
                    "create another",
                    "create workspace",
                    "新建工作区",
                ),
            ),
        )
    else:
        # Home: require an intentional create/run signal — not bare "project"/"workspace".
        candidates = (
            (
                "1",
                (
                    "create workspace",
                    "创建 workspace",
                    "创建工作区",
                    "create",
                    "创建",
                    "rtl-to-gds",
                    "rtl to gds",
                    "rtl到gds",
                    "run full",
                    "完整流程",
                    "创建并运行",
                ),
            ),
        )
    matches = [
        operation_id
        for operation_id, keys in candidates
        if operation_id in allowed_ids and any(key in text for key in keys)
    ]
    return matches[0] if len(matches) == 1 else None


@dataclass(frozen=True)
class CreateBootstrap:
    creating_project: bool | None = None
    project_root: str | None = None
    workspace_name: str | None = None
    design_name: str | None = None
    flow_end: str | None = None


def _extract_create_bootstrap(message: str) -> CreateBootstrap:
    """Pull unambiguous create-flow fields from one natural-language message."""
    text = message.casefold()
    creating: bool | None = None
    if any(
        key in text
        for key in ("新建 project", "create project", "new project", "创建项目", "新建项目")
    ):
        creating = True
    elif any(
        key in text
        for key in ("已有 project", "existing project", "使用已有", "已有项目")
    ):
        creating = False

    project_root: str | None = None
    for token in _explicit_path_tokens(message):
        candidate = Path(token).expanduser().resolve()
        if not candidate.is_dir():
            continue
        has_manifest = (candidate / "project.json").is_file()
        if creating is False and not has_manifest:
            continue
        if creating is True or has_manifest or any(
            _message_has_hint(text, hint)
            for hint in ("project root", "project_root", "项目根", "project")
        ):
            project_root = str(candidate)
            if creating is None and has_manifest:
                creating = False
            break

    workspace_name: str | None = None
    workspace_match = _WORKSPACE_NAME_TOKEN.search(message)
    if workspace_match and any(
        _message_has_hint(text, hint) for hint in ("workspace", "工作区", "ws_", "命名")
    ):
        workspace_name = workspace_match.group(1).lower()
    elif workspace_match and creating is not None:
        workspace_name = workspace_match.group(1).lower()

    design_name: str | None = None
    for hints, field in _TEXT_FIELD_HINTS:
        if field != "design_name":
            continue
        if not any(_message_has_hint(text, hint) for hint in hints):
            continue
        design_name = _text_field_value(message, hints)
        break

    flow_end: str | None = None
    for step in GUI_WORKSPACE_FLOW_STEPS:
        if step.casefold() in text and any(
            _message_has_hint(text, hint)
            for hint in ("flow end", "终点", "结束阶段", "end", "停在")
        ):
            flow_end = step
            break

    return CreateBootstrap(
        creating_project=creating,
        project_root=project_root,
        workspace_name=workspace_name,
        design_name=design_name,
        flow_end=flow_end,
    )


def _allowed_operation_options(
    language: str, *, mode: str, allow_create_workspace_in_project: bool
) -> list[dict[str, str]]:
    choice = operation_choice(
        language,
        "operation-preview",
        mode=mode,
        allow_create_workspace_in_project=allow_create_workspace_in_project,
    )
    return [
        {"id": str(option["value"]), "label": str(option["label"])}
        for option in choice["options"]
    ]


def _propose_gui_chat_response(context: dict[str, Any]) -> GuiChatResponseProposal:
    progress_callback, register_interrupt, request_context = _gui_workspace_request_context(context)
    cwd_value = request_context.get("workspace") or request_context.get("project_root")
    cwd = Path(cwd_value).expanduser().resolve() if isinstance(cwd_value, str) and cwd_value else Path.cwd()
    if not cwd.is_dir():
        cwd = Path.cwd()
    provider = create_required_codex_provider(
        cwd=cwd,
        runtime_workspace_roots=(cwd,),
        progress_callback=progress_callback,
    )
    register_interrupt(provider.interrupt)
    try:
        return GuiChatResponseProposal.model_validate(
            provider.respond_to_gui_chat(request_context)
        )
    finally:
        register_interrupt(None)
        provider.close()


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
