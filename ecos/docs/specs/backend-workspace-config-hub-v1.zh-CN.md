---
status: proposed
---

# Backend Workspace Config Hub v1

本文定义 Backend Workspace 的可发现 Config 中心。目标是集中展示已提交 Workspace 身份和分 Step 参数，同时继续把三类写入拆开：结构性 Workspace Update、跨 Step Workspace Parameter 更新、Step Option 更新。本文不恢复旧 Config 页面，也不放宽 ECC 对身份字段的轻量更新拒绝。

Top Module 不再通过 Config 中心或 Update Workspace 作为身份编辑器修改。创建时确认、同一输入上只读，见 [ADR 0046](../adr/0046-top-module-is-confirmed-at-create.md) 与 [Backend Create-time Top Module Confirmation v1](./backend-create-time-top-module-confirmation-v1.zh-CN.md)。本 spec 的 Config 壳是后续迭代，不与创建时发现同一轮交付。

本文建立在已实现的 [Backend Workspace Configuration Surface v1](./backend-workspace-configuration-surface-v1.zh-CN.md) 之上。那份 spec 删除了把 Workspace Configuration 和 Step Configuration 混成一张通用参数表的 `/workspace/configure` 页面；本 spec 补回被一并带走的产品可发现性，而不是撤回那次数据模型收敛。

## Problem Statement

Studio 用户仍然需要查看已提交的 Top Module、Clock、PDK 和设计输入，并修改 PDK、输入、Flow 和步骤参数。删除旧 Config 页面在数据模型上是正确的：这些字段是 Workspace 身份或分 Step 参数，不是一张轻量参数表里的普通格子。当前产品把结构性替换留在 File → Update Workspace，把步骤参数编辑埋在 Edit → Config 的 Step Configuration 对话框里。用户找不到身份摘要，或者会把身份字段当成普通 Save。

旧 Config 页面用一次 Save 同时写身份和参数。GitHub issue #215 在 alpha.8 上表现为把 Top Module 从 LUT4AB 改成 LUT4A 后保存又弹回。那次回归的直接原因不是当前分支后来才加入的 `workspace_structure_change_requires_update`，而是把身份字段当成轻量配置刷新。当前 ECC 明确拒绝通过 `workspace.updateConfiguration` 改 Design/PDK，正是为了避免再把身份更新伪装成普通参数保存。

用户需要的不是第二张通用参数表，也不是放开轻量身份写入。他们需要一个一眼能找到的 Config 中心：身份可读；同一输入上的 Top Module 只读；改 PDK / 输入 / Flow 走 Update Workspace 和 Backup 选择；步骤参数继续按 Flow Step 各自保存。同一输入上选错 Top Module 走 New Workspace。

## Solution

把现有 Step Configuration 对话框提升为 Workspace Config 中心，而不是新建 `/workspace/configure` 路由或恢复旧 dashboard。

Config 中心包含两块，写入动作保持分离：

1. Workspace 身份摘要。只读展示当前 committed Workspace Configuration 中的 Top Module、Clock、PDK、Design 和输入相关身份。身份区没有 Top Module 编辑入口，也没有自己的 Save。Update Workspace 仍可从 File 菜单打开，用于替换 PDK、输入或 Flow；仅当那些输入路径变化时，向导才重新确认 Top Module。
2. Flow Step 参数面板。复用现有 Step Configuration 内容：左侧只列出 Parameter Catalog `applies` 允许的 Step，右侧继续用现有 Step 编辑器。每个 Step 自己的 Save 继续走 `workspace.updateStepConfiguration`。跨 Step 的 Workspace Parameter 仍按既有命令边界处理，不在身份区保存。

产品入口变成一等公民：Workspace 菜单中的 Config 打开这个中心。创建 Workspace 成功后继续自动打开该中心。旧 `/workspace/configure` 仍然不得被当成 Flow Step。Macro 继续留在 Floorplan，不发明 Macro 页。Flow 运行期间身份编辑和步骤保存都保持只读。Home 继续只读展示身份摘要，本 spec 不给 Chip Basic Info 或 Top Module 增加打开 Config 的入口。

