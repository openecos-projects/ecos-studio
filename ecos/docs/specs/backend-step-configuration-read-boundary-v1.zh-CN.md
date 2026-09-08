---
status: implemented
---

# Backend Step Configuration Read Boundary v1

状态：implemented

> 后续契约说明：当前读取生命周期与零副作用要求继续有效；上游 ECC CLI 集成后的 Parameter Catalog、Descriptor、公开参数记录和 Step Option 存储以 [ECC Upstream CLI Integration v1](./ecc-upstream-cli-integration-v1.zh-CN.md) 为准。

## Problem Statement

`c36cf8ad` 将 Backend Step Configuration 从 Renderer 直接读写配置文件迁移到了 ECC 领域命令，这是正确的 ownership 方向，但读取路径没有与产品运行时语义分开。当前 Backend `id=config` 请求被强制改写为 `workspace.info`，随后进入通用 Operation Queue 并发布 Operation lifecycle event。一个只读查询因此会表现成一次 Runtime Operation，可能触发 Project 或 Workspace 自失效，也会在不支持配置的 `Synthesis` Step 上产生 `Flow failed` 通知。

同一提交还让 Project Management 为读取 Baseline Configuration 临时执行 Workspace open、配置查询和 close。这个路径创建了不必要的 Runtime Session，并且不能保证读取过程没有迁移、刷新、日志或其他磁盘副作用。

现有产品语义没有要求保存旧 Revision 的 Step Configuration。配置更新后，Workspace 应展示最新的 committed Configuration；旧 Revision 只作为明确标记的只读工程结果保留。若把旧结果 Revision 和当前配置混在同一个读取模型中，用户会误以为当前配置属于旧结果，或为了避免混淆而建设没有消费者的配置历史。

本 Spec 需要建立一个深的 ECC 领域读取模块和清晰的 Runtime/Electron seams：ECC 保留芯片工程配置规则，Runtime Adapter 只负责协议转换，Electron 负责产品结果映射，Renderer 只负责展示和交互。读取必须是只读查询，不得借用 Operation 机制。

## Solution

为 Step Configuration 建立独立的只读接口。ECC 提供唯一的领域读取实现，按 Flow Step identity 定位配置，返回当前 Workspace 的完整有效配置和 Workspace Revision。完整有效配置由当前工具配置、Workspace Parameter 派生值和已提交 Step Option patch 共同决定；Descriptor 中的 patch 不是 Renderer 的最终展示数据。

当前 Workspace 和 Baseline Workspace 使用不同的 Adapter：

- 当前 Workspace 通过已有 Workspace Session 查询，但查询直接调用 ECC，不进入 Operation Queue，不发布 `operation.started`、`operation.completed`、`operation.failed` 或 `operation.cancelled`。
- Baseline Workspace 通过 Project Management 的无 Session 读取入口查询。Electron 先校验 Project 与声明 Workspace 的路径归属，ECC 使用纯读实现加载并解析当前配置，不启动 Workspace 专属 sidecar、不恢复 Operation、不创建 Workspace Handle，也不产生磁盘写入；跨进程调用可复用已有 control Runtime。

读取结果携带 `workspaceId` 和 `workspaceRevision`。调用方允许并发读取；如果响应 Revision 已不是当前上下文的 Revision，Renderer 或 Electron 丢弃响应并重新读取。配置读取始终展示目标 Workspace 当前最新的 committed Configuration，不读取旧 Snapshot，也不保存旧配置历史。

ECC 对没有可编辑配置的 Step 返回正常的 `unavailable` 领域结果。Runtime Adapter 和 Electron 将其映射为 `missing`，不会生成 Operation failure。未知 Step、配置文件损坏、配置格式错误和权限错误仍然保留为可诊断的错误结果。

通用 `workspace.info` 继续服务非配置的 Runtime 信息，但不再承载 `id=config`。旧的 `workspace.syncConfig(configPath)`、Backend 配置路径型资源、Backend 配置的 GUI JSON path 读写、临时 `suppressEvents` 方案和所有通过通用 Operation 读取配置的调用方一起删除或迁移。仍被 Frontend、日志、技术库或布局功能使用的通用文件 API 不在本次删除范围内。

## User Stories

