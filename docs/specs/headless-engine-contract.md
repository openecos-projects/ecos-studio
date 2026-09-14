# Headless Engine Contract (PR 275 follow-through)

> **Historical document.** This earlier spec described a Studio-only Engine
> contract and explicitly left CLI writes on the old path. It is superseded by
> [ECC Runtime Consolidation v1](ecc-runtime-consolidation-v1.zh-CN.md), which
> makes ECC Engine the shared mutation path for CLI and Studio while keeping CLI
> read commands and report output compatible. Do not use the old CLI scope or
> Snapshot ownership statements below as the current contract.

Status: ready for implementation. Scope is the Studio-owned Headless Engine
Contract already sketched in this branch; this spec closes the gaps decided
during review. Vocabulary follows
[glossary-headless-engine.md](glossary-headless-engine.md). Binding ADR:
[adr-headless-engine-contract.md](adr-headless-engine-contract.md).

## Problem Statement

Studio needs a process-local Python contract to create, inspect, configure,
and run a Workspace after the in-process RPC runtime is gone. The branch
already exposes lifecycle and configuration APIs, but they are not yet a
single contract: configuration uses a second lock file, query APIs can
migrate the Workspace, create can delete a directory it did not create,
execution is not the documented Studio entry, and the public engine surface
does not export snapshot or signoff reads.

CLI already has its own ownership lock and in-memory parameter rollback.
Those must keep working. This spec does not ask CLI to adopt the Headless
Engine Contract.

## Solution

Finish the Studio-only Headless Engine Contract on this branch:

- One Workspace Ownership Lock for every Studio mutation.
- Configuration Transaction as disk backup only, never a second lock.
- Query APIs load a Workspace read-only and never migrate.
- Studio execution goes through `execute` and commits the Engineering
  Snapshot.
- Create failure deletes only a directory this call created.
- The engine package exports snapshot reads and signoff inspect/export, not
  scoring internals.
- Workspace Spec parameter applicability uses canonical flow step names.

CLI `ecc run` and `ecc param --workspace` stay on their existing paths.

## User Stories

1. As a Studio engineer, I want to create a Workspace from a Workspace Spec
   and Bindings, so that the GUI does not speak RPC.
2. As a Studio engineer, I want a successful create to write an Engineering
   Snapshot at revision 1, so that later updates have a committed identity.
3. As a Studio engineer, I want repeating the same create command id to
   return the existing Workspace, so that retries are safe.
4. As a Studio engineer, I want create to fail with `workspace_exists` when
   the directory already belongs to someone else, so that another Workspace
   is never deleted.
5. As a Studio engineer, I want create to remove only the directory this
   call created if setup fails after mkdir, so that half-written trees are
   cleaned up without touching pre-existing data.
6. As a Studio engineer, I want structural update to replace design, PDK,
   flow range, and parameters atomically, so that a failed update does not
   leave a mixed Workspace.
7. As a Studio engineer, I want structural update to require the expected
   Workspace Revision, so that two Studio sessions cannot silently overwrite
   each other.
8. As a Studio engineer, I want a matching command id on structural update
   to be idempotent, so that a retried request does not bump the revision
   twice.
9. As a Studio engineer, I want a stale expected revision to fail with
   `revision_conflict` without creating a missing snapshot, so that conflict
   handling cannot invent identity.
10. As a Studio engineer, I want configuration update to change only
    parameters (not design or PDK structure), so that geometry and PDK
    edits stay on the structural-update path.
11. As a Studio engineer, I want configuration update to take the same
    Workspace Ownership Lock as create and structural update, so that
    Studio cannot configure a Workspace while another Studio mutation
    replaces it.
12. As a Studio engineer, I want configuration update to keep a disk backup
    and restore it if refresh or invalidate fails, so that params, flow,
    and snapshot stay consistent.
13. As a Studio engineer, I want configuration crash recovery to run only
    while the Workspace Ownership Lock is already held, so that restore
    cannot race another Studio mutation.
14. As a Studio engineer, I want no `.configuration.lock` sibling file, so
    that lock ownership is one filename and one story.
15. As a Studio engineer, I want `describe_workspace_binding_requirement`
    to report family, version, and mode without writing files, so that
    opening a Workspace in the GUI is inspection, not migration.
16. As a Studio engineer, I want `assess_execution_readiness` to say whether
    Bindings are enough to run, without creating `home/` files or logs.
17. As a Studio engineer, I want `read_workspace_configuration` and
    `read_step_configuration` from a directory to be read-only, so that
    viewing settings cannot rewrite configs.
18. As a Studio engineer, I want a missing `home.json` or checklist to stay
    missing after a query, so that inspection never materializes defaults.
19. As a Studio engineer, I want `execute` to run a full range or a single
    step, so that the GUI has one run entry.
