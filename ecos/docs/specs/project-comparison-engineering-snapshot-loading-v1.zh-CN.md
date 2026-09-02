# Project Comparison Engineering Snapshot Loading v1

状态：已实现并完成本地验证（2026-09-03）；ECC 子模块提交发布后方可准备父仓 PR

## Problem Statement

芯片后端工程师打开 Project Management 时，已经完成 Flow 的 Workspace 仍可能显示 `Synth unstart`。页面有时在等待一段时间或发生 HMR 后才出现正确进度，并且在没有代码变化时可能一直保持错误状态。

当前 Project Comparison 为读取历史 Workspace 的工程事实，临时执行 Workspace open、Engineering Snapshot query 和 close。open/close 被通用 Operation 队列记录并发布完成事件，完成事件又使同一个 Project Comparison 失效，Renderer 随后刷新并丢弃过期 generation，形成自触发查询循环。HMR 只改变了循环和请求提交的时序，不是数据恢复机制。

Project Manifest 中的 Workspace `status` 还保存了一份容易过期的执行状态。真实样例中 Manifest 标记为未开始，而 Engineering Snapshot 已记录全部 Flow Step 成功。页面在权威 Snapshot 尚未提交前使用 Manifest 状态作为进度，因此把“数据尚未加载”错误展示成“工程尚未开始”。

当前比较查询还会为每个 Workspace 批量读取全部 Step Analysis 文件。初次加载、跨 Workspace Compare 和单 Workspace Findings 被绑定在同一个重查询中，使无关文件读取、JSON 解析和 IPC payload 随 Workspace 数量一起增长。通用 Snapshot Artifact inventory 同时递归扫描并哈希 output、analysis、report 和 log 文件，但其内容读取 API 没有生产调用方；固定 512 项上限只是在限制这条无所有者的扫描，并会按遍历顺序截掉 RCX、STA 和 Harden 等后续 Step 的分析引用。

用户需要 Project Management 在没有 HMR、没有临时 Runtime Session、没有固定轮询的情况下稳定展示已提交进度；运行中状态必须实时但不能伪装成已提交事实；缺失、损坏、过期或不安全的数据必须明确说明原因，不能回退到旧文件或显示为 `Synth unstart`。

## Solution

Project Comparison 以每个 Workspace 持久化的 Engineering Snapshot 作为 committed 工程事实的唯一来源。Electron 通过内部、受限、schema-validating reader 直接读取 Snapshot，不为历史比较创建 Workspace Handle 或 Runtime Session。Project Manifest 只提供 Project Workspace ID、lineage、baseline 和 Workspace Lifecycle，不再提供 Flow 执行状态。

当前 ECOS Studio 进程拥有的 Active Operation 通过独立 Execution Snapshot overlay 展示 queued、running 和 cancellation requested 状态。overlay 必须通过 Engineering Workspace ID 和 Workspace Revision 与 committed Snapshot 匹配，不能改写持久化 Flow 状态。普通 Run 保留 committed 状态并叠加运行信息；Rerun preparation 因为会删除旧 Artifact 和重置 Flow Step，必须先提交一个新的 reset revision，再叠加运行信息。

Project Management 初次加载时，每个 Workspace 只读取一个 Engineering Snapshot。跨 Workspace Step Compare 使用 Snapshot 已内嵌的完整 normalized metric records。单 Workspace Findings 只在用户选择 Step 后读取该 Step 的声明分析文件，并用 Snapshot 中的 size 和 SHA-256 验证 revision 一致性。

Electron 内部使用原生文件事件监听 `project.json` 和各 Workspace 的 `home/engineering-snapshot.json`，监听目录深度为零，不轮询、不递归扫描 Workspace。事件只作为 invalidation hint；每次失效后重新读取并校验 Manifest 或 Snapshot。监听不可用时保留最后一次已验证数据、明确提示自动刷新不可用，并提供手动 Refresh 和 focus-time revision check。

