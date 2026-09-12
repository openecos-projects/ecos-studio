# Chip Backend GUI Context

This context defines the product language used by ECOS Studio to manage and analyze RTL-to-silicon implementation work. It separates product-level workspace exploration from engineering facts that may later be supplied by ECC.

## Language

**Project**:
A chip design and its implementation exploration space, including its Workspaces and selected QoR baseline.
_Avoid_: project page, project directory, dashboard project

**Project Manifest**:
The portable, creator-independent description of a Project shared by ECC CLI and ECOS Studio. It records Project identity, Workspace membership, lineage and lifecycle together with explicit Project choices such as objectives, resources and QoR baseline, but never Workspace configuration, execution state or engineering facts. Either tool can open and continue a conforming Project regardless of which one created it. ECC Project API provides its single validation and atomic mutation boundary.
_Avoid_: Studio project file, ECC project file, creator-owned manifest, execution ledger

**ECC Project API**:
The headless Project Manifest and managed Workspace transaction boundary used directly by ECC CLI and through the ECC Runtime by ECOS Studio. It owns engineering-file consistency and accepts only domain identities, Specs, Bindings, revisions and command identities, while Studio owns product interaction and orchestration.
_Avoid_: Studio Manifest writer, duplicate parser, Electron state, window identity, recent-project registration, Project UI backend

**Project Configuration**:
The optional, human-editable CLI authoring template stored at `<project>/ecc.toml`. It sparsely records author-selected overrides for an explicit Workspace create or update command, but it is not required to open a Project or run an existing Workspace and is never an existing Workspace's committed configuration.
_Avoid_: Project Manifest, Workspace Descriptor, Workspace execution state

**Workspace**:
An independently runnable and comparable implementation scheme within a Project.
_Avoid_: folder, current project, branch

**Workspace Spec**:
The transient, creator-independent create or update command validated by ECC. It carries the requested design, inputs, PDK requirement, Flow and parameters together with machine-local bindings, but is never persisted as a separate Workspace file.
_Avoid_: workspace-spec.json, Workspace Descriptor, Studio creation payload

**Workspace Descriptor**:
The single creator-independent description of an existing Workspace stored at `<workspace>/home/params.toml`. It contains the complete resolved runnable configuration, including the Flow's ordered canonical Step list and every applicable Parameter Catalog value even when equal to its default, plus portable input, PDK and MPC provenance needed to reopen and rebind the Workspace. It contains no execution state or engineering results. It is human-readable, while all supported writes go through ECC's validated create or update boundary.
_Avoid_: workspace.toml, workspace-spec.json, workspace-metadata.json, directly edited Workspace file, Flow ledger, Engineering Snapshot

**Workspace Configuration**:
The committed runnable configuration projected from a Workspace Descriptor: design, PDK, inputs and canonical Workspace Parameters. A Flow Operation validates its starting Workspace Revision and keeps this configuration fixed while its own lifecycle commits advance that Revision. It excludes Flow execution state, Engineering Snapshot metrics, derived geometry and other engineering results.
_Avoid_: Engineering Snapshot, Derived Backend Configuration, current result

**Resolved Workspace Flow**:
The ordered canonical Step list committed to the Workspace Descriptor when the Workspace is created or replaced. A preset selects this list only at that boundary; later ECC versions, preset changes and execution commands never re-resolve it for the existing Workspace. The Flow ledger records state for this list without owning its shape.
_Avoid_: live preset expansion, ledger-owned Flow, implicit Step insertion, command-scoped Flow override

**Derived Backend Configuration**:
The reproducible `home/parameters.json` materialized by ECC from the Workspace Descriptor for existing backend consumers. It is neither user-editable nor authoritative and never overwrites the Descriptor.
_Avoid_: Workspace Descriptor, user configuration, parameter source of truth

**Legacy Workspace Configuration**:
Workspace data that does not satisfy the current complete `params.toml` contract. It is outside the automatic compatibility boundary and is not opened by inferring fields, filling defaults or silently rewriting the file.
_Avoid_: fallback configuration, secondary source of truth, Studio-managed parameters

