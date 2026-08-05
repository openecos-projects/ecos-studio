"""Messages for the deterministic ECOS Agent GUI wizard."""

import json
import re
from typing import Any

from ecos_agent.contracts import GUI_WORKSPACE_FLOW_STEPS

# Choice option values cannot be empty through the desktop bridge validator.
# Handlers map this sentinel back to an empty free-text answer.
EMPTY_CHOICE_VALUE = "__empty__"


def language_for_text(value: str) -> str:
    return "zh" if re.search(r"[\u4e00-\u9fff]", value) else "en"


def resolve_emptyable_answer(message: str) -> str:
    stripped = message.strip()
    return "" if stripped in {"", EMPTY_CHOICE_VALUE} else message.strip()


def welcome_message(
    *,
    mode: str = "home",
    workspace: str = "",
    project: str = "",
) -> str:
    if mode == "workspace":
        parts: list[str] = []
        if project:
            parts.append(f"Project: {project}")
        elif workspace:
            parts.append("Project: (standalone — no project.json parent)")
        if workspace:
            parts.append(f"Workspace: {workspace}")
        location = f" {' · '.join(parts)}." if parts else ""
        if project:
            capabilities = (
                "update parameters, rerun a completed stage in an isolated workspace, "
                "continue an unfinished flow in place, or create another workspace in this project"
            )
        else:
            capabilities = (
                "update parameters, rerun a completed stage in an isolated workspace, "
                "or continue an unfinished flow in place"
            )
        return (
            "ECOS Agent is bound to the open workspace."
            f"{location}\n\n"
            f"It can {capabilities}.\n\n"
            "Choose an operation below."
        )
    return (
        "ECOS Agent is a state-controlled, PPA-oriented design-flow agent. "
        "From the home screen it first selects or creates a Project "
        "(directory with project.json), then creates a Workspace under that Project "
        "and runs a full ECC physical-design flow.\n\n"
        "Choose an operation below."
    )


def operation_prompt(language: str) -> str:
    return _prompt(language, "请在下方选择操作。", "Choose an operation below.")


def project_mode_prompt(language: str) -> str:
    return _prompt(
        language,
        "请选择使用已有 Project，或新建 Project。",
        "Choose whether to use an existing Project or create a new Project.",
    )


def project_root_prompt(language: str, *, creating: bool = False) -> str:
    if creating:
        return _prompt(
            language,
            "请输入新 Project 的根目录（已存在的目录；将在此创建 project.json）。",
            "Enter the new Project Root — an existing directory where project.json will be created.",
        )
    return _prompt(
        language,
        "请输入已有 Project 的根目录（该目录下应有 project.json）。",
        "Enter an existing Project Root — a directory that already contains project.json.",
    )


def workspace_name_prompt(language: str, recommendation: str = "") -> str:
    suffix = f" 推荐：{recommendation}" if recommendation else ""
    english_suffix = f" Suggested: {recommendation}" if recommendation else ""
    return _prompt(
        language,
        f"Workspace 名称是什么？这将是 Project 下的子目录名，例如 ws_0001。{suffix}",
        f"What is the Workspace Name? This becomes the subdirectory under the Project, for example ws_0001.{english_suffix}",
    )


def design_name_prompt(language: str, recommendation: str = "") -> str:
    suffix = f" 推荐：{recommendation}" if recommendation else ""
    english_suffix = f" Suggested: {recommendation}" if recommendation else ""
    return _prompt(
        language,
        f"设计名（Design Name）是什么？例如：gcd。这是设计标识，不必等于 Workspace 目录名。{suffix}",
        f"What is the Design Name? For example: gcd. This is the design id, not necessarily the Workspace directory name.{english_suffix}",
    )


def flow_end_prompt(language: str) -> str:
    lines = [
        "选择 end step：输入 0 执行全部步骤。" if language == "zh" else "Choose the end step. Enter 0 to run all steps."
    ]
    lines.extend(f"{index}. {step}" for index, step in enumerate(GUI_WORKSPACE_FLOW_STEPS, 1))
    return "\n".join(lines)


