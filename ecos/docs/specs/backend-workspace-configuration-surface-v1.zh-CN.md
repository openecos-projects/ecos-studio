---
status: accepted
---

# Backend Workspace Configuration Surface v1

本文定义 Backend Workspace Configuration 的产品边界、Runtime 读取路径和 Flow 并发行为。目标是删除重复的 Config 页面，保持 Workspace Configuration、Step Configuration、Workspace Execution State 和 Engineering Snapshot 的职责分离。

## Problem Statement

当前 Workspace 有两套配置入口：Config 页面通过通用参数模型编辑 Workspace 配置，Step Configuration 又按 Flow Step 编辑同一组 canonical 参数。两套入口容易产生重复字段、手工维护的参数归属和默认值闪烁。

Flow 运行期间，Workspace 更新请求还可能在界面已打开向导后才发现冲突。旧实现会等待 Flow 结束、替换正在运行的 Workspace，或在新 Workspace 页面显示旧 Workspace 的迟到日志和结果。配置更新后的最新配置与旧 Revision 的工程结果也可能在同一页面相互覆盖，表现为旧值和新值跳变。

当前 Workspace 的 Step Configuration 读取还经过 Project Management 的目录入口，可能复用或启动 control Runtime；Workspace 运行时收尾时还会等待 final snapshot。只读配置查询因此承担了不必要的 Runtime 生命周期和延迟。

本 spec 需要收敛用户入口和跨进程边界：ECC 继续拥有 Workspace Descriptor、Parameter Catalog、Revision 和失效规则；Runtime Adapter 只负责当前 Session 的协议转换；Electron 负责产品命令、窗口和查询缓存；Renderer 只负责展示和编辑交互。

## Solution

删除 Config 路由、视图、导航元数据和专用阶段状态。旧 `/workspace/configure` 不保留兼容重定向，也不得被动态 Flow Step 路由当作有效步骤处理。Update Workspace 向导和菜单继续保留，Frontend Workspace 的只读配置摘要继续保留。

Workspace Configuration 定义为 Workspace Descriptor 的当前 committed 投影，包括设计、PDK、输入和 canonical Workspace Parameters；它不包括 Flow 执行状态、Engineering Snapshot 指标、派生几何或其他工程结果。配置始终显示当前 Workspace 的最新 Revision，旧 Revision 结果单独以 stale、只读工程证据展示。

Parameter Catalog 的 `applies` 是唯一的参数归属来源。Step Configuration 不维护 Renderer 参数清单：当前 Workspace 通过已有 Workspace Handle 直接调用 ECC 的纯读接口，Baseline Workspace 继续通过 Project Management 按目录纯读。当前读取不创建 Operation、不发布生命周期事件、不启动 control Runtime，也不等待 final snapshot。没有有效 Workspace Session 时等待会话建立，不按目录回退。

Flow 运行时，Update Workspace 在 UI 中禁用，并在提交时再次检查。Runtime Adapter 在取得 mutation lock 前后都检查 Active Workspace Operation，冲突统一返回 `operation_conflict`。New Workspace 仍可用，用于并行比较；新 Workspace 只消费自己的 Workspace Handle 和事件。

运行时事件按当前 Workspace Handle 过滤。只有事件带有当前 Handle 时才消费；事件缺少 Handle 时才允许比较 Workspace Directory。迟到的旧事件不得挂载到新 Workspace，也不得覆盖当前页面的结果或日志。

参数读取在权威快照返回前不得把默认值当成当前值展示。切换或关闭 Workspace 时必须清除旧的 loading 状态；旧 Session 的响应不得写入新页面。当前阶段保留 `useParameters` 的共享读取、编辑和保存能力，待 Workspace Configuration canonical read DTO 接入后再单独收缩为只读摘要并迁移 Electron 查询缓存。

## User Stories

