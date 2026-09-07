import json
from pathlib import Path

import pytest

from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.codex.provider_helpers import _allowed_operation_ids, _gui_chat_response_output_schema

from .provider_support import last_event, send_session_input


def receipt(tmp_path: Path, *, status: str = "flow_completed") -> tuple[Path, str]:
    workspace = tmp_path / "gcd" / "ws_0001"
    workspace.mkdir(parents=True)
    (workspace.parent / "project.json").write_text("{}")
    record = {
        "schema_version": "ecos.quick_start.run.v1",
        "workspace": {"path": str(workspace)},
        "flow": {"operation_id": "quick-operation"},
        "status": status,
    }
    (workspace / "quick_start_run.json").write_text(json.dumps(record))
    message = "quick_start_result:" + json.dumps({
        "workspace": str(workspace), "operation_id": "quick-operation",
    })
    return workspace, message


def test_completed_quick_start_binds_workspace_and_emits_next_actions(tmp_path: Path) -> None:
    events = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    assert last_event(events, "interaction")["interaction"]["options"][0]["id"] == "quick_start"
    workspace, message = receipt(tmp_path)

    provider.send_message({"sessionId": session_id, "message": message})

    session = provider.sessions[session_id]
    assert session.phase == "quick_start_completed"
    assert session.rerun_workspace_path == str(workspace)
    assert session.project_root == str(workspace.parent)
    assert list(session.pending_interaction["values"].values()) == [
        "optimize_current", "manual_rerun", "create_flow",
    ]
    assert [option["id"] for option in last_event(events, "interaction")["interaction"]["options"]] == [
        "optimize_current", "manual_rerun", "create_flow",
    ]
    assert [item["id"] for item in provider._chat_allowed_operations(session)] == [
        "optimize_current", "manual_rerun", "create_flow",
    ]
    before = len([event for event in events if event["type"] == "interaction"])
    provider.send_message({"sessionId": session_id, "message": message})
    assert len([event for event in events if event["type"] == "interaction"]) == before

    send_session_input(provider, session_id, "optimize_current")
    assert session.phase == "optimization_objective"
    assert session.optimization_runner is None
    provider.send_message({"sessionId": session_id, "message": message})
    assert session.phase == "optimization_objective"


@pytest.mark.parametrize("action,phase", [
    ("manual_rerun", "rerun_source_run"), ("create_flow", "workspace_project_mode"),
])
def test_completed_choices_reuse_existing_wizards(tmp_path: Path, action: str, phase: str) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, message = receipt(tmp_path)
    provider.send_message({"sessionId": session_id, "message": message})
    send_session_input(provider, session_id, action)
    assert provider.sessions[session_id].phase == phase
    assert provider.sessions[session_id].workspace_setup_id is None


def test_failed_quick_start_offers_recovery_with_confirmation(tmp_path: Path) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, message = receipt(tmp_path, status="flow_failed")
    provider.send_message({"sessionId": session_id, "message": message})
    session = provider.sessions[session_id]
    assert session.phase == "quick_start_recovery"
    assert list(session.pending_interaction["values"].values()) == ["continue_flow", "manual_rerun"]
    assert [option["id"] for option in session.pending_interaction["request"]["interaction"]["options"]] == [
        "continue_flow", "manual_rerun",
    ]
    send_session_input(provider, session_id, "continue_flow")
    assert session.phase == "workspace_continue_confirmation"


@pytest.mark.parametrize("status", ["flow_completed", "flow_failed"])
def test_stable_next_action_ids_do_not_allow_old_request_replay(tmp_path: Path, status: str) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, message = receipt(tmp_path, status=status)
    provider.send_message({"sessionId": session_id, "message": message})
    session = provider.sessions[session_id]
    previous = session.pending_interaction["request"]
    provider._emit_phase_choice(session)
    current = session.pending_interaction["request"]
    assert current["requestId"] != previous["requestId"]
    assert current["interaction"]["options"] == previous["interaction"]["options"]
    answer = {
        "sessionId": session_id, "requestId": previous["requestId"],
        "kind": "choice", "optionId": "manual_rerun",
    }
    with pytest.raises(ValueError, match="superseded"):
        provider.answer_interaction(answer)
    assert session.pending_interaction["request"] is current
    answer["requestId"] = current["requestId"]
    provider.answer_interaction(answer)
    assert session.phase == "rerun_source_run"
    with pytest.raises(ValueError, match="already answered"):
        provider.answer_interaction(answer)


