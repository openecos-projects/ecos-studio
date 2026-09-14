# ECC Runtime Consolidation v1

状态：已确认，准备实施

发布状态：仅保存在仓库，不发布 issue，不创建 PR，不推送远端

## Problem Statement

ECOS Studio 当前同时存在 ECC 的 headless Engine、Studio 自有的
`ecos-studio-runtime`/`ecos-ecc-runtime-adapter` 和 CLI 自己的执行/回滚路径。
这些路径拥有重复的 Workspace、Flow、Operation、Snapshot、错误和锁语义，导致：

- Studio 启动独立 Adapter binary，ECC 又保留另一套 Runtime 相关代码，发布、依赖和
  故障域重复。
- CLI 创建或更新的 Workspace 与 Studio 创建的 Workspace 不能天然共享同一套
  Descriptor、Revision、Flow Commit 和 Engineering Snapshot。
- CLI 写操作和 Studio 写操作可能使用不同的锁、回滚和 Snapshot 提交时机，容易产生
  半提交 Workspace 或跨进程覆盖。
- Studio 的 Project Comparison、QoR、Signoff 和 stale-result 展示需要一个原子、带
  Revision 的工程读模型；直接同时扫描多个原始文件会读到混合版本。
- CLI 的 `status`、`report` 和 `signoff inspect` 已有稳定的文件读取和输出行为，若为
  统一 Snapshot 而重写这些查询，会扩大兼容范围并改变用户命令语义。
- 当前 Runtime 还需要保留取消、Interrupted recovery、Layout/Floorplan 编辑、后台
  Operation、Workspace Snapshot 和持久化 Ledger 等完整能力，不能只留下一个轻量 RPC
  转发层。

用户需要一个可以长期维护的跨仓库边界：ECC 提供唯一的工程事务和 Runtime，Studio
继续拥有产品策略和展示，CLI 与 Studio 的所有写操作最终落到同一 ECC Engine 提交路径，
而现有 CLI 只读输出和报告文件行为保持兼容。

## Solution

将 ECC Engine、ECC Runtime、ECC CLI 和 Electron 的责任固定为四层：

- ECC Engine 拥有 Workspace 生命周期、Descriptor、Bindings、Flow 执行、Revision、
  Engineering Snapshot、QoR、Signoff、Artifacts、事务和稳定领域错误。
- ECC Runtime 直接归属 ECC，承载 JSON-RPC、Runtime Session、Operation、取消、恢复、
  事件、持久化数据库、Operation Ledger 和 Layout/Floorplan 编辑。
- ECC CLI 保留命令解析、selector、输出和只读查询；所有 Workspace 持久化写操作直接
  调用 ECC Engine，不调用 ECC Runtime。
- Electron 保留产品策略、授权、路径范围、进程监督、窗口/Agent/后台行为和展示；
  Studio 通过隐藏的 `ecc rpc serve` 使用 ECC Runtime，不再构建独立 Adapter。

Engineering Snapshot 继续保留，但只作为 ECC 生成、Studio 读取的 committed engineering
read model。CLI 查询不迁移为 Snapshot API：`status` 和 `report step` 继续读取原有
文件，`signoff inspect` 保持现有结果，`report qor/checklist/summary` 保留报告文件输出。
需要创建 Workspace 对象的查询使用只读 hydration，不得迁移、恢复或追加日志。

迁移分为两个阶段：第一阶段直接把 Runtime 实现移入 ECC，保持现有 JSON-RPC wire
contract 和 Studio 输出行为；第二阶段在 ECC/Studio parity、打包和 smoke 全部通过后，
删除 Adapter aliases、过渡 Snapshot RPC 和重复协议。

## User Stories

