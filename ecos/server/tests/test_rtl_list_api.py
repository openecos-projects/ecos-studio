#!/usr/bin/env python

from ecos_server.ecc.schemas import ECCRequest
from ecos_server.ecc.services import ECCService


def _write_rtl(path, module_name):
    path.write_text(f"module {module_name}(); endmodule\n")
    return path


def _default_parameters():
    return {
        "Design": "test",
        "Top module": "top",
        "Clock": "clk",
        "Frequency max [MHz]": 100,
        "PDK": "ics55",
    }


def test_create_workspace_from_rtl_list_string(tmp_path):
    workspace_dir = tmp_path / "workspace"
    rtl_dir = tmp_path / "rtl"
    rtl_dir.mkdir()

    file_a = _write_rtl(rtl_dir / "a.v", "a")
    file_b = _write_rtl(rtl_dir / "b.v", "b")

    spaced_dir = tmp_path / "rtl space"
    spaced_dir.mkdir()
    file_c = _write_rtl(spaced_dir / "c.v", "c")

    rtl_list = "\n".join([str(file_a), str(file_b), str(file_c)])

    ecc_serv = ECCService()
    req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "parameters": _default_parameters(),
            "origin_def": "",
            "origin_verilog": "",
            "rtl_list": rtl_list,
        },
    )
    resp = ecc_serv.create_workspace(req)

    assert resp.response == "success"

    origin_filelist = workspace_dir / "origin" / "filelist"
    assert origin_filelist.exists()

    content = origin_filelist.read_text().splitlines()
    assert content == [
        str(file_a),
        str(file_b),
        f'"{file_c}"',
    ]

    assert (workspace_dir / "origin" / "a.v").exists()
    assert (workspace_dir / "origin" / "b.v").exists()
    assert (workspace_dir / "origin" / "c.v").exists()


def test_create_workspace_from_rtl_list_array(tmp_path):
    workspace_dir = tmp_path / "workspace"
    rtl_dir = tmp_path / "rtl"
    rtl_dir.mkdir()

    file_a = _write_rtl(rtl_dir / "a.v", "a")
    file_b = _write_rtl(rtl_dir / "b.v", "b")

    ecc_serv = ECCService()
    req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "parameters": _default_parameters(),
            "origin_def": "",
            "origin_verilog": "",
            "rtl_list": [str(file_a), str(file_b)],
        },
    )
    resp = ecc_serv.create_workspace(req)

    assert resp.response == "success"
    assert (workspace_dir / "origin" / "filelist").exists()
    assert (workspace_dir / "origin" / "a.v").exists()
    assert (workspace_dir / "origin" / "b.v").exists()
