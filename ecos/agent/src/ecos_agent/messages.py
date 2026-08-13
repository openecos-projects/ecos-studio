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
        "From the home screen it selects or creates a Project "
        "(directory with project.json), then creates a Workspace under that Project "
        "and runs a full ECC physical-design flow.\n\n"
        "Start below, or describe what you want to set up."
    )


def operation_prompt(language: str) -> str:
    return _prompt(language, "请在下方选择操作。", "Choose an operation below.")


def home_ready_prompt(language: str) -> str:
    return _prompt(
        language,
        "点击下方开始创建 Workspace，或直接说明意图（例如使用已有 Project、设计名、Workspace 名称）。",
        "Start creating a Workspace below, or describe your intent (for example an existing Project, design name, or Workspace name).",
    )


def unmatched_operation_prompt(language: str) -> str:
    return _prompt(
        language,
        "未能识别为可执行操作。请点击下方选项，或说明要创建 Workspace、重跑、改参数等明确意图。",
        "That does not match an available operation. Use an option below, or clearly say you want to create a Workspace, rerun, or update parameters.",
    )


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
    if recommendation:
        return _prompt(
            language,
            "Workspace 名称是什么？这将是 Project 下的子目录名，例如 ws_0001。可点击使用下方推荐，或输入其他名称。",
            "What is the Workspace Name? This becomes the subdirectory under the Project, for example ws_0001. Use the suggestion below, or enter another name.",
        )
    return _prompt(
        language,
        "Workspace 名称是什么？这将是 Project 下的子目录名，例如 ws_0001。",
        "What is the Workspace Name? This becomes the subdirectory under the Project, for example ws_0001.",
    )


def design_name_prompt(language: str, recommendation: str = "") -> str:
    if recommendation:
        return _prompt(
            language,
            "设计名（Design Name）是什么？例如：gcd。这是设计标识，不必等于 Workspace 目录名。可点击使用下方推荐，或输入其他名称。",
            "What is the Design Name? For example: gcd. This is the design id, not necessarily the Workspace directory name. Use the suggestion below, or enter another name.",
        )
    return _prompt(
        language,
        "设计名（Design Name）是什么？例如：gcd。这是设计标识，不必等于 Workspace 目录名。",
        "What is the Design Name? For example: gcd. This is the design id, not necessarily the Workspace directory name.",
    )


def flow_end_prompt(language: str) -> str:
    return _prompt(
        language,
        "选择 flow 的终止阶段。可执行全部步骤，或停在某一阶段。",
        "Choose where the flow should stop. Run all steps, or end after a specific stage.",
    )


def flow_end_choice(language: str, prompt_id: str) -> dict[str, Any]:
    labeled_values = (
        (_prompt(language, "执行全部步骤", "Run all steps"), "0"),
        *(
            (step, str(index))
            for index, step in enumerate(GUI_WORKSPACE_FLOW_STEPS, 1)
        ),
    )
    return _choice(
        prompt_id,
        _prompt(language, "选择终止阶段", "Choose the end step"),
        (),
        variant="list",
        labeled_values=labeled_values,
    )


def rtl_prompt(language: str, recommendation: str = "") -> str:
    if recommendation:
        return _prompt(
            language,
            "RTL 文件路径是什么？可点击使用下方推荐路径，或输入其他本地路径。",
            "What is the RTL file path? Use the recommended path below, or enter another local path.",
        )
    return _prompt(
        language,
        "RTL 文件路径是什么？请输入本地 .v / .sv 文件路径。",
        "What is the RTL file path? Enter a local .v / .sv file path.",
    )


def optional_file_prompt(language: str, label: str, extension: str, recommendation: str = "") -> str:
    if recommendation:
        return _prompt(
            language,
            f"可选 {label} 路径：点击下方使用推荐或跳过，也可输入后缀为 {extension} 的路径。",
            f"Optional {label} path: use the recommendation below, skip, or enter a path with suffix {extension}.",
        )
    return _prompt(
        language,
        f"可选 {label} 路径：点击下方跳过，也可输入后缀为 {extension} 的路径。",
        f"Optional {label} path: skip below, or enter a path with suffix {extension}.",
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
        "PDK 路径是什么？可点击使用下方推荐路径，或输入其他已存在的 PDK 目录。",
        "What is the PDK path? Use the recommended path below, or enter another existing PDK directory.",
    )


def mpc_prompt(language: str) -> str:
    return _prompt(
        language,
        "是否使用当前 Project 已选择的 SoC-MPC 模板？请选择使用或不使用。",
        "Use the SoC-MPC template selected for this Project? Choose whether to use it.",
    )


def default_value_prompt(language: str, label: str, value: object) -> str:
    return _prompt(
        language,
        f"{label} 是什么？可点击使用下方默认值，或输入其他值。",
        f"What is {label}? Use the default below, or enter another value.",
    )


def number_prompt(language: str, label: str, value: object, lower: float, upper: float) -> str:
    return _prompt(
        language,
        f"{label} 是什么？范围 {lower:g}-{upper:g}；可点击使用下方默认值，或输入其他数值。",
        f"What is {label}? Range {lower:g}-{upper:g}; use the default below, or enter another value.",
    )


def invalid_choice(language: str) -> str:
    return _prompt(
        language,
        "请从下方选项中选择，或按提示输入有效内容。",
        "Choose one of the options below, or enter a valid value as prompted.",
    )


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
        f"Workspace 创建失败：{error}。请修正相关 Spec 后，再次点击确认。",
        f"Workspace creation failed: {error}. Correct the affected specification, then confirm again.",
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
            "重跑源 workspace 路径是什么？可点击使用下方当前 GUI workspace，或输入其他已有路径。",
            "What is the source workspace path? Use the current GUI workspace below, or enter another existing path.",
        )
    return _prompt(
        language,
        "请输入已有的重跑源 workspace 路径。",
        "Enter an existing source workspace path for rerun.",
    )