ECC Engineering Snapshot producer 不再构造通用递归 Artifact inventory。它只为当前产品实际消费的声明分析文件生成 metadata/reference。无生产调用方的通用 Artifact content API、IPC、preload exposure、共享类型和对应测试一并删除，因此不再需要通用 Artifact 数量上限。

## User Stories

1. 作为芯片后端工程师，我希望打开 Project Management 后立即看到 Workspace 的真实已提交进度，从而不把已完成工程误判为未开始。
2. 作为芯片后端工程师，我希望数据尚在读取时看到 Loading 状态，从而不会把加载过程误解为 `Synth unstart`。
3. 作为芯片后端工程师，我希望页面无需 HMR 或代码变化也能稳定加载数据，从而开发模式与发布模式具有一致行为。
4. 作为芯片后端工程师，我希望刷新页面不会启动或关闭历史 Workspace Runtime Session，从而查看 Project 不会改变运行时状态。
5. 作为芯片后端工程师，我希望一个 Workspace 的 Snapshot 缺失时看到明确原因，从而知道需要重新生成 Workspace 数据。
6. 作为芯片后端工程师，我希望一个 Workspace 的 Snapshot 损坏时看到明确原因，从而不会把损坏数据误判成未运行。
7. 作为芯片后端工程师，我希望不支持的 Snapshot schema 明确标记为不支持，从而不会发生静默兼容或错误解释。
8. 作为芯片后端工程师，我希望 Snapshot 读取权限失败时看到可操作原因，从而能够修复 Project 路径或权限。
9. 作为芯片后端工程师，我希望一个 Workspace 不可用时其他 Workspace 仍正常显示，从而可以继续比较有效结果。
10. 作为芯片后端工程师，我希望不可用 Workspace 不参与排名和推荐，从而不会由缺失数据产生错误结论。
11. 作为芯片后端工程师，我希望配置的 baseline 不可用时仍保留该 baseline 选择，从而不会被系统静默替换为另一个 Workspace。
12. 作为芯片后端工程师，我希望 baseline 不可用时看到 baseline delta 不可用，从而不会把缺失比较解释为数值相同。
13. 作为芯片后端工程师，我希望 Project Manifest 只决定 Workspace 是否 active 或 archived，从而过期的执行状态不会覆盖 Engineering Snapshot。
14. 作为芯片后端工程师，我希望 archived Workspace 的产品生命周期仍由 Project Manifest 控制，从而加载优化不改变归档功能。
15. 作为芯片后端工程师，我希望 Project Workspace ID 继续用于 lineage、baseline 和导航，从而 Project 行为保持稳定。
16. 作为芯片后端工程师，我希望 Engineering Workspace ID 用于匹配 Snapshot 与 Operation，从而目录移动或 Project ID 差异不会串联错误数据。
17. 作为芯片后端工程师，我希望临时 Workspace Handle 不进入 Project Comparison 身份模型，从而 Runtime Session 生命周期不会污染持久化身份。
18. 作为芯片后端工程师，我希望 Active Operation 的 queued 和 running 状态实时显示，从而可以从 Project Management 观察正在执行的 Workspace。
19. 作为芯片后端工程师，我希望 cancellation requested 在终态确认前仍视为 Active Operation，从而取消过程不会短暂显示为空闲。
20. 作为芯片后端工程师，我希望运行 overlay 不会把同一 revision 中已经 completed 的 Step 降级，从而延迟或重复事件不会破坏进度。
21. 作为芯片后端工程师，我希望 Operation revision 与 Snapshot revision 不匹配时不应用 overlay，从而旧运行事件不会覆盖新工程事实。
22. 作为芯片后端工程师，我希望同一 ECOS Studio 应用其他窗口启动的 Operation 也能实时显示，从而多窗口状态保持一致。
23. 作为芯片后端工程师，我希望外部 CLI 提交新 Snapshot 后页面自动更新，从而不需要重开 Project。
24. 作为芯片后端工程师，我希望页面不猜测外部 CLI 的运行中状态，从而日志或时间戳不会产生虚假的 Active Operation。
25. 作为芯片后端工程师，我希望普通 Run 期间继续看到最后 committed 进度和独立 running overlay，从而能够区分已有结果与正在计算的结果。
26. 作为芯片后端工程师，我希望 Rerun preparation 完成清理后立即产生新 revision，从而页面不会继续声称已删除的旧 Artifact 仍然有效。
27. 作为芯片后端工程师，我希望 Rerun 在第一个 Step 完成前取消或失败时仍保留真实 reset Snapshot，从而磁盘与页面状态一致。
28. 作为芯片后端工程师，我希望 Rerun 后旧 revision 的缓存 Findings 不再显示为当前数据，从而不会把历史证据用于新 revision。
29. 作为芯片后端工程师，我希望 Dashboard 的 QoR、风险、推荐和 Signoff readiness 保持现有语义，从而加载优化不改变产品结论。
30. 作为芯片后端工程师，我希望 Step Analysis Compare 的 Workspace、指标、分组、方向、baseline delta 和 verdict 保持不变，从而优化前后比较结果一致。
31. 作为芯片后端工程师，我希望 Compare 直接使用 Snapshot 内嵌指标，从而切换到 Step Analysis 不会重新读取所有 Workspace 的详情文件。
32. 作为芯片后端工程师，我希望 metric normalization 保留 dimension、polarity、scope、corner context、analysis group、rating、project role、step role、confidence 和 source，从而 Compare 不会因精简投影而丢失语义。
33. 作为芯片后端工程师，我希望 Findings 只读取当前选中的 Workspace 和 Step，从而查看一个问题不会触发全 Project 文件扫描。
34. 作为芯片后端工程师，我希望 STA Findings 只额外读取声明的 timing issues，从而时序诊断保持完整且读取范围明确。
35. 作为芯片后端工程师，我希望快速切换 Workspace 或 Step 时旧响应被丢弃，从而迟到的异步结果不会覆盖当前选择。
36. 作为芯片后端工程师，我希望已验证 Findings 按 Workspace identity、revision 和 Step 缓存，从而重复查看同一 committed 数据不重复读取磁盘。
37. 作为芯片后端工程师，我希望 Findings 文件与 Snapshot 指纹一致时才显示，从而 summary 与 detail 始终来自同一 revision。
38. 作为芯片后端工程师，我希望指纹不一致且存在可信缓存时看到明确的 Last committed 状态，从而知道当前文件正在变化。
39. 作为芯片后端工程师，我希望指纹不一致且没有可信缓存时看到 revision mismatch 原因，从而不会展示混合版本数据。
40. 作为芯片后端工程师，我希望一个 Step 的 Findings 读取失败不影响跨 Workspace Compare，从而仍能使用已提交指标完成比较。
41. 作为芯片后端工程师，我希望 `project.json` 发生外部变化时 Workspace 列表、归档状态和 baseline 自动更新，从而 Project 产品状态保持新鲜。
42. 作为芯片后端工程师，我希望 Engineering Snapshot 发生原子替换后监听仍持续有效，从而第一次更新不会破坏后续自动刷新。
43. 作为芯片后端工程师，我希望文件事件只触发 revision-aware query，从而重复、延迟或丢失的事件不会成为工程事实。
44. 作为芯片后端工程师，我希望一次 Snapshot 变化只重读受影响的 Workspace，从而其他 Workspace 可以复用已验证缓存。
45. 作为芯片后端工程师，我希望多个快速文件事件被合并，从而一次提交不会引发查询风暴。
46. 作为芯片后端工程师，我希望自动刷新不可用时仍能查看最后已验证数据，从而 watcher 故障不会清空 Project Management。
47. 作为芯片后端工程师，我希望自动刷新不可用时看到明确提示和 Refresh 命令，从而可以主动恢复最新状态。
48. 作为芯片后端工程师，我希望窗口重新获得焦点时检查 revision，从而丢失文件事件后仍能恢复。
49. 作为芯片后端工程师，我希望 Project 关闭或 Workspace 移除后释放 watcher 和缓存，从而长期使用不会积累后台资源。
50. 作为安全维护者，我希望 Workspace canonical path 必须位于 Project root，从而 Manifest 不能通过路径或 symlink 读取外部目录。
51. 作为安全维护者，我希望 Artifact reference 必须是 Workspace 内的相对路径，从而恶意 Snapshot 不能读取任意本地文件。
52. 作为安全维护者，我希望超出 16 MiB 的 Engineering Snapshot 在解析前被拒绝，从而不可信 JSON 不会无界占用 Electron 主进程内存。
53. 作为维护者，我希望 Flow、QoR、Signoff 和 Findings 独立校验，从而一个 section 损坏不会隐藏其他可信 section。
54. 作为维护者，我希望缺失或无效数据使用稳定 reason code，从而 Renderer 只负责本地化文案而不解析错误文本。
55. 作为维护者，我希望磁盘 Snapshot 与 Runtime Snapshot 共用同一个 TypeScript validator，从而两条来源不会产生不同解释。
56. 作为维护者，我希望删除没有生产调用方的通用 Artifact content API，从而 preload 和 IPC 不保留无所有者的能力。
57. 作为维护者，我希望 Snapshot producer 只定位声明的分析文件，从而普通 output、report、log 和内部数据库数量不会影响 Project Management。
58. 作为维护者，我希望删除通用 Artifact recursive inventory 及其数量上限，从而不再维护按遍历顺序截断的隐式策略。
59. 作为维护者，我希望 Project Comparison 初次查询不产生 Workspace lifecycle event，从而查询不会使自己失效。
60. 作为维护者，我希望同 generation 的并发查询合并且旧 generation 结果丢弃，从而刷新和 Project 切换保持确定性。
61. 作为发布维护者，我希望有效 fixture 在新旧实现中产生等价的 Compare 业务结果，从而确认本次变化只改变加载和错误表达。
62. 作为发布维护者，我希望无 HMR 的发布构建也通过初次加载和自动刷新测试，从而修复不依赖开发服务器时序。

