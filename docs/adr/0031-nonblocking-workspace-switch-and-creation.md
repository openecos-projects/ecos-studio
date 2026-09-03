---
status: accepted
---

# Make Workspace Switching and Creation Non-Blocking

While an ECC backend Flow is running, Project Management must be usable. Creating or opening another Workspace must not wait for the running Flow to finish, and a failed transition must not destroy or replace the current Workspace. This decision refines the runtime ownership rule in [ADR 0026](./0026-separate-foreground-workspace-from-runtime-execution.md) into concrete navigation and locking contracts.

This decision applies to backend ECC Workspaces only. ECC-FE keeps its existing synchronous runtime behavior until a separate decision is accepted.

## Decision

### Foreground and routing

- A renderer window projects one Foreground Workspace Context while retaining independent Runtime Sessions for background Workspaces.
- The complete `ProjectsView` remains the canonical Project Management surface. With an active Workspace, it is mounted at `/workspace/projects`; `/projects` remains the standalone entry point when no Workspace is active.
- Direct `/projects` navigation is normalized to `/workspace/projects` when a valid Foreground Workspace Context exists. `/workspace/projects` falls back to `/projects` when no valid Workspace exists.
- Entering Project Management stores the exact previous Workspace route (`path`, query, and params) in in-memory Workspace/App navigation context. Canceling an unsubmitted wizard stays in Project Management. A creation/open failure returns to that exact route only when the user is still in the saved management context; otherwise it reports a notification without overriding the user's later navigation. A missing context falls back to `/workspace/home`.
- Project Management creation reuses the global `App.vue` `NewProjectWizard`. It never routes through `/ecc`.

### Candidate-first transitions

- Creating or opening a target Workspace is candidate-first: resolve its canonical path, create/open the target Runtime handle, register or validate its manifest, and obtain the minimum overview/session state before committing `currentProject` and navigating to the target Home.
- The previous Foreground Workspace is not closed before the candidate succeeds. If the candidate fails, only resources created by that attempt are cleaned up. Pre-existing directories are never recursively deleted; only newly added manifest registration is rolled back.
- If a target canonical path equals the current Workspace, the request is a no-op or a foreground rebind; it does not close or recreate the Workspace.
- If the target already has a Runtime Session or active Flow, the existing Session is reused. No duplicate Session is created and no transition waits for that Flow.
- A successful candidate switches to `/workspace/home` only while the initiating management context is still active. If the user navigated away during creation, the new Workspace is registered and the current foreground remains unchanged; completion is reported by notification.
- Only one Workspace creation request may be in flight per window. Submission is disabled while it is pending, and a request token prevents late results from changing a newer foreground or route.

### Runtime and lock boundaries

- After a successful foreground switch, the previous Runtime Session is detached from the page and retained as a background Session while it owns an active Operation.
- Background Operations remain visible through the existing lightweight global Operation projection (Workspace identity, current Step, and lifecycle). Explicit log inspection or cancellation uses the original `workspacePath` and `operationId` without reattaching the page; background logs and Artifacts are not preloaded.
- Each Workspace has at most one active Operation. Different Workspaces may run concurrently; there is no global Flow scheduler.
- Runtime events are retained and deduplicated by `workspacePath`, `operationId`, and event sequence. Route unmount/remount and foreground rebind must not clear the event stream or allow late events from an older request to overwrite newer state.
- A background Session is released only after its final Operation reaches a terminal state, the final committed snapshot/projection is captured, and received terminal events are drained. If final snapshot capture fails, the Session stays retained and is reported as stale/refresh-failed until retry succeeds.
- Overall Flow progress and committed Workspace data come from the global Runtime projection and committed snapshot. Artifact and Step detail may keep the last committed value while refreshing, or show a local loading state when no cache exists.

The following lock or queue boundaries remain intentional and are not relaxed:

| Boundary | Required behavior |
| --- | --- |
| Same-directory Runtime mutation lock | Continue serializing mutations that can conflict with a running Flow. |
| Configuration, replacement, and delete guards | Reject destructive writes immediately while the Workspace is active; do not wait for the Flow. |
| Project-root manifest queue | Continue serializing manifest mutations for one project root. |
| Main-process affinity queue | Continue serializing short same-resource focus/affinity operations. |

The waits removed from normal navigation are the implicit `workspace.close` chain in `newProject`, the awaited release of the previous handle in `openProject`, synchronous Workspace disposal triggered by ordinary route changes, and any synchronous snapshot RPC performed solely to switch pages. Explicit application shutdown may still wait for cleanup.

### Failure, cancellation, and shutdown

- A creation/open failure leaves the old Foreground Workspace, its Flow projection, and its Runtime Session unchanged.
- Canceling before submission only closes the form and leaves Project Management open. After submission, the wizard cannot be canceled because reliable transaction abort is unavailable.
- If the user leaves Project Management while a request is pending, the wizard collapses to a Topbar pending Tip. It does not force a later route change.
- The pending Tip states that creation is in progress and duplicate submission is disabled. It disappears on success or failure; failures use an explicit error notification.
- Closing the application or window while a Flow or creation is in flight shows a native prompt with the affected Workspace names, Flow Step progress, and pending creation count. The safe action keeps the window open and waits for completion and final snapshot cleanup. No force-terminate action is shown initially.
- After 30 seconds of waiting, a `Force quit` action may appear with an explicit warning that unsynchronized local details or runtime logs may be lost. Force quit first performs best-effort Operation cancel/IPC flush for a short fixed window, then terminates without waiting indefinitely.
- If a pending creation cannot confirm its result during force quit, it is recorded as unfinished. Its directory is not automatically deleted. On the next start it is shown as `unfinished creation` with `continue initialization` and `abandon registration`; abandoning removes only the newly added manifest entry and never deletes pre-existing files.

## Lock inventory for implementation

1. `newProject` closes the current Workspace before creating the candidate. Replace with candidate-first creation and deferred detach.
2. `openProject` awaits release of the previous handle before returning. Make release background-only for navigation.
3. Leaving `/workspace` currently disposes the session synchronously. Restrict that behavior to explicit close/destroy, not child-route or foreground replacement.
4. Switching performs a synchronous current-Workspace snapshot. Use the existing projection for navigation and move final snapshot capture to the background terminal path.
5. Keep same-directory mutation lock, destructive-write guards, manifest queue, and affinity queue unchanged.

## Acceptance criteria

- A Flow running in Workspace A does not block creating or opening Workspace B, and B becomes usable before A reaches terminal state.
- A failed create/open returns to the exact pre-management Workspace route when the user remains in that context; A's Flow progress and committed data remain available.
- Switching back to A while its Flow is active rebinds the existing Session and preserves the original `operationId` and progress.
- Two different Workspaces can run Operations concurrently, while same-Workspace destructive writes are rejected without waiting.
- Local Artifact/Step detail may briefly load, but overall Flow progress and committed Workspace data never disappear during route transitions.
- Late or duplicate runtime events cannot overwrite a newer Workspace request.
- Shutdown prompts, the 30-second force-quit fallback, and unfinished-creation recovery follow the rules above.

Implementation status (2026-09-03): decision accepted; code and regression tests are pending.
