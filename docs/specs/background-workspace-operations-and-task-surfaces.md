# Background Workspace Operations and Task Surfaces Specification

Status: implemented (2026-09-04)

This specification details the background Operation projection and user surfaces
deferred by ADR 0026 and required by ADR 0031. It applies only to backend ECC
Workspaces. It is intentionally separate from safe shutdown, force quit, and
unfinished Workspace creation recovery.

## Problem Statement

Backend ECC Flows already execute outside the visible Workspace page, but ECOS
Studio still presents their state as if it belonged to the current Renderer
route. When the user opens Project Management, switches to another Workspace, or
returns to a running Workspace, the current event subscription and Workspace
projection can be cleared and rebuilt. This makes a valid background Operation
look paused, missing, or newly started even though Electron and the Runtime
Adapter still own it.

The user also lacks one reliable place to see all work in progress. Project
Management can show per-Workspace execution overlays, but that information is
not available from every route. The Topbar can show a creation Tip, but it does
not expose running Flows or allow the user to locate and control them.

The missing capability is not another scheduler or worker. It is a global,
lightweight Operation projection backed by Electron's existing Runtime trackers,
plus two presentations of that projection: a compact Topbar activity list for
global awareness and an expanded Project Management surface for cross-Workspace
inspection and control.

## Solution

Electron main remains the authority for backend Runtime Sessions and Operations.
It exposes a bounded Operation snapshot and invalidation signal derived from the
existing per-Workspace Runtime trackers. The snapshot is recoverable and does
not depend on Runtime Event replay.

An App-lifetime Renderer store consumes that snapshot, reconciles transient
Runtime Events, and keeps entries keyed by canonical Workspace identity and
Operation identity. Route changes and foreground Workspace switches do not stop
the store or clear its projection.

The Topbar exposes a compact Background Tasks button with an active count. Its
popover shows running or queued Flows and pending Workspace creation, with
Workspace identity, current Step, state, elapsed time, and appropriate actions.
It is a global awareness and quick-action surface, not a full comparison view or
task history.

Project Management remains the complete cross-Workspace management surface. It
shows the same Operation projection in each Workspace row and provides detailed
inspection, on-demand logs, explicit foreground opening, retry for retained
snapshot failures, and cancellation. It does not create another task model.

The current Workspace page continues to provide deep Flow, Step, Artifact, and
log presentation. It reads the same Operation projection for live lifecycle
state and the committed Workspace projection for engineering facts.

## User Stories