## Implementation Decisions

- Engineering Snapshot 是 Workspace committed Flow、QoR、Signoff 和 Artifact metadata 的权威来源；Runtime Event 只是 invalidation 或 execution notification。
- Project Manifest 继续拥有 Project Workspace ID、lineage、baseline 和 Workspace Lifecycle。当前只有 archived 影响生命周期；其他历史执行状态不再参与进度、QoR 或 Signoff 判断。
- Electron 从每个已验证 Snapshot 建立 Project Workspace ID 到 Engineering Workspace ID 的映射。路径只作为 locator，Workspace Handle 只属于 Runtime Session。
- Project Comparison 使用一个聚焦的 Electron 内部 Snapshot reader。它直接读取持久化 Snapshot，不调用 Runtime Adapter 打开或关闭空闲 Workspace，也不启动 per-Workspace sidecar。
- Snapshot reader 先 canonicalize Project root，再读取和验证 Manifest，最后 canonicalize 每个 declared Workspace。Workspace 的 lexical path 或 real path 逃逸 Project root 时拒绝读取和监听。
- Snapshot reader 在解析前使用 16 MiB 单文件上限，该值与 Runtime Adapter 协议 payload boundary 一致。超限返回实际大小与允许大小。
- Snapshot envelope 必须严格验证 JSON、schema version、Engineering Workspace ID 和 Workspace Revision。envelope 无效时整个 Workspace Snapshot 不可用。
- Flow、QoR、Signoff 和 per-Step Findings 在 envelope 有效后独立验证。section 失败不会清空其他有效 section。
- 磁盘 Snapshot 与 Runtime Snapshot 使用同一个 TypeScript validator。现有只保留 metric id、name、value、unit 和 polarity 的 reduced projection 不能作为 Project Compare 输入。
- 原始 Snapshot、绝对 Workspace 路径和 artifact reference 不进入 Renderer。Renderer 只消费 normalized Project Comparison ReadModel 和稳定 reason code。
- 不读取 `home/flow.json` 作为 committed progress fallback，不从旧 QoR 文件重建 Snapshot，不执行浏览时迁移，也不兼容旧 Workspace 格式。
- Snapshot 缺失、非法 JSON、不支持 schema、读取失败、超限和 Engineering Workspace ID 不匹配分别使用稳定 reason code。
- Workspace path 逃逸、Artifact reference 逃逸、Flow 无效、QoR 无效、Signoff 无效和 Artifact 无效分别使用稳定 reason code。
- 当前稳定 reason code 至少包括 `ENGINEERING_SNAPSHOT_MISSING`、`ENGINEERING_SNAPSHOT_INVALID`、`ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED`、`ENGINEERING_SNAPSHOT_READ_FAILED`、`ENGINEERING_SNAPSHOT_TOO_LARGE`、`ENGINEERING_WORKSPACE_ID_MISMATCH`、`WORKSPACE_PATH_OUTSIDE_PROJECT`、`ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE`、`ENGINEERING_FLOW_INVALID`、`ENGINEERING_QOR_INVALID`、`ENGINEERING_SIGNOFF_INVALID`、`ENGINEERING_ARTIFACT_INVALID`、`ARTIFACT_REFERENCE_MISSING` 和 `ARTIFACT_REVISION_MISMATCH`。
- Renderer 将 reason code 格式化为面向用户的文案。未知 code 使用通用不可用文案，但不能变成 `Synth unstart` 或 success。
- 单 Workspace envelope 失败使 Project Comparison 返回 partial；其他 Workspace 保持可见。只有 Project root 或 Project Manifest 无效才使整个 Project Context 查询失败。
- 无有效 QoR 的 Workspace 不进入 ranking 和 recommendation。已选择但不可用的 baseline 保留选择，baseline delta 明确不可用。
- Active Operation 是 queued 或 running Operation，包括已请求取消但尚未确认终态的 Operation。
- Execution Snapshot overlay 与 committed Project Comparison 分开刷新。overlay 只有在 Engineering Workspace ID 与 Workspace Revision 同时匹配时才能应用。
- overlay 在同一 revision 内不能把 completed Step 降级。它可以标记当前 Step queued、running 或 cancellation requested，但不能写入 persisted flow state。
- execution overlay 只覆盖当前 Electron Runtime Service 拥有的 Operation，包括同一应用其他窗口。外部 CLI 或独立桌面进程只通过新的 committed Snapshot 被观察。
- 普通 Run 保留当前 committed Snapshot，并在其上叠加 Active Operation。
- Rerun 清理和 reset 成功后立即提交 `flow.rerun_prepared` revision。Operation 同步更新到该 revision，并在 preparation notification 中携带它。
- Rerun preparation revision 之后，受影响 Step 的旧 Findings cache 只属于历史 revision，不能作为当前 Last committed 数据展示。
- 本次不实现 Artifact staging 或 Rerun 成功后的原子目录切换。
- Project Management 初次加载每个 Workspace 只读取一个 Engineering Snapshot。读取并发保持小且有界，同 revision 查询复用 Electron cache。
- Step Compare 使用 Snapshot 中完整 normalized metric records，不读取 per-Step detail files。其 metric fields、分组、排序、baseline 和 verdict 与现有行为等价。
- Findings 使用专用、typed、非路径型查询，只接受 Project Comparison Context、Project Workspace ID 和 Step identity。Electron 根据 validated Snapshot 解析实际 reference。
- Findings 只读取所选 Step 的 `qor_metrics.json`、`qor_summary.json` 和 `qor_hotspots.json`；STA 可以额外读取声明的 timing issues。
- Findings cache key 包含 Project Workspace ID、Engineering Workspace ID、Workspace Revision 和 Step identity。选择变化使用 generation 丢弃迟到结果。
- detail 文件只有在实际 size 和 SHA-256 与当前 Snapshot reference 一致时才有效。
- 指纹 mismatch 时，旧 revision 的已验证 cache 只有在它仍是当前 committed revision 时才能以 Last committed 标识保留；没有可信 cache 时返回 `ARTIFACT_REVISION_MISMATCH`。
- 一个 Findings query 失败只影响对应 Workspace 和 Step，不移除 Step Compare 或其他 Workspace 的详情。
- Engineering Snapshot producer 按 Flow Step 直接解析声明的 analysis 文件，不递归遍历通用 output、analysis、report 或 log 目录。
- Snapshot Artifact metadata 只保留当前产品消费的 per-Step metrics、summary、hotspots 和 STA timing issues reference、size 与 SHA-256。
- 删除通用 recursive Artifact inventory、固定 512 项上限和 bounded traversal helper。
- 删除无生产调用方的通用 Artifact open/chunk API，包括共享 contract、IPC channel、preload exposure、Electron forwarding methods 和只覆盖该死链路的测试。
- Chip Viewer、Signoff export、Design Report、Workspace Resource 和日志 tail 使用各自已有专用能力，不改为通用 Artifact API。
- Electron 内部 watcher 监听 Project root 和每个 Workspace 的 `home` directory，设置 depth zero、禁用 polling，并只接受目标 Manifest 或 Snapshot 文件事件。
- watcher 先监听 Project root 并等待 ready，再读取 Manifest、reconcile Workspace watch set、等待 Workspace watcher ready，最后读取 Snapshots，以关闭 read-subscribe race。
- `project.json` 变化使 Project Context 失效并重新验证 Manifest、baseline、Workspace Lifecycle 和 Workspace watch set。
- `engineering-snapshot.json` 变化只使对应 Workspace cache 失效。Runtime commit event、显式 Refresh 和 focus-time revision check 走同一 invalidation path。
- watcher event 不是事实。事件经过 debounce 和 revision deduplication 后触发 reread；其他 Workspace 使用已验证 cache。
- watcher startup 或 runtime error 不使 committed data 失败。ReadModel 暴露自动刷新不可用状态，Renderer 提供 Refresh command。
- watcher 不增加固定轮询或后台 retry loop。重新进入 Project 时重新建立 watcher；Project 关闭或 Workspace 移除时释放 watcher 和 cache。
- Project Context 切换立即清空旧 Project projection；同 Context refresh 可以保留最后 verified data 并显示 refreshing。
- 本次不增加 Worker、持久化 cache、LRU、通用事件总线、新状态库、feature flag 或双读兼容层。只有测量证明 main-thread normalization 成为瓶颈时才单独引入 Worker。
- 用户可见功能保持不变的范围包括 Dashboard 进度、QoR、Signoff readiness、风险、推荐、baseline、Step Compare 和 Findings 内容。刻意变化仅包括 Loading、partial、unavailable、Last committed 和 auto-refresh unavailable 的正确表达。