**Workspace Configuration Compatibility Boundary**:
The current Workspace contract accepts only a complete `params.toml` Descriptor together with its Engineering Snapshot. A Workspace written with the former Descriptor contents or without an Engineering Snapshot, including during migration intervals, must be recreated or explicitly overwritten. Data outside the current contract never triggers fallback reading, default filling, Snapshot conversion or automatic migration and never becomes a second configuration source.
_Avoid_: automatic upgrade, legacy fallback, best-effort Workspace

**Workspace Descriptor Module**:
The deep ECC module whose small read, load-and-commit interface owns strict Workspace Descriptor validation, atomic persistence and Derived Backend Configuration materialization for every CLI and Runtime caller.
_Avoid_: Studio migration, Runtime file parsing, legacy normalization, per-format public helper

**Pure Workspace Query**:
A query that resolves a Workspace path and reads committed files without changing the source Workspace. Query paths never call a side-effecting Workspace loader; when they need the Workspace Descriptor, they call only `read_workspace_descriptor()`. Transaction recovery and Derived Backend Configuration materialization belong exclusively to execution or mutation paths. ECC CLI `status`, `log`, `config`, `report step` and `signoff inspect`, plus equivalent ECC Runtime reads, use this boundary.
_Avoid_: load-on-read, query-time migration, query-time materialization

**Workspace-Derived Export**:
A command that reads a Workspace without changing it and writes only a declared report or export destination. Report calculation does not authorize Descriptor migration, transaction recovery, backend materialization, committed-result refresh or Workspace log writes.
_Avoid_: source Workspace mutation, implicit lifecycle update, calculation-as-mutation

**Workspace Binding**:
The transient mapping from portable Workspace input and PDK requirements to files and installations on the current machine. ECC validates and applies it when a Workspace is created, opened or executed; absolute binding paths are never persisted in the Workspace Descriptor and rebinding does not advance Workspace Revision.
_Avoid_: Workspace Descriptor, persisted PDK root, portable resource identity

**Canonical Parameter Vocabulary**:
The single set of stable, dotted parameter identifiers and meanings shared by ECC CLI, ECOS Studio, Workspace Specs and Workspace Descriptors, such as `design.frequency_mhz` and `cts.max_fanout`. Dots express TOML table grouping; backend parameter keys and tool JSON paths are ECC-internal targets rather than public identifiers. UI labels are presentation only.
_Avoid_: display-key parameters, backend parameter keys, tool JSON paths, parallel parameter schemas

**Workspace Parameter**:
A canonical configuration value that may influence more than one Flow Step, such as clock, physical dimensions or global implementation targets. Like every user-configurable value, it is stored under the Workspace Descriptor's `[params.*]` tables; its catalog `applies` value identifies the earliest affected Flow Step.
_Avoid_: Step Option, UI field, tool-private setting

**Step Option**:
A catalog parameter whose ECC schema guarantees that it is first consumed by one identified Flow Step. It shares the Workspace Descriptor's `[params.*]` storage with other parameters; the term describes invalidation semantics rather than a separate storage section. Changing it invalidates that Flow Step and its downstream suffix but does not invalidate preceding Step results.
_Avoid_: Workspace Parameter, arbitrary JSON field, shared tool setting

**Parameter Catalog**:
The single ECC-owned registry of public configuration keys used by ECC CLI and ECOS Studio. It defines canonical identity, ownership, value type, constraints, defaults, earliest affected Flow Step and one ECC-internal target: a backend semantic value, a tool configuration field or a PDK Resource Override. Membership means the key is user-configurable; the products may present different subsets or layouts but never maintain parallel lists.
_Avoid_: editable flag, GUI-inferred field list, raw tool configuration, CLI-only parameter registry

**PDK Resource Override**:
A Parameter Catalog entry with a `pdk_target`, such as `pdk.tech` or `pdk.libs`. Project Configuration may declare portable relative resource choices, but the Workspace Descriptor records only portable PDK requirements and provenance under `[pdk]`; machine-resolved paths belong to the transient Workspace Binding and never to `[params.*]`.
_Avoid_: Workspace Parameter, Step Option, persisted PDK installation path

**Structured Parameter Value**:
A single Parameter Catalog entry declared as `type="json"` whose value is an object or array, such as a PDN rail list or STA corner matrix. Studio may provide a structured editor for that value, but its nested members are not independent catalog parameters and do not expose the backing tool configuration.
_Avoid_: raw config JSON, inferred nested schema, arbitrary configuration tree

