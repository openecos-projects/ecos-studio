import json

import pytest
from ecos_runtime_adapter.methods import RUNTIME_METHODS, runtime_methods
from ecos_runtime_adapter.requests import (
    DbEnsureRequest,
    DbReleaseRequest,
    WorkspaceExportSignoffRequest,
    WorkspaceSpecOpenRequest,
)
from ecos_runtime_adapter.server import RuntimeServer, _project_runtime_event
from ecos_runtime_adapter.workspace_api import RuntimeApiError


def _dispatch(server: RuntimeServer, payload: str) -> dict:
    return json.loads(server.dispatch(payload))


class CompleteFakeApi:
    def describe_workspace_spec(self, _request):
        raise AssertionError("unexpected describe_workspace_spec call")

    def validate_workspace_spec(self, _request):
        raise AssertionError("unexpected validate_workspace_spec call")

    def discover_project(self, _request):
        raise AssertionError("unexpected discover_project call")

    def load_project_manifest(self, _request):
        raise AssertionError("unexpected load_project_manifest call")

    def mutate_project_manifest(self, _request):
        raise AssertionError("unexpected mutate_project_manifest call")

    def create_workspace(self, _request):
        raise AssertionError("unexpected create_workspace call")

    def open_workspace(self, _request):
        raise AssertionError("unexpected open_workspace call")

    def workspace_binding_requirement(self, _request):
        raise AssertionError("unexpected workspace_binding_requirement call")

    def update_workspace(self, _request):
        raise AssertionError("unexpected update_workspace call")

    def update_workspace_configuration(self, _request):
        raise AssertionError("unexpected update_workspace_configuration call")

    def update_workspace_step_configuration(self, _request):
        raise AssertionError("unexpected update_workspace_step_configuration call")

    def read_workspace_step_configuration(self, _request):
        raise AssertionError("unexpected read_workspace_step_configuration call")

    def close_workspace(self, _request):
        raise AssertionError("unexpected close_workspace call")

    def workspace_home(self, _request):
        raise AssertionError("unexpected workspace_home call")

    def workspace_info(self, _request):
        raise AssertionError("unexpected workspace_info call")

    def refresh_config(self, _request):
        raise AssertionError("unexpected refresh_config call")

    def reset_flow(self, _request):
        raise AssertionError("unexpected reset_flow call")

    def export_signoff(self, _request):
        raise AssertionError("unexpected export_signoff call")

    def flow_run(self, _request):
        raise AssertionError("unexpected flow_run call")

    def flow_run_step(self, _request):
        raise AssertionError("unexpected flow_run_step call")

    def start_flow_operation(self, _request):
        raise AssertionError("unexpected start_flow_operation call")

    def start_step_operation(self, _request):
        raise AssertionError("unexpected start_step_operation call")

    def operation_status(self, _request):
        raise AssertionError("unexpected operation_status call")

    def cancel_operation(self, _request):
        raise AssertionError("unexpected cancel_operation call")

    def workspace_snapshot(self, _request):
        raise AssertionError("unexpected workspace_snapshot call")

    def engineering_snapshot(self, _request):
        raise AssertionError("unexpected engineering_snapshot call")

    def recover_interrupted(self, _request):
        raise AssertionError("unexpected recover_interrupted call")

    def db_ensure(self, _request):
        raise AssertionError("unexpected db_ensure call")

    def db_release(self, _request):
        raise AssertionError("unexpected db_release call")

    def layout_edit_begin(self, _request):
        raise AssertionError("unexpected layout_edit_begin call")

    def layout_edit_apply(self, _request):
        raise AssertionError("unexpected layout_edit_apply call")

    def layout_edit_save(self, _request):
        raise AssertionError("unexpected layout_edit_save call")

    def layout_edit_discard(self, _request):
        raise AssertionError("unexpected layout_edit_discard call")

    def floorplan_edit_inspect(self, _request):
        raise AssertionError("unexpected floorplan_edit_inspect call")

    def floorplan_edit_run_auto(self, _request):
        raise AssertionError("unexpected floorplan_edit_run_auto call")

    def floorplan_edit_validate(self, _request):
        raise AssertionError("unexpected floorplan_edit_validate call")


