# ECOS Studio GUI 行为保持瘦身 v1

状态：已实现并完成本地验证（2026-09-03）；ECC 子模块提交发布后方可准备父仓 PR

适用范围：ECOS Studio GUI 及为删除 GUI 专用协议表面而必须同步调整的 ECOS Runtime Adapter

本规格服从《ECOS Studio 后端系统架构与 WorkspaceSpec v1》已经确定的职责边界：ECC 是单 Workspace 工程事实的权威，Runtime Adapter 负责 Studio 运行时协议，Electron 负责产品组织和本机能力，Renderer 只负责展示与交互。

Project Comparison 的 Engineering Snapshot 加载、实时 Operation overlay、按需 Findings 与刷新一致性由 [Project Comparison Engineering Snapshot Loading v1](./project-comparison-engineering-snapshot-loading-v1.zh-CN.md) 进一步约束。

## Problem Statement

Backend 系统架构重构完成后，ECOS Studio GUI 仍保留了一批迁移期代码：Renderer 会把类型化 Runtime Event 再包装成旧通知格式，Project Management 会把 Electron 已经生成的领域 DTO 再转换一次，Project Manifest 在 Renderer 和 Shared 中存在重复类型与解析实现，Desktop Bridge 还为产品不支持的浏览器运行方式轮询 preload 注入结果，Electron 和 Runtime Adapter 也保留了一组没有生产消费者的 IPC 与 JSON-RPC 方法。

这些路径增加了生产代码、测试桩、跨进程契约和维护成本，却没有提供额外用户能力。继续保留它们会让同一个工程事实拥有多个解释位置，也会让后续修改需要同时维护新旧事件、重复 DTO 和无消费者协议。

本轮瘦身必须保持现有功能、数据和用户交互不变。不能通过删除产品能力、减少报告内容、改变 QoR 或 Checklist 结果、修改 Frontend SoC、移除 ECharts 或弱化错误处理来换取代码量下降。

## Solution

删除已经被现有类型化契约和 Electron DTO 替代的迁移路径，并让每类事实只保留一个生产来源：

- Project Management 直接消费 Electron 返回的 Backend Project Comparison DTO，只在 Renderer 中保留展示 projection 和用户交互状态。
- Backend Renderer 直接消费 Shared 定义的类型化 Runtime Event，不再生成或反解析旧通知 envelope。
- Signoff Review 从当前 Engineering Snapshot 读取 ECC 的 `signoffAssessment`；最终导出仍由 Runtime Adapter 调用 ECC 重新检查并生成归档包。
- Project Manifest 的类型、解析、序列化和 mutation 统一使用 Shared 实现。
- 删除经生产调用图证明没有消费者的 Desktop IPC、ECC Artifact IPC 和 Runtime Adapter 管理方法。
- Electron Renderer 直接读取 preload 在启动前注入的 Desktop Bridge，不再轮询或保留浏览器兼容分支。
- 只删除不可达的 QoR 本地重算 fallback 和未展示数据，不改变 QoR、baseline、推荐、Checklist reconciliation 或页面结果。

每个替换切片必须在同一次变更中删除旧生产路径，不使用 feature flag，也不长期保留新旧双轨。没有等价性证据的候选代码不删除。

## User Stories

