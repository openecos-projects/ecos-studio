from pathlib import Path

import pytest

from ecos_agent.optimization.pdk_evidence import pdk_fingerprint, site_width_dbu


def write_view(root: Path, relative: str, content: str) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def test_v2_site_comes_from_cells_instead_of_legacy_technology_site(tmp_path):
    write_view(
        tmp_path, "prtech/techLEF/N551P6M_ecos.lef",
        "UNITS DATABASE MICRONS 2000 ; END UNITS\n"
        "SITE core7 SIZE 0.14 BY 1.4 ; END core7\n",
    )
    assert site_width_dbu(tmp_path) == 280
    write_view(
        tmp_path, "IP/STD_cell/ICsprout55_SC9T_BASIC_SVT/lef/cells.lef",
        "SITE SC9T_site SIZE 0.2 BY 1.8 ; END SC9T_site\n",
    )
    assert site_width_dbu(tmp_path) == 400


def test_fingerprint_changes_with_cell_geometry_and_timing(tmp_path):
    write_view(tmp_path, "prtech/techLEF/N551P6M_ecos.lef", "same technology")
    original = pdk_fingerprint(tmp_path)
    write_view(tmp_path, "IP/STD_cell/SVT/lef/cells.lef", "new cell geometry")
    geometry = pdk_fingerprint(tmp_path)
    liberty = write_view(tmp_path, "IP/STD_cell/SVT/liberty/cells.lib", "timing v1")
    timing = pdk_fingerprint(tmp_path)
    liberty.write_text("timing v2", encoding="utf-8")
    assert len({original, geometry, timing, pdk_fingerprint(tmp_path)}) == 4


def test_missing_site_is_rejected(tmp_path):
    write_view(tmp_path, "prtech/techLEF/N551P6M_ecos.lef", "DATABASE MICRONS 2000 ;")
    with pytest.raises(ValueError, match="site width is unavailable"):
        site_width_dbu(tmp_path)
