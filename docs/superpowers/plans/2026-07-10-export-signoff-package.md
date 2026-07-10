# Export Signoff Package Implementation Plan

**Goal:** Export a completed harden workspace's signoff archive to an exact filename from the native ECOS Studio File menu.

**Architecture:** ECC exposes `workspace.export_signoff` through its JSON-RPC runtime. Electron maps the shared ECC contract through `EccRpcRuntimeService`, IPC, and preload. The renderer owns eligibility, the native Save As interaction, and workspace-switch race protection.

## Task 1: ECC Runtime Export

**Files:**

- `ecc/chipcompiler/runtime/methods.py`
- `ecc/chipcompiler/runtime/requests.py`
- `ecc/chipcompiler/runtime/signoff_export.py`
- `ecc/chipcompiler/runtime/workspace_api.py`
- `ecc/test/runtime/test_*.py`

Steps:

1. Add a typed request with `workspaceId` and exact `outputPath`.
2. Register `workspace.export_signoff` as a runtime capability.
3. Collect through `EngineFlow.collect_signoff_package` in a temporary directory.
4. Reject incomplete or missing archives with actionable RPC errors.
5. Stage the archive beside the destination and commit it with `os.replace`.
6. Preserve the selected filename, including symlink-entry and whitespace semantics.
7. Test request parsing, server dispatch, temporary cleanup, exact output, failure preservation, and runtime locking.

## Task 2: Native Menu and Save As Bridge

**Files:**

- `ecos/gui/packages/shared/src/contracts/desktopApi.ts`
- `ecos/gui/packages/shared/src/contracts/desktopEvents.ts`
- `ecos/gui/packages/shared/src/constants/ipcChannels.ts`
- `ecos/gui/apps/desktop-electron/electron/services/menuService.ts`
- `ecos/gui/apps/desktop-electron/electron/main/registerIpc.ts`
- `ecos/gui/apps/desktop-electron/electron/preload/index.ts`

Steps:

1. Add disabled `Export Signoff Package...` below `Reconfigure Workspace...`.
2. Give native actions stable IDs and expose a typed enabled-state operation.
3. Add a typed Save As API with default path and extension filters.
4. Preserve Electron parent-window ownership and cancellation behavior.
5. Test menu order, default state, state updates, event emission, IPC, and preload.

## Task 3: ECC RPC Bridge

**Files:**

- `ecos/gui/packages/shared/src/contracts/eccRuntime.ts`
- `ecos/gui/apps/desktop-electron/electron/services/eccRpc/runtimeService.ts`
- `ecos/gui/apps/desktop-electron/electron/main/registerIpc.ts`
- `ecos/gui/apps/desktop-electron/electron/preload/index.ts`

Steps:

1. Add `EccWorkspaceExportSignoffRequest/Result` and `exportSignoff`.
2. Resolve the active GUI workspace handle to the ECC workspace ID.
3. Call `workspace.export_signoff` with an unlimited operation timeout.
4. Reuse runtime queuing, active-workspace locking, lifecycle events, and normalized errors.
5. Test exact request mapping through runtime service, IPC, and preload.

## Task 4: Renderer Workflow

**Files:**

- `ecos/gui/apps/renderer/src/composables/useSignoffPackageExport.ts`
- `ecos/gui/apps/renderer/src/composables/useSignoffPackageExport.test.ts`
- `ecos/gui/apps/renderer/src/composables/useAppMenuActions.ts`
- `ecos/gui/apps/renderer/src/App.vue`

Steps:

1. Enable export only when the final flow step is `harden` with exact state `Success`.
2. Synchronize on workspace handle, resource versions, and actual `home/flow.json` changes.
3. Clean stale and delayed watchers on switch or unmount.
4. Revalidate eligibility when clicked.
5. Derive the default archive name from `Design`, then open Save As.
6. Call `ecc.workspace.exportSignoff` with the active workspace handle.
7. Suppress stale-workspace results and show actionable success/error toasts.

## Verification

Run:

```bash
cd ecc
uv run pytest -q

cd ../ecos/gui
pnpm run typecheck
pnpm run lint
pnpm run fmt:check

cd ../../
make setup
make build
```

Acceptance:

- ECC and GUI tests pass.
- The native menu tracks live flow eligibility.
- Save As preserves the exact selected path.
- The AppImage build succeeds and produces a non-empty artifact.
