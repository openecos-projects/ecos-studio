import logging
from unittest.mock import MagicMock

import pytest

from ecos_server.ecc.schemas import ECCRequest, ECCResponse, ResponseEnum
from ecos_server.ecc.services.ecc import _summarize_request, ECCService


class TestSummarizeRequest:
    def test_extracts_known_fields(self):
        data = {
            "directory": "/tmp/ws",
            "step": "Synthesis_yosys",
            "id": "timing",
            "pdk": "ics55",
            "pdk_root": "/pdk",
            "rerun": False,
        }
        result = _summarize_request(data)
        assert result == {
            "directory": "/tmp/ws",
            "step": "Synthesis_yosys",
            "id": "timing",
            "pdk": "ics55",
            "pdk_root": "/pdk",
            "rerun": False,
        }

    def test_parameters_as_key_count(self):
        data = {"parameters": {"A": 1, "B": 2, "C": 3}}
        result = _summarize_request(data)
        assert result == {"parameters_keys": 3}

    def test_rtl_list_string_as_line_count(self):
        data = {"rtl_list": "a.v\nb.v\nc.v"}
        result = _summarize_request(data)
        assert result == {"rtl_count": 3}

    def test_rtl_list_list_as_length(self):
        data = {"rtl_list": ["a.v", "b.v"]}
        result = _summarize_request(data)
        assert result == {"rtl_count": 2}

    def test_returns_empty_for_non_dict(self):
        assert _summarize_request(None) == {}
        assert _summarize_request("string") == {}

    def test_empty_dict(self):
        assert _summarize_request({}) == {}


class TestDispatch:
    """Tests for ECCService.dispatch()."""

    @pytest.fixture
    def service(self):
        return ECCService()

    def test_unknown_command_returns_error(self, service):
        request = ECCRequest(cmd="nonexistent_cmd", data={})
        response = service.dispatch(request)
        assert response.response == ResponseEnum.error.value
        assert "unknown command" in response.message[0]
        assert "nonexistent_cmd" in response.message[0]

    def test_dispatch_routes_to_correct_method(self, service, caplog):
        request = ECCRequest(cmd="set_pdk_root", data={"pdk": "ics55", "pdk_root": "/tmp"})
        with caplog.at_level(logging.INFO, logger="ecos_server.ecc.services.ecc"):
            try:
                response = service.dispatch(request)
            except Exception:
                pass  # chipcompiler not installed in test env — that's fine
        assert "[CMD:start] cmd=set_pdk_root" in caplog.text
        assert ("[CMD:done]" in caplog.text or "[CMD:error]" in caplog.text)

    def test_dispatch_logs_timing(self, service, caplog):
        request = ECCRequest(cmd="set_pdk_root", data={"pdk": "ics55", "pdk_root": "/tmp"})
        with caplog.at_level(logging.INFO, logger="ecos_server.ecc.services.ecc"):
            try:
                service.dispatch(request)
            except Exception:
                pass  # chipcompiler not installed in test env — that's fine
        assert "elapsed=" in caplog.text

    def test_dispatch_exception_logs_error_and_reraises(self, service, caplog):
        service.create_workspace = MagicMock(side_effect=RuntimeError("test boom"))
        request = ECCRequest(cmd="create_workspace", data={})
        with caplog.at_level(logging.INFO, logger="ecos_server.ecc.services.ecc"):
            with pytest.raises(RuntimeError, match="test boom"):
                service.dispatch(request)
        assert "[CMD:error] cmd=create_workspace" in caplog.text
        assert "[CMD:done]" not in caplog.text