**Workspace Lifecycle**:
The Project-level availability of a Workspace, currently active or archived. It does not describe Flow execution, success or failure.
_Avoid_: Workspace status, Flow status, Operation state

**Workspace Execution State**:
The current or committed progress and outcome of a Workspace Flow, sourced from its Active Operation, Flow ledger and Engineering Snapshot. It is never stored in the Project Manifest.
_Avoid_: Workspace Lifecycle, Project Manifest status, cached project status

**Non-blocking Step Warning**:
A terminal Flow Step state that records an engineering warning while allowing execution to continue. The containing Operation succeeds, but the Step remains Warning in the Flow ledger, Engineering Snapshot, CLI and Studio; only the pre-implementation synthesis LEC may use this state, while post-route LEC failure remains blocking. It counts toward Flow completion and branch eligibility but not the successful-Step count.
_Avoid_: Success, failed Operation, ignored LEC result, Signoff proof

**Completed With Warnings**:
The aggregate Workspace Flow outcome when every configured Step has reached a continuable terminal state and at least one Step is Warning. It is distinct from Success and Failed; Project Comparison retains current results with their Warning labels, while Signoff Readiness remains an independent checklist result.
_Avoid_: Success, failed Flow, Signoff attention

**Project Workspace ID**:
The stable identity of a Workspace within its owning Project, used for lineage, baseline selection and product navigation; a Workspace not yet managed by a Project may not have one.
_Avoid_: Workspace ID, directory path, Workspace Handle, Engineering Workspace ID

**Engineering Workspace ID**:
The stable identity persisted with a Workspace's ECC engineering facts and carried by its Operations. Project Comparison uses it to associate an Active Operation with an Engineering Snapshot.
_Avoid_: Workspace ID, Project Workspace ID, directory path, Workspace Handle

**Workspace Handle**:
The temporary identifier for one Workspace Runtime Session. It is invalid after that session ends and never identifies a Workspace in a Project or Engineering Snapshot.
_Avoid_: Workspace ID, Project Workspace ID, Engineering Workspace ID

**Flow Step**:
One ordered implementation stage within a Workspace Flow whose identity remains distinct across execution, Engineering Snapshots, logs, analysis and Project Comparison. Presentation never collapses one Flow Step into an adjacent stage.
_Avoid_: panel, page step, fixed frontend enum, coarse-stage alias

**Obsolete Flow Step**:
A removed implementation stage that no longer participates in Workspace migration, presentation, execution, branching, comparison or outcome assessment. Legacy records and Artifacts for it are ignored rather than projected into the current Flow.
_Avoid_: retired step, historical step, compatibility step

**Not-applicable Flow Step**:
A Flow Step that is absent from one Workspace's configured Flow but appears in the ordered union used for Project Comparison. It does not count toward that Workspace's progress or outcome and is distinct from an existing unstarted or skipped step.
_Avoid_: skipped step, unstarted step, unavailable Snapshot

**Operation**:
A long-running execution of a flow or Flow Step with an observable lifecycle and terminal outcome.
_Avoid_: request, task message, loading state

**Active Operation**:
An Operation in the queued or running state, including one with cancellation requested but not yet confirmed. Its current step may overlay Project Comparison only when its Engineering Workspace ID and Workspace Revision match the Engineering Snapshot, but it is not a committed engineering fact.
_Avoid_: active Workspace, open Workspace, foreground Workspace

**Cancellation Request**:
An accepted intent to stop an Active Operation at its next safe Flow Step boundary. The Operation remains queued or running with cancellation requested until ECC confirms its terminal outcome.
_Avoid_: Cancelled Operation, process kill, immediate tool termination

**Cancelled Operation**:
A terminal Operation outcome confirmed after a Cancellation Request prevents the next Flow Step from starting. It is distinct from process loss and does not invalidate the committed outcome of a Step that finished before the safe boundary.
_Avoid_: Cancellation Request, interrupted Operation, failed Operation

**Flow Step Commit**:
The durable transition that records a Flow Step outcome and atomically commits its Engineering Snapshot before the result becomes observable. A Runtime notification is emitted only after both writes succeed and never depends on GUI rendering.
_Avoid_: step card refresh, render acknowledgement, event delivery

