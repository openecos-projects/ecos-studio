import json
from pathlib import Path

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.workspace.rerun import GuiWorkspaceRerunResolver, GuiWorkspaceRerunSource

from .provider_support import (
    last_event as _last_event,
    proposal as _proposal,
    send_session_input as _send,
    workspace_with_timing_opt_and_place as _workspace_with_timing_opt_and_place,
    write_workspace_inputs as _write_workspace_inputs,
)


def test_rerun_uses_the_open_gui_workspace_as_the_default_source(tmp_path: Path) -> None:
    workspace = tmp_path / "source-workspace"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "rerun_source_run"
    assert provider.sessions[session_id].design_id == "gcd"
    source_choice = _last_event(events, "interaction")["interaction"]
    assert source_choice["title"] == "Source workspace"
    assert source_choice["kind"] == "form"
    assert source_choice["fields"][0]["kind"] == "path"
    assert source_choice["fields"][0]["defaultValue"] == str(workspace)
    assert any(
        event["type"] == "tool" and "Preparing stage rerun" in str(event.get("text", ""))
        for event in events
    )

    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "rerun_stage"
    stage_choice = _last_event(events, "interaction")["interaction"]
    assert stage_choice["title"] == "Start stage"
    assert [option["label"] for option in stage_choice["options"]] == ["place"]


def test_rerun_skips_empty_parameter_table_for_timing_opt(tmp_path: Path) -> None:
    workspace = tmp_path / "source-workspace"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "Timing optimization", "tool": "sizer", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "timing_optimization_sizer" / "output"
    output.mkdir(parents=True)
    (output / "gcd_timing_optimization.def.gz").write_bytes(b"def")
    (workspace / "home" / "parameters.json").write_text(
        '{"Design": "gcd"}', encoding="utf-8"
    )
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    for message in ("1", "1", "1"):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    assert session.phase == "rerun_scope"
    assert session.rerun_stage == "Timing optimization"
    assert session.rerun_parameter_patch == []
    assert any(
        event["type"] == "message"
        and "no tunable rerun parameters" in str(event["text"]).lower()
        for event in events
    )
    assert not any(
        event["type"] == "message" and "| Parameter | Current value |" in str(event["text"])
        for event in events
    )


def test_workspace_mode_rerun_uses_bound_directory_without_design_prompt(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "1")
    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "rerun_stage"
    assert not any(event["type"] == "workspace_rerun" for event in events)


def test_rerun_freezes_evidence_before_requesting_gui_execution(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    config = workspace / "config"
    config.mkdir()
    (config / "dreamplace_ecc.json").write_text(
        '{"target_density": 0.2, "routability_opt_flag": true, "stop_overflow": 0.0}',
        encoding="utf-8",
    )
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []

    def parse_rerun_parameter(context: dict[str, object]) -> dict[str, object]:
        parser_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [
                {"knob_id": "place.routability_opt", "value": 0},
                {"knob_id": "place.target_overflow", "value": 0.1},
            ],
            "summary": "Disable routability optimization and set target overflow.",
        }

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=parse_rerun_parameter,
    )

    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    for message in (
        "1",
        "1",
        "1",
        "set place.routability_opt to 0,set target_overflow to 0.1",
    ):
        _send(provider, session_id, message)

    parameter_message = next(
        event
        for event in reversed(events)
        if event["type"] == "message" and "Parameters available for this stage" in str(event["text"])
    )
    assert "| place.routability_opt | false |" in str(parameter_message["text"])
    assert "| place.target_overflow | 0.1 |" in str(parameter_message["text"])
    scope_choice = _last_event(events, "interaction")["interaction"]
    assert scope_choice["title"] == "Choose the execution scope"
    assert len(scope_choice["options"]) == 2

    _send(provider, session_id, "2")

    contract = _last_event(events, "contract")
    assert "Confirm and start" in str(contract["text"])
    confirmation = _last_event(events, "interaction")["interaction"]
    assert confirmation["kind"] == "confirm"
    assert confirmation["confirm"]["label"] == "Confirm and start"
    assert not any(
        event["type"] == "message" and "Confirm and start" in str(event.get("text"))
        for event in events
    )

    _send(provider, session_id, "1")

    rerun = _last_event(events, "workspace_rerun")["workspaceRerun"]
    assert rerun["schema_version"] == "flow-agent.workspace_rerun_contract.v1"
    assert rerun["execution_scope"] == "full_flow"
    assert rerun["end_step"] == "Harden"
    assert parser_contexts[0]["natural_language_request"] == (
        "set place.routability_opt to 0,set target_overflow to 0.1"
    )
    assert parser_contexts[0]["boolean_knobs"] == ["place.routability_opt"]
    assert rerun["parameter_patch"] == [
        {"knob_id": "place.routability_opt", "value": False},
        {"knob_id": "place.target_overflow", "value": 0.1},
    ]
    assert rerun["writes"] == [
        {
            "file": "home/parameters.json",
            "json_path": ["Routability opt flag"],
            "knob_id": "place.routability_opt",
            "surface": "parameters",
            "value": 0,
        },
        {
            "file": "home/parameters.json",
            "json_path": ["Target overflow"],
            "knob_id": "place.target_overflow",
            "surface": "parameters",
            "value": 0.1,
        },
    ]

    _send(
        provider,
        session_id,
        "workspace_rerun_result:" + json.dumps({"rerun_id": "gcd_rerun_place", "status": "succeeded", "error": ""}),
    )

    assert provider.sessions[session_id].phase == "operation"
    operation_choice = _last_event(events, "interaction")["interaction"]
    assert operation_choice["title"] == "Choose an operation"
    assert _last_event(events, "status")["status"] == "awaiting_interaction"


