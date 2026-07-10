# Export Signoff Package Design

## Goal

Expose ECC's `EngineFlow.collect_signoff_package` operation from the open-workspace GUI. The File menu action is available only when the active workspace's final flow step is `harden` and that step has state `Success`. The user chooses the exact archive path and filename through the operating system's Save As dialog.

## Architecture

ECC adds a typed `workspace.export_signoff` JSON-RPC method that accepts an active workspace ID and output archive path. The runtime handler invokes `collect_signoff_package` in a temporary directory, copies the completed archive to the requested destination atomically, and removes the temporary package directory. This preserves the existing collector API and avoids leaving an unpacked package beside the exported archive.

The GUI adds `exportSignoff` to the shared ECC runtime contract and maps it through preload, IPC, and `EccRpcRuntimeService` to the new ECC method. This keeps operation serialization, logging, lifecycle events, workspace handles, and error propagation consistent with the current GUI-to-ECC RPC integration.

## Menu State

The native File menu adds `Export Signoff Package...` directly below `Reconfigure Workspace...`. It is disabled when the application starts.

The renderer computes eligibility from the active workspace's `home/flow.json`. The action is enabled only when:

- a workspace is open;
- the steps array is non-empty;
- the final step name, compared case-insensitively, is `harden`; and
- the final step state is exactly `Success`.

The renderer synchronizes eligibility to the Electron main process through a typed menu API. It updates the native menu after workspace open, close, or switch, when resource versions change, and whenever the active `home/flow.json` watcher fires. The click handler reads the flow again before exporting so a stale enabled menu cannot bypass the rule.

## Export Interaction

When an eligible user selects the action, the renderer reads workspace parameters to derive the design name and opens the operating system Save As dialog. The default filename is `<design>_signoff_package.tar.gz`, and the dialog filters for `.tar.gz` archives.

Cancelling the dialog has no side effects. Confirming it calls `ecc.workspace.exportSignoff` with the active workspace handle and exact selected output path. A successful export shows the saved path in the existing toast system.

The system Save As dialog owns overwrite confirmation. ECC writes the archive through a temporary file in the destination directory and replaces the selected target only after package collection succeeds, preventing a failed export from damaging an existing archive.

## Error Handling

ECC reports a command failure when the workspace cannot be loaded, the signoff package is incomplete, no archive is produced, or the destination cannot be written. The incomplete result includes the missing required resources in its error message.

The GUI keeps the menu disabled when flow data cannot be read or is malformed. Read, validation, dialog, and command failures use the existing error toast pattern. If eligibility changes between menu-state synchronization and the click-time validation, no Save As dialog opens and the user receives an explanatory message.

## Tests

ECC tests cover RPC registration and request parsing, successful export to an exact custom filename, incomplete package rejection, temporary-output cleanup, and preservation of an existing destination when collection fails.

GUI tests cover the shared event and command contracts, native menu placement and default disabled state, dynamic enabled-state updates, click event forwarding, Save As cancellation, click-time flow validation, adapter command arguments, success notification, and error notification.

## Scope

This change does not redesign the signoff package layout, expose debug or incomplete-package options, or migrate the GUI's other ECC commands to the JSON-RPC sidecar.