**Atomic Engineering Commit**:
The ECC transaction that stages and validates a Flow state transition, its Engineering Snapshot and commit metadata before replacing the previous committed set. Any failure restores the preceding committed files and produces no committed-result notification.
_Avoid_: best-effort Snapshot refresh, Flow-only commit, UI transaction

**Rerun Preparation Commit**:
The durable Workspace revision created after a rerun has reset affected Flow Steps and removed their prior Artifacts but before new execution results exist. An Active Operation advances to this revision, so its running overlay never joins a stale pre-rerun Snapshot.
_Avoid_: transient reset event, old committed result, renderer cleanup

**Execution Snapshot**:
The recoverable authoritative view of Operation and Flow Step lifecycle state for one Workspace at a point in time, rebuilt by ECC Runtime from live state and its Operation Ledger. It never contains or replaces committed engineering facts.
_Avoid_: event history, renderer cache, accumulated progress messages

**Operation Ledger**:
The ECC Runtime-owned bounded persistent record used to recover Operation identity, command idempotency, cancellation intent and terminal or interrupted outcomes after process loss. It covers a finite recovery window for Execution Snapshot reconstruction and is neither user-visible history nor an Engineering Snapshot.
_Avoid_: event log, task history, Engineering Snapshot, Electron operation store

**Engineering Snapshot**:
The authoritative view of committed engineering facts for one Workspace at a revision, generated and atomically written only by ECC. Electron may read and validate the persisted Snapshot directly, while Runtime events only invalidate cached reads and never carry replacement engineering facts.
_Avoid_: Execution Snapshot, Workspace Overview, event history, raw manifest

**Stale Engineering Snapshot**:
An immutable Engineering Snapshot whose Revision predates the current Workspace Revision. Staleness is derived from that Revision mismatch rather than written into the old Snapshot; it remains available as visibly stale, read-only evidence but is excluded from current execution inputs, QoR, Project Comparison and Signoff decisions until current-revision results replace it.
_Avoid_: current result, unavailable Snapshot, renderer cache

**Stale Snapshot Predecessor**:
The single immediately preceding Engineering Snapshot retained after a configuration update as stale evidence for invalidated Flow Steps. It is discarded after every invalidated Step has a current-revision replacement; ECOS Studio does not retain an unbounded Snapshot history.
_Avoid_: Snapshot archive, current Snapshot, revision history

**Revision-aware Step Projection**:
The Workspace presentation that shows a current-revision Step result when available and otherwise exposes its Stale Snapshot Predecessor result only as labeled read-only evidence. Stale evidence never fills a current QoR, Project Comparison, Signoff or execution dependency gap.
_Avoid_: stale fallback, mixed-revision result, latest-value merge

**Engineering Snapshot Unavailability**:
The explicit condition in which a Workspace's committed engineering facts cannot be read because its Engineering Snapshot is missing, invalid, unsupported or inaccessible. It carries a stable reason and is never projected as an unstarted Flow or reconstructed from legacy files.
_Avoid_: Synth unstart, legacy Flow fallback, empty Snapshot

**Engineering Snapshot Invalidation**:
A hint that a newer Engineering Snapshot may exist, produced by a commit event, the persisted Snapshot changing, or a consumer rechecking after regaining focus. It causes a revision-aware query and is not itself an engineering fact.
_Avoid_: Engineering Snapshot, automatic success, polling result

**Project Comparison Invalidation**:
A hint that Project membership, baseline, lifecycle, or committed Workspace facts may have changed, produced by a Project Manifest event, Engineering Snapshot event, Runtime commit event, explicit refresh, or focus-time revision check. It reconciles the watched Workspace set and reruns a revision-aware comparison without treating the event as truth.
_Avoid_: Project Comparison, polling tick, renderer fact mutation

**Runtime Event**:
A transient notification of Operation progress, diagnostics or a committed revision emitted by ECC Runtime. It may be duplicated, delayed or lost; consumers deduplicate what they can and recover authoritative state by querying Execution Snapshot or Engineering Snapshot.
_Avoid_: event log, engineering fact, replayable history, render acknowledgement

