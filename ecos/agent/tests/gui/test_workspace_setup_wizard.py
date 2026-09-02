import json
from pathlib import Path

import pytest

import ecos_agent.gui.provider as provider_module
from ecos_agent.codex.provider import CodexProviderError
from ecos_agent.workspace.contracts import GuiWorkspaceSetupProposal
from ecos_agent.gui.messages import EMPTY_CHOICE_VALUE, operation_prompt
from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.workspace.setup import (
    WorkspaceInputs,
    display_path,
    recommended_workspace_name,
    workspace_search_roots,
    workspace_setup_contract,
)

from .provider_support import (
    chat_response as _chat_response,
    last_event as _last_event,
    proposal as _proposal,
    send_session_input as _send,
    write_workspace_inputs as _write_workspace_inputs,
)


def test_home_mode_separates_manual_flow_setup_from_optimization_entry(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=lambda _context: _chat_response(answer="Please describe your ECOS question."),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    assert provider.sessions[session_id].phase == "home_ready"
    choice = _last_event(events, "interaction")["interaction"]
    assert choice["title"] == "Get started"
    assert choice["kind"] == "choice"
    assert choice["options"][0]["id"]
    assert choice["options"][0]["label"] == (
        "Start creating a Workspace and run a full RTL-to-GDS flow"
    )
    assert "bounded optimization episode" in choice["options"][1]["label"]
    assert len(choice["options"]) == 3
    assert "Quick Start" in choice["options"][2]["label"]
    welcome = next(event["text"] for event in events if event["type"] == "message")
    assert "state-controlled, PPA-oriented design-flow agent" in str(welcome)
    assert "Choose quick RTL setup" not in str(welcome)
    assert "Choose an operation below" not in str(welcome)

    _send(provider, session_id, "2")
    assert provider.sessions[session_id].phase == "optimization_workspace"
    assert "baseline workspace completed through Harden" in str(_last_event(events, "message")["text"])

    workspace = tmp_path / "baseline-workspace"
    workspace.mkdir()
    _send(provider, session_id, str(workspace))
    assert provider.sessions[session_id].rerun_workspace_path == str(workspace)
    assert provider.sessions[session_id].phase == "optimization_objective"
    assert "Describe the optimization goal" in str(_last_event(events, "message")["text"])


def test_home_nl_bootstrap_skips_fields_that_are_already_clear(tmp_path: Path) -> None:
    project_root = tmp_path / "gcd_project"
    project_root.mkdir()
    (project_root / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []

    def parse_operation(context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.gui_chat_response.v1",
            "operation": "1",
            "answer": None,
        }

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _send(
        provider,
        session_id,
        f"使用已有 Project {project_root} 创建 workspace，命名 ws_0009，设计名 gcd",
    )

    session = provider.sessions[session_id]
    assert session.phase == "workspace_flow_end"
    assert session.workspace_inputs.project_root == str(project_root.resolve())
    assert session.workspace_setup.workspace_name == "ws_0009"
    assert session.workspace_setup.design_name == "gcd"


def test_start_session_binds_project_root_and_welcome_shows_both_contexts(
    tmp_path: Path,
) -> None:
    project = tmp_path / "gcd"
    workspace = project / "ws_0001"
    workspace.mkdir(parents=True)
    (project / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "projectRoot": str(project),
        }
    )["sessionId"]
    session = provider.sessions[session_id]
    assert session.project_root == str(project)
    welcome = next(event["text"] for event in events if event["type"] == "message")
    assert f"Project: {project}" in str(welcome)
    assert f"Workspace: {workspace}" in str(welcome)
    assert "Choose an operation below" not in str(welcome)
    operation = _last_event(events, "interaction")["interaction"]
    assert operation["kind"] == "choice"
    operation_request = next(
        event["interaction"] for event in reversed(events) if event["type"] == "interaction"
    )
    assert operation_request["description"] == operation_prompt("en")
    assert len(operation["options"]) == 4


def test_standalone_workspace_hides_create_sibling_option(tmp_path: Path) -> None:
    workspace = tmp_path / "orphan_ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    provider.start_session({"directory": str(workspace), "mode": "workspace"})
    operation = _last_event(events, "interaction")["interaction"]
    assert operation["kind"] == "choice"
    assert len(operation["options"]) == 3


def test_existing_project_branch_requires_project_json_and_uses_workspace_name(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    (project_root / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=lambda _context: _proposal(),
    )
    session_id = provider.start_session(
        {
            "mode": "home",
            "knownProjects": [{"name": "projects", "path": str(project_root)}],
        }
    )["sessionId"]

    _send(provider, session_id, "1")
    assert provider.sessions[session_id].phase == "workspace_project_mode"
    mode_choice = _last_event(events, "interaction")["interaction"]
    assert mode_choice["title"] == "Choose a Project"
    assert len(mode_choice["options"]) == 2

    _send(provider, session_id, "1")
    assert provider.sessions[session_id].phase == "workspace_project_root"
    known = _last_event(events, "interaction")["interaction"]
    assert known["options"][0]["label"] == f"projects — {project_root}"

    _send(provider, session_id, str(project_root))
    assert provider.sessions[session_id].phase == "workspace_name"
    _send(provider, session_id, "ws_0003")
    assert provider.sessions[session_id].phase == "workspace_design"
    design_prompt = str(_last_event(events, "message")["text"])
    assert "Use the suggestion below" not in design_prompt
    design_choice = _last_event(events, "interaction")["interaction"]
    assert design_choice["kind"] == "form"
    assert "defaultValue" not in design_choice["fields"][0]
    _send(provider, session_id, "gcd")
    assert provider.sessions[session_id].phase == "workspace_flow_end"
    assert provider.sessions[session_id].workspace_setup.workspace_name == "ws_0003"
    assert provider.sessions[session_id].workspace_setup.design_name == "gcd"
    flow_end_choice = _last_event(events, "interaction")["interaction"]
    assert flow_end_choice["title"] == "Choose the end step"
    assert _last_event(events, "message")["text"] == (
        "The flow always starts at Synthesis and stops after the selected stage. "
        "For example, choosing place runs Synthesis through place only; "
        "Run all steps continues through Harden."
    )
    assert flow_end_choice["variant"] == "list"
    assert flow_end_choice["options"][0] == {
        "id": flow_end_choice["options"][0]["id"],
        "label": "Run all steps",
    }
    assert [option["label"] for option in flow_end_choice["options"][1:4]] == [
        "Synthesis",
        "Floorplan",
        "place",
    ]
    assert flow_end_choice["options"][-1]["label"] == "Harden"

    _send(provider, session_id, "3")
    assert provider.sessions[session_id].phase == "workspace_rtl"
    assert provider.sessions[session_id].workspace_setup.flow_end == "place"


def test_existing_project_branch_keeps_all_known_projects_selectable(tmp_path: Path) -> None:
    projects = []
    for name in ("alpha", "beta"):
        project = tmp_path / name
        project.mkdir()
        (project / "project.json").write_text("{}", encoding="utf-8")
        projects.append({"name": name, "path": str(project)})

    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"mode": "home", "knownProjects": projects}
    )["sessionId"]

    _send(provider, session_id, "1")
    _send(provider, session_id, "1")

    interaction = _last_event(events, "interaction")["interaction"]
    assert interaction["kind"] == "choice"
    assert [option["label"] for option in interaction["options"]] == [
        f"alpha — {projects[0]['path']}",
        f"beta — {projects[1]['path']}",
    ]


