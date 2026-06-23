# ECOS Studio: An RTL-to-Chip Silicon Design Solution

[![CI](https://github.com/openecos-projects/ecos-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/openecos-projects/ecos-studio/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/openecos-projects/ecos-studio)](https://github.com/openecos-projects/ecos-studio/releases/latest)

ECOS Studio is an integrated, one-stop silicon design solution that democratizes access to custom silicon. It vertically integrates open-source IP libraries, a robust EDA toolchain, and accessible PDKs into a unified framework, providing an "FPGA-like" experience for ASIC design.

![ECOS Studio Overview](ecos/docs/asset/ecos-studio-solution.png)

Our goal is to lower the barrier of chip design for researchers, engineers, and students, bridging the gap from RTL design to physical realization.

## Project Structure

This repository is organized into four main components:

### 1. GUI Application (`ecos/`)
Desktop application providing an integrated development environment for chip design.
- **Visual Workspace Management** - Create and manage chip design projects
- **Automated RTL-to-GDS Flow** - One-click execution from Verilog to layout
- **Integrated Tools** - Yosys (synthesis), ECC-Tools (placement & routing), KLayout (visualization)
- See [ecos/README.md](ecos/README.md) for usage guide
- See [ECOS Studio User Guide](ecos/docs/user-guide.md) for detailed documentation

### 2. Open Source IP (`ip/`)
Pre-verified infrastructure for composable design, including configurable SoC templates and common peripherals.
- [retroSoC](https://github.com/retroSoC)

### 3. Open Source EDA (`ecc/`)
**ECOS Chip Compiler (ECC)**: An open-source chip design automation solution that integrates EDA tools (Yosys, ECC-Tools, KLayout) to achieve complete RTL-to-GDS design flow.
- [ECC Documentation](https://github.com/openecos-projects/ecc)

### 4. Open Source PDK (`pdk/`)
Enabling mainstream manufacturing processes.
- [ICsprout 55nm Open PDK](https://github.com/openecos-projects/icsprout55-pdk)

---

**Note:** This is the initial release of ECOS Studio components. We are starting by providing these foundational open-source tools to the community. More subprojects and advanced features will be added in the future. Please stay tuned for updates!

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

```bash
# Initialize the repo and required resources first.
make setup

# Prepare ECC. If Nix is available, enter the dev shell before syncing.
cd ecc
nix develop
uv sync --no-build-isolation-package ecc-dreamplace --no-build-isolation-package ecc-tools-bin --verbose

# Install GUI dependencies and start the desktop app.
cd ../ecos/gui
pnpm install
pnpm run dev
```

`ecc` is installed in editable mode through the uv workspace. After changing ECC
Python code or the native workspace packages, importing the package again uses
the updated sources and rebuilds editable native extensions when needed.
If Nix is not available, skip `nix develop` and run the `uv sync` command in the
normal shell.

Release builds currently require Linux x86_64 with glibc 2.34 or newer:

```bash
make build
```

`make build` writes the release artifacts to the repository root `build/`
directory. By default this includes the Linux AppImage and deb package.

For development, validation, branch, and submodule guidelines, see
[CONTRIBUTING.md](CONTRIBUTING.md). For GUI and release build details, see
[ecos/README.md](ecos/README.md).

### CLI Demos

```bash
make demo-gcd           # GCD example
make demo-retrosoc      # retroSoC example
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Documentation

- [ECOS Studio User Guide](ecos/docs/user-guide.md)
- [FAQ](ecos/docs/FAQ.md)
- [ECOS GUI Development](ecos/README.md)
- [ECC CLI Flow Runner](https://github.com/openecos-projects/ecc/blob/main/README.md#cli-flow-runner)
- [ECC Documentation Index](https://github.com/openecos-projects/ecc/blob/main/docs/index.md)

## Community

For any issues you'd like to discuss, feel free to join our WeChat community.
<div align="center">
  <img src="https://github.com/next-zeta/image/blob/main/WeChat_community.png" alt="WeChat community">
</div>
