# Non-Blocking Workspace Switching and Creation Specification

This specification turns [ADR 0031](../adr/0031-nonblocking-workspace-switch-and-creation.md) into user-visible behavior and implementation contracts for backend ECC Workspaces. It does not change the accepted separation between a Foreground Workspace Context and a Workspace Runtime Session.

## Problem Statement

When a backend Flow is running in Workspace A, opening Project Management and creating or opening another Workspace can remain on the ECC view until the Flow finishes. The visible delay is caused by the foreground transition waiting for the old Workspace Runtime Session to close. The current create path also closes the existing Workspace before the candidate has been created, so a failed create can replace or lose the user's previous Workspace context.

The same hidden wait can occur through other Workspace switching paths: opening an existing Workspace, leaving the Workspace route, synchronously reading a snapshot only to navigate, or releasing the previous runtime handle before returning from the transition. Fixing only the Topbar create button would leave these sibling paths inconsistent.

The product already has the domain concepts required to solve this: a Foreground Workspace Context, independent Workspace Runtime Sessions, Operations with terminal lifecycles, committed snapshots, Project Management's comparison surface, and Runtime mutation locks. The missing behavior is to keep those lifecycles independent during normal navigation while preserving the locks that protect same-directory data.

## Solution

Make Workspace creation, opening, and foreground switching candidate-first and non-blocking across backend ECC surfaces. Project Management remains the complete comparison and management view, mounted under the Workspace shell when a Foreground Workspace Context exists. Creation reuses the global New Workspace Wizard and does not navigate through ECCView.

The previous Workspace is detached from the foreground projection only after the target is ready, then retained as a background Runtime Session while it owns an active Operation. Flow progress and committed Workspace data remain available through global projections and committed snapshots. Same-directory mutation locks and destructive-write guards remain strict. A failed target transition leaves the previous Workspace and route intact.

## User Stories