def rtl_prompt(language: str, recommendation: str = "") -> str:
    suffix = f" 推荐路径：{recommendation}" if recommendation else ""
    english_suffix = f" Recommended local path: {recommendation}" if recommendation else ""
    return _prompt(language, f"RTL 文件路径是什么？{suffix}", f"What is the RTL file path?{english_suffix}")


def optional_file_prompt(language: str, label: str, extension: str, recommendation: str = "") -> str:
    suffix = f" 推荐路径：{recommendation}" if recommendation else ""
    english_suffix = f" Recommended local path: {recommendation}" if recommendation else ""
    return _prompt(
        language,
        f"可选 {label} 路径：点击下方跳过或使用推荐，也可输入后缀为 {extension} 的路径。{suffix}",
        f"Optional {label} path: skip or use the recommendation below, or enter a path with suffix {extension}.{english_suffix}",
    )


def pdk_prompt(language: str, recommendation: str = "") -> str:
    if not recommendation:
        return _prompt(
            language,
            "PDK 路径是什么？请输入一个已存在的 PDK 目录。",
            "What is the PDK path? Enter an existing PDK directory.",
        )
    return _prompt(
        language,
        f"PDK 路径是什么？可点击使用推荐路径，或输入其他已存在的 PDK 目录：{recommendation}",
        f"What is the PDK path? Use the recommended path below, or enter another existing PDK directory: {recommendation}",
    )


def default_value_prompt(language: str, label: str, value: object) -> str:
    return _prompt(
        language,
        f"{label} 是什么？可点击使用默认值，或输入其他值。默认值：{value}",
        f"What is {label}? Use the default below, or enter another value. Default: {value}",
    )


def number_prompt(language: str, label: str, value: object, lower: float, upper: float) -> str:
    return _prompt(
        language,
        f"{label} 是什么？范围 {lower:g}-{upper:g}；可点击使用默认值，或输入其他数值。默认值：{value}",
        f"What is {label}? Range {lower:g}-{upper:g}; use the default below, or enter another value. Default: {value}",
    )


def invalid_choice(language: str) -> str:
    return _prompt(language, "请输入列出的数字。", "Enter one of the listed numbers.")


def invalid_value(language: str, label: str, rule: str) -> str:
    return _prompt(language, f"{label} 无效：{rule}", f"Invalid {label}: {rule}")


def cancellation_message(language: str) -> str:
    return _prompt(language, "已取消；未创建 workspace，也未执行 ECC。", "Cancelled; no workspace was created and ECC was not executed.")


def workspace_confirmation_prompt(language: str) -> str:
    return _prompt(
        language,
        "请审核 Spec：点击确认以创建 workspace 并执行流程，点击取消则返回；也可输入文本修正 Spec。",
        "Review the specification: confirm to create the workspace and run the flow, cancel to return, or enter text to correct the spec.",
    )


def workspace_execution_started(language: str) -> str:
    return _prompt(
        language,
        "已确认冻结合同；GUI 将创建 workspace 并通过固定 ECOS RPC 执行流程。",
        "The frozen contract is confirmed. The GUI will create the workspace and execute the flow through fixed ECOS RPC.",
    )


def workspace_creation_failed(language: str, error: str) -> str:
    return _prompt(
        language,
        f"Workspace 创建失败：{error}。请修正相关 Spec 后再次输入 1 确认。",
        f"Workspace creation failed: {error}. Correct the affected specification, then enter 1 to try again.",
    )


def contract_ready_message(language: str) -> str:
    return _prompt(
        language,
        "已解析执行合同；确认前不会运行 ECC。",
        "Execution contract resolved; ECC will not run until confirmation.",
    )


def rerun_design_prompt(language: str) -> str:
    return _prompt(
        language,
        "请输入需要重跑的 design name，例如 gcd：",
        "Enter the design name to rerun, for example, gcd:",
    )


