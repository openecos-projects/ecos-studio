# ECOS Studio

ECOS Studio is a desktop application that provides an integrated development environment for chip design, guiding you through the complete RTL-to-GDS flow.

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/asset/overview-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/asset/overview-light.png">
  <img alt="ECOS Studio Overview" src="docs/asset/overview-light.png" width="800">
</picture>
</div>

## Download

- [ECOS-Studio AppImage (amd64)](https://github.com/openecos-projects/ecos-studio/releases/latest/)

[AppImage](https://en.wikipedia.org/wiki/AppImage) is a portable Linux application format — download a single file, make it executable, and run it without installation. ECOS Studio is a GUI application and requires a desktop environment (X11 or Wayland) to run — it cannot be launched from a headless environment. For Linux Desktop x86_64 users, you can download the latest ECOS Studio AppImage from the releases page.
```shell
# Download and run ECOS Studio on Linux x86_64
wget https://github.com/openecos-projects/ecos-studio/releases/latest/download/<latest-release-file>.AppImage
chmod +x <latest-release-file>.AppImage
./<latest-release-file>.AppImage
```

## Quick Start (For Developers)

### Platform Support

Server development and release builds currently require Linux x86_64 with glibc
2.34 or newer. The server uv environment is locked to pinned GitHub Release
wheels for `ecc-dreamplace` and `ecc-tools`, and those native wheels are
published as manylinux_2_34_x86_64 artifacts. macOS, Windows, non-x86_64 Linux
hosts, and Linux distributions with older glibc are not supported by `make dev`,
`make use-local-ecc`, or `make build` yet.

### Development

```bash
# From repo root — one-time setup (submodules, PDK, DreamPlace .so, ECC-Tools)
make setup

# Install dev dependencies and create symlinks
make dev

# Run GUI in dev mode
cd ecos/gui && pnpm tauri dev
```

Rust-side GUI logs default to warnings and errors. Use `RUST_LOG` when you need
more detail while debugging the Tauri shell:

```bash
# GUI lifecycle diagnostics
cd ecos/gui && RUST_LOG=ecos_studio=info pnpm tauri dev

# More detailed API server startup diagnostics
cd ecos/gui && RUST_LOG=ecos_studio::api_server=debug pnpm tauri dev
```

Python API server startup markers (`[API_PHASE]`, `[API_START]`, `[API_READY]`,
`[API_LOG]`) are suppressed by default. Set `ECOS_API_LOG_LEVEL=info` to show
them, or pass `--log-level info` to `run_server.py`:

```bash
# Show API server startup phases
ECOS_API_LOG_LEVEL=info cd ecos/server && python run_server.py

# Equivalent via CLI flag
cd ecos/server && python run_server.py --log-level info
```

### DreamPlace Development

DreamPlace C++ operators are compiled by Bazel and installed as `.so` files into the source tree for venv-based development:

```bash
cd ecc
bazel run //bazel/scripts:install_dreamplace    # Build + install .so files
bazel run //bazel/scripts:clean_dreamplace      # Remove installed artifacts (manifest-based)
```

### Release Wheels

Release builds use pinned GitHub Release wheels through `ecos/server/pyproject.toml` and `ecos/server/uv.lock`.

```bash
# Re-sync the server environment from the locked release wheels
cd ecos/server && uv sync --frozen --all-groups --python 3.11

# Optional: switch the server venv to the local ECC checkout for development
make use-local-ecc
```

### Release Build

`make build` runs the full pipeline:

```
uv sync locked release wheels → PyInstaller bundle → AppImage
```

```bash
# Full release build (from repo root)
make build

# Launch the built AppImage
make gui
```

The release wheels are installed as **non-editable** packages so that PyInstaller's `collect_all("dreamplace")` and `collect_all("chipcompiler")` can discover all package files during bundling.

## Documentation

- [User Guide](docs/user-guide.md) - Complete guide to using ECOS Studio
- [FAQ](docs/FAQ.md) - Frequently asked questions and troubleshooting
- [ECC Documentation](https://github.com/openecos-projects/ecc/blob/main/README.md) - ECC toolchain documentation
