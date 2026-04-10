#!/usr/bin/env python

import json

from ecos_server.ecc.schemas import ECCRequest
from ecos_server.ecc.services import ECCService


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


def test_create_workspace_uses_env_set_by_set_pdk_root(tmp_path, monkeypatch):
    root_dir = tmp_path / "ics55"
    root_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.delenv("CHIPCOMPILER_ICS55_PDK_ROOT", raising=False)

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

    parameters = json.loads((workspace_dir / "parameters.json").read_text())
    assert parameters.get("PDK Root") == str(root_dir.resolve())
