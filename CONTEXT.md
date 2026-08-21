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
validates and consumes it against that request before changing agent state.
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
the ID; the backend resolves the associated value from the pending request.
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
