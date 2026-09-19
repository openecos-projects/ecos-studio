# Agent Interaction Context

This context defines the language for structured user interactions emitted by
the ECOS Agent and rendered by the GUI.

## Language

**Interaction request**:
A structured request emitted when the agent needs a user choice, confirmation,
or form input before continuing. It describes the allowed input and its
presentation semantics; it does not execute the requested operation.
_Avoid_: UI widget, component command, arbitrary model action

**Interaction protocol**:
The versioned contract used to carry interaction requests from the agent to the
GUI and validated replies from the GUI back to the agent.
_Avoid_: formatted answer, generic structured output

**Ask-user capability**:
The bounded agent capability through which the agent requests user input. It
may describe a semantic interaction, but it cannot execute a domain operation
or select an arbitrary UI component.
_Avoid_: model-rendered component, free-form action

**Interaction answer**:
A user response associated with one pending interaction request. The backend
validates and consumes it against that request before changing agent state. A
choice or confirmation may be answered by selecting an option or by submitting
typed text through the same answer channel; forms remain field-validated.
_Avoid_: raw choice value, unscoped user message

**Pending interaction**:
An interaction request that belongs to the current agent session and has not
yet been answered, cancelled, expired, or superseded.
_Avoid_: open prompt, active widget

**Interaction kind**:
The semantic input shape requested by an interaction, such as a choice,
confirmation, or form. It selects presentation and validation rules, not an
execution handler.
_Avoid_: component name, action type

**Execution interaction**:
An interaction whose answer can change an ECOS workspace, flow, or execution
contract. Its schema and allowed values are owned by the backend.
_Avoid_: free-form form, model action

**Clarification interaction**:
A bounded interaction used to collect non-executable user preference or
clarification. The model may propose its copy and options within the capability
limits, but it cannot attach an execution action.
_Avoid_: execution prompt, arbitrary form

**Recoverable interaction**:
A pending interaction retained by the backend session so a GUI reconnect can
reconstruct it. Recovery does not make the interaction answerable after it has
been consumed or superseded.
_Avoid_: frontend-restored prompt, replayed widget

**Interaction snapshot**:
The current session-level representation returned to a reconnecting GUI. It
contains at most the valid pending interaction and enough metadata to render it
again.
_Avoid_: event replay, message history dump

**Current interaction**:
The single pending interaction accepted by a session at a given time. Creating
a newer interaction supersedes the previous one.
_Avoid_: open interaction list, interaction queue

**Interaction answer channel**:
The dedicated transport used to submit an interaction answer with its session
and request identity. It is not the natural-language chat channel.
_Avoid_: choice message, raw agent input

**Interaction option**:
A backend-defined selectable value identified by an option ID. The GUI submits
the ID for card selections; typed answers are sent as text and interpreted by
the backend state machine.
_Avoid_: client-provided value, display label as identity

**Interaction acknowledgement**:
The synchronous result of accepting an interaction answer. It confirms only
request validation and consumption; subsequent agent state arrives through the
agent event stream.
_Avoid_: next message response, rendered result

**Interaction rejection**:
A typed failure to accept an interaction answer. It leaves the agent phase and
pending interaction unchanged unless the request was already terminal.
_Avoid_: chat error, fallback message

**Interaction field**:
A field in a form interaction with one supported semantic kind: text, number,
path, or select. Its constraints are data validated by the backend, not custom
client code.
_Avoid_: arbitrary JSON Schema, form widget implementation

**Atomic form answer**:
An interaction answer that submits and validates all form fields as one unit.
The pending interaction is consumed only when the complete value set is valid.
_Avoid_: field-by-field prompt chain, partial form commit

**Interaction option ID**:
An opaque backend-owned identity for one selectable option within one request.
The GUI displays its label but never interprets or constructs the ID.
_Avoid_: numeric choice index, translated label, execution value

**Interaction purpose**:
The trust category of an interaction: execution input changes ECOS state, while
clarification input only collects non-executable context. It is part of the
request contract and is not inferred from the visual kind.
_Avoid_: UI variant, phase name, component category

