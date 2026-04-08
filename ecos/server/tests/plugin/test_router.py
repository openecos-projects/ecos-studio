from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from ecos_server.main import app
from ecos_server.plugin.schemas import ToolRegistry

SAMPLE_REGISTRY = {
    "schema_version": 1,
    "tools": [
        {
            "name": "yosys",
            "display_name": "Yosys",
            "description": "RTL synthesis",
            "category": "synthesis",
            "homepage": "https://github.com/YosysHQ/yosys",
            "versions": [
                {
                    "version": "0.61",
                    "platforms": {
                        "linux-x86_64": {
                            "url": "https://example.com/yosys.tar.gz",
                            "sha256": "abc123",
                            "size": 52428800,
                        }
                    },
                }
            ],
        }
    ],
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_list_tools_empty_registry(client: TestClient) -> None:
    with patch(
        "ecos_server.plugin.router._registry.fetch",
        new_callable=AsyncMock,
        return_value=None,
    ):
        resp = client.get("/plugin/tools")
        assert resp.status_code == 200
        assert resp.json() == []


def test_list_tools_with_registry(client: TestClient) -> None:
    registry = ToolRegistry(**SAMPLE_REGISTRY)
    with patch(
        "ecos_server.plugin.router._registry.fetch",
        new_callable=AsyncMock,
        return_value=registry,
    ), patch(
        "ecos_server.plugin.router._manager.get_installed",
        return_value={},
    ):
        resp = client.get("/plugin/tools")
        assert resp.status_code == 200
        tools = resp.json()
        assert len(tools) == 1
        assert tools[0]["name"] == "yosys"
        assert tools[0]["status"] == "available"


def test_get_tool_status_not_found(client: TestClient) -> None:
    registry = ToolRegistry(schema_version=1, tools=[])
    with patch(
        "ecos_server.plugin.router._registry.fetch",
        new_callable=AsyncMock,
        return_value=registry,
    ), patch(
        "ecos_server.plugin.router._manager.get_installed",
        return_value={},
    ):
        resp = client.get("/plugin/tools/nonexistent/status")
        assert resp.status_code == 404


def test_refresh_registry(client: TestClient) -> None:
    registry = ToolRegistry(**SAMPLE_REGISTRY)
    with patch(
        "ecos_server.plugin.router._registry.fetch",
        new_callable=AsyncMock,
        return_value=registry,
    ):
        resp = client.post("/plugin/registry/refresh")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