1. As an ECOS Studio user, I want a Workspace created by ECC CLI to open in Studio, so that the tool used to create a Workspace does not restrict later inspection or execution.
2. As an ECC CLI user, I want a Workspace created by Studio to continue through CLI, so that automation and desktop workflows share one Workspace contract.
3. As a Studio user, I want one packaged `ecc` executable to serve both CLI and Runtime requests, so that installation and version selection do not depend on a second Adapter binary.
4. As a maintainer, I want the Runtime implementation owned by ECC, so that Workspace and Flow domain logic has one owner and one release cadence.
5. As a maintainer, I want the obsolete Studio Adapter package, wrapper and duplicate requirements removed, so that two Python environments cannot drift.
6. As a Studio user, I want every active Workspace to have an isolated Runtime process, so that a failed EDA process does not corrupt unrelated Workspaces.
7. As a Studio user, I want Workspace-independent requests to use one lazy Control Runtime, so that Project and Workspace Spec queries do not start unnecessary per-Workspace processes.
8. As a Studio user, I want the Runtime to retain Session, Operation, cancellation, recovery, event and persistent DB behavior, so that runtime consolidation does not remove existing capabilities.
9. As a Studio user, I want Layout and Floorplan editing to remain available, so that moving Runtime ownership does not regress interactive engineering work.
10. As a Studio user, I want a background Operation to continue after leaving its Workspace, so that navigation does not silently cancel engineering work.
11. As a Studio user, I want a process loss to recover an unconfirmed Operation as `interrupted`, so that incomplete work is never reported as succeeded.
12. As a Studio user, I want normal cancellation to stop at a Flow Step boundary, so that a running EDA tool can finish its current Step safely.
13. As a Studio user, I want Force Quit to be the only hard termination path, so that ordinary Cancel does not send an unsafe signal to a running tool.
14. As a Studio user, I want Runtime Events to be treated as transient hints, so that duplicate, delayed or lost events cannot change engineering correctness.
15. As an engineer, I want the Engineering Snapshot to contain committed Flow, parameters, analysis, QoR, Signoff and Artifact metadata, so that Studio can render one coherent engineering state.
16. As an engineer, I want Engineering Snapshot schema v2 and filenames preserved in the first phase, so that existing Workspace data remains recognizable.
17. As a Studio user, I want Snapshot replacement to be atomic, so that Project Comparison never reads a half-written engineering state.
18. As a Studio user, I want Snapshot identity and Revision validated before display, so that facts from another Workspace or an older revision cannot be attached to the current one.
19. As a Studio user, I want a missing or invalid Snapshot to be reported explicitly, so that the UI does not turn unavailable data into `Synth unstart`.
20. As a Studio user, I want Snapshot-less legacy Workspaces to require an explicit refresh, recreate or overwrite, so that browsing never silently converts or mutates old data.
21. As a Studio user, I want Project Comparison to read the persisted Snapshot without opening a Runtime Session, so that historical inspection does not create lifecycle events or self-invalidation loops.
22. As a Studio user, I want Runtime Events to invalidate Snapshot caches only, so that the persisted Snapshot remains the authoritative engineering fact.
23. As a CLI user, I want `ecc status` to keep reading `home/flow.json`, so that existing scripts and progress output remain compatible.
24. As a CLI user, I want `ecc report step` to keep reading declared Step artifacts, so that detailed evidence remains available without a Snapshot read-model migration.
25. As a CLI user, I want `ecc signoff inspect` to keep its current output contract, so that inspection behavior does not change during Runtime consolidation.
26. As a CLI user, I want `ecc report qor`, `report checklist` and `report summary` to keep writing their requested or default report files, so that report workflows remain compatible.
27. As a CLI user, I want report and Signoff Workspace hydration to be read-only, so that inspection cannot migrate configuration, recover transactions or append Workspace logs.
28. As a CLI user, I want Workspace creation to use the same ECC Engine transaction as Studio, so that Descriptor, initial Snapshot and Revision have identical semantics.
29. As a CLI user, I want `ecc workspace refresh` and `ecc param set/unset --workspace` to use Engine commit paths, so that configuration writes are not a separate implementation.
30. As a CLI user, I want `ecc run` to use Engine execution and commit paths, so that CLI Flow Step results and Studio results publish the same Snapshot shape.
31. As a CLI user, I want `ecc run --overwrite` to retain its temporary backup and rollback behavior, so that failed replacement never destroys the previous Workspace.
32. As a CLI user, I want CLI selectors such as `--resume`, `--from`, `--to`, `--only`, `--force` and presets to keep their current meaning, so that scripts do not need new command syntax.
33. As a CLI user, I want selectors resolved to canonical ordered Step IDs before entering Engine, so that Engine can validate dependencies without knowing CLI flag names.
34. As a CLI user, I want a completed target with no explicit rerun selector to return a successful no-op, so that a status-preserving `run` does not rewrite files or advance Revision.
35. As a CLI user, I want explicit `--force`, `--from` or `--only` to remain mutations, so that intentional reruns still invalidate and commit results.
36. As a CLI user, I want Engine `ExecutionResult` to report success, final state, executed Steps and failed Step, so that CLI output does not rescan Flow files to infer partial execution.
37. As an engineer, I want one monotonic Workspace Revision for every durable transition, so that configuration, rerun, layout and Flow commits share one concurrency model.
38. As an engineer, I want a Flow Step and its Engineering Snapshot committed before `workspace.committed`, so that Runtime notifications never advertise facts that are not durable.
39. As an engineer, I want a failed Snapshot commit to preserve the previous readable Snapshot, so that a failed Operation cannot leave the Workspace without committed engineering facts.
40. As a CLI user, I want CLI locks to block as before, so that existing automation continues to serialize rather than receiving a new retry error.
41. As a Studio user, I want Runtime lock acquisition to fail fast with `workspace_busy`, so that the UI can explain contention without hanging a Runtime process.
42. As a Studio user, I want a same-Runtime active Operation conflict distinguished as `operation_conflict`, so that a local duplicate command is not confused with an external owner.
43. As an engineer, I want Project Manifest and Workspace locks acquired in one fixed order, so that create, update and overwrite rollback cannot deadlock.
44. As a Studio user, I want a Layout Edit Session to hold the Workspace lock until save, discard or process loss, so that an edit cannot race a Flow or structural replacement.
45. As an engineer, I want save to publish the Layout commit before releasing its lock, so that another process never observes an unlocked but uncommitted edit.
46. As an engineer, I want machine-local Bindings excluded from Descriptor and Manifest, so that copying a Workspace does not embed invalid host paths.
47. As an engineer, I want Workspace create and structural replacement to stage complete trees before atomic exchange, so that partial directories are never presented as committed Workspaces.
48. As an engineer, I want Project Manifest and Workspace updates to use existing staging and rollback without two-phase commit, so that cross-file coordination remains understandable and bounded.
49. As an engineer, I want known Engine failures to retain stable code, message and details through CLI, Engine and JSON-RPC, so that Electron can present actionable errors without parsing tracebacks.
50. As a Studio user, I want an incompatible Runtime to fail before any write, so that version or capability mismatch cannot partially mutate a Project or Workspace.
51. As a maintainer, I want Phase 1 to preserve existing JSON-RPC methods, fields, errors and Events, so that the ownership move can be validated independently from protocol cleanup.
52. As a maintainer, I want Phase 2 to require `rpc.hello` on Control and Workspace Runtime processes, so that protocol version and capabilities are explicit before business commands.
53. As a maintainer, I want Adapter-specific names and aliases removed after parity, so that private protocol vocabulary has one canonical form.
54. As a Studio user, I want `workspace.snapshot` to include live Operation state and bounded Ledger recovery, so that queued, running, cancelling and interrupted states remain observable.
55. As a maintainer, I want the Ledger to retain active Operations and only the latest 256 terminal Operations, so that recovery remains bounded instead of becoming an unbounded history database.
56. As a maintainer, I want older Ledger entries and command deduplication results removed after the cap is exceeded, so that internal state does not require history pagination or migrations.
57. As an Agent user, I want Agent and Quick Start actions to go through Electron Product Commands and ECC Runtime, so that authorization and confirmation remain in Studio while engineering execution remains in ECC.
58. As a Studio user, I want Project Comparison, QoR and Signoff to distinguish committed Engineering Snapshot facts from live Execution Snapshot overlays, so that running work is not presented as committed success.
59. As a Studio user, I want stale predecessor results labeled and revision-checked, so that previous evidence remains inspectable without being used as current execution input.
60. As a maintainer, I want existing on-disk Workspace filenames and schemas preserved in Phase 1, so that Runtime ownership migration is not conflated with a disk-format migration.
61. As a maintainer, I want no raw-file fallback for an invalid current Snapshot, so that there is one Studio engineering fact source and no silent mixed-version interpretation.
62. As a maintainer, I want ECC and Studio changes released as one pinned update, so that every published Studio revision has a compatible ECC Runtime.
63. As a maintainer, I want packaged resources to contain one `ecc` executable and no Adapter binary, so that installation verifies the intended ownership boundary.
64. As a maintainer, I want cross-component tests to open an ECC-created Workspace in Studio and continue a Studio-created Workspace with CLI, so that the creator-independent contract is verified end to end.
65. As a maintainer, I want the final protocol cleanup tracked as a mandatory Phase 2, so that transitional aliases and duplicate read paths cannot remain indefinitely.

