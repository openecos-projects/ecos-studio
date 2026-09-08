from pathlib import Path

from chipcompiler.cli import main as cli_main
from ecos_runtime_adapter.requests import (
    FlowRunRequest,
    ProjectManifestMutationRequest,
    WorkspaceIdRequest,
    WorkspaceSpecCreateRequest,
    WorkspaceSpecOpenRequest,
)
from ecos_runtime_adapter.workspace_api import WorkspaceRuntimeApi


class SuccessfulFlow:
    def __init__(self, workspace):
        self.workspace = workspace
        self.engine_db = None
        self.workspace_steps = []

    def has_init(self):
        return True

    def add_step(self, **_kwargs):
        return None

    def create_step_workspaces(self, **_kwargs):
        return None

    def run_steps(self, **_kwargs):
        return True


def _spec():
    return {
        "schemaVersion": 1,
        "design": {"name": "gcd", "topModule": "gcd", "clockPort": "clk"},
        "inputMode": "rtl",
        "inputs": [{"inputId": "rtl-main", "role": "rtl"}],
        "pdk": {
            "familyId": "ics55",
            "mode": "manual",
            "files": [
                {"fileId": "tech", "role": "tech"},
                {"fileId": "cells", "role": "lef"},
                {"fileId": "lib", "role": "liberty"},
            ],
        },
        "flow": {"flowId": "syn_sta"},
        "parameters": {"design.frequency_mhz": 100.0},
    }


def _bindings(tmp_path: Path, pdk_root: Path):
    rtl = tmp_path / "gcd.v"
    rtl.write_text("module gcd(input clk); endmodule\n")
    return {
        "inputs": {"rtl-main": str(rtl)},
        "pdk": {
            "root": str(pdk_root),
            "files": {
                "tech": str(pdk_root / "tech.lef"),
                "cells": str(pdk_root / "cells.lef"),
                "lib": str(pdk_root / "typ.lib"),
            },
        },
    }


def _manual_pdk(root: Path) -> Path:
    root.mkdir()
    for name in ("tech.lef", "cells.lef", "typ.lib"):
        (root / name).write_text(name)
    return root


def test_cli_create_runtime_open_and_run(
    monkeypatch, tmp_path, minimal_ics55_pdk_factory
):
    monkeypatch.setattr("chipcompiler.engine.EngineFlow", SuccessfulFlow)
    project = tmp_path / "cli-project"
    pdk_root = minimal_ics55_pdk_factory(tmp_path / "cli-pdk")
    assert cli_main.run(["init", str(project), "--plain"]) == 0
    (project / "rtl" / "cli-project.v").write_text(
        "module cli_project(input clk); endmodule\n"
    )
    config = (project / "ecc.toml").read_text()
    (project / "ecc.toml").write_text(
        config.replace('root = ""', f'root = "{pdk_root}"')
    )

    assert cli_main.run(["run", "--project", str(project), "--plain"]) == 0
    workspace = project / "default"
    api = WorkspaceRuntimeApi()
    opened = api.open_workspace(
        WorkspaceSpecOpenRequest(
            directory=str(workspace),
            workspace_bindings={"inputs": {}, "pdk": {"root": str(pdk_root)}},
        )
    )

    assert api.flow_run(
        FlowRunRequest(
            workspace_id=opened["workspaceId"],
            expected_workspace_revision=opened["workspaceRevision"],
        )
    ) == {"rerun": False}


def test_runtime_create_without_project_config_cli_discovers_opens_and_runs(
    monkeypatch, tmp_path
):
    monkeypatch.setattr("chipcompiler.engine.EngineFlow", SuccessfulFlow)
    project = tmp_path / "studio-project"
    project.mkdir()
    workspace = project / "runs" / "experiment"
    pdk_root = _manual_pdk(tmp_path / "studio-pdk")
    bindings = _bindings(tmp_path, pdk_root)
    api = WorkspaceRuntimeApi()
    manifest = api.mutate_project_manifest(
        ProjectManifestMutationRequest(
            project_root=str(project),
            mutation={"type": "create", "name": "Studio", "designName": "gcd"},
        )
    )
    created = api.create_workspace(
        WorkspaceSpecCreateRequest(
            command_id="studio-create-1",
            target_directory=str(workspace),
            workspace_spec=_spec(),
            workspace_bindings=bindings,
            project_id=manifest["project_id"],
            project_root=str(project),
        )
    )

    assert not (project / "ecc.toml").exists()
    assert cli_main.run(["status", "--project", str(project), "--plain"]) == 0
    api.close_workspace(WorkspaceIdRequest(workspace_id=created["workspaceId"]))
    assert cli_main.run(["run", "--project", str(project), "--plain"]) == 0
