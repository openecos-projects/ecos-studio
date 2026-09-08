# Backend Architecture Main Integration v1

状态：proposed

> 覆盖说明：涉及上游 ECC CLI 集成的 Workspace Descriptor 文件名与格式、参数身份与存储、legacy compatibility、Resolved Workspace Flow 和查询副作用边界时，以 [ECC Upstream CLI Integration v1](./ecc-upstream-cli-integration-v1.zh-CN.md) 为准；本文其余 Backend Architecture 与 GUI 集成决定继续有效。

## Problem Statement

当前 Backend Architecture 重构分支需要吸收最新 `origin/main`，同时保持已经建立的 ECC headless domain、ECC Runtime Adapter、Workspace Descriptor、Engineering Snapshot 和 Backend Read Model 边界。直接接受 Git 的自动合并结果会重新引入 Studio 自己解析和写入 Workspace 参数文件的路径，并在新旧架构之间形成多个配置事实来源。

上游同时包含必须保留的产品行为：移除 FixFanout、增加 Timing Optimization 和 LEC Flow Step、展示 LEC 等价性结果、修正通知时区，以及 Chip Viewer 的 WSL/软件渲染稳定性。部分行为只修改了已经被重构删除的旧模块，部分代码虽然自动合并成功，却没有接入新的 Snapshot 和 Read Model 路径。

当前重构还把普通 `workspace.updateConfiguration` 接到了结构性 `workspace.update` 的目录替换实现。结果是用户保存一个 Workspace Parameter 时，原 Workspace 的 Flow 状态、日志、Artifact 和未声明文件可能被物理删除。这与此前原地保存参数的用户预期不一致，也没有给用户结构性 Workspace Update 所具备的数据丢失提示和备份选择。

## Solution

以当前重构的领域边界作为合并后的架构，以最新 `origin/main` 的用户行为和缺陷修复作为必须移植的能力。冲突不能整批选择 ours 或 theirs，而应按所有权处理：ECC 继续拥有 Workspace Descriptor、Workspace Parameter、Step Option、Revision、失效和 Snapshot 提交；Studio 只通过 Product Command 和 Runtime Adapter 发起领域操作并投影结果。

普通 Workspace Parameter Update 在现有 Workspace 内原子更新 Descriptor、提升 Revision，并保留一个 Stale Snapshot Predecessor。旧结果只读可见但不能参与当前执行、QoR、Project Comparison 或 Signoff。Step Configuration Update 使用独立 ECC 命令，目标 Step 及其下游失效，前置 Step 结果继续有效。结构性 Workspace Update 保持现有功能，由用户在得到充分数据丢失说明后明确选择是否保留 Workspace Replacement Backup。

Flow Step 使用 ECC 的真实身份和顺序。Timing Optimization、LEC 和 postRouteLec 是独立 Flow Step，不折叠到相邻阶段。Project Comparison 使用各 Workspace 已配置 Flow Step 的有序并集；缺失步骤为 `not_applicable`。FixFanout 是 Obsolete Flow Step，其旧状态和 Artifact 完全忽略。

## User Stories

