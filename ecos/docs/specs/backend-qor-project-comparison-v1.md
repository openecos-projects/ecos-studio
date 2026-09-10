# Backend QoR 与 Project Comparison v1

状态：已实现（2026-08-30）

## 实现结果

Workspace Home 和 Project Comparison 共用 Electron 中的 `qorAnalysis`。score、阈值、gate、polarity、metric verdict、baseline delta、推荐、风险和 timing triage 都在这一层产生。Renderer 只把这些结论整理成表格、图表和页面文案。

Project 页面通过 `backendProjectComparisonSession` 选择 Project Context。查询按 Workspace 部分成功，记录实际依赖的 Workspace root；受管提交只失效相关 Context。旧的 `projectQorTrend`、`projectAnalysisSnapshot` 和 Renderer 原始 QoR 批量读取模块已经删除。

来源：[Backend GUI 重构标准](../gui-backend-refactor-standard.md)

前置：[Backend Workspace Core v1](./backend-workspace-core-v1.md)

## 问题

当前 Workspace Home、Project Dashboard 和跨 Workspace Step Analysis 都在 Renderer 中解释 QoR 数据。`useHomeQorComparison`、`projectQorTrend`、`projectAnalysisSnapshot` 和相关页面工具分别处理指标方向、score、gate、baseline delta、推荐和风险。

这些计算依赖页面读取到的原始报告和 Workspace 快照。同一指标可能在不同页面得到不同结论，Renderer 也因此同时承担文件编排、工程规则和图表展示。只迁移 Home 会留下两套 QoR 生产路径，后续修改 polarity、阈值或数据质量规则时仍然无法确认哪个结果权威。

## 方案

在 Electron 内建立纯 `qorAnalysis` 深模块。Workspace Overview 和新的 Backend Project Comparison Query 共用该模块，Renderer 只接收工程结论并生成展示 projection。

本 spec 同时迁移 Workspace QoR、单 baseline comparison、Project Dashboard 和跨 Workspace Step Analysis。迁移完成后删除旧 Renderer QoR 领域计算和 `projectQorTrend` 生产路径，不保留 fallback 或双算。

## 业务场景

1. 工程师在 Workspace Home 查看当前 QoR score、gate、指标和各 Flow Step 的工程结果。
2. 工程师选择 baseline Workspace 后，可以看到当前 Workspace 相对 baseline 的 improvement、regression、unchanged 或 not-comparable。
3. 当前 Workspace 就是 baseline 时，页面得到明确的 baseline 状态，而不是把 delta 当作零改进。
4. baseline 缺失、未完成或数据不可比较时，当前 Workspace QoR 仍可显示，并附带稳定 issue。
5. 工程师在 Project Dashboard 查看各 Workspace 的 Flow 进度、QoR、Signoff readiness 和数据质量。
6. 工程师可以看到基于明确工程规则生成的推荐 Workspace 及推荐理由。
7. 单个 Workspace 数据损坏时，Project Comparison 保留其他 Workspace 的结果，不重新选择 baseline 掩盖问题。
8. 工程师在跨 Workspace Step Analysis 中按相同 `stepId` 比较各 Workspace 结果。
9. 工程师可以看到 timing triage、风险和 regression；结论由 Electron 生成，页面只负责排序、筛选和展示。
10. 一个 Workspace 在另一个窗口完成受管提交后，所有依赖该 Workspace 的活动 Project Comparison Context 自动失效。
11. Project 切换后，旧 Project Comparison 数据立即清空，旧请求不能覆盖新 Project。
12. 未知 metric、单位或 Step 不导致整个比较失败；无法可靠比较的内容返回 not-comparable 或对应 issue。

## 功能要求

### QP-01 `qorAnalysis` 领域边界

Electron 内部建立一个 `qorAnalysis` 模块：

```text
backendWorkspace -> qorAnalysis
backendProjectComparison -> qorAnalysis
```

该模块接收已经授权、读取和分类的逻辑输入。它不能读取文件，也不能依赖 IPC、Electron window、Vue、Pinia 或本地路径。

首版不建立共享 domain package，不增加只有一个实现的 interface 或 factory。

### QP-02 工程规则所有权

`qorAnalysis` 是以下事实的唯一生产解释位置：

- 指标解析、规范单位和 polarity。
- score、gate 和阈值：消费 Engineering Snapshot `qorAssessment`（由 ECC `chipcompiler.engine.qor_scoring` 计算），不在 GUI 再算一遍。
- improvement、regression、unchanged 和 not-comparable。
- Workspace 与单 baseline 的 delta。
- Project recommendation、risk、regression 和数据质量。
- 跨 Workspace Step verdict。
- timing triage。

Renderer 只负责精度、单位缩放、label、颜色、图表布局、排序、筛选和本地化。