1. As a chip designer, I want all existing Backend Workspace workflows to remain available, so that repository slimming does not remove product capability.
2. As a chip designer, I want Project Management to show the same Workspace rows and engineering values, so that I can compare implementations exactly as before.
3. As a chip designer, I want Project Management sorting to produce the same order for every supported column, so that my comparison workflow remains predictable.
4. As a chip designer, I want the selected QoR baseline and all baseline deltas to remain unchanged, so that design decisions are based on the same reference Workspace.
5. As a chip designer, I want Project Management recommendations and reasons to remain unchanged, so that slimming cannot silently alter the recommended implementation.
6. As a chip designer, I want Project Management drill-down, selection, filtering, refresh, and error interactions to remain unchanged, so that the page remains fully usable.
7. As a chip designer, I want incomplete, unavailable, stale, and partially readable Workspaces to retain their current presentation, so that missing data is not mistaken for a valid result.
8. As a chip designer, I want current and baseline QoR scores, gates, metrics, units, polarity, and deltas to remain unchanged, so that no local fallback changes engineering conclusions.
9. As a chip designer, I want Checklist findings and Flow reconciliation to remain unchanged, so that current pass, warning, blocked, and progress results are preserved.
10. As a chip designer, I want live Backend Flow progress to update from typed Runtime Events, so that removing the legacy notification format does not reduce real-time feedback.
11. As a chip designer, I want successful, failed, cancelled, and interrupted Operations to keep their current visible terminal states, so that event simplification cannot misreport execution outcomes.
12. As a chip designer, I want lost or delayed Runtime Events to recover through Operation query and Engineering Snapshot, so that events remain notifications rather than engineering truth.
13. As a chip designer, I want the Signoff Review dialog to show ECC's current ready, attention, or blocked assessment, so that the GUI never invents a second Signoff decision.
14. As a chip designer, I want Workspace switching during Signoff Review to discard stale results, so that an assessment from one Workspace cannot be exported from another.
15. As a chip designer, I want a running Operation to prevent Signoff inspection or export at the authoritative Adapter boundary, so that partially changing outputs cannot enter a package.
16. As a chip designer, I want Signoff export to work for valid non-Harden Flow endings, so that the GUI does not restore a fixed final-step rule.
17. As a chip designer, I want blocked Signoff Assessment to prevent export and attention status to retain its current confirmation behavior, so that product policy does not change.
18. As a chip designer, I want ECC to perform the final Signoff Assessment immediately before export, so that a previously displayed Snapshot cannot authorize a stale package.
19. As a chip designer, I want ECC to remain responsible for collecting package content, checking completeness, creating the archive, and replacing the destination safely, so that GUI slimming does not duplicate or weaken export behavior.
20. As a chip designer, I want LaTeX, Markdown, Typst, CSV, and text Design Reports to remain available, so that existing downstream documentation workflows continue to work.
21. As a chip designer, I want Signoff packages to retain every `design_summaries/*` entry and its current content, so that package consumers receive the same deliverables.
22. As a chip designer, I want export cancellation, disk failure, malformed data, and archive-append failure to retain their current behavior and diagnostics, so that cleanup does not hide operational errors.
23. As a Frontend SoC user, I want Frontend Workspace behavior and ECC-FE integration unchanged, so that Backend cleanup does not cross into separately owned product scope.
24. As a resource user, I want Tool, PDK, and MPC management unchanged, so that the GUI continues to install, select, validate, and bind required resources.
25. As a terminal user, I want the built-in terminal and its streaming behavior unchanged, so that removing unused log APIs does not remove the shell or its output.
26. As a Step Dashboard user, I want every current chart, metric, drill-down, and empty state unchanged, so that this cleanup does not become a dashboard rewrite.
27. As a Flow Insights user, I want every current visualization and ECharts interaction unchanged, so that bundle slimming does not remove analysis capability.
28. As an ECOS user, I want fonts and text rendering unchanged, so that this round has no typography or visual regression.
29. As an ECOS user, I want the desktop application to fail immediately and clearly if preload injection is genuinely unavailable, so that an unsupported browser fallback does not delay the real error.
30. As an ECOS maintainer, I want one canonical typed Runtime Event contract, so that consumers do not maintain both protocol events and legacy notification aliases.
31. As an ECOS maintainer, I want committed engineering facts read from Snapshot or Electron DTO, so that Renderer event state cannot become a second fact store.
32. As an ECOS maintainer, I want one canonical Project Manifest implementation in Shared, so that parsing and mutation rules cannot diverge between processes.
33. As an ECOS maintainer, I want internal IPC and JSON-RPC surfaces limited to methods with production consumers, so that every exposed method has an owned use case.
34. As an ECOS maintainer, I want dead service implementations removed with their contracts, handlers, preload methods, tests, and exports, so that no disconnected scaffolding remains.
35. As an ECOS maintainer, I want existing bounded file reads retained where they serve Backend logs, Frontend, reports, or other product features, so that similar names do not cause over-broad deletion.
36. As an ECOS maintainer, I want Engineering Snapshot to retain only declared Artifact metadata consumed by current product features, so that unused generic content IPC, recursive inventory, and speculative metadata are removed together.
37. As an ECOS maintainer, I want no new dependency, framework, package, compatibility layer, or abstraction introduced for this cleanup, so that slimming produces a genuinely smaller system.
38. As an ECOS maintainer, I want every deletion justified by a production reachability check and an observable-behavior regression, so that line-count reduction is never treated as sufficient evidence.
39. As an ECC maintainer, I want ECC Signoff algorithms and native export behavior unchanged, so that Studio cleanup does not redefine engineering policy.
40. As a release engineer, I want the complete non-packaging GUI validation gate and critical Electron smoke path to pass, so that removed bridge and IPC surfaces remain safe in the packaged application topology.

