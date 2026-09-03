# Backend 已提交工程事实 Snapshot-only 收敛 v1

状态：已实现（2026-09-03）

实现结果：Backend Workspace Overview、baseline、Flow Insights、Step Dashboard、
Subflow、LayoutView 与 Recent Projects 已收敛到持久化 Engineering Snapshot 和
revision-bound typed Artifact query。Renderer 的旧 DB/DRC/STA/Step 文件拼装、Home
dead insight scan、Runtime Snapshot fallback 与 Overview Resource Index 扫描已移除。
Logs、配置编辑、报告/导出、Chip Viewer 与 Frontend Workspace 继续使用各自的专用能力。

## Problem Statement

ECOS Studio 已经把 Backend Workspace 的 Flow、Configuration、Checklist、QoR、baseline comparison 和 Key Metrics 迁移到 Engineering Snapshot 与 Electron ReadModel，但同一页面和相邻工作流仍保留多条原始文件读取路径。

Home Flow Insights 会从每个 Step 的 Flow、QoR、DB、DRC 和 STA 文件重新组装工程结论；单 Step Dashboard 与 Subflow 会批量读取 Step detail 文件；Recent Projects 会在 Renderer 中重新解释 Flow 和 Parameters 并把结果持久化到 Settings。Backend Workspace Overview 虽然优先读取持久化 Engineering Snapshot，仍会在失败时通过 Runtime Adapter 获取 Snapshot，并为 idle Workspace 创建临时 Runtime Session；同时每次 Overview 查询仍构建完整 Workspace Resource Index，即使实际只需要已授权的 Workspace root。

这些路径使同一个 Workspace 的已提交事实可能来自不同 revision，导致运行中数据缺漏、成功结果回退、页面之间结论不一致、自失效查询和无意义的文件扫描。它们也使 Snapshot 损坏或不完整时被 legacy fallback 掩盖，违背“Event 承载瞬态运行状态，Query 返回已提交事实”的既有架构决定。

## Solution

将 Backend Workspace 所有正常页面使用的已提交工程事实收敛到一份经过边界校验的 Engineering Snapshot。Electron 从已授权 Workspace scope 直接读取持久化 Snapshot，构建 Workspace Overview、Flow Insights 和按需 Step detail ReadModel；Renderer 只持有这些 typed projection、Runtime execution overlay 和 UI 状态，不读取或解释原始工程文件。

Flow Step Commit、Rerun preparation 和 Workspace migration 负责生成单调递增的 Snapshot revision。Runtime Event 只表达 queued、running、cancellation requested、log 和 Subflow progress 等瞬态状态，并在 commit 后触发 revision-aware refresh，不能成为已提交事实或 fallback。

正常渲染所需的有界结构化事实直接进入 Snapshot。大型布局图、拥塞图、详细 timing path 和其他必须按需加载的内容使用明确声明、带 size 与 SHA-256 的 typed Artifact reference，并通过专用、非路径型、revision-bound 查询读取。不得重新引入通用 Artifact browser、递归目录扫描或 raw JSON fallback。

## User Stories