**Runtime Compatibility Handshake**:
The mandatory startup exchange that proves an ECC Runtime process speaks the required private protocol version and capabilities before any Project or Workspace command is accepted. An incompatible process is rejected before it can write.
_Avoid_: Adapter version, best-effort feature detection, first-command probing

**Stable Domain Error**:
An ECC-owned error code and structured detail that remains recognizable across direct CLI calls, ECC Runtime JSON-RPC and Electron Product Commands. Transport mapping may change the envelope, but it does not collapse known validation, lock, revision, binding or Snapshot failures into a generic command error.
_Avoid_: traceback, UI message, generic command failure, transport-specific code

**ECC Runtime**:
The ECC-owned private integration runtime through which ECOS Studio manages Workspace Runtime Sessions and Operations, including cancellation and interruption recovery. It exposes ECC engineering capabilities without owning product policy, GUI presentation or a second source of engineering facts.
_Avoid_: ECOS Runtime Adapter, ecos-studio-runtime, public ECC interface, ECC GUI backend

**Runtime Capability Handshake**:
The mandatory compatibility exchange completed before Electron sends any command to an ECC Runtime process. It identifies the private protocol version, ECC version and supported capabilities so an incompatible process fails before touching a Project or Workspace.
_Avoid_: public protocol negotiation, application version check, best-effort method probing

**Signoff Engine Interface**:
The headless ECC interface for inspecting Signoff Readiness and atomically exporting a Signoff Package. ECC CLI calls it directly and the ECC Runtime maps its domain errors into transport errors; ECC does not contain a second Runtime-owned Signoff implementation.
_Avoid_: Runtime signoff exporter, CLI-owned collector, duplicated readiness formatter

**Foreground Workspace Context**:
The single Workspace currently projected by a renderer window. Navigating away from or replacing this projection does not terminate that Workspace's Runtime Session or Operations.
_Avoid_: active Runtime Session, current directory, globally active Workspace

**Workspace Runtime Session**:
An execution-scoped runtime context for one Workspace. A renderer window may retain multiple isolated Runtime Sessions so their Operations can run concurrently, while projecting only one Foreground Workspace Context. A background Runtime Session is released after its last Operation reaches a terminal state and its committed snapshot is captured.
_Avoid_: Workspace, directory identity, foreground page, renderer session

**Workspace Runtime Process**:
An ECC Runtime process dedicated to one Workspace while that Workspace has an active Operation, persistent editing state or unfinished finalization work. It is an independent failure domain and is released when none of those conditions remain.
_Avoid_: shared backend process, renderer lifetime, global Workspace pool

**Workspace Open Transaction**:
The short ECC mutation that validates a Workspace Descriptor and Engineering Snapshot, applies current-machine Bindings, loads the Operation Ledger and recovers unconfirmed Operations before returning a Runtime Session. It releases the Workspace Ownership Lock before ordinary inspection or navigation continues.
_Avoid_: pure query, long-lived open lock, implicit Snapshot conversion

**Background Workspace Operation**:
An Operation whose Workspace is not the Foreground Workspace Context. It continues without retaining that Workspace's renderer view data or waiting for its page to render; Renderer may project only its Workspace identity, current step and lifecycle state, while committed snapshots provide the full state when the Workspace is entered again.
_Avoid_: cancelled Operation, detached process, hidden in-memory Workspace view

**Layout Edit Session**:
A Workspace-scoped exclusive editing lifetime that begins after source and revision validation and ends only after save, discard or Session close. It holds the Workspace Ownership Lock throughout; process loss ends the Session and releases the lock without treating uncommitted edits as saved.
_Avoid_: layout draft, persistent DB handle, unlocked optimistic edit

**Workspace Ownership Lock**:
The single cooperative cross-process exclusion associated with one Workspace and held by every ECC CLI or ECC Runtime command that executes or durably changes it. Pure queries take no exclusive lock; ECC Runtime acquisition fails immediately when another process holds it, while ECC CLI preserves its blocking acquisition behavior.
_Avoid_: Runtime session mutex, UI disabled state, configuration lock, per-caller lock

**Workspace Busy**:
The retryable outcome returned when ECC Runtime cannot acquire a Workspace Ownership Lock held outside its Runtime Session. It does not identify or infer the external owner and is distinct from a known Active Operation conflict.
_Avoid_: Operation conflict, queued Operation, lock-owner guess