def rerun_workspace_prompt(language: str, default_path: str | None) -> str:
    if default_path:
        return _prompt(
            language,
            f"重跑源 workspace 路径是什么？留空使用当前 GUI workspace：{default_path}；也可输入其他已有路径。",
            f"What is the source workspace path? Submit an empty input to use the current GUI workspace: {default_path}; or enter another existing path.",
        )
    return _prompt(
        language,
        "请输入已有的重跑源 workspace 路径。",
        "Enter an existing source workspace path for rerun.",
    )


def rerun_stage_prompt(language: str, stages: tuple[str, ...]) -> str:
    return _prompt(language, "请选择重跑起始阶段。", "Choose the rerun start stage.")


def rerun_parameter_prompt(
    language: str, parameter_values: tuple[tuple[str, object], ...]
) -> str:
    title = "该阶段可修改的参数：" if language == "zh" else "Parameters available for this stage:"
    prompt = (
        "请输入要修改的参数和数值。"
        if language == "zh"
        else "Describe the parameter change and value."
    )
    rows = (
        ["| 参数名 | 当前值 |", "| --- | --- |"]
        if language == "zh"
        else ["| Parameter | Current value |", "| --- | --- |"]
    )
    rows.extend(
        f"| {knob_id} | {_parameter_value(value)} |" for knob_id, value in parameter_values
    )
    return "\n".join([title, *rows, prompt])


def rerun_scope_prompt(language: str) -> str:
    return _prompt(language, "请选择执行范围。", "Choose the execution scope.")


def source_run_prompt(language: str, run_ids: tuple[str, ...]) -> str:
    return _prompt(
        language,
        "请选择当前冻结源 run，或输入其他已有 workspace 路径。",
        "Choose the current frozen source run, or enter another existing workspace path.",
    )


def confirmation_menu(language: str) -> str:
    return _prompt(
        language,
        "请选择确认并开始运行，或取消。",
        "Choose Confirm and start, or cancel.",
    )


def operation_choice(
    language: str,
    prompt_id: str,
    *,
    mode: str = "home",
    allow_create_workspace_in_project: bool = False,
) -> dict[str, Any]:
    if mode == "workspace":
        options = [
            _prompt(language, "修改当前 workspace 参数（只保存）", "Update workspace parameters (save only)"),
            _prompt(language, "从指定阶段重跑", "Rerun a specified stage"),
            _prompt(language, "继续未完成的 flow", "Continue unfinished flow"),
        ]
        if allow_create_workspace_in_project:
            options.append(
                _prompt(
                    language,
                    "在当前 Project 下新建 Workspace",
                    "Create another workspace in this project",
                )
            )
        options_tuple = tuple(options)
    else:
        options_tuple = (
            _prompt(
                language,
                "在 Project 下创建 Workspace 并运行完整 RTL 到 GDS 流程",
                "Create a Workspace under a Project and run a full RTL-to-GDS flow",
            ),
        )
    return _choice(
        prompt_id,
        _prompt(language, "选择操作", "Choose an operation"),
        options_tuple,
        variant="list",
    )


def project_mode_choice(language: str, prompt_id: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "选择 Project", "Choose a Project"),
        (
            _prompt(language, "使用已有 Project", "Use an existing Project"),
            _prompt(language, "新建 Project", "Create a new Project"),
        ),
        variant="list",
    )


def known_project_choice(
    language: str,
    prompt_id: str,
    projects: tuple[tuple[str, str], ...],
) -> dict[str, Any]:
    """projects: (label, path value) pairs."""
    return {
        "promptId": prompt_id,
        "title": _prompt(language, "选择已有 Project", "Choose an existing Project"),
        "options": [
            {
                "id": f"{prompt_id}-{index}",
                "label": label,
                "value": path,
            }
            for index, (label, path) in enumerate(projects, 1)
        ],
        "allowFreeText": True,
        "variant": "list",
    }