## User Stories

1. 作为 Studio 用户，我希望有一个叫 Config 的一等入口，从而不用猜测 Top Module 和步骤参数分别藏在哪个菜单里。
2. 作为 Studio 用户，我希望 Config 中心先展示当前 Top Module、Clock、PDK 和 Design，从而确认我改的是哪份 Workspace 身份。
3. 作为 Studio 用户，我希望身份区明确只读，从而不会以为改完格子点 Save 就能换 Top Module。
4. 作为 Studio 用户，我希望身份区不提供改 Top Module，从而不会以为 Config 能换顶层模块。
5. 作为 Studio 用户，我希望改 PDK、输入或 Flow 仍走现有 Update Workspace 向导，从而结构性替换继续用已经熟悉的流程。
6. 作为 Studio 用户，我希望向导提交前仍要选择 Backup Original、Do Not Backup 或 Cancel，从而不会在不知情时丢掉结果、Artifacts、日志和用户文件。
7. 作为 Studio 用户，我希望取消 Backup 选择后 Workspace 保持原样，从而误点 Config 不会造成破坏。
8. 作为 Studio 用户，我希望 Agent 不能替我做 Backup 选择，从而自动化不能静默替换 Workspace。
9. 作为 Studio 用户，我希望 Config 中心同时列出可配置的 Flow Step，从而身份和步骤参数在同一个可发现的地方。
10. 作为 Studio 用户，我希望只看到 Parameter Catalog 允许的 Step，从而 Legalization 或 DRC 不会冒充可编辑配置。
11. 作为 Studio 用户，我希望每个 Step 仍然使用现有 Step Configuration 编辑器，从而不学习第二套参数表。
12. 作为 Studio 用户，我希望每个 Step 有自己的 Save，从而保存 CTS 参数不会被当成更新 Top Module。
13. 作为 Studio 用户，我希望未保存的步骤改动在切换 Step 或关闭 Config 前被确认，从而不会悄悄丢掉草稿。
14. 作为 Studio 用户，我希望步骤 Save 只提交该 Step 的 canonical 参数，从而 GUI 不会猜测失效范围。
15. 作为工程师，我希望 Step Option 保存只让目标 Step 及下游 stale，从而不必重跑未受影响的前置步骤。
16. 作为工程师，我希望跨多个 Step 的 Workspace Parameter 仍按 Workspace Parameter 命令处理，从而失效边界继续由 ECC 决定。
17. 作为工程师，我希望同一输入上的 Top Module 保持只读，从而纠正顶层模块走 New Workspace，而换输入才在 Update Workspace 里重新确认。
18. 作为工程师，我希望轻量 `workspace.updateConfiguration` 继续拒绝 Design 和 PDK 身份变更，从而 #215 那种“保存后弹回”不会换一种形式回来。
19. 作为 Studio 用户，我希望 Config 中心不要提供身份字段的轻量 Save，从而界面不会引导我走一条 ECC 会拒绝的路径。
20. 作为 Studio 用户，我希望 Flow 运行时身份区的 Update Workspace 不可用，从而执行输入固定后不能替换 Workspace。
21. 作为 Studio 用户，我希望 Flow 运行时步骤参数只读，从而当前 run 的输入不会中途变化。
22. 作为 Studio 用户，我希望 Flow 运行时仍能打开 Config 查看当前身份和步骤参数，从而只读查询不等待 Flow 结束。
23. 作为 Studio 用户，我希望 Flow 运行时仍能创建 New Workspace，从而可以并行比较而不是改正在跑的 Workspace。
24. 作为 Studio 用户，我希望创建 Workspace 成功后自动打开 Config 中心，从而新建后能立刻核对身份和步骤参数。
25. 作为 Studio 用户，我希望旧 `/workspace/configure` 不会打开 Config 中心或某个 Flow Step，从而历史 URL 不会伪装成步骤页。
26. 作为 Studio 用户，我希望左侧 Flow 导航继续只有真实 Resolved Workspace Flow，从而 Config 不会变成又一个步骤图标。
27. 作为 Studio 用户，我希望 Macro 编辑仍在 Floorplan，从而 Config 中心不会再发明一个没有产品模型的 Macro 页。
28. 作为 Studio 用户，我希望 Home 继续只读展示最新 committed 身份摘要，从而 Config 中心和 Home 看到同一份 Top Module。
29. 作为工程师，我希望 stale 工程结果继续和当前配置分开显示，从而旧 QoR 不会被当成新 Top Module 的结果。
30. 作为 Studio 用户，我希望身份摘要来自当前 Workspace Configuration 投影，从而不显示尚未读取的默认值冒充当前值。
31. 作为 Studio 用户，我希望 Workspace 切换时 Config 中心丢弃旧 Workspace 的身份和步骤草稿，从而不会把 LUT4AB 画到另一份 Workspace 上。
32. 作为 Baseline 比较用户，我希望 Config 中心编辑的是当前 Workspace，从而不会误改 Baseline。
33. 作为 Baseline 比较用户，我希望步骤参数仍可对照 Baseline 只读列，从而比较不需要第二套配置历史。
34. 作为 Frontend 用户，我希望这篇 Backend Config 中心不改变 Frontend Workspace 配置，从而前后端工具入口保持分离。
35. 作为 Agent 用户，我希望 Agent 改步骤参数仍走 Step Configuration 命令，从而 GUI 中心化不会给 Agent 文件路径写入。
36. 作为 Agent 用户，我希望 Agent 改 Workspace Parameter 仍走 `workspace.updateConfiguration`，从而跨 Step 值不会被 GUI 拆成多个 Save。
37. 作为 Agent 用户，我希望 Agent 不能在同一输入上改 Top Module，也不能代用户确认创建时的候选，从而自动化遵守只读身份。
38. 作为维护者，我希望 Config 中心只组合现有读取和命令，从而不恢复第二套参数解析器。
39. 作为维护者，我希望 Renderer 只持有显示状态和编辑草稿，从而 Workspace Configuration 权威仍在 ECC。
40. 作为维护者，我希望不把查询缓存放进 Renderer，从而窗口、Workspace identity 和 Revision 隔离继续留在 Electron。
41. 作为维护者，我希望不新增 Runtime Adapter 协议，从而这次只补产品入口，不改跨进程契约。
42. 作为维护者，我希望现有 Step Configuration 读取零副作用约束保持不变，从而打开 Config 中心不会创建 Operation。
43. 作为 Studio 用户，我希望关闭 Config 中心后未保存步骤改动被明确确认，从而对话框标题变化不会改变草稿保护。
44. 作为 Studio 用户，我希望身份区在配置读取失败时显示 unavailable/error，从而 Session 缺失不会被画成空白 Top Module 成功值。
45. 作为 Studio 用户，我希望无可配置 Step 时身份区仍然可见，从而没有步骤参数也不等于没有 Config。
46. 作为 Studio 用户，我希望换输入并重新确认 Top Module 后，Home 和 Config 身份区都显示新名字，从而替换结果可立即确认。
47. 作为工程师，我希望 Update Workspace 后旧结果按既有 stale 规则处理，从而身份替换不会伪造一份仍有效的旧 QoR。
48. 作为维护者，我希望这篇 spec 只作为本地实现规格，从而不依赖 Issue 或 triage 标签才能开工。