1. As a chip designer, I want a Flow to remain visible after leaving its Workspace, so that navigation does not look like cancellation or data loss.
2. As a chip designer, I want to see all active backend Flows from the Topbar, so that I know what ECOS Studio is doing from any route.
3. As a chip designer, I want the Topbar to show the number of active tasks, so that concurrent work is immediately apparent.
4. As a chip designer, I want each task to identify its Workspace, so that I do not confuse results from parallel design attempts.
5. As a chip designer, I want each running Flow to show its current Step, so that I can judge progress without opening the Workspace.
6. As a chip designer, I want queued and running states distinguished, so that waiting for a Runtime is not mistaken for active tool execution.
7. As a chip designer, I want cancellation requests shown as cancelling until a terminal result arrives, so that request acceptance is not mistaken for completed cancellation.
8. As a chip designer, I want task elapsed time based on Runtime timestamps, so that route remounts do not restart the displayed timer.
9. As a chip designer, I want pending Workspace creation shown alongside active work, so that the existing creation Tip becomes part of one coherent activity surface.
10. As a chip designer, I want submitted Workspace creation to remain non-cancellable when transaction abort is unavailable, so that the task list does not promise an unsafe action.
11. As a chip designer, I want completed tasks removed from the active list after their outcome is reported, so that the Topbar does not become a task-history page.
12. As a chip designer, I want failed Operations reported through the existing notification surface, so that failures remain visible after leaving the activity list.
13. As a chip designer, I want selecting a Topbar task to locate its Workspace in Project Management without immediately changing the Foreground Workspace, so that inspection does not disrupt my current page.
14. As a chip designer, I want opening a Workspace to be an explicit action, so that merely inspecting a background task cannot replace my current Workspace.
15. As a chip designer, I want to cancel a background Flow using its original Workspace and Operation identity, so that I do not need to reopen the Workspace first.
16. As a chip designer, I want cancellation to require explicit confirmation, so that an accidental icon click cannot stop a long EDA run.
17. As a chip designer, I want logs loaded only when I request them, so that several background Flows do not flood Renderer memory or IPC.
18. As a chip designer, I want Project Management to show active execution beside committed comparison data, so that transient progress is not mistaken for a committed result.
19. As a chip designer, I want the active overlay matched to the correct Workspace Revision, so that an older Operation cannot decorate a newer Workspace configuration.
20. As a chip designer, I want multiple Workspaces to show independent Operations, so that concurrent backend execution is understandable.
21. As a chip designer, I want at most one active Operation shown for one Workspace, so that the UI reflects the Runtime's mutation rule.
22. As a chip designer, I want switching back to a running Workspace to preserve its Operation ID and current Step, so that the Flow does not appear restarted.
23. As a chip designer, I want the last committed Workspace data available immediately when I return, so that only local Step or Artifact detail may briefly load.
24. As a chip designer, I want a missed Runtime Event repaired by a query, so that temporary Renderer suspension does not leave progress permanently stale.
25. As a chip designer, I want duplicate or out-of-order events ignored, so that progress never moves backward.
26. As a chip designer, I want a completed background Flow snapshotted before its Runtime Session is released, so that its final engineering state is durable and queryable.
27. As a chip designer, I want a failed final snapshot to retain the Runtime Session, so that recovery remains possible.
28. As a chip designer, I want a retained snapshot failure shown as requiring attention, so that an invisible retained Runtime does not consume resources indefinitely.
29. As a chip designer, I want to retry a failed final snapshot from Project Management, so that recovery does not require restarting the application.
30. As a chip designer, I want reopening a retained Workspace to reuse its Runtime Session, so that retry and inspection do not create duplicate sessions.
31. As a chip designer, I want Topbar task controls operable with the keyboard, so that background work is accessible without a pointer.
32. As a chip designer, I want task status announced semantically without repeated noisy updates, so that assistive technology communicates meaningful lifecycle changes.
33. As a chip designer, I want motion disabled when reduced motion is requested, so that running indicators do not create unnecessary distraction.
34. As a chip designer, I want long Workspace and Step names truncated with accessible full labels, so that the task list remains usable in narrow windows.
35. As an ECOS maintainer, I want Electron to remain the Operation authority, so that Renderer state cannot decide whether a Runtime is active or releasable.
36. As an ECOS maintainer, I want Runtime Events treated as notifications, so that correctness does not depend on complete event delivery.
37. As an ECOS maintainer, I want one typed Operation projection contract shared by all Renderer surfaces, so that Topbar, Project Management, and Workspace views cannot disagree.
38. As an ECOS maintainer, I want route unmount to leave the global projection alive, so that ordinary navigation cannot destroy background state.
39. As an ECOS maintainer, I want the projection bounded, so that a long application session cannot accumulate unlimited events, logs, or terminal Operations.
40. As an ECC-FE maintainer, I want Frontend Runtime behavior unchanged, so that this backend capability does not silently alter an independent lifecycle contract.

## Implementation Decisions

### State ownership

- Electron main owns Runtime Session existence, Workspace-handle ownership,
  active Operation truth, terminal outcome, terminal snapshot coordination, and
  release eligibility.
- The Runtime Adapter remains authoritative for Operation lifecycle and
  Workspace mutation serialization. One Workspace has at most one non-terminal
  Operation; different Workspaces may run concurrently.
- The Renderer background Operation store is a disposable projection. It can be
  rebuilt from the Electron snapshot and must never be consulted by Electron to
  decide whether a Runtime is safe to release.
- The current Renderer path-based Flow flag becomes a compatibility projection
  derived from the global Operation store. It is not a lifecycle authority and
  must not drive background release polling.
- Runtime Events remain transient notifications. Snapshot/query state wins when
  an event is missed, duplicated, delayed, or from an older Runtime instance.

