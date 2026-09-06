"""Read ECOS workspace parameter config with ECC-compatible precedence."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from typing import Any

PARAMETERS_JSON = "home/parameters.json"
PARAMS_TOML = "home/params.toml"
_DESIGN_SECTION_KEYS = {
    "design": "name",
    "top_module": "top",
    "clock": "clock_port",
    "frequency_max": "frequency_mhz",
}
_PDK_SECTION_KEYS = {
    "pdk": "name",
    "pdk_root": "root",
    "pdk_config": "config",
}
_UNIT_SUFFIX = re.compile(r"\[[^\]]*\]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


class WorkspaceParametersError(ValueError):
    """Workspace parameter evidence is missing, unsafe, or malformed."""


def read_workspace_parameters(root: Path) -> tuple[str, dict[str, Any]]:
    if _path_present(root, PARAMS_TOML):
        return PARAMS_TOML, _read_params_toml(root, PARAMS_TOML)
    if _path_present(root, PARAMETERS_JSON):
        return PARAMETERS_JSON, _normalize_mapping(_read_json(root, PARAMETERS_JSON))
    raise WorkspaceParametersError("workspace parameter evidence is unavailable")


def _read_json(root: Path, relative_path: str) -> dict[str, Any]:
    path = _safe_file(root, relative_path)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkspaceParametersError("workspace parameter JSON is invalid") from exc
    if not isinstance(value, dict):
        raise WorkspaceParametersError("workspace parameter JSON must be an object")
    return value


def _read_params_toml(root: Path, relative_path: str) -> dict[str, Any]:
    path = _safe_file(root, relative_path)
    try:
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise WorkspaceParametersError("workspace parameter TOML is invalid") from exc
    if not isinstance(payload, dict):
        raise WorkspaceParametersError("workspace parameter TOML must be an object")
    for section_name in ("params", "design", "pdk"):
        section = payload.get(section_name)
        if section is not None and not isinstance(section, dict):
            raise WorkspaceParametersError(
                f"workspace parameter [{section_name}] is invalid"
            )
    result = _normalize_mapping(payload.get("params") or {})
    for mapping, section_name in (
        (_DESIGN_SECTION_KEYS, "design"),
        (_PDK_SECTION_KEYS, "pdk"),
    ):
        section = payload.get(section_name) or {}
        for parameter_key, section_key in mapping.items():
            value = section.get(section_key)
            if value is not None and (not isinstance(value, str) or value.strip()):
                result[parameter_key] = value
    return result


def _normalize_mapping(payload: dict[object, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in payload.items():
        canonical = _NON_ALNUM.sub(
            "_", _UNIT_SUFFIX.sub("", str(key)).strip().lower()
        ).strip("_")
        if canonical in result and str(key) == canonical:
            continue
        result[canonical] = _normalize_value(value)
    return result


def _normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _normalize_mapping(value)
    if isinstance(value, list):
        return [_normalize_value(item) for item in value]
    return value


def _safe_file(root: Path, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise WorkspaceParametersError("workspace parameter path is unsafe")
    path = root
    for part in relative.parts:
        path /= part
        if path.is_symlink():
            raise WorkspaceParametersError(
                "workspace parameter path is unsafe or unavailable"
            )
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root.resolve())
    except (OSError, ValueError) as exc:
        raise WorkspaceParametersError(
            "workspace parameter path is unsafe or unavailable"
        ) from exc
    if root.is_symlink() or not resolved.is_file():
        raise WorkspaceParametersError(
            "workspace parameter path is unsafe or unavailable"
        )
    return resolved


def _path_present(root: Path, relative_path: str) -> bool:
    path = root / relative_path
    return path.exists() or path.is_symlink()