## Implementation Decisions

- Config 中心是产品壳，不是新的 Workspace Configuration 数据模型。它组合已有 Home/Overview 身份投影和已有 Step Configuration 编辑器，不引入第三套参数字段映射。
- 不恢复 `/workspace/configure` 路由、旧 Config 视图、通用 `useParameters` megatable，也不为 Config 增加 Flow Step 导航项。动态步骤路由继续拒绝 `configure`。
- 身份字段至少包括 Top Module、Clock、PDK 和 Design。输入文件若已出现在当前 Workspace Configuration 摘要中则只读展示；摘要没有的输入不在本 spec 新造读取契约，用户通过 Update Workspace 向导查看和修改。
- 身份区只读。Config 中心不提供改 Top Module。Update Workspace 仍从 File 菜单进入，提交继续走 `workspace.update`，并继续要求 Backup Original / Do Not Backup / Cancel。身份区不得调用 `workspace.updateConfiguration` 或 `workspace.updateStepConfiguration`。
- `workspace.updateConfiguration` 继续拒绝 Design 和 PDK 等结构变更，保留 `workspace_structure_change_requires_update`。本 spec 不把该拒绝当成 bug，也不为 GUI 方便而放宽。
- 步骤参数区迁移现有 Step Configuration 对话框内容，不重做编辑器。左侧列表仍由 Parameter Catalog `applies` 过滤；没有 catalog 条目的 Step 继续隐藏。
- 步骤 Save 继续按 Step 提交 canonical parameter patch，携带 Workspace Handle、expected Workspace Revision、Step identity 和 command identity。一个 Config 中心 Save 不得同时提交身份和步骤参数。
- Workspace Parameter 与 Step Option 的存储、归属和失效仍由 ECC Parameter Catalog 与既有命令决定。Config 中心不按 GUI 分区猜测哪次保存该让哪些 Step stale。
- Flow 运行期间：Update Workspace 入口禁用；步骤编辑器和 Save 只读；Config 中心仍可打开查看。向导若在 Flow 开始后才提交，仍由现有 Adapter `operation_conflict` 检查 fail closed。
- 菜单文案从“Step Configuration”提升为 Config；Update Workspace 仍留在 File 菜单，不合并进步骤 Save。Home Chip Basic Info 和 Top Module 保持只读摘要，不增加打开 Config 中心的入口。
- 创建 Workspace 成功后的自动打开继续指向 Config 中心，而不是旧 Step Configuration 标题下的纯步骤列表。
- Macro 编辑仍属于 Floorplan Step Configuration / Floorplan 视图。Config 中心不增加 Macro 分区。
- Frontend Workspace、Agent 命令契约、Engineering Snapshot、Project Comparison 和 Step Configuration 读取协议不在本 spec 修改。Renderer 只增加展示与入口编排。
- 本 spec 只定义本地实现目标，不发布 Issue、不应用 triage 标签、不 push、不创建 PR。