@pytest.mark.parametrize("message,phase", [
    ("优化当前设计", "optimization_objective"),
    ("自己配置参数并重跑", "rerun_source_run"),
    ("运行自己的 RTL 到 GDS 流程", "workspace_project_mode"),
])
def test_next_action_natural_language_matches_card(tmp_path: Path, message: str, phase: str) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, result = receipt(tmp_path)
    provider.send_message({"sessionId": session_id, "message": result})
    send_session_input(provider, session_id, message)
    assert provider.sessions[session_id].phase == phase


def test_natural_language_parser_receives_only_completion_actions(tmp_path: Path) -> None:
    contexts = []

    def parse(context):
        contexts.append(context)
        return {"schema_version": "flow-agent.gui_chat_response.v1", "operation": "manual_rerun", "answer": None}

    provider = EcosAgentProvider(emit=lambda _event: None, chat_response_parser=parse)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, message = receipt(tmp_path)
    provider.send_message({"sessionId": session_id, "message": message})
    send_session_input(provider, session_id, "Rerun placement with a different density")
    assert contexts[-1]["phase"] == "quick_start_completed"
    assert [option["id"] for option in contexts[-1]["allowed_operations"]] == [
        "optimize_current", "manual_rerun", "create_flow",
    ]
    assert provider.sessions[session_id].phase == "rerun_source_run"


def test_codex_output_schema_limits_choices_to_the_current_caller() -> None:
    ids = _allowed_operation_ids([
        {"id": "continue_flow", "label": "Continue"},
        {"id": "manual_rerun", "label": "Rerun"},
    ])
    assert _gui_chat_response_output_schema(ids)["properties"]["operation"]["enum"] == [
        "continue_flow", "manual_rerun", None,
    ]


def test_read_only_question_keeps_completion_guide_available(tmp_path: Path) -> None:
    contexts = []

    def parse(context):
        contexts.append(context)
        return {"schema_version": "flow-agent.gui_chat_response.v1", "answer": "CTS builds the clock distribution network."}

    provider = EcosAgentProvider(emit=lambda _event: None, chat_response_parser=parse)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, message = receipt(tmp_path)
    provider.send_message({"sessionId": session_id, "message": message})
    send_session_input(provider, session_id, "What does CTS do?")
    session = provider.sessions[session_id]
    assert contexts[-1]["allowed_operations"] == []
    assert session.phase == "quick_start_completed"
    assert session.pending_interaction is not None


def test_undo_create_flow_restores_completed_workspace_context(tmp_path: Path) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    workspace, message = receipt(tmp_path)
    provider.send_message({"sessionId": session_id, "message": message})
    send_session_input(provider, session_id, "create_flow")
    session = provider.sessions[session_id]
    request = session.pending_interaction["request"]
    provider.answer_interaction({
        "sessionId": session_id, "requestId": request["requestId"],
        "kind": request["kind"], "undo": True,
    })
    assert session.mode == "workspace"
    assert session.phase == "quick_start_completed"
    assert session.rerun_workspace_path == str(workspace)
    pending = session.pending_interaction
    provider.send_message({"sessionId": session_id, "message": message})
    assert session.pending_interaction is pending


def test_result_does_not_replace_unrelated_active_wizard(tmp_path: Path) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _, message = receipt(tmp_path)
    send_session_input(provider, session_id, "2")
    session = provider.sessions[session_id]
    pending = session.pending_interaction
    with pytest.raises(ValueError, match="active workflow"):
        provider.send_message({"sessionId": session_id, "message": message})
    assert session.phase == "workspace_project_mode"
    assert session.pending_interaction is pending
    assert not session.quick_start_results


@pytest.mark.parametrize("invalid", ["missing", "running", "operation", "workspace", "schema", "relative"])
def test_invalid_terminal_receipt_does_not_replace_home_card(tmp_path: Path, invalid: str) -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    workspace, message = receipt(tmp_path)
    path = workspace / "quick_start_run.json"
    record = json.loads(path.read_text())
    if invalid == "missing":
        path.unlink()
    elif invalid == "relative":
        message = 'quick_start_result:{"workspace":"relative","operation_id":"quick-operation"}'
    else:
        if invalid == "running":
            record["status"] = "flow_running"
        elif invalid == "operation":
            record["flow"]["operation_id"] = "other"
        elif invalid == "workspace":
            record["workspace"]["path"] = str(tmp_path)
        else:
            record["schema_version"] = "untrusted"
        path.write_text(json.dumps(record))
    session = provider.sessions[session_id]
    pending = session.pending_interaction
    with pytest.raises(ValueError, match="Quick Start"):
        provider.send_message({"sessionId": session_id, "message": message})
    assert session.phase == "home_ready"
    assert session.pending_interaction is pending
    assert session.rerun_workspace_path is None
