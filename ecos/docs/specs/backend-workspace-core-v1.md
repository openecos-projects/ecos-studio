# Backend Workspace Core v1

状态：已实现（2026-08-30）

## 实现结果

Backend Workspace 现在通过 `backendWorkspace` 查询返回 identity、配置摘要、Flow、Checklist、QoR 和 baseline comparison。Electron 按窗口保存 Context、generation、单份缓存和同代请求；Renderer 的 Pinia Session 只保存当前页面投影。

Home、Sidebar、Run Control 和 Step Dashboard 已改用同一份 Flow ReadModel。日志单独留在 `useBackendFlowLogs`，继续走 tail、chunk 和 Runtime Event。旧的 `useHomeData`、Backend `useFlowStages` 消费路径和资源版本刷新逻辑已经删除，Frontend Workspace 仍使用原来的 `useFlowStages`。

来源：[Backend GUI 重构标准](../gui-backend-refactor-standard.md)

## 问题

Backend Workspace 的身份、配置摘要、Flow 和 Checklist 目前由多个 Renderer composable 分别读取、解析和缓存。页面还会监听 `resourceVersions` 和 Runtime Event，再自行决定何时重新扫描文件。结果是同一份工程事实存在多条解释路径，Vue 视图变化、文件读取和业务状态相互牵连。

`useHomeData` 同时承担 Checklist、日志和已无消费者的布局资产逻辑，`useFlowStages` 又被 Home、Sidebar、Run Control 和 Step 页面共同使用。修改一个数据来源时，开发者很难判断会影响哪些页面，也无法在 Electron 边界统一校验输入和控制读取规模。

## 方案

建立 Backend Workspace 业务查询模块。Electron 根据当前 IPC sender window 已注册的 Workspace scope，返回一次场景级 `WorkspaceOverviewCore` 查询。Renderer 通过单个 `backendWorkspaceSession` 保存查询投影，页面只消费该投影。

首版迁移 Workspace identity、configuration summary、Flow 和 Checklist。Flow 日志从 `useHomeData` 拆为独立的 `useBackendFlowLogs`，继续使用已有的 tail、chunk 和 Runtime Event 能力，不进入普通 ReadModel。

旧 Backend 数据路径在消费者切换后直接删除，不保留 feature flag、fallback 或双重计算。Frontend Workspace 对 `useWorkspace` 和 `useFlowStages` 的现有依赖保持不变。

## 业务场景

1. 芯片后端工程师打开 Backend Workspace 后，可以看到正确的 Project、Workspace 和 baseline 身份信息。
2. 工程师可以看到 Home 与 Workspace header 所需的配置摘要，但 GUI 不暴露或复制完整 `parameters.json`。
3. 工程师可以看到按明确顺序排列的 Flow Step、已提交状态、工具、运行时间和峰值内存。
4. 工程师可以看到 Checklist Finding；某一类数据缺失时，其他可用内容仍然显示。
5. 工程师在同一 Workspace 手动刷新时，继续看到最后一次成功数据和刷新状态，不会先得到一张空白页面。
6. 工程师切换 Workspace 时，旧 Workspace 数据立即清空，不会短暂显示到新 Workspace 页面。
7. 受 GUI 或 Runtime 管理的事实提交后，当前页面自动刷新；任意外部文件修改首版通过手动刷新读取。
8. Flow 正在运行时，Sidebar、Run Control 和 Home 可以看到瞬态进度，但瞬态事件不会改写已提交 ReadModel。
9. 某个 section 的文件缺失、损坏或超限时，该 section 显示可恢复的问题，其他 section 不受影响。
10. 未知 Step 和未知状态使用通用展示，不导致页面失败，也不通过字符串猜测目录或工具。
11. 工程师查看 Flow 日志时，仍可使用现有日志选择、tail 和分块读取能力。
12. Runtime 等待 GUI 完成 Step 渲染时，Overview 的单个 section 失败不会阻止 `operation.ack_step_rendered`。

## 功能要求

### BW-01 查询边界

Preload 暴露一个 Backend 专用 typed API：

```ts
backendWorkspace.getOverview();
backendWorkspace.refreshOverview();
backendWorkspace.onInvalidated(listener);
```

查询不接受 Workspace 路径、runtime handle 或 Widget 名称。Electron 从 IPC sender window 的已授权 scope 解析当前 Workspace。

