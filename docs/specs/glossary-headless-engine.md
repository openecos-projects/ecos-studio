# Glossary: Headless Engine and Workspace Lifecycle

> **Historical vocabulary.** This glossary was written for the earlier
> Studio-only Headless Engine Contract. The current CLI/Studio ownership,
> Snapshot boundary and protocol phases are defined in
> [ECC Runtime Consolidation v1](ecc-runtime-consolidation-v1.zh-CN.md).

Terms used by the Studio-owned Headless Engine Contract introduced in
PR 275. Implementation spec:
[headless-engine-contract.md](headless-engine-contract.md).
CLI vocabulary (`ecc.toml`, `--workspace`, `ecc run`) is unchanged.

## Workspace

A directory that holds one flow execution: `origin/`, `home/`, `config/`,
step directories, and logs. Identified on disk by its path. Studio also
identifies it by `workspaceId` inside the Engineering Snapshot.

## Workspace Spec

The Studio input that describes what a Workspace should contain: design
inputs, PDK binding, flow range, and parameters. Validated by
`validate_workspace_spec` before create or structural update. Parameter
applicability uses `normalize_flow_step()`, the same canonical step names
as flow construction.

## Bindings

Resolved host paths for Spec roles (RTL, filelist, PDK files, and so on).
The Spec names roles; Bindings point at files on this machine.

## Engineering Snapshot

`home/engineering-snapshot.json`. Studio's committed view of a Workspace:
`workspaceId`, `workspaceRevision`, analysis, QoR assessment, signoff
assessment, and artifact index. CLI-created workspaces do not have this
file in this PR.

## Workspace Revision

Monotonic integer in the Engineering Snapshot. Studio configuration and
structural updates are revision-aware: a stale expected revision is a
conflict, not a silent overwrite.

## Headless Engine Contract

The Studio Python APIs exported by `chipcompiler.engine`: create,
structural update, configuration update, query, `execute`, Engineering
Snapshot reads, and signoff inspect/export. Analysis builders and QoR
scoring stay internal. This PR does not make the CLI a client of that
contract.

## Workspace Ownership Lock

Sibling file `{workspace-name}.lock` next to the Workspace directory. It
survives directory replacement. Studio create / update / configuration
and CLI run / CLI workspace-param all use this filename, but this PR does
not treat CLI and Studio as one locking domain.

## Configuration Transaction

Studio-only disk backup used by `update_workspace_configuration`. It
restores params, flow, snapshot, and related files if a configuration
update fails or the process dies mid-commit. It runs only while the
Workspace Ownership Lock is already held. It is not a second lock file,
and it is not CLI parameter rollback.

## CLI Parameter Rollback

In-memory bytes snapshot used by `ecc param --workspace`. Process-local
only. Pre-existing CLI behavior; not merged into the Configuration
Transaction in this PR.

## `execute`

Studio entry point that runs an `EngineFlow` with an `ExecutionPlan` and
commits the Engineering Snapshot after completed steps. CLI does not call
it in this PR.

## `EngineFlow`

The existing flow runner. CLI `ecc run` calls it directly. Studio
reaches it through `execute`.

## Read-only Workspace Load

`load_workspace(..., read_only=True)`. Studio query APIs use this so
inspection cannot migrate configs, create `home/` files, or write logs.
Mutating Studio APIs load a writable Workspace.
