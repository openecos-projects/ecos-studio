#!/usr/bin/env python

import asyncio
import logging
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .installer import InstallerService
from .inventory import InventoryService, PdkInventoryEntry
from .schemas import PlatformAsset, ResourceAction, ResourceJob

logger = logging.getLogger(__name__)

_INVALID_PATH_RE = re.compile(r"[\s一-鿿㐀-䶿豈-﫿]")


@dataclass
class ScannedPdk:
    canonical_path: str
    name: str
    description: str
    tech_node: str
    pdk_id: str
    detected_files: list[str]
    detected_file_groups: dict[str, list[str]]


class PdkResourceService:
    """PDK scan, import, activate, validate, and remove-reference operations.

    Ports the Tauri scan logic to Python and manages PDK inventory
    through the InventoryService.
    """

    def __init__(
        self,
        inventory: InventoryService | None = None,
        installer: InstallerService | None = None,
    ) -> None:
        self._inventory = inventory or InventoryService()
        self._installer = installer or InstallerService()

    @property
    def inventory(self) -> InventoryService:
        return self._inventory

    # ── Scan ──────────────────────────────────────────────────────────

    @staticmethod
    def _scan_directory(path: str, *, validate_path_chars: bool) -> ScannedPdk:
        if validate_path_chars and _INVALID_PATH_RE.search(path):
            raise ValueError(f"PDK path contains invalid characters: {path}")

        raw = Path(path)
        resolved = raw.resolve(strict=False)
        if not resolved.is_dir():
            raise ValueError(f"Not a directory: {path}")

        canonical = str(resolved)

        # Collect top-level entries (max 20 of each)
        dirs: list[str] = []
        files: list[str] = []
        try:
            for entry in sorted(resolved.iterdir()):
                if entry.is_dir():
                    if len(dirs) < 20:
                        dirs.append(entry.name)
                elif entry.is_file() and len(files) < 20:
                    files.append(entry.name)
        except OSError as e:
            raise ValueError(f"Cannot read directory {path}: {e}") from e

        detected = dirs + files

        # Heuristic PDK identification (matches Tauri logic)
        name = resolved.name or "Unknown PDK"
        description = ""
        tech_node = ""
        pdk_id = name.lower().replace(" ", "_")

        if "prtech" in dirs and "IP" in dirs:
            name = "ics55"
            description = "ICSPROUT 55nm process library (auto-detected)"
            tech_node = "55nm"
            pdk_id = "ics55"
        elif any(d.startswith("sky130") for d in dirs):
            name = "SkyWater SKY130 PDK"
            description = "SkyWater 130nm open-source PDK (auto-detected)"
            tech_node = "130nm"
            pdk_id = "sky130"
        elif any(f.endswith(".lef") for f in files) or any(f.endswith(".lib") for f in files):
            description = "Process library files detected"

        return ScannedPdk(
            canonical_path=canonical,
            name=name,
            description=description,
            tech_node=tech_node,
            pdk_id=pdk_id,
            detected_files=detected,
            detected_file_groups={"directories": dirs, "files": files},
        )

    @staticmethod
    def scan(path: str) -> ScannedPdk:
        """Scan a directory and return PDK metadata without mutating inventory.

        Raises ValueError for non-directory paths or paths with invalid characters.
        """
        return PdkResourceService._scan_directory(path, validate_path_chars=True)

    @staticmethod
    def _resolve_post_install_cwd(root: Path, cwd: str) -> Path:
        candidate = (root / cwd).resolve(strict=False)
        root_resolved = root.resolve(strict=False)
        try:
            candidate.relative_to(root_resolved)
        except ValueError as exc:
            raise ValueError(f"Post-install cwd escapes PDK root: {cwd}") from exc
        return candidate

    @classmethod
    def _run_post_install(cls, root: Path, asset: PlatformAsset) -> None:
        for step in asset.post_install:
            if not step.command:
                raise ValueError("Post-install command cannot be empty")
            cwd = cls._resolve_post_install_cwd(root, step.cwd)
            try:
                subprocess.run(
                    step.command,
                    cwd=cwd,
                    check=True,
                    text=True,
                    capture_output=True,
                )
            except subprocess.CalledProcessError as exc:
                output = "\n".join(
                    part for part in (exc.stdout.strip(), exc.stderr.strip()) if part
                )
                detail = f"Post-install command failed: {' '.join(step.command)}"
                if output:
                    detail = f"{detail}\n{output}"
                raise RuntimeError(detail) from exc

    # ── Import ─────────────────────────────────────────────────────────

    def import_pdk(self, path: str) -> PdkInventoryEntry:
        """Scan a directory and create or update a PDK inventory entry."""
        scanned = self.scan(path)
        return self._inventory.add_or_update_pdk(
            scanned.pdk_id,
            name=scanned.name,
            canonical_path=scanned.canonical_path,
            detected_files=scanned.detected_files,
            detected_file_groups=scanned.detected_file_groups,
            version="",
            sha256="",
            source="",
            source_url="",
            managed=False,
        )

    async def install_managed_pdk(
        self,
        *,
        pdk_id: str,
        display_name: str,
        version: str,
        asset: PlatformAsset,
        action: ResourceAction = ResourceAction.install,
        on_progress: Callable[[ResourceJob], None] | None = None,
    ) -> PdkInventoryEntry:
        """Download, verify, extract, scan, and register a managed PDK."""
        dest_dir = self._inventory.pdks_dir / pdk_id / version
        staging_dir = dest_dir.parent / f".staging-{dest_dir.name}"
        existing_entry = self._inventory.get_pdk(pdk_id)
        superseded_managed_dir: Path | None = None
        if existing_entry is not None and existing_entry.managed:
            existing_dir = Path(existing_entry.canonical_path)
            existing_resolved = existing_dir.resolve(strict=False)
            dest_resolved = dest_dir.resolve(strict=False)
            if existing_resolved != dest_resolved:
                try:
                    dest_resolved.relative_to(existing_resolved)
                except ValueError:
                    superseded_managed_dir = existing_dir
                else:
                    logger.warning(
                        "Skipping cleanup of managed PDK path %s because it contains "
                        "new install %s",
                        existing_dir,
                        dest_dir,
                    )

        def _publish(job: ResourceJob) -> None:
            if on_progress:
                on_progress(job)

        _publish(
            ResourceJob(
                resource_id=f"pdk:{pdk_id}",
                action=action,
                phase="downloading",
                progress=0.0,
                message=f"Downloading {display_name or pdk_id} v{version}...",
            )
        )

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = Path(tmp) / f"{pdk_id}.archive"

            def _download_progress(pct: float) -> None:
                _publish(
                    ResourceJob(
                        resource_id=f"pdk:{pdk_id}",
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
                on_progress=_download_progress,
            )

            _publish(
                ResourceJob(
                    resource_id=f"pdk:{pdk_id}",
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
                        resource_id=f"pdk:{pdk_id}",
                        action=action,
                        phase="error",
                        progress=0.0,
                        message="SHA256 verification failed",
                        error="SHA256 verification failed",
                    )
                )
                raise ValueError(f"SHA256 verification failed for PDK {pdk_id}")

            _publish(
                ResourceJob(
                    resource_id=f"pdk:{pdk_id}",
                    action=action,
                    phase="extracting",
                    progress=0.0,
                    message=f"Extracting to {dest_dir}...",
                )
            )
            if staging_dir.exists():
                await asyncio.to_thread(shutil.rmtree, staging_dir)
            await asyncio.to_thread(
                self._installer.extract,
                archive_path,
                staging_dir,
                asset.strip_prefix,
            )

        try:
            if asset.post_install:
                _publish(
                    ResourceJob(
                        resource_id=f"pdk:{pdk_id}",
                        action=action,
                        phase="post_install",
                        progress=0.0,
                        message="Running PDK post-install steps...",
                    )
                )
                await asyncio.to_thread(self._run_post_install, staging_dir, asset)
            if dest_dir.exists():
                await asyncio.to_thread(shutil.rmtree, dest_dir)
            staging_dir.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(staging_dir.replace, dest_dir)
            scanned = self._scan_directory(str(dest_dir), validate_path_chars=False)
            active_pdk = self._inventory.get_active_pdk()
            should_activate = active_pdk is None or active_pdk.id == pdk_id
            entry = self._inventory.add_or_update_pdk(
                pdk_id,
                name=display_name or scanned.name,
                canonical_path=scanned.canonical_path,
                detected_files=scanned.detected_files,
                detected_file_groups=scanned.detected_file_groups,
                version=version,
                sha256=asset.sha256,
                source="registry",
                source_url=asset.url,
                managed=True,
                active=should_activate,
            )
        except Exception:
            if dest_dir.exists():
                await asyncio.to_thread(shutil.rmtree, dest_dir)
            if staging_dir.exists():
                await asyncio.to_thread(shutil.rmtree, staging_dir)
            raise

        if superseded_managed_dir is not None and superseded_managed_dir.exists():
            await asyncio.to_thread(shutil.rmtree, superseded_managed_dir)

        _publish(
            ResourceJob(
                resource_id=f"pdk:{pdk_id}",
                action=action,
                phase="done",
                progress=1.0,
                message=f"{display_name or pdk_id} v{version} installed successfully",
            )
        )
        return entry

    # ── Activate / Deactivate ──────────────────────────────────────────

    def activate(self, pdk_id: str) -> None:
        """Mark a PDK as the active one (deactivates all others)."""
        self._inventory.set_pdk_active(pdk_id, True)

    def deactivate(self, pdk_id: str) -> None:
        self._inventory.set_pdk_active(pdk_id, False)

    def get_active_pdk(self) -> PdkInventoryEntry | None:
        return self._inventory.get_active_pdk()

    # ── Validate ───────────────────────────────────────────────────────

    def validate(self, pdk_id: str) -> str:
        """Check PDK health: ok, missing, or invalid.

        Returns the health status string.
        """
        entry = self._inventory.get_pdk(pdk_id)
        if entry is None:
            raise KeyError(f"PDK '{pdk_id}' not found in inventory")

        path = Path(entry.canonical_path)
        if not path.exists():
            health = "missing"
        elif not path.is_dir():
            health = "invalid"
        else:
            health = "ok"

        self._inventory.set_pdk_health(pdk_id, health)
        return health

    async def uninstall_managed_pdk(self, pdk_id: str) -> None:
        """Delete managed PDK files and remove inventory entry."""
        entry = self._inventory.get_pdk(pdk_id)
        if entry is None:
            raise KeyError(f"PDK '{pdk_id}' is not installed")
        if not entry.managed:
            raise PermissionError(f"PDK '{pdk_id}' is unmanaged and cannot be uninstalled")

        pdk_path = Path(entry.canonical_path)
        if pdk_path.exists():
            await asyncio.to_thread(shutil.rmtree, pdk_path)

        self._inventory.remove_pdk(pdk_id)

    # ── Remove Reference ───────────────────────────────────────────────

    def remove_reference(self, pdk_id: str) -> None:
        """Remove PDK inventory reference; never deletes the source directory."""
        self._inventory.remove_pdk(pdk_id)

    # ── List ───────────────────────────────────────────────────────────

    def list_pdks(self) -> dict[str, PdkInventoryEntry]:
        return self._inventory.get_imported_pdks()

    def get_pdk(self, pdk_id: str) -> PdkInventoryEntry | None:
        return self._inventory.get_pdk(pdk_id)
