# ECC EDA CLI 通用 Skill 设计

## 背景

现有 `.claude/skill.md` 面向面积优先的 PPA/QoR 优化，已经准确描述了 ECC 的 project/workspace 模型、CLI-only 约束、参数作用域、候选隔离和 signoff 导出条件。它不适合作为通用 ECC skill，原因是普通建项、运行、恢复和报告分析也会被引向固定的优化目标与候选搜索流程。

本次更新以 `ecc 0.1.0a12` 和 `test_ecc_ci_1005` 的 36 个真实 RTL-to-signoff 测试为依据，将文档重构为通用的 OpenECOS ECC EDA CLI 操作规范。最终仍只更新 `.claude/skill.md`，不增加脚本或运行时依赖。

## 目标

- 指导 AI 使用公开 ECC CLI 完成环境检查、建项、配置、运行、恢复、报告、signoff、收敛调优和 PPA/QoR 优化。
- 让 AI 根据用户任务选择最小必要工作流，不在普通运行请求中自动启动优化搜索。
- 以命令输出和结构化工程证据区分命令成功、flow 完成、质量门通过与 signoff READY。
- 将测试经验转化为判断原则和停止条件，不把单个设计或 PDK 的成功参数固化为通用配方。
- 保持所有项目和 workspace 状态修改可追溯、可复现，并由 ECC CLI 完成。

## 非目标

- 不修改 ECC、EDA 工具或 PDK 的实现。
- 不承诺安装 ECC 插件、EDA 工具或 PDK；CLI 缺失的生命周期能力只作为限制报告。
- 不绕过 STA、DRC、LVS 或 Harden 质量门。
- 不为用户未提出的目标自动执行长时间 PPA 搜索。
- 不把 ICS55、DreamPlace 或 `ecc 0.1.0a12` 的局部行为描述成所有版本和 PDK 的恒定事实。

## Skill 身份与触发边界

skill 名称改为 `ecc-eda-cli`。描述明确指向 OpenECOS ECC EDA 工具链，以及 RTL-to-GDS/signoff project 和 workspace 操作；同时明确排除纠错码等其他 ECC 含义。

正文标题改为“ECC EDA CLI 操作与优化”，不再把 PPA 优化作为唯一入口。

## 文档结构

采用单文件重构，按以下顺序组织 `.claude/skill.md`：

1. 适用范围与任务路由
2. 成功标准与状态模型
3. 强制约束
4. Project、Workspace 与参数作用域
5. 通用准备流程
6. 建项与补全项目
7. 完整运行、局部步骤与恢复
8. 报告分析、signoff 判定与导出
9. 失败分类与诊断
10. signoff 收敛调优
11. PPA/QoR 优化与候选选择
12. 多设计批处理与资源控制
13. 用户报告契约

现有命令示例中经当前 CLI 帮助确认有效的部分继续保留。容易受版本影响的命令、参数名和 step token 要求 AI 先查询 `--help`、`ecc doc config` 和 `ecc param show/list`，不能只凭 skill 中的示例执行。

## 任务路由

AI 在产生写操作或启动长任务前识别任务模式：

| 模式 | 进入条件 | 完成条件 |
|---|---|---|
| 检查 | 用户要求查看版本、环境、项目或 workspace 状态 | 给出诊断结果，不隐式运行 flow |
| 建项 | 没有 ECC project，或用户要求补充项目声明 | `doctor` 与 `check` 通过，项目声明可复查 |
| 执行 | 用户要求完整 flow 或指定 step | 请求范围内的步骤完成，并报告实际状态 |
| 恢复 | workspace 存在失败或中断步骤 | 原因已定位，安全修复后从正确边界继续 |
| 签核 | 用户要求报告、readiness 或导出 | checklist 和 inspect 明确 READY 后才导出 |
| 收敛 | flow 完成但 STA/DRC/LVS 等硬门失败，且用户要求跑通 | 在迭代预算内达到 READY，或以证据说明未收敛 |
| 优化 | 用户明确要求优化 PPA/QoR | 产生可签核候选比较、winner 和 fresh final 验证 |
| 批处理 | 用户要求处理多个 design | 每个 design 独立记录，并汇总 READY/BLOCKED/失败原因 |

