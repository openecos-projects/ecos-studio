# Backend GUI 重构标准

状态：设计已确认，尚未开始实现

确认日期：2026-08-30

适用范围：`ecos/gui`

## 目标

本轮重构解决 Backend GUI 中工程数据、业务状态和 Vue 视图相互耦合的问题。完成后，Electron 负责读取和解释 Backend 工程事实，Renderer 只维护当前查询投影、瞬态执行投影和 UI 状态。

这是一轮行为保持重构。业务规则调整、页面改版和执行协议改造另行处理。

实施分为两份 spec：

- [Backend Workspace Core v1](./specs/backend-workspace-core-v1.md)
- [Backend QoR 与 Project Comparison v1](./specs/backend-qor-project-comparison-v1.md)

## 范围

本轮包含：

- Backend Workspace Overview Core。
- Backend Project Comparison，包括 Dashboard 和跨 Workspace Step Analysis。
- Electron 内部统一 QoR Analysis。
- Backend Flow Log 从 `useHomeData` 中拆分。
- 所有消费 Flow、Checklist、QoR 和 baseline comparison 的 Backend 页面。

本轮不包含：

- Frontend Workspace、ECC-FE 或 Frontend RPC。
- Run、Rerun、Cancel 等 Operation command 和 lifecycle。
- Agent、Resource Manager、Project CRUD 和 Workspace 创建、替换、派生。
- Projects 页视觉重设计。
- Chip Viewer、Signoff 和完整 Step Analysis 迁移。
- ECC RPC、Workspace 输出格式或 Artifact Manifest 变更。
- 事件总线、Command Bus、Repository、依赖注入框架和新的持久化数据库。

## 架构

```text
Vue 页面
  -> Renderer Backend Session
  -> typed preload bridge
  -> Electron Backend Query module
       -> WorkspaceResourceService
       -> ProjectScopeService
       -> qorAnalysis
       -> bounded filesystem reads
       -> existing ECC snapshot/event adapter
```

按业务模块组织代码，不建立全局 `domain/application/infrastructure` 目录模板。模块内部先保持扁平，只有实际复杂度增长后再拆子目录。

`packages/shared` 只保存跨进程 typed contract，不承载 Backend 领域实现。领域计算在 Electron 内部执行，Renderer 不重复解释工程事实。

## 状态所有权

| 状态                                                       | 所有者                              |
| ---------------------------------------------------------- | ----------------------------------- |
| Flow、Checklist、QoR、baseline comparison 等已提交工程事实 | Electron Backend module             |
| Operation 生命周期和实时进度                               | 现有 ECC Runtime / Electron tracker |
| 当前 Workspace 的 ReadModel 和请求状态                     | `backendWorkspaceSession`           |
| 当前 Project Comparison 的 ReadModel 和请求状态            | `backendProjectComparisonSession`   |
| tab、modal、filter、sort、selection、zoom                  | Vue 页面                            |
| 文件、路径、IPC、进程和订阅                                | Electron 内部实现                   |

一个业务事实只能有一个权威解释位置。Pinia 是 Renderer 状态容器，不是领域层。

## 模块 interface

Backend Workspace Query 使用当前 IPC sender window 已注册的 Workspace scope，不接受路径或 runtime handle：

```ts
backendWorkspace.getOverview();
backendWorkspace.refreshOverview();
backendWorkspace.onInvalidated(listener);
```

Electron 根据 window scope 的 canonical root 懒创建 Query Context。成功结果包含 `workspaceContextId` 和 context-local `generation`；二者不进入 ReadModel。

Project Comparison 需要显式选择 Project，因为 Projects 页面可以在多个 Project 之间切换：

```ts
backendProjectComparison.selectProject({ projectRootLocator });
backendProjectComparison.getComparison({ projectComparisonContextId });
backendProjectComparison.refreshComparison({ projectComparisonContextId });
```

`projectRootLocator` 只用于建立并授权 Context。后续查询和缓存使用不透明的 `projectComparisonContextId`。

不按 Widget 或数据文件拆出 `getQor()`、`getChecklist()`、`getHomeCards()` 等浅 interface。

## 查询结果

查询使用 section 级部分成功：

```ts
type ReadSection<T> =
  | { status: "ready"; data: T; issues: [] }
  | { status: "partial"; data: T; issues: ReadIssue[] }
  | { status: "unavailable"; issues: ReadIssue[] }
  | { status: "error"; issues: ReadIssue[] };
```

Workspace Context 无效、路径未授权和顶层读取失败会使整个 query 失败。单个 Flow、Checklist、QoR 或 Workspace 分析缺失时，只影响对应 section 或 Workspace entry。

`ReadIssue` 返回稳定机器码和可选诊断信息。Renderer 负责本地化文案、tone 和未知 code fallback，不能解析错误文本决定业务行为。