1. 作为 Backend 工程师，我希望 Workspace Configuration 只有一个 ECC 权威定义，从而不同页面不会解释出不同的配置。
2. 作为 Studio 用户，我希望 Workspace 首页能看到当前已提交的配置摘要，从而不需要进入独立 Config 页面。
3. 作为 Studio 用户，我希望 Config 页面被移除后，导航中不再出现 Config 项，从而产品入口与实际能力一致。
4. 作为 Studio 用户，我希望旧 Config URL 不会被误识别为 Flow Step，从而不会打开错误的步骤页面。
5. 作为 Studio 用户，我希望 Update Workspace 向导仍可修改设计、PDK、输入和 Flow，从而结构性 Workspace 更新不受影响。
6. 作为 Studio 用户，我希望 Update Workspace 菜单仍然可用，从而删除 Config 页面不会删除必要的 Workspace 替换能力。
7. 作为 Studio 用户，我希望当前配置显示最新 committed Revision，从而不会误以为旧结果中的参数仍是当前输入。
8. 作为工程师，我希望旧 Revision 的 Flow、QoR、Checklist 和指标继续只读可见，从而可以调查配置更新前的工程结果。
9. 作为工程师，我希望 stale 工程结果和当前配置分开表达，从而旧结果不会覆盖新配置摘要。
10. 作为 Studio 用户，我希望没有默认值快照时页面不显示默认值冒充当前值，从而能区分“尚未读取”和“当前值就是默认值”。
11. 作为 Studio 用户，我希望 Workspace 切换时旧响应不会覆盖新 Workspace，从而页面不会出现旧值和新值跳变。
12. 作为 Studio 用户，我希望关闭 Workspace 时加载状态能够结束，从而不会永久显示 loading。
13. 作为 Studio 用户，我希望 Flow 运行期间 Update Workspace 按钮不可用，从而不会在执行输入固定后替换 Workspace。
14. 作为 Studio 用户，我希望向导打开后才开始 Flow 时，提交动作仍能收到冲突提示，从而不会绕过 UI 禁用状态。
15. 作为 Studio 用户，我希望 Flow 运行期间仍能创建 New Workspace，从而可以并行运行相同 Flow 做比较。
16. 作为 Studio 用户，我希望新 Workspace 只显示自己的 Step Log，从而不会看到旧 Workspace 的运行输出。
17. 作为工程师，我希望迟到的旧运行事件被丢弃，从而旧 Operation 不会改变当前 Workspace 状态。
18. 作为 Runtime Adapter 维护者，我希望 mutation lock 前后都检查 Active Operation，从而竞态窗口不能提交配置更新。
19. 作为 Agent 用户，我希望 Agent 触发的 Workspace 更新与手动更新使用相同的 Operation 冲突规则，从而自动化不能绕过执行保护。
20. 作为 Studio 用户，我希望打开当前 Workspace 的 Step Configuration 时看到 Parameter Catalog 允许的完整参数列表，从而不会遗漏未修改的字段。
21. 作为 Studio 用户，我希望参数列表由 ECC 的 `applies` 决定，而不是由页面硬编码，从而新参数可以自动进入正确的 Step。
22. 作为 Studio 用户，我希望 Flow 未运行时也能查看 Step Configuration，从而配置查看不依赖执行状态。
23. 作为 Studio 用户，我希望 Flow 运行中也能立即查看 Step Configuration，从而只读查询不等待 Flow 完成。
24. 作为 Studio 用户，我希望 Flow 收尾时也能立即查看 Step Configuration，从而 final snapshot 延迟不会阻塞配置页面。
25. 作为 Studio 用户，我希望 Step Configuration 读取不出现在 Operation 列表中，从而只读查询不会伪装成执行任务。
26. 作为 Studio 用户，我希望 Step Configuration 读取不启动额外的 control Runtime，从而查看当前 Workspace 不产生无关的进程生命周期。
27. 作为 Studio 用户，我希望 Workspace Session 尚未建立时页面等待当前会话，而不是回退到目录读取，从而不会显示旧 Workspace 配置。
28. 作为 Baseline 比较用户，我希望 Baseline Step Configuration 继续使用 Project Management 的纯目录读取，从而不创建 Baseline Workspace Session。
29. 作为 Baseline 比较用户，我希望 Baseline 读取与当前 Workspace 读取使用同一套 ECC Parameter Catalog 规则，从而比较结果具有一致语义。
30. 作为 Studio 用户，我希望配置保存继续携带 Workspace Handle、expected Revision、Step identity 和 command identity，从而并发过期写入能被拒绝。
31. 作为 Studio 用户，我希望 Step Configuration 保存仍在 Flow 运行期间只读，从而执行输入不会中途变化。
32. 作为工程师，我希望 Step Option 只使目标 Step 及下游 stale，从而不必要地重跑前置步骤。
33. 作为工程师，我希望跨多个 Step 的值仍作为 Workspace Parameter 处理，从而失效边界不会由 UI 猜测。
34. 作为维护者，我希望 Runtime Adapter、Electron 和 Renderer 使用类型化配置 DTO，从而跨进程契约不暴露文件路径或 JSON path。
35. 作为维护者，我希望删除 Config 页面后不恢复第二套参数解析器，从而 ECC 仍是工程配置事实来源。
36. 作为维护者，我希望后续 canonical read DTO 接入后再删除 `useParameters` 的编辑分支，从而当前只读摘要不会被迫迁移到临时数据源。
37. 作为维护者，我希望 Electron 的查询缓存按窗口、Workspace identity 和 Revision 隔离，从而一个窗口的配置不会污染另一个 Workspace。
38. 作为维护者，我希望 Renderer 只保存显示状态和编辑草稿，从而产品查询缓存和 Session 归属留在 Electron。
39. 作为维护者，我希望读取失败显示明确的 unavailable/error 原因，从而目录错误、Session 缺失和无可配置 Step 不会混成 Flow failed。
40. 作为维护者，我希望这些行为在 ECC、Runtime Adapter、Electron 和 Renderer 的既有测试接缝中验证，从而跨进程回归不会只在单层通过。

