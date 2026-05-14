#!/usr/bin/env python

import fcntl
import json
import logging
import shutil
import threading
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .paths import default_pdks_dir, default_resources_dir, default_tools_dir

logger = logging.getLogger(__name__)

_LOCKS_GUARD = threading.Lock()
_PROCESS_LOCKS: dict[Path, threading.RLock] = {}


def _process_lock_for(path: Path) -> threading.RLock:
    with _LOCKS_GUARD:
        return _PROCESS_LOCKS.setdefault(path.resolve(), threading.RLock())


class ToolInventoryEntry(BaseModel):
    type: Literal["tool"] = "tool"
    name: str
    version: str
    path: str
    installed_at: str
    sha256: str
    detected_executables: list[str] = Field(default_factory=list)
    executable: str = ""
    active: bool = True
    managed: bool = True


class PdkInventoryEntry(BaseModel):
    type: Literal["pdk"] = "pdk"
    id: str
    name: str = ""
    pdk_id: str = ""
    version: str = ""
    sha256: str = ""
    source: str = ""
    source_url: str = ""
    canonical_path: str
    path: str = ""
    detected_files: list[str] = Field(default_factory=list)
    detected_file_groups: dict[str, list[str]] = Field(
        default_factory=lambda: {"directories": [], "files": []}
    )
    imported_at: str = ""
    active: bool = False
    managed: bool = False
    health: str = "ok"


ResourceInventoryEntry = Annotated[
    ToolInventoryEntry | PdkInventoryEntry,
    Field(discriminator="type"),
]


class ResourceManifest(BaseModel):
    schema_version: int = 1
    resources_dir: str
    tools_dir: str
    pdks_dir: str = ""
    installed: dict[str, ResourceInventoryEntry] = Field(default_factory=dict)


