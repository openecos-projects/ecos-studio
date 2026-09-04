# Safe Shutdown, Force Quit, and Unfinished Creation Recovery Specification

Status: implemented (2026-09-04)

This specification details the safe application/window shutdown behavior,
30-second Force quit fallback, and unfinished Workspace creation recovery
required by ADR 0031. It depends on the global background Operation projection
specified separately. It applies to backend ECC Workspaces; ECC-FE lifecycle
behavior remains unchanged.

## Problem Statement

ECOS Studio may own several backend Runtime Sessions and Workspace Operations
even though one renderer window displays only one Foreground Workspace Context.
Closing a window or quitting the application while those Operations, final
snapshots, or Workspace creations are active can therefore lose the user's last
observable progress, terminate EDA tools at an unsafe point, or leave a
partially registered Workspace.

The current close path divides responsibility between a Renderer confirmation,
current-Workspace cleanup, native window confirmation, and an Electron Runtime
quit guard. The Renderer does not own all background Runtime Sessions, while the
Electron guard does not present an aggregate user decision or track Workspace
creation. A deferred Runtime shutdown may keep the process alive without giving
the user a clear explanation or a bounded escape path.

Workspace creation introduces a separate data-safety problem. The target
directory, Runtime Workspace, Project manifest registration, recent Workspace
entry, and foreground activation do not become durable at the same instant. If
the application is forced to terminate between those stages, automatically
deleting the target directory could destroy user files, while automatically
assuming success could leave Project Management inconsistent.

Users need a safe default that waits for authoritative terminal outcomes and
final snapshots, plus an explicit Force quit path for a genuinely stuck Runtime.
If creation cannot be confirmed, the next application start must expose a
non-destructive recovery choice instead of hiding or deleting the partial state.

## Solution

Introduce one Electron-owned Shutdown Coordinator as the single interface for
window close and application quit. It gathers blockers from the global backend
Operation projection, Runtime finalization state, Workspace creation registry,
and Renderer cleanup handshake. It owns the shutdown state machine, native
prompts, 30-second deadline, best-effort force sequence, and final close
approval.

When there is no active work, shutdown follows the normal Renderer cleanup and
native close path. When work exists, Electron shows a native prompt listing the
affected Workspaces, current Steps, finalization failures, and pending creation
targets. The default safe action keeps the window open, prevents new mutations,
and waits for Operations, creations, and final snapshots to complete. Once all
blockers clear and Renderer cleanup succeeds, the close resumes automatically.

If blockers remain 30 seconds after safe waiting begins, Electron shows a second
native prompt. Force quit is available there but is never the default action.
Its warning states that unsynchronized local details or Runtime logs may be
lost. Force quit first persists unresolved creation journals, requests
cancellation for eligible Operations, drains accepted main-process work and log
writes for up to three seconds, then terminates remaining backend sidecars and
allows the requested close.

Workspace creation uses an Electron-owned, atomically written Creation Journal.
The journal records the target, whether it existed before the attempt, Project
registration ownership, sanitized creation intent, and the latest confirmed
stage. Normal completion removes the journal. An unconfirmed outcome remains as
an unfinished creation and is presented on the next start with two actions:
Continue Initialization or Abandon Registration. Neither recovery action
recursively deletes the Workspace directory.

## User Stories