def test_runtime_events_are_projected_to_the_supported_event_types():
    server = RuntimeServer()
    events = []
    server.set_notification_sink(lambda _method, event: events.append(event))

    base = {
        "eventId": "event-1",
        "operationId": "operation-1",
        "origin": "gui",
        "payload": {"step": "place", "workspaceRevision": 2},
        "sequence": 1,
        "timestamp": 1,
        "workspaceId": "workspace-1",
    }
    for event_type in (
        "operation.started",
        "step.started",
        "step.completed",
    ):
        server._publish_runtime_event({**base, "type": event_type})

    assert [event["type"] for event in events] == [
        "operation.changed",
        "execution.progress",
        "workspace.committed",
    ]
    assert events[-1]["workspaceRevision"] == 2


def test_rerun_preparation_projection_carries_its_committed_revision():
    event = _project_runtime_event(
        {
            "eventId": "event-1",
            "operationId": "operation-1",
            "origin": "gui",
            "payload": {"workspaceRevision": 3},
            "sequence": 1,
            "timestamp": 1,
            "type": "operation.rerun_prepared",
            "workspaceId": "workspace-1",
        }
    )

    assert event["type"] == "execution.progress"
    assert event["payload"]["workspaceRevision"] == 3
    assert event["workspaceRevision"] == 3


def test_cancel_request_projection_preserves_the_active_operation_state():
    event = _project_runtime_event(
        {
            "eventId": "event-1",
            "operationId": "operation-1",
            "origin": "gui",
            "payload": {
                "cancelRequested": True,
                "state": "running",
                "workspaceRevision": 3,
            },
            "sequence": 1,
            "timestamp": 1,
            "type": "operation.cancel_requested",
            "workspaceId": "workspace-1",
        }
    )

    assert event["type"] == "operation.changed"
    assert event["payload"]["cancelRequested"] is True
    assert event["payload"]["state"] == "running"


def test_unknown_method_keeps_request_id():
    server = RuntimeServer()

    response = _dispatch(server, '{"jsonrpc":"2.0","method":"missing","id":"req"}')

    assert response["id"] == "req"
    assert response["error"]["code"] == -32601


def test_workspace_method_dispatches_typed_request_to_runtime_api():
    class FakeApi(CompleteFakeApi):
        def open_workspace(self, request):
            assert isinstance(request, WorkspaceSpecOpenRequest)
            return {"workspaceId": "workspace-1", "directory": request.directory}

    server = RuntimeServer(api=FakeApi())

    response = _dispatch(
        server,
        '{"jsonrpc":"2.0","method":"workspace.open","params":{"directory":"/ws"},"id":4}',
    )

    assert response == {
        "jsonrpc": "2.0",
        "result": {"workspaceId": "workspace-1", "directory": "/ws"},
        "id": 4,
    }


def test_workspace_export_signoff_dispatches_exact_output_path():
    class FakeApi(CompleteFakeApi):
        def export_signoff(self, request):
            assert isinstance(request, WorkspaceExportSignoffRequest)
            return {"outputPath": request.output_path}

    server = RuntimeServer(api=FakeApi())

    response = _dispatch(
        server,
        (
            '{"jsonrpc":"2.0","method":"workspace.export_signoff",'
            '"params":{"workspaceId":"workspace-1",'
            '"outputPath":"/exports/custom.tar.gz "},"id":5}'
        ),
    )

    assert response == {
        "jsonrpc": "2.0",
        "result": {"outputPath": "/exports/custom.tar.gz "},
        "id": 5,
    }


def test_persistent_db_methods_dispatch_typed_requests_to_runtime_api():
    seen = []

    class FakeApi(CompleteFakeApi):
        def db_ensure(self, request):
            seen.append(request)
            assert isinstance(request, DbEnsureRequest)
            return {
                "workspaceId": request.workspace_id,
                "enabled": True,
                "active": True,
                "reused": False,
                "step": request.step,
            }

        def db_release(self, request):
            seen.append(request)
            assert isinstance(request, DbReleaseRequest)
            return {"workspaceId": request.workspace_id, "released": True}

    server = RuntimeServer(api=FakeApi(), persistent_db_enabled=True)

    ensure_response = _dispatch(
        server,
        (
            '{"jsonrpc":"2.0","method":"db.ensure",'
            '"params":{"workspaceId":"workspace-1","step":"Floorplan"},"id":8}'
        ),
    )
    release_response = _dispatch(
        server,
        (
            '{"jsonrpc":"2.0","method":"db.release","params":{"workspaceId":"workspace-1"},"id":9}'
        ),
    )

    assert ensure_response["result"] == {
        "workspaceId": "workspace-1",
        "enabled": True,
        "active": True,
        "reused": False,
        "step": "Floorplan",
    }
    assert release_response["result"] == {
        "workspaceId": "workspace-1",
        "released": True,
    }
    assert [type(request) for request in seen] == [DbEnsureRequest, DbReleaseRequest]


