from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.workspace.parameters import (
    WorkspaceParametersError,
    read_workspace_parameters,
)


def test_workspace_parameters_prefers_and_flattens_canonical_toml(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "parameters.json").write_text(
        json.dumps({"Design": "stale", "PDK Root": "/stale"}),
        encoding="utf-8",
    )
    (home / "params.toml").write_text(
        """
[design]
name = "gcd"

[pdk]
root = "/pdk"

[params.core]
utilitization = 0.3
aspect_ratio = 1.0
""".strip(),
        encoding="utf-8",
    )

    reference, parameters = read_workspace_parameters(tmp_path)

    assert reference == "home/params.toml"
    assert parameters == {
        "core": {"utilitization": 0.3, "aspect_ratio": 1.0},
        "design": "gcd",
        "pdk_root": "/pdk",
    }


def test_workspace_parameters_normalizes_legacy_json(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "parameters.json").write_text(
        json.dumps(
            {
                "Design": "gcd",
                "PDK Root": "/pdk",
                "Core": {"Utilitization": 0.3, "Aspect ratio": 1.0},
            }
        ),
        encoding="utf-8",
    )

    reference, parameters = read_workspace_parameters(tmp_path)

    assert reference == "home/parameters.json"
    assert parameters == {
        "design": "gcd",
        "pdk_root": "/pdk",
        "core": {"utilitization": 0.3, "aspect_ratio": 1.0},
    }


def test_workspace_parameters_rejects_preferred_toml_symlink(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "parameters.json").write_text('{"Design":"gcd"}\n', encoding="utf-8")
    outside = tmp_path / "outside.toml"
    outside.write_text('[params]\ndesign = "outside"\n', encoding="utf-8")
    (home / "params.toml").symlink_to(outside)

    with pytest.raises(WorkspaceParametersError, match="unsafe or unavailable"):
        read_workspace_parameters(tmp_path)


def test_workspace_parameters_rejects_invalid_toml_section(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "params.toml").write_text('params = "invalid"\n', encoding="utf-8")

    with pytest.raises(WorkspaceParametersError, match=r"\[params\] is invalid"):
        read_workspace_parameters(tmp_path)


def test_workspace_parameters_rejects_symlinked_home(tmp_path: Path) -> None:
    outside_home = tmp_path / "outside-home"
    outside_home.mkdir()
    (outside_home / "params.toml").write_text(
        '[params]\ndesign = "outside"\n', encoding="utf-8"
    )
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "home").symlink_to(outside_home, target_is_directory=True)

    with pytest.raises(WorkspaceParametersError, match="unsafe or unavailable"):
        read_workspace_parameters(workspace)
