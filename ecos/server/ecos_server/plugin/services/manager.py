#!/usr/bin/env python
# -*- encoding: utf-8 -*-

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore[misc, assignment]

_DEFAULT_TOOLS_DIR = Path.home() / ".ecos" / "tools"


class ManagerService:
    """Read/write ~/.ecos/tools/manifest.json with file locking (fcntl on Unix)."""

    def __init__(self, tools_dir: Path | None = None) -> None:
        self._tools_dir = tools_dir or _DEFAULT_TOOLS_DIR
        self._manifest_path = self._tools_dir / "manifest.json"

    @property
    def tools_dir(self) -> Path:
        return self._tools_dir

    def _read_manifest(self) -> dict[str, Any]:
        if not self._manifest_path.exists():
            return {
                "schema_version": 1,
                "tools_dir": str(self._tools_dir),
                "installed": {},
            }
        return json.loads(self._manifest_path.read_text(encoding="utf-8"))

    def _write_manifest(self, data: dict[str, Any]) -> None:
        self._tools_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._manifest_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._manifest_path)

    def _with_lock(self, fn: Any) -> Any:
        self._tools_dir.mkdir(parents=True, exist_ok=True)
        lock_path = self._manifest_path.with_suffix(".lock")
        if fcntl is not None:
            with open(lock_path, "a+", encoding="utf-8") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    return fn()
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        # Fallback without fcntl (e.g. Windows): best-effort, not multi-process safe
        return fn()

    def get_installed(self) -> dict[str, Any]:
        return self._with_lock(lambda: self._read_manifest().get("installed", {}))

    def add_tool(self, *, name: str, version: str, path: str, sha256: str) -> None:
        def _add() -> None:
            manifest = self._read_manifest()
            manifest.setdefault("installed", {})[name] = {
                "version": version,
                "path": path,
                "installed_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                "sha256": sha256,
            }
            self._write_manifest(manifest)

        self._with_lock(_add)

    def remove_tool(self, name: str) -> None:
        def _remove() -> None:
            manifest = self._read_manifest()
            manifest.get("installed", {}).pop(name, None)
            self._write_manifest(manifest)

        self._with_lock(_remove)

    def get_tool_path(self, name: str) -> Path | None:
        installed = self.get_installed()
        entry = installed.get(name)
        if entry is None:
            return None
        return Path(entry["path"])