1. As a chip designer, I want Home to show one internally consistent committed revision, so that Flow, QoR, Key Metrics and Flow Insights never describe different runs.
2. As a chip designer, I want completed Step data to remain visible while a later Step is running, so that transient execution does not erase committed results.
3. As a chip designer, I want each successful Step commit to update Dashboard facts, so that metrics appear progressively without waiting for the full Flow to finish.
4. As a chip designer, I want Flow Insights to use the same normalized metrics as QoR and Project Comparison, so that counts, areas, timing and DRC values agree across pages.
5. As a chip designer, I want DB trends to be built from committed per-Step metrics, so that a trend cannot combine files from different revisions.
6. As a chip designer, I want instance composition to use committed normalized records, so that Macro, Standard Cell and IO Pad counts remain revision-consistent.
7. As a chip designer, I want DRC summaries to use committed analysis facts, so that violation state agrees with QoR and Signoff presentation.
8. As a chip designer, I want STA summaries and critical paths to be tied to the current revision, so that old corner results cannot appear beside new Flow state.
9. As a chip designer, I want opening a Step Dashboard to show the selected Step from the current Snapshot, so that switching pages does not trigger an independent interpretation of Workspace files.
10. As a chip designer, I want Step QoR metrics, summaries and hotspots to come from one validated analysis revision, so that the Step page cannot mix current and stale artifacts.
11. As a chip designer, I want Step Checklist data to agree with the Workspace Checklist, so that reconciliation happens once at the backend boundary.
12. As a chip designer, I want Subflow completion shown as committed data after Step commit, so that rerun confirmation does not depend on an unverified local file.
13. As a chip designer, I want live Subflow progress to remain responsive, so that moving committed data to Snapshot does not remove Runtime Event feedback.
14. As a chip designer, I want layout and congestion previews to load on demand, so that normal Overview queries remain bounded and fast.
15. As a chip designer, I want unavailable or stale preview artifacts to be identified explicitly, so that the UI does not silently display a file from another revision.
16. As a chip designer, I want Recent Projects cards to show the last verified committed summary, so that their status and progress agree with the Workspace when reopened.
17. As a chip designer, I want stale Recent Projects data identified as last verified data, so that a missing Workspace is not presented as current.
18. As a chip designer, I want an invalid Snapshot to produce a stable unavailable reason, so that corruption is not hidden by raw Flow or Feature fallback.
19. As a chip designer, I want a selected unavailable baseline to remain selected, so that the application does not silently compare against another Workspace.
20. As a chip designer, I want opening Home for an idle Workspace to remain read-only, so that viewing results does not start a sidecar or recover operations.
21. As a chip designer, I want viewing baseline QoR to remain read-only, so that historical comparison cannot create Runtime Sessions.
22. As a chip designer, I want external CLI commits to appear after Snapshot invalidation, so that correctness does not depend on an ECOS Studio-owned Runtime Event.
23. As a chip designer, I want manual Refresh to reread the current Snapshot revision, so that I can recover when native file watching is unavailable.
24. As a chip designer, I want a refresh to retain the last verified projection until a new revision is validated, so that temporary read failures do not blank the page.
25. As a chip designer, I want switching Workspace to discard the previous projection immediately, so that no data leaks visually between Workspace contexts.
26. As an ECOS maintainer, I want Engineering Snapshot to be the only authority for committed Backend engineering facts, so that each fact has one producer and one interpretation path.
27. As an ECOS maintainer, I want Runtime Events to remain a separate execution overlay, so that delayed or duplicated events cannot rewrite committed state.
28. As an ECOS maintainer, I want Workspace Overview to avoid building a full Resource Index, so that a lightweight query does not scan every Step, report and technology resource.
29. As an ECOS maintainer, I want current and baseline Workspace Snapshots read through the same bounded validator, so that their security and data-quality semantics cannot diverge.
30. As an ECOS maintainer, I want Renderer code to receive typed domain DTOs instead of paths and raw JSON, so that filesystem orchestration stays in Electron.
31. As an ECOS maintainer, I want detail Artifact reads tied to Engineering Workspace ID and revision, so that late responses cannot enter a newer projection.
32. As an ECOS maintainer, I want Snapshot migration to preserve Workspace identity and monotonic revision, so that existing Workspaces gain new fields without legacy fallback.
33. As an ECOS maintainer, I want absent optional metrics represented as unavailable, so that the GUI never manufactures zeroes or guesses values.
34. As an ECOS maintainer, I want obsolete Renderer parsers, caches and resource-version watches deleted with their final consumer, so that the migration does not leave dual-read compatibility code.
35. As an ECOS maintainer, I want explicit product Artifact references instead of recursive inventory, so that Snapshot size and file access remain structurally bounded.
36. As an ECOS maintainer, I want no Runtime Session creation during committed-fact queries, so that reads cannot conflict with active operations or trigger self-invalidation.
37. As an ECOS maintainer, I want query metrics to distinguish Snapshot reads from on-demand Artifact reads, so that regressions in file count, bytes and event-loop delay are observable.
38. As an ECOS maintainer, I want Backend and Frontend Workspace behavior to remain isolated, so that this migration does not alter ECC-FE workflows.

## Implementation Decisions

