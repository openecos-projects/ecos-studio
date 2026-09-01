import json

from ecos_runtime_adapter.rpc_dispatch import RpcDispatcher


def _dispatch(dispatcher: RpcDispatcher, payload: str) -> dict:
    return json.loads(dispatcher.dispatch(payload))


def test_dispatch_registered_method_returns_standard_success_response():
    dispatcher = RpcDispatcher()
    dispatcher.add_method("rpc.ping", lambda: {"ok": True})

    response = _dispatch(
        dispatcher,
        '{"jsonrpc":"2.0","method":"rpc.ping","id":1}',
    )

    assert response == {"jsonrpc": "2.0", "result": {"ok": True}, "id": 1}


def test_unknown_method_returns_standard_method_not_found_error():
    dispatcher = RpcDispatcher()

    response = _dispatch(
        dispatcher,
        '{"jsonrpc":"2.0","method":"missing","id":"req-1"}',
    )

    assert response["jsonrpc"] == "2.0"
    assert response["id"] == "req-1"
    assert response["error"]["code"] == -32601
    assert response["error"]["message"] == "Method not found"


def test_invalid_params_return_standard_invalid_params_error():
    dispatcher = RpcDispatcher()

    def needs_name(name: str) -> dict:
        return {"name": name}

    dispatcher.add_method("needsName", needs_name)

    response = _dispatch(
        dispatcher,
        '{"jsonrpc":"2.0","method":"needsName","params":{"missing":"x"},"id":2}',
    )

    assert response["id"] == 2
    assert response["error"]["code"] == -32602
    assert response["error"]["message"] == "Invalid params"


def test_parse_error_uses_json_rpc_parse_error_shape():
    dispatcher = RpcDispatcher()

    response = _dispatch(dispatcher, "{")

    assert response["id"] is None
    assert response["error"]["code"] == -32700
    assert response["error"]["message"] == "Parse error"


def test_custom_non_json_rpc_envelope_is_rejected():
    dispatcher = RpcDispatcher()
    dispatcher.add_method("rpc.ping", lambda: {"ok": True})

    response = _dispatch(dispatcher, '{"type":"request","method":"rpc.ping","id":1}')

    assert response["id"] is None
    assert response["error"]["code"] == -32600
