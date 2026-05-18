import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from ecos_server.main import app
from ecos_server.resource.inventory import InventoryService
from ecos_server.resource.registry import RegistryState
from ecos_server.resource.router import (
    _pdk_service,
    init_registry,
)
from ecos_server.resource.schemas import (
    ToolRegistry,
)


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Create a test client with temp-path services."""
    rm = tmp_path / "resources" / "manifest.json"

    # Replace module-level services with temp-path versions
    import ecos_server.resource.router as router_mod

    inventory = InventoryService(resource_manifest_path=rm)
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


def _mock_registry_data_with_versions() -> dict:
    data = _mock_registry_data()
    data["tools"][0]["versions"].append(
        {
            "version": "0.60",
            "platforms": {
                "linux-x86_64": {
                    "url": "https://example.com/yosys-0.60.tar.gz",
                    "sha256": "def456",
                    "size": 41943040,
                }
            },
            "requires": [],
        }
    )
    return data


def _mock_registry_data_with_pdk() -> dict:
    data = _mock_registry_data()
    data["pdks"] = [
        {
            "id": "ics55",
            "display_name": "ICSPROUT 55nm PDK",
            "description": "Integrated Circuit Systems 55nm PDK",
            "category": "pdk",
            "homepage": "https://example.com/ics55",
            "versions": [
                {
                    "version": "1.01",
                    "platforms": {
                        "all-platform": {
                            "url": "https://example.com/ics55.tar.gz",
                            "sha256": "4" * 64,
                            "size": 432000000,
                            "strip_prefix": "ics55-pdk",
                            "post_install": [
                                {
                                    "command": ["make", "unzip"],
                                    "cwd": ".",
                                }
                            ],
                        }
                    },
                }
            ],
        }
    ]
    return data


def _mock_registry_data_with_pdk_versions() -> dict:
    data = _mock_registry_data_with_pdk()
    data["pdks"][0]["versions"].append(
        {
            "version": "1.00",
            "platforms": {
                "all-platform": {
                    "url": "https://example.com/ics55-1.00.tar.gz",
                    "sha256": "6" * 64,
                    "size": 321000000,
                    "strip_prefix": "ics55-pdk",
                }
            },
        }
    )
    return data


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


def _patch_installer() -> MagicMock:
    """Patch _tool_service.install to prevent real network I/O in tests."""
    import ecos_server.resource.router as router_mod

    mock = AsyncMock()
    router_mod._tool_service.install = mock  # type: ignore[method-assign]
    return mock


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
        assert tools[0]["managed_root"].endswith("/ecos-studio/tools")

    def test_list_with_imported_pdks(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.get("/api/resources")
        assert resp.status_code == 200
        data = resp.json()
        pdks = [r for r in data["resources"] if r["type"] == "pdk"]
        assert len(pdks) == 1
        assert pdks[0]["id"] == "pdk:ics55"
        assert pdks[0]["source"] == "local"
        assert pdks[0]["managed_root"] is None
        assert "validate" in pdks[0]["actions"]
        assert "remove_reference" in pdks[0]["actions"]
        assert "uninstall" not in pdks[0]["actions"]

    def test_list_includes_registry_pdks(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data_with_pdk())

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        pdks = [r for r in resp.json()["resources"] if r["type"] == "pdk"]
        assert len(pdks) == 1
        pdk = pdks[0]
        assert pdk["id"] == "pdk:ics55"
        assert pdk["display_name"] == "ICSPROUT 55nm PDK"
        assert pdk["status"] == "available"
        assert pdk["installed_version"] is None
        assert pdk["available_versions"] == ["1.01"]
        assert pdk["platform"] == "all-platform"
        assert pdk["size"] == 432000000
        assert pdk["source"] == "registry"
        assert pdk["managed_root"].endswith("/ecos-studio/pdks")
        assert pdk["health"] == {}
        assert pdk["actions"] == ["install"]

    def test_list_registry_pdk_installed_update_available(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data_with_pdk())
        router_mod._inventory.add_or_update_pdk(
            "ics55",
            name="ICSPROUT 55nm PDK",
            canonical_path="/tmp/ecos/pdks/ics55/1.00",
            version="1.00",
            sha256="old",
            source="registry",
            source_url="https://example.com/old.tar.gz",
            managed=True,
            active=True,
        )

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        pdks = [r for r in resp.json()["resources"] if r["type"] == "pdk"]
        assert len(pdks) == 1
        pdk = pdks[0]
        assert pdk["status"] == "update_available"
        assert pdk["installed_version"] == "1.00"
        assert pdk["active_version"] == "1.00"
        assert pdk["source"] == "registry"
        assert "validate" in pdk["actions"]
        assert "update" in pdk["actions"]
        assert "uninstall" in pdk["actions"]
        assert pdk["health"]["managed"] is True
        assert pdk["health"]["version"] == "1.00"
        assert pdk["health"]["source"] == "registry"

    @pytest.mark.parametrize("health", ["missing", "invalid"])
    def test_list_registry_pdk_preserves_validated_health(
        self, client: TestClient, health: str
    ) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data_with_pdk_versions())
        pdk_dir = _make_pdk_dir()
        router_mod._inventory.add_or_update_pdk(
            "ics55",
            name="ICSPROUT 55nm PDK",
            canonical_path=str(pdk_dir),
            version="1.00",
            sha256="old",
            source="registry",
            source_url="https://example.com/ics55-1.00.tar.gz",
            managed=True,
            active=True,
        )
        router_mod._inventory.set_pdk_health("ics55", health)

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        pdk = next(r for r in resp.json()["resources"] if r["type"] == "pdk")
        assert pdk["status"] == health
        assert pdk["health"]["status"] == health
        assert pdk["installed_version"] == "1.00"

    def test_list_registry_pdk_hides_impossible_update_when_latest_unavailable(
        self, client: TestClient
    ) -> None:
        import ecos_server.resource.router as router_mod

        data = _mock_registry_data_with_pdk_versions()
        data["pdks"][0]["versions"][0]["platforms"] = {
            "darwin-arm64": {
                "url": "https://example.com/ics55-1.01-darwin.tar.gz",
                "sha256": "7" * 64,
                "size": 111,
                "strip_prefix": "ics55-pdk",
            }
        }
        _patch_registry(client, data)
        router_mod._inventory.add_or_update_pdk(
            "ics55",
            name="ICSPROUT 55nm PDK",
            canonical_path=str(_make_pdk_dir()),
            version="1.00",
            sha256="old",
            source="registry",
            source_url="https://example.com/ics55-1.00.tar.gz",
            managed=True,
            active=True,
        )

        with patch(
            "ecos_server.resource.router.ToolResourceService.current_platform",
            return_value="linux-x86_64",
        ):
            resp = client.get("/api/resources")

        assert resp.status_code == 200
        pdk = next(r for r in resp.json()["resources"] if r["type"] == "pdk")
        assert pdk["status"] == "installed"
        assert "update" not in pdk["actions"]
        assert pdk["error"] is None
        assert pdk["platform"] == "linux-x86_64"
        assert pdk["size"] is None

    def test_list_registry_pdk_without_supported_asset_is_error(self, client: TestClient) -> None:
        data = _mock_registry_data_with_pdk()
        data["pdks"][0]["versions"][0]["platforms"] = {
            "darwin-arm64": {
                "url": "https://example.com/ics55-darwin.tar.gz",
                "sha256": "5" * 64,
                "size": 123,
                "strip_prefix": "ics55-pdk",
            }
        }
        _patch_registry(client, data)

        with patch(
            "ecos_server.resource.router.ToolResourceService.current_platform",
            return_value="linux-x86_64",
        ):
            resp = client.get("/api/resources")

        assert resp.status_code == 200
        pdk = next(r for r in resp.json()["resources"] if r["type"] == "pdk")
        assert pdk["status"] == "error"
        assert pdk["platform"] == "linux-x86_64"
        assert pdk["actions"] == []
        assert "not available for linux-x86_64 or all-platform" in pdk["error"]

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

    def test_list_includes_installed_tool_when_registry_unavailable(
        self, client: TestClient
    ) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/ecos/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
        )

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources")
        assert resp.status_code == 200
        resources = resp.json()["resources"]
        assert resources == [
            {
                "id": "tool:yosys",
                "type": "tool",
                "name": "yosys",
                "display_name": "yosys",
                "description": "",
                "category": "",
                "status": "installed",
                "installed_version": "0.61",
                "available_versions": [],
                "active_version": "0.61",
                "active": True,
                "path": "/tmp/ecos/tools/yosys/0.61",
                "managed_root": str(router_mod._inventory.tools_dir),
                "platform": None,
                "size": None,
                "source": "local",
                "homepage": "",
                "actions": ["uninstall"],
                "health": {
                    "detected_executables": ["bin/yosys"],
                    "installed_at": router_mod._inventory.get_tool("yosys").installed_at,
                    "managed": True,
                    "sha256": "abc123",
                    "executable": "bin/yosys",
                },
                "error": None,
            }
        ]

    def test_list_includes_imported_pdk_when_registry_unavailable(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        pdk_dir = _make_pdk_dir()
        router_mod._pdk_service.import_pdk(str(pdk_dir))

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        resources = resp.json()["resources"]
        assert len(resources) == 1
        assert resources[0]["id"] == "pdk:ics55"
        assert resources[0]["source"] == "local"
        assert "validate" in resources[0]["actions"]
        assert "remove_reference" in resources[0]["actions"]
        assert "uninstall" not in resources[0]["actions"]

    def test_list_marks_local_tool_installing_when_job_active(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS
        from ecos_server.resource.schemas import ResourceAction

        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/ecos/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
        )
        router_mod._job_tracker.start("tool:yosys", action=ResourceAction.install)

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        tool = resp.json()["resources"][0]
        assert tool["id"] == "tool:yosys"
        assert tool["status"] == "installing"
        assert tool["actions"] == []

    def test_list_hides_uninstall_for_unmanaged_local_tool(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/external/yosys",
            sha256="abc123",
            detected_executables=["bin/yosys"],
            managed=False,
        )

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        mock_rs.cache_file = Path("/tmp/cache/resource-registry.json")
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        tool = resp.json()["resources"][0]
        assert tool["id"] == "tool:yosys"
        assert tool["health"]["managed"] is False
        assert "uninstall" not in tool["actions"]

    def test_list_hides_uninstall_for_unmanaged_registry_tool(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data())
        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/external/yosys",
            sha256="abc123",
            detected_executables=["bin/yosys"],
            managed=False,
        )

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        tool = next(r for r in resp.json()["resources"] if r["id"] == "tool:yosys")
        assert tool["status"] == "installed"
        assert "uninstall" not in tool["actions"]
        assert tool["health"]["managed"] is False

    def test_list_includes_inventory_metadata_for_registry_tool(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data())
        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/ecos/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
            active=True,
            managed=True,
        )

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        tool = next(r for r in resp.json()["resources"] if r["id"] == "tool:yosys")
        assert tool["active"] is True
        assert tool["path"] == "/tmp/ecos/tools/yosys/0.61"
        assert tool["health"] == {
            "detected_executables": ["bin/yosys"],
            "installed_at": router_mod._inventory.get_tool("yosys").installed_at,
            "managed": True,
            "sha256": "abc123",
            "executable": "bin/yosys",
        }

    def test_list_marks_registry_tool_installing_when_job_active(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        _patch_registry(client, _mock_registry_data())
        router_mod._job_tracker.start("tool:yosys", action=ResourceAction.install)

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        tool = next(r for r in resp.json()["resources"] if r["id"] == "tool:yosys")
        assert tool["status"] == "installing"
        assert tool["actions"] == []

    def test_list_marks_registry_pdk_installing_when_job_active(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        _patch_registry(client, _mock_registry_data_with_pdk())
        router_mod._job_tracker.start("pdk:ics55", action=ResourceAction.install)

        resp = client.get("/api/resources")

        assert resp.status_code == 200
        pdk = next(r for r in resp.json()["resources"] if r["id"] == "pdk:ics55")
        assert pdk["status"] == "installing"
        assert pdk["actions"] == []


class TestGetResource:
    def test_get_tool(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.get("/api/resources/tool:yosys")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "tool:yosys"
        assert data["type"] == "tool"

    def test_get_registry_pdk(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data_with_pdk())

        resp = client.get("/api/resources/pdk:ics55")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "pdk:ics55"
        assert data["type"] == "pdk"
        assert data["status"] == "available"
        assert data["source"] == "registry"
        assert data["actions"] == ["install"]

    def test_get_pdk(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.get("/api/resources/pdk:ics55")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "pdk:ics55"
        assert data["type"] == "pdk"
        assert data["source"] == "local"
        assert "remove_reference" in data["actions"]
        assert "uninstall" not in data["actions"]

    def test_get_unknown_resource_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.get("/api/resources/tool:nonexistent")
        assert resp.status_code == 404

    def test_get_installed_tool_when_registry_unavailable(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/ecos/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
        )

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources/tool:yosys")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "tool:yosys"
        assert data["status"] == "installed"
        assert data["installed_version"] == "0.61"
        assert data["health"]["detected_executables"] == ["bin/yosys"]

    def test_get_local_pdk_when_registry_unavailable(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        _pdk_service.import_pdk(str(_make_pdk_dir()))

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        router_mod._registry_service = mock_rs

        resp = client.get("/api/resources/pdk:ics55")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "pdk:ics55"
        assert data["source"] == "local"
        assert "remove_reference" in data["actions"]

    def test_get_registry_tool_hides_uninstall_when_unmanaged(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data())
        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/external/yosys",
            sha256="abc123",
            detected_executables=["bin/yosys"],
            managed=False,
        )

        resp = client.get("/api/resources/tool:yosys")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "installed"
        assert "uninstall" not in data["actions"]
        assert data["health"]["managed"] is False

    def test_get_registry_tool_includes_inventory_metadata(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data())
        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/ecos/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
            active=True,
            managed=True,
        )

        resp = client.get("/api/resources/tool:yosys")

        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert data["path"] == "/tmp/ecos/tools/yosys/0.61"
        assert data["health"] == {
            "detected_executables": ["bin/yosys"],
            "installed_at": router_mod._inventory.get_tool("yosys").installed_at,
            "managed": True,
            "sha256": "abc123",
            "executable": "bin/yosys",
        }

    def test_get_resource_invalid_prefix_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.get("/api/resources/invalid:thing")
        assert resp.status_code == 404


class TestInstall:
    def test_install_returns_accepted(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        _patch_installer()
        resp = client.post("/api/resources/tool:yosys/install")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "installing"
        assert data["resource_id"] == "tool:yosys"

    def test_install_uses_requested_version(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data_with_versions())
        installer = _patch_installer()

        resp = client.post("/api/resources/tool:yosys/install", json={"version": "0.60"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["version"] == "0.60"
        installer.assert_called_once()
        assert installer.call_args.args[1] == "0.60"
        assert installer.call_args.args[2].url == "https://example.com/yosys-0.60.tar.gz"

    def test_install_unknown_requested_version_404(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data_with_versions())
        installer = _patch_installer()

        resp = client.post("/api/resources/tool:yosys/install", json={"version": "0.59"})

        assert resp.status_code == 404
        assert "v0.59" in resp.json()["detail"]
        installer.assert_not_called()

    def test_install_duplicate_409(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        _patch_registry(client, _mock_registry_data())
        _patch_installer()
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

    def test_install_pdk_starts_job(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data_with_pdk())
        mock = AsyncMock()
        with patch.object(router_mod._pdk_service, "install_managed_pdk", mock):
            resp = client.post("/api/resources/pdk:ics55/install")

            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "installing"
            assert data["resource_id"] == "pdk:ics55"
            assert data["version"] == "1.01"
            assert data["platform"] == "all-platform"
            mock.assert_called_once()
            assert mock.call_args.kwargs["pdk_id"] == "ics55"
            assert mock.call_args.kwargs["asset"].url == "https://example.com/ics55.tar.gz"
            assert mock.call_args.kwargs["asset"].post_install[0].command == ["make", "unzip"]
            router_mod._job_tracker.finish("pdk:ics55")

    def test_install_pdk_prefers_current_platform_asset(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        data = _mock_registry_data_with_pdk()
        data["pdks"][0]["versions"][0]["platforms"]["linux-x86_64"] = {
            "url": "https://example.com/ics55-linux.tar.gz",
            "sha256": "8" * 64,
            "size": 123456,
            "strip_prefix": "ics55-linux",
        }
        _patch_registry(client, data)
        mock = AsyncMock()
        with (
            patch.object(router_mod._pdk_service, "install_managed_pdk", mock),
            patch(
                "ecos_server.resource.router.ToolResourceService.current_platform",
                return_value="linux-x86_64",
            ),
        ):
            resp = client.post("/api/resources/pdk:ics55/install")

            assert resp.status_code == 200
            data = resp.json()
            assert data["platform"] == "linux-x86_64"
            mock.assert_called_once()
            assert mock.call_args.kwargs["asset"].url == "https://example.com/ics55-linux.tar.gz"
            router_mod._job_tracker.finish("pdk:ics55")

    def test_install_unknown_requested_pdk_version_404(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data_with_pdk_versions())

        resp = client.post("/api/resources/pdk:ics55/install", json={"version": "9.99"})

        assert resp.status_code == 404
        assert "v9.99" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_install_reserves_job_before_registry_fetch(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        fetches_started = 0
        release_fetch = asyncio.Event()
        registry = ToolRegistry(**_mock_registry_data())

        async def delayed_fetch():
            nonlocal fetches_started
            fetches_started += 1
            await release_fetch.wait()
            return RegistryState(registry=registry, diagnostics=[])

        mock_rs = MagicMock()
        mock_rs.fetch = delayed_fetch
        router_mod._registry_service = mock_rs

        async def start_install():
            return await router_mod._start_tool_install_or_update(
                "tool:yosys",
                router_mod.ResourceAction.install,
            )

        first = asyncio.create_task(start_install())
        second = asyncio.create_task(start_install())
        await asyncio.sleep(0)
        assert fetches_started == 1
        release_fetch.set()
        response = await asyncio.wait_for(first, timeout=1)
        await asyncio.gather(second, return_exceptions=True)

        assert response["status"] == "installing"


class TestUpdate:
    def test_update_returns_accepted_for_tool(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        installer = _patch_installer()

        resp = client.post("/api/resources/tool:yosys/update")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "updating"
        assert data["resource_id"] == "tool:yosys"
        assert data["version"] == "0.61"
        installer.assert_called_once()
        assert installer.call_args.kwargs["action"] == "update"

    def test_update_pdk_starts_job(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data_with_pdk())
        mock = AsyncMock()
        with patch.object(router_mod._pdk_service, "install_managed_pdk", mock):
            resp = client.post("/api/resources/pdk:ics55/update")

            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "updating"
            assert data["resource_id"] == "pdk:ics55"
            assert data["version"] == "1.01"
            assert data["platform"] == "all-platform"
            mock.assert_called_once()
            assert mock.call_args.kwargs["action"] == "update"
            router_mod._job_tracker.finish("pdk:ics55")


class TestManagedPdkDirectRoutes:
    @pytest.mark.parametrize("action", ["install", "update"])
    def test_direct_pdk_unknown_id_404(self, client: TestClient, action: str) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": [], "pdks": []})

        resp = client.post(f"/api/resources/pdk:nonexistent/{action}")

        assert resp.status_code == 404
        assert resp.json()["detail"] == "PDK 'nonexistent' not found"

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_direct_pdk_unsupported_platform_400(self, client: TestClient, action: str) -> None:
        data = _mock_registry_data_with_pdk()
        data["pdks"][0]["versions"][0]["platforms"] = {
            "darwin-arm64": {
                "url": "https://example.com/ics55-darwin.tar.gz",
                "sha256": "5" * 64,
                "size": 123,
                "strip_prefix": "ics55-pdk",
            }
        }
        _patch_registry(client, data)

        with patch(
            "ecos_server.resource.router.ToolResourceService.current_platform",
            return_value="linux-x86_64",
        ):
            resp = client.post(f"/api/resources/pdk:ics55/{action}")

        assert resp.status_code == 400
        assert "not available for linux-x86_64 or all-platform" in resp.json()["detail"]

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_direct_pdk_conflict_409_when_job_active(self, client: TestClient, action: str) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        router_mod._job_tracker.start("pdk:ics55", action=ResourceAction.install)

        try:
            resp = client.post(f"/api/resources/pdk:ics55/{action}")
        finally:
            router_mod._job_tracker.finish("pdk:ics55")

        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["resource_id"] == "pdk:ics55"
        assert detail["action"] == "install"
        assert detail["status"] == "conflict"
        assert detail["existing_job_id"] is not None
        assert detail["event_url"] is not None

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_direct_pdk_registry_unavailable_503(self, client: TestClient, action: str) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        router_mod._registry_service = mock_rs

        resp = client.post(f"/api/resources/pdk:ics55/{action}")

        assert resp.status_code == 503
        assert resp.json()["detail"] == "Registry unavailable"


class TestUninstall:
    def test_uninstall_not_installed_404(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        resp = client.post("/api/resources/tool:yosys/uninstall")
        assert resp.status_code == 404

    def test_uninstall_managed_pdk(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        mock = AsyncMock()
        with patch.object(router_mod._pdk_service, "uninstall_managed_pdk", mock):
            resp = client.post("/api/resources/pdk:ics55/uninstall")

            assert resp.status_code == 200
            assert resp.json() == {"status": "uninstalled", "resource_id": "pdk:ics55"}
            mock.assert_awaited_once_with("ics55")

    def test_uninstall_unmanaged_pdk_rejected_and_preserves_source(
        self, client: TestClient
    ) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        pdk_dir = _make_pdk_dir()
        _pdk_service.import_pdk(str(pdk_dir))

        resp = client.post("/api/resources/pdk:ics55/uninstall")

        assert resp.status_code == 400
        assert "unmanaged" in resp.json()["detail"]
        assert pdk_dir.exists()
        assert _pdk_service.get_pdk("ics55") is not None

    def test_uninstall_unmanaged_tool_rejected_and_preserves_path(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        import ecos_server.resource.router as router_mod

        tool_dir = tmp_path / "external" / "yosys"
        tool_dir.mkdir(parents=True)
        marker = tool_dir / "owned-by-user"
        marker.write_text("do not delete", encoding="utf-8")
        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path=str(tool_dir),
            sha256="abc123",
            detected_executables=["bin/yosys"],
            managed=False,
        )

        resp = client.post("/api/resources/tool:yosys/uninstall")

        assert resp.status_code == 400
        assert "unmanaged" in resp.json()["detail"]
        assert marker.exists()
        assert router_mod._inventory.get_tool("yosys") is not None


class TestPdkRoutes:
    def test_scan_pdk(self, client: TestClient) -> None:
        pdk_dir = _make_pdk_dir()
        resp = client.post("/api/resources/pdks/scan", json={"path": str(pdk_dir)})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "ics55"
        assert data["detected_files"]["directories"] == ["IP", "prtech"]
        assert "prtech" in data["detected_file_list"]

    def test_scan_empty_path_400(self, client: TestClient) -> None:
        resp = client.post("/api/resources/pdks/scan", json={"path": ""})
        assert resp.status_code == 400

    def test_import_pdk(self, client: TestClient) -> None:
        pdk_dir = _make_pdk_dir()
        resp = client.post("/api/resources/pdks/import", json={"path": str(pdk_dir)})
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "pdk:ics55"
        assert data["name"] == "ics55"
        assert Path(data["path"]).name.startswith("ecos_test_pdk_")
        assert data["health"]["detected_files"]["directories"] == ["IP", "prtech"]

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
        assert data["health"]["status"] == "ok"

    def test_delete_pdk_reference(self, client: TestClient) -> None:
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.delete("/api/resources/pdks/ics55")
        assert resp.status_code == 200
        assert _pdk_service.get_pdk("ics55") is None

    def test_delete_pdk_preserves_source(self, client: TestClient) -> None:
        pdk_dir = _make_pdk_dir()
        _pdk_service.import_pdk(str(pdk_dir))
        client.delete("/api/resources/pdks/ics55")
        assert pdk_dir.exists()

    def test_delete_managed_pdk_reference_rejected_and_preserves_files(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        import ecos_server.resource.router as router_mod

        managed_dir = tmp_path / "managed" / "ics55"
        managed_dir.mkdir(parents=True)
        marker = managed_dir / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        router_mod._inventory.add_or_update_pdk(
            "ics55",
            name="ICSPROUT 55nm PDK",
            canonical_path=str(managed_dir),
            version="1.00",
            sha256="old",
            source="registry",
            source_url="https://example.com/ics55-1.00.tar.gz",
            managed=True,
            active=True,
        )

        resp = client.delete("/api/resources/pdks/ics55")

        assert resp.status_code == 400
        assert "managed" in resp.json()["detail"]
        assert marker.exists()
        assert router_mod._pdk_service.get_pdk("ics55") is not None


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

    def test_batch_install(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        _patch_installer()
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "tool:yosys", "action": "install"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 200
        assert result["detail"]["status"] == "installing"

    def test_batch_install_unknown_tool(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _patch_installer()
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "tool:nonexistent", "action": "install"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 404

    def test_batch_install_pdk(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data_with_pdk())
        mock = AsyncMock()
        with patch.object(router_mod._pdk_service, "install_managed_pdk", mock):
            resp = client.post(
                "/api/resources/batch",
                json={"operations": [{"resource_id": "pdk:ics55", "action": "install"}]},
            )

            assert resp.status_code == 200
            result = resp.json()["results"][0]
            assert result["action"] == "install"
            assert result["status"] == 200
            assert result["detail"]["status"] == "installing"
            assert result["detail"]["platform"] == "all-platform"
            mock.assert_called_once()
            router_mod._job_tracker.finish("pdk:ics55")

    def test_batch_update(self, client: TestClient) -> None:
        _patch_registry(client, _mock_registry_data())
        installer = _patch_installer()

        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "tool:yosys", "action": "update"}]},
        )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["action"] == "update"
        assert result["status"] == 200
        assert result["detail"]["status"] == "updating"
        installer.assert_called_once()
        assert installer.call_args.kwargs["action"] == "update"

    def test_batch_update_pdk(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, _mock_registry_data_with_pdk())
        mock = AsyncMock()
        with patch.object(router_mod._pdk_service, "install_managed_pdk", mock):
            resp = client.post(
                "/api/resources/batch",
                json={"operations": [{"resource_id": "pdk:ics55", "action": "update"}]},
            )

            assert resp.status_code == 200
            result = resp.json()["results"][0]
            assert result["action"] == "update"
            assert result["status"] == 200
            assert result["detail"]["status"] == "updating"
            assert result["detail"]["platform"] == "all-platform"
            mock.assert_called_once()
            assert mock.call_args.kwargs["action"] == "update"
            router_mod._job_tracker.finish("pdk:ics55")

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_batch_pdk_unknown_id_404(self, client: TestClient, action: str) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": [], "pdks": []})

        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:nonexistent", "action": action}]},
        )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 404
        assert result["error"] == "PDK 'nonexistent' not found"

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_batch_pdk_unsupported_platform_400(self, client: TestClient, action: str) -> None:
        data = _mock_registry_data_with_pdk()
        data["pdks"][0]["versions"][0]["platforms"] = {
            "darwin-arm64": {
                "url": "https://example.com/ics55-darwin.tar.gz",
                "sha256": "5" * 64,
                "size": 123,
                "strip_prefix": "ics55-pdk",
            }
        }
        _patch_registry(client, data)

        with patch(
            "ecos_server.resource.router.ToolResourceService.current_platform",
            return_value="linux-x86_64",
        ):
            resp = client.post(
                "/api/resources/batch",
                json={"operations": [{"resource_id": "pdk:ics55", "action": action}]},
            )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 400
        assert "not available for linux-x86_64 or all-platform" in result["error"]

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_batch_pdk_conflict_409_when_job_active(self, client: TestClient, action: str) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        router_mod._job_tracker.start("pdk:ics55", action=ResourceAction.install)

        try:
            resp = client.post(
                "/api/resources/batch",
                json={"operations": [{"resource_id": "pdk:ics55", "action": action}]},
            )
        finally:
            router_mod._job_tracker.finish("pdk:ics55")

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 409
        assert result["detail"]["resource_id"] == "pdk:ics55"
        assert result["detail"]["status"] == "conflict"
        assert result["detail"]["existing_job_id"] is not None

    @pytest.mark.parametrize("action", ["install", "update"])
    def test_batch_pdk_registry_unavailable_503(self, client: TestClient, action: str) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.registry import RegistryService as RS

        mock_rs = MagicMock(spec=RS)
        mock_rs.fetch = AsyncMock(
            return_value=RegistryState(registry=None, diagnostics=["Registry unavailable"])
        )
        router_mod._registry_service = mock_rs

        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": action}]},
        )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 503
        assert result["error"] == "Registry unavailable"

    def test_batch_uninstall_unmanaged_tool_rejected_and_preserves_path(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        import ecos_server.resource.router as router_mod

        _patch_registry(client, {"schema_version": 2, "tools": []})
        tool_dir = tmp_path / "external" / "yosys"
        tool_dir.mkdir(parents=True)
        marker = tool_dir / "owned-by-user"
        marker.write_text("do not delete", encoding="utf-8")
        router_mod._inventory.add_tool(
            name="yosys",
            version="0.61",
            path=str(tool_dir),
            sha256="abc123",
            detected_executables=["bin/yosys"],
            managed=False,
        )

        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "tool:yosys", "action": "uninstall"}]},
        )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 400
        assert "unmanaged" in result["error"]
        assert marker.exists()
        assert router_mod._inventory.get_tool("yosys") is not None

    def test_batch_uninstall_managed_pdk(self, client: TestClient) -> None:
        import ecos_server.resource.router as router_mod

        mock = AsyncMock()
        with patch.object(router_mod._pdk_service, "uninstall_managed_pdk", mock):
            resp = client.post(
                "/api/resources/batch",
                json={"operations": [{"resource_id": "pdk:ics55", "action": "uninstall"}]},
            )

            assert resp.status_code == 200
            result = resp.json()["results"][0]
            assert result["action"] == "uninstall"
            assert result["status"] == 200
            assert result["detail"]["status"] == "uninstalled"
            mock.assert_awaited_once_with("ics55")

    def test_batch_uninstall_unmanaged_pdk_rejected_and_preserves_source(
        self, client: TestClient
    ) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        pdk_dir = _make_pdk_dir()
        _pdk_service.import_pdk(str(pdk_dir))

        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": "uninstall"}]},
        )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 400
        assert "unmanaged" in result["error"]
        assert pdk_dir.exists()
        assert _pdk_service.get_pdk("ics55") is not None

    def test_batch_activate_pdk(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": "activate"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 200
        assert _pdk_service.get_pdk("ics55").active is True

    def test_batch_validate_pdk(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        _pdk_service.import_pdk(str(_make_pdk_dir()))
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": "validate"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 200
        assert result["detail"]["health"]["status"] == "ok"

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

    def test_batch_remove_managed_pdk_reference_rejected_and_preserves_files(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        import ecos_server.resource.router as router_mod

        managed_dir = tmp_path / "managed" / "ics55"
        managed_dir.mkdir(parents=True)
        marker = managed_dir / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        router_mod._inventory.add_or_update_pdk(
            "ics55",
            name="ICSPROUT 55nm PDK",
            canonical_path=str(managed_dir),
            version="1.00",
            sha256="old",
            source="registry",
            source_url="https://example.com/ics55-1.00.tar.gz",
            managed=True,
            active=True,
        )

        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:ics55", "action": "remove_reference"}]},
        )

        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 400
        assert "managed" in result["error"]
        assert marker.exists()
        assert router_mod._pdk_service.get_pdk("ics55") is not None

    def test_batch_remove_reference_missing_404(self, client: TestClient) -> None:
        _patch_registry(client, {"schema_version": 2, "tools": []})
        resp = client.post(
            "/api/resources/batch",
            json={"operations": [{"resource_id": "pdk:nonexistent", "action": "remove_reference"}]},
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == 404


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
        from ecos_server.resource.registry import RegistryService as RS
        from ecos_server.resource.registry import RegistryState

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


class TestPdkInstallRunner:
    @pytest.mark.asyncio
    async def test_run_pdk_install_publishes_underlying_error_message(self) -> None:
        import ecos_server.resource.router as router_mod
        from ecos_server.resource.schemas import ResourceAction

        published = []

        async def fail_install(**kwargs):
            raise RuntimeError("SHA256 verification failed for PDK ics55")

        with (
            patch.object(router_mod._pdk_service, "install_managed_pdk", side_effect=fail_install),
            patch.object(router_mod._job_tracker, "publish", side_effect=published.append),
        ):
            await router_mod._run_pdk_install(
                resource_id="pdk:ics55",
                pdk_id="ics55",
                display_name="ICSPROUT 55nm PDK",
                version="1.01",
                asset=object(),
                action=ResourceAction.install,
            )

        assert published
        assert published[-1].phase == "error"
        assert published[-1].message == "SHA256 verification failed for PDK ics55"
        assert published[-1].error == "SHA256 verification failed for PDK ics55"


class TestSSESubscription:
    """Prove that JobTracker.publish delivers exactly one event per publish."""

    @pytest.mark.asyncio
    async def test_subscriber_receives_published_event(self) -> None:
        import asyncio as aio

        from ecos_server.resource.jobs import JobTracker
        from ecos_server.resource.schemas import ResourceAction, ResourceJob
        from ecos_server.sse import event_manager

        tracker = JobTracker()
        channel = "resource:tool:test"
        received: list[ResourceJob] = []

        async def _collect():
            async for event in event_manager.subscribe(channel):
                if isinstance(event, ResourceJob):
                    received.append(event)
                if len(received) >= 2:
                    break

        task = aio.create_task(_collect())
        await aio.sleep(0.01)

        job1 = ResourceJob(
            id="job-1",
            resource_id="tool:test",
            action=ResourceAction.install,
            phase="downloading",
            progress=0.5,
            message="Test progress 1",
        )
        tracker.publish(job1)

        job2 = ResourceJob(
            id="job-2",
            resource_id="tool:test",
            action=ResourceAction.install,
            phase="done",
            progress=1.0,
            message="Test progress 2",
        )
        tracker.publish(job2)

        await aio.wait_for(task, timeout=2.0)
        assert len(received) == 2
        assert received[0].phase == "downloading"
        assert received[0].progress == 0.5
        assert received[1].phase == "done"
        assert received[1].progress == 1.0


def _make_pdk_dir() -> Path:
    """Create a real temp PDK directory for router integration tests."""
    pdk_dir = Path(tempfile.mkdtemp(prefix="ecos_test_pdk_"))
    (pdk_dir / "prtech").mkdir()
    (pdk_dir / "IP").mkdir()
    (pdk_dir / "libs.ref").write_text("tech.lef")
    return pdk_dir
