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

Release builds currently require Linux x86_64 with glibc 2.34 or newer because
the packaged ECC CLI runtime includes native manylinux_2_34_x86_64 artifacts.
macOS, Windows, non-x86_64 Linux hosts, and Linux distributions with older glibc
are not supported by `make build` yet.

### Development

```bash
# From repo root — one-time setup (submodules, PDK, DreamPlace .so, ECC-Tools)
make setup

# Install dev dependencies and create symlinks
make dev

# Run GUI in dev mode
cd ecos/gui && pnpm dev
```

Electron host logs default to warnings and errors. Use `ECOS_ELECTRON_LOG_LEVEL`
when you need more detail while debugging the desktop shell:

```bash
# GUI lifecycle diagnostics
cd ecos/gui && ECOS_ELECTRON_LOG_LEVEL=info pnpm dev

# More detailed desktop runtime diagnostics
cd ecos/gui && ECOS_ELECTRON_LOG_LEVEL=debug pnpm dev
```

Available levels: `debug`, `info`, `warning` (default), `error`, `critical`.

Normal desktop workspace and flow actions run through the ECC CLI managed by the
Electron desktop bridge.

The renderer calls the Electron desktop bridge for workspace and flow commands.
Read-only commands such as `get_info` and `home_page` return their data through
the CLI command response. Runtime events are reserved for flow lifecycle changes
from `run_step` and `rtl2gds`; stdout and stderr log streams are shown as logs
and do not trigger workspace data reloads.

### DreamPlace Development

DreamPlace C++ operators are compiled by Bazel and installed as `.so` files into the source tree for venv-based development:

```bash
cd ecc
bazel run //bazel/scripts:install_dreamplace    # Build + install .so files
bazel run //bazel/scripts:clean_dreamplace      # Remove installed artifacts (manifest-based)
```

### Release Build

`make build` runs the full pipeline:

```
ECC CLI packaging environment → ECC CLI runtime resources → Electron build → AppImage
```

```bash
# Full release build (from repo root)
make build

# Launch the built AppImage
make gui
```

## Documentation

- [User Guide](docs/user-guide.md) - Complete guide to using ECOS Studio
- [FAQ](docs/FAQ.md) - Frequently asked questions and troubleshooting
- [ECC Documentation](https://github.com/openecos-projects/ecc/blob/main/README.md) - ECC toolchain documentation
