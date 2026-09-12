# ECC Runtime 与 Runtime Adapter 行为等价及 Snapshot 一致性 v1

状态：已确认，准备实施

发布状态：仅保存在仓库，不发布 issue，不创建 PR，不推送远端

## Problem Statement

ECOS Studio 从 `ecos-runtime-adapter` 迁移到 ECC Runtime 后，使用新 Workspace 执行
Flow 时出现间歇性工程数据异常：Synthesis 完成后 Snapshot 数据可以正常显示，继续执行
后续 Step 时页面或 Snapshot 区域暂时没有数据，等待一段时间后又恢复。

旧的 `ecos-runtime-adapter` 重构版本已经验证过同一类工作流没有该问题，而且旧版本也
没有依赖 GUI ACK 阻塞 ECC 执行。因此问题不能简单归因于“取消 GUI ACK”，而是 ECC Runtime
在迁移时没有完整保留旧 Adapter 的 commit、revision、Operation Event 和 Workspace
hydration 语义。

当前风险包括：

- Engineering Snapshot 已经提交到新 revision，但 `step.completed` Event 或 Operation
  状态仍然携带旧 revision，导致 Backend 查询和 Renderer 请求使用不一致的 revision。
- Snapshot commit 被移动到 ECC Runtime 的 observer wrapper 后，没有把真实 committed
  revision 传回 Operation manager。
- 当前 Operation manager 只在 `Success` 时自增 revision，`Incomplete`、`Invalid` 等
  已经写入 Snapshot 的 terminal state 没有对应 revision。
- `rerun_prepared` 的 reset revision 没有完整进入 Runtime Event。
- `workspace.snapshot` 不再在内存 Flow 数据为空时回退到持久化 `flow.json`。
- ECC 当前将旧的 `Floorplan` 拆为 `preFloorplan`、`macroPlacement` 和 `postFloorplan`，
  但 Studio 的 Step metadata、Snapshot 视图和布局 Artifact 过滤仍主要识别旧名称。
- Renderer 在 revision 变化时会先清空未缓存的 Step data；连续 commit 或短暂查询失败时，
  这会把“正在刷新”显示成“没有数据”。

需要一个以旧 Adapter 已验证行为为基线的 ECC Runtime parity 方案，修复 ECC producer
和 Runtime Event 的一致性，同时保持无 GUI ACK 的非阻塞架构，并补齐 Studio 对新 ECC
Flow vocabulary 的展示契约。

## Solution

将 ECC Runtime 视为旧 Adapter 的行为等价实现，而不是仅进行代码归属迁移。Engineering
Snapshot 是 committed engineering facts 的唯一来源，Runtime Event 只是触发查询的
瞬态提示，Operation 是执行状态的唯一来源。

每个实际执行的 Flow Step 使用以下固定顺序：

1. Engine 持久化 Step 的 terminal state。
2. ECC Runtime 提交一次 Engineering Snapshot，并获得新的 committed Workspace Revision。
3. Operation 采用该 committed Revision，生成对应的 Step Commit ID。
4. Runtime 发布携带相同 Revision 的 `step.completed` Event。
5. ECC 继续执行后续 Step，不等待 GUI ACK。

Renderer 和 Backend 根据 Event 重新读取最新的 Snapshot，不从 Event 顺序、旧文件或本地
路径推导工程事实。刷新期间保留上一版已验证数据，新的 revision 验证完成后再替换；如果
新 revision 暂时不可读，则显示 stale/unavailable 状态而不是清空整个页面。

ECC 保留真实的 `preFloorplan`、`macroPlacement` 和 `postFloorplan` Step ID。Studio 将
它们映射到同一个 Floorplan 展示域，同时保留旧 `Floorplan` Workspace 的兼容别名。

## User Stories

