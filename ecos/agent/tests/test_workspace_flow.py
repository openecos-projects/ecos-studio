from pathlib import Path

import pytest

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.gui.session import ProviderSession
from ecos_agent.gui.workspace_flow import WorkspaceFlow
from ecos_agent.workspace.rerun import GuiWorkspaceRerunContract


def _rerun_contract(tmp_path: Path) -> GuiWorkspaceRerunContract:
    return GuiWorkspaceRerunContract(
        source_workspace=str(tmp_path / "source"),
        target_workspace=str(tmp_path / "target"),
        rerun_id="rerun-1",
        design_id="gcd",
        target_step=ECCStepName.PLACEMENT,
        end_step=ECCStepName.HARDEN,
        execution_scope="full_flow",
        source_flow_json_sha256="0" * 64,
        source_stage_artifact="place_tool/output/gcd_place.def.gz",
        source_stage_artifact_sha256="1" * 64,
    )


def test_workspace_flow_validates_pending_rerun_result(tmp_path: Path) -> None:
    session = ProviderSession(session_id="session-1")
    session.workspace_rerun_contract = _rerun_contract(tmp_path)
    flow = WorkspaceFlow(session)

    result = flow.rerun_result(
        'workspace_rerun_result:{"rerun_id":"rerun-1","status":"succeeded",'
        '"error":"","end_step":"Harden"}'
    )

    assert result.status == "succeeded"
    assert result.end_step == "Harden"
    with pytest.raises(ValueError, match="does not match"):
        flow.rerun_result(
            'workspace_rerun_result:{"rerun_id":"other","status":"succeeded",'
            '"error":""}'
        )


def test_workspace_flow_uses_public_patch_validation() -> None:
    session = ProviderSession(session_id="session-1")

    WorkspaceFlow(session).validate_parameter_patch(
        [{"knob_id": "place.target_density", "value": 0.7}],
        {"place.target_density": 0.75},
    )

    with pytest.raises(ValueError, match="not available"):
        WorkspaceFlow(session).validate_parameter_patch(
            [{"knob_id": "unknown", "value": 1}],
            {"place.target_density": 0.75},
        )