**Interaction companion message**:
Normal agent text emitted before an interaction request to explain context or
consequences. It remains visible independently of the interaction surface.
_Avoid_: interaction description as the only answer, hidden model output

**Interaction turn boundary**:
The ordering guarantee that all assistant content for the current turn is
complete before its interaction request becomes renderable. The request blocks
only subsequent generation.
_Avoid_: immediate card emission, partial-context prompt

**Interaction projection**:
The GUI representation of a request, keyed by `requestId` and safely upserted
when live events or recovery snapshots arrive.
_Avoid_: appended prompt, independent frontend copy

**Interaction payload budget**:
The backend-enforced limits on interaction text, options, fields, and serialized
size. A valid interaction must fit the budget before it can reach the GUI.
_Avoid_: frontend-only limit, unbounded model UI

**Interaction contract source**:
The paired Python and TypeScript v1 contracts validated by backend and GUI
tests. The first interaction protocol does not introduce generated schema
artifacts.
_Avoid_: runtime codegen, frontend-only contract

**First interaction protocol phase**:
The initial migration that adds the interaction envelope, dedicated answer
channel, pending-request lifecycle, recovery snapshot, and choice/confirm/form
renderers without replacing the workspace state machine.
_Avoid_: full agent rewrite, generic UI framework

**Display result**:
Agent content that the GUI may render but that does not wait for user input,
such as text, tables, or artifacts. It is outside the first interaction
protocol phase.
_Avoid_: interaction, input request

**Agent activity stream**:
The ordered, typed record of observable work performed during an agent turn,
including reasoning summaries, searches, commands, and tool calls. It excludes
hidden reasoning, final assistant answers, and ECOS Flow execution progress.
_Avoid_: tool text, Thinking timeline, raw reasoning

**Agent activity item**:
One typed unit in an Agent activity stream: a reasoning summary, web search,
command execution, or generic tool call. A stable identity carries the item
through its running and terminal states instead of deriving state from display
text or appending separate start and finish lines.
_Avoid_: progress line, parsed tool string, Flow Step

**Agent activity digest**:
The compact completed-turn representation of an Agent activity stream. It
preserves access to the ordered activity items while yielding visual priority
to the final answer.
_Avoid_: deleted progress, final answer, tool result

**Reasoning summary**:
Codex-provided user-visible text that explains what the Agent is considering
as it works. It is distinct from hidden raw reasoning and from an observable
action the Agent performs.
_Avoid_: Thinking status, chain of thought, tool progress

**Observable action**:
An auditable operation performed during an Agent turn, such as a search,
command execution, or tool call. Its identity, lifecycle, and outcome are
visible independently of any reasoning summary.
_Avoid_: reasoning, generic working state, Flow execution progress

**Quick Start authorization**:
The user's click on Quick Start that authorizes one bounded, predefined workflow to create its required Project and Workspace and start the associated Flow. It applies only to the named workflow and does not authorize arbitrary Agent actions.
_Avoid_: generic confirmation, implicit permission, mouse-click replay

**Quick Start project naming**:
The collision policy for a Project created by Quick Start: an existing matching name is never overwritten or silently reused; the workflow creates a unique derived name and carries that created Project identity into Workspace creation.
_Avoid_: overwrite, implicit reuse, display-name lookup

**Quick Start resource preflight**:
The readiness gate before a Quick Start workflow creates a Project. It requires every named design resource, PDK Installation, and managed MPC resource to be available and usable; a failed gate creates no partial Project.
_Avoid_: install-on-demand, best-effort lookup, cached install status

**Quick Start configuration snapshot**:
The immutable Project, Workspace, resource, and parameter values captured at the moment Quick Start is authorized. Every subsequent workflow step uses this snapshot, even if editable defaults or resource listings change while it runs.
_Avoid_: live defaults, mutable wizard state, late-bound parameters