## Implementation Decisions

- ECC publishes one executable that supports normal CLI commands and the hidden private RPC
  entrypoint. ECOS Studio does not build or stage a second Runtime binary.
- The Runtime implementation is moved directly into ECC's Runtime namespace. Its established
  module responsibilities remain separate: transport, dispatch, requests, methods, server,
  stdio server, sessions, operations, recovery, events, diagnostics, Workspace API and
  Workspace Spec API. A forwarding package, symlink or duplicate implementation is not kept.
- The Runtime dependency currently owned by the Adapter becomes a direct ECC project dependency.
  The Adapter requirements file and second environment are deleted.
- ECC Engine is the only authority for Workspace lifecycle, configuration, execution, QoR,
  Signoff, Artifacts, Revision and Engineering Snapshot publication. Runtime translates requests
  and owns lifecycle state but does not reimplement engineering semantics.
- CLI writes for Workspace creation, Project-managed create/update, refresh, parameter mutation,
  rerun preparation, Layout save, Flow execution and overwrite all call ECC Engine transaction
  and commit APIs. CLI does not call Runtime and does not keep a competing Snapshot or parameter
  rollback implementation.
- CLI retains selector parsing, precedence, blocking lock behavior, command names, output
  records, exit codes and overwrite backup semantics. Engine receives canonical ordered Step IDs
  through `ExecutionPlan` and returns the expanded `ExecutionResult` contract.
