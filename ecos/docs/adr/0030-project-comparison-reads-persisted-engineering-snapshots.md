---
status: accepted
implementation: completed 2026-09-03
---

# Project Comparison reads persisted Engineering Snapshots

Electron reads each Project-declared Workspace's persisted Engineering Snapshot through one bounded, schema-validating internal reader and uses it as Project Comparison's source of committed facts. The Runtime Adapter supplies only the execution overlay for an already active Runtime Session; comparison reads never create a Workspace Handle, start a per-Workspace sidecar or emit lifecycle events. This keeps historical comparison read-only and avoids self-invalidating query loops.

Commit events, changes to the Project Manifest or a declared Snapshot file, and focus-time revision checks invalidate this reader without making those notifications authoritative or introducing fixed-interval polling. Electron observes the Project root before reading the Manifest, reconciles the watched Workspace set, waits for watches to become ready, and then reads the Snapshots. Native depth-zero directory watches support atomic file replacement, deduplicate events, reread only the affected Workspace, and are released with their Project context.

A watcher startup or runtime failure does not invalidate already verified Project data. Project Management reports automatic refresh as unavailable, retains the last verified result, offers explicit Refresh, and still performs a revision check when the window regains focus. It does not add a retry loop or polling fallback.

Step Compare is built from complete normalized metric records embedded in each Engineering Snapshot. Findings loads only the selected Workspace and Step's declared detail artifacts, caches them by both Workspace identities, revision and Step, and discards stale responses after selection changes. A detail is current only when its size and SHA-256 match the current Snapshot reference. Missing references return `ARTIFACT_REFERENCE_MISSING`; size or hash mismatches return `ARTIFACT_REVISION_MISMATCH`.

The Snapshot producer resolves only declared Project Analysis files instead of recursively inventorying output, analysis, report, and log directories. Its structurally bounded metadata covers per-Step metrics, summaries and hotspots plus STA timing issues, so the generic 512-entry inventory limit and generic Artifact content API are removed.

The reader canonicalizes the Project and every declared Workspace, rejects Workspace or Artifact paths that escape their owner, and checks the Snapshot against the 16 MiB boundary before parsing. Disk and Runtime inputs use the same TypeScript validator. The validator performs a strict envelope check and exposes Flow, QoR, Signoff, and Artifact data only through independently validated sections; the raw persisted Snapshot never enters Renderer state.

This decision is locally validated with direct bounded Snapshot reads, revision cache reuse, request coalescing, targeted verified Findings, native watcher recovery, and no Runtime Session creation during comparison.