模式可以按证据顺序衔接，但不能自行扩大用户目标。例如“运行 flow”允许生成必要报告判断结果，不自动授权 10 轮优化。

## 状态与证据模型

skill 必须明确四层状态，禁止互相替代：

```text
CLI 命令执行成功
  -> 请求的 flow step 完成
  -> signoff checklist 硬门通过
  -> signoff inspect = READY，可导出
```

证据优先级与用途：

- 退出码：仅判断命令本身是否成功执行。
- `ecc status`：判断 workspace 和步骤进度，定位首个未成功步骤。
- `ecc report step`：获取实际步骤 token、步骤证据、分析指标和 checklist 项。
- `ecc report checklist`：判断阻塞项及其证据完整性。
- `ecc signoff inspect`：作为最终 readiness 判定；不能只依赖退出码。
- `ecc report qor`：解释质量与比较候选，不代替 signoff 硬门。

测试证明完整 `17/17` flow 仍可能因 setup、DRC 或 LVS 被阻塞。QoR 的 RED/ORANGE 也不等于 signoff 失败；当 feasibility 为 PASS 且硬门 clean 时，QoR 兼容性或维度缺失只能作为质量说明。

## 操作约束

- 所有 project、workspace、参数、宏和 signoff 状态修改只通过公开 ECC CLI。
- 不直接编辑 `ecc.toml`、`project.json`、`home/params.toml`、生成配置、Tcl、状态或报告文件。
- 默认通过 `ecc log`、`ecc config` 和 `ecc report` 读取证据。若公开 CLI 无法暴露诊断所需内容，可只读检查生成日志或报告，并明确记录 CLI 能力缺口；不得借此修改状态。
- 支持 `--plain` 的业务命令使用 `--plain`。解析重复 `key=value` 时保留出现顺序，不能把它当 JSON。
- 始终显式指定 project；存在或可能存在多个 workspace 时显式指定 workspace。
- 不覆盖已有 workspace。只有用户明确授权并理解影响后才允许 `--overwrite`。
- fresh workspace 的一次性覆盖使用 `run --set`；已有 workspace 的参数修改使用 workspace 级 `param set`。
- 参数设置前查询当前版本 schema，设置后用 `param diff`、`config` 或报告确认实际值和作用域。
- 基线、候选、winner 验证使用不同 workspace，避免证据混淆。
- 只终止本任务启动且已确认身份的进程，不清理来源不明的 EDA 进程。

## 运行与恢复

通用执行顺序为：确认版本和帮助、检查 project/PDK、探测 workspace 名称、运行请求范围、生成证据、判断 signoff 状态。

恢复时先区分：

- 环境或依赖错误；
- project/参数配置错误；
- EDA step 工具失败；
- flow 完成但质量门失败；
- 报告缺失、损坏或不可评级。

环境修复后优先在原 workspace 使用 `--resume`。参数变更后依赖 ECC 的失效传播和 `--resume`/`--from` 语义，不通过删除状态或手改配置强制重跑。

测试中的 Tcl 8.6.14 脚本与 8.6.12 动态库冲突作为条件化已知问题：只有 ECC/组件版本、日志特征和可用兼容库都匹配时，才可使用进程级库覆盖恢复。skill 不写死用户目录中的 `LD_PRELOAD` 路径，也不把该 workaround 应用于其他失败。

## Signoff 判定

flow 完成后至少检查：

- setup/hold WNS、TNS 与 violation endpoint；
- DRC 数；
- LVS open/short 或 mismatch 数；
- Harden 必需产物；
- checklist blocked/attention 项；
- `signoff inspect` readiness。

只有 readiness 明确为 READY 才运行 `signoff export`。BLOCKED、证据缺失或 inspect 状态不明确时，必须回到对应步骤诊断，不能手工组装 signoff 包。