1. As a chip designer, I want Synthesis results to remain visible while later Flow Steps run, so that committed engineering facts are not hidden by transient execution.
2. As a chip designer, I want Snapshot data to update after every committed Step, so that progressive Flow results are available before the full Flow finishes.
3. As a chip designer, I want a temporary refresh delay to show the last verified data as stale instead of an empty page, so that I can distinguish unavailable data from no data.
4. As a chip designer, I want a failed Step to preserve the preceding readable Snapshot, so that a failed Operation cannot erase previously committed results.
5. As a chip designer, I want an incomplete or invalid Step to expose its committed state and revision, so that failure evidence is queryable and consistent.
6. As a chip designer, I want rerun preparation to visibly reset affected results before the rerun begins, so that stale predecessor facts are not mistaken for current results.
7. As a chip designer, I want a rerun to publish one reset revision followed by one revision per actual Step commit, so that the progress shown by Studio is monotonic and explainable.
8. As a chip designer, I want the page to recover automatically after a delayed or lost Runtime Event, so that correctness does not depend on receiving every notification.
9. As a chip designer, I want the Snapshot page to show Floorplan facts during pre-floorplan, macro placement and post-floorplan, so that the new ECC Flow does not create an apparent data gap.
10. As a chip designer, I want old Workspaces containing a `Floorplan` Step to continue rendering, so that the vocabulary migration does not invalidate existing projects.
11. As a chip designer, I want layout images produced by new ECC Step IDs to remain visible in Home, so that valid artifacts are not filtered out by legacy allowlists.
12. As a chip designer, I want Step detail requests to be tied to the current Workspace Context and Revision, so that late responses cannot overwrite newer data.
13. As a chip designer, I want switching Workspaces to clear the previous Workspace immediately, so that data never leaks across Workspace contexts.
14. As a chip designer, I want opening an active Workspace after a restart to restore its Flow and Operation facts, so that recovery does not depend on in-memory Flow data.
15. As a chip designer, I want `workspace.snapshot` to return persisted Flow steps when the in-memory Flow is empty, so that recovery and signoff export see the same Workspace state as the files.
16. As a Studio user, I want no GUI render acknowledgement to block ECC execution, so that long-running flows are not coupled to a renderer window.
17. As a Studio user, I want Runtime Events to act only as refresh hints, so that duplicate, delayed or lost Events cannot change committed engineering facts.
18. As a Studio user, I want Operation status to distinguish queued, running, cancelling, failed, interrupted and succeeded states, so that transient execution is not confused with committed engineering state.
19. As a Studio user, I want a same-Workspace Operation conflict to be reported explicitly, so that a duplicate command is not mistaken for a Snapshot failure.
20. As a Studio user, I want cancellation to take effect at a safe Step boundary, so that the current EDA tool is not terminated unsafely.
21. As an ECC maintainer, I want one Runtime observer to own the Step Snapshot commit handoff, so that duplicate observers cannot advance Revision twice.
22. As an ECC maintainer, I want every published Step Commit Event to carry the exact Revision written to Engineering Snapshot, so that consumers share one authoritative version.
23. As an ECC maintainer, I want Operation Revision to adopt a committed Revision supplied by the Snapshot commit, so that Operation state never diverges from persisted facts.
24. As an ECC maintainer, I want Success, Incomplete and Invalid terminal states to follow the same commit protocol, so that failure paths cannot create a revision gap.
25. As an ECC maintainer, I want skipped already-successful Steps to remain non-mutating, so that a no-op resume does not create fake Snapshot revisions.
26. As an ECC maintainer, I want rerun preparation to publish its committed reset Revision, so that Renderer invalidation and Runtime state use the same generation.
27. As an ECC maintainer, I want snapshot commit failures to fail the Operation before a successful Step Commit Event is published, so that Events never advertise non-durable facts.
28. As an ECC maintainer, I want Event publication failures not to roll back an already committed Snapshot, so that durable engineering facts remain readable even when a consumer is disconnected.
29. As an ECC maintainer, I want the Operation ledger to preserve command identity and active Operation recovery, so that Runtime restart does not create duplicate work.
30. As an Electron maintainer, I want Backend Workspace queries to retain the last verified projection during refresh, so that transient filesystem or IPC delays do not blank the UI.
31. As an Electron maintainer, I want invalidation callbacks to coalesce to the newest Workspace Revision, so that a fast Flow does not create an unbounded refresh storm.
32. As an Renderer maintainer, I want stale asynchronous responses to be discarded by Context and Revision, so that an older request cannot replace newer Snapshot data.
33. As a CLI user, I want CLI-created Workspaces and Studio-created Workspaces to share the same Snapshot and Revision semantics, so that switching creators does not change data correctness.
34. As a CLI user, I want existing Flow and report commands to preserve their current behavior while Runtime ownership changes, so that this fix does not alter automation semantics.
35. As a release maintainer, I want the ECC submodule and Studio integration to be pinned as one compatible update, so that the shipped renderer, Electron process and ECC Runtime agree on the same contract.
36. As a test maintainer, I want the proven Adapter no-ACK scenarios to run against ECC Runtime, so that parity is verified by behavior rather than by file similarity.
37. As a test maintainer, I want delayed refresh, failed Step, rerun, skipped Step and Runtime restart scenarios covered, so that the transient blank state cannot regress silently.
38. As a support engineer, I want diagnostic records to include Snapshot Revision, Event Revision and Operation Revision, so that a reported blank page can be classified without reproducing the full EDA run.

