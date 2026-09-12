---
status: superseded by ADR-0033
---

# ECOS Studio owns the ECC Runtime Adapter

Move JSON-RPC transport, Operation sessions, GUI-specific rerun policy, event envelopes and recovery projection out of ECC into an ECOS Studio-owned `ecos-ecc-adapter` sidecar. ECC keeps a headless Python interface for Workspace, Flow, Step, Artifact and engineering-result semantics, shared by its CLI and the Adapter; Electron launches the Adapter rather than `ecc rpc serve`, and Renderer remains a projection-only client. This adds one separately packaged Python application, but prevents ECOS Studio product requirements from becoming ECC domain behavior and lets ECC remain independently usable without GUI dependencies.