**Quick Start locale**:
The language used by Quick Start labels, execution summary, preflight results, and activity items, inherited from the application's active locale rather than inferred independently by the model.
_Avoid_: mixed-language run, model-selected locale, untranslated activity

**Quick Start run record**:
The durable record of one authorized Quick Start workflow, including its configuration snapshot, resource identities, derived Project and Workspace identities, and terminal outcome. It supports recovery and audit without persisting the full conversational activity stream.
_Avoid_: chat transcript as audit, ephemeral-only run, display log as record

**Quick Start retry**:
A new attempt against the existing failed Workspace, beginning at the failed Flow Step. Before retry, the user may edit Workspace configuration; the retry freezes and records a new snapshot of those explicit edits while retaining the same Project and Workspace identities.
_Avoid_: whole-workflow duplication, hidden parameter mutation, retry during an active Flow

**Quick Start happy path**:
The primary MVP scope covering a fully preflighted, tested workflow with the prescribed resources and parameters. Failure handling remains the existing generic runtime/error behavior, but Quick Start does not add a separate retry experience until real failures justify it.
_Avoid_: failure-free guarantee, deleted error handling, speculative recovery UI

**Quick Start workflow version**:
The explicit version identity of the predefined workflow plan used for one run. The run record stores it with the configuration snapshot so later changes to the prescribed sequence do not rewrite the meaning of an earlier run.
_Avoid_: unversioned macro, live workflow lookup, retroactive run changes

**Quick Start YAML workflow**:
A versioned declarative plan whose steps name approved ECOS capabilities and data bindings for a design-specific Quick Start. YAML selects and orders bounded operations; it does not grant new filesystem, process, or UI privileges.
_Avoid_: arbitrary script, shell macro, coordinate replay

**Quick Start workflow capability**:
An allowlisted semantic operation exposed to YAML, such as opening a product surface, creating a Project, resolving a Resource Management identity, creating a Workspace, or starting a Flow. A capability owns validation and execution; the YAML step only supplies declared inputs and presentation metadata.
_Avoid_: raw click, arbitrary RPC, UI selector, shell command

**Quick Start workflow binding**:
The named reference that carries a capability result into later steps, such as the created Project ID, Workspace ID, resolved Resource ID, or frozen Flow snapshot. Bindings are typed and workflow-scoped; they are not arbitrary variables or paths.
_Avoid_: global mutable state, stringly-typed handoff, path-as-identity

**Quick Start capability projection**:
The UI metadata attached to an approved capability that maps its lifecycle to a real product surface and localized Activity item. It identifies the target surface and display copy, while the capability implementation owns navigation and state changes.
_Avoid_: selector metadata, hard-coded sentence, animation-only step

**Quick Start schema compatibility**:
The validation contract between a bundled YAML workflow and the ECOS version loading it. A workflow declares its schema version and supported application range; incompatible workflows are rejected before any mutation.
_Avoid_: best-effort parsing, silent field ignore, runtime schema drift

**Dashboard Flow Status**:
The workspace-level view of the configured flow, including every configured step regardless of whether that step has started or produced artifacts.
_Avoid_: executed-step list, current-step subflow

**Step Subflow**:
The execution detail for the currently selected flow step, shown independently from the workspace-level flow status.
_Avoid_: complete flow, dashboard flow

**Flow Topology**:
The ordered set of steps configured for a Workspace, independent of which steps have started, completed, or produced artifacts.
_Avoid_: runtime snapshot steps, executed-step prefix

**Current Execution**:
The latest runtime operation for a Workspace whose events may contribute to recovering the visible execution state.
_Avoid_: historical operation, mixed execution events

**Optimization Episode**:
A bounded Agent-controlled optimization run anchored to one Parent Workspace and one Agent Session. It may contain calibration replays and candidate execution workspaces, and it remains independently observable until terminal.
_Avoid_: current Flow, one candidate run, chat turn

**Parent Workspace**:
The Workspace selected when an Optimization Episode is authorized. It owns the episode's objective and context, but it is not necessarily the Workspace currently shown in the foreground.
_Avoid_: current Workspace, execution workspace, replay workspace

