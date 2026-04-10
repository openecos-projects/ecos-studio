#!/usr/bin/env python
# -*- encoding: utf-8 -*-

from pathlib import Path

import pytest

from ecos_server.ecc.schemas import ECCRequest
from ecos_server.ecc.services import ecc_service

# Repo root: ecos/server/tests/ -> up three levels
REPO_ROOT = Path(__file__).parent.parent.parent.parent
FIXTURES_DIR = REPO_ROOT / "ecc" / "test" / "fixtures"
PDK_ROOT = REPO_ROOT / "ecc" / "chipcompiler" / "thirdparty" / "icsprout55-pdk"


@pytest.mark.integration
def test_ics55_gcd():
    if not PDK_ROOT.is_dir():
        pytest.skip(f"ics55 pdk root not found: {PDK_ROOT}")

    workspace_dir = REPO_ROOT / "ecc" / "test" / "examples" / "ics55_gcd_service"
    input_filelist = str(FIXTURES_DIR / "gcd" / "filelist.f")

    from chipcompiler.data import get_design_parameters
    parameters = get_design_parameters("ics55", "gcd")

    ecc_serv = ecc_service()

    # set pdk root
    ecc_req = ECCRequest(
        cmd="set_pdk_root",
        data={
            "pdk": "ics55",
            "pdk_root": str(PDK_ROOT),
        },
    )
    ecc_response = ecc_serv.set_pdk_root(ecc_req)
    if ecc_response.response != "success":
        raise RuntimeError(f"set_pdk_root failed: {ecc_response.message}")

    # create workspace
    ecc_req = ECCRequest(
        cmd="create_workspace",
        data={
            "directory": str(workspace_dir),
            "pdk": "ics55",
            "pdk_root": str(PDK_ROOT),
            "parameters": parameters.data,
            "origin_def": "",
            "origin_verilog": "",
            "filelist": input_filelist,
        },
    )
    ecc_serv.create_workspace(ecc_req)

    # run rtl2gds
    ecc_req = ECCRequest(
        cmd="rtl2gds",
        data={"rerun": True},
    )
    ecc_serv.rtl2gds(ecc_req)
