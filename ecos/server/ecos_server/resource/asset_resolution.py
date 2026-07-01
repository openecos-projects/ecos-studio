#!/usr/bin/env python

import logging
import re

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


async def fetch_asset_sha256(asset: PlatformAsset) -> str | None:
    if not asset.sha256_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(asset.sha256_url)
            resp.raise_for_status()
            return parse_sha256_text(resp.text)
    except Exception as exc:
        logger.debug("Failed to fetch SHA256 %s: %s", asset.sha256_url, exc)
        return None


async def resolve_asset(asset: PlatformAsset) -> PlatformAsset:
    sha256 = asset.sha256 or await fetch_asset_sha256(asset)
    if not sha256:
        raise ValueError("Resource asset has no sha256 or reachable sha256_url")
    return PlatformAsset(
        url=asset.url,
        sha256=sha256,
        sha256_url=asset.sha256_url,
        metadata_url=asset.metadata_url,
        size=asset.size,
        strip_prefix=asset.strip_prefix,
        post_install=asset.post_install,
    )