## Implementation Decisions

### Behavior-preserving boundary

- This is a deletion and consolidation change, not a product redesign. Existing routes, controls, displayed engineering values, output formats, error states, security checks, cancellation behavior, and persisted data remain compatible.
- Production line count, module count, preload surface, and built asset size are measured before and after, but no arbitrary deletion target is an acceptance criterion.
- A candidate is deleted only after static production-call analysis and behavior tests show that it has no supported consumer. Tests, comments, or exported types alone do not justify retaining a production endpoint.
- Replaced paths are removed in the same slice that switches the final consumer. No production feature flag or permanent fallback is added.
- Existing validation, path authorization, bounded reads, atomic writes, stale-result protection, and error propagation are not simplification targets.

### Signoff Snapshot and export

- Signoff Review reads `signoffAssessment` from the current Workspace Engineering Snapshot through the existing typed runtime snapshot query. Renderer does not inspect `flow.json`, derive eligibility, or require a final step named Harden.
- Opening or refreshing the review obtains a current Snapshot. The review result is accepted only when its Workspace identity and revision still match the active Workspace context; late results are discarded.
- The review dialog keeps the current `ready`, `attention`, and `blocked` states, group details, risks, evidence, confirmation rules, loading state, refresh action, and error behavior.
- After the last production consumer moves to Snapshot, remove the dedicated `inspectSignoff` Desktop API, preload method, IPC channel and handler, Electron runtime forwarding method, and `workspace.inspect_signoff` Adapter method.
- Removing the dedicated inspection method does not remove ECC's native Signoff inspection function. `workspace.exportSignoff` remains a Product Command, and the Adapter calls ECC's current Signoff inspection immediately before package creation.
- The Adapter rejects inspection/export while the Workspace has an active Operation. This check is authoritative; Renderer disabling is only an immediate UX guard.
- ECC remains responsible for refreshing Signoff analysis, determining blocked status, collecting required files, rejecting incomplete packages, creating `tar.gz`, and atomically replacing the selected destination.
- The existing optional additional-file contract remains. Renderer continues to generate LaTeX, Markdown, Typst, CSV, and text Design Reports and sends them under `design_summaries/*` for ECC to append.
- Design Report extraction, formatter options, filenames, extensions, content, standalone modes, and independent Design Report export are unchanged in this spec.

### Project Management DTO consumption

- Electron's Backend Project Comparison DTO is the only Project Management engineering-data source. Renderer does not rebuild Project Analysis snapshots, QoR trend summaries, Signoff readiness, recommendation, risk, or timing triage from raw Workspace data.
- The Renderer session continues to own query lifecycle, Context switching, generation checks, refresh, stale-data retention, and errors. It stores the Electron DTO without a second domain normalization layer.
- Renderer presentation code may format labels, units, tones, table cells, and user-selected sort/filter state. It must not recalculate engineering scores, gates, baseline deltas, recommendation eligibility, or Signoff readiness.
- Existing Electron comparison calculations remain authoritative for baseline selection, ranking, recommendation, risk, data quality, unknown Flow Steps, and partial Workspace handling.
- Delete Renderer Project Management transformation functions and duplicate DTO shapes only after every production consumer uses the Electron contract directly.
- Project CRUD, Workspace create/replace/derive flows, Resource Manager helpers, MPC selection, and Projects page product state are not folded into the comparison DTO.