## Workspace Overview Core

```ts
type WorkspaceOverviewCore = {
  identity: WorkspaceOverviewIdentity;
  configuration: ReadSection<WorkspaceConfigurationSummary>;
  flow: ReadSection<WorkspaceFlowSummary>;
  checklist: ReadSection<WorkspaceChecklistSummary>;
  qor: ReadSection<WorkspaceQorSummary>;
  baselineComparison: ReadSection<WorkspaceBaselineComparison>;
};

type WorkspaceOverviewIdentity = {
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName: string;
  baselineWorkspaceId?: string;
  displayPath?: string;
};

type WorkspaceFlowSummary = {
  steps: FlowStepSummary[];
};

type FlowStepSummary = {
  stepId: string;
  order: number;
  name: string;
  state: FlowStepState;
  toolId?: string;
  runtimeSeconds?: number;
  peakMemoryMb?: number;
};

type WorkspaceChecklistSummary = {
  findings: ChecklistFinding[];
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

Configuration 只返回 Home 和通用 Workspace header 使用的规范字段。完整 `parameters.json`、表单 schema、RTL/filelist、PDK 本地路径和工具私有参数继续走独立配置能力。

## Project Comparison

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

单个 Workspace 不可用时保留其他 Workspace 结果。recommendation 只能从达到最低数据质量的 Workspace 中选择；baseline 不可用时返回明确 issue，不能改选其他 Workspace。

## QoR Analysis

Workspace Overview 和 Project Comparison 共用 Electron 内部 `qorAnalysis` 深模块：

```text
backendWorkspace -> qorAnalysis
backendProjectComparison -> qorAnalysis
```

该模块不读取文件，也不知道 IPC、窗口、Vue 或本地路径。调用方提供已经授权、读取和分类的逻辑输入。

QoR Analysis 负责：

- 指标解析、规范单位和 polarity。
- score、gate 和当前阈值 60。
- improvement、regression、unchanged 和 not-comparable。
- 单 baseline comparison。
- Project recommendation、risk、regression 和数据质量。
- 跨 Workspace Step verdict 和 timing triage。

Renderer 只负责精度、单位缩放、label、颜色、图表、排序和本地化。

## Flow 与 Checklist 规则

Home、Tech Library 和 Configure 是 Renderer Navigation Item，不是 Flow Step。

Flow Step 使用 Workspace 内开放且不透明的 `stepId`，顺序由 `order` 明确返回。Renderer 不能根据 `stepId` 推导目录、Artifact 路径或工具；未知步骤使用通用展示 fallback。

当 committed Flow Step 已成功，而 `category: flow` 的 Checklist Finding 仍为 failed 时，Flow Step committed state 是有效状态的权威来源。归一化后的 finding 返回 pass，并保留 reconciliation evidence。Artifact、configuration、provenance 和 report 等 finding 不受该规则影响。

## Artifact 与渲染数据

ReadModel 直接包含页面正常渲染需要的结构化领域事实和有界趋势数据。原始、大型或需要专用查看器的内容使用不透明 `ArtifactRef`，不暴露本地路径。

```ts
type ArtifactRef = {
  id: string;
  kind: ArtifactKind;
  name: string;
  availability: "available" | "missing" | "stale";
  sizeBytes?: number;
};
```

日志继续走 tail、chunk 和 runtime event；图片走受限 URL 或 bytes；DEF、GDS 和 geometry 交给 Chip Viewer。Renderer 不下载报告原文后重新解析工程事实。

## Renderer Session

`backendWorkspaceSession` 和 `backendProjectComparisonSession` 是两个独立 Pinia store。单个 window 各自只保存一个前台 Context，不建立 session map、LRU 或 normalized entity store。

同一 Context 刷新时保留最后 committed ReadModel：

```ts
type QueryProjectionState<T> =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ready"; data: T }
  | { status: "refreshing"; data: T }
  | { status: "stale"; data: T; issue: QueryIssue }
  | { status: "error"; data: null; issue: QueryIssue };
```

切换 Context 时立即清空旧数据。旧 generation 或旧 request sequence 的结果静默丢弃。

Runtime Event 不写入 ReadModel。一个纯 projection 组合 committed Flow 与现有瞬态 Operation 状态，供 Sidebar、Run Control 和 Home 使用。

## 缓存与失效

Electron 是唯一查询缓存所有者。每个 window Context 只保留 generation、ReadModel cache 和同 generation in-flight Promise 合并。

第一阶段不增加 TTL、LRU、持久化、内容 hash、跨窗口共享、stale-while-revalidate 或通用 cache framework。

受管事实提交后，Electron 必须先失效，再发送模块专用 typed IPC 通知：

```text
事实提交
  -> generation/cache 失效
  -> backendWorkspace.invalidated 或 backendProjectComparison.invalidated
  -> Renderer refresh
