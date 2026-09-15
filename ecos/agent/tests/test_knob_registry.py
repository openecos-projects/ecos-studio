import json
from pathlib import Path

import pytest

from ecos_agent.ecc_contracts import ECCParameterPatchItem, ECCStepName
from ecos_agent.knob_registry import (
    KNOB_SPECS,
    knob_spec,
    validate_value,
)
from ecos_agent.provider import EcosAgentProvider
from ecos_agent.provider_support import _tunable_workspace_parameters


def _send(provider: EcosAgentProvider, session_id: str, message: str) -> None:
    provider.send_message({"sessionId": session_id, "message": message})


def _workspace_without_completed_stages(root: Path) -> Path:
    """A workspace that has been created but has never finished a flow step."""
    workspace = root / "gcd"
    home = workspace / "home"
    home.mkdir(parents=True)
    (home / "flow.json").write_text(
        json.dumps({"steps": [{"name": "place", "tool": "dreamplace", "state": "Pending"}]}),
        encoding="utf-8",
    )
    (home / "parameters.json").write_text(
        json.dumps(
            {
                "Design": "gcd",
                "Clock": "clk",
                "Frequency max [MHz]": 100,
                "Max fanout": 20,
                "Target density": 0.55,
                "Target overflow": 0.1,
                "Cell padding x": 600,
                "Routability opt flag": 1,
                "Global right padding": 0,
                "Bottom layer": "MET2",
                "Top layer": "MET5",
                "Die": {"Size": [100.0, 120.0]},
                "Core": {
                    "Utilitization": 0.4,
                    "Margin": [2.0, 2.0],
                    "Aspect ratio": 1.0,
                },
            }
        ),
        encoding="utf-8",
    )
    return workspace


def test_every_step_with_knobs_is_a_real_ecc_step() -> None:
    for knob_id, spec in KNOB_SPECS.items():
        assert isinstance(spec.step, ECCStepName), knob_id


def test_knob_registry_has_no_workspace_file_or_json_path_targets() -> None:
    for spec in KNOB_SPECS.values():
        assert set(vars(spec)) == {"knob_id", "step", "kind", "bounds"}


def test_unknown_knob_is_rejected_rather_than_ignored() -> None:
    with pytest.raises(ValueError, match="unsupported parameter"):
        knob_spec("place.not_a_real_knob")


@pytest.mark.parametrize(
    ("knob_id", "value"),
    [
        ("floorplan.utilitization", 1.5),
        ("floorplan.die_width", 0),
        ("design.frequency_max", -1),
        ("floorplan.global_right_padding", -1),
    ],
)
def test_out_of_range_values_are_rejected(knob_id: str, value: object) -> None:
    with pytest.raises(ValueError):
        validate_value(ECCParameterPatchItem(knob_id=knob_id, value=value))


@pytest.mark.parametrize(
    ("knob_id", "value"),
    [
        ("floorplan.utilitization", 0.7),
        ("floorplan.die_width", 250.0),
        ("design.frequency_max", 200),
    ],
)
def test_in_range_values_are_accepted(knob_id: str, value: object) -> None:
    validate_value(ECCParameterPatchItem(knob_id=knob_id, value=value))


def test_global_parameters_are_tunable_before_any_stage_completes(tmp_path: Path) -> None:
    _workspace_without_completed_stages(tmp_path)
    available = dict(
        _tunable_workspace_parameters(
            {
                "design.frequency_max": 100,
                "floorplan.utilitization": 0.4,
                "floorplan.die_width": 100.0,
                "place.target_density": 0.55,
            }
        )
    )
    assert available["design.frequency_max"] == 100
    assert available["floorplan.utilitization"] == 0.4
    assert available["floorplan.die_width"] == 100.0
    assert available["place.target_density"] == 0.55


def test_parameter_update_contract_carries_domain_updates(tmp_path: Path) -> None:
    workspace = _workspace_without_completed_stages(tmp_path)
    events: list[dict[str, object]] = []

    def parse_parameter(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [{"knob_id": "floorplan.utilitization", "value": 0.7}],
            "summary": "Raise core utilization.",
        }

    provider = EcosAgentProvider(emit=events.append, rerun_parameter_parser=parse_parameter)
    session_id = provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "workspaceParameterValues": {"floorplan.utilitization": 0.4},
        }
    )["sessionId"]
    _send(provider, session_id, "1")
    _send(provider, session_id, "raise utilization to 0.7")

    session = provider.sessions[session_id]
    assert session.phase == "workspace_parameter_confirmation"
    contract = session.workspace_parameter_update
    assert contract is not None
    assert contract["schema_version"] == "flow-agent.workspace_parameter_update_contract.v3"
    assert contract["parameter_patch"] == [
        {"knob_id": "floorplan.utilitization", "value": 0.7}
    ]
    assert "workspace_parameters" not in contract
    assert "step_configurations" not in contract