### Typed Runtime Event consumption

- Shared `DesignRuntimeEvent` remains the canonical cross-process event contract. Backend Renderer consumers match its discriminated event kinds directly.
- Remove the Backend path that converts typed events into `RuntimeEventResponse`, legacy `step_start`, `step_complete`, `task_complete`, `error`, or `cancelled` notification aliases and then reparses them in multiple consumers.
- Backend live presentation continues to project transient progress over the latest committed Snapshot. Runtime Events do not become persisted state or replace Operation query and Snapshot recovery.
- Preserve event ordering, Workspace routing, Operation identity, execution scope, step identity, progress/log payloads, cancellation, failure diagnostics, terminal refresh, and stale Workspace filtering.
- Frontend SoC and ECC-FE behavior are frozen. If a compatibility adapter is proven to have a live Frontend consumer, retain the minimum Frontend-only adapter and remove it only from the Backend path. Do not edit Frontend-specific modules as part of this spec.

### Dead Desktop and Adapter surfaces

- Delete the unused project log-tail subscription surface end to end: subscription/unsubscription contract, event, preload exposure, IPC handlers, subscription bookkeeping, and dedicated service.
- Delete unused project file watch/unwatch surface end to end.
- Delete only the unused incremental `readOptionalProjectTextFileUpdate` surface. Retain bounded text chunk and tail reads that have production consumers, including Backend Flow logs and Frontend views.
- Retain ordinary authorized project text reads and writes, project binary reads that still have consumers, Workspace resource reads, Chip Viewer access, terminal PTY streaming, and Design Report inputs.
- Delete Runtime Adapter `rpc.hello`, `rpc.ping`, and `rpc.shutdown` only because the packaged Electron runtime has no production caller and GUI supports one pinned Adapter contract. Process spawn, readiness, crash observation, termination, and cleanup remain Electron-owned.
- Delete unused generic ECC Artifact `openArtifact` and `readArtifactChunk` Desktop APIs and their forwarding implementations. Replace the recursive Snapshot Artifact inventory with direct metadata references for declared Project Analysis files; remove its generic entry limit and preserve every currently used Workspace/Chip Viewer content path.
- Each surface deletion removes canonical Shared types/channels, package exports, preload exposure, Electron handlers/services, Adapter registration where applicable, and tests that only exercise the removed contract.
- Do not replace any removed endpoint with a generic command bus, arbitrary file API, or catch-all Artifact interface.

### Desktop Bridge simplification

- The supported Renderer topology is Electron with context isolation and preload injection completed before Renderer application code starts.
- Use one synchronous Desktop API accessor for production calls. Remove polling, timeout, retry, optional-browser availability state, and composable wrappers whose only purpose is to support a missing or late bridge.
- A genuinely missing bridge produces the existing clear unavailable error immediately. It does not wait for a condition that cannot become true in the supported topology.
- Tests may inject the typed Desktop API on the test window before mounting a consumer. Testability does not require a production polling loop.
- Shared bridge cleanup may update common consumers only when their Frontend behavior remains identical; it must not change Frontend-specific features or introduce a browser-supported product mode.

### QoR and Checklist cleanup

- Electron remains the sole owner of per-Workspace QoR analysis, single-baseline comparison, cross-Workspace ranking, recommendation, risks, score gate, polarity, and metric normalization.
- Remove only Renderer QoR recomputation paths that are unreachable after typed DTO adoption. Preserve presentation projection for formatting and current-only/no-baseline states.
- Remove the unrendered `unsupportedModules` field and its producer only after confirming it has no production consumer, persistence role, Agent consumer, export role, or accessibility output.
- Preserve the current score threshold, score eligibility, metric inclusion, baseline rules, comparison verdicts, issue codes, unavailable semantics, and page data.
- Preserve Checklist reconciliation in this round. It may change visible Flow or finding results and therefore cannot be deleted without a separate equivalence decision.

