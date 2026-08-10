# Live Flow Log Batching Design

## Goal

Show incremental ECC `step.log` output for every active flow stage in both the
Dashboard and step workbench without polling workspace files or causing UI
stutter.

## Current Failure

`useHomeData` watches only the final entry in `runtimeEvents`. When Electron
delivers multiple runtime notifications before Vue flushes its watcher, earlier
`step.log` chunks are skipped. The route stage makes this easy to reproduce
because it emits a sequence of bounded chunks, but the defect applies to every
stage.

Both `HomeView` and `WorkspaceView` already render the same `FlowLogPanel` from
`useHomeData`, so fixing the shared consumer covers both surfaces.

## Design

1. Replace the last-event watcher with a stream consumer that observes runtime
   event mutations and processes every newly received event exactly once.
2. Keep a bounded identity ledger based on the runtime event ID when present;
   it tolerates replay while permitting legacy events without IDs.
3. Buffer live `step.log` chunks by `(step, tool)` until the next animation
   frame, then append each stage's combined text in one reactive update.
4. Flush pending chunks before processing `step.completed`, `step.started`, or
   rerun-reset events so log ordering and the active segment remain correct.
5. Retain the existing 128 KiB in-memory tail limit and ECC's 16 KiB / 250 ms
   producer bound. The renderer must not open, watch, or poll active NFS logs.
6. Cancel a scheduled frame and clear pending batches on composable unmount;
   module-level final log content remains reusable across routes as today.

## Verification

- Add a renderer regression test that queues a step start and multiple log
  chunks before one Vue flush and verifies all chunks are visible in order.
- Add a completion-boundary assertion that pending chunks are visible before
  the final log replaces the active segment state.
- Run the focused renderer test, renderer typecheck, and the relevant project
  quality checks.