1. 作为 Backend 工程师，我希望本地重构分支包含最新主分支修复，以便继续开发时不建立在过期代码上。
2. 作为 Backend 工程师，我希望合并主分支后仍只有一个 Workspace 配置事实来源，以免同一参数被不同模块解释成不同值。
3. 作为 ECC CLI 用户，我希望 CLI 和 Studio 使用同一个 Workspace Descriptor，以便任一工具创建的 Workspace 都能由另一个工具继续使用。
4. 作为 Studio 用户，我希望保存普通参数时保留当前 Workspace 目录和已有数据，以免一次参数修改意外删除工程证据。
5. 作为 Studio 用户，我希望参数保存原子完成，以免进程中断留下半写入配置。
6. 作为 Studio 用户，我希望成功的参数修改提升 Workspace Revision，以便并发页面和命令识别过期状态。
7. 作为工程师，我希望 Workspace Parameter 变化后整个旧 Flow 明确变为 stale，以免旧结果冒充新配置结果。
8. 作为工程师，我希望旧 Revision 的状态、指标、Finding 和摘要仍能只读查看，以便决定如何重新运行。
9. 作为工程师，我希望 stale 结果清楚显示其来源 Revision，以免与当前结果混淆。
10. 作为工程师，我希望 stale 结果不参与当前 QoR，以免比较结论使用过期数据。
11. 作为工程师，我希望 stale 结果不参与 Signoff，以免导出与当前配置不一致的证据。
12. 作为工程师，我希望下游执行不能消费 stale Artifact，以免新旧 Revision 的文件链混合。
13. 作为工程师，我希望重新运行前先清理目标 Step 及其下游固定输出目录，以免旧文件残留影响工具行为。
14. 作为工程师，我希望 Rerun Preparation Commit 完成后才开始工具执行，以便清理和失效状态先成为持久事实。
15. 作为工程师，我希望旧 Snapshot 在参数更新后保持不可变，以便历史事实不会被回写成另一种含义。
16. 作为工程师，我希望系统最多保留一个 Stale Snapshot Predecessor，以便支持当前工作流而不建设无限历史库。
17. 作为工程师，我希望新 Revision 的成功 Step 优先显示当前结果，以便逐步看见重新运行进展。
18. 作为工程师，我希望失败或取消的 Rerun 保留尚未替代的 stale 事实，以便调查旧结果与当前失败。
19. 作为工程师，我希望原始 stale Artifact 在对应 Step 开始清理后明确显示不可用，以免打开已删除或已覆盖的路径。
20. 作为工程师，我希望修改一个 Step Option 时只失效该 Step 和下游，以免无意义地重跑确定不受影响的前置阶段。
21. 作为工程师，我希望跨 Step 使用的值只能定义为 Workspace Parameter，以免错误采用局部失效。
22. 作为工程师，我希望 Step Option 的归属由 ECC schema 定义，以免 GUI 猜测参数依赖关系。
23. 作为 Studio 用户，我希望 Step Configuration 通过 Step 身份更新，以免 UI 依赖工具配置文件路径。
24. 作为 Agent 用户，我希望 Agent 参数建议使用 canonical parameter identity，以便用户确认的是工程含义而不是文件补丁。
25. 作为 Agent 用户，我希望 Agent Step Option 建议标明目标 Flow Step，以便修改范围清楚可审查。
26. 作为 Studio 维护者，我希望 Agent 和手动配置编辑走同一 Product Command，以免存在绕过验证的隐藏写入路径。
27. 作为 ECC 维护者，我希望 ECC 校验 Workspace Parameter 和 Step Option，以便错误值不能进入持久配置。
28. 作为 ECC 维护者，我希望配置命令携带 expected Workspace Revision 和 command identity，以便拒绝过期写入并支持幂等重试。
29. 作为 Studio 用户，我希望活跃 Operation 存在时配置修改被拒绝，以免执行过程中切换配置。
30. 作为 Studio 用户，我希望仍能使用结构性 Update Workspace 修改设计输入、PDK 或 Flow，以便必要时替换现有方案。
31. 作为 Studio 用户，我希望结构性更新前看到完整的数据丢失说明，以便做出知情选择。
32. 作为 Studio 用户，我希望自己选择是否保留 Workspace Replacement Backup，而不是应用替我预选。
33. 作为 Studio 用户，我希望取消备份选择后 Workspace 保持不变，以免关闭对话框触发更新。
34. 作为 Studio 用户，我希望选择备份时原 Workspace 的 Flow、Artifact、日志和用户文件被完整保留，以便后续检查或恢复。
35. 作为 Studio 用户，我希望明确选择不备份后才允许永久替换，以免普通按钮造成不可恢复的数据删除。
36. 作为 Agent 用户，我希望 Agent 不能替我选择无备份的结构性更新，以免自动化执行不可恢复操作。
37. 作为旧 Workspace 用户，我希望旧 `params.toml` 或 `parameters.json` 只能由 ECC migration 读取，以便兼容不会在 Studio 中形成第二套解析器。
38. 作为旧 Workspace 用户，我希望完整候选通过验证后才写入 Workspace Descriptor，以免失败迁移遮蔽原配置。
39. 作为 Studio 维护者，我希望 Electron 不解析或写入 Workspace TOML，以便格式所有权留在 ECC。
40. 作为 Studio 维护者，我希望删除旧参数文件 IPC、JSON path 写入和通用配置同步接口，以便跨进程边界保持领域化。
41. 作为工程师，我希望 Timing Optimization 作为独立 Flow Step 展示，以便查看其状态、日志和结果。
42. 作为工程师，我希望 LEC 和 postRouteLec 作为独立 Flow Step 展示，以便等价性检查不会被折叠进 Synthesis 或 Filler。
43. 作为工程师，我希望每个 LEC 结果属于其实际 Flow Step，以便失败位置和证据归属准确。
44. 作为工程师，我希望步骤名称归一化只处理同一身份的拼写差异，以免不同工程阶段被合并。
45. 作为 Project Comparison 用户，我希望比较列来自 Workspace Flow Step 的有序并集，以便不同 Flow 仍可比较。
46. 作为 Project Comparison 用户，我希望某 Workspace 没有的步骤显示 `not_applicable`，以便区别于存在但尚未运行的步骤。
47. 作为 Project Comparison 用户，我希望 `not_applicable` 不计入完成率和成功判定，以免短 Flow 被错误惩罚。
48. 作为 Project Comparison 用户，我希望 Snapshot 缺失或损坏显示 Workspace `unavailable`，以免被伪装成所有步骤未运行。
49. 作为旧 Flow 用户，我希望 FixFanout 不再出现在创建、执行、日志、分析或比较中，以便产品模型与当前 ECC Flow 一致。
50. 作为旧 Flow 用户，我接受历史 FixFanout 状态和 Artifact 被忽略，以便不为已删除阶段保留兼容分支。
51. 作为 Studio 用户，我希望通知时间使用本地时区，以便时间信息符合系统环境。
52. 作为 WSL 用户，我希望保留主分支的 Chip Viewer 启动和诊断修复，以便 Backend 重构不回退图形稳定性。
53. 作为维护者，我希望已删除旧模块的上游行为测试迁移到当前模块，以免为了测试而恢复旧架构。
54. 作为维护者，我希望合并后的代码不存在旧、新双路径或无消费者依赖，以便后续维护者只需理解一个实现。
55. 作为维护者，我希望 ECC、Runtime Adapter 和 Studio 在同一行为矩阵下验证，以便跨仓库契约变化不会只在一侧通过。