20. As a Studio engineer, I want `execute` to commit the Engineering
    Snapshot after completed steps, so that QoR and artifacts in the GUI
    match disk.
21. As a Studio engineer, I want a failed `execute` to keep the same
    blocking semantics as `EngineFlow` (stop vs continue), so that run
    behavior does not fork.
22. As a Studio engineer, I want to read the committed Engineering Snapshot
    from the engine package, so that the GUI does not import snapshot
    internals.
23. As a Studio engineer, I want to inspect the current Signoff Assessment
    without persisting a checklist, so that signoff views are safe.
24. As a Studio engineer, I want to export a signoff archive through the
    engine package, so that package creation stays on the same contract.
25. As a Studio engineer, I want analysis builders and QoR scoring to stay
    internal, so that the GUI reads committed snapshot data instead of
    recomputing scores.
26. As a Studio engineer, I want Workspace Spec validation to accept the
    same step spellings as flow construction, so that `synth` and
    `Synthesis` are not two applicability worlds.
27. As a Studio engineer, I want a parameter that does not apply to the
    requested flow range to be a structured spec issue, so that the GUI can
    show the field path.
28. As a Studio engineer, I want unused runtime flow helpers gone, so that
    the only Studio run path is `execute` over `EngineFlow`.
29. As a CLI user, I want `ecc run` to keep calling `EngineFlow` directly,
    so that CLI workspaces do not suddenly grow an Engineering Snapshot.
30. As a CLI user, I want `ecc param --workspace` to keep in-memory
    rollback and the sibling ownership lock, so that parameter edits still
    undo on refresh failure in the same process.
31. As a CLI user, I want CLI and Studio to share a lock filename without
    this change promising cross-product exclusion, so that CLI behavior
    stays what it was on main.
32. As a CLI user, I want `ecc signoff inspect` unchanged, so that CLI
    inspection is not silently rewritten as a Studio query.
33. As a reviewer, I want the engine package export list to be the Studio
    contract, so that deep imports are not required for snapshot or
    signoff.
34. As a reviewer, I want tests to speak only through public engine APIs
    and on-disk Workspace files, so that lock-file names inside the
    transaction helper can change without rewriting the suite.
35. As a Studio engineer, I want Bindings applied at execute/update time,
    so that a Workspace can be copied to another machine and rebound.
36. As a Studio engineer, I want a PDK root mismatch to be
    `pdk_binding_mismatch`, so that the GUI can ask the user to rebind
    instead of running the wrong PDK.
37. As a Studio engineer, I want step configuration update to invalidate
    only from the target step, so that earlier successful steps are not
    thrown away.
38. As a Studio engineer, I want configuration update to reject design or
    PDK sections, so that the GUI cannot hide a structural change inside
    a parameter save.
39. As a Studio engineer, I want `execute` to apply Bindings before
    running, so that a default-PDK Workspace can resolve files on this
    host.
40. As a maintainer, I want `execute` to call `EngineFlow` methods
    directly, so that runtime signature probing is not part of the
    contract.

## Implementation Decisions

- The Headless Engine Contract is Studio-only for this change. CLI does not
  call create-from-spec, configuration update, or `execute`.
- Studio mutations (create, structural update, configuration update) all
  acquire the Workspace Ownership Lock: the sibling `{workspace-name}.lock`
  next to the Workspace directory. That filename already exists for CLI
  runs; this change does not add a second Studio ownership lock.
- The Configuration Transaction keeps its disk backup under the Workspace
  `home/` directory and still restores on failure or crash. It must not
  open or flock a `.configuration.lock` file. Backup, commit, rollback, and
  crash recovery run only while the caller already holds the Workspace
  Ownership Lock.
- Writable `load_workspace` (and therefore transaction crash recovery
  hooked off load) is allowed on mutating Studio paths. Query paths must
  not go through that load.
- Query APIs are `describe_workspace_binding_requirement`,
  `assess_execution_readiness`, `read_workspace_configuration_from_directory`,
  `read_step_configuration_from_directory`, Engineering Snapshot reads from
  a directory, and signoff inspect. Each loads with `read_only=True` and
  must not migrate filenames, create `home/` files, rebuild a persisted
  checklist, or append logs.
- In-memory Workspace objects passed into `read_workspace_configuration` /
  `read_step_configuration` are already loaded; those helpers must not
  persist side effects either.
- `create_workspace_from_spec` treats an existing target as
  `workspace_exists`, except when `command_id` matches a completed create
  (idempotent retry). Failure cleanup may `rmtree` only if this invocation
  created the target directory. A pre-existing directory is never removed.
- Structural update may keep using a staging directory that this call
  created; that staging directory is owned by the call and may be deleted
  on failure.