## Implementation Decisions

- Config 页面不是 Workspace Configuration 的长期入口。删除 Config 路由、视图、导航元数据、固定 setup stage 条目、`isConfigure` 专用状态和无消费者测试。
- 不保留旧 `/workspace/configure` 重定向。动态 Flow Step 路由必须继续只处理真实 Resolved Workspace Flow；旧 Config 路径不得挂载为 Flow Step，也不需要兼容旧书签或历史记录。
- Update Workspace 向导、菜单和 `workspace.update`/`workspace.configuration.update` 产品能力继续保留。删除页面不等于删除结构性 Workspace Update 或 Agent 命令。
- Frontend Workspace 的只读配置摘要继续使用现有共享读取能力；当前阶段不把 `useParameters` 收缩为只读 composable，不迁移其保存分支。
- Workspace Configuration 只表达当前 Workspace Descriptor 的 committed runnable configuration：设计、PDK、输入和 canonical Workspace Parameters。`core.Size`、`core.area`、`boundingBox` 等派生工程结果不属于该模型。
- 当前 Workspace 的 Step Configuration read 使用已有 Workspace Session 和 Workspace Handle，调用独立 `workspace.step_configuration.read`。它不进入 Operation Queue，不创建 Operation，不发布 operation lifecycle event，不改变 Workspace 文件。
- 当前 Step Configuration read 不等待 `final snapshot`。它可以在 Flow 未运行、运行中和收尾期间读取已提交配置；只读结果不依赖最终工程指标。
- 当前 Step Configuration 没有有效 Handle 时不按目录回退，也不调用 Project Management。会话处于 validating/loading/switching 时保持过渡状态，Session active 后自动发起读取；idle/failed 时显示稳定 unavailable/error。
- Baseline Workspace 继续使用 Project Management 的目录纯读入口，不创建 Workspace Session、不启动 Workspace 专属 Runtime、不恢复 Operation、不发布 Runtime lifecycle event。
- Step Configuration 参数列表完全由 ECC Parameter Catalog 的 `applies` 和公开参数记录决定。Renderer 不维护跨 Step 参数映射或独立的参数全集。
- 读取 DTO 必须携带 status、normalized Step identity、Workspace identity、Workspace Revision 和按 Catalog 顺序排列的公开参数记录。公开记录可以包含当前 value、catalog default、type、description、range/choices/unit；不得暴露文件路径、JSON path、内部 target 或 PDK 本机路径。
- Step Configuration update 继续使用 Step identity、flat canonical parameter patch、Workspace Handle、expected Workspace Revision 和 command identity。ECC 原子提交并按最早受影响 Step 计算 stale 范围。
- Flow 运行时 Update Workspace 的 Renderer 控件禁用只是第一层反馈。向导提交时必须再次检查当前 Workspace 是否拥有 Active Operation；Runtime Adapter 在 mutation lock 前后各检查一次，任一检查冲突都返回 `operation_conflict`。
- New Workspace 不受当前 Workspace Active Operation 限制。创建完成后新 Workspace 必须建立自己的 Session、Handle、Revision 和事件订阅；旧 Workspace 可以继续后台运行。
- Runtime event consumer 首先按当前 Workspace Handle 精确过滤。只有事件缺少 Handle 时才比较 Workspace Directory；事件同时带有旧 Handle 和当前目录时仍按 Handle 拒绝。事件过滤必须覆盖日志、Step 状态、Operation 状态和结果失效通知。
- `useParameters` 在权威快照返回前不把初始化默认值暴露为当前值。切换、关闭和 Session 替换时清除 loading；旧请求的 finally 不得把新 Session 的 loading 状态卡住。
- Renderer 请求使用现有 Workspace lifecycle/session generation 保护。迟到响应必须在 apply 前验证 Session identity、Workspace identity、Revision 和当前请求 token；失败或空 Session 不得写入旧数据。
- Workspace Configuration canonical read DTO、Electron 窗口级查询缓存和 `useParameters` 编辑分支删除属于后续阶段。本 spec 只固定它们的目标边界：缓存由 Electron 按窗口 + Workspace identity + Revision 隔离，缓存值是 ECC canonical DTO，Renderer 只持有显示状态。
- 不新增配置历史浏览器，不把旧 Revision 的 Step Configuration 写入 Engineering Snapshot，不把 stale 工程结果回填为当前配置。

