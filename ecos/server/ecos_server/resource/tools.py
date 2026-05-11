#!/usr/bin/env python

import asyncio
import logging
import platform
import shutil
from pathlib import Path
from typing import Callable

from ecos_server.plugin.schemas import PlatformAsset
from ecos_server.plugin.services.installer import InstallerService
from ecos_server.sse import event_manager

from .inventory import InventoryService
from .schemas import ResourceAction, ResourceJob

logger = logging.getLogger(__name__)

_DEFAULT_TOOLS_DIR = Path.home() / ".ecos" / "tools"


class ToolResourceService:
    """Orchestrates tool installation and removal through the existing installer.

    Wraps InstallerService for download/verify/extract and InventoryService
    for resource manifest management, while preserving legacy tools manifest
    compatibility via the inventory service.
    """

    def __init__(
        self,
        installer: InstallerService | None = None,
        inventory: InventoryService | None = None,
    ) -> None:
        # Defer ManagerService import to avoid circular dependency at module level
        from ecos_server.plugin.services.manager import ManagerService

        self._installer = installer or InstallerService(manager=ManagerService())
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

    async def install(
        self,
        name: str,
        version: str,
        asset: PlatformAsset,
        *,
        on_progress: Callable[[ResourceJob], None] | None = None,
    ) -> None:
        """Download, verify, extract, and register a tool.

        Publishes ResourceJob progress events via callback and SSE event manager.
        Raises on failure; caller should handle and publish error state.
        """
        tools_dir = _DEFAULT_TOOLS_DIR
        dest_dir = tools_dir / name / version

        def _publish(job: ResourceJob) -> None:
            if on_progress:
                on_progress(job)
            event_manager.publish(f"resource:{job.resource_id}", job)

        import tempfile

        _publish(
            ResourceJob(
                resource_id=f"tool:{name}",
                action=ResourceAction.install,
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
                        action=ResourceAction.install,
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
                    action=ResourceAction.install,
                    phase="verifying",
                    progress=0.0,
                    message="Verifying SHA256...",
                )
            )

            ok = await asyncio.to_thread(InstallerService.verify_sha256, archive_path, asset.sha256)
            if not ok:
                error_job = ResourceJob(
                    resource_id=f"tool:{name}",
                    action=ResourceAction.install,
                    phase="error",
                    progress=0.0,
                    message="SHA256 verification failed",
                )
                _publish(error_job)
                raise ValueError(f"SHA256 verification failed for {name}")

            _publish(
                ResourceJob(
                    resource_id=f"tool:{name}",
                    action=ResourceAction.install,
                    phase="extracting",
                    progress=0.0,
                    message=f"Extracting to {dest_dir}...",
                )
            )

            await asyncio.to_thread(
                self._installer.extract,
                archive_path,
                dest_dir,
                asset.strip_prefix,
            )

        self._inventory.add_tool(
            name=name,
            version=version,
            path=str(dest_dir),
            sha256=asset.sha256,
        )

        _publish(
            ResourceJob(
                resource_id=f"tool:{name}",
                action=ResourceAction.install,
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

        tool_path = Path(entry.path)
        if tool_path.exists():
            await asyncio.to_thread(shutil.rmtree, tool_path)

        self._inventory.remove_tool(name)