### QP-03 Workspace QoR

在 `WorkspaceOverviewCore` 中加入：

```ts
type WorkspaceOverviewCore = {
  // Backend Workspace Core v1 fields
  qor: ReadSection<WorkspaceQorSummary>;
  baselineComparison: ReadSection<WorkspaceBaselineComparison>;
};

type WorkspaceQorSummary = {
  score: QorScore;
  metrics: MetricValue[];
  steps: QorStepSummary[];
};

type WorkspaceBaselineComparison = {
  baselineWorkspaceId: string;
  baselineWorkspaceName: string;
  baselineScore: QorScore;
  deltas: MetricComparison[];
  status: "baseline" | "comparable" | "not-comparable";
};
```

QoR 与 baselineComparison 独立使用 `ReadSection`。baseline 不可用不能使当前 Workspace 的 QoR 失败。

### QP-04 Project Comparison Context

Projects 页面可以选择多个 Project，因此 Preload 暴露显式 Context API：

```ts
backendProjectComparison.selectProject({ projectRootLocator });
backendProjectComparison.getComparison({ projectComparisonContextId });
backendProjectComparison.refreshComparison({ projectComparisonContextId });
backendProjectComparison.onInvalidated(listener);
```

`projectRootLocator` 只用于首次选择、授权和建立 Context。后续查询使用不透明 `projectComparisonContextId`，不能反复传入 Project 路径。

Project 切换或 Context 销毁后，旧 generation 的查询结果不能提交。

### QP-05 Project Comparison ReadModel

查询返回：

```ts
type BackendProjectComparison = {
  identity: ProjectComparisonIdentity;
  workspaces: ReadSection<{ items: ProjectWorkspaceSummary[] }>;
  recommendation: ReadSection<ProjectRecommendation>;
  risks: ReadSection<{ items: ProjectRisk[] }>;
  stepComparisons: ReadSection<{ steps: ProjectStepComparison[] }>;
  timingTriage: ReadSection<ProjectTimingTriage>;
};

type ProjectComparisonIdentity = {
  projectId: string;
  projectName: string;
  designName: string;
  baselineWorkspaceId?: string;
};

type ProjectWorkspaceSummary = {
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  flow: FlowProgressSummary;
  qor: WorkspaceQorSummary;
  signoffReadiness: SignoffReadiness;
  dataQuality: AnalysisDataQuality;
  issues: ReadIssue[];
};

type ProjectRecommendation = {
  workspaceId: string;
  score: QorScore;
  reasons: RecommendationReason[];
};

type ProjectStepComparison = {
  stepId: string;
  order: number;
  name: string;
  workspaces: ProjectStepWorkspaceResult[];
};
```

ReadModel 只包含 Dashboard 和跨 Workspace Step Analysis 正常渲染所需的有界结构化事实。大型报告或 Artifact 使用不透明 `ArtifactRef`。

### QP-06 部分成功与数据质量

单个 Workspace 完全无法读取或分析时，`workspaces` section 返回 partial，issue 标识失败的 Workspace；只有能够构造完整 `ProjectWorkspaceSummary` 的 Workspace 才进入 `items`。单项存在非致命数据问题时，保留该 entry，并把问题放入它的 `issues`。其他 Workspace 继续参与结果生成。

Recommendation 只能从达到最低数据质量的 Workspace 中选择。若没有合格 Workspace，recommendation section 返回 unavailable，不能用数据不完整的 Workspace 填充结果；若仍能推荐但部分候选不可用，则返回 partial 和对应 issues。

配置的 baseline 不可用时返回明确 issue，不能自动改选其他 Workspace。

### QP-07 Step Comparison

跨 Workspace Step 使用开放且不透明的 `stepId` 对齐，并使用显式 `order` 排序。Renderer 不能解析 ID 推导阶段、工具或路径。

某 Workspace 缺少该 Step 时保留该 Workspace 的缺失状态，不能从相邻 Step 推测结果。无法比较的 metric 返回 not-comparable 及原因。

### QP-08 Renderer Session 与 Projection

新增独立 Pinia store：`backendProjectComparisonSession`。它不与 `backendWorkspaceSession` 合并，也不建立 Project session map。

Session 使用与 Workspace Query 相同的 idle、loading、ready、refreshing、stale 和 error 状态。同一 Context 刷新保留最后 committed 数据；Project Context 切换立即清空。

Renderer 可以对领域结果格式化、分组、排序和筛选，但不能重新计算 score、gate、polarity、推荐、风险或 verdict。

### QP-09 缓存与跨窗口失效

Electron 是唯一 Query cache 所有者。每个 Project Comparison Context 保存 generation、一个 ReadModel cache、同 generation in-flight Promise，以及最近一次 Query 实际依赖的 Workspace root 集合。

Workspace 发生受管提交时：