- A complete target with no explicit rerun selector is an Engine no-op. It does not create an
  Operation, write Workspace files, advance Revision or refresh Engineering Snapshot.
- `report qor`, `report checklist` and `report summary` continue to write their requested or
  default report destination. That output is distinct from Engineering Snapshot publication.
- CLI `status`, `report step` and existing Signoff inspection retain their current file and Engine
  readers. Report and Signoff handlers that need a Workspace object use read-only hydration and
  cannot recover transactions, migrate files or append Workspace logs.
- Engineering Snapshot schema v2, filenames and stale predecessor behavior remain unchanged in
  Phase 1. ECC alone creates and atomically publishes the Snapshot; Electron reads and validates
  the persisted file directly.
- Engineering Snapshot validation covers JSON, schema, Workspace identity, Workspace Revision,
  section shape, declared Artifact references, size and content fingerprint. Missing, invalid,
  unsupported or inaccessible data returns a stable unavailable reason and never falls back to
  raw files or silently materializes a new Snapshot.
- Execution Snapshot is separate from Engineering Snapshot. Runtime reconstructs it from live
  Session state, Active Operation state and a bounded Ledger. Electron never persists a competing
  Operation state machine.
- The Operation Ledger keeps the active Operation and the 256 most recent terminal Operations.
  It is a recovery window, not a user-visible history; older entries and their command-id
  deduplication records may be removed.
- Workspace Revision is one monotonic sequence. Create starts at revision 1; durable configuration
  and structural updates, rerun preparation, Layout saves and each Flow Step Commit advance it.
  An Operation validates its starting Revision and adopts revisions produced by its own commits.
- Workspace Ownership Lock is one cross-process sibling lock shared by CLI and Runtime. CLI
  acquisition remains blocking; Runtime acquisition is fail-fast with `workspace_busy`, while a
  known same-Runtime conflict is `operation_conflict`.