1. As a chip designer, I want ECOS Studio to warn me before closing with active work, so that I do not terminate a long Flow accidentally.
2. As a chip designer, I want the close prompt to list every affected Workspace, so that I understand the full shutdown impact.
3. As a chip designer, I want each running Workspace to show its current Step, so that I can judge whether waiting is reasonable.
4. As a chip designer, I want queued, running, cancelling, and finalizing states distinguished, so that the shutdown delay is understandable.
5. As a chip designer, I want pending Workspace creation targets listed separately, so that creation is not confused with Flow execution.
6. As a chip designer, I want final snapshot failures identified, so that I know why completed execution still blocks safe close.
7. As a chip designer, I want the initial prompt to recommend safe waiting, so that data preservation is the normal path.
8. As a chip designer, I want Cancel to keep the application fully open, so that an accidental close gesture has no side effects.
9. As a chip designer, I want safe waiting to leave the window visible, so that I can monitor remaining work.
10. As a chip designer, I want the Topbar to explain that ECOS Studio is waiting to close safely, so that the open window does not look unresponsive.
11. As a chip designer, I want to cancel a pending shutdown, so that I can resume normal work if I change my mind.
12. As a chip designer, I want normal navigation and read-only inspection available while waiting, so that I can inspect progress and logs.
13. As a chip designer, I want new Runs, creates, updates, replacements, and deletes rejected during shutdown draining, so that new work cannot extend or race the close.
14. As a chip designer, I want the application to close automatically when all safe cleanup completes, so that I do not have to repeat the close action.
15. As a chip designer, I want successful and failed Flow outcomes both treated as terminal, so that safe shutdown waits for durability rather than engineering success.
16. As a chip designer, I want final committed snapshots captured before Runtime release, so that completed progress remains available next time.
17. As a chip designer, I want a snapshot failure to keep the window open, so that I can retry instead of silently losing the Runtime context.
18. As a chip designer, I want Force quit unavailable during the first 30 seconds, so that impatience does not become the default data-loss path.
19. As a chip designer, I want Force quit offered after 30 seconds when work is still blocked, so that a hung Runtime cannot trap the application forever.
20. As a chip designer, I want Keep Waiting to remain the default after the deadline, so that force termination always requires deliberate selection.
21. As a chip designer, I want the Force quit warning to name possible loss of local details and Runtime logs, so that I can make an informed decision.
22. As a chip designer, I want Force quit to request cancellation first, so that safely interruptible EDA work gets one final chance to stop cleanly.
23. As a chip designer, I want cancellation acceptance distinguished from terminal cancellation, so that the application does not overstate what was saved.
24. As a chip designer, I want Force quit to stop waiting after a short fixed deadline, so that it remains an actual escape path.
25. As a chip designer, I want unresolved Workspace creation recorded before forced termination, so that the next start can recover it.
26. As a chip designer, I want partial Workspace directories preserved after Force quit, so that ECOS Studio never deletes files whose ownership is uncertain.
27. As a chip designer, I want unfinished creation shown on the next start, so that partial state is not silently ignored.
28. As a chip designer, I want unfinished creation to show its target directory and Project, so that I can identify the affected attempt.
29. As a chip designer, I want Continue Initialization to validate existing files before doing more work, so that recovery cannot overwrite an unexpected directory.
30. As a chip designer, I want a valid created Workspace registered without rerunning destructive creation, so that recovery completes safely.
31. As a chip designer, I want an incomplete or ambiguous directory reported for manual review, so that automation fails closed.
32. As a chip designer, I want Abandon Registration to leave Workspace files untouched, so that abandoning ECOS metadata cannot destroy design data.
33. As a chip designer, I want Abandon Registration to remove only the manifest entry introduced by that attempt, so that other Workspaces remain registered.
34. As a chip designer, I want recovery to detect when the Project manifest changed later, so that it does not remove another user's registration.
35. As a chip designer, I want a failed recovery action to retain the unfinished record, so that I can retry after fixing permissions or storage.
36. As a chip designer, I want an unambiguously completed creation reconciled automatically, so that a stale journal does not create unnecessary work.
37. As a chip designer, I want corrupt recovery metadata reported without deleting anything, so that journal damage does not become Workspace damage.
38. As a chip designer, I want repeated close clicks to reuse one shutdown attempt, so that duplicate prompts and cleanup calls cannot race.
39. As a chip designer, I want closing one window to consider work owned by that window, so that unrelated windows remain usable.
40. As a chip designer, I want quitting the application to consider work from all windows and Runtime Sessions, so that application exit is globally safe.
41. As a chip designer, I want closing the last window to follow application-quit semantics, so that background Runtime processes are not orphaned.
42. As an ECOS maintainer, I want Electron to own the shutdown decision, so that a foreground Renderer cannot overlook background Sessions.
43. As an ECOS maintainer, I want one shutdown state machine, so that window close, application quit, menu quit, and repeated requests follow identical rules.
44. As an ECOS maintainer, I want shutdown blockers queried from authoritative projections, so that missing Runtime Events cannot allow an unsafe close.
45. As an ECOS maintainer, I want creation recovery journal writes atomic and versioned, so that process termination cannot produce silently trusted partial metadata.
46. As an ECOS maintainer, I want force termination bounded and testable with an injected clock, so that timeout behavior is deterministic.
47. As an ECC-FE maintainer, I want Frontend Runtime behavior unchanged, so that backend safe shutdown does not alter an independent lifecycle contract.

