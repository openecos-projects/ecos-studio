from pathlib import Path

import pytest

from ecos_agent.workspace.contracts import GUI_WORKSPACE_FLOW_STEPS
from ecos_agent.ecc_contracts import ECCParameterPatch, ECCStepName
from ecos_agent.workspace.knob_registry import knob_spec
from ecos_agent.workspace.authorization import authorized_knobs_for_step
from ecos_agent.workspace.rerun import GuiWorkspaceRerunResolver, GuiWorkspaceRerunSource


def test_gui_workspace_flow_steps_are_the_ecc_catalog_in_order() -> None:
    assert GUI_WORKSPACE_FLOW_STEPS == tuple(step.value for step in ECCStepName)
    assert GUI_WORKSPACE_FLOW_STEPS == (
        "Synthesis",
        "Floorplan",
        "place",
        "CTS",
        "legalization",
        "Timing optimization",
        "route",
        "drc",
        "lvs",
        "filler",
        "RCX",
        "sta",
        "Harden",
    )


def test_floorplan_alias_does_not_expand_workspace_authority() -> None:
    authorized = authorized_knobs_for_step(ECCStepName.FLOORPLAN)

    assert isinstance(authorized, frozenset)
    assert "floorplan.utilitization" in authorized
    assert "floorplan.core_util" not in authorized
    assert knob_spec("floorplan.core_util") is knob_spec("floorplan.utilitization")


def test_public_patch_validation_preserves_workspace_rerun_contract(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    source = GuiWorkspaceRerunSource(
        workspace_path=workspace,
        design_id="gcd",
        flow_json_sha256="0" * 64,
        end_step=ECCStepName.FLOORPLAN,
        allowed_stages=("Floorplan",),
        stage_artifact_ref={"Floorplan": "Floorplan_ipl/output/gcd_Floorplan.def.gz"},
        stage_artifact_sha256={"Floorplan": "1" * 64},
    )
    items = [{"knob_id": "floorplan.utilitization", "value": 0.7}]

    patch = GuiWorkspaceRerunResolver.validate_patch("Floorplan", items)
    contract = GuiWorkspaceRerunResolver(tmp_path).freeze(
        source, "Floorplan", items, "full_flow"
    )

    assert isinstance(patch, ECCParameterPatch)
    assert contract.model_dump(mode="json") == {
        "schema_version": "flow-agent.workspace_rerun_contract.v1",
        "source_workspace": str(workspace),
        "target_workspace": str(tmp_path / "gcd_rerun_floorplan"),
        "rerun_id": "gcd_rerun_floorplan",
        "design_id": "gcd",
        "target_step": "Floorplan",
        "end_step": "Harden",
        "execution_scope": "full_flow",
        "source_flow_json_sha256": "0" * 64,
        "source_stage_artifact": "Floorplan_ipl/output/gcd_Floorplan.def.gz",
        "source_stage_artifact_sha256": "1" * 64,
        "parameter_patch": [{"knob_id": "floorplan.utilitization", "value": 0.7}],
        "writes": [
            {
                "knob_id": "floorplan.utilitization",
                "value": 0.7,
                "surface": "parameters",
                "file": "home/parameters.json",
                "json_path": ["Core", "Utilitization"],
            }
        ],
        "requires_gui_review": True,
    }


def test_core_util_alias_remains_unauthorized_for_workspace_rerun() -> None:
    with pytest.raises(ValueError, match="not authorized"):
        GuiWorkspaceRerunResolver.validate_patch(
            "Floorplan", [{"knob_id": "floorplan.core_util", "value": 0.7}]
        )
