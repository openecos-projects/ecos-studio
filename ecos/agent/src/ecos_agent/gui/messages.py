"""Choice messages for the deterministic ECOS Agent GUI wizard."""

import json
from typing import Any

from ecos_agent.gui.message_prompts import *  # noqa: F403
from ecos_agent.gui.message_prompts import (
    EMPTY_CHOICE_VALUE,
    _choice,
    _parameter_value,
    _prompt,
)
from ecos_agent.workspace.contracts import GUI_WORKSPACE_FLOW_STEPS


def workspace_signoff_choice(language: str, prompt_id: str) -> dict[str, Any]:
    return _choice(
        prompt_id,
        _prompt(language, "导出 signoff 包？", "Export signoff package?"),
        (
            _prompt(language, "导出 signoff 包", "Export signoff package"),
            _prompt(language, "取消", "Cancel"),
        ),
        variant="buttons",
        allow_free_text=False,
    )


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
            (
                _prompt(
                    language,
                    "启动受约束优化 episode",
                    "Start a bounded optimization episode",
                ),
                "2",
            ),
            (
                _prompt(
                    language,
                    "Quick Start：创建 Workspace 并运行完整 RTL 到 GDS 流程",
                    "Quick Start: create a Workspace and run a full RTL-to-GDS flow",
                ),
                "3",
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
        options.append(
            _prompt(
                language,
                "启动受约束优化 episode",
                "Start a bounded optimization episode",
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


def optimization_authorization_prompt(language: str, workspace: str) -> str:
    return _prompt(
        language,
        f"将对当前 workspace 启动有预算、可暂停、可回放的优化 episode：{workspace}\n"
        "Codex 只能提出一个类型化 knob 方向；本地 controller 和固定 ECC RPC 才能执行。"
        "请确认开始，或取消。",
        f"Start a bounded, pausable, replayable optimization episode for this workspace: {workspace}\n"
        "Codex may propose only one typed knob direction; the local controller and fixed ECC RPC own execution. "
        "Confirm to start, or cancel.",
    )


def optimization_started_message(language: str) -> str:
    return _prompt(
        language,
        "优化 episode 已确认并启动；GUI 将持续报告 proposal、candidate 终态、incumbent 和审计状态。",
        "The optimization episode is authorized and running; the GUI will report proposals, candidate terminals, incumbent decisions, and audit state.",
    )


def project_mode_choice(language: str, prompt_id: str) -> dict[str, Any]:
    choice = _choice(
        prompt_id,
        _prompt(language, "选择 Project", "Choose a Project"),
        (
            _prompt(language, "使用已有 Project", "Use an existing Project"),
            _prompt(language, "新建 Project", "Create a new Project"),
        ),
        variant="list",
    )
    choice["description"] = project_mode_prompt(language)
    return choice


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
        "description": _prompt(
            language,
            "请选择已有 Project，或输入其他 Project 根目录。",
            "Choose an existing Project, or enter another Project Root.",
        ),
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
    choice = _choice(
        prompt_id,
        _prompt(language, "SoC-MPC 模板", "SoC-MPC template"),
        (
            _prompt(language, "使用 SoC-MPC 模板", "Use a SoC-MPC template"),
            _prompt(language, "不使用 SoC-MPC 模板", "Do not use a SoC-MPC template"),
        ),
        variant="buttons",
    )
    choice["description"] = _prompt(
        language,
        "SoC-MPC 模板提供顶层 die/core 尺寸、I/O 引脚和核心约束，帮助流程按选定的芯片模板进行布局；不使用则按普通 RTL-to-GDS 流程继续。",
        "A SoC-MPC template provides top-level die/core geometry, I/O pins, and core constraints so the flow can use the selected chip template; without it, the flow continues as a standard RTL-to-GDS run.",
    )
    return choice


def recommended_path_choice(
    language: str,
    prompt_id: str,
    recommendation: str = "",
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
            ((_prompt(language, "使用推荐路径", "Use recommended path"), recommendation),)
            if recommendation
            else ()
        ),
    )


def default_value_choice(
    language: str, prompt_id: str, label: str, value: object
) -> dict[str, Any]:
    if value == "":
        return _choice(
            prompt_id,
            label,
            (),
            variant="buttons",
            allow_free_text=True,
        )
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
