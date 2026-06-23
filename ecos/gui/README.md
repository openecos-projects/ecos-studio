# ECOS Studio (GUI)

Desktop chip-design frontend built with **Electron + Vue 3 + TypeScript**. The Electron host runs ECC through the local `ecc` CLI for normal workspace and flow actions.

## Prerequisites

- **Node.js** (LTS recommended)
- **pnpm** (this repo uses pnpm for dependencies)

For a fuller end-to-end setup, including ECC's Python environment and optional
Nix development shell, see the [ECOS package README](../README.md) and the
[repository root README](../../README.md).

## Quick start

### Install dependencies

Prepare ECC first from the repository root:

```bash
make setup
cd ecc
nix develop
uv sync --no-build-isolation-package ecc-dreamplace --no-build-isolation-package ecc-tools-bin --verbose
```

`make setup` initializes submodules and required resources. If Nix is not
available, skip `nix develop` and run the `uv sync` command in the normal shell.

Then install GUI dependencies:

```bash
cd ../ecos/gui
pnpm install
```

### Development

```bash
# Electron shell + renderer workspace
pnpm run dev
```

The renderer dev server prefers port `1420`. If another ECOS Studio dev
instance is already using it, Vite automatically picks the next free port and
electron-vite passes that URL to the Electron shell.

```bash
# Linux VM / sandbox-restricted environment
pnpm run dev:vm
```

### Build and preview

```bash
# Typecheck + production Electron/renderer build
pnpm run build
```

```bash
# Renderer-only smoke checks
pnpm run typecheck
pnpm --filter @ecos-studio/renderer exec vitest run src/utils/sanitizeHtml.test.ts
```

## Stack

- **Electron 41** — desktop shell and native integration
- **electron-vite 5** — Electron build and dev pipeline
- **Vue 3** — Composition API
- **PixiJS 8** — WebGL/WebGPU canvas and editor rendering
- **PrimeVue 4** — UI components (Aura theme)
- **Tailwind CSS v4** — styling
- **Vite 7** — dev and build

## Source layout (overview)

| Path | Description |
|------|-------------|
| `apps/desktop-electron/` | Electron main/preload process code, package config, and release metadata |
| `apps/renderer/src/applications/editor/` | Canvas editor core, layout rendering, plugins, tile logic |
| `apps/renderer/src/components/` | Reusable UI (toolbar, sidebars, panels, etc.) |
| `apps/renderer/src/views/` | Routed pages |
| `apps/renderer/src/composables/` | Composables (workspace state, menus, desktop integration wrappers, etc.) |
| `apps/renderer/src/stores/` | Pinia state |
| `apps/renderer/src/api/` | Desktop runtime bridge wrappers and event-stream helpers |
| `packages/` | Shared internal workspace packages (desktop bridge, tile helper, shared contracts) |

## Related docs

- [ECOS package README](../README.md) — overall quick start and release notes for ECOS Studio
- [ECOS Studio user guide](../docs/user-guide.md) — product usage  
- [Repository root README](../../README.md) — monorepo overview  
- [ECC development](../../ecc/docs/development.md), [ECC architecture](../../ecc/docs/architecture.md) — ECC toolchain docs  

---

Built by the ECOS Team
