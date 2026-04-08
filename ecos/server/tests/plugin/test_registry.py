import json
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ecos_server.plugin.schemas import ToolRegistry
from ecos_server.plugin.services.registry import RegistryService

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
def cache_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".ecos" / "cache"
    d.mkdir(parents=True)
    return d


@pytest.fixture()
def service(cache_dir: Path) -> RegistryService:
    return RegistryService(
        registry_url="https://example.com/tool-registry.json",
        cache_dir=cache_dir,
        ttl_seconds=3600,
    )


def test_parse_registry_from_cache(service: RegistryService, cache_dir: Path) -> None:
    cache_file = cache_dir / "tool-registry.json"
    cache_file.write_text(json.dumps(SAMPLE_REGISTRY))
    registry = service._load_cached()
    assert registry is not None
    assert isinstance(registry, ToolRegistry)
    assert len(registry.tools) == 1
    assert registry.tools[0].name == "yosys"


def test_cache_miss_returns_none(service: RegistryService) -> None:
    assert service._load_cached() is None


def test_save_cache(service: RegistryService, cache_dir: Path) -> None:
    registry = ToolRegistry(**SAMPLE_REGISTRY)
    service._save_cache(registry)
    cache_file = cache_dir / "tool-registry.json"
    assert cache_file.exists()
    data = json.loads(cache_file.read_text())
    assert data["tools"][0]["name"] == "yosys"


def test_cache_expired(service: RegistryService, cache_dir: Path) -> None:
    cache_file = cache_dir / "tool-registry.json"
    cache_file.write_text(json.dumps(SAMPLE_REGISTRY))
    old_time = time.time() - 7200
    import os

    os.utime(cache_file, (old_time, old_time))
    assert service._is_cache_expired()


def test_cache_not_expired(service: RegistryService, cache_dir: Path) -> None:
    cache_file = cache_dir / "tool-registry.json"
    cache_file.write_text(json.dumps(SAMPLE_REGISTRY))
    assert not service._is_cache_expired()


@pytest.mark.asyncio()
async def test_fetch_uses_bundled_registry(cache_dir: Path) -> None:
    """Default RegistryService (no URL) loads repo-shipped plugin/data/tool-registry.json."""
    service = RegistryService(cache_dir=cache_dir)
    registry = await service.fetch(force=True)
    assert registry is not None
    assert len(registry.tools) >= 1
    assert registry.tools[0].name == "yosys"


@pytest.mark.asyncio()
async def test_fetch_registry(service: RegistryService) -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = SAMPLE_REGISTRY

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    with patch("ecos_server.plugin.services.registry.httpx.AsyncClient", return_value=mock_cm):
        registry = await service.fetch(force=True)
        assert registry is not None
        assert registry.tools[0].name == "yosys"
