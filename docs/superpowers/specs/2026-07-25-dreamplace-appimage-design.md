# DreamPlace AppImage Runtime Design

## Problem

The packaged ECC executable discovered the editable DreamPlace source tree during
PyInstaller analysis. The source tree contains the Python modules but not the
compiled DreamPlace operators in `build/install/platlib`. Consequently, the
AppImage had no importable top-level `dreamplace` package or native extensions.
Workspace creation then rejected the required DreamPlace tool and silently omitted
the `place_dreamplace` and `legalization_dreamplace` step directories.

## Decision

DreamPlace remains a mandatory runtime dependency. The workflow must retain its
normal dependency check.

The ECC PyInstaller spec directly enumerates the installed DreamPlace package
from Python's platlib directory. This avoids the editable import hook entirely
and packages the installed Python package and compiled operators under the
top-level `dreamplace` runtime directory.

DreamPlace extensions are installed with an RPATH of
`$ORIGIN/../../../torch/lib`. This resolves to the sibling Torch library directory
both in a normal site-packages layout and in PyInstaller's `_internal` runtime.

## Verification

Regression tests assert the packaging contract and the relative RPATH setting.
The AppImage payload smoke test requires the DreamPlace entry modules, a native
operator, and `libtorch.so`. A rebuilt AppImage is then verified via the ECC RPC
workspace creation path using a flow containing `place` and `legalization`.