- Studio execution uses `execute` with an `ExecutionPlan`. The default
  observer commits the Engineering Snapshot after completed steps. CLI
  continues to construct `EngineFlow` and call `run_steps` / `run_step`.
- `execute` calls `EngineFlow.run_steps` / `run_step` directly with `rerun`
  and observer arguments. No `inspect.signature` probing.
- Delete unused runtime-extraction helpers that have no production callers
  (`workspace_step_from_flow`, DB-init-for-step, success/state adapters).
  Tests that only needed `build_flow_for_workspace` should construct
  `EngineFlow` themselves.
- `chipcompiler.engine` exports, in addition to the current lifecycle /
  configuration / `execute` surface: Engineering Snapshot read helpers and
  signoff inspect/export. It does not export analysis builders or
  `score_qor`.
- Snapshot *writes* stay internal to create, update, configuration, and
  `execute`. Studio reads committed snapshots; it does not call create /
  ensure / invalidate snapshot helpers as public API.
- Workspace Spec parameter applicability uses `normalize_flow_step()` for
  both the requested flow steps and each schema's `applies` value. The
  handwritten alias map (`synthesis→synth`, and the rest) is deleted.
  Parameters with `applies == "all"` remain applicable to any range.
- Keep CLI in-memory parameter rollback and CLI use of the sibling lock.
  Do not route CLI param through the Configuration Transaction.
- Keep CLI `sys.modules` manifest aliases and CLI signoff inspect as they
  are.
- Do not split the metrics module in this change.
- Typed errors stay `WorkspaceLifecycleError` with stable `code` values
  already used by create/update/configuration (`workspace_exists`,
  `revision_conflict`, `workspace_spec_invalid`, `pdk_binding_missing`,
  `pdk_binding_mismatch`, `workspace_structure_change_requires_update`,
  and the existing snapshot/config invalid codes).

## Testing Decisions

Good tests assert observable contract behavior: return values, exception
codes, Engineering Snapshot identity/revision, and whether files on disk
appeared, changed, or stayed absent. They do not assert the Configuration
Transaction's internal lock filename, backup directory name, or helper
class. They do not import analysis/scoring modules to prove the public
contract.

Highest seam: `chipcompiler.engine` public APIs plus the Workspace
directory they mutate. That is the existing `test/engine/` seam
(`test_workspace_spec.py`, `test_workspace_configuration.py`,
`test_execution.py`, `test_signoff_assessment.py`). Prefer extending those
modules over adding a new test package.

Cover:

- Create idempotent retry vs `workspace_exists`; create failure does not
  delete a pre-existing directory (the call did not create it).
- Configuration update and create/structural update cannot interleave: a
  holder of the Workspace Ownership Lock blocks the other Studio mutation
  (same style as existing CLI lock-wait tests, but through engine APIs).
- After removing the independent configuration lock, crash-recovery tests
  still restore params/snapshot when the process dies mid-commit; recovery
  is observed via a later mutating API or a read of committed files, not
  via the transaction lock path.
- Query APIs with missing `home.json` / checklist / log dir / missing PDK
  root do not recreate those paths. Extend the existing read-only
  configuration test to `describe`, `assess`, and step-configuration read.
- `execute` commits snapshot after a completed step; already present in
  `test_execution.py` and remains required.
- Spec applicability: a parameter whose canonical `applies` step is
  outside the requested range is a structured issue; a non-canonical
  spelling that `normalize_flow_step()` maps into the range is allowed.
- Engine package export list includes snapshot reads and signoff
  inspect/export, and does not include `score_qor` or analysis builders.
- Existing revision/idempotency/rollback tests in workspace spec and
  configuration suites still pass.

CLI suites are regression guards, not the place to add Studio contract
tests. Do not add tests that require CLI to write an Engineering Snapshot.

## Out of Scope

- Wiring CLI create, refresh, param, or run through the Headless Engine
  Contract.
- Making CLI and Studio one locking domain (cross-product mutual
  exclusion).
- Replacing CLI Parameter Rollback with the Configuration Transaction.
- Changing CLI manifest import aliases.
- Making CLI signoff inspect a read-only load.
- Splitting the metrics module.
- Exporting analysis builders or QoR scoring from the engine package.
- Teaching CLI `ecc run` to write an Engineering Snapshot.
- Full-suite, PyInstaller, and Nix runs as spec items (merge checklist
  only).

## Further Notes

`main` already had two products. CLI serialized with the sibling ownership
lock and rolled back workspace params from in-memory bytes. RPC/Studio
serialized with a process-local session lock and had no file-backed
configuration transaction. This spec does not merge those histories; it
gives Studio a file-backed contract after RPC removal.

The independent `.configuration.lock` file is new on this branch, not
inherited from `main`. Removing it is restoring a single ownership lock,
not deleting CLI behavior.

A later change may adopt the Headless Engine Contract in CLI. That is a
separate decision.