## Implementation Decisions

### Ownership and module seam

- Deepen the existing Electron Runtime quit guard into one Shutdown Coordinator.
  Do not add parallel close policy in the Renderer, window module, or individual
  Workspace composables.
- The coordinator's interface covers request close, cancel shutdown, inspect
  current shutdown status, subscribe to status changes, and approve the final
  native close. Callers do not orchestrate Runtime shutdown steps themselves.
- Electron main owns the coordinator because it can observe all Runtime
  Sessions, renderer windows, Product Commands, final snapshot tasks, creation
  journals, and native application lifecycle events.
- The Renderer owns presentation of the non-modal waiting state and flushing its
  own UI-only state. It does not determine whether backend work is terminal or
  whether a sidecar can be killed.
- The native dialog is an adapter at the coordinator seam. Tests use an in-memory
  adapter; production uses the existing Electron message-box capability.
- Time is injected into the coordinator internally so the 30-second eligibility
  and three-second force deadline are deterministic in tests. No timing control
  is exposed to ordinary Renderer callers.

### Shutdown state machine

- One shutdown attempt has the states idle, prompting, draining,
  force-eligible, forcing, approved, or cancelled.
- Only one attempt may be active for one close scope. Repeated close requests
  focus or reopen the existing status instead of starting another timer or
  cleanup sequence.
- A close scope is either one renderer window or the whole application. A window
  scope includes backend handles and creations owned by that window. An
  application scope includes every window, backend Runtime Session, creation,
  and finalization task.
- Closing the last application window is treated as application scope.
- The coordinator takes an authoritative blocker snapshot before prompting. It
  takes another snapshot before final approval; an event or stale Renderer view
  can never be the sole reason a close is allowed.
- With no blockers, the coordinator requests Renderer cleanup, then approves the
  native close when cleanup succeeds.
- With blockers, the coordinator enters prompting and shows the initial native
  dialog. No Runtime cancellation or Workspace cleanup occurs merely because the
  dialog opened.
- Choosing Cancel moves the attempt to cancelled and restores normal command
  admission. No shutdown timer remains active.
- Choosing Wait and Close Safely moves the attempt to draining, records the
  monotonic start time, and closes the native dialog while leaving the
  application window visible.
- During draining, the coordinator reevaluates on authoritative Operation,
  creation, finalization, and Renderer-cleanup changes. High-frequency log
  events do not trigger redundant shutdown attempts.
- When all blockers clear, Renderer cleanup runs exactly once for the attempt.
  Successful cleanup moves the attempt to approved and resumes the original
  native close or application quit.
- Renderer cleanup failure remains a blocker with a retryable diagnostic. Safe
  shutdown never treats a cleanup exception as permission to close.
- Cancelling a draining attempt restores normal command admission but does not
  restart, cancel, or otherwise change Operations that were already running.

### Shutdown blocker model

- The blocker snapshot is derived from the Electron Operation projection,
  Runtime finalization state, Workspace creation registry, unresolved creation
  journal writes, and Renderer cleanup state.
- An Operation blocks safe close while queued, running, or cancellation is
  requested but no terminal state has been committed.
- A terminal Operation continues to block while its final committed snapshot is
  pending or failed.
- A Workspace creation blocks while its Product Command result, candidate
  registration, or transaction journal outcome is unconfirmed.
- Each blocker includes a stable kind, owning window when applicable, Workspace
  identity or target directory, current Step/state when applicable, start/update
  time, and bounded diagnostic text.
- Display names are presentation data. Stable Workspace identity, canonical
  directory, Operation ID, command ID, and creation ID remain the coordination
  identities.
