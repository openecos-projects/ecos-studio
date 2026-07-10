# Export Signoff Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native File menu action that exports a completed harden workspace's ECC signoff archive to an exact user-selected filename.

**Architecture:** A new `ecc signoff export` command wraps `EngineFlow.collect_signoff_package` with temporary collection and atomic destination replacement. Electron exposes typed Save As and native-menu enabled-state APIs, while a focused renderer composable validates the final flow step, synchronizes menu state, and executes the existing desktop CLI bridge.

**Tech Stack:** Python 3, Typer, pytest, Electron 41, TypeScript, Vue 3 Composition API, Vitest.

---

### Task 1: ECC Exact-Path Signoff Export

**Files:**
- Create: `ecc/chipcompiler/cli/signoff_export.py`
- Create: `ecc/chipcompiler/cli/commands/signoff.py`
- Modify: `ecc/chipcompiler/cli/app.py`
- Test: `ecc/test/cli/test_signoff_export.py`

- [ ] **Step 1: Write failing service tests**

Test a fake `EngineFlow.collect_signoff_package` result with an archive in its supplied temporary `output_dir`. Assert that `export_signoff_package(workspace_dir, custom_output)` writes the archive bytes to the exact custom name, removes the collection directory, and returns the resolved output path. Add a failure case where `ok=False` and assert an existing destination remains unchanged.

- [ ] **Step 2: Run the service tests and verify RED**

Run: `cd ecc && uv run pytest test/cli/test_signoff_export.py -v`

Expected: import failure because `chipcompiler.cli.signoff_export` does not exist.

- [ ] **Step 3: Implement the export service**

Implement:

```python
class SignoffExportError(RuntimeError):
    pass


def export_signoff_package(directory: str, output_path: str) -> str:
    workspace = load_workspace(directory=directory)
    destination = Path(output_path).expanduser().resolve()
    with tempfile.TemporaryDirectory(prefix="ecc-signoff-") as temporary_root:
        result = EngineFlow(workspace).collect_signoff_package(
            SignoffPackageOptions(output_dir=temporary_root, archive=True)
        )
        if not result.ok or not result.archive_path:
            missing = ", ".join(result.missing_required) or "unknown required resources"
            raise SignoffExportError(f"signoff package is incomplete: {missing}")
        archive = Path(result.archive_path)
        if not archive.is_file():
            raise SignoffExportError("signoff package archive was not created")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_destination = _copy_to_temporary_destination(archive, destination)
        try:
            os.replace(temporary_destination, destination)
        finally:
            temporary_destination.unlink(missing_ok=True)
    return str(destination)
```

Use `NamedTemporaryFile(delete=False, dir=destination.parent, prefix=f".{destination.name}.")` plus `shutil.copyfileobj` for `_copy_to_temporary_destination`, so collection failure cannot alter an existing target and successful replacement is atomic on the target filesystem.

- [ ] **Step 4: Run service tests and verify GREEN**

Run: `cd ecc && uv run pytest test/cli/test_signoff_export.py -v`

Expected: service tests pass.

- [ ] **Step 5: Write failing CLI tests**

Add tests that `ecc --help` lists `signoff`; `ecc signoff export --directory /ws --output /tmp/custom.tar.gz --json` calls the service and prints a desktop-compatible result envelope:

```json
{"type":"result","cmd":"export_signoff_package","response":"success","message":[],"data":{"output_path":"/tmp/custom.tar.gz"}}
```

Test the failure envelope and nonzero return code for `SignoffExportError`.

- [ ] **Step 6: Run CLI tests and verify RED**

Run: `cd ecc && uv run pytest test/cli/test_signoff_export.py test/cli/test_typer_cli.py::test_root_help_returns_zero_and_lists_commands -v`

Expected: `signoff` command is missing.

- [ ] **Step 7: Implement and register the Typer command**

