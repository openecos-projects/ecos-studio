#!/usr/bin/env python

from types import SimpleNamespace

from ecos_server.ecc.schemas import ECCRequest
from ecos_server.ecc.services import ECCService
from ecos_server.resource.inventory import InventoryService


def _default_parameters() -> dict:
    return {
        "PDK": "ics55",
        "Design": "gcd",
        "Top module": "gcd",
        "Clock": "clk",
        "Frequency max [MHz]": 100,
    }


def test_set_pdk_root_success(tmp_path, monkeypatch):
    root_dir = tmp_path / "ics55"
    root_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.delenv("CHIPCOMPILER_ICS55_PDK_ROOT", raising=False)

    monkeypatch.setattr(
        "chipcompiler.data.get_pdk",
        lambda pdk_name, pdk_root: SimpleNamespace(name=pdk_name, root=str(root_dir.resolve())),
    )

    service = ECCService()
    request = ECCRequest(
        cmd="set_pdk_root",
        data={
            "pdk": "ics55",
            "pdk_root": str(root_dir),
        },
    )

    response = service.set_pdk_root(request)

    assert response.response == "success"
    assert response.data["pdk"] == "ics55"
    assert response.data["env_key"] == "CHIPCOMPILER_ICS55_PDK_ROOT"
    assert response.data["pdk_root"] == str(root_dir.resolve())
    assert response.data["resolved_pdk_root"] == str(root_dir.resolve())
    assert __import__("os").environ["CHIPCOMPILER_ICS55_PDK_ROOT"] == str(root_dir.resolve())


def test_set_pdk_root_invalid_directory_returns_failed(tmp_path):
    bad_dir = tmp_path / "not-exist"
    service = ECCService()
    request = ECCRequest(
        cmd="set_pdk_root",
        data={
            "pdk": "ics55",
            "pdk_root": str(bad_dir),
        },
    )

    response = service.set_pdk_root(request)

    assert response.response == "failed"
    assert "not a directory" in response.message[0]


def test_set_pdk_root_rejects_invalid_pdk_before_env_mutation(tmp_path, monkeypatch):
    root_dir = tmp_path / "not-a-real-ics55"
    root_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CHIPCOMPILER_ICS55_PDK_ROOT", "/previous/root")

    service = ECCService()
    request = ECCRequest(
        cmd="set_pdk_root",
        data={
            "pdk": "ics55",
            "pdk_root": str(root_dir),
        },
    )

    response = service.set_pdk_root(request)

    assert response.response == "error"
    assert "set pdk root error" in response.message[0]
    assert "PDK validation failed" in response.message[0]
    assert response.data["pdk_root"] == str(root_dir)
    assert "resolved_pdk_root" not in response.data
    assert "CHIPCOMPILER_ICS55_PDK_ROOT" in response.data["env_key"]
    assert __import__("os").environ["CHIPCOMPILER_ICS55_PDK_ROOT"] == "/previous/root"


def test_set_pdk_root_rejects_invalid_pdk_before_workspace_mutation(tmp_path, monkeypatch):
    root_dir = tmp_path / "not-a-real-ics55"
    root_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CHIPCOMPILER_ICS55_PDK_ROOT", "/previous/root")

    service = ECCService()
    service.workspace = SimpleNamespace(
        pdk=SimpleNamespace(name="ics55"),
        parameters=SimpleNamespace(data={"PDK Root": "/workspace/original"}),
    )
    request = ECCRequest(
        cmd="set_pdk_root",
        data={
            "pdk": "ics55",
            "pdk_root": str(root_dir),
        },
    )

    response = service.set_pdk_root(request)

    assert response.response == "error"
    assert service.workspace.parameters.data["PDK Root"] == "/workspace/original"
    assert __import__("os").environ["CHIPCOMPILER_ICS55_PDK_ROOT"] == "/previous/root"


def test_create_workspace_uses_env_set_by_set_pdk_root(tmp_path, monkeypatch):
    root_dir = tmp_path / "ics55"
    root_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.delenv("CHIPCOMPILER_ICS55_PDK_ROOT", raising=False)
    monkeypatch.setattr(
        "chipcompiler.data.get_pdk",
        lambda pdk_name, pdk_root: SimpleNamespace(name=pdk_name, root=str(root_dir.resolve())),
    )

    workspace_dir = tmp_path / "workspace"
    rtl_file = tmp_path / "gcd.v"
    rtl_file.write_text("module gcd(input clk, output y); assign y = clk; endmodule\n")

    service = ECCService()
    set_req = ECCRequest(
        cmd="set_pdk_root",
        data={
            "pdk": "ics55",
            "pdk_root": str(root_dir),
        },
    )
    set_resp = service.set_pdk_root(set_req)
    assert set_resp.response == "success"

    captured: dict = {}

    def fake_create_workspace(**kwargs):
        captured.update(kwargs)
        workspace_dir = kwargs["directory"]
        return SimpleNamespace(
            directory=workspace_dir,
            pdk=SimpleNamespace(name=kwargs["pdk"]),
            parameters=SimpleNamespace(data={"PDK Root": kwargs["pdk_root"]}),
        )

    monkeypatch.setattr("chipcompiler.data.create_workspace", fake_create_workspace)
    monkeypatch.setattr(ECCService, "_ECCService__build_flow", lambda self: None)

    create_req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "parameters": _default_parameters(),
            "origin_def": "",
            "origin_verilog": str(rtl_file),
            "rtl_list": "",
        },
    )

    create_resp = service.create_workspace(create_req)
    assert create_resp.response == "success"
    assert captured["pdk_root"] == str(root_dir.resolve())