## Implementation Decisions

- The external seam is the ECC Runtime's public Workspace Operation and Workspace Query
  interface. ECC Engine remains the owner of Workspace, Flow, Snapshot, Artifact, QoR and
  Signoff semantics; Runtime owns Sessions, Operations, Events, cancellation and recovery.
- The migration keeps the no-GUI-ACK rule. `wait_for_step_rendered` may remain as a compatibility
  method, but it must never gate Engine Flow progress or turn a renderer failure into a tool
  failure.
- There is exactly one Snapshot commit owner for a Step completion. The Runtime Operation
  coordinator injects a Snapshot committer into its Flow observer, and the observer returns the
  committed Revision to the coordinator before the completion Event is published.
- The temporary `_RuntimeSnapshotObserver` style wrapper is not allowed to commit independently
  of the Operation observer. If a wrapper remains for delegation, it must pass the committed
  Revision through the same observer interface and must never perform a second commit.
- The Operation start interface accepts the validated Adapter behavior needed for this flow:
  Snapshot committer, initial Workspace Revision, command-specific input identity, precondition
  validation and persistent ledger location. Existing idempotency and conflict behavior remains.
- The Flow observer exposes the validated Adapter behavior needed by Engine: Step start,
  terminal completion, diagnostics, Subflow stage, skipped Step, rerun preparation, cancellation
  checks, runtime operation marker and one-shot Snapshot commit recording.
- A real terminal Step completion follows this order: persist terminal Flow state, commit the
  Engineering Snapshot, adopt the returned Revision in Operation state, persist Operation ledger,
  then publish `step.completed` with `workspaceRevision` and `stepCommitId`.
- The `workspaceRevision` in `step.completed`, Operation status, `operation.rerun_prepared` and
  the persisted Engineering Snapshot must be identical for the same commit. An Event without a
  revision is valid only for a non-mutating skipped Step.
- If the committer returns a Revision, the Operation adopts it rather than calculating a local
  increment. Local increment is only a defensive fallback for callers that do not provide a
  committer and is not used by the Workspace execution path.
- `Success`, `Incomplete` and `Invalid` terminal states all use the same Snapshot handoff. A
  failed Snapshot commit preserves the previous readable Snapshot and produces a stable
  `engineering_snapshot_commit_failed` Operation error.
- A Step that is already successfully persisted and is skipped during a non-rerun resume does
  not commit a new Snapshot and does not advance Workspace Revision. Its transient completion
  Event remains distinguishable as `Skipped`.
- Flow and Step rerun preparation first commits the reset Snapshot, then publishes
  `operation.rerun_prepared` with its Revision and affected Step IDs, then starts execution.
  Reset and Step completion revisions are monotonic and never reused.
- The Engine execution observer forwards all Runtime observer methods but does not invent a
  second commit or re-enable render waiting. Observer failures follow the ownership rule:
  Snapshot commit failure is fatal to the Operation; Event consumer failure is non-fatal after
  durable commit.
- `workspace.snapshot` reads the in-memory Flow when hydrated and falls back to the Flow's
  persisted Step loader when it is not. This read is side-effect bounded and does not create a
  new Runtime Operation.
- Workspace open, create, recovery and execution use the same Flow hydration rules. A valid
  persisted Flow must not become an empty in-memory Flow solely because the Runtime Session was
  reopened.
- Engineering Snapshot remains the only committed engineering read model. Runtime Operation
  data is a transient execution overlay; neither Renderer nor Electron may reconstruct committed
  facts from Event order or raw tool files.
