---
status: accepted
---

# One ECC Project API validates and mutates the Project Manifest

The Project Manifest is a creator-independent contract shared by ECC CLI and ECOS Studio. ECC Project API provides its single implementation for parsing, validation and atomic read-modify-write mutations. CLI calls that API directly, while Studio reaches the same API through the ECC Runtime Adapter instead of maintaining a second Manifest writer.

This placement does not make a Project creator-owned by ECC. Studio continues to own product interaction, authorization and orchestration, while ECC Project API owns only the portable file contract and its consistency. Manifest mutations never write Workspace execution state or engineering facts.

ECC Project API is strictly headless. Its commands and results contain only Project and Workspace identities, Workspace Specs and Bindings, expected revisions, command identities and domain outcomes; they never contain Electron, window, Renderer, dialog, Activity or recent-project state. Studio's Creation Journal remains responsible for window ownership, shutdown coordination, recovery presentation and application registration, but does not reimplement the Project/Workspace engineering-file transaction.

A managed Workspace create command succeeds only after the Workspace directory, Workspace Descriptor, initial Engineering Snapshot and Project Manifest registration are durable. Application registration such as Studio's recent-project list happens after that domain commit; its failure is recovered by Studio's Creation Journal and never rolls back a successfully committed Project Workspace.

ECC does not add a background crash-repair system for Workspace creation. It builds in a staging directory, publishes only a complete Workspace, cleans failed staging work best-effort and supports explicit idempotent retry with the same command identity. A process interruption or inconsistent completed target is surfaced for explicit retry or Studio-guided registration recovery; ECC never automatically completes or deletes a Workspace after restart.
