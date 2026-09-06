---
status: accepted
---

# Workspace Configuration Updates preserve prior results as stale evidence

A Workspace Configuration Update atomically changes the existing Workspace Descriptor and advances its Revision without replacing the Workspace directory. Engineering Snapshots and Artifacts from the prior Revision remain available as visibly stale, read-only evidence, but they cannot supply current execution inputs, QoR, Project Comparison or Signoff; rerunning the affected Flow Steps replaces them with results committed against the new Revision.

Every Workspace Parameter change makes the entire prior Engineering Snapshot stale and presents the current Revision's configured Flow as unstarted. A value may use narrower invalidation only when ECC classifies it as a Step Option consumed by one identified Flow Step; Studio never infers parameter dependencies.

An existing Engineering Snapshot is never rewritten to record staleness. The backend derives `stale` from the current Workspace Descriptor Revision being newer than the latest Engineering Snapshot Revision, returns both revisions and a stable reason, and continues to expose the prior Snapshot only as read-only evidence. Rerun preparation commits a current-revision Snapshot while the prior Snapshot remains a separate predecessor governed by the replacement policy below.

ECC retains at most one Stale Snapshot Predecessor rather than an unbounded revision history. A configuration update preserves the immediately preceding Snapshot while creating the current-revision projection; the predecessor remains available only for invalidated Steps that do not yet have current-revision replacements and is discarded once all of them have been replaced. Artifact directories are not duplicated as part of this retention model.

If another configuration update is committed before those invalidated Steps are rerun, ECC retains the existing Stale Snapshot Predecessor instead of replacing it with the already-invalidated current projection. The new Revision carries forward the existing invalidated Step set and adds the Steps invalidated by the new update in Flow order.

During a partial, failed or cancelled rerun, each successfully committed Step uses its current-revision result, the failed or cancelled Step shows its current state, and untouched invalidated Steps may show predecessor facts only as labeled read-only evidence. Dashboard and StepDashboard may continue to display the predecessor QoR and result summaries as stale, read-only evidence while current-revision results are missing; those values never become the authoritative current QoR, Project Comparison, Signoff or execution dependencies.

Snapshot facts remain readable until current-revision results replace them, but raw Artifacts use the Workspace's fixed Step directories and are not versioned. They remain available only until that Step's Rerun Preparation Commit begins; preparation must remove the stale outputs before execution, after which the stale projection reports those Artifact references as unavailable rather than serving a missing, partial or newly overwritten file as old evidence.