1. As a backend chip designer, I want Project Management to open immediately while a Flow runs, so that I can compare Workspaces without waiting for execution to finish.
2. As a backend chip designer, I want to create Workspace B while Workspace A is running, so that a long Flow does not block planning the next implementation scheme.
3. As a backend chip designer, I want Workspace B to be prepared before it replaces Workspace A, so that a failed create cannot destroy my working context.
4. As a backend chip designer, I want the old Workspace to remain visible when creation fails, so that I can continue the Flow and inspect its progress.
5. As a backend chip designer, I want an open-existing-Workspace failure to preserve the old Workspace too, so that all switching entries have the same failure behavior.
6. As a backend chip designer, I want a failed transition to return me to the exact route I used before Project Management, including query and parameters, so that I do not lose the Step or detail view I was using.
7. As a backend chip designer, I want canceling an unsubmitted New Workspace form to leave me in Project Management, so that I can continue comparing Workspaces.
8. As a backend chip designer, I want a submitted create form to prevent duplicate submission, so that one user action cannot create multiple Workspaces or race the foreground state.
9. As a backend chip designer, I want a clear Tip while creation is pending, so that I understand why the submit action is disabled and what the application is doing.
10. As a backend chip designer, I want to leave Project Management while a create request is pending, so that the rest of the application remains usable.
11. As a backend chip designer, I want a pending create to continue after I navigate away, so that changing my view does not cancel or corrupt the request.
12. As a backend chip designer, I want a late successful create result not to replace the Workspace I selected after leaving Project Management, so that background work never overrides a later navigation choice.
13. As a backend chip designer, I want a late failure notification not to force a route change after I have navigated elsewhere, so that the application respects my current page.
14. As a backend chip designer, I want a successful create to open the new Workspace Home when I remain in the initiating management context, so that the new Workspace is immediately usable.
15. As a backend chip designer, I want the new Workspace to be registered without changing the foreground when I leave the management context first, so that I can open it deliberately later.
16. As a backend chip designer, I want `/projects` to resolve to the nested Project Management view when a valid Foreground Workspace Context exists, so that entering management does not discard the Workspace shell.
17. As a backend chip designer, I want standalone `/projects` to remain available when no Workspace is active, so that Project Management can still be opened from the application entry surface.
18. As a backend chip designer, I want `/workspace/projects` to fall back safely when no valid Workspace Context exists, so that a stale deep link does not render an unusable Workspace page.
19. As a backend chip designer, I want opening an existing Workspace from any management, recent-project, or Topbar entry to use the same non-blocking transition, so that no alternate path can reintroduce the wait.
20. As a backend chip designer, I want switching to the canonical path I already have open to be a no-op or rebind, so that the application does not close and recreate the same Workspace.
21. As a backend chip designer, I want returning to a Workspace with an active Flow to reuse its Runtime Session, so that the original Operation and progress remain intact.
22. As a backend chip designer, I want a background Flow's Workspace identity, current Step, and lifecycle visible in the existing global Operation projection, so that work continues to be observable after I leave its page.
23. As a backend chip designer, I want to inspect logs or cancel a background Operation by its Workspace and Operation identity, so that I can control execution without reopening the page first.
24. As a backend chip designer, I want different Workspaces to run Operations concurrently, so that switching foreground does not create a global execution bottleneck.
25. As a backend chip designer, I want a Workspace to keep at most one active Operation, so that its own execution remains unambiguous.
26. As a backend chip designer, I want same-Workspace configuration, replacement, and delete operations rejected immediately while a Flow runs, so that data is protected without making the UI wait indefinitely.
27. As a backend chip designer, I want a background Runtime Session released only after the Operation reaches a terminal state and its final committed snapshot is captured, so that no completed progress is lost.
28. As a backend chip designer, I want a failed final snapshot to retain the Runtime Session and expose a stale/refresh-failed state, so that I can retry recovery instead of losing the last runtime context.
29. As a backend chip designer, I want the overall Flow progress and committed Workspace data to remain visible immediately after returning to a Workspace, so that a local page loading state is not mistaken for data loss.
30. As a backend chip designer, I want Artifact and Step detail to retain the last committed value while refreshing, so that short read delays do not blank the page.
31. As a backend chip designer, I want runtime events deduplicated and associated with the correct Workspace and Operation, so that late events from an older request cannot overwrite newer state.
32. As a backend chip designer, I want Project Comparison to keep committed engineering facts separate from a live execution overlay, so that transient Flow progress is not mistaken for a committed result.
33. As a backend chip designer, I want application shutdown to explain which Workspaces, Steps, and creates are still active, so that I understand why the window remains open.
34. As a backend chip designer, I want the safe shutdown action to wait for terminal cleanup and final snapshots, so that closing the app does not silently terminate active work.
35. As a backend chip designer, I want a force-quit option only after a 30-second wait, so that it is available for a hung operation without becoming the normal path.
36. As a backend chip designer, I want force quit to attempt Operation cancellation and IPC flushing first, so that the application makes one last safe effort before terminating.
37. As a backend chip designer, I want force quit to warn about possible unsynchronized local details or logs, so that I can make an informed decision.
38. As a backend chip designer, I want an interrupted create recorded as unfinished rather than automatically deleting its directory, so that user files are not destroyed by shutdown recovery.
39. As a backend chip designer, I want to continue an unfinished create or abandon only its new manifest registration on the next start, so that recovery is explicit and non-destructive.
40. As an ECC maintainer, I want ECC-FE behavior unchanged by this specification, so that the backend concurrency change does not silently alter an independent runtime contract.

## Implementation Decisions

