"""PDK evidence shared by optimization and replay calibration."""

import re
from pathlib import Path

from ecos_agent.hashing import artifact_fingerprint, canonical_sha256, file_sha256


def _cell_views(root: Path, suffix: str) -> list[Path]:
    return sorted((root / "IP" / "STD_cell").rglob(f"*{suffix}"))


def pdk_fingerprint(root: Path) -> str:
    """Bind calibration to technology and cells using the shared large-file policy."""
    tech = root / "prtech/techLEF/N551P6M_ecos.lef"
    paths = [tech, *_cell_views(root, ".lef"), *_cell_views(root, ".lib")]
    return canonical_sha256(
        {
            path.relative_to(root).as_posix(): (
                artifact_fingerprint(path) if path.suffix == ".lib" else file_sha256(path)
            )
            for path in paths
        }
    )


def site_width_dbu(root: Path) -> int:
    """Read units from technology LEF and prefer the v2 standard-cell site."""
    tech = (root / "prtech/techLEF/N551P6M_ecos.lef").read_text(encoding="utf-8")
    units = re.search(r"DATABASE\s+MICRONS\s+(\d+)", tech, re.IGNORECASE)
    cell_text = "\n".join(path.read_text(encoding="utf-8") for path in _cell_views(root, ".lef"))
    site = re.search(
        r"SITE\s+SC9T_site\b(?P<body>.*?)END\s+SC9T_site\b",
        cell_text,
        re.IGNORECASE | re.DOTALL,
    )
    if site is None:
        site = re.search(
            r"SITE\s+(?P<name>core7|CoreSite)\b(?P<body>.*?)END\s+(?P=name)\b",
            tech,
            re.IGNORECASE | re.DOTALL,
        )
    size = re.search(r"SIZE\s+([0-9]+(?:\.[0-9]+)?)\s+BY", site["body"] if site else "", re.IGNORECASE)
    if units is None or size is None:
        raise ValueError("PDK site width is unavailable")
    width = round(int(units[1]) * float(size[1]))
    if width <= 0:
        raise ValueError("PDK site width is invalid")
    return width