## Testing Decisions

- 主要测试接缝是公开的 Backend Project Comparison API。测试通过真实临时 Project root、Project Manifest 和 Engineering Snapshot fixture 观察 select、query、refresh、invalidation 和 targeted Findings 的结果，不固定内部 helper 或 class 拆分。
- 第二个跨进程契约接缝是 ECC Engineering Snapshot producer 与 Rerun preparation commit。它验证 Snapshot identity、revision、Flow、完整 metric fields、声明 Artifact references 和 reset revision，而不通过 Renderer 间接推断 Python 行为。
- 使用现有 Backend Project Comparison service 测试作为 Project Context、generation、request coalescing、partial result 和 invalidation 的 prior art。
- 使用现有 Project Management filesystem 测试作为真实临时目录、bounded read、symlink escape 和 missing file 的 prior art。
- 使用现有 Runtime Service 和 Operation 测试作为 Active Operation、revision、Rerun、cancel、failure 和 multi-window Runtime ownership 的 prior art。
- 使用现有 Project Analysis 与 Step Analysis component 测试作为 Dashboard、Compare、Findings、empty state 和 reason-code presentation 的 prior art。
- 使用现有 watcher 的 atomic replacement 测试模式，验证临时文件 rename/replace 后第一次及后续 Snapshot 更新都能触发 invalidation。
- 文件系统测试必须覆盖监听 ready 前后的 Manifest/Snapshot 替换，证明不存在 read-subscribe gap。
- watcher 测试使用 fake timers 验证 debounce，不使用固定 sleep 断言业务结果。
- watcher 测试覆盖 `depth: 0`、无 polling、Project close、Workspace removal、Project switch 和 runtime error cleanup 的可观察行为。
- 初次查询测试断言每个 Workspace 只读取一次 Engineering Snapshot，并断言没有 Runtime Adapter workspace open、close 或 per-Workspace sidecar 调用。
- 重复无变化查询测试断言复用同 revision cache，不产生 Operation event，也不形成 self-invalidation loop。
- Snapshot 变化测试断言只重读变化 Workspace；Manifest 变化测试断言重新协调 Workspace watcher 和 baseline/lifecycle。
- focus-time check 与手动 Refresh 测试断言在 watcher 失败或事件丢失后能够恢复新 revision。
- watcher 失败测试断言保留最后 verified data、暴露 auto-refresh unavailable，并且不启动 polling/retry loop。
- identity 测试使用不同的 Project Workspace ID 与 Engineering Workspace ID，断言 overlay 以 Engineering identity 连接而页面选择仍使用 Project identity。
- overlay 测试覆盖 queued、running、cancellation requested、succeeded、failed、cancelled、重复事件、迟到事件和 revision mismatch。
- 普通 Run 测试断言 committed Step 不被同 revision overlay 降级。
- Rerun 测试断言清理完成后先提交 reset revision，Operation revision 同步推进，并覆盖首个 Step 完成前取消或失败。
- Rerun 测试断言旧 revision Findings 不再显示为当前 Last committed 数据。
- Snapshot envelope 测试覆盖 missing、invalid JSON、unsupported schema、invalid identity、invalid revision、read failure 和超过 16 MiB。
- section-level 测试分别破坏 Flow、QoR、Signoff 和单个 Artifact，断言其他 section 仍然可用。
- partial Project 测试断言不可用 Workspace 保留可见身份与 reason、有效 Workspace 继续参与比较、无效 Workspace 被排除出 ranking/recommendation。
- baseline 测试断言不可用 baseline 不被静默替换，所有 delta 明确不可用。
- Project Manifest 状态测试断言非 archived 的历史 execution status 不影响 Flow；archived 仍保持产品生命周期行为。
- path security 测试覆盖 Workspace lexical escape、Workspace symlink escape、absolute artifact reference、`..` traversal 和 artifact symlink escape。
- Findings 测试覆盖 metrics、summary、hotspots、STA timing issues、reference missing、file missing、size mismatch、hash mismatch 和 invalid JSON。
- 快速选择测试使用可控 Promise/generation，断言旧 Workspace 或旧 Step 的迟到 Findings 被丢弃。
- cache 测试断言 key 包含两类 Workspace identity、revision 和 Step；任何一项变化都会阻止旧数据作为当前结果复用。
- Step Compare 行为等价测试使用同一完整 fixture，对优化前的稳定领域结果与新 Snapshot projection 做逐字段比较；允许变化的只有加载和错误状态文案。
- metric projection 测试必须覆盖 dimension、polarity、scope、corner、corner context、analysis group、rating、project role、step role、source、confidence、verdict 和 baseline comparison。
- Renderer 测试覆盖 Loading 不显示 `Synth unstart`、明确 Snapshot reason、partial Workspace、Last committed、revision mismatch、auto-refresh unavailable 和 Refresh command。
- Artifact producer 测试在 Workspace 中放置大量无关 output/report/log 文件，断言 Snapshot 只声明已知分析文件，文件数量不会改变 Project Analysis references。
- 删除通用 Artifact API 后，shared contract、preload、Electron handler 和 Renderer typecheck 必须证明不存在残留调用或断开的 surface。
- 性能测试以读取次数、读取字节、IPC payload 和 query coalescing 为确定性断言，不使用易波动的绝对毫秒阈值。
- 代表性 gcd fixture 应验证 13 个成功 Flow Step、181 条 QoR metrics、两个 Workspace 和 baseline comparison 的完整结果。
- 迭代时运行 ECC Snapshot/Operation、Electron Project Comparison/Runtime、Shared contract 和 Renderer Project Analysis 的聚焦测试；完成后运行所有受影响组件的非 packaging CI 等价检查。
- 因本次修改包含 preload/IPC 删除和 Electron 关键启动能力，最终验证应包含 Electron desktop typecheck、测试、build 和 smoke；未运行的检查必须明确报告。

