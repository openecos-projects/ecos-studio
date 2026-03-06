# ECOS Studio: An RTL-to-Chip Silicon Design Solution

ECOS Studio is an integrated, one-stop silicon design solution that democratizes access to custom silicon. It vertically integrates open-source IP libraries, a robust EDA toolchain, and accessible PDKs into a unified framework, providing an "FPGA-like" experience for ASIC design.

![ECOS Studio Overview](ecos/docs/figs/ecos-studio-solution.png)

Our goal is to lower the barrier of chip design for researchers, engineers, and students, bridging the gap from RTL design to physical realization.

## Project Structure

This repository is organized into four main components:

### 1. GUI Application (`ecos/`)
Desktop application providing an integrated development environment for chip design.
- **Frontend**: Vue 3 + Tauri
- **Backend**: FastAPI server (`ecos_server` package)
- See [ecos/README.md](ecos/README.md) for development setup

### 2. Open Source IP (`ip/`)
Pre-verified infrastructure for composable design, including configurable SoC templates and common peripherals.
- [SoCExamples](ip/SoCExamples)
- [retroSoC](ip/retroSoC)

### 3. Open Source EDA (`ecc/`)
**ECOS Chip Compiler (ECC)**: An open-source chip design automation solution that integrates EDA tools (Yosys, ECC-Tools, KLayout) to achieve complete RTL-to-GDS design flow.
- [ECC Documentation](ecc/README.md)

### 4. Open Source PDK (`pdk/`)
Enabling mainstream manufacturing processes.
- [ICsprout 55nm Open PDK](pdk/icsprout55-pdk)

---

**Note:** This is the initial release of ECOS Studio components. We are starting by providing these foundational open-source tools to the community. More subprojects and advanced features will be added in the future. Please stay tuned for updates!

## Quick Start

### GUI Application

```bash
# Setup and launch GUI
make setup
make gui
```

### CLI Demos

Run ECC CLI flow for various examples:

```bash
# GCD demo
make demo-gcd

# SoC example (filelist mode)
make demo-soc

# retroSoC example
make demo-retrosoc
```

### Development

```bash
# Setup development environment
make dev

# Build release bundle
make build
```

### Docker Verification

Verify demos in a clean Docker environment:

```bash
# Build verification image
make docker-build

# Run all demos
make docker-verify-all
```

## Documentation

- [ECOS GUI Development](ecos/README.md)
- [ECC CLI Flow Runner](eda/ecc/README.md#cli-flow-runner)
- [ECC User Guide](eda/ecc/docs/user-guide.md)
- [ECC Documentation Index](eda/ecc/docs/index.md)