- Prompt details show a bounded number of blockers and summarize any remaining
  count. Large logs, stack traces, Workspace specifications, and Artifact data
  never enter the prompt model.
- The existing global background task surface consumes the same blocker and
  Operation projections. It does not maintain a competing shutdown truth.

### Initial native prompt

- The initial title is “Work is still in progress”. The message asks whether to
  wait for ECOS Studio to close safely.
- Detail text groups active Flows, finalizing Workspaces, snapshot failures, and
  pending Workspace creations. Flow entries include Workspace and current Step.
- Buttons are Wait and Close Safely and Cancel. Wait and Close Safely is the
  default action; Cancel is the escape action.
- Force quit is not present in the initial prompt.
- Closing the prompt through the window manager is equivalent to Cancel.
- The prompt is parented to the requesting window for window scope. Application
  scope uses the active window when one exists.
- Prompt behavior is native and keyboard accessible. Critical meaning is carried
  by text, not color, animation, or iconography.

### Safe draining experience

- While draining, the Topbar activity surface displays “Waiting to close safely”
  with aggregate counts for active Flows, finalizations, and creations.
- The waiting status provides Cancel Shutdown and View Tasks. View Tasks opens
  Project Management focused on affected Workspaces without changing the
  Foreground Workspace implicitly.
- Read-only navigation, Project Comparison, status inspection, and bounded log
  reads remain available while draining.
- Electron rejects new backend Run, Rerun, Create, Update, Reset, replacement,
  delete, and other mutating Product Commands for the draining scope using a
  stable shutdown-in-progress error code.
- Renderer buttons reflect the draining state, but Electron admission control is
  authoritative if the Renderer is stale or compromised.
- Safe draining does not automatically cancel an Operation. It allows the
  Runtime Adapter and ECC to reach their normal terminal and snapshot boundaries.
- A normal Operation failure does not cancel shutdown. Safe draining continues
  through final snapshot capture, reports the failure notification, and closes
  when durability is confirmed.
- A final snapshot failure keeps draining active and exposes Retry Snapshot in
  Project Management. Successful retry may clear the final blocker.

### Thirty-second Force quit eligibility

- Force eligibility begins exactly 30 seconds after entering draining, measured
  with a monotonic clock. Time spent reading the initial prompt does not count.
- If every blocker clears before the deadline, no force prompt appears.
- If blockers remain at the deadline, Electron shows one second native prompt
  titled “ECOS Studio is still waiting”.
- The message states that Force quit may leave local Workspace details or
  Runtime logs unsynchronized and that unfinished creation will require recovery
  next time.
- Buttons are Keep Waiting, Cancel Shutdown, and Force Quit. Keep Waiting is the
  default. Force Quit is never focused by default and cannot be triggered by the
  Escape key.
- Choosing Keep Waiting retains force-eligible state without repeatedly showing
  the dialog. The Topbar status exposes Review Shutdown Options, and another
  close request reopens the force-eligible prompt immediately.
- Choosing Cancel Shutdown cancels the attempt and resets force eligibility. A
  later close request starts a new 30-second safe-wait interval.
- Choosing Force Quit begins the bounded force sequence. It cannot be undone
  after sidecar termination begins.

### Force quit sequence

- The coordinator first freezes new mutation admission and captures a final
  authoritative blocker snapshot.
- Before terminating any process, every unresolved Workspace creation has its
  latest known stage durably written as unfinished. Failure to persist a required
  creation journal prevents automatic continuation of Force quit and reports a
  critical error; the user may explicitly retry Force quit after resolving it.
- Cancellation requests are issued concurrently for Operations whose Runtime
  contract permits cancellation. Deferred or forbidden Operations are recorded
  in the force result but do not extend the hard deadline indefinitely.
- Cancellation acceptance is recorded, but the coordinator does not claim a
  cancelled terminal outcome unless the Runtime reports it.
- The coordinator awaits already accepted main-process commands, creation
  journal writes, pending terminal notifications, and application log-buffer
  flushes for at most three seconds total.