**Optimization Execution Workspace**:
A replay or candidate Workspace used to execute one operation within an Optimization Episode. It is a background execution target and does not become the foreground Workspace merely because its operation is active.
_Avoid_: foreground Workspace, current execution, temporary UI tab

**Agent Session Ownership**:
The stable association between an Optimization Episode and the Agent Session that started it. Workspace navigation and active-tab changes do not transfer that ownership.
_Avoid_: current-tab ownership, route ownership, event arrival ownership

**Optimization Episode Continuity**:
An Optimization Episode continues across Agent tab changes, Workspace navigation, and temporary Agent-panel unmounts. Only an explicit user Stop/Cancel requests episode cancellation; provider or application failure follows interruption and recovery semantics instead.
_Avoid_: UI visibility lifetime, implicit cancellation, completed chat turn

**Optimization Agent Tab Closure**:
Closing an Agent tab with an active Optimization Episode either retains its
Agent Session and keeps the episode running in the background, explicitly stops
the episode before closing, or cancels the close. It never silently deletes the
owning session; retained episodes remain reachable from Background Operations.
_Avoid_: tab close as cancellation, hidden session deletion, orphan episode

**Optimization Episode Projection**:
The compact Agent UI projection of one Optimization Episode. It reuses the
existing Optimization card to show aggregate lifecycle, phase, replay or turn
count, in-flight count, elapsed time, latest outcome and aggregate metrics;
individual Runtime Operations and logs remain in Background Tasks.
_Avoid_: one chat message per workspace, operation browser, foreground Flow projection

**Optimization Episode Notification**:
One Notification Center entry emitted when a background Optimization Episode
transitions to completed, needs attention, interrupted or stopped. It is
deduplicated by Episode identity and state transition and links back to Agent
progress; individual replay and candidate transitions do not notify.
_Avoid_: per-operation toast, operating-system notification, notification as state

**Optimization Projection Authority**:
The composition of Runtime Operation state with persisted optimization ledger/controller state, joined by Execution Workspace and Operation identity in Electron and queried by the Renderer as one recoverable Optimization Episode Projection. Runtime events invalidate this projection but do not replace it.
_Avoid_: chat-text parsing, Renderer episode state machine, events as durable history

**Optimization Projection Identity**:
Episode identity is the stable key of an Optimization Episode Projection. It is
bound to Agent Session, Parent Workspace and Parent Revision; a monotonically
increasing projection generation lets Renderer consumers reject stale complete
snapshots while Electron privately correlates underlying Runtime Operations.
_Avoid_: chat-message identity, active-tab identity, event-derived state

**Optimization Episode Stop**:
An explicit user Stop/Cancel prevents new optimization turns, requests cancellation for in-flight execution operations, waits for their terminal receipts, and ends the episode as stopped while retaining completed operation results.
_Avoid_: immediate process kill, successful completion, silent background drain

**Optimization Episode Pause**:
A controller scheduling state that immediately prevents new replay or candidate
dispatch while allowing in-flight operations to reach terminal state and have
their receipts recorded. Resume re-enables scheduling; Pause neither suspends
ECC processes nor follows from hiding the Agent UI.
_Avoid_: tab hiding as pause, process suspension, cancellation

**Optimization Operation Failure**:
A failed replay or candidate operation is recorded at operation scope and does not fail-fast its Optimization Episode when the controller can still make progress. The episode becomes terminally failed only for controller-level, budget, evidence, or quarantine conditions.
_Avoid_: one tool failure equals episode failure, hidden candidate loss, success despite failed evidence

**Optimization Calibration Recovery**:
A required calibration replay failure prevents candidate scheduling and places
the Optimization Episode in recoverable needs-attention state. An explicit
Retry may reuse fingerprint-matching completed replay evidence and reruns only
failed or missing replays; incompatible Parent Workspace, parameter-policy or
ECC revisions require a new episode.
_Avoid_: automatic replay retry, candidates without calibration, stale replay reuse

