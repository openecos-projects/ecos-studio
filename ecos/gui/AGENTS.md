# ECOS Studio GUI

These instructions apply to `ecos/gui/` and supplement the parent instruction
files.

## Architecture Map

- `apps/desktop-electron/electron/` owns Electron main, preload, IPC handlers,
  filesystem access, subprocesses, and native integrations.
- `apps/renderer/src/` owns the Vue UI, Pinia state, and desktop API consumers.
- `packages/shared/src/` is the canonical source for IPC channels, desktop API
  contracts, events, and serialized cross-process types.

## Runtime Boundaries

- Renderer code is sandboxed with context isolation and no Node integration.
  Privileged operations cross the preload bridge into Electron main.
- Electron main validates IPC input and owns filesystem, subprocess, workspace,
  runtime, and native integration behavior.
- Shared contracts keep main, preload, and renderer on one typed boundary.
- ECC and ECC-FE run as sidecars so their Python runtimes remain replaceable and
  isolated from the UI process.

## Development

```bash
cd ecos/gui
pnpm install --frozen-lockfile
pnpm run dev
```

Use `pnpm run dev:vm` in sandboxed or VM-like Linux environments. To deliberately
use an ECC-FE source checkout, start with
`ECOS_FE_DEV_ROOT=/absolute/path/to/ecc-fe pnpm run dev`; nearby checkouts do not
override the installed runtime automatically.

Use pnpm workspace scripts instead of invoking local binaries directly. Run a
focused Vitest file while iterating, for example:

```bash
pnpm --filter @ecos-studio/renderer exec vitest run src/path/to/file.test.ts
pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/path/to/file.test.ts
```

## Development Tips

- After switching branches or pulling changes to `package.json` or
  `pnpm-lock.yaml`, run `pnpm install --frozen-lockfile`.
- Use the repository package scripts for type checking, linting, formatting, and
  tests. Do not create ad hoc TypeScript or Vitest configurations that bypass
  workspace settings.
- Use typecheck and focused tests while iterating; do not run a production build
  only to discover TypeScript errors.

## Validation By Scope

- Full GUI gate: `pnpm run check`
- Renderer only: `pnpm run renderer:typecheck && pnpm run renderer:test`
- Electron only: `pnpm run desktop:typecheck && pnpm run desktop:test`
- Shared contracts only: `pnpm --filter @ecos-studio/shared run typecheck &&`
  `pnpm --filter @ecos-studio/shared run test`
- Build: `pnpm run build`
- Environment diagnostics: `pnpm run doctor`
- Electron smoke: `pnpm run desktop:build && pnpm run desktop:smoke`

Before publishing GUI source or configuration changes, run `pnpm run check`.
Also run the production build when changing build configuration, preload/main
bundling, package resources, or shared workspace resolution. Run the Electron
smoke test after changing startup, preload exposure, or a critical IPC path.

## Writing Tests

- Place focused `*.test.ts` files beside the implementation and follow existing
  Vitest and Vue Test Utils patterns.
- For asynchronous UI or state changes, use `vi.waitFor()`, `flushPromises()`,
  or `nextTick()` instead of fixed-delay `setTimeout()` waits.
- Use fake timers when timer, retry, debounce, or timeout behavior is itself
  under test.
- Prefer real temporary directories or fixture files for filesystem, workspace,
  packaging, and process-integration tests. Keep small self-contained payloads
  inline when that is clearer.
- Test observable behavior and contracts. When changing IPC, cover the shared
  contract, preload exposure, Electron handler, and renderer consumer together.

## When Changing The Desktop Bridge

- Change the canonical channel or type in `packages/shared/` first.
- Update Electron main handlers, preload exposure, renderer callers, and their
  contract tests together.
- Validate untrusted values in Electron main; renderer validation is only
  defensive UX.
- Keep the exposed preload API minimal; do not expose raw `ipcRenderer`, Node
  APIs, filesystem handles, or subprocess access to the renderer.

## When Changing Workspace Data

- Treat `project.json`, workspace manifests, flow state, and shared serialized
  contracts as compatibility surfaces.
- Preserve unknown extension fields when normalizing persisted documents unless
  an explicit migration removes them.
- Update parsing, migration, recovery, and producer/consumer tests together when
  a persisted shape changes.
- Canonicalize and authorize user-controlled paths in Electron main before
  filesystem access; renderer-side path checks are not authoritative.

## When Changing Sidecars Or Native Tools

- Keep shared contracts, Electron lifecycle and error handling, renderer state,
  and the affected Agent, ECC, ECC-FE, or Chip Viewer integration aligned.
- Test cancellation, process failure, malformed output, and unavailable runtime
  behavior when those paths are affected.
- Run the repository packaging build or report why it was not run when changing
  staged binaries, wrappers, manifests, or packaged resource paths.

## When Changing Visible UI

- Follow existing Vue, PrimeVue, and application layout patterns.
- Add or update focused component tests.
- Verify the actual Electron view at relevant desktop sizes and include visual
  evidence when preparing a PR.

## Review Guidelines

- Treat new IPC channels, filesystem writes, subprocess arguments, downloads,
  archive extraction, and external URLs as security-sensitive.
- Search every producer and consumer before changing a shared contract or event.
- Keep shared package exports minimal and avoid renderer dependencies in Electron
  main or preload code.
- Prefer adding substantial behavior to a focused module over growing central
  views, stores, preload entry points, or service orchestrators.
- Check failure, cancellation, empty, stale, and partial-data states where the
  workflow can encounter them.

## Dependencies And Formatting

- Use pnpm and commit the corresponding `pnpm-lock.yaml` update.
- Use the repository's oxlint and oxfmt scripts; do not restate formatter rules
  in code comments or bypass checks with new exclusions.
- Do not hand-edit `node_modules/`, `dist/`, `release/`, coverage, or generated
  package resources.