- APIs that touch both Project Manifest and Workspace acquire `Project Manifest Lock` before
  `Workspace Ownership Lock`. Workspace-only and Manifest-only operations acquire only their own
  lock.
- Create and structural replacement use caller-owned staging trees and atomic exchange. A failed
  call may remove only its own staging tree or renamed-aside overwrite backup; it never deletes a
  pre-existing Workspace it did not create.
- A Flow Step Commit stages Flow state, Engineering Snapshot and commit metadata together. The
  replacement is validated and atomically published before `workspace.committed` is emitted. A
  Snapshot failure preserves the preceding committed set and fails the Operation.
- Layout Edit Session holds the Workspace Ownership Lock from begin through save, discard, close
  or process loss. Save commits before releasing the lock; process loss releases the kernel lock
  and publishes no uncommitted edit.
- Workspace Bindings are machine-local absolute paths applied at create, open and execute time.
  They are not written into the portable Descriptor or Project Manifest and do not advance
  Revision by themselves.
- Electron Product Commands remain the only entry for Agent, Quick Start and background product
  actions. Electron owns authorization, confirmation, path scope and Workspace selection before
  invoking Runtime, which invokes Engine.
- Known Engine failures are Stable Domain Errors. Runtime preserves their code, message and
  structured details in JSON-RPC; unknown exceptions degrade only to `command_failed` without
  exposing Python tracebacks.
- Phase 1 preserves current JSON-RPC method names, request/response fields, error codes and
  Runtime Events while changing ownership, packaging and launch command. Transitional aliases
  are internal and temporary.
- Phase 2 makes `rpc.hello` mandatory before business commands on the Control Runtime and every
  Workspace Runtime. The handshake returns private protocol version, ECC version and explicit
  capabilities; mismatch or missing capability returns `runtime_incompatible` before writes.
- Phase 2 removes `workspace.engineering_snapshot`, `adapterVersion`, `runtime.adapter.v1`,
  Adapter-named capabilities, compatibility DTOs, old field/error aliases, Adapter wrappers and
  duplicate Snapshot read paths.
- The rollout order is ECC implementation and package first, Studio gitlink and launch switch
  second, parity/smoke validation third, and protocol cleanup last. ECC and Studio are released
  as one pinned compatibility update.

## Testing Decisions

- Tests assert observable behavior at the highest available seam. They compare returned domain
  results, persisted files, revisions, errors, events and process boundaries rather than private
  helper calls or class layouts.
- The primary ECC seam is the public Engine contract and a real temporary Workspace. It covers
  lifecycle, Descriptor, configuration, Bindings, Revision, staging, Atomic Engineering Commit,
  ExecutionPlan, ExecutionResult, no-op, overwrite and Stable Domain Errors.
- The primary Runtime seam is framed stdio JSON-RPC. It covers handshake compatibility, Control
  Runtime and Workspace Runtime routing, Session lifecycle, Operation isolation, cancellation,
  recovery, Ledger cap, Runtime Events, Snapshot queries and Layout Edit lock lifetime.
- The primary Studio seam is the existing Backend Project/Workspace service boundary. It covers
  direct persisted Snapshot reads, schema and path validation, stale predecessor projection,
  Execution Snapshot overlay, invalidation, watcher behavior, generation handling and partial
  Workspace results.
- The cross-repository acceptance seam uses real ECC-generated and Studio-generated Workspaces.
  Each is opened, inspected, updated and continued by the other product; the assertions compare
  Descriptor identity, Revision, Flow, Snapshot, Artifact references and output behavior.
- ECC test suites covering Engine lifecycle/configuration/execution, Runtime operations/sessions/
  transport/stdio, CLI commands, Snapshot and Signoff remain the prior art. New tests extend the
  existing public-contract suites instead of creating a parallel test framework.
- Studio Electron Runtime, Project Comparison, Snapshot reader, watcher, Product Command,
  shutdown and renderer projection suites remain the prior art. Tests use existing fakes and real
  temporary directories at their current ownership boundary.