不增加 `getQor()`、`getChecklist()`、`getHomeCards()` 等按 Widget 或文件拆分的接口。

### BW-02 Workspace Query Context

Electron 根据 window scope 的 canonical Workspace root 懒创建 Context。成功响应在 envelope 中返回不透明的 `workspaceContextId` 和 context-local `generation`，二者不写入 ReadModel。

Workspace 切换或窗口销毁后，旧 Context 不能继续提交结果。旧 generation 的异步结果应静默丢弃。

### BW-03 section 级结果

各业务 section 使用统一结果类型：

```ts
type ReadSection<T> =
  | { status: "ready"; data: T; issues: [] }
  | { status: "partial"; data: T; issues: ReadIssue[] }
  | { status: "unavailable"; issues: ReadIssue[] }
  | { status: "error"; issues: ReadIssue[] };
```

Workspace Context 无效、路径未授权和顶层读取失败会使整个 query 失败。单个配置、Flow 或 Checklist 输入缺失，只影响对应 section。

`ReadIssue` 包含稳定 `code` 和可选诊断信息。Renderer 根据 `code` 选择本地化文案和 tone，不能解析错误文本决定业务行为。

### BW-04 Workspace Overview Core

首版 ReadModel 只包含以下字段：

```ts
type WorkspaceOverviewCore = {
  identity: WorkspaceOverviewIdentity;
  configuration: ReadSection<WorkspaceConfigurationSummary>;
  flow: ReadSection<WorkspaceFlowSummary>;
  checklist: ReadSection<WorkspaceChecklistSummary>;
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
```

QoR 和 `baselineComparison` 在 [Backend QoR 与 Project Comparison v1](./backend-qor-project-comparison-v1.md) 加入同一 Overview contract。

### BW-05 配置摘要

Configuration 只返回 Home 与通用 Workspace header 正常展示所需的规范字段。完整参数编辑继续使用现有配置能力。

以下内容不能进入 Overview：

- 完整 `parameters.json` 或表单 schema。
- RTL/filelist 原文。
- PDK 本地路径。
- 工具私有参数和未归一化 ECC payload。

### BW-06 Flow 规则

Home、Tech Library 和 Configure 是 Renderer Navigation Item，不是 Flow Step。

`stepId` 在 Workspace 内保持开放且不透明，顺序由 `order` 返回。Renderer 不能从 `stepId` 推导目录、Artifact 路径或工具类型。

ReadModel 中的 Flow 是已提交事实。现有 Operation tracker 继续拥有运行中、取消中和实时进度等瞬态状态。页面通过一个纯 projection 合并两者，不能反向修改 ReadModel。

### BW-07 Checklist 协调

Checklist Finding 按其业务类别保持权威。只有以下冲突需要归一化：

- committed Flow Step 已成功；
- 同一 Step 的 `category: flow` Finding 仍为 failed。

此时归一化后的 Finding 返回 pass，并保留 reconciliation evidence。Artifact、configuration、provenance 和 report 等类别不受该规则影响。

### BW-08 Artifact 与日志

正常页面渲染需要的有界结构化事实直接进入 ReadModel。大型或需要专用查看器的内容只返回不透明 `ArtifactRef`，不能返回本地路径。

日志保留现有 tail、chunk 和 Runtime Event 传输。新 `useBackendFlowLogs` 只负责日志，不读取 Checklist、Flow 或布局资产。

### BW-09 Renderer Session

新增单个 Pinia store：`backendWorkspaceSession`。每个 window 只保存当前前台 Context，不增加 session map、LRU 或 normalized entity store。

状态至少覆盖：

```ts
type QueryProjectionState<T> =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ready"; data: T }
  | { status: "refreshing"; data: T }
  | { status: "stale"; data: T; issue: QueryIssue }
  | { status: "error"; data: null; issue: QueryIssue };
```

同一 Context 刷新时保留最后 committed 数据。Context 切换时立即清空。store 使用 request sequence 和 generation 拒绝过期响应。

### BW-10 缓存与失效

Electron 是唯一查询缓存所有者。每个 window Context 只保存 generation、一个 ReadModel cache 和同 generation 的 in-flight Promise。

受管事实提交时必须遵循：

```text
事实提交
  -> generation/cache 失效
  -> backendWorkspace.invalidated
  -> backendWorkspaceSession 刷新
```

首版不增加 TTL、LRU、持久化、内容 hash、跨窗口共享、stale-while-revalidate 或通用事件总线。

