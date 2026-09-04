---
status: accepted
---

# Agent parameter updates use domain commands rather than file edits

An Agent proposes Workspace parameter changes as canonical parameter identities and values tied to a Workspace Handle, expected Workspace Revision and command identity. After user confirmation, ECOS Studio submits the proposal through `workspace.updateConfiguration`; ECC validates and atomically updates the Workspace Descriptor, while Agent contracts, Renderer code and Electron IPC never name or edit `params.toml`, `parameters.json`, JSON paths or other configuration files directly. Step-private configuration remains a separate command surface.
