import json
import threading
from pathlib import Path

from ecos_agent.codex_provider import CodexAppServerProposalProvider, CodexProviderError, _resolve_codex_bin
from ecos_agent.contracts import GuiWorkspaceSetupProposal
from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.messages import EMPTY_CHOICE_VALUE
from ecos_agent.provider import EcosAgentProvider, PROVIDER_ID
from ecos_agent.workspace_rerun import GuiWorkspaceRerunResolver, GuiWorkspaceRerunSource
from ecos_agent.workspace_setup import display_path, workspace_search_roots


def _proposal(**overrides: object) -> GuiWorkspaceSetupProposal:
    payload: dict[str, object] = {
        "schema_version": "flow-agent.gui_workspace_setup_proposal.v1",
        "workspace_name": None,
        "description": None,
        "design_name": None,
        "top_module": None,
        "clock_name": None,
        "frequency_mhz": None,
        "max_fanout": None,
        "flow_start": None,
        "flow_end": None,
        "die_area_mode": None,
        "utilitization": None,
        "margin": None,
        "die_width": None,
        "die_height": None,
        "target_density": None,
        "target_overflow": None,
        "project_root": None,
        "rtl_path": None,
        "filelist_path": None,
        "sdc_path": None,
        "pdk_root": None,
        "summary": "No correction.",
    }
    payload.update(overrides)
    return GuiWorkspaceSetupProposal.model_validate(payload)


def _send(provider: EcosAgentProvider, session_id: str, message: str) -> None:
    provider.send_message({"sessionId": session_id, "message": message})


def _last_event(events: list[dict[str, object]], event_type: str) -> dict[str, object]:
    return next(event for event in reversed(events) if event["type"] == event_type)


def _write_workspace_inputs(root: Path) -> tuple[Path, Path, Path, Path]:
    rtl = root / "gcd.v"
    filelist = root / "gcd.f"
    sdc = root / "gcd.sdc"
    pdk = root / "pdk"
    rtl.write_text("module gcd(input clk); endmodule\n", encoding="utf-8")
    filelist.write_text("gcd.v\n", encoding="utf-8")
    sdc.write_text("create_clock -period 10 [get_ports clk]\n", encoding="utf-8")
    pdk.mkdir()
    return rtl, filelist, sdc, pdk