1. 作为 Backend 工程师，我希望 Step Configuration 的工程规则只有 ECC 一个权威实现，从而 GUI 和 Runtime Adapter 不会各自解释配置文件。
2. 作为 Backend 工程师，我希望 ECC 只返回领域配置结果，从而 ECC 不需要知道 Electron 的 IPC DTO 或 Renderer 状态。
3. 作为 Studio 用户，我希望打开当前 Workspace 的 Step Configuration 时看到当前最新配置，从而配置编辑器不会展示已经过期的内容。
4. 作为 Studio 用户，我希望读取配置不会出现在 Operation 列表中，从而查看配置不会伪装成一次执行。
5. 作为 Studio 用户，我希望读取配置不会触发 Runtime lifecycle event，从而只读查询不会造成页面自失效或刷新循环。
6. 作为 Studio 用户，我希望 Flow 正在运行时仍然可以查看当前配置，从而查询不会阻塞或干扰执行。
7. 作为 Studio 用户，我希望 Flow 运行期间仍不能修改配置，从而执行输入不会在运行中被切换。
8. 作为 Studio 用户，我希望配置响应带有 Workspace Revision，从而可以识别读取期间发生的配置变化。
9. 作为 Studio 用户，我希望迟到的旧 Revision 配置响应被丢弃，从而新配置不会被旧响应覆盖。
10. 作为 Studio 用户，我希望配置更新后界面显示新 Revision 的配置，从而我能立即确认保存结果。
11. 作为工程师，我希望配置更新后的旧 QoR、Flow 状态、Finding 和结果仍然可见，从而可以调查更新前的工程状态。
12. 作为工程师，我希望旧工程结果明确标记为旧 Revision，从而不会误以为它们属于当前配置。
13. 作为工程师，我不希望系统为了展示旧结果而保存旧 Step Configuration，从而 Workspace 不会积累没有产品用途的配置历史。
14. 作为 Baseline 比较用户，我希望看到 Baseline Workspace 当前最新配置，从而比较的是目标 Workspace 现状而不是某个隐含的历史配置版本。
15. 作为 Baseline 比较用户，我希望读取 Baseline Configuration 不启动 Runtime Session，从而查看历史 Workspace 不会改变运行时状态。
16. 作为 Baseline 比较用户，我希望 Baseline 读取不启动 Workspace 专属 sidecar、不恢复 Operation 且不发布事件，从而 Project Management 保持纯读。
17. 作为 Baseline 比较用户，我希望 Baseline 读取失败时看到稳定原因，从而可以区分路径错误、配置缺失和配置损坏。
18. 作为 Project Comparison 用户，我希望工程事实继续来自 Engineering Snapshot，从而比较查询不依赖实时 Runtime 配置读取。
19. 作为 Project Comparison 用户，我希望 Snapshot 缺失或损坏时显示 Workspace unavailable，从而不会回退到一次临时 Workspace open。
20. 作为 Studio 用户，我希望没有可编辑配置的 `Synthesis` Step 显示为没有配置，而不是 Flow failed，从而正常的能力差异不会制造错误通知。
21. 作为 Studio 用户，我希望未知 Flow Step 被明确拒绝，从而拼写错误不会被当成配置缺失。
22. 作为 Studio 用户，我希望配置文件损坏被明确报告，从而可以修复 Workspace，而不是看到空配置并误以为读取成功。
23. 作为 Studio 用户，我希望读取结果包含 catalog 默认值和 Descriptor 当前值，从而编辑器不会丢失未修改字段。
24. 作为 Studio 用户，我希望 GUI 不需要知道 `config/*.json` 文件名或 JSON path，从而配置文件布局变化不会破坏界面。
25. 作为 Studio 用户，我希望配置保存继续使用 Step identity、Workspace Handle、expected Revision 和 command identity，从而并发过期写入会被拒绝。
26. 作为 ECC 维护者，我希望 Step Option 的归属和可编辑性继续由 ECC schema 决定，从而跨 Step 参数不会被 GUI 错误地局部失效。
27. 作为 Runtime Adapter 维护者，我希望读请求和写 Operation 使用不同的接口，从而生命周期、取消和队列语义不会混入查询。
28. 作为 Electron 维护者，我希望 Electron 负责窗口、Project 路径和 Workspace ownership 校验，从而 ECC 不承担产品安全边界。
29. 作为 Renderer 维护者，我希望 Renderer 只接收类型化配置 DTO，从而不会读取磁盘、解析 Descriptor 或推断参数依赖。
30. 作为 Agent 用户，我希望 Agent 与手动配置编辑使用同一组 canonical 参数，从而自动化和 GUI 不会出现不同配置解释。
31. 作为 Agent 用户，我希望 Agent 的配置读取不通过通用 `workspace.info`，从而不会制造伪 Operation。
32. 作为 Frontend 用户，我希望现有 Frontend 文件、日志和技术库读取继续工作，从而 Backend 配置清理不会误伤其他工具。
33. 作为 Studio 维护者，我希望废弃 `workspace.syncConfig(configPath)` 完全移除，从而跨进程契约不再暴露文件路径和 JSON path。
34. 作为 Studio 维护者，我希望临时 `suppressEvents` workaround 被删除，从而查询不需要伪装成 Operation 再屏蔽通知。
35. 作为 Studio 维护者，我希望旧 Backend 配置路径资源和无消费者测试一起删除，从而代码库只保留一条配置读取路径。
36. 作为 Studio 用户，我希望读取动作不会修改 Workspace 文件，从而查看配置不会产生隐藏的迁移、刷新或派生文件写入。
37. 作为 Studio 用户，我希望手工修改配置文件的行为仍按既有范围处理，从而本次读取重构不会偷偷引入外部编辑 reconcile。
38. 作为维护者，我希望 ECC、Runtime Adapter、Electron 和 Renderer 在同一行为矩阵下验证，从而跨进程契约不会只在单侧通过。

