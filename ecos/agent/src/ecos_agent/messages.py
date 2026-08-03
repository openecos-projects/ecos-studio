"""Messages for the deterministic ECOS Agent GUI wizard."""

import json
import re

from ecos_agent.contracts import GUI_WORKSPACE_FLOW_STEPS


def language_for_text(value: str) -> str:
    return "zh" if re.search(r"[\u4e00-\u9fff]", value) else "en"


def welcome_message() -> str:
    return (
        "ECOS Agent is a state-controlled, PPA-oriented design-flow agent. "
        "It supports: 1. running an ECC physical-design flow; 2. rerunning a specified stage.\n\n"
        "Choose an operation. Enter 1 or 2:\n"
        "1. Run a full RTL-to-GDS flow\n"
        "2. Rerun a specified stage"
    )


def operation_prompt(language: str) -> str:
    if language == "zh":
        return "请选择操作，输入 1 或 2：\n1. 运行完整 RTL 到 GDS 流程\n2. 指定阶段重跑"
    return "Choose an operation. Enter 1 or 2:\n1. Run a full RTL-to-GDS flow\n2. Rerun a specified stage"


def project_root_prompt(language: str) -> str:
    return _prompt(
        language,
        "Project Root 是保存 flow 运行数据的 workspace 目录。请输入一个已存在的目录。",
        "What is the Project Root? Enter an existing directory that stores flow-run data.",
    )


def design_name_prompt(language: str) -> str:
    return _prompt(language, "设计名是什么？例如：gcd。", "What is the Design Name? For example: gcd.")


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
        f"是否输入 {label} 路径？留空跳过，文件后缀应为 {extension}。{suffix}",
        f"Enter the optional {label} path, or submit an empty input to skip it. Expected suffix: {extension}.{english_suffix}",
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
        f"PDK 路径是什么？留空使用推荐路径：{recommendation}",
        f"What is the PDK path? Submit an empty input to use: {recommendation}",
    )


def default_value_prompt(language: str, label: str, value: object) -> str:
    return _prompt(
        language,
        f"{label} 是什么？留空使用默认值：{value}",
        f"What is {label}? Submit an empty input to use the default: {value}",
    )


def number_prompt(language: str, label: str, value: object, lower: float, upper: float) -> str:
    return _prompt(
        language,
        f"{label} 是什么？范围 {lower:g}-{upper:g}，留空使用默认值：{value}",
        f"What is {label}? Range {lower:g}-{upper:g}; submit an empty input to use the default: {value}",
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
        "请确认：输入 1 创建 workspace 并执行流程；输入 2 取消；其他文本用于修正 spec。",
        "Confirm the specification: enter 1 to create the workspace and run the flow; enter 2 to cancel; use other text to correct the spec.",
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
    title = "选择重跑起始阶段：" if language == "zh" else "Choose the rerun start stage:"
    return "\n".join([title, *(f"{index}. {stage}" for index, stage in enumerate(stages, 1))])


def rerun_parameter_prompt(
    language: str, parameter_values: tuple[tuple[str, object], ...]
) -> str:
    title = "该阶段可修改的参数：" if language == "zh" else "Parameters available for this stage:"
    prompt = (
        "请输入要修改的参数和数值；留空则不修改参数。"
        if language == "zh"
        else "Describe the parameter change and value, or submit an empty input for no change."
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
    if language == "zh":
        return (
            "请选择执行范围：\n1. 在隔离 workspace 中重跑该阶段后停止"
            "\n2. 在隔离 workspace 中重跑该阶段，并继续执行至 flow 结束"
        )
    return (
        "Choose the execution scope:\n1. Rerun this stage in an isolated workspace, then stop"
        "\n2. Rerun this stage in an isolated workspace, then continue to the end of the flow"
    )


def source_run_prompt(language: str, run_ids: tuple[str, ...]) -> str:
    title = "选择冻结源 run：" if language == "zh" else "Choose the frozen source run:"
    return "\n".join([title, *(f"{index}. {run_id}" for index, run_id in enumerate(run_ids, 1))])


def confirmation_menu(language: str) -> str:
    return _prompt(language, "请选择：\n1. 确认并开始运行\n2. 取消", "Choose:\n1. Confirm and start\n2. Cancel")


def numbered_choice(value: str, options: tuple[str, ...]) -> str | None:
    try:
        index = int(value)
    except ValueError:
        return None
    return options[index - 1] if 1 <= index <= len(options) else None


def _prompt(language: str, chinese: str, english: str) -> str:
    return chinese if language == "zh" else english


def _parameter_value(value: object) -> str:
    if isinstance(value, str):
        return value.replace("|", "\\|")
    return json.dumps(value, ensure_ascii=True).replace("|", "\\|")
