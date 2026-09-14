# ADR: Headless Engine Contract Scope (PR 275)

> **Superseded.** The accepted PR 275 scope was Studio-only. The current
> cross-repository decision is documented in
> [ECC Runtime Consolidation v1](ecc-runtime-consolidation-v1.zh-CN.md) and
> moves all CLI Workspace writes onto the same ECC Engine commit paths.

Status: accepted during review of
[PR 275](https://github.com/openecos-projects/ecc/pull/275)
(`ekko/refactor-ecc-cli-integration`). Implementation spec:
[headless-engine-contract.md](headless-engine-contract.md).

## Context

This PR removes the in-process RPC runtime and adds headless workspace APIs
under `chipcompiler.engine`. Two interpretations were available:

- Treat the new APIs as a shared CLI + Studio contract in this PR.
- Treat them as a Studio-owned headless contract, and leave CLI on its
  existing `create_workspace` / `EngineFlow` path.

`main` already had two products, not one transaction model:

- CLI serialized runs with a sibling `{workspace}.lock` and rolled back
  `ecc param --workspace` from in-memory file bytes.
- RPC/Studio serialized mutations with a process-local session lock and
  had no file-backed configuration transaction.

## Decision

This PR delivers a **Studio-only** headless contract. CLI does not adopt
the new create / configure / execute APIs in this round.

Consequences that follow from that scope:

1. Studio create, structural update, and configuration update share one
   sibling `{workspace}.lock`. Configuration backup remains a Studio
   transaction implementation and does **not** own
   `.{workspace}.configuration.lock` (that file is new in this PR and is
   removed). Backup and crash recovery run only while the ownership lock
   is already held.
2. CLI keeps `{workspace}.lock` and `_snapshot_transaction`. Those are
   the pre-existing CLI design; this PR does not merge them into
   `WorkspaceFileTransaction`.
3. Studio execution goes through `chipcompiler.engine.execute`, which
   commits the Engineering Snapshot. CLI continues to call `EngineFlow`
   directly and does not write snapshots.
4. Studio query APIs (`describe`, `assess`, `read_*`) load workspaces
   `read_only=True`. They must not migrate, create home files, or append
   logs. Mutating APIs may load writable workspaces.
5. Unused runtime extraction in `workspace_flow.py` is deleted. `execute`
   calls `EngineFlow` directly.
6. `create_workspace_from_spec` may delete `target` only if this call
   created that directory. A pre-existing Workspace is never removed on
   create failure (`workspace_exists` instead).
7. `chipcompiler.engine` exports the Studio contract: lifecycle,
   configuration, `execute`, Engineering Snapshot reads, and signoff
   inspect/export. It does not export analysis builders or `score_qor`;
   those stay internal to snapshot/execute.
8. Workspace Spec parameter applicability uses `normalize_flow_step()`.
   The handwritten step-alias table in spec validation is deleted.

## Non-goals for this PR

- Wiring CLI `ecc run`, `ecc workspace refresh`, or `ecc param --workspace`
  through `create_workspace_from_spec` / `update_workspace_configuration`
  / `execute`.
- Making CLI and Studio lock files mutually exclusive.
- Replacing CLI in-memory parameter rollback with the Studio file
  transaction.
- Changing CLI `sys.modules` manifest aliases.
- Making CLI `ecc signoff inspect` a read-only load.
- Splitting `metrics.py`.
- Treating full-suite / PyInstaller / Nix runs as a contract change
  (they remain a merge checklist, not a scope item).

## Follow-up

A later PR may adopt the headless contract in CLI. That change is
explicitly out of scope here and would be a separate decision.