**Workspace Update**:
The destructive replacement of an existing Workspace from a new structural configuration. Before execution, the user explicitly chooses whether to retain the original as a Workspace Replacement Backup after receiving complete data-loss consequences; neither choice is assumed, and an Agent cannot choose for the user. It is unavailable while that Workspace owns an active Operation.
_Avoid_: reload, reopen, configuration refresh, Workspace switch

**Workspace Replacement Backup**:
The original Workspace retained as a Project-managed archived Workspace when the user chooses backup before a structural Workspace Update. It preserves the original Flow state, engineering results, Artifacts and user files rather than acting as a temporary rollback directory.
_Avoid_: automatic backup, temporary staging directory, stale Snapshot

**Workspace Configuration Update**:
A revision-checked command that atomically updates canonical parameters in the existing Workspace Descriptor without replacing the Workspace directory. It advances the Workspace Revision and retains prior-revision engineering results as read-only stale evidence rather than deleting them. It is rejected while the Workspace owns an Active Workspace Operation.
_Avoid_: direct Descriptor edit, parameter file write, Agent JSON patch

**Step Configuration Update**:
A revision-checked ECC command that identifies a Flow Step and atomically applies a validated canonical parameter patch without exposing backing file paths. ECC uses each parameter's catalog `applies` value to compute the earliest invalidated Step; ECOS Studio and the Agent submit Step identities and values but never classify storage targets or read, edit or synchronize `config/*.json` files directly.
_Avoid_: config file edit, JSON path write, syncConfig

**Step Parameter Editor Model**:
The context-bound result of reading Step Configuration from ECC. It contains the Flow Step and Workspace identity plus ordered public Parameter Catalog records with canonical `param`, `type`, current `value`, `default`, `applies`, `description` and optional `range`, `choices` or `unit`; ECC-internal targets and filesystem locations are excluded.
_Avoid_: raw config object, complete catalog endpoint, JSON-path metadata

**Artifact**:
An identifiable output produced or used by a Flow Step; its identity is distinct from its file content or local path.
_Avoid_: file path, blob, report URL

**Declared Analysis Artifact**:
One of the bounded per-Step analysis files explicitly referenced by an Engineering Snapshot for current product consumption. It is resolved directly and verified by size and SHA-256; generic directory contents are not discovered speculatively.
_Avoid_: recursive Artifact inventory, arbitrary Workspace file, inferred report

**STA Report Artifact Set**:
The report names owned by `chipcompiler.tools.ecc.sta_qor` and reused by Snapshot and Signoff collectors. `qor_summary.rpt` and the four `timing_max_{in2out,in2reg,reg2out,reg2reg}.rpt` files are declared expected Artifacts; optional `power.rpt` is declared only when present, and legacy `timing_max.rpt` is not recognized.
_Avoid_: duplicate filename list, required power report, generic timing report scan

**Analysis Result**:
An engineering fact or conclusion derived from Workspace configuration and Artifacts.
_Avoid_: chart data, card state, formatted metric

**Product-Consumed Evidence**:
An Analysis Result or Declared Analysis Artifact already exposed by a product read model for current workflow decisions or inspection. Agent evidence presentation does not duplicate it as primary content; it may provide an entry to the underlying raw evidence.
_Avoid_: whatever the current Dashboard happens to render, dashboard card, duplicated metric

**Agent Diagnostic Evidence**:
Raw or detailed Artifact content presented in the Agent because Product-Consumed Evidence does not expose the investigation detail. It is supplementary evidence, not a second source of engineering truth.
_Avoid_: Agent result, Agent-owned result, parsed conclusion

**Workspace Overview**:
The product-level summary of one Workspace, combining ECOS Studio context, engineering analysis and available Artifact references.
_Avoid_: Home Data, Home Dashboard model, ECC Workspace Analysis

**Workspace Analysis**:
The engineering facts and conclusions for one Workspace, independent of Project management and GUI presentation.
_Avoid_: Workspace Overview, dashboard payload, project summary

**Step Analysis**:
The engineering facts, findings and Artifact availability for one Flow Step.
_Avoid_: Step Dashboard data, step panel model

