#!/usr/bin/env python

import logging
import re
from typing import Any

import httpx

from .schemas import PlatformAsset

logger = logging.getLogger(__name__)

_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


def parse_sha256_text(value: str) -> str | None:
    token = value.strip().split()[0] if value.strip() else ""
    normalized = token.lower()
    if _SHA256_RE.match(normalized):
        return normalized
    return None


def parse_release_metadata(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    sha256 = parse_sha256_text(str(value.get("sha256", "")))
    size = value.get("size")
    if not sha256 or not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        return None
    return {
        "sha256": sha256,
        "size": size,
        "commit": str(value.get("commit", "")),
        "built_at": str(value.get("built_at", "")),
    }


def asset_update_url(asset: PlatformAsset) -> str | None:
    return asset.metadata_url or asset.sha256_url


async def fetch_asset_update_sha256(asset: PlatformAsset) -> str | None:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        if asset.metadata_url:
            try:
                resp = await client.get(asset.metadata_url)
                resp.raise_for_status()
                metadata = parse_release_metadata(resp.json())
                if metadata is not None:
                    return str(metadata["sha256"])
                logger.debug("Invalid release metadata from %s", asset.metadata_url)
            except Exception as exc:
                logger.debug("Failed to fetch metadata %s: %s", asset.metadata_url, exc)

        if asset.sha256_url:
            try:
                resp = await client.get(asset.sha256_url)
                resp.raise_for_status()
                return parse_sha256_text(resp.text)
            except Exception as exc:
                logger.debug("Failed to fetch SHA256 %s: %s", asset.sha256_url, exc)
    return None


async def resolve_asset(asset: PlatformAsset) -> PlatformAsset:
    """Validate and return the immutable registry lock used for installation."""
    sha256 = parse_sha256_text(asset.sha256)
    if not sha256:
        raise ValueError("Resource asset has no valid static sha256 lock")
    if asset.size is None or asset.size <= 0:
        raise ValueError("Resource asset has no valid static size lock")
    return PlatformAsset(
        url=asset.url,
        sha256=sha256,
        sha256_url=asset.sha256_url,
        metadata_url=asset.metadata_url,
        size=asset.size,
        strip_prefix=asset.strip_prefix,
        supplemental_assets=asset.supplemental_assets,
        post_install=asset.post_install,
    )
