# ECOS Studio

ECOS Studio is a desktop environment for chip design. It combines project and
workspace management, an RTL-to-GDS flow dashboard, a native Chip Viewer, and a
built-in Agent. You can run backend flows from the GUI or the built-in terminal;
both use ECC and update the same workspace state. An experimental frontend
environment supports RTL review, elaboration, lint, and CPU verification.

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/asset/overview-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/asset/overview-light.png">
  <img alt="GCD workspace with the Flow diagram, signoff checklist, and chip metrics" src="docs/asset/overview-light.png" width="1200">
</picture>
</div>

The GCD workspace above shows completed implementation results and advisory
warnings. Execution status and signoff readiness are explained in the
[User Guide](docs/user-guide.md#monitoring-progress).

## Download

- [ECOS-Studio AppImage (amd64)](https://github.com/openecos-projects/ecos-studio/releases/latest/)

Download the AppImage from the release page, make it executable, and run it from
a Linux x86_64 desktop with X11 or Wayland and glibc 2.34 or newer. In the
directory containing the downloaded AppImage:

```bash
chmod +x ./ECOS-Studio*.AppImage
./ECOS-Studio*.AppImage
```

Use the exact filename if the directory contains more than one AppImage. See
the [FAQ](docs/FAQ.md) for FUSE and virtual-machine startup issues.

## Using ECOS Studio

1. Open **Resource Manager** to install or import the required tools and an
   eligible PDK. The **Command line tools** card shows ECC runtime readiness.
2. Open **Project Management** and create a backend project. Import RTL files
   or a filelist into the project's `rtl/` directory, or select a managed MPC
   template.
3. Create a workspace under that project. The wizard selects the flow range,
   design inputs, PDK, top module, clock, and implementation parameters.
4. Open the workspace dashboard and use the **Flow** diagram's Run button.
   Each step card shows execution status, runtime, peak memory, checklist
   results, reports, logs, and an available layout thumbnail.
5. Inspect the final checklist and use **Review & export** on the Signoff card
   to review delivery artifacts.

Execution status and signoff readiness are separate. Antenna Check and EMIR are
advisory checks: their warnings do not prevent Harden from completing. EMIR
requires a real process technology file; see
[Advisory checks](docs/user-guide.md#advisory-checks).

The top bar's **ECOS Agent** button shows or hides the Agent. It starts hidden
when you enter a workspace. The **User Guide** button opens the guide inside
the application.

### Running ECC from the terminal

Open **Terminal** from the status bar to use `ecc` with the application's tool
environment. For an existing project and workspace:

```bash
ecc status --project /path/to/project --workspace ws_0001
ecc run --project /path/to/project --workspace ws_0001
```

The workspace dashboard, Run button, and Project Management status follow CLI
execution. Separate workspaces can run concurrently; available CPU and memory
limit how many flows you should run at once. The host-shell command installed
by **Command line tools** is `ecos-ecc`.

See [Using ECC in the terminal](docs/user-guide.md#using-ecc-in-the-terminal)
for a complete project creation example and rerun commands.

## Quick Start (For Developers)

### Platform Support

Release builds currently require Linux x86_64 with glibc 2.34 or newer because
the packaged ECC CLI runtime includes native manylinux_2_34_x86_64 artifacts.
macOS, Windows, non-x86_64 Linux hosts, and Linux distributions with older glibc
are not supported by `make build` yet.

### Development

```bash
# From the repository root, initialize submodules and development tools.
make setup

# Prepare ECC. If Nix is available, enter the dev shell before syncing.
cd ecc
nix develop
uv sync --no-build-isolation-package ecc-dreamplace --no-build-isolation-package ecc-tools-bin --verbose

# Install GUI dependencies and run GUI in dev mode.
cd ../ecos/gui
pnpm install --frozen-lockfile
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

Backend project, workspace, parameter, and flow operations use the ECC CLI
through the Electron desktop bridge. Studio observes workspace files and
operation events to keep GUI and CLI runs synchronized. ECC-FE provides the
separate frontend runtime, installed through Resource Manager.

To use a separately installed ECC, set `ECOS_ECC_BIN_DIR` to the absolute
directory containing its `ecc` executable. For frontend source development,
set `ECOS_FE_DEV_ROOT` explicitly. See the [GUI development guide](gui/README.md)
for runtime overrides, checks, and E2E setup.

### Release Build

`make build` runs the full pipeline:

```
Native Chip Viewer and Agent build → Electron build → AppImage and deb packages
```

```bash
# Full release build (from repo root)
make build
```

The build output is available through the repository root `build/` link. By
default, the Linux release artifacts include an AppImage and deb package. The
application downloads its pinned ECC runtime on first use; the desktop package
does not embed that bundle. Install an eligible PDK and the tools required by your selected flow through
Resource Manager; the default full flow needs Yosys/OSS CAD Suite and its
configured LEC engine, normally Kepler Formal.

## Documentation

- [User Guide](docs/user-guide.md) - Complete guide to using ECOS Studio
- [FAQ](docs/FAQ.md) - Frequently asked questions and troubleshooting
- [ECC Documentation](https://github.com/openecos-projects/ecc/blob/main/README.md) - ECC toolchain documentation