## Testing Decisions

- 测试优先验证外部行为、领域结果、持久化 Revision、生命周期副作用和用户可见状态，不固定私有 helper、请求顺序或缓存内部结构。
- Renderer 路由测试验证 Config 路由和 Config setup stage 不存在，旧路径不会挂载 Config 或动态 Flow Step，导航不显示 Config，Frontend 只读摘要仍可加载。
- Renderer `useStepConfigInfo` 测试验证当前 Workspace 使用 Handle 直连 API，Baseline 继续使用 Project Management；无 Handle 时不调用目录接口，Session active 后会读取；切换 Session 时丢弃迟到响应。
- Renderer Step Configuration 测试验证读取不等待 final snapshot 的生命周期变化，Flow 未运行、运行中和收尾期间均可展示；不可配置 Step 显示 unavailable 而不是 Flow failed。
- Renderer 参数测试验证权威快照到达前不暴露默认值，Workspace 关闭或切换时 loading 清零，旧 Session 的 finally 不会卡住新 Session。
- Renderer Update Workspace 行为测试验证 Flow active 时 UI 禁用，向导已经打开后才启动 Flow 时提交仍被拒绝，New Workspace 仍可提交。
- Runtime Adapter 测试验证 `workspace.step_configuration.read` 不创建 Operation、不改变 Operation 列表、不发布生命周期事件、不等待 final snapshot，并正确绑定 Workspace Handle 和 Revision。
- Runtime Adapter 测试验证 Update Workspace 在锁前和锁后发现 Active Operation 时都返回 `operation_conflict`，无竞态路径可以提交配置替换。
- Runtime Adapter/Electron 回归测试验证新 Workspace 建立后不会消费旧 Workspace 的日志、Step 状态、Operation 或失效事件；缺少 Handle 的旧事件仅在目录匹配时允许消费。
- ECC 领域测试验证 Parameter Catalog 的 `applies` 过滤、公开参数顺序、当前值/default 返回、未知 Step、无可编辑参数、损坏 Descriptor 和不可验证 Revision 的稳定结果。
- ECC 纯读测试验证 Step Configuration read 不写入 Descriptor、Derived Backend Configuration、Engineering Snapshot、日志或其他 Workspace 文件。
- Project Management 测试验证 Baseline read 不调用 Workspace open/close，不创建 Handle，不恢复 Operation，不启动 Workspace 专属 Runtime，并保留路径 containment 检查。
- Product Command 测试验证 Step Configuration update 携带 canonical flat patch、Step identity、Handle、expected Revision 和 command identity；过期 Revision 和重复命令行为保持既有契约。
- Electron 查询测试验证当前 Configuration 与旧 stale Engineering Snapshot 分离，当前 Revision 优先，迟到旧 Revision 响应被丢弃；后续 canonical DTO 缓存迁移另行验证窗口和 Workspace 隔离。
- 保留已有 Workspace lifecycle、Runtime event、Revision/stale、Project Comparison Snapshot-only 和 Step Configuration 组件测试模式；不恢复已删除 Config 页面测试。

