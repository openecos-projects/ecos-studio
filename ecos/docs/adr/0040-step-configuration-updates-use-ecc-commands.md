---
status: accepted
---

# Step Configuration Updates use ECC-owned domain commands

ECOS Studio and the Agent submit a Flow Step identity, bounded configuration patch, Workspace Handle, expected Workspace Revision and command identity through `workspace.updateStepConfiguration`. ECC resolves and validates the tool configuration, commits it atomically and advances the Workspace Revision; file names, `config/*.json` paths, JSON paths and the legacy `workspace.syncConfig(configPath)` protocol are not part of the cross-process contract.

ECC accepts only Step Options that its schema guarantees are consumed by the identified Flow Step. A successful update carries preceding Step results into the new Revision and makes the target Step and every downstream Step stale; any setting with broader consumers is a Workspace Parameter and follows whole-Flow invalidation instead.