class InventoryService:
    """Read/write the Resource Manager manifest under XDG state paths."""

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _default_executable(name: str, detected_executables: list[str]) -> str:
        if detected_executables:
            return detected_executables[0]
        return f"bin/{name}"

    def __init__(
        self,
        resource_manifest_path: Path | None = None,
        tools_dir: Path | None = None,
        pdks_dir: Path | None = None,
    ) -> None:
        resources_dir = default_resources_dir()
        self._manifest_path = resource_manifest_path or (resources_dir / "manifest.json")
        self._tools_dir = tools_dir or default_tools_dir()
        self._pdks_dir = pdks_dir or default_pdks_dir()

    @property
    def manifest_path(self) -> Path:
        return self._manifest_path

    @property
    def resources_dir(self) -> Path:
        return self._manifest_path.parent

    @property
    def tools_dir(self) -> Path:
        return self._tools_dir

    @property
    def pdks_dir(self) -> Path:
        return self._pdks_dir

    def _empty_manifest(self) -> ResourceManifest:
        return ResourceManifest(
            resources_dir=str(self.resources_dir),
            tools_dir=str(self._tools_dir),
            pdks_dir=str(self._pdks_dir),
            installed={},
        )

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

    @contextmanager
    def _mutation_lock(self):
        self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
        lock = _process_lock_for(self._manifest_path)
        with lock:
            lock_path = self._manifest_path.with_suffix(".lock")
            with lock_path.open("a+", encoding="utf-8") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _write_manifest(self, manifest: ResourceManifest) -> None:
        manifest.resources_dir = str(self.resources_dir)
        manifest.tools_dir = str(self._tools_dir)
        manifest.pdks_dir = str(self._pdks_dir)
        self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._manifest_path.with_name(
            f"{self._manifest_path.name}.{threading.get_ident()}.tmp"
        )
        tmp.write_text(
            manifest.model_dump_json(indent=2),
            encoding="utf-8",
        )
        tmp.replace(self._manifest_path)

    def _backup_manifest(self) -> None:
        if not self._manifest_path.exists():
            return
        backup = self._manifest_path.with_suffix(".json.bak")
        shutil.copy2(self._manifest_path, backup)
        logger.info("Backed up corrupt manifest to %s", backup)

    def get_installed_tools(self) -> dict[str, ToolInventoryEntry]:
        manifest = self._read_manifest()
        result: dict[str, ToolInventoryEntry] = {}
        for resource_id, entry in manifest.installed.items():
            if isinstance(entry, ToolInventoryEntry):
                result[resource_id.removeprefix("tool:")] = entry
        return result

    def get_tool(self, name: str) -> ToolInventoryEntry | None:
        entry = self._read_manifest().installed.get(f"tool:{name}")
        return entry if isinstance(entry, ToolInventoryEntry) else None

    def add_tool(
        self,
        *,
        name: str,
        version: str,
        path: str,
        sha256: str,
        detected_executables: list[str] | None = None,
        executable: str | None = None,
        active: bool = True,
        managed: bool = True,
    ) -> None:
        detected = detected_executables or []
        with self._mutation_lock():
            manifest = self._read_manifest()
            manifest.installed[f"tool:{name}"] = ToolInventoryEntry(
                name=name,
                version=version,
                path=path,
                installed_at=self._utc_now_iso(),
                sha256=sha256,
                detected_executables=detected,
                executable=executable or self._default_executable(name, detected),
                active=active,
                managed=managed,
            )
            self._write_manifest(manifest)

    def remove_tool(self, name: str) -> None:
        with self._mutation_lock():
            manifest = self._read_manifest()
            manifest.installed.pop(f"tool:{name}", None)
            self._write_manifest(manifest)

    def get_imported_pdks(self) -> dict[str, PdkInventoryEntry]:
        manifest = self._read_manifest()
        result: dict[str, PdkInventoryEntry] = {}
        for resource_id, entry in manifest.installed.items():
            if isinstance(entry, PdkInventoryEntry):
                result[resource_id.removeprefix("pdk:")] = entry
        return result

    def get_pdk(self, pdk_id: str) -> PdkInventoryEntry | None:
        entry = self._read_manifest().installed.get(f"pdk:{pdk_id}")
        return entry if isinstance(entry, PdkInventoryEntry) else None

    def add_or_update_pdk(
        self,
        pdk_id: str,
        *,
        name: str = "",
        canonical_path: str,
        detected_files: list[str] | None = None,
        detected_file_groups: dict[str, list[str]] | None = None,
        version: str | None = None,
        sha256: str | None = None,
        source: str | None = None,
        source_url: str | None = None,
        managed: bool | None = None,
        active: bool | None = None,
    ) -> PdkInventoryEntry:
        with self._mutation_lock():
            manifest = self._read_manifest()
            resource_id = f"pdk:{pdk_id}"
            existing = manifest.installed.get(resource_id)
            existing_pdk = existing if isinstance(existing, PdkInventoryEntry) else None
            groups = detected_file_groups or {
                "directories": [],
                "files": detected_files or [],
            }
            next_managed = (
                managed
                if managed is not None
                else (existing_pdk.managed if existing_pdk else False)
            )
            next_active = (
                active if active is not None else (existing_pdk.active if existing_pdk else False)
            )
            entry = PdkInventoryEntry(
                id=pdk_id,
                name=name or (existing_pdk.name if existing_pdk else ""),
                pdk_id=pdk_id,
                version=version
                if version is not None
                else (existing_pdk.version if existing_pdk else ""),
                sha256=sha256
                if sha256 is not None
                else (existing_pdk.sha256 if existing_pdk else ""),
                source=source
                if source is not None
                else (existing_pdk.source if existing_pdk else ""),
                source_url=source_url
                if source_url is not None
                else (existing_pdk.source_url if existing_pdk else ""),
                canonical_path=canonical_path,
                path=canonical_path,
                detected_files=detected_files or [],
                detected_file_groups=groups,
                imported_at=self._utc_now_iso(),
                active=next_active,
                managed=next_managed,
                health="ok",
            )
            if next_active:
                for rid, pent in manifest.installed.items():
                    if isinstance(pent, PdkInventoryEntry):
                        pent.active = rid == resource_id
            manifest.installed[resource_id] = entry
            self._write_manifest(manifest)
            return entry

    def remove_pdk(self, pdk_id: str) -> None:
        with self._mutation_lock():
            manifest = self._read_manifest()
            manifest.installed.pop(f"pdk:{pdk_id}", None)
            self._write_manifest(manifest)

    def set_pdk_active(self, pdk_id: str, active: bool) -> None:
        with self._mutation_lock():
            manifest = self._read_manifest()
            resource_id = f"pdk:{pdk_id}"
            entry = manifest.installed.get(resource_id)
            if not isinstance(entry, PdkInventoryEntry):
                raise KeyError(f"PDK '{pdk_id}' not found in inventory")
            if active:
                for rid, pent in manifest.installed.items():
                    if isinstance(pent, PdkInventoryEntry):
                        pent.active = rid == resource_id
            else:
                entry.active = False
            self._write_manifest(manifest)

    def set_pdk_health(self, pdk_id: str, health: str) -> None:
        with self._mutation_lock():
            manifest = self._read_manifest()
            entry = manifest.installed.get(f"pdk:{pdk_id}")
            if not isinstance(entry, PdkInventoryEntry):
                raise KeyError(f"PDK '{pdk_id}' not found in inventory")
            entry.health = health
            self._write_manifest(manifest)

    def get_active_pdk(self) -> PdkInventoryEntry | None:
        for entry in self._read_manifest().installed.values():
            if isinstance(entry, PdkInventoryEntry) and entry.active:
                return entry
        return None