## Implementation Decisions

- ECC 的 Workspace Configuration 模块是配置工程语义的深模块。它负责 Flow Step identity 归一化、可编辑配置判断、有效配置读取、schema 约束和更新失效语义；不负责 IPC、窗口 ownership、GUI 状态、Operation Queue 或 Project Comparison。
- ECC 对外保留一个领域读取接口，输入 Workspace 领域对象和 Step identity，输出当前有效配置、规范化 Step identity、Workspace identity、Workspace Revision，以及可区分的 unavailable/error 结果。
- 当前有效配置由 ECC 从当前已提交的工具配置和 Descriptor Step Option patch 形成。读取结果不是配置文件路径，也不是只包含用户 patch 的局部对象。
- Runtime Adapter 新增独立的 `workspace.step_configuration.read` 读取协议。它只负责 request translation、Session 绑定、Revision 传递和错误映射；读取协议不创建 Runtime Operation。
- 当前 Workspace 的读取入口允许使用已有 Session，但直接调用 ECC 查询，不调用 Runtime Operation Queue，不设置 in-flight operation，不产生 lifecycle event，也不参与取消语义。
- Baseline Workspace 的读取入口由 Project Management 提供。Electron 在跨进程边界校验 Project root、声明 Workspace 路径和路径 containment 后，调用 ECC 的纯读配置实现；该入口不调用 Workspace open/close，不创建 Handle，不启动 Workspace 专属 sidecar，不恢复 Operation。
- ECC 的纯读配置实现只执行受限的 Descriptor、Flow 和当前配置读取。它不得执行 migration、derived parameter 写入、配置刷新、目录创建、日志初始化或任何 Workspace 文件写入。
- 纯读结果的 Workspace identity 和 Revision 必须来自已提交 Workspace/Snapshot 事实；如果 identity 或 Revision 不可验证，接口返回 unavailable，不得伪造当前版本。
- 纯读实现缺少配置、配置文件损坏、格式不合法或权限不足时返回稳定领域结果；“Step 没有可编辑配置”是正常 unavailable，不是 Operation failure。
- Electron 将领域 unavailable 映射为 `missing`，将可用结果映射为包含有序 `parameters`、`stepId`、`workspaceId` 和 `workspaceRevision` 的产品 DTO；Electron 不复制 ECC 的配置归属规则。
- Renderer 只展示当前目标 Workspace 的最新 committed Configuration。配置区域应显示当前 Workspace Revision；stale 标记只属于工程结果，不属于配置历史。
- 读取响应必须携带 Workspace identity 和 Revision。已有 session/generation 机制负责丢弃与当前上下文不匹配的响应；读取不需要重新进入写操作队列。
- 配置更新继续通过 ECC-owned `workspace.updateStepConfiguration` 命令完成，携带 Step identity、flat canonical parameter patch、Workspace Handle、expected Revision 和 command identity。更新原子提交当前 Descriptor，并从最早受影响 Step 起使工程结果 stale。
- 配置更新后只保留 Descriptor 当前参数；不新增独立 Step Options 历史、不把参数全集加入 Engineering Snapshot、不从 stale Snapshot 恢复配置。
- Engineering Snapshot 继续作为 Project Comparison 的 committed 工程事实来源。Project Comparison 不为读取配置而创建 Runtime Session；若产品场景需要 Baseline 当前配置，则使用 Baseline 纯读配置入口，并将它与 Snapshot 工程结果分开表达。
- `workspace.info` 保留非配置 Runtime 信息。删除 `id=config` 的配置读取实现以及所有将其当作 Backend 配置读取入口的生产调用方、类型和 mock；协议层保留 fail-closed 拒绝，通用资源中的 `config` 仅供 Frontend 文件资源使用。
- 删除 `workspace.syncConfig(configPath)`、Backend 配置文件路径型资源、Backend 配置的 GUI JSON path 读写和 `suppressEvents` 临时机制。通用文件读取保留给仍有消费者的 Frontend、日志、技术库和布局模块。
- Agent 和手动配置编辑共享 ECC 的 Step identity、有效配置和更新命令语义；Agent 不获得文件路径或 JSON path 写入能力。
- 外部手工编辑 Workspace Descriptor、配置语义指纹和自动 reconcile 仍不在本 Spec 内；读取接口不新增阻止执行或自动修复行为。
- 该 Spec 只定义本地实现目标，不发布 Issue、不应用 triage label、不 push、不创建 PR。