- The three-second period is one global deadline, not three seconds per Runtime,
  Operation, or window.
- At the deadline, remaining backend sidecars are force-terminated through the
  existing process supervisor. Renderer code does not receive raw process-kill
  capability.
- Best-effort failure is logged with Workspace and Operation identity. Force quit
  continues after the journal safety prerequisite has succeeded.
- Native close approval occurs once. Reentrant before-quit and window-close
  events observe the approved state and cannot restart coordination.
- Force quit does not recursively delete Workspace directories, replacement
  backups, logs, or user inputs.

### Workspace Creation Journal

- Reuse the existing atomic journal-writing pattern, but keep unfinished
  creation records separate from directory replacement journals because their
  ownership and recovery actions differ.
- The Creation Journal is Electron-owned, stored in application data, versioned,
  validated on read, written through temporary-file rename, and bounded to one
  record per in-flight creation command.
- A journal record contains creation ID, Product Command ID, owning window ID,
  canonical target directory when known, whether the target existed before the
  attempt, Project identity/root, intended Project Workspace identity, sanitized
  creation intent required for validation, confirmed engineering Workspace
  identity and Revision when known, manifest-registration ownership evidence,
  stage, timestamps, and schema version.
- The journal never stores log content, Artifact content, credentials, or
  arbitrary Renderer state.
- The journal is created after target authorization/canonicalization and before
  the first durable creation mutation.
- Confirmed stages are monotonic: intent recorded, Workspace created, manifest
  registration introduced, application registration completed, and completed.
- A normal successful create removes the journal only after the Workspace result
  and Project registration are confirmed. Foreground navigation is not required
  for transaction completion.
- A normal failed create removes the journal only after owned registrations are
  rolled back or the failure is known to have made no durable change.
- If outcome or cleanup is uncertain, the journal remains and is marked
  unfinished. The target directory is preserved.
- Existing directories are never classified as disposable merely because a
  creation journal exists. `targetExistedBefore` is evidence for recovery, not
  permission for recursive deletion.
- Manifest ownership evidence records enough before/after identity to prove that
  one registration was introduced by this creation. Recovery refuses removal if
  the current manifest entry no longer matches that evidence.
- Invalid paths, paths outside the authorized Project root, schema mismatches,
  and corrupt records fail closed. They are reported for manual recovery and do
  not trigger filesystem or manifest mutation.

### Startup recovery

- Electron loads and validates Creation Journals before automatic Workspace
  cleanup or recent-Workspace restoration.
- An unambiguously completed Workspace and matching manifest registration may be
  reconciled and have its stale journal removed automatically. The user receives
  one recovered-completion notification.
- Every ambiguous or incomplete record becomes an unfinished creation attention
  item exposed through the global task projection.
- The application opens normally; recovery does not force a blocking startup
  wizard. The Topbar shows an attention count and Project Management contains the
  detailed recovery surface.
- Each recovery item shows target directory, Project, last confirmed stage,
  last-updated time, and validation issue when present.
- Continue Initialization first reauthorizes and inspects the target directory.
  It never reruns destructive creation merely because a journal exists.
- If a complete, valid Workspace already exists, Continue Initialization opens
  or validates it, completes only missing Project/application registration, and
  clears the journal after confirmation.
- If no target exists and the journal proves that no durable create began,
  Continue Initialization may resubmit the original sanitized creation intent
  using the original Product Command ID.
- If a target exists but is incomplete, unrecognized, or conflicts with the
  journal identity, automatic continuation stops and reports manual-recovery
  guidance. It does not overwrite, replace, or delete the directory.
- Abandon Registration requires explicit confirmation stating that files will
  remain on disk.
- Abandon removes only a manifest registration that the journal proves was
  introduced by that creation and that still matches the recorded Workspace
  identity/path. It then clears application registration and the journal.
- If ownership cannot be proved, Abandon leaves both manifest and journal intact
  and reports the conflict. The user may repair the Project manifest manually.
- Recovery actions are serialized per creation ID and Project root. Duplicate
  clicks or multiple windows cannot execute the same recovery concurrently.