- Read-only tests verify that `status`, `report step`, `signoff inspect`, report generation and
  Snapshot reads do not perform migration, recovery, default-file creation or Workspace logging.
  Report destination writes are asserted separately as intentional command output.
- Commit tests verify that Flow state and Engineering Snapshot are both durable before a commit
  event, that failure preserves the previous committed set, and that no event is emitted on
  failure.
- Concurrency tests verify CLI blocking behavior, Runtime fail-fast `workspace_busy`,
  `operation_conflict`, Project-to-Workspace lock ordering, revision conflict and Layout lock
  lifetime across separate processes.
- Cancellation and recovery tests verify queued cancellation, Step-boundary cancellation,
  Force Quit interruption, process loss, duplicate/delayed/lost Events and requery recovery.
- Snapshot tests cover schema v2, identity/revision mismatch, missing/invalid/unsupported files,
  stale predecessor, declared Artifact fingerprint mismatch and direct Electron validation.
- Protocol tests verify Phase 1 aliases and wire parity, then Phase 2 mandatory hello, capability
  mismatch, removal of Adapter names and absence of the transitional Snapshot RPC.
- Packaging tests verify a single `ecc` executable, no Adapter binary or requirements file, the
  pinned ECC gitlink and a framed stdio smoke in the packaged environment.
- Merge gates require ECC Ruff, the full Python suite, PyInstaller and Runtime smoke; Studio
  frozen install, typecheck, lint/format, Electron/Renderer tests, build and desktop smoke; and
  parent packaging plus cross-component Workspace, overwrite, Snapshot, lock, background,
  Force Quit, report-output and Layout tests.

## Out of Scope

- Publishing an issue, applying a triage label, opening a pull request or pushing any branch.
- Keeping a second `ecos-studio-runtime`, `ecos-ecc-runtime-adapter` or `ecc-runtime` binary,
  forwarding package, symlink or parallel implementation.
- Rewriting Studio product policy, Renderer UI, Agent authorization, QoR algorithms, Signoff
  policy or Project Manifest ownership beyond the integration boundary described here.
- Migrating old Workspace formats, old Snapshot schemas or Snapshot-less Workspaces implicitly.
- Falling back from an invalid Engineering Snapshot to `flow.json`, raw analysis files, mtime or
  directory scans for committed Studio facts.
- Making every CLI read command a Snapshot reader. A future read-model unification is a separate
  decision; Phase 1 preserves existing CLI query and report behavior.
- Making Engineering Snapshot a user-visible history store, adding Snapshot time travel or
  retaining an unbounded Operation Ledger.
- Adding two-phase commit for Project Manifest and Workspace, a general event bus, fixed polling,
  retry loops, persistent Electron caches, a generic Artifact browser or a new worker solely for
  this migration.
- Changing the on-disk filenames/schema in Phase 1, including `params.toml`, `flow.json`,
  Engineering Snapshot schema v2, stale Snapshot, Workspace command ledger and Runtime command
  ledger.
- Running a full RTL-to-GDS flow as routine setup verification; focused tests and packaged smoke
  are the required implementation checks.

## Further Notes

- The working baseline is a new combined Studio worktree based on the latest
  `origin/ekko/refactor-backend-architecture`, with its ECC submodule on a new branch based on
  the latest `origin/main`. The Studio gitlink is pinned to the local ECC documentation commit
  before implementation changes begin.
- The ECC-side implementation plan is maintained with the ECC Engine documentation. The Studio
  ADR records ECC ownership of the private Runtime and supersedes the earlier Studio-owned
  Adapter decision.
- The most important invariant is ownership, not the presence of a particular JSON file:
  Engineering Snapshot remains because Studio needs one atomic committed read model; CLI does not
  need to consume it for ordinary inspection.
- The first implementation slice should establish the ECC Runtime process and Engine commit
  parity before deleting any Studio Adapter packaging. This keeps every intermediate Studio
  revision runnable.
- Phase 2 cleanup is mandatory acceptance work. Leaving compatibility names, duplicate Snapshot
  reads or Adapter packaging after Phase 1 is not considered completion.
