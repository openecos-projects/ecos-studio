# ECOS Studio GUI

These instructions apply to `ecos/gui/` and supplement the parent instruction
files.

## Stack And Layout

- Electron 41 and electron-vite provide the desktop shell and packaging.
- Vue 3, Pinia, Vue Router, PrimeVue, Tailwind CSS, and Vite provide the renderer.
- pnpm manages the workspace and lockfile.
- `apps/desktop-electron/` contains Electron main, preload, services, and release
  configuration.
- `apps/renderer/` contains the Vue application, views, components, stores,
  composables, and desktop API wrappers.
- `packages/shared/` contains the desktop bridge, event, runtime, and Agent
  contracts shared across processes.

## Runtime Boundaries

- Renderer code is sandboxed with context isolation and no Node integration.
  Privileged operations cross the preload bridge into Electron main.
- Electron main validates IPC input and owns filesystem, subprocess, workspace,
  runtime, and native integration behavior.
- Shared contracts keep main, preload, and renderer on one typed boundary.
- ECC and ECC-FE run as sidecars so their Python runtimes remain replaceable and
  isolated from the UI process.

## Setup And Development

```bash
cd ecos/gui
pnpm install --frozen-lockfile
pnpm run dev
```

Use `pnpm run dev:vm` in sandboxed or VM-like Linux environments. To deliberately
use an ECC-FE source checkout, start with
`ECOS_FE_DEV_ROOT=/absolute/path/to/ecc-fe pnpm run dev`; nearby checkouts do not
override the installed runtime automatically.

## Validation

- Full GUI gate: `pnpm run check`
- Renderer only: `pnpm run renderer:typecheck && pnpm run renderer:test`
- Electron only: `pnpm run desktop:typecheck && pnpm run desktop:test`
- Build: `pnpm run build`
- Environment diagnostics: `pnpm run doctor`
- Electron smoke: `pnpm run desktop:build && pnpm run desktop:smoke`

Run targeted Vitest files while iterating, then the affected package's checks.
Run the full GUI gate when shared contracts or workspace-wide configuration
change.

## When Changing The Desktop Bridge

- Change the canonical channel or type in `packages/shared/` first.
- Update Electron main handlers, preload exposure, renderer callers, and their
  contract tests together.
- Validate untrusted values in Electron main; renderer validation is only
  defensive UX.

## When Changing Visible UI

- Follow existing Vue, PrimeVue, and application layout patterns.
- Add or update focused component tests.
- Verify the actual Electron view at relevant desktop sizes and include visual
  evidence when preparing a PR.

## Dependencies And Formatting

- Use pnpm and commit the corresponding `pnpm-lock.yaml` update.
- Use the repository's oxlint and oxfmt scripts; do not restate formatter rules
  in code comments or bypass checks with new exclusions.