## Implementation Decisions

- 当前 Backend Architecture 重构定义合并后的所有权边界；上游行为必须保留，但上游旧架构实现不自动获得优先级。
- 冲突按行为移植，不允许对整个冲突集合统一选择 ours 或 theirs。
- ECC submodule 可以在 `c7f7038a` 之后增加本地修复提交；父仓库 gitlink 指向修复后的新提交。
- ECC 是 Project Manifest、Workspace Descriptor、Workspace Parameter、Step Option、Workspace Revision、失效计算和 Engineering Snapshot 的权威实现。
- Studio 通过 Product Command 和 ECC Runtime Adapter 使用 ECC 领域接口，不直接解析、迁移或写入 Workspace 配置文件。
- Project Configuration 仍是 Project 范围的可选 CLI 模板；Workspace Descriptor 仍是现有 Workspace 的唯一权威配置。
- Legacy Workspace Configuration 仅在 Descriptor 缺失时作为 ECC migration 输入。Studio 不增加 legacy TOML/JSON parser 或 writer。
- 不合入上游的 Studio-owned Workspace parameter file service、TOML dependency、参数文件 IPC、JSON path patch helper 和 Agent 文件型写入契约。
- `workspace.updateConfiguration` 改为原地、原子更新 Workspace Descriptor，不调用目录级结构性 Workspace Update。
- Workspace Parameter Update 携带 Workspace Handle、expected Workspace Revision、command identity 和 canonical parameter patch。
- Workspace Parameter Update 保持 Workspace ID 和目录不变，提升 Revision，并重新生成 Derived Backend Configuration。
- 任一 Workspace Parameter 变化使整个旧 Engineering Snapshot stale；Studio 不推断参数到 Step 的依赖关系。
- 旧 Engineering Snapshot 不被改写。配置更新生成当前 Revision 投影，并最多保留一个不可变的 Stale Snapshot Predecessor。
- Revision-aware Step Projection 优先使用当前 Revision 结果；stale 结果只作为明确标注的只读证据。
- stale 结果不能补齐当前执行输入、QoR、Project Comparison 或 Signoff 缺口。
- Snapshot 状态、指标、Finding 和摘要可以保留到当前结果替代；原始 Artifact 不做版本化复制。
- Rerun Preparation Commit 在执行前清理受影响 Step 的固定 Artifact 目录。清理后 stale Artifact 引用返回明确 unavailable。
- `workspace.updateStepConfiguration` 是独立 ECC 命令，携带 Step identity、Step Option patch、Workspace Handle、expected Revision 和 command identity。
- ECC schema 必须保证 Step Option 仅由目标 Step 消费；跨 Step 设置必须定义为 Workspace Parameter。
- Step Configuration Update 将目标 Step 及所有下游标记为 stale，并把前置 Step 结果带入当前 Revision。
- 删除 legacy `workspace.syncConfig(configPath)` 跨进程契约；GUI 和 Agent 不持有 `config/*.json` 路径或 JSON path。
- 保留现有结构性 Workspace Update。它用于设计输入、PDK、Flow 或其他结构变化，并继续通过 staging 与目录替换提交。
- 结构性 Workspace Update 执行前必须给出完整数据丢失信息，并要求用户明确选择保留 Workspace Replacement Backup或永久替换；系统不预选，取消不执行。
- Agent 不得代替用户选择无备份的结构性 Workspace Update。
- FixFanout 定义为 Obsolete Flow Step。新旧 Workspace 中与其相关的状态、Artifact、配置、日志、分析和比较数据全部忽略。
- Timing Optimization、LEC 和 postRouteLec 是独立的一等 Flow Step。不得映射到 Legal、Synthesis 或 Filler。
- Flow Step identity 对 Renderer 保持开放；名称归一化只接受同一 Step 的大小写、空格、下划线和连字符别名。
- Project Comparison 使用被比较 Workspace 已配置 Flow Step 的确定性有序并集。某 Workspace 缺失的 Step 使用 `not_applicable`，配置存在但无结果使用 `unstarted`。
- `not_applicable` 不影响 Workspace 完成率或成功判定。Engineering Snapshot 不可用是 Workspace 级 `unavailable`，不能降级为 per-Step `unstarted`。
- LEC analysis 通过现有 Step Analysis/Artifact contract 进入 Backend Snapshot 和 Step Dashboard，不恢复旧 Renderer 文件扫描。
- 已删除旧模块继续删除。上游新测试覆盖迁移到当前 Backend Snapshot、Read Model、Product Command 和组件行为接缝。
- 通知本地时区修复和 Chip Viewer WSL/软件渲染修复按上游行为保留；没有架构冲突的上游修改不得在手工解决冲突时丢失。
- 外部手工修改 Workspace Descriptor、配置语义指纹和自动 reconcile 延期，记录在 proposed ADR 0042，本 Spec 不实现。
- 本 Spec 只生成和实施本地变更，不发布 Issue、不 push、不创建 PR。