- The full Project Management surface remains one canonical view. It is mounted as a child route under the Workspace shell for an active Workspace and remains a standalone route when no Workspace Context exists. No separate Project Management overlay is introduced.
- Direct route normalization uses the current validity of the Foreground Workspace Context. A saved navigation context contains the exact previous route path, query, and parameters in memory; it is not persisted or encoded into a temporary URL.
- Project Management invokes the existing global New Workspace Wizard owned by the application shell. The create flow does not navigate through ECCView.
- Workspace create and open use candidate-first orchestration. The target canonical path is resolved, target Runtime handle/session work is completed, manifest registration is validated, and minimum overview/session state is available before `currentProject` and the target route are committed.
- The previous Foreground Workspace is never closed before the candidate succeeds. Failure cleanup is limited to resources created by the current attempt. Existing directories are never recursively deleted, and only a manifest registration introduced by the failed attempt may be rolled back.
- A target whose canonical path equals the current Workspace is treated as a no-op or foreground rebind. A target with an existing Runtime Session reuses that Session, including an active Operation.
- Normal navigation detaches the old foreground projection and returns without awaiting Runtime Session release. Explicit application/window destruction may still await cleanup.
- A detached Session remains owned by the main-process Runtime lifecycle while it has an active Operation. It is released after the final Operation terminal state, terminal event drain, and successful final committed snapshot/projection capture.
- If final snapshot capture fails, the Session remains retained and its state is exposed as stale or refresh-failed until recovery succeeds.
- Each Workspace has at most one active Operation. Runtime Sessions for different Workspaces may run concurrently and are not scheduled by a global Flow lock.
- The existing lightweight global Operation projection exposes background Workspace identity, current Step, and lifecycle. Detailed logs or Artifacts are loaded only on explicit inspection; they are not preloaded for every background Workspace. Cancellation addresses the original Workspace and Operation identity.
- Runtime event identity and deduplication use canonical Workspace identity, Operation identity, and event sequence. Route unmount/remount and foreground rebind never clear the global event stream. Request tokens prevent late create/open results from mutating a newer foreground choice.
- Overall Flow progress and committed Workspace data are sourced from the global Runtime projection and committed snapshots. Local Artifact and Step detail keeps its last committed value while refreshing; a local loading state is used only when no cached value exists.
- Project Comparison continues to combine committed Engineering Snapshots with a revision-matched Active Operation overlay. Comparison reads do not create Runtime Sessions.
- Only one Workspace create request may be in flight per renderer window. The submitted form disables duplicate submission and cannot be canceled after submission because reliable transaction abort is unavailable. Before submission, cancel closes the form and leaves Project Management visible.
- If a user leaves Project Management while a request is pending, the global wizard collapses to a Topbar pending Tip. A later success registers the Workspace without changing the current foreground; a later failure reports a notification without forcing a route change. If the initiating management context remains active, success navigates to the new Workspace Home and failure returns to the saved route.
- The pending Tip explains that Workspace creation is in progress and duplicate submission is disabled. It disappears on success or failure; failures use an explicit error notification.
- Same-directory Runtime mutation locks continue to serialize conflicting mutations. Configuration, replacement, and delete guards reject destructive writes immediately while a Flow is active. Project-root manifest queues and main-process affinity queues remain unchanged.
- The transition path does not perform an unbounded snapshot RPC solely to navigate. It uses the existing Workspace projection when available and schedules final snapshot capture with the background terminal lifecycle. If an old projection is not ready, navigation does not wait indefinitely; it marks the data for refresh.
- Application/window close with an active Flow or create shows a native prompt listing affected Workspace names, Flow Step progress, and pending create count. The safe action keeps the window open and waits for terminal cleanup. After 30 seconds, a force-quit action may appear with a warning about unsynchronized local details or runtime logs.
- Force quit first performs best-effort Operation cancellation and IPC flushing for a short fixed window, then terminates without waiting indefinitely. A create whose result cannot be confirmed is recorded as unfinished; its directory is not automatically deleted.
- On the next application start, unfinished creation is visible as an explicit state with `continue initialization` and `abandon registration`. Abandoning removes only the new manifest registration and never deletes pre-existing files.
- The specification applies to backend ECC Workspaces only. ECC-FE remains on its existing synchronous runtime behavior.

## Testing Decisions

