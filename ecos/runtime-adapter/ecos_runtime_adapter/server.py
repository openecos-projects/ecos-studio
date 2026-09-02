from collections.abc import Callable

from jsonrpcserver import Error

from ecos_runtime_adapter import methods
from ecos_runtime_adapter.errors import RuntimeApiError
from ecos_runtime_adapter.requests import RequestValidationError, parse_request_model
from ecos_runtime_adapter.rpc_dispatch import RpcDispatcher
from ecos_runtime_adapter.workspace_api import WorkspaceRuntimeApi

ERROR_CODES = {
    "workspace_session_not_found": -32010,
    "command_failed": -32020,
    "invalid_request": -32602,
}


class RuntimeServer:
    def __init__(
        self,
        api: WorkspaceRuntimeApi | None = None,
        *,
        persistent_db_enabled: bool = False,
    ):
        self.persistent_db_enabled = persistent_db_enabled
        self.dispatcher = RpcDispatcher()
        self.api = api or WorkspaceRuntimeApi(persistent_db_enabled=persistent_db_enabled)
        self._notification_sink: Callable[[str, dict], None] | None = None
        set_event_publisher = getattr(self.api, "set_event_publisher", None)
        if callable(set_event_publisher):
            set_event_publisher(self._publish_runtime_event)
        self._register_runtime_methods()

    def dispatch(self, payload: bytes | str) -> str:
        return self.dispatcher.dispatch(payload)

    def set_notification_sink(self, sink: Callable[[str, dict], None] | None) -> None:
        self._notification_sink = sink

    def _publish_runtime_event(self, event: dict) -> None:
        sink = self._notification_sink
        if sink is not None:
            sink("runtime.event", _project_runtime_event(event))

    def _register_runtime_methods(self) -> None:
        for spec in methods.runtime_methods(
            persistent_db_enabled=self.persistent_db_enabled,
        ):
            api_method = getattr(self.api, spec.handler_name, None)
            if not callable(api_method):
                raise TypeError(
                    f"runtime method {spec.method_name} handler {spec.handler_name} is not callable"
                )
            self.dispatcher.add_method(
                spec.method_name,
                self._runtime_method_handler(spec, api_method),
            )

    def _runtime_method_handler(self, spec, api_method):
        def handler(**params):
            try:
                request = parse_request_model(spec.request_model, params)
            except RequestValidationError as exc:
                return Error(
                    -32602,
                    "invalid_request",
                    {"message": exc.reason},
                )

            try:
                return api_method(request)
            except RuntimeApiError as exc:
                return Error(
                    ERROR_CODES.get(exc.code, -32000),
                    exc.code,
                    {"message": exc.message, **exc.data},
                )
            except Exception as exc:
                return Error(
                    ERROR_CODES["command_failed"],
                    "command_failed",
                    {"message": str(exc)},
                )

        return handler


def _project_runtime_event(event: dict) -> dict:
    source_type = str(event.get("type", ""))
    payload = {**event.get("payload", {}), "sourceType": source_type}
    if source_type == "step.completed":
        event_type = "workspace.committed"
    elif source_type in {"step.started", "step.log", "subflow.stage", "operation.rerun_prepared"}:
        event_type = "execution.progress"
    else:
        event_type = "operation.changed"
        state = {
            "operation.queued": "queued",
            "operation.started": "running",
            "operation.completed": "succeeded",
            "operation.failed": "failed",
            "operation.cancelled": "cancelled",
        }.get(source_type)
        if state:
            payload["state"] = state
    return {
        **event,
        "type": event_type,
        "payload": payload,
        **(
            {"workspaceRevision": payload["workspaceRevision"]}
            if "workspaceRevision" in payload
            else {}
        ),
    }
