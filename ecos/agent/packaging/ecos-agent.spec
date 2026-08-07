# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


ROOT = Path(SPECPATH).parent.parent
KNOWLEDGE_ROOT = ROOT / "src" / "ecos_agent"


a = Analysis(
    [str(ROOT / "packaging" / "run_ecos_agent.py")],
    pathex=[str(ROOT / "src")],
    binaries=[],
    datas=[
        (str(path), path.stem.replace("_", "-"))
        for path in sorted(KNOWLEDGE_ROOT.glob("*_knowledge"))
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ecos-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
)
