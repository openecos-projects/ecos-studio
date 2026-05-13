#!/usr/bin/env python

import asyncio
import logging
import os
import platform
import shutil
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path

from .installer import InstallerService
from .inventory import InventoryService
from .paths import default_tools_dir
from .schemas import PlatformAsset, ResourceAction, ResourceJob

logger = logging.getLogger(__name__)

_DEFAULT_TOOLS_DIR = None


def _default_tools_dir() -> Path:
    return _DEFAULT_TOOLS_DIR or default_tools_dir()


class ToolResourceService:
    """Orchestrates tool installation and removal.

    Uses InstallerService for download/verify/extract and InventoryService
    for resource manifest management. Progress events are emitted via
    callback only; the router's JobTracker owns SSE publication.
    """

    def __init__(
        self,
        installer: InstallerService | None = None,
        inventory: InventoryService | None = None,
    ) -> None:
        self._installer = installer or InstallerService()
        self._inventory = inventory or InventoryService()

    @property
    def inventory(self) -> InventoryService:
        return self._inventory

    @staticmethod
    def current_platform() -> str:
        system = platform.system().lower()
        machine = platform.machine().lower().replace("amd64", "x86_64")
        if system == "linux":
            return f"linux-{machine}"
        if system == "darwin":
            return f"darwin-{machine}"
        return f"{system}-{machine}"

    def get_installed(self) -> dict:
        return self._inventory.get_installed_tools()

    @staticmethod
    def _detect_executables(install_dir: Path) -> list[str]:
        if not install_dir.exists():
            return []

        executables: list[str] = []
        for candidate in sorted(install_dir.rglob("*")):
            if not candidate.is_file():
                continue
            try:
                if os.access(candidate, os.X_OK):
                    executables.append(candidate.relative_to(install_dir).as_posix())
            except OSError:
                continue
        return executables

    async def install(
        self,
        name: str,
        version: str,
        asset: PlatformAsset,
        *,
        action: ResourceAction = ResourceAction.install,
        on_progress: Callable[[ResourceJob], None] | None = None,
    ) -> None:
        """Download, verify, extract, and register a tool.

        Progress events are emitted via the on_progress callback only;
        the caller (router) owns SSE publication through JobTracker.
        """
        tools_dir = self._inventory.tools_dir
        dest_dir = tools_dir / name / version
        extract_dir = dest_dir.parent / f".extract-{version}-{uuid.uuid4().hex}"

        def _publish(job: ResourceJob) -> None:
            if on_progress:
                on_progress(job)

        _publish(
            ResourceJob(
                resource_id=f"tool:{name}",
                action=action,
                phase="downloading",
                progress=0.0,
                message=f"Downloading {name} v{version}...",
            )
        )

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = Path(tmp) / f"{name}.archive"

            def _dl_progress(pct: float) -> None:
                _publish(
                    ResourceJob(
                        resource_id=f"tool:{name}",
                        action=action,
                        phase="downloading",
                        progress=pct,
                        message=f"Downloading... {pct:.0%}",
                    )
                )

            await self._installer.download(
                url=asset.url,
                dest=archive_path,
                expected_size=asset.size,
                on_progress=_dl_progress,
            )

            _publish(
                ResourceJob(
                    resource_id=f"tool:{name}",
                    action=action,
                    phase="verifying",
                    progress=0.0,
                    message="Verifying SHA256...",
                )
            )

            ok = await asyncio.to_thread(InstallerService.verify_sha256, archive_path, asset.sha256)
            if not ok:
                _publish(
                    ResourceJob(
                        resource_id=f"tool:{name}",
                        action=action,
                        phase="error",
                        progress=0.0,
                        message="SHA256 verification failed",
                        error="SHA256 verification failed",
                    )
                )
                raise ValueError(f"SHA256 verification failed for {name}")

            _publish(
                ResourceJob(
                    resource_id=f"tool:{name}",
                    action=action,
                    phase="extracting",
                    progress=0.0,
                    message=f"Extracting to {dest_dir}...",
                )
            )

            await asyncio.to_thread(
                self._installer.extract,
                archive_path,
                extract_dir,
                asset.strip_prefix,
            )

        if dest_dir.exists():
            await asyncio.to_thread(shutil.rmtree, dest_dir)
        dest_dir.parent.mkdir(parents=True, exist_ok=True)
        extract_dir.replace(dest_dir)

        detected = self._detect_executables(dest_dir)
        self._inventory.add_tool(
            name=name,
            version=version,
            path=str(dest_dir),
            sha256=asset.sha256,
            detected_executables=detected,
            executable=InventoryService._default_executable(name, detected),
        )

        _publish(
            ResourceJob(
                resource_id=f"tool:{name}",
                action=action,
                phase="done",
                progress=1.0,
                message=f"{name} v{version} installed successfully",
            )
        )

    async def uninstall(self, name: str) -> None:
        """Remove an installed tool: delete files and update inventory."""
        entry = self._inventory.get_tool(name)
        if entry is None:
            raise KeyError(f"Tool '{name}' is not installed")
        if not entry.managed:
            raise PermissionError(f"Tool '{name}' is unmanaged and cannot be uninstalled")

        tool_path = Path(entry.path)
        if tool_path.exists():
            await asyncio.to_thread(shutil.rmtree, tool_path)

        self._inventory.remove_tool(name)
