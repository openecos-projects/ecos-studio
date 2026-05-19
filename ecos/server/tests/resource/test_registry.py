import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import ecos_server.resource.registry as registry_module
from ecos_server.resource.registry import RegistryService, RegistryState
from ecos_server.resource.schemas import RegistryTool, ToolRegistry


def _make_registry_fixture() -> dict:
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
                                "url": "https://example.com/yosys-0.61.tar.gz",
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


def _make_pdk_fixture() -> dict:
    return {
        "id": "ics55",
        "display_name": "IC-S55",
        "description": "IC-S55 PDK",
        "category": "pdk",
        "homepage": "https://example.com/ics55",
        "versions": [
            {
                "version": "1.01",
                "platforms": {
                    "all-platform": {
                        "url": "https://example.com/ics55-1.01.tar.gz",
                        "sha256": "abc123",
                        "size": 1024,
                        "strip_prefix": "ics55",
                    }
                },
            }
        ],
    }


@pytest.fixture
def registry_fixture() -> dict:
    return _make_registry_fixture()


@pytest.fixture
def registry_url() -> str:
    return "https://registry.example.com/tool-registry.json"


def _make_mock_response(json_data: dict) -> MagicMock:
    """Create a mock httpx response with sync json() and raise_for_status()."""
    resp = MagicMock()
    resp.json.return_value = json_data
    resp.raise_for_status.return_value = None
    return resp


def _mock_async_client(response: MagicMock) -> MagicMock:
    """Create a mock AsyncClient that returns the given response from get()."""
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def _mock_async_client_failing() -> MagicMock:
    """Create a mock AsyncClient whose get() raises an exception."""
    client = MagicMock()
    client.get = AsyncMock(side_effect=Exception("Connection refused"))
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def _mock_async_client_transient_failure(response: MagicMock) -> MagicMock:
    """Create a mock AsyncClient whose get() succeeds after one transient failure."""
    client = MagicMock()
    client.get = AsyncMock(side_effect=[Exception("TLS reset"), response])
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