### Electron Operation projection interface

- Extend the existing Runtime host rather than adding a second Runtime manager.
  It already aggregates active Operations across per-Workspace Runtime trackers.
- Expose one typed query returning a process-local projection generation and a
  bounded collection of backend Operation summaries.
- Expose one invalidation subscription carrying the latest generation. The
  event means “query again”; it does not carry the authoritative collection.
- Each Operation summary includes the opaque Workspace handle, stable
  engineering Workspace identity, canonical Workspace directory, Workspace
  Revision, Operation ID, kind, state, current Step, timestamps,
  `cancelRequested`, and a bounded terminal error summary when applicable.
- The projection includes non-terminal Operations and only the bounded terminal
  information required to publish a completion/failure notification. It is not
  a persistent execution history.
- Projection generations increase for lifecycle changes that affect the
  snapshot. Renderer consumers reject snapshots older than the last committed
  generation.
- Existing Runtime Event identity remains the deduplication input:
  Runtime-instance identity, Operation identity, sequence, and event identity.
- Workspace handle ownership remains scoped to the originating renderer window.
  A renderer cannot query logs or cancel using another window's opaque handle.
- Cancellation continues through the existing Product Command and requires the
  exact Workspace handle and Operation ID. The command result reports acceptance
  only; the projection reports the eventual terminal state.

### Runtime Session reuse and release

- Opening a canonical Workspace directory reuses an existing Runtime Session
  owned by the same renderer window when one exists. This includes active,
  finalizing, and snapshot-recovery states.
- Reuse returns the existing opaque handle and does not perform interruption
  recovery against an Operation that is currently running.
- Handle reuse and reference ownership are coordinated in Electron so that a
  stale or superseded Renderer request cannot close a Session it did not create.
- Successful foreground switching detaches the previous Workspace from the page
  without making Renderer wait for Runtime release.
- Electron, not a Renderer timer, observes the terminal Operation, waits for the
  final committed snapshot task, and releases an unreferenced background Session.
- A final snapshot failure moves the Session into a retained refresh-failed
  state. It remains queryable and is included as an attention item.
- Snapshot recovery can be retried explicitly from Project Management and
  automatically when the Workspace is next opened. Success clears the failure
  and permits release; failure retains the Session and updates the diagnostic.
- Retry does not rerun the Flow and does not mutate engineering state.

### Renderer background Operation store

- The store starts once at the application shell and stops only when the
  renderer window is destroyed. Workspace route entry and exit do not own its
  subscription lifecycle.
- The store has one small interface: start/stop, refresh, all active Operations,
  Operations for one Workspace, and attention states for retained snapshot
  failures.
- The store keys entries by canonical Workspace identity plus Operation ID. A
  temporary Workspace handle is retained only for authorized commands and
  queries; it is not used as the display identity.
- Store startup queries the complete projection before accepting invalidations.
  If an invalidation races startup, the store performs another query until its
  generation is current.
- Runtime Events may optimistically update a matching entry, but every gap,
  reconnect, Runtime instance change, and terminal transition schedules a
  projection refresh.
- Events for another Workspace never mutate the current Workspace's local
  detail state. They may update only their own global Operation entry.
- The store retains no full log text, Artifact payload, layout data, QoR data,
  or dashboard detail.
- Workspace creation remains a separate transaction state because it is not an
  ECC Flow Operation. The Topbar presentation composes it with Operation entries
  without merging their underlying lifecycle models.

### Committed Workspace projection continuity

- Committed Workspace overview data is cached by Workspace context rather than
  held as one value that is cleared on every foreground switch.
- Returning to a known Workspace immediately presents its last committed data
  and current Operation overlay, then refreshes in the background.
- Refresh uses the existing Workspace query interface. A failed refresh retains
  cached committed data and marks it stale rather than replacing it with an
  empty loading state.
- Local Step and Artifact detail may show loading when no cached value exists.
  That local state must not clear overall Flow progress or committed Workspace
  overview data.
- Project Management continues to read committed Engineering Snapshots and
  applies the active Operation overlay only when Workspace identity and Revision
  match.

### Topbar task surface