```text
Workspace 事实提交
  -> 失效该 Workspace 的 Backend Workspace Context
  -> 查找依赖该 Workspace 的活动 Project Comparison Context
  -> 失效这些 Context
  -> 发送各模块 typed invalidation 通知
```

不扫描所有 Project，不引入全局事件总线，也不跨窗口共享 ReadModel。

### QP-10 资源读取与性能

每个 Workspace 的一次未缓存分析只建立一次 Resource Index，并在该 Workspace 的 Flow、QoR、Signoff 和 Step 分析之间复用。

所有文件读取和 IPC payload 必须有界。单个 Workspace 超限只影响该 Workspace entry 或相关 section。

首版记录每个 Workspace 的输入规模、读取字节、分析阶段耗时、总 Query 耗时、IPC payload 和 event-loop 延迟。只有测量证明纯计算阻塞 Electron main 时，才把 `qorAnalysis` 内部计算移入 Worker；对外 contract 不变。

## 实施决定

- Workspace Overview 与 Project Comparison 共用同一个 Electron `qorAnalysis`，不复制公式。
- `packages/shared` 只保存 ReadModel 与 IPC contract，不承载领域实现。
- Project Comparison 只包含 Dashboard 与跨 Workspace Step Analysis，不扩展到 Project CRUD、Workspace 创建或页面重设计。
- 现有页面结构和可见行为保持；图表组件可以继续使用，只替换其数据来源。
- 迁移按业务消费者完成，不在 Renderer 保留临时 QoR 兼容层。

## 删除范围

切片完成时必须删除：

- `useHomeQorComparison.ts` 及仅服务该实现的 cache、watch 和测试。
- `projectQorTrend.ts` 的生产路径及其 Renderer 领域计算。
- `projectAnalysisSnapshot`、`projectManagement` 和页面 helper 中重复的 score、gate、polarity、delta、推荐和风险计算。
- Project Dashboard 与 Project Step Analysis 对旧 QoR 类型和计算结果的依赖。
- 只断言旧 Renderer QoR helper 内部算法拆分的测试。

仍被展示组件使用的纯格式化函数可以保留，但其输入必须是 Electron 返回的领域结论，且不能产生新的工程判断。

## 测试决定

主要测试 `qorAnalysis` 公开输入输出、Electron Query 行为和用户可见页面结果。

至少覆盖：

- score 阈值 60 两侧及边界值。
- 正向、反向和未知 polarity 指标。
- improvement、regression、unchanged 和 not-comparable。
- baseline 缺失、不可用、等于当前 Workspace 和正常比较。
- 完整、部分完成、未运行和损坏的 Workspace。
- Recommendation 排除低数据质量 Workspace。
- 配置 baseline 不可用时不自动改选。
- 单 Workspace 失败时 Project Comparison 部分成功。
- 未知 Step、metric 和单位。
- 跨 Workspace Step 对齐、缺失和排序。
- timing triage 与 risk 的稳定领域结论。
- 同 generation 请求合并和旧 generation 丢弃。
- Workspace 跨窗口提交只失效实际依赖它的 Project Context。
- Project Context refresh 保留旧数据，切换 Project 清空旧数据。
- Home、Project Dashboard 与 Step Analysis 对同一 fixture 显示一致结论。
- Renderer 只做展示 projection，不重新计算工程结论。

使用一组最小脱敏 fixture 覆盖 Workspace Overview 和 Project Comparison。测试断言稳定业务结果，不固定 Electron 内部文件结构或函数拆分。

## 验收条件

- [x] Workspace Home 的 QoR 与 baseline comparison 可见行为保持。
- [x] Project Dashboard 的 Workspace 汇总、推荐和风险可见行为保持。
- [x] 跨 Workspace Step Analysis 可见行为保持。
- [x] 同一输入在三个消费面得到一致的 score、gate、polarity 和比较结论。
- [x] 单 Workspace 失败不会使整个 Project Comparison 失败。
- [x] baseline 不可用时不会静默改选。
- [x] Renderer 不读取原始 QoR 报告，也不生成工程结论。
- [x] `projectQorTrend` 和 `useHomeQorComparison` 的旧生产路径全部删除。
- [x] Project Comparison 跨窗口依赖失效通过测试。
- [x] 没有新增 Worker、事件总线、共享领域 package 或新状态库。

## 不在范围内

- Project CRUD、Workspace 创建、替换和派生。
- Projects 页面与分析页面的视觉重设计。
- 完整 Step Analysis、Chip Viewer 和 Signoff 页面迁移。
- Run、Rerun、Cancel 和 Operation lifecycle 重构。
- ECC RPC、Workspace 输出格式和 Artifact Manifest 修改。
- QoR 阈值或现有业务规则调整。本 spec 只迁移当前行为。
