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
# From repo root, initialize the repo and required resources first.
make setup

# Prepare ECC. If Nix is available, enter the dev shell before syncing.
cd ecc
nix develop
uv sync --no-build-isolation-package ecc-dreamplace --no-build-isolation-package ecc-tools-bin --verbose

# Install GUI dependencies and run GUI in dev mode.
cd ../ecos/gui
pnpm install
pnpm run dev
```

`ecc` is installed in editable mode. Source edits are picked up on the next
import, and editable native extensions rebuild automatically when needed.
If Nix is not available, skip `nix develop` and run the `uv sync` command in the
normal shell.

Electron host logs default to warnings and errors. Use `ECOS_ELECTRON_LOG_LEVEL`
when you need more detail while debugging the desktop shell:

```bash
# GUI lifecycle diagnostics
cd ecos/gui && ECOS_ELECTRON_LOG_LEVEL=info pnpm run dev

# More detailed desktop runtime diagnostics
cd ecos/gui && ECOS_ELECTRON_LOG_LEVEL=debug pnpm run dev
```

Available levels: `debug`, `info`, `warning` (default), `error`, `critical`.

Normal desktop workspace and flow actions run through the ECC CLI managed by the
Electron desktop bridge.

The renderer calls the Electron desktop bridge for workspace and flow commands.
Read-only commands such as `get_info` and `home_page` return their data through
the CLI command response. Runtime events are reserved for flow lifecycle changes
from `run_step` and `rtl2gds`; stdout and stderr log streams are shown as logs
and do not trigger workspace data reloads.

### Release Build

`make build` runs the full pipeline:

```
ECC CLI packaging environment → ECC CLI runtime resources → Electron build → AppImage
```

```bash
# Full release build (from repo root)
make build
```

The build output is copied to the repository root `build/` directory. By
default, the Linux release artifacts include an AppImage and deb package.

## Documentation

- [User Guide](docs/user-guide.md) - Complete guide to using ECOS Studio
- [FAQ](docs/FAQ.md) - Frequently asked questions and troubleshooting
- [ECC Documentation](https://github.com/openecos-projects/ecc/blob/main/README.md) - ECC toolchain documentation