Create `signoff_app`, add the `export` subcommand, accept required `--directory` and `--output`, and support `--json`. JSON success and failure use the exact desktop result envelope from Step 5; text success prints the output path. Register with `app.add_typer(signoff_app, name="signoff")`.

- [ ] **Step 8: Run ECC tests and commit**

Run: `cd ecc && uv run pytest test/cli/test_signoff_export.py test/cli/test_typer_cli.py test/test_signoff_package.py -v`

Expected: all selected tests pass.

Commit in the ECC submodule:

```bash
git -C ecc add chipcompiler/cli/signoff_export.py chipcompiler/cli/commands/signoff.py chipcompiler/cli/app.py test/cli/test_signoff_export.py test/cli/test_typer_cli.py
git -C ecc commit -m "feat(cli): export signoff package"
```

### Task 2: Desktop Save Dialog and Native Menu State

**Files:**
- Modify: `ecos/gui/packages/shared/src/contracts/desktopApi.ts`
- Modify: `ecos/gui/packages/shared/src/contracts/desktopEvents.ts`
- Modify: `ecos/gui/packages/shared/src/constants/ipcChannels.ts`
- Modify: `ecos/gui/packages/shared/src/contracts/desktopCli.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/services/menuService.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/services/menuService.test.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/main/registerIpc.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/main/registerIpc.test.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/preload/index.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/preload/index.test.ts`

- [ ] **Step 1: Write failing desktop contract/menu tests**

Assert the File submenu order contains `Reconfigure Workspace...` followed by disabled `Export Signoff Package...`, clicking export emits `export_signoff_package`, and `setMenuActionEnabled(export_signoff_package, true)` enables that menu item. Add IPC/preload tests for `dialog.saveFile(options)` and `menu.setActionEnabled(action, enabled)`.

- [ ] **Step 2: Run desktop tests and verify RED**

Run: `cd ecos/gui && pnpm vitest run apps/desktop-electron/electron/services/menuService.test.ts apps/desktop-electron/electron/main/registerIpc.test.ts apps/desktop-electron/electron/preload/index.test.ts`

Expected: missing event IDs and APIs.

- [ ] **Step 3: Implement shared contracts and Electron bridge**

Add `exportSignoffPackage: 'export_signoff_package'` to menu/app action IDs and CLI command names. Add:

```ts
export interface DesktopSaveFileDialogOptions {
  title?: string
  defaultPath?: string
  filters?: DesktopFileDialogFilter[]
}
```

Expose `dialog.saveFile(...)` and `menu.setActionEnabled(...)` in `DesktopApi`, preload, and IPC channels. Implement Save As with Electron `dialog.showSaveDialog`; return `null` when cancelled. Give menu actions stable IDs, export `setMenuActionEnabled`, and update `Menu.getApplicationMenu()?.getMenuItemById(actionId).enabled`.

- [ ] **Step 4: Run desktop tests and verify GREEN**

Run the Step 2 command again.

Expected: all selected desktop tests pass.

### Task 3: Existing GUI-to-ECC Command Mapping

**Files:**
- Modify: `ecos/gui/apps/desktop-electron/electron/services/eccCliAdapter.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/services/eccCliAdapter.test.ts`
- Modify: `ecos/gui/apps/desktop-electron/electron/services/desktopRuntimeManager.ts`

- [ ] **Step 1: Write a failing adapter test**

Execute `{ cmd: 'export_signoff_package', data: { directory: '/ws', output_path: '/exports/custom.tar.gz' } }` and assert the child process receives:

```text
signoff export --directory /ws --output /exports/custom.tar.gz --json
```

- [ ] **Step 2: Run adapter test and verify RED**

Run: `cd ecos/gui && pnpm vitest run apps/desktop-electron/electron/services/eccCliAdapter.test.ts`

Expected: unsupported command result.

- [ ] **Step 3: Implement mapping and runtime registration**

Add the command to `supportedCommands` and `longRunningCommands`. In `prepareCommand`, require `directory` and `output_path`, then return the exact arguments from Step 1.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run the Step 2 command again.

