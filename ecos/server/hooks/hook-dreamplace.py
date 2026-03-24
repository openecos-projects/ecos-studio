"""PyInstaller hook for dreamplace — collects submodules, .so extensions, and data files."""

import re
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
    get_module_file_attribute,
    logger,
)

hiddenimports = collect_submodules("dreamplace")
binaries = collect_dynamic_libs("dreamplace")
datas = collect_data_files("dreamplace")

# Fallback: collect_submodules can miss .so files in non-standard layouts.
_ABI_TAG_RE = re.compile(r"\.cpython-\d+-.*$")

try:
    dreamplace_dir = Path(get_module_file_attribute("dreamplace")).parent
    ops_dir = dreamplace_dir / "ops"

    if ops_dir.is_dir():
        for so_file in ops_dir.rglob("*.so"):
            rel = so_file.relative_to(dreamplace_dir.parent)

            entry = (str(so_file), str(rel.parent))
            if entry not in binaries:
                binaries.append(entry)

            stem = _ABI_TAG_RE.sub("", rel.stem)
            module_name = ".".join((*rel.parent.parts, stem))

            if module_name not in hiddenimports:
                hiddenimports.append(module_name)
except Exception as exc:
    logger.warning("hook-dreamplace: failed to enumerate .so files: %s", exc)
