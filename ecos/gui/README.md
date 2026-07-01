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

## Quality checks

Most GUI checks are available from the GUI workspace root:

```bash
pnpm run check
```

`check` runs typecheck, lint, format check, and the unit test suites. The unit
tests include the shared package tests, IPC contract tests, preload bridge
tests, and GUI infrastructure tests such as the doctor script tests.

For targeted local checks:

```bash
pnpm run lint
pnpm run fmt:check
pnpm run test
pnpm run doctor
```

`fmt` and `fmt:check` run across the full GUI workspace while respecting the GUI
`.gitignore`.

`doctor` is a local environment diagnostic. It checks Node.js, pnpm, installed
GUI dependencies, optional ECC/Nix availability, and the native resources used
by the desktop app. It does not start Electron.

The Electron smoke test is manual and should be run after a desktop build:

```bash
pnpm run desktop:build
pnpm run desktop:smoke
```

The smoke test starts Electron and verifies that the preload bridge is exposed
and a key IPC call can reach the main process. It is not part of `check`,
`test`, `make build`, or CI.

Git hooks are managed with Lefthook from the repository root. The pre-commit
hook runs lightweight GUI lint checks and staged-file format checks for
supported `ecos/gui` source, config, style, and docs changes. The
commit-message hook runs commitlint against every commit message, regardless of
which files changed.

## Stack

- **Electron 41** — desktop shell and native integration
- **electron-vite 5** — Electron build and dev pipeline
- **Vue 3** — Composition API
- **Canvas 2D** — step layout preview and tech-library geometry rendering (no WebGL)
- **PrimeVue 4** — UI components (Aura theme)
- **Tailwind CSS v4** — styling
- **Vite 7** — dev and build

## Source layout (overview)

| Path                                     | Description                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/desktop-electron/`                 | Electron main/preload process code, package config, and release metadata           |
| `apps/renderer/src/applications/editor/` | Canvas editor core, layout rendering, plugins, tile logic                          |
| `apps/renderer/src/components/`          | Reusable UI (toolbar, sidebars, panels, etc.)                                      |
| `apps/renderer/src/views/`               | Routed pages                                                                       |
| `apps/renderer/src/composables/`         | Composables (workspace state, menus, desktop integration wrappers, etc.)           |
| `apps/renderer/src/stores/`              | Pinia state                                                                        |
| `apps/renderer/src/api/`                 | Desktop runtime bridge wrappers and event-stream helpers                           |
| `packages/`                              | Shared internal workspace packages (desktop bridge, tile helper, shared contracts) |

## Related docs

- [ECOS package README](../README.md) — overall quick start and release notes for ECOS Studio
- [ECOS Studio user guide](../docs/user-guide.md) — product usage
- [Repository root README](../../README.md) — monorepo overview
- [ECC development](../../ecc/docs/development.md), [ECC architecture](../../ecc/docs/architecture.md) — ECC toolchain docs

---

Built by the ECOS Team