def test_persistent_db_methods_are_not_registered_by_default():
    server = RuntimeServer()

    response = _dispatch(
        server,
        (
            '{"jsonrpc":"2.0","method":"db.ensure","params":{"workspaceId":"workspace-1"},"id":10}'
        ),
    )

    assert response["id"] == 10
    assert response["error"]["code"] == -32601


def test_request_validation_errors_map_to_json_rpc_invalid_params():
    server = RuntimeServer()

    response = _dispatch(
        server,
        '{"jsonrpc":"2.0","method":"workspace.home","params":{"directory":"/ws"},"id":5}',
    )

    assert response["id"] == 5
    assert response["error"]["code"] == -32602
    assert response["error"]["message"] == "invalid_request"
    assert response["error"]["data"]["message"] == "unknown field: directory"


def test_workspace_session_errors_map_to_json_rpc_runtime_error():
    class FakeApi(CompleteFakeApi):
        def workspace_home(self, _request):
            raise RuntimeApiError(
                "workspace_session_not_found",
                "workspace session not found: missing",
            )

    server = RuntimeServer(api=FakeApi())

    response = _dispatch(
        server,
        '{"jsonrpc":"2.0","method":"workspace.home","params":{"workspaceId":"missing"},"id":6}',
    )

    assert response["id"] == 6
    assert response["error"]["code"] == -32010
    assert response["error"]["message"] == "workspace_session_not_found"


def test_workspace_api_user_exceptions_map_to_command_failed():
    class FakeApi(CompleteFakeApi):
        def open_workspace(self, _request):
            raise ValueError("PDK tech LEF is missing")

    server = RuntimeServer(api=FakeApi())

    response = _dispatch(
        server,
        '{"jsonrpc":"2.0","method":"workspace.open","params":{"directory":"/ws"},"id":7}',
    )

    assert response["id"] == 7
    assert response["error"]["code"] == -32020
    assert response["error"]["message"] == "command_failed"
    assert response["error"]["data"]["message"] == "PDK tech LEF is missing"


@pytest.mark.parametrize(
    "method",
    [spec.method_name for spec in RUNTIME_METHODS],
)
def test_first_slice_methods_are_registered(method):
    server = RuntimeServer()

    response = _dispatch(server, f'{{"jsonrpc":"2.0","method":"{method}","id":1}}')

    assert response.get("error", {}).get("code") != -32601


@pytest.mark.parametrize(
    "method",
    [spec.method_name for spec in runtime_methods(persistent_db_enabled=True)],
)
def test_enabled_persistent_db_runtime_methods_are_registered(method):
    server = RuntimeServer(api=CompleteFakeApi(), persistent_db_enabled=True)

    response = _dispatch(server, f'{{"jsonrpc":"2.0","method":"{method}","id":1}}')

    assert response.get("error", {}).get("code") != -32601


def test_runtime_server_fails_when_registered_api_handler_is_missing(monkeypatch):
    from ecos_runtime_adapter import methods

    missing_spec = methods.RuntimeMethodSpec(
        method_name="workspace.missing_handler",
        request_model=WorkspaceSpecOpenRequest,
        handler_name="missing_handler",
    )
    monkeypatch.setattr(methods, "RUNTIME_METHODS", (missing_spec,))

    with pytest.raises(TypeError, match="missing_handler"):
        RuntimeServer()


def test_runtime_server_fails_when_registered_api_handler_is_not_callable(monkeypatch):
    from ecos_runtime_adapter import methods

    class FakeApi:
        open_workspace = object()

    spec = methods.RuntimeMethodSpec(
        method_name="workspace.open",
        request_model=WorkspaceSpecOpenRequest,
        handler_name="open_workspace",
    )
    monkeypatch.setattr(methods, "RUNTIME_METHODS", (spec,))

    with pytest.raises(TypeError, match="open_workspace"):
        RuntimeServer(api=FakeApi())
