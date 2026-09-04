---
status: accepted
---

# Project Comparison distinguishes absent Flow Steps from unstarted work

Project Comparison builds its columns from the ordered union of the compared Workspaces' configured Flow Steps. A step absent from one Workspace is `not_applicable` and does not affect its progress or outcome; a configured step without a committed result is `unstarted`, while a missing or invalid Engineering Snapshot makes the Workspace `unavailable` rather than manufacturing per-step states.