- Test external behavior at the highest existing seam: Workspace transition/session orchestration with a fake desktop bridge, fake Runtime Sessions, controlled route state, and ordered runtime events. Avoid asserting that a particular helper was called or that a particular component stayed mounted.
- Use the existing Workspace composable tests as prior art for open/create/close success and failure, delayed runtime responses, candidate handling, and route state. Extend that seam with a Flow-active fixture instead of creating a new end-to-end harness for each route.
- Use the existing Flow runner tests as prior art for Operation lifecycle, terminal outcomes, cancellation, and event ordering. Assert that a background Operation remains observable and retains its identity after foreground navigation.
- Use the existing Project Management component tests as prior art for route entry, comparison data, active Operation overlays, creation intent, pending Tip presentation, and failure notification. Assert that the complete Project Management surface works in both nested and standalone route modes.
- Use existing desktop bridge contract tests as prior art for Workspace handle/session calls, Operation cancellation, snapshot capture, and shutdown prompt transport. Assert that normal navigation does not await release while explicit shutdown does.
- Verify that a Flow in Workspace A does not block creating or opening Workspace B and that B reaches minimum overview readiness before A reaches terminal state.
- Verify candidate-first failure for filesystem creation, manifest registration, target Runtime opening, and minimum overview loading. Assert that A's route, Flow projection, committed data, and Runtime Session remain unchanged and that only newly created candidate resources are cleaned.
- Verify exact saved route restoration with path, query, and parameters, plus the fallback Home route when no saved context exists.
- Verify cancel-before-submit, disabled duplicate submission, request-token protection, pending Tip lifecycle, navigation-away behavior, and no forced late route change.
- Verify successful creation while the management context remains active navigates to the new Workspace Home, while success after navigation-away registers without replacing the foreground.
- Verify all Workspace switching entries use the same non-blocking behavior, including opening an existing Workspace, recent-project selection, comparison selection, and Topbar navigation.
- Verify canonical same-path no-op/rebind and reuse of an existing Session with an active Operation. Confirm that switching back preserves the original `operationId` and progress.
- Verify concurrent Operations in different Workspaces and immediate rejection of same-Workspace destructive writes. Confirm that intentional manifest and affinity queues still serialize their own resources.
- Verify final terminal event drain and snapshot capture before background Session release. Verify that snapshot failure retains the Session and exposes refresh-failed state.
- Verify event deduplication and stale-result isolation using out-of-order and duplicate events from multiple Workspace/Operation pairs.
- Verify overall Flow progress and committed Workspace data render from global projection immediately, while Artifact/Step detail may retain cached data or show local loading.
- Verify Project Comparison does not create a Runtime Session and applies a live overlay only when Workspace identity and revision match the committed Engineering Snapshot.
- Verify shutdown prompt content includes affected Workspaces, current Step progress, and pending create count; safe close waits for cleanup; force quit appears only after 30 seconds and performs best-effort cancel/flush.
- Verify an unconfirmed create is recorded as unfinished, not deleted, and that next-start recovery can continue initialization or abandon only the new manifest registration.
- Keep tests focused on the backend ECC contract. Do not add ECC-FE concurrency expectations until its separate runtime decision is accepted.

## Out of Scope

- Publishing an Issue or applying a triage label. This specification is local documentation only.
- Changing ECC-FE runtime behavior or introducing a shared concurrency model for ECC-FE.
- Removing or weakening same-directory Runtime mutation locks, destructive-write guards, manifest queues, or affinity queues.
- A global Flow scheduler, global mutation lock, or unlimited Operations per Workspace.
- A separate Project Management overlay or a second comparison implementation.
- Preloading background Workspace logs, Artifacts, QoR, or dashboard detail for every active Operation.
- Persisting the complete Runtime event stream or guaranteeing active Flow recovery after application restart, crash, or power loss. The only restart behavior covered here is explicit unfinished-creation recovery.
- Reliable mid-create transaction cancellation after submission.
- Automatic recursive deletion of a target directory during failure or force-quit recovery.
- Replacing Project Management, Workspace, or ECCView with a new product surface unrelated to the transition problem.
- Introducing a new persistence database, global state framework, or generalized session abstraction when the existing Runtime projection and lifecycle seams can carry the behavior.

## Further Notes

- ADR 0031 is the architectural source of truth for the separation between foreground projection and runtime ownership. This specification supplies the user stories, observable contracts, and regression matrix needed to implement it.
- The first implementation slice should remove the implicit close/release waits from normal `newProject` and `openProject` transitions, then add the Flow-active regression fixture before changing secondary UI routes.
- The runtime adapter's same-directory mutation lock is a safety boundary, not the bug being removed. The bug is the renderer treating background Runtime Session release as a prerequisite for foreground navigation.
- A short local Artifact/Step loading state is acceptable only when the global Flow lifecycle and committed Workspace projection remain present. Clearing those projections during route changes is a regression.
- The close prompt and unfinished-create recovery are lifecycle safeguards. They should be implemented after the core transition seam is covered, but their user-visible contracts are part of this specification.