- Successful recovery refreshes Project Management and the global task surface
  without forcing a Foreground Workspace switch.

### Renderer close handshake

- Replace Renderer-owned confirmation with a typed Electron shutdown-status and
  cleanup handshake. Browser `window.confirm` is not used for backend lifecycle
  decisions.
- Electron requests Renderer cleanup only after safe backend blockers clear, or
  during the bounded Force quit sequence.
- Renderer cleanup covers UI-owned state such as pending settings writes,
  editor/session disposal, and final local presentation state. It does not close
  background Runtime Sessions directly.
- The Renderer acknowledges success or returns a bounded diagnostic. The
  coordinator ignores stale acknowledgements from an older shutdown attempt.
- A renderer crash or missing acknowledgement remains a safe-close blocker. It
  may be bypassed only by the explicit Force quit sequence after eligibility.
- Window-close approval remains a one-shot native capability. Renderer code
  cannot approve a different window's close.

### Multi-window behavior

- Runtime handles, creation records, cleanup requests, and window-close attempts
  retain their owning renderer-window identity.
- Closing one non-final window drains only work owned by that window. Other
  windows and their commands remain active.
- Application quit enters one global draining attempt, rejects new backend
  mutations in every window, and aggregates all blockers into one prompt.
- If a window disappears unexpectedly, its unresolved creations remain journaled
  and its Runtime Sessions continue under Electron ownership until terminal
  finalization or application shutdown.
- Concurrent window-close and application-quit requests collapse into the
  broader application scope. They do not run two force timers.

### Delivery slices

1. Shutdown Coordinator foundation: aggregate blocker snapshots, unify window
   close/application quit, add the initial native prompt, and preserve current
   no-blocker close behavior.
2. Safe drain: add mutation admission control, non-modal Renderer status,
   automatic close after Operations/final snapshots, Renderer cleanup handshake,
   and cancel-shutdown behavior.
3. Creation durability: add the Creation Journal and main-process in-flight
   creation registry, then integrate normal create completion/failure cleanup.
4. Force eligibility: add the monotonic 30-second deadline, second native prompt,
   and three-second best-effort cancellation/flush/termination sequence.
5. Startup recovery: add journal reconciliation, global attention items, Project
   Management recovery details, Continue Initialization, and Abandon
   Registration.
6. Remove the superseded Renderer confirmation and any duplicated close/runtime
   release policy after the coordinator owns every close entry point.

The global background Operation projection should be completed before slice 2,
so safe draining and task presentation read one authoritative lifecycle model.

## Testing Decisions

- The primary test seam is the Shutdown Coordinator interface with in-memory
  Runtime, creation registry, Renderer cleanup, native dialog, process
  supervisor, and clock adapters. Tests assert state and externally visible
  effects rather than private flags.
- Existing Runtime quit-guard tests are prior art for before-quit interception,
  deferred Runtime shutdown, and event-driven retry. Replace or deepen those
  tests instead of layering a second guard suite around the old behavior.
- Existing native window-close tests are prior art for one-shot close approval.
  Verify that repeated close requests create one shutdown attempt and one final
  approval.
- Existing Workspace replacement journal tests are prior art for atomic writes,
  schema validation, path containment, restart recovery, and real temporary
  directories. Creation recovery tests use the same filesystem rigor while
  keeping the journal schemas independent.
- Coordinator tests cover no blockers, one active Flow, multiple Workspaces,
  pending creation, final snapshot work, snapshot failure, Renderer cleanup
  failure, cancellation of shutdown, and application-wide aggregation.
- Prompt tests assert grouped Workspace/Step/create content, bounded overflow
  counts, default/cancel button choices, and absence of Force quit in the first
  dialog.
- Fake-clock tests assert no force prompt at 29,999 milliseconds, eligibility at
  30,000 milliseconds, no prompt after blockers clear, and immediate options on
  a repeated close while already force-eligible.
- Force-sequence tests cover cancellable, deferred, and forbidden Operations;
  cancellation rejection; sidecar termination; one shared three-second deadline;
  journal-write failure; log-flush failure; and final one-shot close approval.
- Force tests assert that required creation journal persistence happens before
  any process termination.