### Project Manifest consolidation

- Shared is the canonical owner of Project Manifest types, parsing, serialization, draft creation, normalization, and mutations used across process boundaries.
- Renderer imports the Shared implementation instead of defining parallel manifest interfaces and parser/serializer behavior.
- Delete Renderer copies and tests that only duplicate Shared behavior. Keep focused Renderer tests for its own product interactions and keep Shared tests for canonical parsing and mutation behavior.
- Persisted `project.json` shape, unknown extension-field handling, baseline metadata, Workspace registration, replacement backup, resource identity, and validation behavior remain unchanged.
- Consolidation must not move Project product behavior into ECC or merge Project Manifest with the Engineering Snapshot.

### Delivery sequence

1. Freeze representative golden fixtures and record current Project Management, QoR, Signoff, Runtime Event, bridge, and package-export behavior.
2. Consolidate Project Manifest ownership and move Project Management consumers to the existing Electron DTO.
3. Move Backend consumers to typed Runtime Events and delete their legacy notification path.
4. Move Signoff Review to Engineering Snapshot, preserve ECC export revalidation, then remove the dedicated inspection transport.
5. Delete independently proven dead Desktop IPC, Artifact IPC, log-tail, file-watch, text-update, and Adapter management surfaces.
6. Replace bridge polling and optional runtime guards with the direct Desktop API accessor.
7. Remove the now-unreachable QoR fallback and unrendered internal data.
8. Run focused checks after each slice, then the complete GUI validation, build, and Electron smoke checks.

## Testing Decisions

### Primary test seam

- The primary acceptance seam is the existing typed Desktop API and ReadModel boundary. The same golden fixtures feed Electron producers and Renderer consumers, and tests assert observable page data and user interactions rather than private helper calls.
- This seam covers Project Management rows, values, partial states, sorting, filtering, baseline selection, recommendation, risks, drill-down, refresh, Context switching, and stale-result behavior.
- Existing Backend Project Comparison service, Renderer comparison session, and Project Analysis panel tests are the prior art. They should be adapted to consume one shared fixture rather than preserving duplicate Renderer transformation tests.

### Signoff boundary

- Signoff requires one additional cross-language seam because ECC is authoritative. Snapshot fixtures cover `ready`, `attention`, `blocked`, missing/stale revision, Workspace switching, non-Harden endings, and review refresh.
- Product-command tests assert that confirmation retains the same output-path selection and five `design_summaries/*` files.
- Adapter/ECC tests assert active-Operation conflict, current assessment revalidation, blocked export, incomplete package failure, additional-file inclusion, safe archive replacement, symlink destination behavior, and preservation of an existing destination after failure.
- Tests assert outcomes and archive contents, not whether a specific private helper was called.

### Runtime Event boundary

- Feed canonical typed Runtime Events into existing Backend user workflows and assert the same visible running step, progress, log, completion, failure, cancellation, interrupted recovery, refresh, Agent flow progress, and Workspace isolation behavior.
- Remove legacy-shaped fixtures after the final Backend consumer is migrated. A test that only proves the old wrapper's internal mapping is deleted with the wrapper.
- Keep explicit recovery tests showing that lost events are repaired by Operation query and current Snapshot.

### Contract deletion and bridge boundary

- Shared contract, preload, Electron handler, and Renderer compile tests must agree on the reduced Desktop API. Removed channels and methods must not remain as optional declarations or test-only mocks.
- Adapter method-list and dispatch tests must agree on the reduced JSON-RPC method set.
- Bridge tests inject the API before application mount and verify immediate success. A separate negative test verifies immediate clear failure when injection is absent; no timer or polling assertions remain.
- Existing Frontend behavior tests, Resource Manager tests, terminal tests, Step Dashboard tests, Flow Insights tests, and Design Report formatter/export tests remain passing regression guards even though their implementation is out of scope.

