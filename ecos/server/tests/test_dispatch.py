import contextlib
import logging
import os
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from ecos_server.ecc.schemas import ECCRequest, ResponseEnum
from ecos_server.ecc.services.ecc import ECCService, _summarize_request
from ecos_server.resource.inventory import InventoryService


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
        # chipcompiler not installed in test env — suppress import errors
        with (
            caplog.at_level(logging.INFO, logger="ecos_server.ecc.services.ecc"),
            contextlib.suppress(Exception),
        ):
            service.dispatch(request)
        assert "[CMD:start] cmd=set_pdk_root" in caplog.text
        assert "[CMD:done]" in caplog.text or "[CMD:error]" in caplog.text

    def test_dispatch_logs_timing(self, service, caplog):
        request = ECCRequest(cmd="set_pdk_root", data={"pdk": "ics55", "pdk_root": "/tmp"})
        # chipcompiler not installed in test env — suppress import errors
        with (
            caplog.at_level(logging.INFO, logger="ecos_server.ecc.services.ecc"),
            contextlib.suppress(Exception),
        ):
            service.dispatch(request)
        assert "elapsed=" in caplog.text

    def test_dispatch_exception_logs_error_and_reraises(self, service, caplog):
        service.create_workspace = MagicMock(side_effect=RuntimeError("test boom"))
        request = ECCRequest(cmd="create_workspace", data={})
        with (
            caplog.at_level(logging.INFO, logger="ecos_server.ecc.services.ecc"),
            pytest.raises(RuntimeError, match="test boom"),
        ):
            service.dispatch(request)
        assert "[CMD:error] cmd=create_workspace" in caplog.text
        assert "[CMD:done]" not in caplog.text


class TestResourceManagerToolEnvironment:
    def test_run_step_exposes_installed_yosys_to_ecc_runtime(self, tmp_path, monkeypatch):
        from chipcompiler.data import StateEnum

        tool_root = tmp_path / "tools" / "yosys" / "0.61"
        yosys_bin = tool_root / "bin" / "yosys"
        yosys_bin.parent.mkdir(parents=True)
        yosys_bin.write_text("#!/bin/sh\n", encoding="utf-8")
        yosys_bin.chmod(0o755)

        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
        monkeypatch.setenv("PATH", "/usr/bin")
        monkeypatch.delenv("CHIPCOMPILER_OSS_CAD_DIR", raising=False)

        inventory = InventoryService()
        inventory.add_tool(
            name="yosys",
            version="0.61",
            path=str(tool_root),
            sha256="abc123",
            detected_executables=["bin/yosys"],
        )

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        captured_env = {}

        class FakeEngineFlow:
            def run_step(self, step, rerun):
                captured_env["PATH"] = os.environ.get("PATH", "")
                captured_env["CHIPCOMPILER_OSS_CAD_DIR"] = os.environ.get(
                    "CHIPCOMPILER_OSS_CAD_DIR", ""
                )
                return StateEnum.Success

        service = ECCService()
        service.workspace = SimpleNamespace(directory=str(workspace_dir))
        service.engine_flow = FakeEngineFlow()

        response = service.run_step(
            ECCRequest(cmd="run_step", data={"step": "Synthesis_yosys", "rerun": False})
        )

        assert response.response == ResponseEnum.success.value
        assert captured_env["PATH"].split(os.pathsep)[0] == str(yosys_bin.parent)
        assert captured_env["CHIPCOMPILER_OSS_CAD_DIR"] == str(tool_root)
        assert os.environ["PATH"] == "/usr/bin"
        assert "CHIPCOMPILER_OSS_CAD_DIR" not in os.environ