- Product Command tests verify that mutating commands are rejected with the
  stable shutdown-in-progress code during the appropriate window or application
  drain, while read-only queries remain available.
- Creation Journal tests simulate interruption after every confirmed stage.
  Restart must classify each record deterministically without deleting the
  target directory.
- Continue Initialization tests cover missing target, valid complete Workspace,
  incomplete directory, identity mismatch, permission failure, stale Project
  manifest, idempotent retry, and successful registration completion.
- Abandon Registration tests prove exact-entry removal when ownership matches,
  refusal when the manifest changed, preservation of pre-existing entries, and
  preservation of every file and directory.
- Corrupt-journal tests cover malformed JSON, unknown schema version, relative
  paths, escaped Project paths, missing fields, and impossible stage transitions.
  Every case fails closed without filesystem mutation.
- Renderer tests cover waiting status, blocker counts, View Tasks, Cancel
  Shutdown, disabled mutation controls, stale cleanup acknowledgement, and
  recovery attention items.
- Multi-window tests close a non-final window with owned work, close an idle
  sibling, then request application quit. Verify scope isolation and escalation
  to one application-wide attempt.
- Integration regression: run Flow A, start creating Workspace B, request
  application quit, choose safe wait, complete both, capture final snapshots,
  acknowledge Renderer cleanup, and verify automatic process exit.
- Force regression: leave Flow A and creation B unresolved for 30 seconds,
  choose Force Quit, verify creation B is journaled before cancel/kill, restart,
  and verify B is presented as unfinished with both recovery actions.
- Run focused coordinator, Runtime, journal, Product Command, window, preload,
  and Renderer tests for each slice, then the complete GUI check before treating
  this specification as implemented.
- Production packaging or smoke validation is required only if implementation
  changes preload exposure, startup ordering, native-window wiring, or packaged
  sidecar termination behavior, following the repository validation rules.

## Out of Scope

- Changing backend Flow execution, Step success criteria, Engineering Snapshot
  content, or EDA tool supervision.
- A global scheduler, automatic priority system, or concurrent Operations within
  one Workspace.
- Persistent Operation history, Runtime Event replay, or historical Engineering
  Snapshot queries.
- Guaranteeing graceful recovery from operating-system kill, power loss, kernel
  panic, filesystem corruption, or hardware failure beyond already durable
  journals and Workspace commits.
- Automatically resuming an interrupted Flow after application restart.
- Reliable mid-command cancellation of Workspace creation.
- Automatic recursive deletion of an unfinished, abandoned, or conflicting
  Workspace directory.
- Automatically rewriting a Project manifest when recovery ownership cannot be
  proven.
- A dynamic native dialog that continuously updates progress. Live progress
  remains in the Topbar and Project Management; the second native prompt is
  shown once at force eligibility.
- Redesigning the global background task list or Project Management beyond the
  shutdown and unfinished-creation states needed here.
- ECC-FE background Runtime concurrency, cancellation, or shutdown-contract
  changes.
- Remote/distributed Runtime shutdown, cloud job cancellation, or coordination
  between separate ECOS Studio application instances.
- A new database, message queue, generic workflow engine, or generalized
  transaction framework.

## Further Notes

- “Force quit” is intentionally destructive wording. It must not be renamed to
  a reassuring phrase that hides the possibility of unsynchronized details or
  logs.
- The safe path waits for durability, not success. A failed or cancelled Flow
  may close safely after its terminal state and final committed snapshot are
  confirmed.
- The three-second force window is a best-effort coordination deadline, not a
  promise that every EDA subprocess can stop cleanly in that time.
- Creation Journal ownership is narrower than directory ownership. The journal
  may authorize cleanup of an exact manifest registration, but never authorizes
  recursive deletion of the target directory.
- ADR 0026 remains authoritative for background Runtime ownership. ADR 0031
  remains authoritative for shutdown warning, 30-second Force quit eligibility,
  and non-destructive unfinished creation recovery.
- The background Operation and task-surface specification supplies the global
  Operation projection used for blocker status, Topbar waiting presentation, and
  Project Management focus.
