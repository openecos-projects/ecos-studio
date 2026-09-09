---
status: superseded
superseded_by: ./0046-top-module-is-confirmed-at-create.md
---

# Workspace Identity updates keep the current directory

> Superseded by ADR 0046. Studio does not add an in-place identity write for Top Module.

The earlier draft kept the current Workspace directory and `workspaceId` while rewriting identity and marking the entire Engineering Snapshot stale. That path is not used. Top Module is confirmed at Workspace create and then read-only; see ADR 0046.
