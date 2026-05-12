#!/usr/bin/env python

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from .inventory import InventoryService, PdkInventoryEntry

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

    def __init__(self, inventory: InventoryService | None = None) -> None:
        self._inventory = inventory or InventoryService()

    @property
    def inventory(self) -> InventoryService:
        return self._inventory

    # ── Scan ──────────────────────────────────────────────────────────

    @staticmethod
    def scan(path: str) -> ScannedPdk:
        """Scan a directory and return PDK metadata without mutating inventory.

        Raises ValueError for non-directory paths or paths with invalid characters.
        """
        if _INVALID_PATH_RE.search(path):
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
        )

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

    # ── Remove Reference ───────────────────────────────────────────────

    def remove_reference(self, pdk_id: str) -> None:
        """Remove PDK inventory reference; never deletes the source directory."""
        self._inventory.remove_pdk(pdk_id)

    # ── List ───────────────────────────────────────────────────────────

    def list_pdks(self) -> dict[str, PdkInventoryEntry]:
        return self._inventory.get_imported_pdks()

    def get_pdk(self, pdk_id: str) -> PdkInventoryEntry | None:
        return self._inventory.get_pdk(pdk_id)