def test_invalid_form_answer_keeps_the_same_request_available(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"mode": "home", "knownProjects": [{"name": "project", "path": str(project)}]}
    )["sessionId"]

    _send(provider, session_id, "1")
    _send(provider, session_id, "1")
    _send(provider, session_id, str(project))
    session = provider.sessions[session_id]
    session.phase = "workspace_rtl"
    session.path_recommendations["rtl"] = str(tmp_path / "missing.v")
    provider._emit_phase_choice(session)
    request = session.pending_interaction["request"]
    assert request["kind"] == "form"

    with pytest.raises(ValueError, match="Form field 'value' is invalid"):
        provider.answer_interaction(
            {
                "sessionId": session_id,
                "requestId": request["requestId"],
                "kind": "form",
                "values": {"value": str(tmp_path / "missing")},
            }
        )

    pending = provider.sessions[session_id].pending_interaction
    assert pending is not None
    assert pending["request"]["requestId"] == request["requestId"]
    assert request["requestId"] not in provider.sessions[session_id].interaction_history


def test_design_name_uses_local_file_candidates_without_codex(tmp_path: Path, monkeypatch) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, _pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []

    def fail_if_called(_context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        raise AssertionError("design name input must not start Codex discovery")

    monkeypatch.setattr(provider_module, "_propose_gui_workspace_path_discovery", fail_if_called)
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    for message in ("1", "2", str(project_root), "ws_0001", "gcd"):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    assert session.phase == "workspace_flow_end"
    assert session.path_recommendations == {
        "rtl": str(rtl),
        "filelist": str(filelist),
        "sdc": str(sdc),
    }
    assert not any(event["type"] == "error" for event in events)


def test_path_discovery_parse_error_falls_back_to_local_candidates(tmp_path: Path) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, _filelist, _sdc, _pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []

    def invalid_codex_response(_context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        raise CodexProviderError("Codex assistant content is not valid JSON", failure_class="parse_error")

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=invalid_codex_response,
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    for message in ("1", "2", str(project_root), "ws_0001", "gcd"):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    assert session.phase == "workspace_flow_end"
    assert session.path_recommendations["rtl"] == str(rtl)
    assert not any(event["type"] == "error" for event in events)


def test_rtl_recommendation_emits_a_path_choice_without_embedding_the_path(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, _pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=lambda _context: _proposal(
            rtl_path=str(rtl),
            filelist_path=str(filelist),
            sdc_path=str(sdc),
        ),
    )
    session_id = provider.start_session({})["sessionId"]
    for message in ("1", "2", str(project_root), "ws_0001", "gcd", "0"):
        _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "workspace_rtl"
    rtl_choice = _last_event(events, "interaction")["interaction"]
    assert rtl_choice["title"] == "RTL path"
    assert rtl_choice["kind"] == "form"
    assert rtl_choice["fields"][0]["defaultValue"] == display_path(str(rtl))
    rtl_prompt_text = next(
        event["text"]
        for event in reversed(events)
        if event["type"] == "message" and "RTL file path" in str(event.get("text", ""))
    )
    assert "Recommended local path:" not in str(rtl_prompt_text)
    assert str(rtl) not in str(rtl_prompt_text)


def test_workspace_name_offers_auto_suggestion_and_accepts_custom_input(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    (project_root / "ws_0001").mkdir()
    (project_root / "project.json").write_text(
        json.dumps(
            {
                "workspaces": [
                    {
                        "workspace_id": "ws_0002",
                        "workspace_path": str(project_root / "ws_0002"),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    assert recommended_workspace_name(str(project_root)) == "ws_0003"

    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    for message in ("1", "2", str(project_root)):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    assert session.phase == "workspace_name"
    prompt = str(_last_event(events, "message")["text"])
    assert "Suggested:" not in prompt
    assert "ws_0003" not in prompt
    assert "Use the suggestion below" in prompt
    choice = _last_event(events, "interaction")["interaction"]
    assert choice["kind"] == "form"
    assert choice["fields"][0]["defaultValue"] == "ws_0003"
    assert _last_event(events, "status")["status"] == "awaiting_interaction"

    _send(provider, session_id, "my_custom_ws")
    assert session.phase == "workspace_design"
    assert session.workspace_setup.workspace_name == "my_custom_ws"


def test_workspace_name_default_choice_accepts_auto_suggestion(tmp_path: Path) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    for message in ("1", "2", str(project_root)):
        _send(provider, session_id, message)

    choice = _last_event(events, "interaction")["interaction"]
    _send(provider, session_id, choice["fields"][0]["defaultValue"])
    session = provider.sessions[session_id]
    assert session.workspace_setup.workspace_name == "ws_0001"
    assert session.phase == "workspace_design"


def test_workspace_mode_option_three_prefills_project_root(tmp_path: Path) -> None:
    project = tmp_path / "gcd"
    workspace = project / "ws_0001"
    workspace.mkdir(parents=True)
    (project / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "projectRoot": str(project),
        }
    )["sessionId"]

    _send(provider, session_id, "3")
    session = provider.sessions[session_id]
    assert session.phase == "workspace_name"
    assert session.workspace_inputs.project_root == str(project)

    _send(provider, session_id, "ws_0002")
    assert session.phase == "workspace_design"
    _send(provider, session_id, "gcd_next")
    assert session.phase == "workspace_flow_end"
    flow_end_request = session.pending_interaction["request"]
    assert flow_end_request["kind"] == "choice"
    assert flow_end_request["canUndo"] is True

    provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": flow_end_request["requestId"],
            "kind": flow_end_request["kind"],
            "undo": True,
        }
    )
    assert session.phase == "operation"
    assert session.pending_interaction["request"]["title"] == "Choose an operation"


def test_workspace_setup_contract_carries_project_mpc_snapshot(tmp_path: Path) -> None:
    rtl, filelist, sdc, pdk = _write_workspace_inputs(tmp_path)
    mpc_root = tmp_path / "mpc-frame"
    mpc_root.mkdir()
    mpc = {
        "resource_id": "mpc:mpc-frame",
        "display_name": "MPC Frame",
        "installed_version": "0.1.0",
        "path": str(mpc_root),
        "spec_path": str(mpc_root / "spec" / "spec.json.in"),
        "design": {"index": 0, "design_name": "frame"},
        "core_template": {"minimum_area": 100},
    }
    (tmp_path / "project.json").write_text(json.dumps({"mpc": mpc}), encoding="utf-8")

    contract = workspace_setup_contract(
        _proposal(
            workspace_name="ws_0001",
            design_name="gcd",
            top_module="gcd",
            clock_name="clk",
            flow_start="Synthesis",
            flow_end="Harden",
        ),
        WorkspaceInputs(
            project_root=str(tmp_path),
            rtl_path=str(rtl),
            filelist_path=str(filelist),
            sdc_path=str(sdc),
            pdk_root=str(pdk),
        ),
        "en",
        "setup-mpc",
    )

    assert contract["mpc"] == mpc
    assert contract["parameters"]["MPC"] == mpc
    assert contract["mpc_enabled"] is True

    skipped = workspace_setup_contract(
        _proposal(
            workspace_name="ws_0001",
            design_name="gcd",
            top_module="gcd",
            clock_name="clk",
            flow_start="Synthesis",
            flow_end="Harden",
        ),
        WorkspaceInputs(
            project_root=str(tmp_path),
            rtl_path=str(rtl),
            filelist_path=str(filelist),
            sdc_path=str(sdc),
            pdk_root=str(pdk),
        ),
        "en",
        "setup-no-mpc",
        mpc_enabled=False,
    )
    assert "mpc" not in skipped
    assert "MPC" not in skipped["parameters"]
    assert skipped["mpc_enabled"] is False


def test_workspace_search_roots_do_not_include_project_siblings(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()

    assert workspace_search_roots(str(project_root)) == (str(project_root),)


def test_optional_path_steps_emit_skip_and_recommendation_choices(tmp_path: Path) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=lambda _context: _proposal(
            filelist_path=str(filelist),
            sdc_path=str(sdc),
        ),
    )
    session_id = provider.start_session({})["sessionId"]
    for message in ("1", "2", str(project_root), "ws_0001", "gcd", "4", str(rtl)):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    session.path_recommendations["pdk"] = str(pdk)
    assert session.phase == "workspace_filelist"
    filelist_choice = _last_event(events, "interaction")["interaction"]
    assert filelist_choice["kind"] == "choice"
    assert [option["label"] for option in filelist_choice["options"]] == [
        "Use recommended path",
        "Skip",
    ]
    assert _last_event(events, "status")["status"] == "awaiting_interaction"

    _send(provider, session_id, EMPTY_CHOICE_VALUE)

    assert session.phase == "workspace_sdc"
    assert session.workspace_inputs.filelist_path == ""
    sdc_choice = _last_event(events, "interaction")["interaction"]
    assert sdc_choice["kind"] == "choice"
    assert [option["label"] for option in sdc_choice["options"]] == [
        "Use recommended path",
        "Skip",
    ]

    _send(provider, session_id, str(sdc))
    assert session.phase == "workspace_pdk"
    pdk_choice = _last_event(events, "interaction")["interaction"]
    assert pdk_choice["fields"][0]["defaultValue"] == display_path(str(pdk))

    _send(provider, session_id, pdk_choice["fields"][0]["defaultValue"])
    assert session.phase == "workspace_mpc"
    mpc_choice = _last_event(events, "interaction")["interaction"]
    assert [option["label"] for option in mpc_choice["options"]] == [
        "Use a SoC-MPC template",
        "Do not use a SoC-MPC template",
    ]
    assert provider.sessions[session_id].pending_interaction["request"]["description"] == (
        "A SoC-MPC template provides top-level die/core geometry, I/O pins, and core "
        "constraints so the flow can use the selected chip template; without it, the "
        "flow continues as a standard RTL-to-GDS run."
    )
    _send(provider, session_id, "2")
    assert session.phase == "workspace_top"
    top_choice = _last_event(events, "interaction")["interaction"]
    assert top_choice["fields"][0]["defaultValue"] == "gcd"


def test_workspace_confirmation_accepts_deterministic_frequency_and_workspace_name(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    rtl, _filelist, _sdc, pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []

    def reject_codex(_context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        raise AssertionError("simple Spec corrections must stay deterministic")

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=reject_codex,
    )
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-fields"
    session.workspace_inputs.project_root = str(project_root)
    session.workspace_inputs.project_name = "gcd"
    session.workspace_inputs.rtl_path = str(rtl)
    session.workspace_inputs.pdk_root = str(pdk)
    session.workspace_setup = _proposal(
        workspace_name="ws_0001",
        design_name="gcd",
        top_module="gcd",
        clock_name="clk",
        frequency_mhz=50,
        max_fanout=32,
        utilitization=0.7,
        target_density=0.5,
        target_overflow=0.1,
        rtl_path=str(rtl),
        pdk_root=str(pdk),
        project_root=str(project_root),
    )

    _send(provider, session_id, "把频率改成 200")
    assert session.workspace_setup.frequency_mhz == 200

    _send(provider, session_id, "Workspace Name 改为 ws_0040")
    assert session.workspace_setup.workspace_name == "ws_0040"
    assert not any(event["type"] == "error" for event in events)


def test_workspace_confirmation_accepts_explicit_external_pdk_path(tmp_path: Path) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    rtl, _filelist, _sdc, old_pdk = _write_workspace_inputs(project_root)
    external_pdk = tmp_path / "icsprout55-pdk"
    external_pdk.mkdir()
    events: list[dict[str, object]] = []

    def reject_codex(_context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        raise AssertionError("explicit PDK path correction must stay deterministic")

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=reject_codex,
    )
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-pdk"
    session.workspace_inputs.project_root = str(project_root)
    session.workspace_inputs.project_name = "gcd"
    session.workspace_inputs.rtl_path = str(rtl)
    session.workspace_inputs.pdk_root = str(old_pdk)
    session.workspace_setup = _proposal(
        workspace_name="ws_0036",
        design_name="gcd",
        top_module="gcd",
        clock_name="clk",
        frequency_mhz=100,
        max_fanout=32,
        utilitization=0.7,
        target_density=0.5,
        target_overflow=0.1,
        rtl_path=str(rtl),
        pdk_root=str(old_pdk),
        project_root=str(project_root),
    )

    _send(
        provider,
        session_id,
        f"修改 pdk 路径 为: {external_pdk}",
    )

    assert session.phase == "workspace_confirmation"
    assert session.workspace_inputs.pdk_root == str(external_pdk.resolve())
    assert not any(event["type"] == "error" for event in events)
    assert any(
        event["type"] == "workspace_setup"
        and event.get("workspaceSetup", {}).get("pdk_root") == str(external_pdk.resolve())
        for event in events
    ) or session.workspace_contract is not None