## Testing Decisions

- 测试跨越现有最高价值 seams，优先验证可观察领域结果、持久契约、生命周期副作用和用户状态；不固定私有 helper、临时文件名、缓存布局或内部调用顺序。
- ECC 领域读取测试验证：有效 Step 返回完整配置、identity 和可验证 Revision；`Synthesis` 等不可编辑 Step 返回 unavailable；未知 Step、缺失配置、损坏 JSON、非法配置和缺失 Revision 分别返回稳定结果；读取不写入 Descriptor、Derived Backend Configuration、配置文件、目录或日志。
- ECC 更新测试继续验证 Step Option schema、跨 Step 参数拒绝、expected Revision 冲突、command identity 幂等、目标及下游 stale，以及更新后当前读取返回最新有效配置。
- Runtime Adapter 测试验证独立读取协议的 request translation、Workspace identity/Revision 返回、Session 读取不生成 Operation 状态，以及 Baseline 读取不会被误接入 Session lifecycle。
- Runtime Adapter 回归测试验证不可编辑 Step 不产生 `operation.failed`，读取错误不会进入取消或 Operation projection。
- Electron 读取模块测试验证当前 Workspace 和 Baseline Workspace 的入口分离、Project path containment、窗口 ownership、完整有效配置 DTO、Revision mismatch 丢弃/重读和 unavailable 到 `missing` 的映射。
- Electron 回归测试验证不存在 `workspace.info(id=config)` 的产品路由、没有临时 open/info/close Baseline 读取，以及 `workspace.syncConfig`、Backend 配置路径资源和 `suppressEvents` 不再有生产消费者。
- Renderer composable 测试验证当前配置更新后展示最新 Revision、迟到旧响应被丢弃、stale 工程结果仍只读可见并标注旧 Revision，以及 unavailable Step 不显示 Flow failed。
- Agent contract 测试验证 Agent 读取和更新使用 canonical Step identity、flat dotted parameters 和 Revision，不携带文件名、JSON path 或旧同步命令。
- 保留 Project Comparison Snapshot-only 测试作为 prior art，继续断言比较查询不调用 Runtime Adapter workspace open/close、Workspace 专属 sidecar 或 lifecycle event。
- 保留现有 Workspace Resource、Runtime lifecycle、Revision/stale、Product Command 和 Step Configuration 组件测试模式；新增测试应集中在这些既有 seams，而不是恢复旧模块测试。

## Out of Scope

- 不保存旧 Revision 的 Step Configuration，不建设完整配置历史或配置版本浏览器。
- 不把参数全集或工具配置全文加入 Engineering Snapshot；Snapshot 仍只承载 committed 工程事实。
- 不改变旧工程结果的 stale 展示策略；本 Spec 只要求配置始终使用目标 Workspace 当前最新状态。
- 不实现外部手工修改检测、配置语义 fingerprint、自动 reconcile、执行阻止或自动回滚。
- 不删除仍被 Frontend、日志、技术库、布局和其他非 Backend Configuration 功能使用的通用文件 API。
- 不删除非配置用途的 `workspace.info`，也不重构与本 Spec 无关的 Runtime Operation、取消和执行事件模型。
- 不改变结构性 Workspace Update、设计输入、PDK、Flow 替换、Backup 选择或数据丢失提示。
- 不恢复旧 `workspace.syncConfig` 兼容层，不恢复 GUI 直接写配置文件，不增加第二套配置解析器。
- 不改变 Frontend Workspace 数据流或其他产品工具的配置语义。
- 不发布 Issue、不 push；本文件记录本地实现规格及其实现状态。

## Further Notes

- `c36cf8ad` 的目标是让 ECC 成为 Step Configuration 的工程权威，并以 Step identity、Revision 和 ECC-owned command 替代文件路径型写入；本 Spec 保留这个目标。
- `c36cf8ad` 的回归点是把所有 Backend `id=config` 请求接入通用 `workspace.info` 和 Operation 机制，同时让 Baseline 读取通过临时 Workspace Session 完成。实现时应替换这条 seam，而不是继续扩大通用 `workspace.info`。
- 当前工作区中的 `suppressEvents` 只能隐藏查询事件，不能使查询脱离队列；它是过渡性修复，实施本 Spec 时应删除而不是保留。
- “最新配置”和“旧结果”是两个独立的投影：配置读取当前 Workspace Descriptor/有效配置，工程结果读取带 Revision 的 Engineering Snapshot。任何 UI 组合都必须同时显示各自的 Revision 来源。
- 纯读接口应优先复用 ECC 已有的 Step identity、配置路径和 schema 规则；只有当现有生命周期加载器无法满足零写入约束时，才在 ECC 内部抽取最小的纯读实现，不向外暴露额外的解析器。
