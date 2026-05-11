import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from ecos_server.main import app
from ecos_server.resource.inventory import InventoryService, PdkInventoryEntry
from ecos_server.resource.registry import RegistryService, RegistryState
from ecos_server.resource.router import (
    _inventory,
    _job_tracker,
    _pdk_service,
    _registry_service,
    _tool_service,
    init_registry,
)
from ecos_server.resource.tools import ToolResourceService
from ecos_server.resource.schemas import (
    PlatformAsset,
    RegistryTool,
    RegistryToolVersion,
    ToolRegistry,
)


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Create a test client with temp-path services."""
    rm = tmp_path / "resources" / "manifest.json"
    tm = tmp_path / "tools" / "manifest.json"

    # Replace module-level services with temp-path versions
    import ecos_server.resource.router as router_mod

    inventory = InventoryService(resource_manifest_path=rm, tools_manifest_path=tm)
    router_mod._inventory = inventory
    router_mod._pdk_service._inventory = inventory
    router_mod._tool_service._inventory = inventory
    router_mod._job_tracker = type(router_mod._job_tracker)()
    router_mod._registry_service = None

    init_registry("https://registry.example.com/tool-registry.json")

    return TestClient(app)


def _mock_registry_data() -> dict:
    return {
        "schema_version": 2,
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
                        "requires": [],
                    }
                ],
            }
        ],
    }


def _mock_async_client(response_data: dict) -> MagicMock:
    resp = MagicMock()
    resp.json.return_value = response_data
    resp.raise_for_status.return_value = None
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def _patch_registry(client: TestClient, data: dict) -> None:
    """Replace the router's registry service with one that returns fixture data."""
    import ecos_server.resource.router as router_mod
    from ecos_server.resource.registry import RegistryService as RS

    registry = ToolRegistry(**data)
    mock_rs = MagicMock(spec=RS)
    mock_rs.fetch = AsyncMock(return_value=RegistryState(registry=registry, diagnostics=[]))
    mock_rs.refresh = AsyncMock(return_value=RegistryState(registry=registry, diagnostics=[]))
    mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
    router_mod._registry_service = mock_rs


