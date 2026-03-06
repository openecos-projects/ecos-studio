"""
PyInstaller hook for chipcompiler package.
Ensures ecc_py*.so extension module is included.
"""
from PyInstaller.utils.hooks import get_module_file_attribute
from pathlib import Path

# Get chipcompiler package location
chipcompiler_dir = Path(get_module_file_attribute("chipcompiler")).parent

# Collect ecc_py*.so files
ecc_bin_dir = chipcompiler_dir / "tools" / "ecc" / "bin"
binaries = []

if ecc_bin_dir.exists():
    for ecc_py_file in ecc_bin_dir.glob("ecc_py*.so"):
        binaries.append((str(ecc_py_file), "chipcompiler/tools/ecc/bin"))
