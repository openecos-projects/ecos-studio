from pathlib import Path

import pytest

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.workspace.contracts import GUI_WORKSPACE_FLOW_STEPS
from ecos_agent.workspace.setup import (
    WorkspaceInputs,
    recommended_workspace_setup,
    workspace_setup_contract,
)


def test_workspace_setup_and_rerun_share_the_default_post_route_order() -> None:
    expected = (
        "routing",
        "filler",
        "lvs",
        "drc",
        "antenna_check",
        "post_route_lec",
        "rcx",
        "sta",
        "power_analysis",
        "emir",
        "harden",
    )
    assert GUI_WORKSPACE_FLOW_STEPS[GUI_WORKSPACE_FLOW_STEPS.index("routing") :] == expected
    rerun_steps = tuple(step.value for step in ECCStepName)
    assert rerun_steps[rerun_steps.index("routing") :] == expected


@pytest.mark.parametrize(
    ("end_step", "expected_steps"),
    [
        ("lvs", ["routing", "filler", "lvs"]),
        (
            "post_route_lec",
            ["routing", "filler", "lvs", "drc", "antenna_check", "post_route_lec"],
        ),
        (
            "power_analysis",
            [
                "routing",
                "filler",
                "lvs",
                "drc",
                "antenna_check",
                "post_route_lec",
                "rcx",
                "sta",
                "power_analysis",
            ],
        ),
    ],
)
def test_workspace_setup_contract_uses_contiguous_post_route_ranges(
    tmp_path: Path, end_step: str, expected_steps: list[str]
) -> None:
    rtl = tmp_path / "gcd.v"
    rtl.write_text("module gcd(input clk); endmodule\n", encoding="utf-8")
    pdk = tmp_path / "pdk"
    pdk.mkdir()
    proposal = recommended_workspace_setup().model_copy(
        update={
            "workspace_name": "signoff",
            "design_name": "gcd",
            "top_module": "gcd",
            "flow_start": "routing",
            "flow_end": end_step,
        }
    )
    inputs = WorkspaceInputs(project_root=str(tmp_path), rtl_path=str(rtl), pdk_root=str(pdk))

    contract = workspace_setup_contract(proposal, inputs, "en", "setup-signoff")

    assert contract["flow_config"] == {
        "start_step": "routing",
        "end_step": end_step,
        "steps": expected_steps,
    }