## Out of Scope

- 不实现旧 Workspace、旧 Snapshot schema、旧配置文件名或旧 Flow/QoR 文件的迁移与 fallback。
- 不实现跨进程 Active Operation 实时发现、外部 CLI progress overlay 或 Workspace mutation lock。
- 不通过日志、临时文件、mtime 或目录变化猜测外部执行状态。
- 不实现 Engineering Snapshot 历史查询、历史 revision 存储或 Project Management 时间旅行。
- 不实现 Rerun Artifact staging、copy-on-write 或成功后的原子目录发布。
- 不调整现有 QoR score、gate threshold、polarity、recommendation、risk、timing triage、Signoff 或 baseline 算法。
- 不重设计 Project Management、Dashboard 或 Step Analysis 的视觉结构。
- 不迁移 Workspace Step Configuration baseline comparison；该功能保持自己的小范围按需配置读取。
- 不改造 Design Report、Chip Viewer、Workspace Resource、Terminal 或 Flow log tail 的专用数据通道。
- 不修改 Frontend Workspace 或 ECC-FE 集成。
- 不增加通用文件读取 API、通用 Artifact browser、catch-all command bus 或 renderer filesystem capability。
- 不增加固定轮询、Watcher 后台 retry loop、TTL cache、LRU、持久化 cache、Worker 或新依赖。
- 不要求打包构建为了本地 spec 文档生成而运行；实现阶段仍须遵守受影响路径的 CI 和 smoke 要求。