**Project Comparison**:
A product-level comparison of multiple Workspaces in one Project. Committed progress, QoR, risks and readiness come from Engineering Snapshots; an Active Operation may provide a revision-matched execution overlay without changing committed Flow Step state. Project manifest data contributes Workspace Lifecycle but never execution state. An unavailable Workspace is identified with its reason and excluded from ranking without hiding available Workspaces or silently replacing the selected baseline.
Project Management distinguishes a never-run Workspace from one awaiting rerun after a configuration change. Its Step Findings may show the immediately preceding result as revision-labeled, read-only evidence; current progress, comparison, ranking and Signoff remain based on current-valid results. Each Step uses one result revision throughout its Findings, and a current result replaces its previous evidence after commit.
_Avoid_: Project Dashboard, multiple Workspace sessions

**Checklist Finding**:
The result of one engineering check, including its identity, state, policy, evidence and optional engineering explanation.
_Avoid_: status badge, checklist card, UI warning

**Quality of Results (QoR)**:
The normalized engineering metrics and evaluation outcomes used to assess and compare implementation quality.
_Avoid_: score card, chart series, formatted metric string

**QoR Scoring Policy**:
The pure ECC calculation shared by CLI and Studio-backed Snapshot production. It selects score-bearing schema-v3 metric records, chooses the applicable area record, applies metric thresholds, aggregates dimensions and computes the weighted overall score without reading files, committing a Snapshot or formatting a product report.
_Avoid_: CLI report reader, Snapshot lifecycle, Renderer scoring, duplicated thresholds

**Workspace Baseline Comparison**:
The bounded comparison of one Workspace against the single QoR baseline selected by its Project. It is part of that Workspace's Overview and does not rank or aggregate every Workspace in the Project.
_Avoid_: Project Comparison, baseline chart, current score card

**Signoff Readiness**:
The assessed eligibility and unresolved risk state for producing a Signoff Package; it is not itself physical signoff certification.
_Avoid_: signoff success, export button state, tapeout approval

**Quick Start workflow**:
A bounded operation that creates one Project and one Workspace from a frozen configuration snapshot, then starts the Workspace Flow. It is a product operation spanning Project Management and Workspace execution, not a sequence of independent UI clicks.
_Avoid_: macro, screen recording, click replay

**Quick Start projection**:
The visible representation of a running Quick Start workflow across the product page and Agent activity stream. It reports the same step lifecycle while the Controller owns execution.
_Avoid_: fake click animation, independent UI progress, model-rendered page

**Quick Start execution lock**:
The temporary product state in which Workflow controls are read-only while the Controller applies the frozen configuration snapshot. Observation, details, and Stop remain available; new values cannot be injected into the active workflow.
_Avoid_: disabled application, modal lockout, mutable in-flight setup

**Quick Start failure state**:
The terminal state recorded when a post-preflight Project, Workspace, or Flow step fails. Created assets remain addressable for inspection and retry, while no later workflow step is started automatically.
_Avoid_: silent rollback, reported success, discarded evidence

**Quick Start retry**:
A new attempt against the existing failed Workspace, beginning at the failed Flow Step. After failure the user may edit Workspace configuration; Retry freezes and records a new snapshot of those explicit edits while retaining the same Project and Workspace identities.
_Avoid_: whole-workflow duplication, hidden parameter mutation, retry during an active Flow

**Quick Start happy path**:
The primary MVP scope covering a fully preflighted, tested workflow with the prescribed resources and parameters. Failure handling remains the existing generic runtime/error behavior, but Quick Start does not add a separate retry experience until real failures justify it.
_Avoid_: failure-free guarantee, deleted error handling, speculative recovery UI

**Quick Start execution snapshot**:
The immutable ordered Flow and UI-state plan captured with the configuration snapshot. Run All Flow and retries use this plan rather than re-reading mutable page defaults during execution.
_Avoid_: live default lookup, version-dependent implicit Flow, unrecorded step order

**Quick Start YAML workflow**:
A versioned declarative plan whose steps name approved ECOS capabilities and data bindings for a design-specific Quick Start. YAML selects and orders bounded operations; it does not grant new filesystem, process, or UI privileges.
_Avoid_: arbitrary script, shell macro, coordinate replay