class TestRegistryFetch:
    """Positive: remote-first fetch with cache and degraded states."""

    @pytest.mark.asyncio
    async def test_fetch_saves_cache(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        cache_dir = tmp_path / "cache"
        service = RegistryService(registry_url=registry_url, cache_dir=cache_dir)
        mock_client = _mock_async_client(_make_mock_response(registry_fixture))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.fetch()

        assert result.registry is not None
        assert result.registry.tools[0].name == "yosys"
        assert result.diagnostics == []
        assert service.cache_file.exists()
        cached = json.loads(service.cache_file.read_text())
        assert cached["tools"][0]["name"] == "yosys"

    @pytest.mark.asyncio
    async def test_fetch_follows_registry_redirects(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
        mock_client = _mock_async_client(_make_mock_response(registry_fixture))

        with patch("httpx.AsyncClient", return_value=mock_client) as async_client:
            await service.fetch()

        async_client.assert_called_once_with(timeout=30.0, follow_redirects=True)

    @pytest.mark.asyncio
    async def test_cache_fallback_when_url_unavailable(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        cache_dir = tmp_path / "cache"
        cache_dir.mkdir(parents=True)
        cache_file = cache_dir / "resource-registry.json"
        cache_file.write_text(json.dumps(registry_fixture))

        service = RegistryService(registry_url=registry_url, cache_dir=cache_dir)
        mock_client = _mock_async_client_failing()

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.fetch()

        assert result.registry is not None
        assert result.registry.tools[0].name == "yosys"
        assert len(result.diagnostics) >= 1
        assert any("unavailable" in d.lower() or "cached" in d.lower() for d in result.diagnostics)

    @pytest.mark.asyncio
    async def test_unavailable_registry_warning_is_concise(
        self, registry_url: str, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
        mock_client = _mock_async_client_failing()

        with (
            patch("httpx.AsyncClient", return_value=mock_client),
            caplog.at_level("WARNING", logger="ecos_server.resource.registry"),
        ):
            await service.fetch()

        assert (
            "Failed to fetch registry from https://registry.example.com/tool-registry.json"
            in caplog.text
        )
        assert "Traceback" not in caplog.text

    @pytest.mark.asyncio
    async def test_transient_registry_failure_retries(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
        mock_client = _mock_async_client_transient_failure(_make_mock_response(registry_fixture))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.fetch()

        assert result.registry is not None
        assert result.registry.tools[0].name == "yosys"
        assert result.diagnostics == []
        assert mock_client.get.await_count == 2

    @pytest.mark.asyncio
    async def test_degraded_empty_when_both_unavailable(
        self, registry_url: str, tmp_path: Path
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "nocache")
        mock_client = _mock_async_client_failing()

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.fetch()

        assert result.registry is None
        assert len(result.diagnostics) >= 2
        assert result.is_degraded
        assert result.is_empty

    @pytest.mark.asyncio
    async def test_in_memory_cache_avoids_network(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
        mock_client = _mock_async_client(_make_mock_response(registry_fixture))

        with patch("httpx.AsyncClient", return_value=mock_client):
            await service.fetch()

        # Second call should use in-memory cache; patch would catch unexpected network calls
        result2 = await service.fetch()
        assert result2.registry is not None
        assert result2.registry.tools[0].name == "yosys"
        assert result2.diagnostics == []

    @pytest.mark.asyncio
    async def test_force_refresh_bypasses_in_memory_cache(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")

        # First fetch
        mock_client1 = _mock_async_client(_make_mock_response(registry_fixture))
        with patch("httpx.AsyncClient", return_value=mock_client1):
            await service.fetch()

        # Force refresh with updated data
        fixture2 = _make_registry_fixture()
        fixture2["tools"][0]["display_name"] = "Updated Yosys"
        mock_client2 = _mock_async_client(_make_mock_response(fixture2))

        with patch("httpx.AsyncClient", return_value=mock_client2):
            result = await service.refresh()

        assert result.registry is not None
        assert result.registry.tools[0].display_name == "Updated Yosys"


@pytest.mark.asyncio
async def test_fetch_preserves_pdks(registry_url: str, tmp_path: Path) -> None:
    payload = {"schema_version": 2, "tools": [], "pdks": [_make_pdk_fixture()]}
    service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
    mock_client = _mock_async_client(_make_mock_response(payload))

    with patch("httpx.AsyncClient", return_value=mock_client):
        state = await service.fetch()

    assert state.registry is not None
    assert state.registry.pdks[0].id == "ics55"
    cached = json.loads(service.cache_file.read_text())
    assert cached["pdks"][0]["id"] == "ics55"


class TestRegistryValidation:
    """Negative: malformed registry data is rejected."""

    @pytest.mark.asyncio
    async def test_rejects_invalid_schema_version(
        self, registry_url: str, registry_fixture: dict, tmp_path: Path
    ) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
        bad_fixture = _make_registry_fixture()
        bad_fixture["schema_version"] = "not_an_int"
        mock_client = _mock_async_client(_make_mock_response(bad_fixture))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.fetch()

        # Malformed schema triggers Pydantic validation failure, degrading gracefully
        assert result.is_degraded

    @pytest.mark.asyncio
    async def test_rejects_invalid_platform_asset(self, registry_url: str, tmp_path: Path) -> None:
        service = RegistryService(registry_url=registry_url, cache_dir=tmp_path / "cache")
        bad_fixture = _make_registry_fixture()
        bad_fixture["tools"][0]["versions"][0]["platforms"]["linux-x86_64"] = {
            "url": "https://example.com/bad.tar.gz",
        }
        mock_client = _mock_async_client(_make_mock_response(bad_fixture))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.fetch()

        assert result.is_degraded


class TestRegistryConstruction:
    def test_empty_url_raises(self) -> None:
        with pytest.raises(ValueError, match="registry_url"):
            RegistryService(registry_url="")

    def test_cache_dir_defaults(self, registry_url: str) -> None:
        service = RegistryService(registry_url=registry_url)
        assert service.cache_file.name == "resource-registry.json"
        assert ".cache" in service.cache_file.parts
        assert ".ecos" not in str(service.cache_file)

    def test_cache_dir_uses_xdg_cache_home(
        self, registry_url: str, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache-home"))
        service = RegistryService(registry_url=registry_url)
        assert (
            service.cache_file == tmp_path / "cache-home" / "ecos-studio" / "resource-registry.json"
        )

    def test_cache_dir_uses_xdg_default_when_env_empty(
        self, registry_url: str, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setattr(registry_module.Path, "home", lambda: tmp_path)
        monkeypatch.setenv("XDG_CACHE_HOME", "")
        service = RegistryService(registry_url=registry_url)
        assert service.cache_file == tmp_path / ".cache" / "ecos-studio" / "resource-registry.json"

    def test_custom_cache_dir(self, registry_url: str, tmp_path: Path) -> None:
        cache_dir = tmp_path / "custom_cache"
        service = RegistryService(registry_url=registry_url, cache_dir=cache_dir)
        assert str(cache_dir) in str(service.cache_file)


class TestRegistryState:
    def test_clean_state(self) -> None:
        state = RegistryState(registry=ToolRegistry(schema_version=2, tools=[]), diagnostics=[])
        assert not state.is_degraded
        assert state.is_empty

    def test_degraded_state(self) -> None:
        state = RegistryState(registry=None, diagnostics=["Registry unavailable"])
        assert state.is_degraded

    def test_with_tools_not_empty(self) -> None:
        tool = RegistryTool(
            name="yosys",
            display_name="Yosys",
            description="",
            category="",
            homepage="",
            versions=[],
        )
        state = RegistryState(
            registry=ToolRegistry(schema_version=2, tools=[tool]),
            diagnostics=[],
        )
        assert not state.is_empty
