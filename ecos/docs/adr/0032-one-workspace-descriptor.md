---
status: accepted
---

# One TOML descriptor owns Workspace configuration and provenance

An existing Workspace has one creator-independent descriptor at `<workspace>/home/workspace.toml`. It stores the resolved runnable configuration together with portable input, PDK and MPC provenance and integrity fingerprints. ECC CLI and ECOS Studio use this same descriptor regardless of which tool created the Workspace.

The descriptor stores PDK family, version, mode, file roles and content fingerprints, but never an installation root or other machine-local absolute binding path. When opening the Workspace, the CLI or Studio resolves a compatible local installation and supplies a transient Workspace Binding; ECC validates that binding against the persisted requirement and fingerprint before enabling execution.

The descriptor is human-readable but ECC owns its only write path. CLI and Studio submit the same validated create or update command instead of editing the file directly; a successful update atomically replaces the descriptor, advances the Workspace Revision and invalidates results affected by the configuration change.

ECC continues to materialize `home/parameters.json` for existing backend consumers, but only as Derived Backend Configuration generated from `workspace.toml`. A mismatch is resolved by regenerating the JSON from the Descriptor, never by applying JSON values back to it. During legacy migration only, an existing `parameters.json` may supply missing configuration when no Descriptor exists.

Workspace Spec remains the transient create or update command validated by ECC and is not persisted as a separate file. The branch-only `workspace-spec.json` and `workspace-metadata.json` files are removed without a compatibility path because they are not part of the ECC origin format. New Workspaces replace origin's `params.toml` with `workspace.toml`, representing configuration and provenance once. Flow ledgers, Operation journals, Engineering Snapshots, checklists and metrics remain separate because they have different ownership and mutation lifecycles.

When an existing origin-format Workspace has no `workspace.toml`, ECC recognizes `home/params.toml` and the older `home/parameters.json`. It combines that configuration with the existing `origin/`, PDK and Flow data, installs a Descriptor only after the complete candidate validates, and otherwise retains origin's existing compatibility loading behavior without writing a partial Descriptor.

The Descriptor schema evolves origin's `params.toml` structure rather than serializing the branch's resolved Workspace Spec. It retains the existing `design`, `pdk`, `flow` and `params` sections and adds only the portable input, MPC and integrity fields needed to replace branch-only metadata. Workspace creation maps the transient Workspace Spec into those sections; no nested `resolvedWorkspaceSpec` document is persisted.

`chipcompiler.data.workspace_descriptor` is the single module for Workspace format recognition and migration. Its external interface loads a normalized Workspace Descriptor or commits one; format detection, legacy-source combination, validation, atomic writes and Derived Backend Configuration generation remain inside the module. ECC's existing `load_workspace` calls this interface, so CLI and Runtime callers share the same behavior. Studio and the Runtime Adapter do not inspect or migrate Workspace files before that call, and Studio's duplicate pre-open configuration migration is removed.