### BW-11 资源读取与性能

Electron 内部复用现有 `WorkspaceResourceService`。一次未缓存 Query 只建立一次 Resource Index，各 section 复用该索引。

原始 JSON 和 ECC payload 使用显式 parser 与 type guard 校验。所有读取必须有界；超限只影响对应 section。

首版记录文件数量、总读取字节、decode/parse/normalize 耗时、Query 总耗时、IPC payload、请求合并次数和 event-loop 延迟。没有主线程阻塞证据前不引入 Worker。

### BW-12 现有执行链路

保留 `waiting_for_gui_sync`、`gui_sync_degraded` 和 `operation.ack_step_rendered`。`backendWorkspaceSession` 替换旧 Core refresh task 后，Overview section 失败不能阻止 ACK。

`useWorkspace` 的打开、关闭和 Runtime readiness 行为不变。Backend 页面不再从 `resourceVersions`、路径或 raw Runtime Event 推导已提交工程事实。

## 实施决定

- 按业务模块组织 shared contract、Electron Query、IPC adapter 和 Renderer session，不建立全局 Clean Architecture 目录。
- `packages/shared` 只保存跨进程 contract。Electron 拥有 parser、归一化和业务规则。
- 只从大型 `registerIpc.ts` 中抽出 Backend Workspace adapter，不做全局 IPC 重构。
- 迁移全部 Backend Core 消费者，包括 Home、Sidebar、Run Control、Step Dashboard 和 Workspace shell 中的对应读取点。
- Frontend Workspace 文件与行为不变。共享文件只能做保持兼容所需的最小修改。
- 每个消费面切换后，在同一切片删除对应旧 parser、cache、watch 和测试。

## 删除范围

切片完成时必须删除：

- `useHomeData.ts` 及其旧缓存、watch 和仅服务旧实现的测试。
- `useHomeData` 中无消费者的布局资产逻辑。
- Backend 消费者对 `useFlowStages` 的依赖及对应旧路径。
- Backend Core 对 `resourceVersions` 的刷新依赖。
- 仅断言旧 composable 内部 ref、cache 或 watch 顺序的测试。

本 spec 不删除 `useFlowStages.ts`，因为 Frontend Workspace 仍在使用它；只删除 Backend 消费路径。本 spec 不授权改写 Frontend 数据流。

## 测试决定

主要测试模块公开行为，不固定内部 helper、缓存对象或 parser 调用顺序。

至少覆盖：

- 完整、未运行和部分完成的 Workspace。
- identity 可用但 configuration、Flow 或 Checklist 缺失的部分成功。
- 文件损坏、未知字段、未知 Step、未知状态和读取超限。
- Flow 与 Checklist reconciliation 及 evidence 保留。
- 同 generation 并发请求只执行一次。
- generation 变化后旧请求不能提交。
- 同 Context refresh 保留旧数据；Context 切换清空旧数据。
- Electron 先失效再通知 Renderer。
- Runtime 瞬态 projection 不修改 committed ReadModel。
- Overview section 失败仍完成现有 GUI ACK。
- Flow Log 的选择、tail、chunk 和 Runtime Event 行为保持。
- Frontend Workspace 相关回归测试保持通过。

## 验收条件

- [x] 当前 Backend Workspace 的 identity、配置摘要、Flow、Checklist 和日志可见行为保持。
- [x] Renderer 不读取或解析这些业务事实的原始文件和 ECC payload。
- [x] 同一业务事实只有 Electron 中的一条生产解释路径。
- [x] 一次 cache miss 只构建一次 Resource Index。
- [x] 同 generation 的相同并发查询只执行一次。
- [x] section 失败不会清空其他成功 section，也不会阻止 GUI ACK。
- [x] 已迁移 Backend 旧代码和旧测试全部删除。
- [x] Frontend Workspace 文件和行为不变。
- [x] 没有新增 Worker、事件总线、通用缓存框架或状态库。

## 不在范围内

- Workspace QoR、baseline comparison 和 Project Comparison，见下一份 spec。
- Run、Rerun、Cancel、恢复和 Operation lifecycle 重构。
- 完整参数编辑模型、Workspace 创建和 Project CRUD。
- Chip Viewer、Signoff 和完整 Step Analysis 数据迁移。
- ECC RPC、Workspace 输出格式和 Artifact Manifest 修改。