- Studio-facing Flow projections preserve ECC canonical Step IDs and add a presentation grouping
  for `preFloorplan`, `macroPlacement` and `postFloorplan`. The legacy `Floorplan` name remains a
  read compatibility alias only.
- Floorplan insight generation treats all three new physical Step IDs as members of the Floorplan
  display domain. Layout image and geometry selection includes those IDs, while Artifact ownership
  remains tied to the canonical ECC Step ID.
- Unknown future Step IDs receive a generic typed fallback and are not silently dropped from the
  Flow projection. They may be unavailable for specialized charts until explicit metadata is
  added, but the page must still expose the Step and its valid generic facts.
- Renderer Runtime Event handling remains fire-and-forget, but refreshes are coalesced per
  Workspace Context. Only the newest pending Revision is authoritative for the next refresh.
- A revision change moves a projection to `refreshing` while retaining the last verified data.
  Data is replaced only after Context, Revision and section validation succeed. A failed refresh
  produces `stale` or `unavailable` metadata without replacing valid prior data with null.
- Detail and Artifact requests carry Workspace Context and expected Revision. Late responses,
  mismatched revisions, mismatched Artifact identity and responses from a closed Workspace are
  discarded without mutating current data.
- Backend Workspace projection retains its committed data during `refreshing`, stale reads and
  bounded retry. A newer valid Snapshot that regresses a previously non-empty section to an empty
  or unavailable section is rejected as an invalid commit candidate and does not replace the last
  verified projection.
- Existing Snapshot atomic-write behavior is retained. Partial JSON files are not treated as a
  normal consistency mechanism; read failures are explicit and recover through invalidation or
  retry.
- The existing operation ledger remains bounded. Active Operations are recoverable after Runtime
  restart, terminal records remain within the established cap, and command identity prevents
  duplicate starts.
- Existing cancellation, shutdown barrier, Layout Edit ownership, signoff export and dedicated
  Artifact capabilities remain behavior-compatible unless they are required to preserve the
  commit/revision ordering above.
- The fix is implemented first in ECC Runtime, then in Studio vocabulary and refresh consumers.
  No Studio workaround is accepted as the only fix for an ECC revision mismatch.
- The current local Backend projection guard may remain as a defensive containment layer during
  rollout. It is not considered evidence that ECC commit/revision consistency is fixed.
- ECC and Studio are released as one pinned compatibility update. A parent gitlink must not point
  at an unpublished ECC commit.

## Testing Decisions

- Tests cross the highest practical seam first: the public ECC Runtime Workspace Operation
  interface, a temporary Workspace, a real persisted Engineering Snapshot and the emitted Runtime
  Event stream. Tests assert observable ordering, revisions, errors and durable files, not private
  helper layout.
- The primary parity fixture models a multi-Step Flow beginning with Synthesis and continuing
  through LEC, pre-floorplan, macro placement and post-floorplan. It uses a controllable Snapshot
  committer so the expected committed Revision is explicit.
- The no-ACK parity test runs multiple successful Steps without any renderer acknowledgement and
  verifies that the Operation completes, each Snapshot is committed once and each Event carries
  the matching Revision.
- Terminal-state parity tests cover Success, Incomplete and Invalid. For every mutating terminal
  state they verify equal Snapshot, Operation and Event Revisions; for a failed Snapshot commit
  they verify preservation of the preceding Snapshot and a stable Operation error.
- Skipped-Step tests verify that a non-rerun resume does not advance Revision or create a fake
  Snapshot commit, while still publishing the expected transient Step completion state.
- Rerun tests verify reset Snapshot publication, affected Step IDs, reset Revision ordering and
  subsequent Step commit Revisions. They cover both full Flow and single-Step rerun.
- Observer tests verify cancellation checks, runtime operation markers, Subflow progress,
  diagnostics and error preservation. A failed observer consumer must not roll back a durable
  Snapshot; a failed Snapshot committer must not publish a successful completion Event.
- Workspace hydration tests reopen a Workspace with empty in-memory Flow data and verify that
  `workspace.snapshot` returns persisted Flow steps. They also verify that normal open and create
  paths hydrate the same canonical Flow.
- Ledger and restart tests verify active Operation recovery, command idempotency, bounded
  terminal records and monotonic sequence/revision behavior after Runtime restart.