def test_codex_bin_expands_the_user_home_directory(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "bin" / "codex"
    codex.parent.mkdir()
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    monkeypatch.setenv("HOME", str(tmp_path))

    assert _resolve_codex_bin("~/bin/codex", {"PATH": ""}) == str(codex)


def test_source_manifest_uses_the_user_codex_environment() -> None:
    manifest_path = Path(__file__).parents[1] / "agent-provider.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["command"] == "uv"
    assert "ECOS_AGENT_CODEX_BIN" not in manifest.get("environment", {})


def test_start_fails_closed_when_codex_cli_is_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("ECOS_AGENT_CODEX_BIN", raising=False)
    monkeypatch.setenv("PATH", "")
    provider = EcosAgentProvider(emit=lambda _event: None)

    try:
        provider.start()
    except CodexProviderError as exc:
        assert exc.failure_class == "missing_input"
    else:
        raise AssertionError("Agent start must reject an unavailable Codex CLI")


def test_workspace_search_roots_do_not_include_project_siblings(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()

    assert workspace_search_roots(str(project_root)) == (str(project_root),)


def test_codex_rerun_parameter_prompt_requires_boolean_and_multi_knob_interpretation(
    tmp_path: Path, monkeypatch
) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    prompts: list[str] = []

    def capture_proposal(
        _context: dict[str, object], system: str, _schema: dict[str, object], _model: object
    ) -> dict[str, object]:
        prompts.append(system)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [],
            "summary": "No change.",
        }

    monkeypatch.setattr(provider, "_proposal", capture_proposal)
    provider.propose_gui_workspace_rerun_patch(
        {
            "allowed_knobs": ["place.routability_opt", "place.target_overflow"],
            "boolean_knobs": ["place.routability_opt"],
        }
    )

    assert "every requested applicable parameter change" in prompts[0]
    assert "unqualified knob name" in prompts[0]
    assert "numeric 0 as false and 1 as true" in prompts[0]


def test_run_flow_only_emits_a_frozen_workspace_contract(tmp_path: Path) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, pdk = _write_workspace_inputs(tmp_path)
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []

    def parse_workspace_setup(context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        parser_contexts.append(context)
        callback = context["_progress_callback"]
        assert callable(callback)
        callback("Codex is analyzing the bounded numeric request.")
        return _proposal(target_overflow=0.1)

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=parse_workspace_setup,
        workspace_path_recommender=lambda _context: _proposal(),
    )

    session_id = provider.start_session({})["sessionId"]
    for message in (
        "1",
        "2",
        str(project_root),
        "ws_0001",
        "gcd",
        "4",
        str(rtl),
        str(filelist),
        str(sdc),
        str(pdk),
        "",
        "",
        "",
        "",
        "",
        "",
        "target overflow is 0.1",
    ):
        _send(provider, session_id, message)

    setup = next(event["workspaceSetup"] for event in events if event["type"] == "workspace_setup")
    assert PROVIDER_ID == "ecos_agent"
    assert "execute" not in provider.__dict__
    assert setup["schema_version"] == "flow-agent.workspace_setup_contract.v2"
    assert setup["directory"] == str(project_root / "ws_0001")
    assert setup["parameters"]["design"] == "gcd"
    assert setup["project_context"]["project_root"] == str(project_root)
    assert setup["parameters"]["target_overflow"] == 0.1
    assert parser_contexts[0]["numeric_field"] == "target_overflow"
    assert parser_contexts[0]["numeric_bounds"] == {"lower": 0, "upper": 1}
    assert all(event["type"] != "error" for event in events)
    assert any(event["type"] == "tool" for event in events)
    choice = _last_event(events, "choice")["choice"]
    assert choice["variant"] == "buttons"
    assert choice["allowFreeText"] is True
    assert [option["value"] for option in choice["options"]] == ["1", "2"]
    assert _last_event(events, "status")["status"] == "awaiting_choice"

    _send(provider, session_id, "1")

    workspace_create = _last_event(events, "workspace_create")
    assert workspace_create["providerId"] == "ecos_agent"


def test_numeric_semantic_fallback_fails_closed_when_codex_times_out(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []

    def mock_codex_timeout(_context: dict[str, object]) -> None:
        raise CodexProviderError("mock timeout", failure_class="timeout")

    provider = EcosAgentProvider(emit=events.append, workspace_setup_parser=mock_codex_timeout)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_overflow"
    session.workspace_inputs.project_root = str(tmp_path)

    _send(provider, session_id, "target overflow is 0.1")

    assert session.phase == "workspace_overflow"
    assert any(
        event["type"] == "message" and "Unable to interpret" in str(event["text"])
        for event in events
    )
    assert not any(event["type"] == "workspace_setup" for event in events)


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
    _send(provider, session_id, "2")

    assert provider.sessions[session_id].phase == "rerun_source_run"
    assert provider.sessions[session_id].design_id == "gcd"
    source_choice = _last_event(events, "choice")["choice"]
    assert source_choice["title"] == "Choose the frozen source run"
    assert source_choice["variant"] == "list"
    assert source_choice["allowFreeText"] is True
    assert [
        (option["label"], option["value"]) for option in source_choice["options"]
    ] == [(str(workspace), "1")]
    assert not any(event["type"] == "tool" for event in events)

    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "rerun_stage"
    stage_choice = _last_event(events, "choice")["choice"]
    assert stage_choice["title"] == "Choose the rerun start stage"
    assert [
        (option["label"], option["value"]) for option in stage_choice["options"]
    ] == [("place", "1")]
    assert not any(event["type"] == "tool" for event in events)


def test_home_mode_hides_rerun_and_only_offers_workspace_create() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    operation = _last_event(events, "choice")["choice"]
    assert [option["value"] for option in operation["options"]] == ["1"]
    _send(provider, session_id, "2")
    assert provider.sessions[session_id].phase == "operation"


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
    _send(provider, session_id, "2")
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
    (config / "dreamplace.json").write_text(
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
        "2",
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
    scope_choice = _last_event(events, "choice")["choice"]
    assert scope_choice["title"] == "Choose the execution scope"
    assert [option["value"] for option in scope_choice["options"]] == ["1", "2"]

    _send(provider, session_id, "2")

    contract = _last_event(events, "contract")
    assert "Confirm and start" in str(contract["text"])
    confirmation = _last_event(events, "choice")["choice"]
    assert confirmation["variant"] == "buttons"
    assert confirmation["allowFreeText"] is False
    assert [option["value"] for option in confirmation["options"]] == ["1", "2"]
    assert not any(
        event["type"] == "message" and "Confirm and start" in str(event.get("text"))
        for event in events
    )

    _send(provider, session_id, "1")

    rerun = _last_event(events, "workspace_rerun")["workspaceRerun"]
    assert rerun["schema_version"] == "flow-agent.workspace_rerun_contract.v1"
    assert rerun["execution_scope"] == "full_flow"
    assert rerun["end_step"] == "place"
    assert parser_contexts[0]["natural_language_request"] == (
        "set place.routability_opt to 0,set target_overflow to 0.1"
    )
    assert parser_contexts[0]["boolean_knobs"] == ["place.routability_opt"]
    assert rerun["parameter_patch"] == [
        {"knob_id": "place.routability_opt", "value": False},
        {"knob_id": "place.target_overflow", "value": 0.1},
    ]

    _send(
        provider,
        session_id,
        "workspace_rerun_result:" + json.dumps({"rerun_id": "gcd_rerun_place", "status": "succeeded", "error": ""}),
    )

    assert provider.sessions[session_id].phase == "operation"


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


def test_rerun_fails_closed_when_mock_codex_times_out(tmp_path: Path) -> None:
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
    (config / "dreamplace.json").write_text('{"target_density": 0.2}', encoding="utf-8")
    events: list[dict[str, object]] = []

    def mock_codex_timeout(_context: dict[str, object]) -> None:
        raise CodexProviderError("mock timeout", failure_class="timeout")

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=mock_codex_timeout,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    for message in ("2", "1", "1", "reduce density"):
        _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "rerun_parameter"
    assert "mock timeout" in _last_event(events, "error")["text"]
    assert not any(event["type"] in {"contract", "workspace_rerun"} for event in events)


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
    filelist_choice = _last_event(events, "choice")["choice"]
    assert filelist_choice["allowFreeText"] is True
    assert filelist_choice["variant"] == "buttons"
    assert [option["label"] for option in filelist_choice["options"]] == [
        "Use recommended path",
        "Skip",
    ]
    assert filelist_choice["options"][0]["value"] == display_path(str(filelist))
    assert filelist_choice["options"][1]["value"] == EMPTY_CHOICE_VALUE
    assert _last_event(events, "status")["status"] == "awaiting_choice"

    _send(provider, session_id, EMPTY_CHOICE_VALUE)

    assert session.phase == "workspace_sdc"
    assert session.workspace_inputs.filelist_path == ""
    sdc_choice = _last_event(events, "choice")["choice"]
    assert sdc_choice["options"][0]["value"] == display_path(str(sdc))
    assert sdc_choice["options"][1]["value"] == EMPTY_CHOICE_VALUE

    _send(provider, session_id, str(sdc))
    assert session.phase == "workspace_pdk"
    pdk_choice = _last_event(events, "choice")["choice"]
    assert [option["label"] for option in pdk_choice["options"]] == ["Use recommended path"]
    assert pdk_choice["options"][0]["value"] == display_path(str(pdk))

    _send(provider, session_id, pdk_choice["options"][0]["value"])
    assert session.phase == "workspace_top"
    top_choice = _last_event(events, "choice")["choice"]
    assert top_choice["options"][0]["label"].startswith("Use default:")
    assert top_choice["allowFreeText"] is True


def test_operation_and_cancellation_choices_preserve_the_controlled_paths() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]

    operation = _last_event(events, "choice")["choice"]
    assert operation["title"] == "Choose an operation"
    assert operation["variant"] == "list"
    assert [option["value"] for option in operation["options"]] == ["1"]

    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-1"
    _send(provider, session_id, "2")

    assert session.phase == "operation"
    assert not any(event["type"] == "workspace_create" for event in events)
    assert "Cancelled" in str(_last_event(events, "message")["text"])

    session.phase = "confirmation"
    _send(provider, session_id, "2")

    assert session.phase == "operation"
    assert not any(event["type"] == "workspace_rerun" for event in events)


def test_running_turn_can_be_interrupted_and_the_session_accepts_another_message(
    tmp_path: Path,
) -> None:
    events: list[dict[str, object]] = []
    started = threading.Event()
    release = threading.Event()
    errors: list[Exception] = []

    def blocking_parser(context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        register_interrupt = context["_register_interrupt"]
        assert callable(register_interrupt)
        register_interrupt(release.set)
        started.set()
        assert release.wait(timeout=2)
        return _proposal(target_overflow=0.1)

    provider = EcosAgentProvider(emit=events.append, workspace_setup_parser=blocking_parser)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_overflow"
    session.workspace_inputs.project_root = str(tmp_path)

    def send_blocking_message() -> None:
        try:
            _send(provider, session_id, "set target overflow to 0.1")
        except Exception as exc:  # pragma: no cover - retained for thread diagnostics
            errors.append(exc)

    turn = threading.Thread(target=send_blocking_message)
    turn.start()
    assert started.wait(timeout=2)

    provider.interrupt({"sessionId": session_id})
    turn.join(timeout=2)

    assert not turn.is_alive()
    assert errors == []
    assert session.running is False
    assert _last_event(events, "status")["status"] == "interrupted"
    assert not any(event["type"] == "workspace_setup" for event in events)

    _send(provider, session_id, "0.1")

    assert sum(
        event["type"] == "status" and event.get("status") == "running"
        for event in events
    ) == 2


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
    operation = _last_event(events, "choice")["choice"]
    assert [option["value"] for option in operation["options"]] == ["1", "2", "3", "4"]


def test_standalone_workspace_hides_create_sibling_option(tmp_path: Path) -> None:
    workspace = tmp_path / "orphan_ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    provider.start_session({"directory": str(workspace), "mode": "workspace"})
    operation = _last_event(events, "choice")["choice"]
    assert [option["value"] for option in operation["options"]] == ["1", "2", "3"]


def test_existing_project_branch_requires_project_json_and_uses_workspace_name(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    (project_root / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {
            "mode": "home",
            "knownProjects": [{"name": "projects", "path": str(project_root)}],
        }
    )["sessionId"]

    _send(provider, session_id, "1")
    assert provider.sessions[session_id].phase == "workspace_project_mode"
    mode_choice = _last_event(events, "choice")["choice"]
    assert [option["value"] for option in mode_choice["options"]] == ["1", "2"]

    _send(provider, session_id, "1")
    assert provider.sessions[session_id].phase == "workspace_project_root"
    known = _last_event(events, "choice")["choice"]
    assert known["options"][0]["value"] == str(project_root)

    _send(provider, session_id, str(project_root))
    assert provider.sessions[session_id].phase == "workspace_name"
    _send(provider, session_id, "ws_0003")
    assert provider.sessions[session_id].phase == "workspace_design"
    _send(provider, session_id, "gcd")
    assert provider.sessions[session_id].phase == "workspace_flow_end"
    assert provider.sessions[session_id].workspace_setup.workspace_name == "ws_0003"
    assert provider.sessions[session_id].workspace_setup.design_name == "gcd"


def test_workspace_mode_option_four_prefills_project_root(tmp_path: Path) -> None:
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

    _send(provider, session_id, "4")
    session = provider.sessions[session_id]
    assert session.phase == "workspace_name"
    assert session.workspace_inputs.project_root == str(project)


def test_tool_streaming_reuses_one_message_id_for_all_turn_deltas(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []

    def streaming_parser(context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        progress = context["_progress_callback"]
        assert callable(progress)
        progress("Inspecting bounded inputs.")
        progress("Validating the structured proposal.")
        return _proposal(target_overflow=0.1)

    provider = EcosAgentProvider(emit=events.append, workspace_setup_parser=streaming_parser)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_overflow"
    session.workspace_inputs.project_root = str(tmp_path)

    _send(provider, session_id, "set target overflow to 0.1")

    tool_events = [event for event in events if event["type"] == "tool"]
    assert [event["delta"] for event in tool_events] == [
        "Inspecting bounded inputs.\n",
        "Validating the structured proposal.\n",
    ]
    assert len({event["messageId"] for event in tool_events}) == 1