**Quick Start workflow capability**:
An allowlisted semantic operation exposed to YAML, such as opening a product surface, creating a Project, resolving a Resource Management identity, creating a Workspace, or starting a Flow. A capability owns validation and execution; the YAML step only supplies declared inputs and presentation metadata.
_Avoid_: raw click, arbitrary RPC, UI selector, shell command

**Quick Start capability projection**:
The UI metadata attached to an approved capability that maps its lifecycle to a real product surface and localized Activity item. It identifies the target surface and display copy, while the capability implementation owns navigation and state changes.
_Avoid_: selector metadata, hard-coded sentence, animation-only step

**Quick Start schema compatibility**:
The validation contract between a bundled YAML workflow and the ECOS version loading it. A workflow declares its schema version and supported application range; incompatible workflows are rejected before any mutation.
_Avoid_: best-effort parsing, silent field ignore, runtime schema drift

**Quick Start workflow binding**:
The named reference that carries a capability result into later steps, such as the created Project ID, Workspace ID, resolved Resource ID, or frozen Flow snapshot. Bindings are typed and workflow-scoped; they are not arbitrary variables or paths.
_Avoid_: global mutable state, stringly-typed handoff, path-as-identity

**Quick Start handoff**:
The transition after Workspace creation in which the Controller enters the new Workspace, closes any automatically opened Step Configuration surface, and starts the frozen Flow plan.
_Avoid_: wizard completion only, manual handoff, delayed modal choreography

**Quick Start handoff pause**:
A bounded, presentation-only pause after Workspace entry that lets the newly opened Step Configuration surface be perceived before the Controller closes it. It never changes execution ordering and is skipped or minimized when reduced motion is requested.
_Avoid_: readiness wait, backend sleep, unbounded animation delay

**Quick Start naming fields**:
Project Name is the unique container identity, Design Name remains the selected resource's stable design identity (`gcd`), and Workspace Name follows the normal generated workspace naming rule. A Project collision never changes Design Name or Top Module Name.
_Avoid_: project-name-as-design, collision-renamed top module, filename-only identity

**Quick Start execution summary**:
The non-blocking, read-only summary shown immediately after authorization and before the first mutating step. It exposes the frozen resource identities, derived names, PDK/MPC versions, and Flow plan without asking for another confirmation.
_Avoid_: second confirmation, editable preview, hidden configuration

**Quick Start locale**:
The language used by Quick Start labels, execution summary, preflight results, and activity items, inherited from the application's active locale rather than inferred independently by the Agent.
_Avoid_: mixed-language run, model-selected locale, untranslated activity

**Quick Start stop boundary**:
The stage-aware behavior of Stop: before Project or Workspace creation commits, the Controller cancels and cleans up recoverable create residue; after a Workspace exists, it interrupts the current Operation without deleting the Project or Workspace.
_Avoid_: universal rollback, force kill, silent continuation

**Quick Start flow lock**:
Once Run All Flow starts, the Quick Start controller offers no Stop action. The Flow Operation owns its own terminal lifecycle; Quick Start remains observational and records the terminal result without starting later work after a failure.
_Avoid_: mid-flow Quick Start cancel, forced termination, hidden background run

**Quick Start background operation**:
A Flow Operation that continues after the user leaves the Workspace or closes the application window, with its state and logs recoverable when the Workspace is reopened.
_Avoid_: detached process, hidden run, close-means-cancel

**Quick Start storage location**:
The app-managed Project storage root used by Quick Start, selected without a user directory picker and kept separate from source design resources. Each run receives a unique Project name and path under this root.
_Avoid_: source directory, arbitrary save location, resource path

**Quick Start entry state**:
The application state in which a Quick Start workflow may be authorized: no other Quick Start workflow or conflicting workspace-creation Operation is active for the session.
_Avoid_: arbitrary entry, concurrent wizard, overlapping create operation

**Quick Start Home entry**:
The sole product surface that exposes Quick Start. Workspace surfaces do not render the action; returning to Home is required before a new Quick Start authorization can be made.
_Avoid_: workspace shortcut, global action, duplicate entry point

**Quick Start MPC association**:
The Project-level association to the exact managed MPC resource identity and version selected during Quick Start preflight. A Workspace created under that Project inherits the association and does not perform a second MPC selection.
_Avoid_: workspace-only MPC choice, display-name-only match, version drift