def rerun_stage_choice(language: str, prompt_id: str, stages: tuple[str, ...]) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "选择重跑起始阶段", "Choose the rerun start stage"),
        stages,
        variant="list",
    )


def rerun_scope_choice(language: str, prompt_id: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "选择执行范围", "Choose the execution scope"),
        (
            _prompt(language, "重跑该阶段后停止", "Rerun this stage, then stop"),
            _prompt(language, "继续执行至流程结束", "Continue to the end of the flow"),
        ),
        variant="list",
    )


def source_run_choice(language: str, prompt_id: str, run_ids: tuple[str, ...]) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "选择冻结源 run", "Choose the frozen source run"),
        run_ids,
        variant="list",
        allow_free_text=True,
    )


def confirmation_choice(
    language: str, prompt_id: str, *, allow_free_text: bool
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "确认执行", "Confirm execution"),
        (
            _prompt(language, "确认并开始运行", "Confirm and start"),
            _prompt(language, "取消", "Cancel"),
        ),
        variant="buttons",
        allow_free_text=allow_free_text,
    )


def optional_file_choice(
    language: str,
    prompt_id: str,
    label: str,
    recommendation: str = "",
) -> dict[str, Any]:
    options: list[tuple[str, str]] = []
    if recommendation:
        options.append(
            (
                _prompt(language, "使用推荐路径", "Use recommended path"),
                recommendation,
            )
        )
    options.append((_prompt(language, "跳过", "Skip"), EMPTY_CHOICE_VALUE))
    return _choice(
        prompt_id,
        _prompt(language, f"可选 {label} 路径", f"Optional {label} path"),
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=tuple(options),
    )


def recommended_path_choice(
    language: str, prompt_id: str, recommendation: str
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "PDK 路径", "PDK path"),
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=(
            (
                _prompt(language, "使用推荐路径", "Use recommended path"),
                recommendation,
            ),
        ),
    )


def default_value_choice(
    language: str, prompt_id: str, label: str, value: object
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        label,
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=(
            (
                _prompt(language, f"使用默认值：{value}", f"Use default: {value}"),
                str(value),
            ),
        ),
    )


def number_default_choice(
    language: str,
    prompt_id: str,
    label: str,
    value: object,
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        label,
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=(
            (
                _prompt(language, f"使用默认值：{value}", f"Use default: {value}"),
                str(value),
            ),
        ),
    )


def keep_parameters_choice(language: str, prompt_id: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "参数调整", "Parameter changes"),
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=(
            (
                _prompt(language, "保持当前参数", "Keep current parameters"),
                EMPTY_CHOICE_VALUE,
            ),
        ),
    )


def numbered_choice(value: str, options: tuple[str, ...]) -> str | None:
    try:
        index = int(value)
    except ValueError:
        return None
    return options[index - 1] if 1 <= index <= len(options) else None


def _choice(
    prompt_id: str,
    title: str,
    labels: tuple[str, ...],
    *,
    variant: str,
    allow_free_text: bool = False,
    labeled_values: tuple[tuple[str, str], ...] = (),
) -> dict[str, Any]:
    options = (
        [
            {"id": f"{prompt_id}-{index}", "label": label, "value": value}
            for index, (label, value) in enumerate(labeled_values, 1)
        ]
        if labeled_values
        else [
            {"id": f"{prompt_id}-{index}", "label": label, "value": str(index)}
            for index, label in enumerate(labels, 1)
        ]
    )
    return {
        "promptId": prompt_id,
        "title": title,
        "options": options,
        "allowFreeText": allow_free_text,
        "variant": variant,
    }


def _prompt(language: str, chinese: str, english: str) -> str:
    return chinese if language == "zh" else english


def _parameter_value(value: object) -> str:
    if isinstance(value, str):
        return value.replace("|", "\\|")
    return json.dumps(value, ensure_ascii=True).replace("|", "\\|")