- Engineering Snapshot remains the authoritative persisted record for Backend committed facts. Project Manifest remains the authority for Project identity, Workspace membership, baseline selection and lifecycle metadata; Runtime Operation remains the authority for transient execution state.
- Workspace Overview obtains the canonical Workspace root from the current authorized window scope. It does not build a Workspace Resource Index merely to rediscover the root or collect query metrics.
- Workspace Overview reads the current Workspace and optional baseline Workspace through the same bounded, schema-validating persisted Snapshot reader. A missing, invalid, unsupported, oversized or inaccessible Snapshot returns a stable section or Workspace issue and never falls back to Runtime Adapter, Flow files, Parameters files or Feature files.
- Committed-fact queries must not open or close a Workspace Handle, start a per-Workspace sidecar, recover interrupted operations or emit Runtime lifecycle events. Runtime Adapter access remains limited to commands, active Operation queries and transient event streams.
- Backend Workspace Context owns generation, one current committed projection and same-generation request coalescing. Commit notification, native Snapshot replacement, explicit Refresh and focus-time revision check enter the same invalidation path.
- Normal Flow Insights facts are projected in Electron from Snapshot Flow and normalized per-Step analysis records. Runtime, peak memory, physical counts, areas, utilization, routing, DRC and timing summaries must not be recalculated from raw files in Renderer.
- ECC adds any product-required bounded Flow Insights and Step Dashboard facts that are not yet represented by normalized metrics or analysis records. New records use stable identifiers, units, dimension, polarity, scope, role, confidence and source metadata. Display-only facts use non-scoring ratings and do not change QoR score or gates.
- Engineering Snapshot embeds bounded structured Step facts used for normal rendering, including committed Subflow summaries where required. It does not embed entire DB, map, report or timing-path payloads.
- Large or selectively viewed content uses explicitly declared typed Artifact references. Each reference includes product kind, owning Step, availability, size and SHA-256 and is resolved inside the authorized Workspace only.
- Flow Insights and Step detail Artifact queries accept Workspace Context plus product identity such as Step and detail kind. Renderer cannot submit a local path. Electron resolves the reference from the validated current Snapshot and verifies identity, revision, size, hash and path containment before returning content.
- Flow Insights loads only data needed by the active module. Congestion images, detailed statistics and timing paths are not fetched merely because Home mounted.
- Single Step Dashboard receives one typed Step detail projection. Embedded metrics, summary, hotspots, checklist and Subflow facts come from the current Snapshot; optional large details are loaded through the revision-bound Artifact query.
- LayoutView continues using a dedicated image capability, but thumbnail metadata comes from declared Snapshot references instead of Renderer path inference. Chip Viewer remains a separate native capability.
- The unconsumed Home insight snapshot model and its DB, DRC and image reads are deleted rather than migrated.
- Recent Projects Settings retain user history and Workspace locators. Engineering status, progress, runtime and configuration summaries come from a typed committed Workspace summary. A retained last-verified presentation cache carries revision and freshness metadata and is never treated as a current engineering authority.
- Existing Snapshot structures are extended only with domain facts and declared product references. No Widget-named payload, raw JSON bucket, generic key-value extension, recursive Artifact inventory or generic file-content API is added.
- A structural Snapshot contract change increments the schema version. ECC migrates a supported older Snapshot by rebuilding from authoritative Workspace state, preserving Engineering Workspace ID, incrementing Workspace revision and recording a migration cause. Unsupported versions remain explicitly unavailable.
- Rerun preparation commits its reset revision before execution overlay is applied. Each later successful or failed Step commit produces the next revision before consumers refresh.
- Renderer stores only the current committed projection, transient execution overlay and UI state. It may format units, labels, chart series and selected filters but cannot infer engineering status, merge revisions or parse raw Workspace payloads.
- Migration is completed consumer by consumer. The raw file parser, local cache, resource-version watch and fallback are removed in the same change that switches the final production consumer.
- Existing Key Metrics snapshot-only projection and Project Comparison persisted Snapshot loading are retained as prior art and must not regain raw file fallbacks.
- Implementation order is: persisted Workspace and baseline Snapshot acquisition; removal of Overview Resource Index scan; Flow Insights projection; Step detail and Subflow projection; Recent Projects summary; removal of dead Home scans.

## Testing Decisions