## Testing Decisions

- 测试只断言可观察领域行为、持久契约和用户结果，不固定私有 helper、临时文件名、缓存对象或内部调用顺序。
- 主验收接缝是 ECC headless Workspace API。大部分配置、Revision、失效、Snapshot 和 Rerun 行为应在这一层证明，避免在 GUI 重复构造相同矩阵。
- Runtime Adapter/Product Command 是第二接缝，用于证明 request translation、Workspace Handle ownership、expected Revision、command identity、幂等重试和错误映射。
- Backend Workspace 与 Project Comparison 查询是第三接缝，用于证明 Revision-aware Step Projection、stale evidence、动态 Flow Step 和 `not_applicable` 的最终产品语义。
- Renderer 组件测试只覆盖用户可见状态、确认交互和命令 payload，不读取磁盘或复刻 ECC 规则。
- ECC 测试覆盖 Workspace Parameter Update 不替换目录、不删除已有 Artifact、保持 Workspace ID、提升 Revision并生成 Derived Backend Configuration。
- ECC 测试覆盖任一 Workspace Parameter 变化使整个旧 Snapshot stale，并拒绝下游 Step 使用 prior-revision 输入。
- ECC 测试覆盖 Step Option 更新保留前置 Step、失效目标及下游，并拒绝 unknown Step、unknown option 和跨 Step option。
- ECC 测试覆盖 Stale Snapshot Predecessor 最多一个、旧 Snapshot 不可变，以及所有失效 Step 被替代后的清理。
- ECC 测试覆盖 Rerun Preparation 在工具执行前提交、先清理固定输出目录，并在清理失败时不开始执行。
- ECC 测试覆盖 Rerun 成功、部分成功、失败和取消后的逐 Step current/stale 投影。
- ECC 测试覆盖 stale Artifact 在清理前可读取、清理后明确 unavailable，且绝不返回已覆盖文件作为旧 Revision 证据。
- ECC 测试覆盖 Legacy Workspace Configuration 仅由 ECC migration 处理，以及 Descriptor 优先于 Derived Backend Configuration。
- Runtime Adapter 测试覆盖活跃 Operation 时拒绝配置更新、Revision conflict、重复 command identity 和 session 重连。
- Product Command 测试覆盖 Workspace Parameter Update 与 Step Configuration Update 不暴露路径，并确认 structural Workspace Update 仍走独立命令。
- Agent contract 测试覆盖 canonical Workspace Parameter proposal、Step identity proposal、用户确认和执行结果；禁止文件名、JSON path 和无备份结构更新选择。
- Backend Workspace 测试覆盖 current Revision 优先、stale predecessor 只读、current QoR/Signoff 不使用 stale 数据，以及部分 section 失败隔离。
- Step Dashboard 测试覆盖 Timing Optimization、LEC 和 postRouteLec 独立展示，以及 LEC 结果归属对应 Step。
- Flow log 测试覆盖同一 Step 的名称别名匹配，但不允许 Timing Optimization、LEC 或 postRouteLec 折叠到其他 Step。
- Project Comparison 测试覆盖不同 Flow 的有序并集、`not_applicable`、`unstarted`、`unavailable` 和完成率计算。
- FixFanout 回归测试覆盖它不出现在新 Workspace、旧 Snapshot 投影、日志、分析、配置选择、分支边界或比较中。
- Workspace Update 交互测试覆盖完整风险提示、用户显式选择 Backup/Do Not Backup、取消无副作用、备份记录和无备份永久替换。
- 已删除旧测试文件不恢复；对应新行为加入现有的 Workspace lifecycle、Runtime Adapter、Backend Snapshot、Project Comparison 和聚焦组件测试。
- 保留并运行上游通知时区测试、Electron Chip Viewer service 测试和相关 GUI 回归测试。
- 实施迭代时先运行 ECC 与 Runtime Adapter 的聚焦测试，再运行 ECC 非打包测试、Ruff lint/format、GUI `pnpm run check`、GUI build 和相关 Electron smoke。
- 最终运行版本一致性检查和 `git diff --check`。涉及 build/runtime packaging 输入时运行仓库 build，或在结果中明确说明未运行原因与残余风险。

