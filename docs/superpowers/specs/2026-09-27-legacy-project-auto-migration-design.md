# Legacy Project Automatic Migration

## Goal

When ECOS Studio opens a legacy ECC project, the application should migrate it
to the manifest layout in the background so Project Management and Workspace
use the current CLI contract without requiring users to understand the old
`runs/` layout. No GUI-owned persistence file is added.

## Scope

- Trigger migration when a user opens or activates a project, not during an
  unbounded project-directory scan.
- Run migration through the ECC CLI with `--yes --plain`.
- Support projects without `project.json` and legacy manifests whose workspace
  entries still point into `runs/`.
- Support valid manifest projects created by older GUI versions whose
  `ecc.toml` is missing or lacks required project/design/PDK/flow identity.
- Reload the current manifest after migration and reconcile project state.
- Keep a failed project inspectable through a read-only legacy projection and
  expose the CLI failure for retry.
- Keep all mutating project and workspace operations behind the current ECC CLI
  manifest contract after migration.

## Architecture

### ECC migration

`ecc migrate` remains the only writer for migration. Its preview and execution
must use the existing project migration lock, workspace execution locks,
identity checks, no-replace moves, and rollback behavior. The migration parser
must tolerate the historical case where `project.json` exists but declares
`runs/<workspace>` paths. It should validate enough legacy fields to construct
the current manifest, move only validated workspaces to direct project-child
paths, rewrite path-bearing flow/config fields, and atomically register moved
workspaces.

Projects with collisions, unsafe symlinks, malformed flow ledgers, invalid
flow ranges, or active workspace execution are not silently forced. ECC returns
structured errors; a successful migration returns the moved workspace paths and
the resulting manifest status.

For an already-valid manifest project, migration also owns compatibility repair
of `ecc.toml`. It may create the file or fill only missing values that can be
proved from the validated manifest. Existing non-empty values are preserved.
Malformed TOML, symlinks, non-regular files, and semantic table/value conflicts
fail closed as `config_migration_failed`; Electron never reconstructs the file.
The write uses the migration lock and the standard atomic text replacement.

### Electron main process

Add a project migration coordinator around project opening. It classifies the
project using legacy-layout presence plus a bounded TOML syntax/required-field
probe to decide whether to invoke the CLI, then
executes `ecc migrate --project <root> --yes --plain` asynchronously. The
coordinator deduplicates concurrent requests for the same canonical project
root. After a successful migration it runs `ecc project reconcile --project
<root> --plain` and invalidates the manifest/discovery cache before returning.

The normal manifest loader must not call `project reconcile` before the legacy
classification/migration branch, otherwise old projects fail before migration
can start.

### Renderer behavior

The renderer treats migration as an opening state. While migration is running,
project mutation and workspace launch actions are disabled and the UI reports
that the project is being upgraded. On success it reloads Project Management
from `project.json`. On failure it keeps a legacy read-only model when possible,
disables mutating actions, and shows the structured ECC error and retry action.

The legacy model is transient and is not written to disk. Existing `ecc status`
and `ecc log` CLI reads may provide workspace-level status while migration is
blocked; detailed current snapshot-dependent views remain unavailable until
migration succeeds.

The current Electron projection marks this state as
`project_migration: { status: "legacy-readonly", reason }`. Project Management
uses that marker to disable mutations for the affected project and exposes a
retry through the normal manifest refresh. A successful retry removes the
transient marker because ECC has written the canonical manifest.

## State flow

```text
open project
  -> classify legacy
  -> migrating
  -> ecc migrate --yes --plain
  -> ecc project reconcile --plain
  -> reload manifest and workspace cards
  -> ready

migration error
  -> legacy-readonly (if readable)
  -> retry or user repair
```

## Safety and recovery

- Canonicalize the project root before starting and key in-flight requests by
  that canonical path.
- Do not auto-migrate projects merely discovered in a directory picker or
  recent-project scan.
- Do not start migration while an old workspace reports `Ongoing` unless ECC's
  workspace lock proves the run is no longer active.
- Do not move files in Electron. The CLI owns all path validation, locking,
  rebasing, manifest registration, and rollback.
- A GUI crash may leave the CLI migration interrupted, but the ECC lock and
  transaction recovery must make the next open classify and retry safely.

## Compatibility matrix

| Project shape | Automatic behavior |
| --- | --- |
| v1 manifest with direct-child workspaces | Load normally; no migration |
| No manifest with `runs/*` workspaces | Migrate automatically |
| Existing manifest with `runs/*` workspaces | Use tolerant migration path |
| Valid direct-child manifest, missing/incomplete `ecc.toml` | Repair config automatically, then reconcile |
| Valid manifest, malformed/symlink/non-regular `ecc.toml` | Keep read-only and show reason; do not overwrite |
| Malformed flow, collision, symlink, active run | Keep read-only and show reason |
| Missing/incomplete engineering snapshot | Migration may finish; reconcile regenerates supported snapshots, otherwise keep affected workspace unavailable |

## Tests and validation

- ECC migration tests for no-manifest legacy projects, legacy manifests with
  `runs/` paths, missing/partial/malformed config, collisions, malformed flow,
  active locks, and rollback.
- Electron tests for migration classification, request deduplication, CLI
  arguments, reconcile/reload sequencing, and failure fallback.
- Renderer tests for disabled mutations during migration, successful reload,
  and legacy read-only fallback.
- Run the affected ECC test suite, Electron unit tests, renderer unit tests,
  and the repository build/check commands required by the scoped instructions.