- Add one familiar activity/task icon in the Topbar. Do not introduce a second
  full-page Task Center or a Project Management overlay.
- The button shows an active-count badge for queued/running Operations and
  submitted Workspace creations. Retained snapshot failures use an attention
  state but do not inflate the running count.
- The button has stable dimensions, a tooltip, visible focus, and an accessible
  label containing the current active count.
- Activating the button opens a compact anchored popover. It is not modal and
  does not block interaction with the current route.
- The list is dense and scan-oriented. Each Flow row shows Workspace label,
  current Step, lifecycle state, and elapsed time. No percentage or progress bar
  is shown unless the Runtime provides a real bounded progress value.
- A Workspace creation row shows its target Workspace and “Creating Workspace”.
  It has no Cancel action because reliable transaction cancellation is outside
  the current contract.
- Selecting the body of a Flow row opens Project Management focused on that
  Workspace and Operation. It does not switch the Foreground Workspace.
- A separate Open Workspace command performs foreground switching through the
  accepted candidate-first transition.
- A Cancel icon is present only for cancellable non-terminal Operations. It has
  a tooltip and explicit confirmation. After acceptance it becomes disabled and
  displays “Cancelling” until the authoritative terminal state arrives.
- Completed successful tasks leave the active list after a success notification.
  Failed, cancelled, or interrupted outcomes use the existing Notification
  Center. The task popover does not become an execution-history archive.
- The popover handles zero, one, and many active tasks; long lists scroll inside
  a stable maximum height without resizing the Topbar.
- Running animation respects reduced-motion preferences. State is also conveyed
  through text and icon shape, never color or motion alone.

### Project Management task surface

- Project Management is the detailed cross-Workspace task surface. The nested
  and standalone routes render the same capability.
- Existing Workspace rows consume the global Operation projection and show the
  current Step, queued/running/cancelling state, and elapsed time.
- Selecting a focused task reveals detail within the existing Project Management
  layout rather than opening a modal or replacing the comparison surface.
- Detailed task presentation includes Workspace, Operation kind, current Step,
  start/update timestamps, lifecycle state, cancellation state, and bounded
  failure information.
- Logs are fetched on demand using the selected Workspace and Operation context.
  Changing selection cancels or ignores stale log reads.
- Cancellation uses the same Product Command as the Topbar; both surfaces update
  from the shared projection rather than assuming success from the command
  response.
- A retained refresh-failed Session shows its error and a Retry Snapshot action.
  The action is disabled during retry and reports the authoritative outcome.
- Project Comparison keeps active execution visually separate from committed
  comparison facts. Running progress never changes a committed QoR score,
  recommendation, or Signoff result.
- Project Management reads do not open new Runtime Sessions. Only explicit Open
  Workspace, log inspection requiring a retained handle, cancellation, or
  snapshot retry may address a Runtime Session.

### Delivery slices

1. Electron projection: add the typed Operation snapshot/invalidation interface,
   canonical Session reuse, Electron-owned finalization, and failure recovery.
2. Renderer projection: add the App-lifetime store, migrate the path-based Flow
   flag to a derived compatibility signal, and preserve per-Workspace committed
   overview caches.
3. Topbar activity: add the task button, active popover, creation composition,
   navigation focus, and cancellation interaction.
4. Project Management detail: consume the same projection for row status,
   focused task inspection, on-demand logs, cancellation, and snapshot retry.
5. Remove superseded per-foreground event clearing and Renderer-owned background
   release polling after all consumers use the new projection.

Each slice must leave the application releasable. No permanent dual source of
truth is accepted after the final migration slice.

## Testing Decisions

- Tests assert observable lifecycle and UI behavior through the highest existing
  seam. They do not assert private map contents, timer implementation, or helper
  call order unless ordering is itself the contract.
- Electron Runtime projection tests use the existing fake sidecar and Runtime
  host seam. Verify concurrent Operations in two Workspaces, one-Operation-per-
  Workspace enforcement, canonical Session reuse, cancellation acceptance versus
  terminal outcome, and renderer-window handle ownership.
- Electron tests deliver duplicate, delayed, out-of-order, and skipped Runtime
  Events. Verify generation monotonicity and that a fresh projection query repairs
  every case without event replay.