```

失效来源包括 Step commit、Operation 终态、配置写入、设计文件变更、Workspace replacement、baseline 选择和 Project manifest 变更。

Project Comparison Context 记录上次 Query 使用的 Workspace root 集合。某个 Workspace 提交后，Electron 只失效依赖该 Workspace 的活动 Context，不扫描所有 Project。

首批不保证任意外部文件修改实时刷新。ECC Runtime 和 GUI 受管变更自动刷新，外部修改通过手动 refresh 读取。

## 资源读取

第一阶段复用 `WorkspaceResourceService` 做内部资源发现。一次未缓存 Query 只建立一次 Resource Index；各 section 复用同一索引，不重复递归扫描。

原始 JSON 和 ECC payload 在 Electron trust boundary 使用显式 parser 和 type guard 校验。首批不引入 Zod 等运行时 schema 依赖。

所有文件读取必须有界。超限只影响对应 section 或 Workspace entry，不能回退为无界读取。

## 性能

首批不预设毫秒阈值，也不引入 Worker。先记录：

- Resource Index 构建次数。
- 文件数量和读取总字节数。
- decode、parse 和 normalize 耗时。
- Query 总耗时和 IPC payload 大小。
- 相同并发请求的实际执行次数。
- Electron event-loop 延迟。

硬性约束是一次 cache miss 只建一次索引、同 generation 同 query 只执行一次、不做无界读取、不把大型 Artifact 放进 ReadModel。只有代表性数据证明主线程解析阻塞时，才评估 Worker。

## 与现有执行链路的关系

首批保留 `waiting_for_gui_sync`、`gui_sync_degraded` 和 `operation.ack_step_rendered`。删除旧 Core refresh task 后，`backendWorkspaceSession` 注册一个 Overview refresh task；section 失败不能阻止 ACK。

这只是行为保持约束，不代表 GUI render ACK 属于目标查询架构。Execution Lifecycle 后续单独评审。

`useWorkspace` 的打开、关闭、runtime readiness 和 Frontend 依赖保持不变。Backend 页面不再从 `resourceVersions`、路径或 raw runtime payload 推导 committed 工程事实。

## 迁移切片

### 切片 A：Backend Workspace 基础数据流

- 建立 shared contract、Electron Query、IPC adapter 和 Renderer session。
- 迁移 identity、configuration、flow 和 checklist。
- 迁移所有 Backend Core 消费者，不只迁移 Home。
- 拆出 `useBackendFlowLogs`，只保留日志职责。
- 删除 `useHomeData.ts`、无消费者资产逻辑和 Backend `useFlowStages` 旧路径。
- Frontend 对 `useFlowStages` 和 `useWorkspace` 的使用不变。

### 切片 B：统一 QoR 与 Project Comparison

- 建立 Electron `qorAnalysis`。
- 迁移 Workspace QoR 和单 baseline comparison。
- 建立 Project Comparison Query、Context 和 Renderer session。
- 同时迁移 Project Dashboard 和跨 Workspace Step Analysis。
- 删除 `useHomeQorComparison` 和 Renderer QoR 领域计算。
- 删除旧 `projectQorTrend` 生产路径，不保留 fallback 或双算。

每个 section 切换后，在同一切片删除旧 parser、cache、watch 和兼容分支。不使用生产 feature flag，不长期保留新旧两条事实来源。

## 测试与验收

主要测试面是模块 interface，不是内部缓存和 parser 调用顺序。

至少覆盖：

- 完整、未运行和部分完成的 Workspace。
- section 缺失、损坏和超限。
- baseline 缺失、不可用、相同 Workspace 和正常比较。
- 未知 Step、状态、metric 和单位。
- Flow 与 Checklist reconciliation。
- 单 Workspace 失败时 Project Comparison 部分成功。
- 同 generation 请求合并和旧 generation 丢弃。
- 同 Context refresh 保留旧 projection，切换 Context 立即清空。
- Electron 先失效再通知 Renderer。
- Project Comparison 跨窗口依赖失效。
- GUI ACK 行为保持。

旧 composable 内部 ref、cache 和 watch 测试随旧实现删除。真实用户行为测试改为通过新 interface 驱动；纯 parser 保留少量边界测试；IPC、Pinia session 和 Vue 页面只保留必要集成与交互检查。

验收条件：

- 当前 Backend GUI 可见行为保持。
- Frontend Workspace 文件和行为不变。
- Renderer 不解析 Backend 原始报告或状态别名。
- 同一工程事实只有一个生产解释路径。
- 已迁移旧代码全部删除。
- 不增加全量扫描工作量。
- 不引入 Worker、事件总线、通用缓存或新状态库。
