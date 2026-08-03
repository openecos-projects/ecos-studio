import json
from pathlib import Path

from ecos_agent.codex_provider import CodexProviderError
from ecos_agent.contracts import GuiWorkspaceSetupProposal
from ecos_agent.provider import EcosAgentProvider, PROVIDER_ID
from ecos_agent.workspace_rerun import GuiWorkspaceRerunResolver


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


def test_run_flow_only_emits_a_frozen_workspace_contract(tmp_path: Path) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, pdk = _write_workspace_inputs(tmp_path)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=lambda _context: _proposal(),
        workspace_path_recommender=lambda _context: _proposal(),
        workspace_root=project_root,
    )

    session_id = provider.start_session({})["sessionId"]
    for message in (
        "1",
        str(project_root),
        "4",
        "gcd",
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
        "",
    ):
        _send(provider, session_id, message)

    setup = next(event["workspaceSetup"] for event in events if event["type"] == "workspace_setup")
    assert PROVIDER_ID == "ecos_agent"
    assert "execute" not in provider.__dict__
    assert setup["schema_version"] == "flow-agent.workspace_setup_contract.v2"
    assert setup["directory"] == str(project_root / "gcd")

    _send(provider, session_id, "1")

    assert events[-1]["type"] == "workspace_create"
    assert events[-1]["providerId"] == "ecos_agent"


def test_rerun_requires_an_explicit_workspace_root(monkeypatch) -> None:
    monkeypatch.delenv("ECOS_AGENT_WORKSPACE_ROOT", raising=False)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session({})["sessionId"]
    _send(provider, session_id, "2")
    _send(provider, session_id, "gcd")

    assert provider.sessions[session_id].phase == "rerun_design"
    assert events[-2]["type"] == "error"
    assert "ECOS_AGENT_WORKSPACE_ROOT is required" in events[-2]["text"]
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
    (config / "dreamplace.json").write_text('{"target_density": 0.2}', encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_rerun_resolver=GuiWorkspaceRerunResolver(tmp_path),
        rerun_parameter_parser=lambda _context: {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [{"knob_id": "place.target_density", "value": 0.55}],
            "summary": "Reduce density.",
        },
    )

    session_id = provider.start_session({})["sessionId"]
    for message in ("2", "gcd", "1", "reduce density", "2", "1"):
        _send(provider, session_id, message)

    messages = [event["text"] for event in events if event["type"] == "message"]
    assert all(str(workspace) not in text for text in messages)
    rerun = events[-1]["workspaceRerun"]
    assert events[-1]["type"] == "workspace_rerun"
    assert rerun["schema_version"] == "flow-agent.workspace_rerun_contract.v1"
    assert rerun["execution_scope"] == "full_flow"
    assert rerun["end_step"] == "place"
    assert rerun["parameter_patch"] == [{"knob_id": "place.target_density", "value": 0.55}]

    _send(
        provider,
        session_id,
        "workspace_rerun_result:" + json.dumps({"rerun_id": "gcd_rerun_place", "status": "succeeded", "error": ""}),
    )

    assert provider.sessions[session_id].phase == "operation"


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
        workspace_rerun_resolver=GuiWorkspaceRerunResolver(tmp_path),
        rerun_parameter_parser=mock_codex_timeout,
    )
    session_id = provider.start_session({})["sessionId"]
    for message in ("2", "gcd", "1", "reduce density"):
        _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "rerun_parameter"
    assert events[-2]["type"] == "error"
    assert "mock timeout" in events[-2]["text"]
    assert not any(event["type"] in {"contract", "workspace_rerun"} for event in events)
