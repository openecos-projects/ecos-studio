from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ecos_server.resource.asset_resolution import (
    fetch_asset_update_sha256,
    parse_release_metadata,
    resolve_asset,
)
from ecos_server.resource.schemas import PlatformAsset


def _mock_async_client(response: MagicMock) -> MagicMock:
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def test_parse_release_metadata_requires_sha256_and_positive_size() -> None:
    metadata = parse_release_metadata({
        "sha256": "A" * 64,
        "size": 123,
        "commit": "deadbeef",
        "built_at": "2026-07-10T00:00:00Z",
    })

    assert metadata == {
        "sha256": "a" * 64,
        "size": 123,
        "commit": "deadbeef",
        "built_at": "2026-07-10T00:00:00Z",
    }
    assert parse_release_metadata({"sha256": "a" * 64}) is None


@pytest.mark.asyncio
async def test_update_checksum_prefers_release_metadata() -> None:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"sha256": "b" * 64, "size": 456}
    client = _mock_async_client(response)
    asset = PlatformAsset(
        url="https://example.com/ecc-fe.tar.gz",
        sha256="a" * 64,
        size=456,
        metadata_url="https://example.com/ecc-fe.metadata.json",
        sha256_url="https://example.com/ecc-fe.sha256",
    )

    with patch(
        "ecos_server.resource.asset_resolution.httpx.AsyncClient",
        return_value=client,
    ):
        assert await fetch_asset_update_sha256(asset) == "b" * 64

    client.get.assert_awaited_once_with(asset.metadata_url)


@pytest.mark.asyncio
async def test_install_resolution_rejects_sidecar_only_assets() -> None:
    asset = PlatformAsset.model_construct(
        url="https://example.com/ecc-fe.tar.gz",
        sha256="",
        sha256_url="https://example.com/ecc-fe.sha256",
        size=456,
    )

    with pytest.raises(ValueError, match="static sha256"):
        await resolve_asset(asset)


@pytest.mark.asyncio
async def test_install_resolution_requires_static_size() -> None:
    asset = PlatformAsset.model_construct(
        url="https://example.com/ecc-fe.tar.gz",
        sha256="a" * 64,
        size=None,
    )

    with pytest.raises(ValueError, match="static size"):
        await resolve_asset(asset)