- Tests assert public behavior and cross-process contracts, not private helper structure, parser call order or Vue ref implementation.
- The primary GUI seam is the public Backend Workspace Overview API using a real temporary Project, Project Manifest and persisted Engineering Snapshot. It verifies identity, configuration, Flow, Checklist, QoR, baseline comparison, Key Metrics and Flow Insights from one revision.
- The Overview seam asserts that a query performs bounded persisted Snapshot reads only. Runtime open, recover, engineering-snapshot RPC and close are test failures; full Workspace Resource Index construction is also a test failure.
- Current and baseline tests use different Engineering Workspace IDs and revisions. They verify that the selected baseline is preserved, unavailable baseline data remains explicit and no alternative baseline is selected.
- Snapshot failure tests cover missing file, invalid JSON, unsupported schema, invalid identity, invalid revision, oversized input, unsafe path and section-level invalid data. No case may recover through legacy raw files or Runtime Adapter.
- The second GUI seam is the typed Step detail query because detail loading is intentionally on demand. It verifies Step identity, current revision, embedded summary facts, declared Artifact resolution and stale-response rejection.
- Step detail Artifact tests cover reference missing, file missing, size mismatch, SHA-256 mismatch, symlink escape, oversized content, invalid JSON and Snapshot revision change.
- ECC producer tests are the cross-language persistence seam. A representative multi-Step Workspace fixture verifies complete normalized metrics, Flow Insights facts, committed Subflow summaries, declared product Artifact references, Engineering Workspace identity and monotonic revision.
- ECC tests verify that display-only Macro, Standard Cell, IO Pad and other presentation metrics remain non-scoring and do not change existing QoR score or gate results.
- Snapshot migration tests start with a supported older schema and verify identity preservation, revision increment, migration cause and regenerated facts. Unsupported schemas remain unavailable without raw fallback.
- Runtime integration tests verify that Step start and Subflow progress affect only the transient overlay, while Step commit invalidates and reloads the next Snapshot revision.
- Rerun tests verify reset revision ordering, removal of affected committed Step details and rejection of old revision Artifact responses.
- Home component tests use typed Backend DTO fixtures and verify that Flow Insights modules retain their visible data, empty states, ordering and interactions without mocking filesystem APIs.
- Step Dashboard component tests use typed Step detail fixtures and preserve current charts, metrics, drill-downs, preview behavior and empty states.
- Recent Projects tests verify that cards use the last verified committed summary, mark stale or unavailable data correctly and do not parse Flow or Parameters files in Renderer.
- Layout tests verify that only visible thumbnails are requested, Blob URLs are reused and revoked correctly, and a mismatched Artifact revision is not displayed.
- Performance regression tests record Snapshot file count, Artifact read count, bytes, request coalescing and event-loop delay. Opening Home must not scan Step report directories or technology resources.
- Existing Project Comparison tests are retained to prove that the migration does not alter Project Dashboard, recommendation, risk, timing triage, Step Compare or Findings semantics.
- Existing Backend logs, Frontend Workspace, configuration editing, Design Report, Signoff export, Resource Manager and Chip Viewer tests remain regression guards for explicitly excluded dedicated capabilities.

## Out of Scope

- Frontend Workspace, ECC-FE Runtime, Frontend-specific Flow stages and Frontend analysis pages.
- Run, Rerun and Cancel command semantics beyond preserving the existing committed-revision and execution-overlay ordering.
- QoR scoring weights, threshold, polarity, recommendation, risk, timing triage, Signoff policy or baseline selection policy.
- Project Management visual redesign, Workspace creation, branching, replacement or Project CRUD behavior.
- Full Parameters editing, Step configuration editing, PDK selection and technology-library workflows.
- Flow log tail/chunk transport, terminal streaming and report text viewing.
- Design Report generation, Signoff package export and export-time ECC revalidation.
- Chip Viewer rendering internals and native layout editing.
- Resource Manager, tool installation, PDK installation and MPC management.
- A generic Artifact browser, arbitrary file read API, recursive directory inventory, persistent database, Worker pool, event bus or new state-management framework.
- Historical Snapshot browsing or time-travel UI.
- Changing the visible information architecture, chart design, typography or layout of Home and Step Dashboard.

## Further Notes

- This spec extends the completed Backend Workspace Core and Backend QoR/Project Comparison work and follows ADR 0012, ADR 0029 and ADR 0030.
- The previous behavior-preserving slimming spec intentionally excluded Step Dashboard and Flow Insights data sources. This spec brings only those committed-fact acquisition paths into scope; their visible behavior remains unchanged.
- Project Management Dashboard and cross-Workspace Step Compare are already persisted-Snapshot consumers and serve as implementation prior art.
- Backend Key Metrics are already snapshot-only in the current refactor branch. The remaining work must preserve that boundary and use the same normalized metric identifiers.
- Logs, configuration editors, reports, exports, Workspace Resources and Chip Viewer may continue using dedicated bounded capabilities. Their existence does not authorize normal Dashboard or Step analysis code to read raw paths.
- Missing facts remain missing. The application displays unavailable data until an authoritative Snapshot revision contains the fact; it must not manufacture zeroes or revive legacy fallback.
