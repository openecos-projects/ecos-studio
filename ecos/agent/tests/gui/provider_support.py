import json
from pathlib import Path

from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.workspace.contracts import GuiWorkspaceSetupProposal


def proposal(**overrides: object) -> GuiWorkspaceSetupProposal:
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


def chat_response(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": "flow-agent.gui_chat_response.v1",
        "operation": None,
        "answer": "I can help with ECOS design-flow questions.",
    }
    payload.update(overrides)
    return payload


def send_session_input(provider: EcosAgentProvider, session_id: str, message: str) -> None:
    session = provider.sessions[session_id]
    pending = session.pending_interaction
    if pending is None:
        provider.send_message({"sessionId": session_id, "message": message})
        return
    request = pending["request"]
    if request["kind"] == "form":
        form_value = message
        if (not message or message == "1") and request["interaction"]["fields"][0].get(
            "defaultValue"
        ):
            form_value = request["interaction"]["fields"][0]["defaultValue"]
        provider.answer_interaction(
            {
                "sessionId": session_id,
                "requestId": request["requestId"],
                "kind": "form",
                "values": {"value": form_value},
            }
        )
        return
    for option_id, value in pending["values"].items():
        if value == message:
            provider.answer_interaction(
                {
                    "sessionId": session_id,
                    "requestId": request["requestId"],
                    "kind": request["kind"],
                    "optionId": option_id,
                }
            )
            return
    session.pending_interaction = None
    provider.send_message({"sessionId": session_id, "message": message})


def last_event(events: list[dict[str, object]], event_type: str) -> dict[str, object]:
    event = next(event for event in reversed(events) if event["type"] == event_type)
    if event_type != "interaction":
        return event
    request = event["interaction"]
    payload = dict(request["interaction"])
    payload["title"] = request["title"]
    payload["requestId"] = request["requestId"]
    return {**event, "interaction": payload}


def write_workspace_inputs(root: Path) -> tuple[Path, Path, Path, Path]:
    rtl = root / "gcd.v"
    filelist = root / "gcd.f"
    sdc = root / "gcd.sdc"
    pdk = root / "pdk"
    rtl.write_text("module gcd(input clk); endmodule\n", encoding="utf-8")
    filelist.write_text("gcd.v\n", encoding="utf-8")
    sdc.write_text("create_clock -period 10 [get_ports clk]\n", encoding="utf-8")
    pdk.mkdir()
    return rtl, filelist, sdc, pdk


def workspace_with_fixfanout_and_place(tmp_path: Path) -> Path:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        json.dumps(
            {
                "steps": [
                    {"name": "fixFanout", "tool": "ecc", "state": "Success"},
                    {"name": "place", "tool": "dreamplace", "state": "Success"},
                ]
            }
        ),
        encoding="utf-8",
    )
    for step, tool, suffix in (
        ("fixFanout", "ecc", ".def.gz"),
        ("place", "dreamplace", ".def.gz"),
    ):
        output = workspace / f"{step}_{tool}" / "output"
        output.mkdir(parents=True)
        (output / f"gcd_{step}{suffix}").write_bytes(b"def")
    config = workspace / "config"
    config.mkdir()
    (config / "dreamplace_ecc.json").write_text(
        '{"target_density": 0.55, "routability_opt_flag": true, "stop_overflow": 0.1}',
        encoding="utf-8",
    )
    (workspace / "home" / "parameters.json").write_text(
        '{"Design": "gcd", "Target density": 0.55}',
        encoding="utf-8",
    )
    return workspace
