#!/usr/bin/env python

import json
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Default resource manifest path
_DEFAULT_RESOURCES_DIR = Path.home() / ".ecos" / "resources"
_DEFAULT_TOOLS_DIR = Path.home() / ".ecos" / "tools"


class ToolInventoryEntry(BaseModel):
    name: str
    version: str
    path: str
    installed_at: str
    sha256: str


class PdkInventoryEntry(BaseModel):
    id: str
    name: str = ""
    canonical_path: str
    detected_files: list[str] = Field(default_factory=list)
    imported_at: str = ""
    active: bool = False
    managed: bool = False
    health: str = "ok"


class ResourceManifest(BaseModel):
    schema_version: int = 1
    tools: dict[str, ToolInventoryEntry] = Field(default_factory=dict)
    pdks: dict[str, PdkInventoryEntry] = Field(default_factory=dict)


class InventoryService:
    """Read/write resource inventory manifest at a configurable path.

    The manifest stores installed tools and imported PDKs as runtime state.
    Tests inject temporary directories for deterministic behavior.
    """

    def __init__(
        self,
        resource_manifest_path: Path | None = None,
        tools_manifest_path: Path | None = None,
    ) -> None:
        self._manifest_path = resource_manifest_path or (_DEFAULT_RESOURCES_DIR / "manifest.json")
        self._tools_manifest_path = tools_manifest_path or (_DEFAULT_TOOLS_DIR / "manifest.json")

    @property
    def manifest_path(self) -> Path:
        return self._manifest_path

    def _empty_manifest(self) -> ResourceManifest:
        return ResourceManifest()

    def _read_manifest(self) -> ResourceManifest:
        if not self._manifest_path.exists():
            return self._empty_manifest()
        try:
            data = json.loads(self._manifest_path.read_text(encoding="utf-8"))
            return ResourceManifest(**data)
        except Exception:
            logger.warning("Corrupt resource manifest at %s, backing up", self._manifest_path)
            self._backup_manifest()
            return self._empty_manifest()

    def _write_manifest(self, manifest: ResourceManifest) -> None:
        self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._manifest_path.with_suffix(".tmp")
        tmp.write_text(
            manifest.model_dump_json(indent=2),
            encoding="utf-8",
        )
        tmp.replace(self._manifest_path)

    def _backup_manifest(self) -> None:
        """Preserve corrupt manifest before overwriting."""
        if not self._manifest_path.exists():
            return
        backup = self._manifest_path.with_suffix(".json.bak")
        shutil.copy2(self._manifest_path, backup)
        logger.info("Backed up corrupt manifest to %s", backup)

    def _generate_legacy_tools_manifest(self, manifest: ResourceManifest) -> None:
        """Write compatibility tools/manifest.json from resource inventory tool entries."""
        tools_dir = self._tools_manifest_path.parent
        tools_dir.mkdir(parents=True, exist_ok=True)
        installed: dict[str, Any] = {}
        for name, entry in manifest.tools.items():
            installed[name] = {
                "version": entry.version,
                "path": entry.path,
                "installed_at": entry.installed_at,
                "sha256": entry.sha256,
            }
        legacy = {
            "schema_version": 1,
            "tools_dir": str(tools_dir),
            "installed": installed,
        }
        tmp = self._tools_manifest_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(legacy, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._tools_manifest_path)

    # ── Tool operations ──────────────────────────────────────────────

    def get_installed_tools(self) -> dict[str, ToolInventoryEntry]:
        return self._read_manifest().tools

    def get_tool(self, name: str) -> ToolInventoryEntry | None:
        return self._read_manifest().tools.get(name)

    def add_tool(self, *, name: str, version: str, path: str, sha256: str) -> None:
        manifest = self._read_manifest()
        manifest.tools[name] = ToolInventoryEntry(
            name=name,
            version=version,
            path=path,
            installed_at=datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            sha256=sha256,
        )
        self._write_manifest(manifest)
        self._generate_legacy_tools_manifest(manifest)

    def remove_tool(self, name: str) -> None:
        manifest = self._read_manifest()
        manifest.tools.pop(name, None)
        self._write_manifest(manifest)
        self._generate_legacy_tools_manifest(manifest)

    # ── PDK operations ───────────────────────────────────────────────

    def get_imported_pdks(self) -> dict[str, PdkInventoryEntry]:
        return self._read_manifest().pdks

    def get_pdk(self, pdk_id: str) -> PdkInventoryEntry | None:
        return self._read_manifest().pdks.get(pdk_id)

    def add_or_update_pdk(
        self,
        pdk_id: str,
        *,
        name: str = "",
        canonical_path: str,
        detected_files: list[str] | None = None,
    ) -> PdkInventoryEntry:
        manifest = self._read_manifest()
        now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        existing = manifest.pdks.get(pdk_id)
        entry = PdkInventoryEntry(
            id=pdk_id,
            name=name or (existing.name if existing else ""),
            canonical_path=canonical_path,
            detected_files=detected_files or [],
            imported_at=now,
            active=existing.active if existing else False,
            managed=existing.managed if existing else False,
            health="ok",
        )
        manifest.pdks[pdk_id] = entry
        self._write_manifest(manifest)
        return entry

    def remove_pdk(self, pdk_id: str) -> None:
        """Remove PDK inventory reference only; never delete source directory."""
        manifest = self._read_manifest()
        manifest.pdks.pop(pdk_id, None)
        self._write_manifest(manifest)

    def set_pdk_active(self, pdk_id: str, active: bool) -> None:
        manifest = self._read_manifest()
        entry = manifest.pdks.get(pdk_id)
        if entry is None:
            raise KeyError(f"PDK '{pdk_id}' not found in inventory")
        # Only one PDK active at a time
        if active:
            for pid, pent in manifest.pdks.items():
                pent.active = pid == pdk_id
        else:
            entry.active = False
        self._write_manifest(manifest)

    def set_pdk_health(self, pdk_id: str, health: str) -> None:
        manifest = self._read_manifest()
        entry = manifest.pdks.get(pdk_id)
        if entry is None:
            raise KeyError(f"PDK '{pdk_id}' not found in inventory")
        entry.health = health
        self._write_manifest(manifest)

    def get_active_pdk(self) -> PdkInventoryEntry | None:
        manifest = self._read_manifest()
        for entry in manifest.pdks.values():
            if entry.active:
                return entry
        return None