- Electron finalization tests verify terminal state, final committed snapshot,
  and only then Session release. A failed snapshot must retain the Session;
  retry success must release it when otherwise unreferenced.
- Renderer store tests use a fake desktop bridge with controlled snapshots and
  invalidations. Verify startup races, stale-generation rejection, Runtime
  instance replacement, Workspace isolation, and bounded retention.
- Renderer lifecycle tests navigate across Workspace, Project Management, and
  unrelated application routes. Verify the global subscription and active
  Operation entries remain intact until window destruction.
- Workspace projection tests switch A to B to A. Verify A's committed overview
  and Operation ID render immediately on return while only uncached local detail
  may enter loading.
- Topbar component tests cover hidden/empty state, active count, multiple task
  rows, pending creation, long labels, keyboard navigation, reduced motion,
  explicit foreground opening, and cancellation confirmation.
- Project Management tests cover per-row Operation matching, focus navigation,
  multiple running Workspaces, revision mismatch, on-demand log loading, stale
  read isolation, cancellation, and snapshot retry.
- Cross-surface tests feed one projection fixture to Topbar and Project
  Management and assert that Workspace, Step, state, and cancellation status
  agree.
- The main regression runs Flow A, navigates to Project Management, creates or
  opens Workspace B, and returns to A before Flow A completes. Assert that A's
  original Operation ID, current Step, committed overview, and Runtime Session
  survive throughout.
- A second regression misses A's terminal Runtime Event while A is backgrounded.
  Assert that projection refresh discovers the terminal outcome, final snapshot
  completes, the notification is emitted once, and the Session is released.
- Existing Runtime host, Product Command, Project Execution Overlay, Workspace
  session, Topbar, and Project Management tests are the prior art. Extend those
  seams instead of creating a new end-to-end harness per route.
- Use fake timers only where elapsed-time display or retry timing is itself under
  test. Async lifecycle tests use controlled promises and observable state.
- Run focused tests while implementing each slice, then the complete GUI check
  before considering the specification implemented.

## Out of Scope

- A scheduler, priority queue, resource allocator, or limit on Operations across
  different Workspaces.
- More than one active Operation in a single Workspace.
- Persistent task history, historical Engineering Snapshots, event sourcing, or
  Runtime Event replay.
- Preloading logs, Artifacts, QoR, reports, images, DEF, GDS, or Step detail for
  every background Workspace.
- A separate Task Center page, Project Management overlay, or second Project
  Comparison implementation.
- Safe application shutdown, the 30-second Force quit path, best-effort
  cancel/flush during forced termination, and unfinished Workspace creation
  recovery. Those require a separate lifecycle specification.
- Reliable cancellation of Workspace creation after submission.
- Changing Workspace creation's candidate-first routing and failure-return
  behavior except where its pending state is presented in the Topbar list.
- Persisting active backend Operations across an application crash or power
  loss. Runtime Adapter restart reconciliation remains governed by the backend
  Runtime architecture specification.
- ECC-FE background execution or convergence of Frontend and Backend Runtime
  contracts.
- A visual redesign of Project Management, the Workspace shell, Notification
  Center, or Topbar unrelated to task status.
- A new database, message queue, state-machine dependency, or generalized job
  framework.

## Further Notes

- This is a background task presentation only in the product sense. Execution is
  already backgrounded in the ECC Runtime Adapter; the new work makes its
  lifecycle globally observable and controllable.
- ADR 0026 remains the ownership source of truth: one Foreground Workspace
  Context may coexist with Runtime Sessions owned by Operations in other
  Workspaces.
- ADR 0031 remains the transition source of truth: creation/opening is
  candidate-first, failed candidates preserve the old Workspace, and ordinary
  navigation never waits for background Runtime release.
- The backend Runtime architecture specification remains authoritative for
  Operation states, Workspace identity and Revision, event fallibility,
  Product Commands, and Engineering Snapshots.
- The Topbar and Project Management must consume the same projection but do not
  need the same presentation density. Topbar optimizes awareness and quick
  action; Project Management optimizes comparison, diagnosis, and control.