三类写入保持分离：

| 用户动作 | 可见控件 | 产品命令 | 副作用 |
| --- | --- | --- | --- |
| 改 PDK / 输入 / Flow（输入路径变了才再确认 Top Module） | Update Workspace 向导 + Backup 选择 | `workspace.update` | 替换 Workspace；结果、Artifacts、日志、用户文件按 Backup 选择处理 |
| 同一输入上纠正 Top Module | New Workspace | `workspace.create` | 另开一份 Workspace；当前目录不变 |
| 改跨 Step Workspace Parameter | 既有 Parameter / 配置更新路径 | `workspace.updateConfiguration` | 当前 Descriptor 提交；按 ECC 规则 stale |
| 改某 Step 的 Step Option | 该 Step 面板上的 Save | `workspace.updateStepConfiguration` | 当前 Descriptor 提交；目标 Step 及下游 stale |

## Testing Decisions

- 测试只验证用户可观察行为和既有命令边界，不固定私有 helper、对话框内部 DOM 结构或缓存实现。最高价值 seam 是 Renderer Config 中心本身：一次打开能看到身份摘要、Update Workspace 动作，以及 catalog 过滤后的步骤参数区。
- 现有 `WorkspaceStepConfigDialog` 组件测试是 prior art。扩展它，断言身份区只读展示 Top Module 等当前配置摘要、Update Workspace 动作存在、步骤列表仍只包含 catalog 允许的 Step、步骤编辑器仍是现有 Step Configuration 面板。
- 现有 TopBar 菜单测试是入口 seam。断言 Workspace 下 Config 打开 Config 中心；Update Workspace 仍在 File 菜单且 Flow 运行时禁用；Config 打开本身在 Flow 运行时仍可用。
- 现有 `openStepConfigAfterCreate` 测试继续覆盖创建成功后自动打开；语义改为打开 Config 中心，而不是暗示只有步骤参数。不新增 Home Chip Basic Info 或 Top Module 点击入口测试。
- 现有路由测试继续断言 `/workspace/configure` 不会挂载 Config 中心或动态 Flow Step。本 spec 不增加兼容重定向测试。
- Flow 运行只读沿用现有 Step Configuration 保存拦截和 Update Workspace 禁用测试。不把 Adapter `operation_conflict` 或 ECC `workspace_structure_change_requires_update` 重测一遍，除非本变更改到那些命令。
- 不新增 ECC、Runtime Adapter、Electron 查询缓存或 Agent contract 测试，因为本 spec 不改变这些跨进程契约。若实现误把身份 Save 接到 `workspace.updateConfiguration`，应在 Renderer 入口测试里直接断言该动作不存在。
- 不恢复已删除旧 Config 页面测试，不为身份区发明第二套参数表 fixture。