## Out of Scope

- 发布 GitHub Issue、添加 triage label、push 分支、创建或更新 PR。
- 本轮开始解决代码冲突、修改生产代码或创建实现提交；实施需由用户另行明确开始。
- 支持或识别用户手工修改 `home/workspace.toml`。
- 在 Engineering Snapshot 中增加结构/参数配置指纹或自动 reconcile 外部编辑。
- 永久保存所有 Workspace Revision 的 Snapshot 历史。
- 复制或版本化完整 Artifact、日志、布局、报告和 Step 输出目录。
- 恢复、展示或迁移 FixFanout 历史结果。
- 把 Timing Optimization 或 LEC Step 折叠到固定粗粒度步骤。
- 为 Workspace Replacement Backup 或永久替换设置默认选择。
- 删除结构性 Workspace Update 功能。
- 将 GUI、Electron、窗口、确认对话框或最近项目职责移动到 ECC。
- 恢复 ECC JSON-RPC server 或 Studio-owned Workspace migration。
- 改写 Frontend Workspace 数据流；共享契约只做保持 Frontend 兼容所需的最小调整。
- 与本次主分支集成无关的 UI 重设计、性能框架或通用缓存抽象。

## Further Notes

- 本 Spec 综合当前对话中已经逐项确认的决定，不再进行额外访谈。
- 当前父仓库 merge 已开始但未完成：存在 26 个内容冲突和 14 个 delete/modify 冲突，尚无 merge commit。
- 显式冲突之外还存在语义冲突：自动合并的旧参数 IPC/TOML 路径会违反新所有权，新 Snapshot 模块则尚未承接全部 Timing Optimization/LEC/FixFanout 行为。
- ECC 当前 gitlink 为 `c7f7038ae13f85e5e2e4229d766ed85f64371349`。实施允许在其后创建本地修复提交并更新父仓库 gitlink，但暂不发布远端。
- 相关 accepted 决策记录在 ADR 0031 至 ADR 0041；外部参数编辑方案仅记录为 proposed ADR 0042。
- 根目录未跟踪的 npm manifest 文件与本 Spec 无关，不应进入后续 merge commit。
- 本 Spec 仅保存在本地仓库，不发布到 issue tracker，也不应用 `ready-for-agent` 标签。