class TestListResources:
    def test_list_empty_registry(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.get("/api/resources")
        assert resp.status_code == 200
        data = resp.json()
        assert data["resources"] == []

    def test_list_tools_from_registry(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.get("/api/resources")
        assert resp.status_code == 200
        data = resp.json()
        tools = [r for r in data["resources"] if r["type"] == "tool"]
        assert len(tools) == 1
        assert tools[0]["id"] == "tool:yosys"
        assert tools[0]["status"] == "available"
        assert "install" in tools[0]["actions"]

    def test_list_with_imported_pdks(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.get("/api/resources")
        assert resp.status_code == 200
        data = resp.json()
        pdks = [r for r in data["resources"] if r["type"] == "pdk"]
        assert len(pdks) == 1
        assert pdks[0]["id"] == "pdk:ics55"

    def test_list_includes_diagnostics(self, client: TestClient) -> None:
        # Simulate degraded registry state
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["diagnostics"]) >= 1


class TestGetResource:
    def test_get_tool(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.get("/api/resources/tool:yosys")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "tool:yosys"
        assert data["type"] == "tool"

    def test_get_pdk(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.get("/api/resources/pdk:ics55")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "pdk:ics55"
        assert data["type"] == "pdk"

    def test_get_unknown_resource_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.get("/api/resources/tool:nonexistent")
        assert resp.status_code == 404

    def test_get_resource_invalid_prefix_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.get("/api/resources/invalid:thing")
        assert resp.status_code == 404


class TestInstall:
    def test_install_returns_accepted(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.post("/api/resources/tool:yosys/install")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "installing"
        assert data["resource_id"] == "tool:yosys"

    def test_install_duplicate_409(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        _patch_registry(client, _mock_registry_data())
        # First request starts the install
        resp1 = client.post("/api/resources/tool:yosys/install")
        assert resp1.status_code == 200
        # Manually mark job as still active (simulating in-progress install)
        router_mod._job_tracker._active["tool:yosys"] = type(
            router_mod._job_tracker._active.get("tool:yosys", None)
        )
        # Use start() instead for proper metadata
        router_mod._job_tracker.finish("tool:yosys")
        router_mod._job_tracker.start("tool:yosys", action=ResourceAction.install)
        resp2 = client.post("/api/resources/tool:yosys/install")
        assert resp2.status_code == 409
        detail = resp2.json()["detail"]
        assert detail["resource_id"] == "tool:yosys"
        assert detail["status"] == "conflict"
        assert detail["existing_job_id"] is not None
        router_mod._job_tracker.finish("tool:yosys")

    def test_install_unknown_tool_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.post("/api/resources/tool:nonexistent/install")
        assert resp.status_code == 404

    def test_install_pdk_rejected_400(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post("/api/resources/pdk:ics55/install")
        assert resp.status_code == 400


class TestUninstall:
    def test_uninstall_not_installed_404(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.post("/api/resources/tool:yosys/uninstall")
        assert resp.status_code == 404

    def test_uninstall_pdk_rejected_400(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post("/api/resources/pdk:ics55/uninstall")
        assert resp.status_code == 400


class TestPdkRoutes:
    def test_scan_pdk(self, client: TestClient) -> None:
        pdk_dir = _make_pdk_dir()
        resp = client.post("/api/resources/pdks/scan", json={"path": str(pdk_dir)})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "ics55"
        assert "prtech" in data["detected_files"]

    def test_scan_empty_path_400(self, client: TestClient) -> None:
        resp = client.post("/api/resources/pdks/scan", json={"path": ""})
        assert resp.status_code == 400

    def test_import_pdk(self, client: TestClient) -> None:
        pdk_dir = _make_pdk_dir()
        resp = client.post("/api/resources/pdks/import", json={"path": str(pdk_dir)})
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "pdk:ics55"

    def test_activate_pdk(self, client: TestClient) -> None:
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post("/api/resources/pdk:ics55/activate")
        assert resp.status_code == 200
        assert _pdk_service.get_pdk("ics55").active is True

    def test_activate_nonexistent_404(self, client: TestClient) -> None:
        resp = client.post("/api/resources/pdk:nope/activate")
        assert resp.status_code == 404

    def test_validate_pdk(self, client: TestClient) -> None:
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post("/api/resources/pdk:ics55/validate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["health"] == "ok"

    def test_delete_pdk_reference(self, client: TestClient) -> None:
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.delete("/api/resources/pdk:ics55")
        assert resp.status_code == 200
        assert _pdk_service.get_pdk("ics55") is None

    def test_delete_pdk_preserves_source(self, client: TestClient) -> None:
        pdk_dir = _make_pdk_dir()
        _pdk_service.import_pdk(str(pdk_dir))
        client.delete("/api/resources/pdk:ics55")
        assert pdk_dir.exists()


class TestRegistryRefresh:
    def test_refresh_registry(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.post("/api/resources/registry/refresh")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["tools_count"] == 1


class TestBatch:
    def test_batch_empty(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.post("/api/resources/batch", json={"operations": []})
        assert resp.status_code == 200
        assert resp.json()["results"] == []

    def test_batch_invalid_operation(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.post("/api/resources/batch", json={"operations": [{}]})
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 400

    def test_batch_unsupported_action(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": "unknown_op"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 400

    def test_batch_remove_pdk_reference(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": "remove_reference"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 200
        assert _pdk_service.get_pdk("ics55") is None


class TestDoctor:
    def test_doctor_ok(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.get("/api/resources/doctor")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "diagnostics" in data
        assert data["stats"]["registry_tools"] == 1

    def test_doctor_degraded(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS, RegistryState

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources/doctor")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "degraded"


class TestPdkDelete:
    def test_delete_pdk_by_id(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.delete("/api/resources/pdks/ics55")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "removed"
        assert data["resource_id"] == "pdk:ics55"

    def test_delete_pdk_by_id_preserves_source(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        pdk_dir = _make_pdk_dir()
        _pdk_service.import_pdk(str(pdk_dir))
        resp = client.delete("/api/resources/pdks/ics55")
        assert resp.status_code == 200
        assert pdk_dir.exists()

    def test_delete_nonexistent_pdk_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.delete("/api/resources/pdks/nonexistent")
        assert resp.status_code == 404


def _make_pdk_dir() -> Path:
    """Create a real temp PDK directory for router integration tests."""
    import tempfile
    pdk_dir = Path(tempfile.mkdtemp(prefix="ecos_test_pdk_"))
    (pdk_dir / "prtech").mkdir()
    (pdk_dir / "IP").mkdir()
    (pdk_dir / "libs.ref").write_text("tech.lef")
    return pdk_dir