Expected: adapter tests pass.

### Task 4: Renderer Eligibility and Export Workflow

**Files:**
- Create: `ecos/gui/apps/renderer/src/composables/useSignoffPackageExport.ts`
- Create: `ecos/gui/apps/renderer/src/composables/useSignoffPackageExport.test.ts`
- Modify: `ecos/gui/apps/renderer/src/composables/useAppMenuActions.ts`
- Modify: `ecos/gui/apps/renderer/src/composables/useAppMenuActions.test.ts`
- Modify: `ecos/gui/apps/renderer/src/App.vue`

- [ ] **Step 1: Write failing eligibility tests**

Export a pure `canExportSignoffPackage(flow)` helper. Assert false for no steps, final non-harden, harden not `Success`, malformed data, and true only for final `{ name: 'harden', state: 'Success' }`, with case-insensitive harden name.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `cd ecos/gui && pnpm vitest run apps/renderer/src/composables/useSignoffPackageExport.test.ts`

Expected: module is missing.

- [ ] **Step 3: Implement eligibility and menu synchronization**

Create a composable receiving `currentProject`, `resourceVersions`, and `showToast`. Watch active project path and the `flow`/`all` resource versions. Read `workspaceResources.readFlow()`, call `menu.setActionEnabled(exportSignoffPackage, eligible)`, and force disabled on missing workspace, malformed data, read errors, and unmount.

- [ ] **Step 4: Add failing workflow tests**

Test click-time revalidation, Save As cancellation, default `<Design>_signoff_package.tar.gz`, CLI request payload, success toast, failure toast, and no dialog when eligibility has gone stale.

- [ ] **Step 5: Run workflow tests and verify RED**

Run the Step 2 command again.

Expected: export workflow assertions fail.

- [ ] **Step 6: Implement export workflow**

On export, re-read flow and reject stale eligibility. Read parameters for `Design`, fall back to the workspace directory leaf, then call:

```ts
const outputPath = await api.dialog.saveFile({
  title: 'Export Signoff Package',
  defaultPath: `${designName}_signoff_package.tar.gz`,
  filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
})
```

If selected, execute `export_signoff_package` with `directory` and `output_path`. Show existing-style success/error toasts. Add the dependency and event branch to `useAppMenuActions`, then wire the composable from `App.vue`.

- [ ] **Step 7: Run renderer tests and verify GREEN**

Run: `cd ecos/gui && pnpm vitest run apps/renderer/src/composables/useSignoffPackageExport.test.ts apps/renderer/src/composables/useAppMenuActions.test.ts apps/renderer/src/App.reconfigure-workspace.test.ts`

Expected: all selected renderer tests pass.

### Task 5: Integrated Verification

**Files:**
- Verify all files from Tasks 1-4.

- [ ] **Step 1: Run ECC verification**

Run: `cd ecc && uv run pytest test/cli/test_signoff_export.py test/cli/test_typer_cli.py test/test_signoff_package.py -v`

Expected: all selected ECC tests pass.

- [ ] **Step 2: Run GUI type checks and focused tests**

Run: `cd ecos/gui && pnpm run typecheck`

Run: `cd ecos/gui && pnpm vitest run apps/desktop-electron/electron/services/menuService.test.ts apps/desktop-electron/electron/services/eccCliAdapter.test.ts apps/desktop-electron/electron/main/registerIpc.test.ts apps/desktop-electron/electron/preload/index.test.ts apps/renderer/src/composables/useSignoffPackageExport.test.ts apps/renderer/src/composables/useAppMenuActions.test.ts apps/renderer/src/App.reconfigure-workspace.test.ts`

Expected: type checks and all selected tests pass.

- [ ] **Step 3: Inspect final diff**

Run: `git diff --check` and `git status --short`; run `git -C ecc diff --check` and `git -C ecc status --short`.

Expected: no whitespace errors; only planned files and the ECC submodule pointer are changed.