def test_create_workspace_uses_active_resource_manager_pdk(tmp_path, monkeypatch):
    pdk_root = tmp_path / "active-pdk"
    pdk_root.mkdir(parents=True, exist_ok=True)
    manifest = tmp_path / "state" / "ecos-studio" / "resources" / "manifest.json"
    inventory = InventoryService(resource_manifest_path=manifest)
    inventory.add_or_update_pdk("ics55", canonical_path=str(pdk_root))
    inventory.set_pdk_active("ics55", True)
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    monkeypatch.delenv("CHIPCOMPILER_ICS55_PDK_ROOT", raising=False)
    monkeypatch.setattr(
        "chipcompiler.data.get_pdk",
        lambda pdk_name, pdk_root: SimpleNamespace(name=pdk_name, root=str(pdk_root)),
    )

    captured: dict = {}

    def fake_create_workspace(**kwargs):
        captured.update(kwargs)
        workspace_dir = kwargs["directory"]
        return SimpleNamespace(
            directory=workspace_dir,
            pdk=SimpleNamespace(name=kwargs["pdk"]),
            parameters=SimpleNamespace(data={"PDK Root": kwargs["pdk_root"]}),
        )

    monkeypatch.setattr("chipcompiler.data.create_workspace", fake_create_workspace)
    monkeypatch.setattr(ECCService, "_ECCService__build_flow", lambda self: None)

    workspace_dir = tmp_path / "workspace"
    rtl_file = tmp_path / "gcd.v"
    rtl_file.write_text("module gcd(input clk, output y); assign y = clk; endmodule\n")

    service = ECCService()
    create_req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "parameters": _default_parameters(),
            "origin_def": "",
            "origin_verilog": str(rtl_file),
            "rtl_list": "",
        },
    )

    create_resp = service.create_workspace(create_req)

    assert create_resp.response == "success"
    assert captured["pdk_root"] == str(pdk_root.resolve())


def test_create_workspace_falls_back_to_env_when_active_resource_manager_pdk_invalid(
    tmp_path, monkeypatch
):
    active_root = tmp_path / "ics55"
    env_root = tmp_path / "valid-env-pdk"
    active_root.mkdir(parents=True, exist_ok=True)
    env_root.mkdir(parents=True, exist_ok=True)
    manifest = tmp_path / "state" / "ecos-studio" / "resources" / "manifest.json"
    inventory = InventoryService(resource_manifest_path=manifest)
    inventory.add_or_update_pdk("ics55", canonical_path=str(active_root))
    inventory.set_pdk_active("ics55", True)
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    monkeypatch.setenv("CHIPCOMPILER_ICS55_PDK_ROOT", str(env_root))

    def fake_get_pdk(pdk_name, pdk_root):
        if str(pdk_root) == str(active_root.resolve()):
            raise ValueError("PDK validation failed")
        return SimpleNamespace(name=pdk_name, root=str(pdk_root))

    monkeypatch.setattr("chipcompiler.data.get_pdk", fake_get_pdk)

    captured: dict = {}

    def fake_create_workspace(**kwargs):
        captured.update(kwargs)
        workspace_dir = kwargs["directory"]
        return SimpleNamespace(
            directory=workspace_dir,
            pdk=SimpleNamespace(name=kwargs["pdk"]),
            parameters=SimpleNamespace(data={"PDK Root": kwargs["pdk_root"]}),
        )

    monkeypatch.setattr("chipcompiler.data.create_workspace", fake_create_workspace)
    monkeypatch.setattr(ECCService, "_ECCService__build_flow", lambda self: None)

    workspace_dir = tmp_path / "workspace-env-fallback"
    rtl_file = tmp_path / "gcd.v"
    rtl_file.write_text("module gcd(input clk, output y); assign y = clk; endmodule\n")

    service = ECCService()
    create_req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "parameters": _default_parameters(),
            "origin_def": "",
            "origin_verilog": str(rtl_file),
            "rtl_list": "",
        },
    )

    create_resp = service.create_workspace(create_req)

    assert create_resp.response == "success"
    assert captured["pdk_root"] == str(env_root.resolve())


def test_create_workspace_explicit_pdk_root_overrides_active_resource_manager_pdk(
    tmp_path, monkeypatch
):
    active_root = tmp_path / "active-pdk"
    explicit_root = tmp_path / "explicit-pdk"
    active_root.mkdir(parents=True, exist_ok=True)
    explicit_root.mkdir(parents=True, exist_ok=True)
    manifest = tmp_path / "state" / "ecos-studio" / "resources" / "manifest.json"
    inventory = InventoryService(resource_manifest_path=manifest)
    inventory.add_or_update_pdk("ics55", canonical_path=str(active_root))
    inventory.set_pdk_active("ics55", True)
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))

    captured: dict = {}

    def fake_create_workspace(**kwargs):
        captured.update(kwargs)
        workspace_dir = kwargs["directory"]
        return SimpleNamespace(
            directory=workspace_dir,
            pdk=SimpleNamespace(name=kwargs["pdk"]),
            parameters=SimpleNamespace(data={"PDK Root": kwargs["pdk_root"]}),
        )

    monkeypatch.setattr("chipcompiler.data.create_workspace", fake_create_workspace)
    monkeypatch.setattr(ECCService, "_ECCService__build_flow", lambda self: None)

    workspace_dir = tmp_path / "workspace-explicit"
    rtl_file = tmp_path / "gcd.v"
    rtl_file.write_text("module gcd(input clk, output y); assign y = clk; endmodule\n")

    service = ECCService()
    create_req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "pdk_root": str(explicit_root),
            "parameters": _default_parameters(),
            "origin_def": "",
            "origin_verilog": str(rtl_file),
            "rtl_list": "",
        },
    )

    create_resp = service.create_workspace(create_req)

    assert create_resp.response == "success"
    assert captured["pdk_root"] == str(explicit_root)