**Optimization Episode Recovery**:
Renderer or Agent-panel reconnect preserves a live Optimization Episode. A provider crash or application restart interrupts the episode and requires explicit Resume before new turns are scheduled; interrupted execution operations follow Runtime recovery semantics.
_Avoid_: automatic post-crash continuation, interruption as user cancellation, replaying chat history as state

**Optimization Safe Shutdown**:
The existing Safe Shutdown treatment of an active Optimization Episode. Safe
draining stops new dispatch, lets in-flight operations become terminal, flushes
the ledger and persists the episode as interrupted before close; cancelling
shutdown restores its preceding Running or Paused state, while Force Quit uses
best-effort flush and restart recovery.
_Avoid_: post-exit background execution, shutdown as Episode Stop, new dispatch while draining

**Optimization Episode Resume**:
An explicit continuation request that restores a persisted Optimization Episode only after validating its Parent Workspace revision, objective and parameter-policy hashes, and ECC revision; terminal operations are never scheduled again.
_Avoid_: replaying the last chat turn, blind retry, implicit resume on reconnect

**Optimization Operation Cancellation**:
An operation-level cancellation stops one replay or candidate and leaves the Optimization Episode eligible to continue. Episode Stop cancels all cancellable in-flight operations and prevents new turns; both paths use the Runtime cancellation contract and preserve terminal results already collected.
_Avoid_: one candidate cancellation fails the episode, process kill, hidden cancellation state

**Episode Promotion**:
The optimization controller's decision that a candidate becomes the incumbent for later comparisons within the same Optimization Episode. It does not modify the Parent Workspace.
_Avoid_: Parent Workspace adoption, committed result, user-approved configuration change

**Parent Adoption**:
An explicit, separately validated action that applies a selected candidate's approved change to the Parent Workspace through the normal Workspace command and Revision contract. It is not implied by Episode Promotion or episode completion.
_Avoid_: automatic promotion writeback, candidate directory swap, implicit rerun

**Parent Adoption Authorization**:
The explicit confirmation that names the selected candidate, Parent Workspace, expected Workspace Revision, parameter patch, evidence and affected Flow Steps before Parent Adoption can execute. A Revision mismatch invalidates the authorization.
_Avoid_: episode completion as consent, stale confirmation, hidden writeback

**Optimization Parent Guard**:
The temporary exclusion on Parent Workspace mutations and ordinary Flow starts while its Optimization Episode is active, including interrupted and needs-attention states. Read-only inspection and work in other Workspaces remain available; the Parent run control is disabled with a background-optimization explanation rather than shown as Running. Resume/Retry preserves the guarded Revision, while Episode Stop makes the episode terminal and releases the guard.
_Avoid_: application-wide lock, queued mutation, false Parent Flow state

**Optimization Parent Exclusivity**:
A Parent Workspace owns at most one active Optimization Episode. A repeated
start resolves to the existing episode rather than creating, queuing, merging
or silently replacing another episode; different Parent Workspaces remain
independent.
_Avoid_: competing incumbents, per-parent optimization queue, implicit replacement

**Optimization Workspace Cleanup**:
An explicit irreversible action available only after an Optimization Episode is
terminal. It preserves the ledger, approved parameter-patch summary, normalized
metrics, outcomes, errors and Artifact hashes, then removes execution logs,
Artifacts and Workspaces and marks the episode cleaned. Cleanup disables later
Workspace opening, complete evidence revalidation and Parent Adoption, which
must happen first.
_Avoid_: automatic retention expiry, Artifact archive, adoption after cleanup

**Optimization Execution Concurrency**:
The execution policy in which calibration replays run serially and one Optimization Episode may have at most two in-flight candidate operations. Different Parent Workspaces retain the normal cross-Workspace concurrency model without a separate global optimization scheduler.
_Avoid_: unlimited candidate fan-out, parallel calibration replay, application-wide Flow queue