## Further Notes

- 真实 gcd Project 的两个 Manifest Workspace 都标记为 `not_started`，而对应 Engineering Snapshot revision 14 已记录 13 个 Flow Step 全部 Success；这证明 Manifest execution status 是过期的第二真相。
- gcd 的 Project Workspace ID 是 `ws_0001` 和 `ws_0002`，Engineering Workspace ID 则是独立的 `workspace-*` identity；overlay 不能用 Project ID 或路径代替 Engineering identity。
- 当前 gcd Engineering Snapshot 约 334 KiB，其中通用 512 项 Artifact metadata 约 157 KiB。删除通用 inventory 后约 177 KiB，明显低于 16 MiB 安全边界。
- 当前两个 gcd Snapshot 的 Artifact list 都达到 512 项，并因按 Step/output 优先遍历而缺少 RCX、STA 和 Harden 的分析引用。问题来自通用递归 inventory 的所有权错误，不应通过提高或取消无界扫描上限解决。
- 现有日志记录曾显示约 45 分钟内触发 4,693 次 Project Comparison query，每次读取两个 Workspace、约 80 个文件，并产生约 448 KiB 读取和 712 KiB IPC。修复应通过消除自失效和批量详情读取解决，而不是依赖 debounce 掩盖循环。
- HMR 只会扰动请求、generation 和 render 的时序。任何验收都必须在不触发 HMR 的情况下完成。
- 本 spec 延续 [Backend QoR 与 Project Comparison v1](./backend-qor-project-comparison-v1.md) 的领域所有权，并细化其 committed fact acquisition、live execution overlay、按需 Findings 和外部 invalidation 行为。
- 相关架构决定记录在仓库 ADR 0012、0029 和 0030；实现不得重新引入 Event-as-fact、Runtime-open-for-read 或 legacy fallback。
- 本文只保存在本地仓库，不发布到 issue tracker，也不应用 triage label。
