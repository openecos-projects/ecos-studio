import json
from pathlib import Path

import pytest

from ecos_agent.ecc_contracts import ECCParameterPatchItem, ECCStepName
from ecos_agent.workspace.knob_registry import (
    KNOB_SPECS,
    WRITABLE_FILES,
    knob_spec,
    resolve_write,
    storage_value,
    validate_value,
)
from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.gui.session import ProviderSession
from ecos_agent.gui.workspace_flow import WorkspaceFlow


def _send(provider: EcosAgentProvider, session_id: str, message: str) -> None:
    session = provider.sessions[session_id]
    pending = session.pending_interaction
    if pending is not None:
        for option_id, value in pending["values"].items():
            if value == message:
                provider.answer_interaction(
                    {
                        "sessionId": session_id,
                        "requestId": pending["request"]["requestId"],
                        "kind": pending["request"]["kind"],
                        "optionId": option_id,
                    }
                )
                return
        session.pending_interaction = None
    provider.send_message({"sessionId": session_id, "message": message})


def _workspace_without_completed_stages(root: Path) -> Path:
    """A workspace that has been created but has never finished a flow step."""
    workspace = root / "gcd"
    home = workspace / "home"
    home.mkdir(parents=True)
    (home / "flow.json").write_text(
        json.dumps({"steps": [{"name": "placement", "directory": "06_placement_dreamplace", "tool": "dreamplace", "state": "Pending"}]}),
        encoding="utf-8",
    )
    (home / "params.toml").write_text(
        'schema_version = 4\n[design]\nname = "gcd"\nclock_port = "clk"\nfrequency_mhz = 100\n'
        '[params.step_params.placement]\n"place.target_density" = 0.55\n',
        encoding="utf-8",
    )
    return workspace


def test_every_knob_targets_a_writable_workspace_file() -> None:
    for knob_id, spec in KNOB_SPECS.items():
        assert spec.write_target.file in WRITABLE_FILES, knob_id
        assert spec.read_target.file in WRITABLE_FILES, knob_id
        assert spec.write_target.json_path, knob_id


def test_every_step_with_knobs_is_a_real_ecc_step() -> None:
    for knob_id, spec in KNOB_SPECS.items():
        assert isinstance(spec.step, ECCStepName), knob_id


def test_parameters_surface_wins_over_the_derived_step_config() -> None:
    spec = knob_spec("place.target_density")
    assert spec.read_target.file == "config/dreamplace_ecc.json"
    assert spec.write_target.file == "home/params.toml"
    assert spec.write_target.json_path == ("params", "step_params", "placement", "place.target_density")


def test_step_config_only_knobs_write_to_their_tool_config() -> None:
    spec = knob_spec("cts.skew_bound")
    assert spec.write_target.surface == "step_config"
    assert spec.write_target.file == "config/cts_ecc.json"


def test_resolve_write_emits_a_complete_execution_instruction() -> None:
    write = resolve_write(ECCParameterPatchItem(knob_id="floorplan.die_width", value=250.0))
    assert write == {
        "knob_id": "floorplan.die_width",
        "value": 250.0,
        "surface": "parameters",
        "file": "home/params.toml",
        "json_path": ["params", "die", "size", 0],
    }


def test_boolean_parameters_flags_are_stored_as_integers() -> None:
    item = ECCParameterPatchItem(knob_id="place.routability_opt", value=False)
    assert storage_value(item) == 0
    assert storage_value(ECCParameterPatchItem(knob_id="place.routability_opt", value=True)) == 1
    # Step-config booleans keep their JSON boolean form.
    assert storage_value(ECCParameterPatchItem(knob_id="route.enable_timing", value=True)) is True


def test_unknown_knob_is_rejected_rather_than_ignored() -> None:
    with pytest.raises(ValueError, match="unsupported parameter"):
        knob_spec("place.not_a_real_knob")


@pytest.mark.parametrize(
    ("knob_id", "value"),
    [
        ("floorplan.utilitization", 1.5),
        ("floorplan.die_width", 0),
        ("design.frequency_max", -1),
        ("design.clock", "   "),
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
        ("floorplan.margin_x", 0.0),
        ("design.frequency_max", 200),
        ("design.clock", "clk"),
    ],
)
def test_in_range_values_are_accepted(knob_id: str, value: object) -> None:
    validate_value(ECCParameterPatchItem(knob_id=knob_id, value=value))


def test_global_parameters_are_tunable_before_any_stage_completes(tmp_path: Path) -> None:
    workspace = _workspace_without_completed_stages(tmp_path)
    available = dict(
        WorkspaceFlow(ProviderSession(session_id="test")).tunable_parameters(workspace)
    )
    assert available["design.frequency_max"] == 100
    assert available["place.target_density"] == 0.55


def test_floorplan_geometry_is_outside_the_gui_rerun_surface(tmp_path: Path) -> None:
    """The Electron execution gate rejects floorplan knobs, so the agent never
    offers them (product decision 2026-09-13, ecos/agent/docs/diff.md #8)."""
    from ecos_agent.workspace.authorization import authorized_knobs_for_step
    from ecos_agent.workspace.rerun import GuiWorkspaceRerunResolver

    assert authorized_knobs_for_step(ECCStepName.POST_FLOORPLAN) == frozenset()

    workspace = _workspace_without_completed_stages(tmp_path)
    available = dict(
        WorkspaceFlow(ProviderSession(session_id="test")).tunable_parameters(workspace)
    )
    assert not any(knob_id.startswith("floorplan.") for knob_id in available)

    with pytest.raises(ValueError, match="not available in this workspace"):
        WorkspaceFlow(ProviderSession(session_id="test")).validate_parameter_patch(
            [{"knob_id": "floorplan.die_width", "value": 250.0}], available
        )

    with pytest.raises(ValueError, match="not authorized"):
        GuiWorkspaceRerunResolver.validate_patch(
            "post_floorplan", [{"knob_id": "floorplan.die_width", "value": 250.0}]
        )


def test_parameter_update_contract_carries_resolved_writes(tmp_path: Path) -> None:
    workspace = _workspace_without_completed_stages(tmp_path)
    events: list[dict[str, object]] = []

    def parse_parameter(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [{"knob_id": "place.target_density", "value": 0.7}],
            "summary": "Raise target density.",
        }

    provider = EcosAgentProvider(emit=events.append, rerun_parameter_parser=parse_parameter)
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]
    provider._begin_workspace_parameter_update(provider.sessions[session_id])
    _send(provider, session_id, "raise target density to 0.7")

    session = provider.sessions[session_id]
    assert session.phase == "workspace_parameter_confirmation"
    contract = session.workspace_parameter_update
    assert contract is not None
    assert contract["schema_version"] == "flow-agent.workspace_parameter_update_contract.v2"
    assert contract["writes"] == [
        {
            "knob_id": "place.target_density",
            "value": 0.7,
            "surface": "parameters",
            "file": "home/params.toml",
            "json_path": ["params", "step_params", "placement", "place.target_density"],
        }
    ]