### QoR, Checklist, and Manifest boundary

- Use identical Workspace and Project fixtures before and after cleanup to compare score, gate, metrics, units, polarity, deltas, baseline state, recommendation, risk, Signoff readiness, and unavailable states.
- Preserve existing Flow and Checklist reconciliation tests unchanged unless only their import location changes.
- Shared Project Manifest tests remain the canonical parser, serializer, normalization, unknown-field, and mutation coverage. Renderer tests cover only user-visible registration, replacement, baseline, and Projects page behavior.

### Required validation

- Run focused Shared, Renderer, Electron, and Runtime Adapter tests while implementing the affected slice.
- Run the full GUI `check` gate after all slices.
- Run the production GUI build because Shared contracts and preload/main bundling change.
- Run Electron desktop smoke because preload exposure and critical IPC paths change. In environments where the Electron sandbox is unavailable, record the explicit sandbox-disabled invocation.
- Run the focused Runtime Adapter test suite for every removed or changed method and for Signoff export.
- Run the repository's relevant non-packaging CI equivalents. A release/AppImage build is required only if packaging inputs or staged runtime resources change; otherwise report it as not run.

## Out of Scope

- Frontend SoC pages, Frontend Workspace behavior, ECC-FE runtime, Frontend RPC compatibility, and Frontend-specific source, waveform, simulation, or lint workflows.
- Resource Manager behavior and Tool, PDK, MPC installation, inventory, health, selection, binding, or configuration.
- Built-in terminal UI, PTY lifecycle, shell streaming, resize, exit, or cancellation behavior.
- Fonts, typography, icon assets, visual redesign, layout changes, copy changes, or accessibility redesign.
- Step Dashboard data source, charts, interactions, ECharts dependency, and Step-level analysis behavior.
- Flow Insights data source, charts, interactions, and ECharts dependency.
- Design Report extraction, data model, formatter implementation, five output formats, standalone options, independent export, and Signoff `design_summaries/*` content.
- ECC Signoff policy, assessment algorithm, package collection rules, archive format, required files, output layout, and CLI behavior.
- Checklist reconciliation, Flow/Checklist policy, QoR scoring rules, score threshold, metric polarity, baseline policy, recommendation policy, or data-quality policy.
- Project CRUD, Workspace create/update/replace/derive, persisted Workspace formats, Project Manifest schema migration, WorkspaceSpec, or Resource identity changes.
- New Artifact Manifest capability, new generic Artifact transport, new browser product mode, new protocol negotiation layer, feature flags, compatibility registries, worker pools, event buses, command buses, repositories, dependency-injection frameworks, or state-management libraries.
- Dependency and font removal merely to reduce bundle size. A dependency is removed only if it becomes unused through an in-scope deletion and is not explicitly retained above.

## Further Notes

- “功能不变” means the same supported workflows remain reachable and produce the same visible engineering data, ordering, selection, confirmation, errors, files, and package contents for the same input fixtures. Internal contract removal is allowed when no supported consumer observes it.
- “数据不变” applies to product-visible and persisted data. Removing an unconsumed internal DTO field is allowed only after proving that it is not displayed, persisted, exported, sent to Agent, used for accessibility, or consumed across a supported boundary.
- Engineering Snapshot is the review-time Signoff source, but it is not an export authorization token. ECC's export-time assessment and package completeness check remain authoritative.
- Keeping Design Report is an explicit correction to the earlier deletion candidate. This spec does not authorize removing its multi-format generators or `design_summaries/*` package entries.
- Removing `rpc.hello` intentionally supersedes the unused handshake described by the earlier English Backend Runtime Architecture v1. The decision relies on the accepted latest-packaged-contract rule: GUI and Runtime Adapter ship together and unsupported version pairing is not a supported mode. If independent Adapter versioning becomes a product requirement, protocol negotiation needs a separate spec rather than restoring an unused compatibility branch.
- The scope has no target percentage for lines or bundle size. The desired result is fewer production interpretations and smaller owned surface with all protected behavior intact.
