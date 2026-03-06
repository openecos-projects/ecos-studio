# ECOS Studio

ECOS Studio is a desktop application that provides an integrated development environment for chip design, guiding you through the complete RTL-to-GDS flow.

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/asset/overview-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/asset/overview-light.png">
  <img alt="ECOS Studio Overview" src="docs/asset/overview-light.png" width="800">
</picture>
</div>

## Quick Start

### Development

```bash
cd ecos/server && uv sync
cd ecos/gui && pnpm install && pnpm tauri dev
```

### Release Build

```bash
bazel build //:ecos_studio_bundle
```

## Documentation

- [User Guide](docs/user-guide.md) - Complete guide to using ECOS Studio
- [ECC Documentation](../ecc/README.md) - ECC toolchain documentation


