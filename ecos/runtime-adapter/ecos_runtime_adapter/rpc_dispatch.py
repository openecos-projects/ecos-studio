from collections.abc import Callable
from functools import wraps
from typing import Any

from jsonrpcserver import Success, dispatch
from oslash.either import Left, Right

from ecos_runtime_adapter.events import redirect_stdout_to_stderr

JsonRpcHandler = Callable[..., Any]


class RpcDispatcher:
    def __init__(self):
        self._methods: dict[str, JsonRpcHandler] = {}

    def add_method(self, name: str, handler: JsonRpcHandler) -> None:
        self._methods[name] = self._wrap_handler(handler)

    def method(self, name: str) -> Callable[[JsonRpcHandler], JsonRpcHandler]:
        def decorator(handler: JsonRpcHandler) -> JsonRpcHandler:
            self.add_method(name, handler)
            return handler

        return decorator

    def dispatch(self, payload: bytes | str) -> str:
        request_text = payload.decode("utf-8") if isinstance(payload, bytes) else payload
        return dispatch(request_text, methods=self._methods)

    def _wrap_handler(self, handler: JsonRpcHandler) -> JsonRpcHandler:
        @wraps(handler)
        def wrapped(*args: Any, **kwargs: Any):
            with redirect_stdout_to_stderr():
                result = handler(*args, **kwargs)
            if isinstance(result, Left | Right):
                return result
            return Success(result)

        return wrapped
