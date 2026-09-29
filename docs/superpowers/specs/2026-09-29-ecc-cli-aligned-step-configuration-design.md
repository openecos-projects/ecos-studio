# ECC CLI-Aligned Step Configuration

## Goal

Make ECOS Studio Step Config show and edit exactly the parameters that ECC owns
for the selected Workspace flow step. Saving in the GUI must have the same
validation, persistence, invalidation, concurrency, and rollback behavior as
`ecc param apply`; the corresponding managed `config/*.json` files must reflect
the committed values immediately.

ECC remains the single writer for Workspace configuration. Electron and the
renderer must not write `home/params.toml`, managed JSON configuration files, or
Engineering Snapshot state directly.

## Scope

- Replace GUI-owned step applicability filtering with an ECC CLI Workspace-step
  parameter projection.
- Remove Step Config's cross-Workspace baseline parameter comparison, including
  its baseline read, split column, toggle, badges, and difference highlighting.
- Keep the existing batch `ecc param apply` mutation path for Step Config saves.
- Reload the selected step from ECC after a successful mutation so the editor
  shows committed, normalized values and the new Workspace revision.
- Keep generated input, output, temporary-directory, and other runtime path
  fields outside the editable parameter model.
- Move the ECC run-level log from `home/run-logs/` to the Workspace root
  `log/` directory.
- Ensure `home/config-derived-manifest.json` describes the final managed JSON
  content after ECC-owned derivation writes.
- Add focused ECC, Electron, and renderer regressions for the read/save path.

This change does not add a raw JSON editor, make arbitrary JSON fields
configurable, or migrate project-level `design.*` and `pdk.*` settings into
Workspace Step Config. Removing the Step Config comparison does not alter the
project's QoR baseline selection or its use in Project Analysis, QoR, and other
result views.

## Selected Approach

ECOS Studio acts as a client of the ECC CLI for both reads and writes:

```text
Open Step Config
  -> Electron asks ECC for the selected Workspace step's parameter projection
  -> ECC resolves flow-step identity, reviewed schemas, effective values,
     constraints, sources, and Workspace revision
  -> Renderer displays only those returned records

Save changed fields
  -> Renderer sends one parameter patch with expected Workspace revision
  -> Electron runs `ecc param apply --workspace ... --step ...`
  -> ECC validates and atomically commits params, generated configs, flow
     invalidation, Engineering Snapshot, command receipt, and revision
  -> Electron reloads the selected step from ECC
  -> Renderer replaces its draft with the committed projection
```

This removes TypeScript as a second authority for rules such as step aliases,
parameter `group`, `applies`, and the placement of `all` parameters on the first
flow step.

Two alternatives are rejected:

- GUI dual-write to `params.toml` and JSON duplicates ECC mapping and creates
  partial-commit states when one write succeeds and another fails.
- Direct full-JSON editing exposes derived runtime paths, cannot reliably map
  arbitrary edits back to reviewed parameters, and is overwritten by later ECC
  derivation.

## Run-Level Log Contract

The current version has one canonical run-level log location:

```text
<workspace>/log/<run_id>.log
```

ECC's `default_log_path`, `--log-file` validation, detached stdio redirection,
and `project.json.runtime_processes[*].log_path` all use this relative path.
`home/` remains reserved for persisted flow state, parameters, snapshots, and
other Workspace metadata; it must not contain run-level logs.

This is a new, strict contract. `home/run-logs/` is not a valid fallback, is not
read by ECC or GUI recovery, and is not migrated. A runtime process entry with
the old path is invalid and should report the existing malformed runtime-process
error rather than silently switching locations.

The Workspace `log/` directory already contains the ECC Workspace logger. The
run ID is a canonical UUID, so the run-level file name cannot collide with the
timestamped Workspace logger files. `ecc log` continues to list both run-level
and per-step logs from their respective Workspace-root locations.

## ECC Read Contract

ECC must expose the existing authoritative step configuration projection through
`ecc param list --workspace <workspace> --step <step> --all --plain`. The
projection uses the selected Workspace's persisted flow, not a hard-coded GUI
step list. It returns:

- canonical `step` and `stepId`;
- Workspace identity and current revision;
- one record per reviewed, Workspace-editable schema for that step;
- parameter ID, effective value, default, type, description, range, choices,
  unit, applicability, and source when available.

Step matching must use ECC's normal flow-step normalization. A schema applies
when ECC's catalog assigns it to the selected step. A schema with `applies =
"all"` appears only on the first persisted flow step, matching ECC's existing
step-catalog behavior. PDK-targeted and otherwise project-only schemas are not
returned.

A valid flow step with no editable parameters returns the existing unavailable
status expected by the desktop contract. An unknown flow step is an error. The
GUI must not reconstruct missing records by filtering the global catalog.

## GUI Read And Edit Behavior

Electron main invokes the ECC CLI and validates its structured output before
returning the existing shared Step Config result. The renderer remains a typed
consumer and performs only presentation-level validation.

The editor displays the records in ECC order and preserves the existing input
controls for scalar, boolean, choice, list, and object values. Only returned
parameter IDs can enter the save patch. Derived JSON fields such as DEF/Verilog
inputs, output directories, temporary directories, and generated PDK paths are
not displayed as editable settings.

The renderer's step sidebar and editor must use the same backend result. Static
renderer mappings may provide display labels only; they must not decide which
parameters belong to a step.

Step Config uses one editable column for the active Workspace. It does not load
the project's QoR baseline Workspace, expose a Baseline toggle, render a
read-only comparison column, or highlight differences against another
Workspace. The baseline-specific composable, cache, diff provider, styling, and
tests are removed when they have no consumer after this change.

The editor still retains the committed active-Workspace projection while a user
edits. Comparing the draft with that projection is required only for unsaved
state, Reset, and no-change save suppression; it is not presented as a baseline
parameter comparison. ECC's own Workspace override baseline used by `ecc param
diff` and `ecc param unset` is also unchanged.

## Save And Commit Semantics

The renderer sends only changed parameter values, the selected step ID, a unique
command ID, and the revision from the loaded projection. Electron runs one
batch command equivalent to:

```text
ecc param apply \
  --project <project> \
  --workspace <workspace> \
  --step <step> \
  --expected-revision <revision> \
  --command-id <id> \
  --no-wait \
  --set <key>=<value> ...
