#!/usr/bin/env python
# -*- encoding: utf-8 -*-

import json
import logging
import time
from pathlib import Path

import httpx

from ..schemas import ToolRegistry

logger = logging.getLogger(__name__)

_DEFAULT_CACHE_DIR = Path.home() / ".ecos" / "cache"
_DEFAULT_TTL = 3600


def _bundled_registry_path() -> Path:
    """Shipped mock registry (see plugin/data/tool-registry.json)."""
    return Path(__file__).resolve().parent.parent / "data" / "tool-registry.json"


class RegistryService:
    """Load tool registry from bundled JSON (default) or a remote URL (tests / overrides)."""

    def __init__(
        self,
        registry_url: str | None = None,
        cache_dir: Path | None = None,
        ttl_seconds: int = _DEFAULT_TTL,
    ) -> None:
        # None = read ecos_server/plugin/data/tool-registry.json (no network)
        self._registry_url = registry_url
        self._cache_dir = cache_dir or _DEFAULT_CACHE_DIR
        self._cache_file = self._cache_dir / "tool-registry.json"
        self._ttl_seconds = ttl_seconds
        self._in_memory: ToolRegistry | None = None

    def _load_cached(self) -> ToolRegistry | None:
        if not self._cache_file.exists():
            return None
        try:
            data = json.loads(self._cache_file.read_text(encoding="utf-8"))
            return ToolRegistry(**data)
        except Exception:
            logger.warning("Failed to parse cached registry", exc_info=True)
            return None

    def _save_cache(self, registry: ToolRegistry) -> None:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._cache_file.write_text(
            registry.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def _is_cache_expired(self) -> bool:
        if not self._cache_file.exists():
            return True
        age = time.time() - self._cache_file.stat().st_mtime
        return age > self._ttl_seconds

    def _load_bundled(self) -> ToolRegistry | None:
        path = _bundled_registry_path()
        if not path.is_file():
            logger.warning("Bundled tool-registry.json not found: %s", path)
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return ToolRegistry(**data)
        except Exception:
            logger.warning("Failed to parse bundled registry", exc_info=True)
            return None

    async def fetch(self, force: bool = False) -> ToolRegistry | None:
        """Bundled JSON by default; optional HTTP URL when registry_url was set in __init__."""
        if self._registry_url is None:
            if not force and self._in_memory is not None:
                return self._in_memory
            if not force and not self._is_cache_expired():
                cached = self._load_cached()
                if cached:
                    self._in_memory = cached
                    return cached
            registry = self._load_bundled()
            if registry is not None:
                self._save_cache(registry)
                self._in_memory = registry
                return registry
            cached = self._load_cached()
            if cached:
                self._in_memory = cached
                return cached
            return None

        if not force and self._in_memory is not None and not self._is_cache_expired():
            return self._in_memory

        if not force and not self._is_cache_expired():
            cached = self._load_cached()
            if cached:
                self._in_memory = cached
                return cached

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(self._registry_url)
                resp.raise_for_status()
                registry = ToolRegistry(**resp.json())
                self._save_cache(registry)
                self._in_memory = registry
                return registry
        except Exception:
            logger.warning("Failed to fetch registry, falling back to cache", exc_info=True)
            cached = self._load_cached()
            if cached:
                self._in_memory = cached
            return cached
