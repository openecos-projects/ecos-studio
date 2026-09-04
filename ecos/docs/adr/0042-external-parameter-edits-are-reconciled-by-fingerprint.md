---
status: proposed
---

# Reconcile external Workspace parameter edits by semantic fingerprint

Direct edits to `home/workspace.toml` currently bypass managed Revision and staleness handling. A future implementation may let ECC recognize parameter-only edits by storing separate structural and parameter fingerprints in Engineering Snapshots, ignore formatting-only changes, validate semantic changes and reconcile them into a new Workspace Revision before Rerun; structural edits would still require the Workspace Update workflow.

Implementation is deferred. The current backend-contract merge adds no configuration fingerprints and makes no new compatibility guarantee for externally edited Workspace Descriptors; all supported writes continue to use ECC commands.