def test_rerun_workspace_invalid_path_reemits_current_workspace_choice(tmp_path: Path) -> None:
    workspace = tmp_path / "source-workspace"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "rerun_workspace"
    session.design_id = "gcd"

    _send(provider, session_id, str(tmp_path / "missing-workspace"))

    assert session.phase == "rerun_workspace"
    choice = _last_event(events, "interaction")["interaction"]
    assert choice["title"] == "Choose the source workspace"
    assert choice["kind"] == "form"
    assert choice["fields"][0]["kind"] == "path"
    assert choice["fields"][0]["defaultValue"] == str(workspace)
    assert _last_event(events, "status")["status"] == "awaiting_interaction"
    assert any(
        event["type"] == "message"
        and "Use the current GUI workspace below" in str(event["text"])
        for event in events
    )


def test_workspace_contract_validation_failure_reemits_top_choice(tmp_path: Path) -> None:
    rtl, _filelist, _sdc, pdk = _write_workspace_inputs(tmp_path)
    rtl.write_text("module other(input clk); endmodule\n", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.workspace_inputs.project_root = str(tmp_path)
    session.workspace_inputs.project_name = tmp_path.name
    session.workspace_inputs.rtl_path = str(rtl)
    session.workspace_inputs.pdk_root = str(pdk)
    session.workspace_setup = _proposal(
        workspace_name="ws_0001",
        design_name="gcd",
        top_module="gcd",
        clock_name="clk",
        frequency_mhz=100,
        max_fanout=32,
        utilitization=0.7,
        target_density=0.5,
        target_overflow=0.1,
        rtl_path=str(rtl),
        pdk_root=str(pdk),
        project_root=str(tmp_path),
    )
    session.phase = "workspace_overflow"

    _send(provider, session_id, "0.1")

    assert session.phase == "workspace_top"
    choice = _last_event(events, "interaction")["interaction"]
    assert choice["title"] == "Top Module Name"
    assert choice["kind"] == "form"
    assert choice["fields"][0]["defaultValue"] == "gcd"
    assert _last_event(events, "status")["status"] == "awaiting_interaction"


def test_workspace_operation_choice_omits_parameter_update(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    provider.start_session({"directory": str(workspace), "mode": "workspace"})

    assert [
        option["label"]
        for option in _last_event(events, "interaction")["interaction"]["options"]
    ] == [
        "Rerun a specified stage",
        "Continue unfinished flow",
        "Start a bounded optimization episode",
    ]


def test_workspace_continue_uses_compact_confirm_without_command_table(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "2")

    assert provider.sessions[session_id].phase == "workspace_continue_confirmation"
    contract = _last_event(events, "contract")
    assert contract["contract"]["presentation"] == "workspace_continue"
    assert contract["contract"]["fields"] == []
    assert "runAllFlow" not in str(contract["text"])
    assert str(workspace) in str(contract["text"])
    assert "Continue the unfinished flow in the current workspace" in str(contract["text"])


def test_harden_signoff_requires_unblocked_checklist_and_user_confirmation(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    session = provider.sessions[session_id]

    provider._begin_workspace_signoff(session, str(workspace))
    signoff = _last_event(events, "workspace_signoff")["workspaceSignoff"]
    signoff_id = str(signoff["signoff_id"])
    assert signoff["action"] == "inspect"
    _send(
        provider,
        session_id,
        f'workspace_signoff_inspection:{json.dumps({"signoff_id": signoff_id, "status": "ready", "error": ""})}',
    )
    assert session.phase == "workspace_signoff_confirmation"
    choice = _last_event(events, "interaction")["interaction"]
    assert choice["title"] == "Export signoff package?"
    assert choice["kind"] == "confirm"
    assert choice["confirm"]["label"] == "Export signoff package"
    assert choice["cancel"]["label"] == "Cancel"

    _send(provider, session_id, "1")
    export = _last_event(events, "workspace_signoff")["workspaceSignoff"]
    assert export["action"] == "export"
    _send(
        provider,
        session_id,
        f'workspace_signoff_result:{json.dumps({"signoff_id": signoff_id, "status": "succeeded", "error": ""})}',
    )
    assert session.phase == "operation"
    assert any("exported successfully" in str(event.get("text")) for event in events)


def test_harden_signoff_blocked_checklist_never_reaches_export(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    session = provider.sessions[session_id]
    provider._begin_workspace_signoff(session, str(workspace))
    signoff_id = str(_last_event(events, "workspace_signoff")["workspaceSignoff"]["signoff_id"])

    _send(
        provider,
        session_id,
        f'workspace_signoff_inspection:{json.dumps({"signoff_id": signoff_id, "status": "blocked", "error": "MPC checklist blocked"})}',
    )

    assert session.phase == "operation"
    assert not any(
        event["type"] == "workspace_signoff"
        and event.get("workspaceSignoff", {}).get("action") == "export"
        for event in events
    )


def test_workspace_creation_harden_result_starts_signoff_inspection(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    session = provider.sessions[session_id]
    session.workspace_setup_id = "setup-1"
    session.workspace_contract = {"directory": str(workspace)}
    session.phase = "workspace_creation_pending"

    _send(
        provider,
        session_id,
        "workspace_create_result:" + json.dumps(
            {
                "setup_id": "setup-1",
                "status": "succeeded",
                "error": "",
                "end_step": "Harden",
                "workspace": str(workspace),
            }
        ),
    )

    assert session.phase == "workspace_signoff_inspection_pending"
    assert _last_event(events, "workspace_signoff")["workspaceSignoff"]["action"] == "inspect"


def test_workspace_parameter_update_lists_concrete_knob_values(tmp_path: Path) -> None:
    workspace = _workspace_with_timing_opt_and_place(tmp_path)
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []

    def parse_parameter(context: dict[str, object]) -> dict[str, object]:
        parser_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [{"knob_id": "place.target_density", "value": 0.4}],
            "summary": "Lower target density.",
        }

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=parse_parameter,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    provider._begin_workspace_parameter_update(provider.sessions[session_id])
    _send(provider, session_id, "lower target density")

    assert provider.sessions[session_id].phase == "workspace_parameter_confirmation"
    assert "place.target_density" in parser_contexts[0]["allowed_knobs"]
    contract = _last_event(events, "contract")["contract"]
    assert contract["presentation"] == "workspace_parameter_update"
    assert contract["fields"] == [
        {"label": "Workspace", "value": str(workspace)},
        {"label": "place.target_density", "value": "0.55 → 0.4"},
    ]


def test_workspace_parameter_update_rejects_empty_patch(tmp_path: Path) -> None:
    workspace = _workspace_with_timing_opt_and_place(tmp_path)
    events: list[dict[str, object]] = []

    def empty_patch(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [],
            "summary": "No changes.",
        }

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=empty_patch,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    provider._begin_workspace_parameter_update(provider.sessions[session_id])
    _send(provider, session_id, "lower target density")

    assert provider.sessions[session_id].phase == "workspace_parameter_request"
    assert any(
        event["type"] == "error" and "no parameter changes were proposed" in str(event["text"])
        for event in events
    )
    assert not any(event["type"] == "contract" for event in events)


def test_invalid_choice_and_creation_failed_copy_point_to_cards() -> None:
    from ecos_agent.gui.messages import invalid_choice, workspace_creation_failed

    assert "listed numbers" not in invalid_choice("en").lower()
    assert "enter 1" not in workspace_creation_failed("en", "disk full").lower()
    assert "confirm again" in workspace_creation_failed("en", "disk full").lower()


def test_rerun_allocates_a_numbered_target_when_the_default_exists(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    (tmp_path / "gcd_rerun_place").mkdir()
    source = GuiWorkspaceRerunSource(
        workspace_path=workspace,
        design_id="gcd",
        flow_json_sha256="0" * 64,
        end_step=ECCStepName.PLACEMENT,
        allowed_stages=("place",),
        stage_artifact_ref={"place": "place_dreamplace/output/gcd_place.def.gz"},
        stage_artifact_sha256={"place": "1" * 64},
    )

    contract = GuiWorkspaceRerunResolver(tmp_path).freeze(source, "place", [], "single_step")

    assert contract.target_workspace == str(tmp_path / "gcd_rerun_place_0001")
    assert contract.rerun_id == "gcd_rerun_place_0001"
