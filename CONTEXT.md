# Agent Interaction

This context defines the structured requests and answers exchanged between the ECOS Agent and GUI. Agent interactions may propose bounded product actions, while ECOS Studio retains confirmation, validation and execution authority.

## Language

**Workspace Parameter Update Proposal**:
A user-confirmable Agent proposal containing canonical parameter identities and values together with its target Workspace Handle, expected Workspace Revision and command identity. It never names or edits configuration files and does not execute until ECOS Studio submits a validated Workspace Configuration Update.
_Avoid_: parameter file write, JSON patch, Agent workspace mutation

**Step Configuration Update Proposal**:
A user-confirmable Agent proposal containing a Flow Step identity and bounded configuration patch together with its target Workspace Handle, expected Workspace Revision and command identity. It never names a tool configuration file or JSON path and executes only through ECOS Studio's validated Step Configuration Update command.
_Avoid_: step config file write, arbitrary JSON edit, Agent filesystem mutation

**Workspace Revision**:
A versioned state of a Workspace configuration and its associated flow lifecycle.
_Avoid_: run number, snapshot ID

**Current Result**:
An engineering result produced against the active Workspace Revision and eligible for current workflow decisions.
_Avoid_: latest result, cached result

**Stale Evidence**:
An engineering result from an earlier Workspace Revision retained for read-only inspection after configuration changes; it is not valid for current execution or sign-off.
_Avoid_: current result, cached result

**Result Source Revision**:
The Workspace Revision against which displayed engineering evidence was produced.
_Avoid_: display revision, UI revision

**Mixed Result State**:
A displayed Workspace state in which different Flow Steps provide results from different Workspace Revisions during an incomplete rerun.
_Avoid_: inconsistent data, partial cache

**Result Freshness**:
The relationship between displayed engineering evidence and the active Workspace Revision: current, stale, or mixed.
_Avoid_: data age, cache status

**Canonical Rerun Entry**:
The existing green play control in the right-side Flow Status bar is the sole UI entry for rerunning the full flow from Dashboard or the selected step from StepDashboard. Stale-result notices explain which evidence is shown and direct users to this control; they do not add a second rerun button.
_Avoid_: stale-banner rerun button, duplicate execution action

## Engineering Facts

**Engineering Snapshot**:
The atomic, revision-bound record of committed engineering facts for a Workspace, including the facts used by normal Backend rendering.
_Avoid_: snapshot ID, cache

**Committed Engineering Facts**:
Verified Flow, QoR, Signoff, analysis, and Artifact metadata belonging to one Workspace Revision and eligible for normal Backend decisions and presentation.
_Avoid_: latest result, raw report

**QoR Report**:
An ECC-produced report artifact for inspection or export; it is not a second source for normal Backend QoR queries.
_Avoid_: Renderer QoR source, score cache

**QoR Scoring Authority**:
The ECC Engine is the sole producer of QoR score, gate, polarity, Qphys, and feasibility conclusions persisted for a Workspace Revision.
_Avoid_: GUI scoring, Renderer score

**QoR Comparison Projection**:
An Electron Backend projection that consumes committed QoR conclusions to produce baseline deltas, recommendations, risks, and timing triage.
_Avoid_: second score, Renderer domain calculation

**QoR Snapshot Extension**:
A bounded set of ECC-produced QoR v3 fields persisted with the Engineering Snapshot for normal Backend rendering, including physical dimensions, diagnoses, and evidence.
_Avoid_: report fallback, raw QoR payload

**ECC Engine**:
The headless engineering authority for Workspace lifecycle, execution, Engineering Snapshot publication, QoR scoring, Signoff, Artifacts, and stable domain errors.
_Avoid_: Studio engine, Adapter engine

**Electron Backend Projection**:
A product read model assembled from validated ECC committed facts for Workspace and Project queries; it does not publish or recompute engineering truth.
_Avoid_: Renderer domain model, second authority

**Snapshot Schema Migration**:
An explicit-write-only, revision-preserving conversion of a supported Engineering Snapshot shape to a newer contract; read-only queries never migrate, and unsupported shapes remain unavailable.
_Avoid_: silent upgrade, dual Snapshot model

**Snapshot Contract Rollout**:
ECC may prepare a newer Snapshot contract ahead of Studio, but production writes remain on the currently supported version until ECC and Studio switch atomically.
_Avoid_: one-sided schema rollout, incompatible intermediate release
