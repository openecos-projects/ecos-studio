"""PDK path option assembly for the workspace setup wizard."""

from __future__ import annotations

from pathlib import Path

from ecos_agent.gui.message_prompts import _prompt
from ecos_agent.gui.session import ProviderSession
from ecos_agent.workspace.setup import display_path


def _pdk_choice_options(session: ProviderSession) -> tuple[tuple[str, str], ...]:
    """(label, path) options for the workspace PDK step.

    Combines the locally discovered recommendation with the host-supplied PDK
    inventory (Resource Manager downloads and local imports), deduplicated by
    resolved path and capped at the interaction option budget.
    """
    options: list[tuple[str, str]] = []
    seen: set[str] = set()
    recommendation = session.path_recommendations.get("pdk", "")
    if recommendation:
        seen.add(_resolved_pdk_option_path(recommendation))
        label = _prompt(
            session.language,
            f"使用推荐路径：{display_path(recommendation)}",
            f"Use recommended path: {display_path(recommendation)}",
        )
        options.append((label, recommendation))
    for name, path, source in session.pdk_installations:
        resolved = _resolved_pdk_option_path(path)
        if resolved in seen:
            continue
        seen.add(resolved)
        source_label = _prompt(session.language, "Resource Manager", "Resource Manager")
        if source == "imported":
            source_label = _prompt(session.language, "本地", "Local")
        label = _prompt(
            session.language,
            f"{name}（{source_label}）：{display_path(path)}",
            f"{name} ({source_label}): {display_path(path)}",
        )
        options.append((label, path))
        if len(options) >= 32:
            break
    return tuple(options)


def _resolved_pdk_option_path(path: str) -> str:
    try:
        return str(Path(path).expanduser().resolve())
    except OSError:
        return path