## 调优设计

### Signoff 收敛

当用户要求把 BLOCKED 设计跑通，先保持不可变 baseline，再使用 fresh workspace 做有界实验：

- 每轮只改一个参数，或一个因果关系明确的参数组。
- 记录候选名、有效参数差异、首次失效点、STA、routing、DRC、LVS 和结论。
- 默认最多 10 轮；连续退化、重复同类失败、工具能力受限或资源预算耗尽时提前停止。
- signoff 硬门是唯一收敛标准，不能用 global overflow 或 QoR 总分改善替代。

测试经验仅形成以下决策原则：

- 配置 `core_util` 与最终 route utilization 是不同口径。
- `target_density` 可能低于 padded utilization 下限并被工具自动提高，必须验证实际行为。
- padding 可能按 placement site 量化，名义不同的值可能实际等效。
- `target_overflow`、core utilization、aspect ratio、padding 和 seed 的效果均可能非单调。
- global overflow 下降不保证 detailed route、DRC、LVS 或 timing 同步改善。
- 小量局部 short 适合受控几何扰动；大范围系统性拥塞应识别工具和容量边界。
- CLI 未暴露的 router effort、repair box 上限或参数不能靠手改内部配置绕过。

### PPA/QoR 优化

只有用户明确要求优化时才进入该模式。优化优先级由用户目标决定；若目标不明确且会改变 winner，应先澄清，不能固定假设 `area > timing > power`。

候选选择顺序：

1. 过滤 signoff 不可行或证据不完整的候选。
2. 按用户指定目标做 Pareto 淘汰。
3. 按用户指定优先级和明确容差排名。
4. 指标近似相同时优先参数改动更少、离基线更近的候选。
5. 将 winner 的完整有效覆盖提升到 project，并使用 fresh final workspace 完整复跑。

QoR area 维度不等于绝对 core/die area；缺失 power 时不得虚构值或把代理指标称为 signoff power。

## 批处理与资源控制

- 每个 design 使用独立 project/workspace 状态，不共享可变配置。
- 用户没有要求并发时默认串行；并发上限由用户、许可证和主机资源共同决定。
- 启动新任务前检查内存和已有任务。测试任务使用 70% 内存门槛，该值只在用户未提供资源策略且环境允许监控时作为保守参考。
- 每个 design 完成或失败后立即记录，不能等全部任务结束后才汇总。
- 结果按用户要求的规模或名称排序，并区分 READY、BLOCKED、flow failed 和未运行。

## 用户报告契约

最终报告至少包含：

- ECC、组件和关键工具版本；
- project、PDK、design、top、时钟/频率和 preset；
- workspace 名称、参数差异和请求范围；
- flow 完成状态与首个失败点；
- checklist、STA、DRC、LVS、Harden 和 signoff readiness；
- QoR/PPA 指标的含义、缺失值和代理值；
- 恢复或调优动作及其证据；
- signoff 包路径，或无法导出的准确原因；
- CLI 能力限制与残余风险。

批处理额外报告总数、READY/BLOCKED/失败/未运行统计，以及按根因分类的失败摘要。

## 验收与验证

更新后的 skill 通过静态检查和五个行为场景验证：

1. 新项目：AI 只用 CLI 声明项目，运行 `doctor/check`，不手改配置。
2. Flow 完成但 BLOCKED：AI 不把 `17/17` 描述为签核成功，也不尝试导出。
3. Tcl 环境中断：AI 先验证错误特征，只对匹配环境使用进程级 workaround，并在原 workspace 恢复。
4. QoR RED 但 feasibility PASS：AI 正确区分质量评分与 signoff readiness。
5. 十轮未收敛：AI 按预算停止，保留最佳证据，不绕过质量门或无限追加候选。

静态检查包括 frontmatter、名称和描述的触发边界、命令与当前 CLI 帮助的一致性、无占位符、无相互矛盾规则，以及现有可靠约束是否完整保留。
