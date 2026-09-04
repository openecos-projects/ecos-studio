---
status: accepted
---

# The Project Manifest contains only portable Project relationships and choices

The Project Manifest stores Project identity and timestamps; Workspace identity, name, relative location, lineage and active or archived lifecycle; and explicit Project choices such as objectives, portable MPC resource identity, QoR baseline and best Workspace. The Project root is derived from the Manifest location, and every Workspace location is stored relative to that root.

The Manifest does not store an absolute `root_path`, base design configuration, Workspace parameter patches, Flow boundaries, execution outcomes, metric summaries, Step metrics, local MPC paths or embedded MPC templates. Project Configuration supplies authoring defaults, each Workspace Descriptor supplies committed runnable configuration and provenance, and Engineering Snapshots supply committed engineering facts.

ECC Project API normalizes a legacy Manifest in memory when it is read and does not rewrite the Project merely because it was opened. Legacy configuration fields may be used only to recover a missing Workspace Descriptor. Before the first successful Manifest mutation, the API verifies that every referenced Workspace is readable and has a valid descriptor, then atomically writes the reduced Manifest shape. Any failure leaves the legacy Manifest unchanged rather than producing a partially migrated Project.