```

ECC owns schema validation, normalized values, Workspace locking, optimistic
revision checks, idempotent command handling, `home/params.toml`, generated
configuration refresh, flow-suffix invalidation, Engineering Snapshot revision,
and transaction rollback.

After success, Electron reloads the selected step through the ECC read contract
and returns that committed projection. The GUI must not assume the submitted
value is the stored value. Unchanged drafts do not issue an empty apply command.

The corresponding `config/*.json` file changes as an ECC-derived effect of the
same transaction. Fields with no JSON target, such as runtime-only parameters,
remain valid without fabricating a JSON write.

## Derived Configuration Manifest

`home/config-derived-manifest.json` is part of the ECC-owned derived-state
contract. Its hashes must describe the final managed files after a lifecycle
operation completes, including ECC-owned step-dependent path writes performed
after the common parameter/PDK refresh.

Manifest maintenance must not bless unrelated manual edits. ECC should update
the record at a lifecycle boundary where it knows the complete managed files
were derived, or update only the entries for files it authoritatively rewrote.
The manifest remains inside the same rollback set as parameters and managed
configs.

## Errors And Concurrency

- An invalid value or a parameter not applicable to the selected step fails the
  entire patch and changes no Workspace file.
- A revision conflict leaves the user's draft visible, reloads or offers the
  latest committed projection through the existing error flow, and never
  retries against a new revision silently.
- A busy Workspace reports the ECC `workspace_busy` failure; it does not fall
  back to direct file writes.
- Malformed CLI output is a backend integration error and is not interpreted as
  an empty parameter list.
- If post-save reload fails after ECC has committed, the GUI reports that the
  save succeeded but refresh failed, then permits an explicit reload. It must
  not replay the mutation with a new command ID.
- Existing command-ID retry behavior remains authoritative for an ambiguous
  subprocess result.

## Tests And Acceptance

### ECC

- The CLI step projection and engine `read_step_configuration` select identical
  parameter IDs for each persisted flow step, including aliases and groups.
- `all` parameters appear only on the first persisted step.
- PDK-targeted and runtime-derived path fields are excluded.
- A batch apply updates `home/params.toml`, its mapped JSON fields, flow state,
  Engineering Snapshot revision, and derived manifest together.
- A forced failure at each transaction stage restores all declared files.
- The derived manifest matches final JSON content after Workspace creation,
  refresh, parameter apply, and ECC-owned step-dependent configuration writes.
- New runs create and append only `log/<run_id>.log`; no `home/run-logs`
  directory or file is created.
- Runtime process registration rejects old `home/run-logs` paths and records the
  canonical Workspace-root path.

### Electron

- Step Config reads invoke the ECC Workspace-step query rather than filtering
  `parameterCatalog` in TypeScript.
- CLI records are validated and converted to the existing shared result.
- Save sends one `param apply` batch with step, revision, command ID, and encoded
  values, then reloads the committed step projection.
- Revision conflict, busy Workspace, malformed output, and commit-then-reload
  failure preserve truthful UI state.
- Detached GUI runs pass and resolve `log/<run_id>.log`; log reads never fall
  back to `home/run-logs`.

### Renderer

- The RCX editor shows only the ECC-owned RCX parameter set and does not include
  unrelated `all` parameters such as `FLOW.RUN_ANALYSIS`.
- The sidebar availability and editor fields derive from the same backend
  response.
- Step Config renders only the active Workspace editor and performs no baseline
  Workspace read. It has no Baseline toggle, comparison column, difference
  badge, or baseline difference styling.
- A successful save replaces draft values with the committed response and new
  revision; a failed save preserves the draft for correction or retry.
- Draft dirty state, Reset, and no-change save suppression continue to compare
  against the active Workspace's last committed projection.

### End-To-End

Using `gcd/ws_0001`:

1. Compare every GUI step's parameter IDs with `ecc param list --workspace
   ws_0001 --step <step> --all`; they are identical.
2. Change `rcx.thread_num` from `64` to `32` and save once.
3. Verify `home/params.toml`, `config/rcx_ecc.json`, the Engineering Snapshot,
   and `home/config-derived-manifest.json` all contain or describe the committed
   value without restarting the GUI.
4. Verify the Workspace revision increments once and RCX plus its downstream
   suffix is pending according to ECC semantics.
5. Verify RCX derived `input`, `output`, and other runtime paths remain intact
   and are not editable in Step Config.
6. Verify opening Step Config does not read a baseline Workspace and offers no
   cross-Workspace parameter comparison UI.
7. Start a new run and verify its run-level log is created at `log/<run_id>.log`,
   is shown by `ecc log`, and no `home/run-logs` path is created.

Run focused ECC CLI/engine tests, Electron tests, and renderer tests while
iterating. Before handoff, run the ECC checks required by `ecc/docs/development.md`
for the touched Python files and `pnpm run check` from `ecos/gui`. No packaging
resource or build configuration change is planned, so the release build is not
required unless implementation scope expands.