## Out of Scope

- 不恢复旧 `/workspace/configure` 页面、重定向、书签迁移或通用 Workspace Configuration 表单。
- 不放宽 `workspace_structure_change_requires_update`，不让 `workspace.updateConfiguration` 接受 Top Module、Clock、PDK 或设计输入身份变更。
- 不把身份更新伪装成普通 Save，不隐藏 Backup Original Workspace 语义。
- 不重做 Step Configuration 编辑器、Parameter Catalog、Step Option 失效规则或 `workspace.updateStepConfiguration` 契约。
- 不新增 Macro 页；Macro 仍在 Floorplan。
- 不把 Config 中心做成左侧 Flow Step，也不让 Config 读取创建 Operation 或等待 final snapshot。
- 不给 Home Chip Basic Info 或 Top Module 增加打开 Config 的入口；Home 只保留当前 committed 身份摘要。
- 不在本 spec 完成 Workspace Configuration canonical read DTO 缓存迁移，也不删除 `useParameters` 的遗留编辑分支。
- 不建设配置历史浏览器，不把旧 Revision 配置写入 Engineering Snapshot。
- 不改变 Frontend Workspace 创建、`cpu_top_module`、ecc-fe filelist、Signoff、QoR、Checklist、Project Comparison 或 Agent 产品命令。创建时 Top Module 发现只作用于 Backend Workspace。
- 不实现外部手工编辑检测、自动 reconcile、自动回滚或执行期间动态切换身份。
- 不发布 GitHub Issue，不应用 `ready-for-agent` 或其他 triage 标签。

## Further Notes

- 本 spec 使用 Backend domain glossary 中的 Workspace、Workspace Descriptor、Workspace Configuration、Workspace Handle、Workspace Revision、Workspace Session、Resolved Workspace Flow、Workspace Parameter、Step Option、Parameter Catalog、Pure Workspace Query、Workspace Execution State 和 Engineering Snapshot 术语。
- 相关已接受决策：ADR 0038 Agent 走领域命令、ADR 0039 配置更新保留 stale 结果、ADR 0040 Step Configuration 走 ECC catalog/command、ADR 0041 Workspace Update 必须明确 Backup 选择、ADR 0046 Top Module 创建时确认后只读。ADR 0045 的就地身份写入已被 0046 取代。
- 删除旧 Config 页面解决的是“一张表混写三类配置”。本 spec 解决的是“身份和步骤参数变得不可发现”。Top Module 本身在创建时确认、同一输入上只读。入口可以集中，写入动作不能合并。
- alpha.8 issue #215 的产品教训是：Top Module 不能当轻量字段 Save。当前 ECC 拒绝结构变更是保护，不是这次 GUI 工作要修的缺陷。
- 完成标准（后续迭代）：用户能从 Workspace 菜单打开 Config 中心；身份只读，其中 Top Module 无编辑入口；步骤参数仍按 Step 保存；`/workspace/configure` 仍被拒绝；轻量配置更新仍拒绝身份字段；相关 Renderer 测试通过。
- 本 spec 的 Config 壳不与创建时 Top Module 发现同一轮交付。
- 本 spec 仅保存到本地仓库，不创建 Issue、不应用 `ready-for-agent` 标签、不 push、不创建 PR。
