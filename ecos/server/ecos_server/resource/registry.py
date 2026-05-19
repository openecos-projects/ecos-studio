#!/usr/bin/env python

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from .paths import default_registry_cache_dir
from .schemas import ResourceRegistryV1, ToolRegistry

logger = logging.getLogger(__name__)

_DEFAULT_CACHE_DIR = None
_DEFAULT_TTL = 3600
_FETCH_ATTEMPTS = 2
_FETCH_RETRY_DELAY_SECONDS = 0.25


@dataclass
class RegistryState:
    registry: ToolRegistry | None
    diagnostics: list[str]

    @property
    def is_degraded(self) -> bool:
        return bool(self.diagnostics)

    @property
    def is_empty(self) -> bool:
        return self.registry is None or (not self.registry.tools and not self.registry.pdks)


class RegistryService:
    """Remote-first registry loading without production bundled JSON.

    Fetches from a configured registry repository URL, caches locally,
    falls back to cache when remote unavailable, and returns a degraded
    empty state with diagnostics when both sources are unavailable.
    """

    def __init__(
        self,
        registry_url: str,
        cache_dir: Path | None = None,
        ttl_seconds: int = _DEFAULT_TTL,
    ) -> None:
        if not registry_url:
            raise ValueError("registry_url is required for remote-first operation")
        self._registry_url = registry_url
        self._cache_dir = cache_dir or default_registry_cache_dir()
        self._cache_file = self._cache_dir / "resource-registry.json"
        self._ttl_seconds = ttl_seconds
        self._in_memory: ToolRegistry | None = None

    @property
    def cache_file(self) -> Path:
        return self._cache_file

    @staticmethod
    def _to_tool_registry(validated: ResourceRegistryV1) -> ToolRegistry:
        """Convert a validated ResourceRegistryV1 to a ToolRegistry for internal use."""
        return ToolRegistry(
            schema_version=validated.schema_version,
            tools=validated.tools,
            pdks=validated.pdks,
        )

    def _load_cached(self) -> ToolRegistry | None:
        if not self._cache_file.exists():
            return None
        try:
            data = json.loads(self._cache_file.read_text(encoding="utf-8"))
            validated = ResourceRegistryV1(**data)
            return self._to_tool_registry(validated)
        except Exception:
            logger.warning("Failed to parse cached registry", exc_info=True)
            return None

    def _save_cache(self, registry: ToolRegistry) -> None:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        # Write as ResourceRegistryV1 shape (includes pdks field)
        data = registry.model_dump()
        data.setdefault("pdks", [])
        self._cache_file.write_text(
            json.dumps(data, indent=2),
            encoding="utf-8",
        )

    def _is_cache_expired(self) -> bool:
        if not self._cache_file.exists():
            return True
        age = time.time() - self._cache_file.stat().st_mtime
        return age > self._ttl_seconds

    async def fetch(self, force: bool = False) -> RegistryState:
        """Fetch registry from remote URL with cache fallback.

        Remote-first: always attempts the URL unless in-memory cache is fresh.
        Falls back to file cache, then degraded empty state with diagnostics.
        """
        diagnostics: list[str] = []

        # Return in-memory cached result if fresh enough
        if not force and self._in_memory is not None and not self._is_cache_expired():
            return RegistryState(registry=self._in_memory, diagnostics=[])

        # Try remote fetch first
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                for attempt in range(1, _FETCH_ATTEMPTS + 1):
                    try:
                        resp = await client.get(self._registry_url)
                        resp.raise_for_status()
                        raw = resp.json()
                        validated = ResourceRegistryV1(**raw)
                        registry = self._to_tool_registry(validated)
                        self._save_cache(registry)
                        self._in_memory = registry
                        return RegistryState(registry=registry, diagnostics=[])
                    except Exception as exc:
                        if attempt >= _FETCH_ATTEMPTS:
                            raise
                        logger.debug(
                            "Registry fetch attempt %d/%d failed for %s: %s",
                            attempt,
                            _FETCH_ATTEMPTS,
                            self._registry_url,
                            _describe_error(exc),
                        )
                        await asyncio.sleep(_FETCH_RETRY_DELAY_SECONDS)
        except Exception as exc:
            logger.warning(
                "Failed to fetch registry from %s: %s",
                self._registry_url,
                _describe_error(exc),
            )
            logger.debug(
                "Registry fetch traceback for %s",
                self._registry_url,
                exc_info=True,
            )
            diagnostics.append(f"Registry unavailable at {self._registry_url}")

        # Fall back to file cache (even if expired)
        cached = self._load_cached()
        if cached is not None:
            self._in_memory = cached
            diagnostics.append("Using cached registry data (may be outdated)")
            return RegistryState(registry=cached, diagnostics=diagnostics)

        # Degraded empty state
        diagnostics.append("No registry data available")
        return RegistryState(registry=None, diagnostics=diagnostics)

    async def refresh(self) -> RegistryState:
        """Force refresh from remote, bypassing cache."""
        return await self.fetch(force=True)


def _describe_error(error: Exception) -> str:
    detail = str(error).strip()
    name = type(error).__name__
    if detail:
        return f"{name}: {detail}"
    return name