def workspace_parameter_request_prompt(language: str) -> str:
    return _prompt(
        language,
        "请描述要保存到当前 workspace 的参数修改，例如降低 density 或关闭 routability optimization。",
        "Describe the parameter change to save in the current workspace, for example lower density or disable routability optimization.",
    )


def rerun_stage_prompt(language: str, stages: tuple[str, ...]) -> str:
    return _prompt(
        language,
        (
            "请选择重跑的起始阶段：这一阶及之后会在隔离 workspace 中重算；"
            "之前的阶段会沿用源 workspace 的结果，不会从 Synthesis 重新跑起。"
        ),
        (
            "Choose the start stage for rerun: that stage and later ones will be "
            "recomputed in an isolated workspace. Earlier stages keep the source "
            "workspace results — this does not restart from Synthesis."
        ),
    )


def rerun_parameter_prompt(
    language: str, parameter_values: tuple[tuple[str, object], ...]
) -> str:
    if not parameter_values:
        return _prompt(
            language,
            "该阶段当前没有可配置的重跑参数；将保持现有配置继续。",
            "This stage has no tunable rerun parameters; the current configuration will be kept.",
        )
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


def rerun_no_parameters_prompt(language: str, flow_end: str) -> str:
    return _prompt(
        language,
        (
            "该阶段当前没有可配置的重跑参数，将保持现有配置。"
            f"请选择：只重跑该阶段后停止，或从该阶段继续跑到标准流程终点（{flow_end}）。"
        ),
        (
            "This stage has no tunable rerun parameters; the current configuration will be kept. "
            f"Choose: stop after this stage, or continue from it through the standard flow end ({flow_end})."
        ),
    )


def rerun_scope_prompt(language: str, flow_end: str) -> str:
    return _prompt(
        language,
        (
            "请选择执行范围：只重跑所选阶段后停止，"
            f"或从所选阶段继续跑到标准流程终点（{flow_end}），而不是源 workspace 原先规划的终点。"
        ),
        (
            "Choose the execution scope: stop after the selected stage, "
            f"or continue from it through the standard flow end ({flow_end}) — "
            "not the source workspace's original planned end."
        ),
    )


def source_run_prompt(language: str, run_ids: tuple[str, ...]) -> str:
    return _prompt(
        language,
        (
            "请确认重跑的源 workspace（将复制到隔离目录，不会覆盖源目录）。"
            "可使用当前路径，或输入其他已有 workspace。"
        ),
        (
            "Confirm the source workspace for rerun (it will be copied into an "
            "isolated directory; the source is not overwritten). Use the current "
            "path, or enter another existing workspace."
        ),
    )


def confirmation_menu(language: str) -> str:
    return _prompt(
        language,
        "请选择确认并开始运行，或取消。",
        "Choose Confirm and start, or cancel.",
    )


def workspace_continue_prompt(language: str, workspace: str) -> str:
    return _prompt(
        language,
        f"确认在当前 workspace 继续未完成的 flow？\n{workspace}\n\n请选择确认并开始运行，或取消。",
        f"Continue the unfinished flow in the current workspace?\n{workspace}\n\nChoose Confirm and start, or cancel.",
    )


def workspace_continue_title(language: str) -> str:
    return _prompt(language, "继续未完成的 flow", "Continue unfinished flow")


def home_ready_choice(language: str, prompt_id: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "开始", "Get started"),
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=(
            (
                _prompt(
                    language,
                    "开始创建 Workspace 并运行完整 RTL 到 GDS 流程",
                    "Start creating a Workspace and run a full RTL-to-GDS flow",
                ),
                "1",
            ),
        ),
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
        # Home sessions use home_ready_choice; keep a single create option for NL mapping.
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
        allow_free_text=True,
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
        _prompt(language, "起始阶段", "Start stage"),
        stages,
        variant="list",
    )


def rerun_scope_choice(language: str, prompt_id: str, flow_end: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "选择执行范围", "Choose the execution scope"),
        (
            _prompt(
                language,
                "只重跑所选阶段，然后停止",
                "Rerun only the selected stage, then stop",
            ),
            _prompt(
                language,
                f"从所选阶段重跑，并继续到标准流程终点（{flow_end}）",
                f"Rerun from the selected stage through the standard flow end ({flow_end})",
            ),
        ),
        variant="list",
    )


def source_run_choice(language: str, prompt_id: str, run_ids: tuple[str, ...]) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "源 workspace", "Source workspace"),
        run_ids,
        variant="list",
        allow_free_text=True,
    )


def rerun_workspace_choice(
    language: str, prompt_id: str, default_path: str
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "选择源 workspace", "Choose the source workspace"),
        (),
        variant="buttons",
        allow_free_text=True,
        labeled_values=(
            (
                _prompt(language, "使用当前 GUI workspace", "Use current GUI workspace"),
                default_path,
            ),
        ),
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


def mpc_choice(language: str, prompt_id: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "SoC-MPC 模板", "SoC-MPC template"),
        (
            _prompt(language, "使用 SoC-MPC 模板", "Use a SoC-MPC template"),
            _prompt(language, "不使用 SoC-MPC 模板", "Do not use a SoC-MPC template"),
        ),
        variant="buttons",
    )


def recommended_path_choice(
    language: str,
    prompt_id: str,
    recommendation: str,
    *,
    field: str = "PDK",
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, f"{field} 路径", f"{field} path"),
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


def keep_parameters_choice(
    language: str,
    prompt_id: str,
    *,
    allow_free_text: bool = True,
) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "参数调整", "Parameter changes"),
        (),
        variant="buttons",
        allow_free_text=allow_free_text,
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
