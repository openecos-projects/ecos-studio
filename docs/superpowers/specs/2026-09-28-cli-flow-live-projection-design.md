# CLI Flow Live Projection And Log Tailing

## Goal

Make an ECC CLI-backed flow report truthful step results and update ECOS Studio
while it runs. The implementation must keep `home/flow.json` as the only live
flow-state file, keep `project.json.runtime_processes` limited to process
identity, and avoid restoring an ECC RPC/event-stream dependency.

## Scope

- Fix the ECC QoR Snapshot validator defect that changes a successful Place
  result into `Incomplete`.
- Project every persisted `flow.json` step state, runtime, tool, and peak memory
  value into the active Workspace UI.
- Keep Project Management and Workspace views on the same live projection.
- Recover from a missed filesystem notification on NFS with bounded, low-rate
  reconciliation while the registered ECC process is alive.
- Incrementally read the currently visible step log through the existing
  project-scoped bounded chunk API.
- Preserve terminal resource invalidation for Engineering Snapshot, QoR,
  artifacts, signoff, and layout resources.

The change adds no persisted runtime file and requires no new ECC CLI command.
It does not restore subflow events, render acknowledgements, or per-line ECC RPC
notifications.

## Selected Approach

Electron main owns one live flow projection per tracked operation. It parses the
same bounded `flow.json` contract used for recovery, retains the complete step
list on the background operation projection, and invalidates the projection when
the parsed value changes. Renderer consumers overlay that live list on the last
committed Engineering Snapshot until the operation reaches a terminal state.

Alternatives were rejected as follows:

- Renderer file polling duplicates privileged filesystem access, creates one
  watcher per view, and violates the existing Electron boundary.
- A new CLI stdout event stream recreates transport lifecycle, replay, and
  recovery concerns that the CLI refactor intentionally removed.

## ECC Result Correctness

`validate_qor_snapshot_extension` must pass `nullable=False` when validating a
diagnosis severity. A regression test must validate a complete extension with a
non-empty diagnosis list, because the existing unavailable-extension fixture has
no diagnoses and cannot execute this branch.

Place is successful when its tool execution and required-output checks succeed.
The immediate defect fix restores the existing atomic snapshot-commit behavior;
it does not redesign Engineering Snapshot failure policy. Snapshot failures must
still identify themselves as snapshot/projection failures in operation logs.

## Live Flow Data Path

```text
ECC step starts/finishes
  -> atomic home/flow.json replacement
  -> Electron WorkspaceOperationFileWatcher
  -> bounded PersistedFlow parse
  -> background operation liveFlow update
  -> operation projection invalidation
  -> Renderer background operation store
  -> Workspace and Project Management flow projection
```

The live projection contains the complete ordered step list. It uses existing
shared step fields and does not expose raw filesystem content. Unknown/new ECC
step IDs remain valid and preserve flow order.

Watcher startup must await readiness and then perform an unconditional refresh,
so a step transition that races watcher creation is still observed. The existing
process timer remains the process-identity authority and also refreshes
`flow.json` before or during each live-process inspection. Parsed projections
are compared structurally so unchanged fallback reads do not generate renderer
updates.

When the runtime registration disappears, Electron performs one final refresh,
publishes the terminal operation, and triggers the existing broad terminal
resource invalidation. A temporary `ENOENT` during atomic replacement remains a
retryable read condition rather than an empty flow.

## Renderer Projection

Backend flow stages use the live operation step list while an operation is
running and the committed Engineering Snapshot otherwise. `currentStep` remains
available for compact operation summaries, but it is derived from the live list
and is not the only runtime status delivered to the renderer.

This projection updates:

- current `Ongoing` step;
- completed, failed, skipped, and pending states;
- persisted runtime and peak memory;
- tool identity and flow completion;
- dynamically introduced ECC steps.

The renderer does not interpret `project.json.workspaces[].status` as live state.
Project Management combines a valid runtime registration with the same live
flow projection used by the Workspace page.

## Live Log Data Path

The log panel does not depend on `step.log` runtime events. Once the live flow
projection identifies an active step, the existing workspace resource index
resolves its authorized log path. While that log segment is selected and
visible, the renderer calls the existing bounded
`readOptionalProjectTextFileChunk` API from its last byte offset.

Polling is demand-driven and stops when the segment is hidden, the step becomes
terminal, the Workspace changes, or the component unmounts. Reads are bounded,
serialized, and preserve UTF-8 offset semantics. File truncation or replacement
resets the cursor and reloads a bounded tail instead of duplicating content.
Terminal refresh adopts the final file content and persisted runtime.

The durable `home/run-logs/<run-id>.log` remains available for launch and
top-level CLI failures; the segmented Workspace log UI continues to show tool
step logs.

## Error Handling

- Invalid or unsupported `flow.json` keeps the last valid projection and records
  a runtime projection warning; it is never treated as an empty successful flow.
- A watcher error does not stop process reconciliation or bounded fallback
  refresh.
- A log read failure affects only the selected log segment and remains retryable.
- Workspace switches discard old operation/log cursors before applying new
  projection data.
- Terminal ECC failure marks only a still-running step failed; already persisted
  successful steps remain successful.

## Tests And Acceptance

### ECC

- A QoR Snapshot extension with one diagnosis validates successfully.
- Invalid, null, boolean, and out-of-range severity values remain rejected.
- The existing snapshot migration and flow completion tests pass.

### Electron

- Watcher readiness plus immediate refresh observes a transition that occurs
  during startup.
- Atomic flow replacement updates the complete live step projection.
- The process polling fallback observes a flow update when no watcher callback
  occurs.
- An unchanged flow does not increment projection generation.
- Terminal refresh preserves the final step states and closes watcher/timer
  resources.

### Renderer

- A live projection advances Synthesis through Place without relying on
  `step.started` or `step.completed` RPC events.
- Completed runtime and peak memory values update during a running flow.
- A visible live log appends bounded chunks once, handles truncation, and stops
  polling when hidden or terminal.
- Workspace switching cannot apply stale flow or log results.

### End-To-End

Run the GCD flow in an NFS-hosted project and verify that:

1. Synthesis, preFloorplan, macroPlacement, postFloorplan, and Place advance in
   the GUI while ECC is still running.
2. The open Place log gains output without reopening the panel.
3. Place remains `Success` after its required outputs are produced.
4. Terminal failure details remain available from the durable run log.
5. No per-step mutation is made to `project.json`.

Run focused ECC, Electron, shared-contract, and renderer tests while iterating,
then run ECC lint/tests and the GUI `pnpm run check`. No packaging input changes
are planned, so a release build is not required unless the implementation
changes preload, bundled resources, or build configuration.