- Step vocabulary tests use old `Floorplan` and new `preFloorplan`, `macroPlacement` and
  `postFloorplan` fixtures. They verify Flow projection, Floorplan insights, layout image
  selection, generic unknown-Step fallback and canonical Artifact ownership.
- Backend projection tests verify that a temporary read failure, stale revision or invalid newer
  Snapshot retains the last verified projection. A valid newer Snapshot replaces it only after
  identity, schema, revision and section validation.
- Renderer refresh tests use controllable delayed and reordered requests. They verify that a
  revision change retains old data while loading, only the newest Context/Revision response is
  accepted, and a failed refresh becomes stale/unavailable rather than nulling the page.
- Refresh coalescing tests emit several rapid Step Commit Events and verify that consumers converge
  on the newest Revision without unbounded concurrent queries or stale response replacement.
- Cross-process integration tests run a complete new Workspace Flow with no GUI ACK, a failed
  intermediate Step, a rerun, a skipped Step and a Runtime restart. They compare the persisted
  Snapshot, Operation status, Event payload and rendered projection after every transition.
- External-commit tests modify the persisted Snapshot through the supported CLI/Engine path while
  Studio is open, then verify that invalidation and focus refresh converge without requiring a
  Runtime Event from the original Operation.
- Regression tests retain the proven `ecos-runtime-adapter` operation and Workspace API cases as
  prior art. The cases are ported to ECC Runtime rather than weakened to match the new
  implementation.
- Validation is staged: ECC Runtime unit and integration tests first; Electron Backend projection
  tests second; Renderer composable and component tests third; then the full non-packaging CI
  equivalent for all changed components.
- Acceptance requires no unexplained blank interval in the new Workspace flow. A short loading
  indicator is acceptable, but previously committed Snapshot data must remain visible until a
  newer validated projection is ready.

## Out of Scope

- Reintroducing GUI render ACK as a blocking condition for ECC execution.
- Changing the ECC Flow algorithm, EDA tool behavior, QoR scoring rules, Signoff policy, timing
  thresholds or Artifact contents.
- Redesigning Home, Snapshot, Step Dashboard, LayoutView or Chip Viewer visual layout.
- Adding a generic Event bus, a second Snapshot store, a persistent history database or a new
  cross-process synchronization framework.
- Replacing the Engineering Snapshot with raw Flow files, report scans or a Renderer-side parser.
- Supporting arbitrary filesystem reads, recursive Artifact browsing or unbounded directory scans.
- Changing CLI command names, selectors, exit codes or report output semantics except where the
  existing commit/revision contract must be preserved.
- Migrating Frontend Workspace, ECC-FE Runtime or Frontend-specific Flow stages.
- Historical Snapshot browsing, time travel or user-visible revision comparison beyond existing
  stale predecessor behavior.
- Removing the existing Backend defensive regression guard before ECC Runtime parity and end-to-end
  validation pass.
- Publishing an issue, creating a pull request, pushing a branch or changing unrelated dirty
  worktree files as part of this spec.

## Further Notes

- The old Adapter behavior is the compatibility reference because it was already validated in the
  target workflow. The migration is considered incomplete until its no-ACK, revision, rerun,
  recovery and Workspace snapshot behaviors are represented in ECC tests.
- The most important invariant is: one durable Step commit produces one Snapshot Revision, one
  matching Operation Revision and one matching `step.completed` Event. Any diagnostic that shows
  these values diverging is an ECC Runtime defect, not a Renderer timing issue.
- The no-ACK architecture is intentionally asynchronous. Its correctness depends on durable
  Snapshot publication and revision-aware consumers, not on renderer speed or event delivery.
- The current symptom may have more than one visible manifestation. A revision mismatch produces
  transient empty data; unsupported new Step IDs produce a stable missing specialized panel; both
  must be covered so that fixing one does not hide the other.
- The implementation should be landed in small, reviewable slices: ECC commit/revision parity,
  Workspace hydration parity, Studio Step vocabulary, Renderer refresh retention/coalescing and
  finally end-to-end validation.
- Existing uncommitted Backend Workspace service changes are treated as user-owned and preserved.
  They may protect the UI from a regressed Snapshot during rollout, but they are not the source of
  truth for the ECC Runtime fix.
- This document is a repository-local implementation spec only. It intentionally does not create
  or publish an issue.
