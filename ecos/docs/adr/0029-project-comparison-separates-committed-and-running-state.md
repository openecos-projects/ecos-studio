---
status: accepted
implementation: completed 2026-09-03
---

# Project Comparison separates committed and running state

Project Comparison uses each Workspace's Engineering Snapshot for committed progress and engineering facts, while an Active Operation supplies a separate execution overlay. Electron applies that overlay only when its Engineering Workspace ID and Workspace Revision agree with the Engineering Snapshot; the Project Workspace ID remains the product identity, a directory path is only a locator, and Project manifest state describes only the Workspace Lifecycle. The overlay never downgrades an already committed Flow Step within the same revision and refreshes independently from the heavier committed comparison.

The Project Manifest is a portable contract shared by ECC CLI and ECOS Studio, not a file owned according to which tool created it. Either tool may create and continue a conforming Project, but neither writes running, success or failure as authoritative Manifest state; legacy execution-like status values are read only for compatibility. Workspace execution is reconciled from its Flow ledger, Engineering Snapshot and Active Operation instead.

When an Engineering Snapshot is unavailable, Project Comparison reports its stable missing, invalid, unsupported or inaccessible reason without reading legacy Flow files or presenting the Workspace as unstarted. A failure is isolated to that Workspace: available Workspaces remain visible, the result is partial, the unavailable Workspace is excluded from ranking, and a selected unavailable baseline is preserved rather than silently replaced.

Rerun is the exception that proves the revision boundary: preparing a rerun destructively clears affected artifacts and resets their Flow states, so successful preparation commits a new `flow.rerun_prepared` revision before execution continues. The Operation advances to that revision and publishes it with the preparation event, allowing its running overlay to join the new committed reset state. Each later `workspace.committed` event advances the active Operation again so the overlay remains revision-matched throughout a multi-Step Flow.

The execution overlay covers Operations owned by the current ECOS Studio Electron process, including its other windows because they share the Runtime Service. An independent CLI or desktop process has no trustworthy live Operation channel in this version; Project Management reflects it only after a committed Engineering Snapshot changes. It does not infer external running state from logs, temporary files, or timestamps.

Committed Snapshot acquisition follows ADR 0030; querying Project Comparison does not create Runtime Sessions. This decision is locally validated with the representative two-Workspace fixture, cancellation-request presentation, revision-matched Active Operation overlay, and rerun-preparation reset revision.