## Out of Scope

- 不保留旧 `/workspace/configure` 的兼容重定向、书签迁移或历史记录修复。
- 不建设新的 Config 页面、通用 Workspace Configuration 表单或第二套参数字段映射。
- 不在本 spec 中完成 Workspace Configuration canonical read DTO 的完整 Electron 查询缓存迁移，也不立即删除 `useParameters` 的编辑和保存分支。
- 不保存所有 Workspace Revision 的配置历史，不从 stale Engineering Snapshot 恢复历史配置。
- 不改变 Engineering Snapshot 的指标、QoR、Checklist、Signoff 或 Project Comparison 事实来源。
- 不改变结构性 Workspace Update 的 Backup/Do Not Backup 选择和数据丢失提示。
- 不改变 Frontend Workspace 的独立配置、日志、技术库和布局数据流。
- 不删除 Step Configuration update、Update Workspace 向导、Agent 产品命令或 Baseline 配置读取。
- 不引入新的 Runtime Adapter 进程或 ECC RPC 服务；ECC 仍在 Runtime Adapter 进程内被直接调用。
- 不实现外部手工编辑检测、配置指纹、自动 reconcile、自动回滚或执行期间动态切换配置。
- 不把查询缓存放入 Renderer，也不让 Runtime Adapter 承担 Electron 产品查询缓存。

## Further Notes

- 本 spec 使用 Backend domain glossary 中的 Workspace、Workspace Descriptor、Workspace Configuration、Workspace Handle、Workspace Revision、Workspace Session、Resolved Workspace Flow、Workspace Parameter、Step Option、Parameter Catalog、Pure Workspace Query、Workspace Execution State 和 Engineering Snapshot 术语。
- 该边界与 Backend 系统架构中“Runtime Adapter 进程内调用 ECC、Electron 通过 stdio JSON-RPC 调用 Adapter”的关系一致；当前 Workspace Step Configuration 不需要额外启动 ECC sidecar 服务。
- 该边界延续 Step Configuration read boundary、Step Configuration ECC command、configuration updates preserve stale results 以及 events-for-transient-state/queries-for-committed-facts 的既有决策。
- “最新配置”和“旧结果”必须是两个独立投影：配置来自当前 Workspace Descriptor/Parameter Catalog，结果来自带 Revision 的 Engineering Snapshot。任何页面组合两者时都必须保留各自的来源和可用性。
- 完成标准是：Config UI 和死阶段状态完全删除；当前和 Baseline Step Configuration 读取路径分离；Flow 期间更新冲突 fail closed；新旧 Workspace 事件隔离；默认值和 loading 不再闪烁或卡死；相关 ECC、Runtime Adapter、Electron 和 Renderer 检查通过。
- 本 spec 仅保存到本地仓库，不创建 Issue、不应用 `ready-for-agent` 标签、不 push、不创建 PR。
