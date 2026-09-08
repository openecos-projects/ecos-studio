---
status: superseded
superseded_by: ./backend-architecture-main-integration-v1.zh-CN.md
---

# ECC Upstream CLI Integration v1

> 本预集成方案已由
> [ECC Backend Architecture Main Integration v1](./backend-architecture-main-integration-v1.zh-CN.md)
> 取代。新的 accepted 方案以最新 ECC `origin/main` 重建目标分支，并保留 main
> 的 Workspace migration 和 Flow completion 语义。

## Problem Statement

ECC 的 `yell/update_cli` 分支将先进入 ECC main。该分支扩展了 CLI 参数、Workspace 查询、报告、Signoff、PDK 管理、Flow preset、LEC Warning 和 STA 报告，同时调整了 CLI 内部模块。当前 ECOS Studio 分支又独立实现了 creator-independent Project/Workspace、Workspace Descriptor、Revision 配置更新、Engineering Snapshot、headless execution 和 Studio-owned Runtime Adapter。两组变化直接合并会产生参数 schema、配置重放、Signoff ownership、执行状态、QoR 评分和只读查询方面的冲突。

用户需要在保留上游 CLI 产品行为的前提下，把当前 ECC 后端能力提交到更新后的 main，并让 ECC CLI 与 ECOS Studio 共享同一套工程事实和持久契约。集成不能长期保留两套参数列表、两套 QoR 评分规则、两套 Signoff 实现或 CLI/Studio 各自解析 Workspace 文件的路径。

Workspace 持久格式也将发生有意的破坏性变化：`home/params.toml` 从上游的后端参数与 `config_overrides` 容器变为完整 Workspace Descriptor。该版本不读取 legacy Descriptor、不补默认值、不自动迁移，因此必须明确旧 Workspace 的失效范围和重新创建要求。

## Solution

在 `yell/update_cli` 正式合并前，先从当前本地 ECC 分支建立隔离的预集成 worktree 和本地分支，合入该上游分支的最新远端提交，解决冲突并按本 Spec 形成一版可运行候选。该候选用于提前发现和修复真实集成问题，不替代最终 main 基线，也不修改当前 Studio checkout 或原 ECC 分支。

`yell/update_cli` 正式合并后，再获取最新 ECC main，把最终 merge commit 及其后续修复合入预集成分支，重新检查完整 diff、冲突和 CI。最终 ECC PR 必须以更新后的 main 为比较和验收基线。保留上游 CLI 命令、公开 dotted parameter names、校验、报告和工具行为；当上游实现与已接受的 Workspace ownership 冲突时，CLI 改为调用共享 ECC data/engine 模块，而不恢复已经移出的 ECC Runtime/RPC 层。

`<workspace>/home/params.toml` 成为现有 Workspace 的唯一 Workspace Descriptor。它保存完整的 canonical 参数值、解析后的有序 Flow、portable design/PDK/MPC provenance 和 Workspace Revision 所需事实。Project `ecc.toml` 继续作为稀疏、可编辑的 CLI 创建模板；`parameters.json` 和各工具配置只是在 execution 或 mutation 路径中从 Descriptor 物化的派生数据。

ECC 拥有一份 Parameter Catalog、一套 Descriptor 读写、一套 Flow/Warning 语义、一套纯 QoR Scoring Policy 和一套 Signoff Engine Interface。CLI 直接使用这些领域模块，Studio 通过 Runtime Adapter 使用相同能力。Studio 保持 committed Engineering Snapshot 边界，CLI QoR 保持按需读取当前 Workspace Analysis 的边界；两者只共享纯评分规则，不强行统一生命周期。

## User Stories

1. 作为 ECC CLI 用户，我希望更新后的 CLI 命令继续可用，以便后端重构不会删除已经进入 main 的能力。
2. 作为 ECC CLI 用户，我希望现有命令名称、输出状态和主要文本格式保持兼容，以便脚本不因 Studio 集成而无故失效。
3. 作为 Studio 用户，我希望打开 CLI 创建的 Project 和 Workspace，以便选择 CLI 不会隔离桌面工作流。
4. 作为 CLI 用户，我希望打开和执行 Studio 创建的 Workspace，以便自动化不需要复制工程。
5. 作为工程师，我希望 CLI 与 Studio 使用同一 Project Manifest，以便 Workspace membership、lineage 和 lifecycle 只有一种解释。
6. 作为工程师，我希望现有 Workspace 只有一个 Workspace Descriptor，以免多个配置文件互相覆盖。
7. 作为工程师，我希望 Workspace Descriptor 固定使用 `home/params.toml`，以便保留上游文件位置并减少集成改动。
8. 作为工程师，我希望 Descriptor 保存当前 Flow 适用的完整参数集合，以便 ECC 默认值升级不会静默改变现有 Workspace。
9. 作为工程师，我希望即使参数值等于默认值也被写入 Descriptor，以便 Workspace 可以独立重现其配置。
10. 作为工程师，我希望缺少 catalog 参数的 Descriptor 被明确拒绝，以免打开时隐式补值。
11. 作为工程师，我希望旧格式 `params.toml` 被明确判为不兼容，以免长期维护 fallback 和迁移分支。
12. 作为旧 Workspace 用户，我希望错误信息明确要求重新创建 Workspace，以便不会把格式错误误认为工具执行失败。
13. 作为 CLI 用户，我希望 Project `ecc.toml` 保持稀疏模板，以便只覆盖需要调整的创建默认值。
14. 作为工程师，我希望 Project Configuration 永远不会在打开已有 Workspace 时重新应用，以免模板覆盖已提交配置。
15. 作为 CLI 和 Studio 用户，我希望参数使用同一组 dotted public names，以便 `design.frequency_mhz` 和 `cts.max_fanout` 在两个产品中含义一致。
16. 作为 ECC 维护者，我希望 Parameter Catalog 只有一份，以免 CLI 与 Studio 的参数集合逐渐漂移。
17. 作为 ECC 维护者，我希望 catalog membership 本身表示参数可配置，以免维护冗余的 `editable` 标志。
18. 作为 Studio 用户，我希望参数编辑器的数据来自 ECC catalog 和当前 Workspace 值，以免 GUI 从工具 JSON 猜测表单。
19. 作为 Studio 维护者，我希望 Step Configuration 不暴露工具配置路径、JSON path 或本地文件路径，以便工具布局变化不破坏 UI。
20. 作为 Studio 用户，我希望每个参数只在其 `applies` 指定的最早 Step 编辑，以免共享配置文件导致同一参数重复出现。
21. 作为 Studio 用户，我希望没有 catalog 参数的 Step 不显示配置入口，以免看到无意义的空表单。
22. 作为 Studio 用户，我希望 DreamPlace 参数归属于 Placement，以便 Legalization 不重复显示同一组参数。
23. 作为 Studio 用户，我希望 `type=json` 参数作为一个完整结构值编辑，以便复杂值可用而不暴露任意工具 JSON。
24. 作为 ECC 维护者，我希望 backend keys 和 tool config targets 保持内部实现细节，以便公开参数名稳定。
25. 作为工程师，我希望 Workspace Parameter 与 Step Option 共享 Descriptor 的 `[params.*]` 存储，以免同一值被两套重放逻辑覆盖。
26. 作为工程师，我希望 Step Option 只表达失效语义，以便它不再需要独立持久区或独立参数列表。
27. 作为工程师，我希望一次混合参数更新从最早的 `applies` Step 开始失效，以便一次原子提交产生确定的 rerun 范围。
28. 作为 Studio 用户，我希望参数更新携带 expected Revision 和 command identity，以便过期保存被拒绝且重试保持幂等。
29. 作为工程师，我希望结构性 design、PDK family、Flow 和 PDK override 变化仍走 Workspace replacement，以免局部参数更新承担错误职责。
30. 作为 PDK 用户，我希望 PDK Resource Override 继续由 Project Configuration 管理，以便 CLI 的 PDK 设置能力被保留。
31. 作为工程师，我希望 Descriptor 只记录 portable PDK requirement 和 provenance，以便移动 Workspace 时不携带机器路径。
32. 作为工程师，我希望机器上的 PDK 路径只存在于 transient Workspace Binding，以便另一台机器可以重新绑定。
33. 作为工程师，我希望 Descriptor 固化创建时解析出的有序 Flow Step 列表，以便 ECC 升级不会改变已有 Workspace 的流程。
34. 作为已有 Workspace 用户，我希望新增的默认 synthesis `lec` 不会被隐式插入，以便 resume 不改变原工程语义。
35. 作为新 Workspace 用户，我希望新的 RTL2GDS preset 包含 upstream synthesis LEC，以便获得更新后的默认检查流程。
36. 作为 CLI 用户，我希望 `--preset` 只用于 fresh run、新 run ID 或显式 overwrite，以免一次执行临时改写已有 Workspace Flow。
37. 作为工程师，我希望 Flow ledger 只记录已提交 Flow 的执行状态，以免执行状态文件反过来决定配置。
38. 作为工程师，我希望 synthesis `lec` 的 `yosys_lec` 失败记录为 Warning 并允许继续，以便非阻塞检查不会终止整个 Flow。
39. 作为工程师，我希望 post-route LEC 失败仍然阻塞，以便最终等价性问题不会被弱化。
40. 作为 Studio 用户，我希望 Warning 在 ledger、Snapshot、CLI 和 Studio 中保持 Warning，以免可继续被错误显示为成功。
41. 作为 Studio 用户，我希望全部 Step 完成但含 Warning 时看到 Completed with warnings，以便完成度和风险同时可见。
42. 作为 Project Comparison 用户，我希望 Warning Step 的当前结果可参与比较并保留警告标签，以便可用证据不会被丢弃。
43. 作为 Signoff 用户，我希望 Signoff Readiness 独立检查 Warning 的工程含义，以免 Flow continuation 被误认为 Signoff 通过。
44. 作为 CLI 用户，我希望 `ecc report qor` 继续按需读取当前 Workspace Analysis，以便保持现有报告体验。
45. 作为 Studio 用户，我希望 QoR 继续只展示 committed Engineering Snapshot，以便比较和详情不读取未提交的中间结果。
46. 作为维护者，我希望 CLI 与 Studio 使用同一 QoR Scoring Policy，以免阈值、权重和 metric 选择产生不同结论。
47. 作为维护者，我希望评分逻辑不执行 I/O，以便两个生命周期不同的消费者都能安全复用。
48. 作为工程师，我希望 STA Artifact 使用工具实际生成的拆分 timing report 名称，以便 Snapshot、CLI 和 Signoff 引用同一证据。
49. 作为工程师，我希望缺少可选 `power.rpt` 不产生必需 Artifact 错误，以便没有功耗报告的 Flow 仍能正确提交结果。
50. 作为 Signoff 用户，我希望保留 `ecc signoff inspect/export`，以便 CLI 能独立检查和导出 Signoff Package。
51. 作为 Studio 用户，我希望 Studio 与 CLI 调用同一 headless Signoff Engine Interface，以免导出内容和 readiness 漂移。
52. 作为 CLI 用户，我希望 signoff export 同时支持 upstream debug 选项和已有 additional files 能力，以便合并不丢功能。
53. 作为维护者，我希望 CLI 和 Runtime Adapter 分别映射 Signoff domain error，以便 ECC engine 不依赖产品 transport。
54. 作为用户，我希望 `status`、`log`、`config`、`report step`、Step Configuration read 和 `signoff inspect` 不修改 Workspace，以便查看信息没有隐藏副作用。
55. 作为报告用户，我希望报告和导出命令只写声明的输出目标，以便计算不会迁移 Descriptor、刷新 Snapshot 或追加 Workspace 日志。
56. 作为维护者，我希望事务恢复和 Derived Backend Configuration 物化只出现在 execution 或 mutation 路径，以便 query 保持只读。
57. 作为工程师，我希望缺失 PDK 时仍能查看历史结果，以便环境问题不会隐藏已提交证据。
58. 作为工程师，我希望需要 PDK 的执行在绑定缺失或 cell master 不可读时可靠失败，以免使用不完整输入继续运行。
59. 作为工程师，我希望 tool failure diagnostics 和 Snapshot commit 语义在合并后保留，以便失败仍有可调查证据。
60. 作为发布维护者，我希望 ECC 独立 CLI 和 Studio Runtime Adapter 都经过打包验证，以便源码测试通过不掩盖发布入口问题。

## Implementation Decisions

- **Pre-main integration:** 在 upstream merge 前，从当前本地 ECC HEAD 创建独立 worktree 和 `ekko/refactor-ecc-cli-integration` 本地分支，再合入远端最新 `yell/update_cli`。所有冲突解决和预验证只发生在该 worktree。
- **Rehearsal status:** 预集成分支是提前解决问题的可运行候选，不视为 upstream main 的最终集成证明，不直接更新父仓库 ECC gitlink。
- **Final integration order:** `yell/update_cli` 进入 ECC main 后，获取最新 main 并合入预集成分支，复核 upstream merge resolution 与新增提交；最终 ECC PR 以该 main 为 base，ECC 合并并发布后才更新 Studio gitlink。
- **History handling:** 保留当前本地 merge history 中已有的领域整合，不把本地能力简化为只 cherry-pick 最后几个 Revision 相关提交。
- **Upstream preservation:** 保留 upstream CLI commands、public dotted parameter names、validation、doctor/PDK commands、reports、Signoff、LEC、STA 和工具修复，除非具体行为违反本 Spec 的已接受契约。
- **Runtime ownership:** ECC 保持 headless；不恢复 ECC JSON-RPC server、`ecc rpc serve` 或 Studio-owned runtime implementation。Studio Runtime Adapter 继续拥有进程与 transport 生命周期。
- **Workspace Descriptor:** 唯一 Descriptor 固定为 `<workspace>/home/params.toml`。不创建 `workspace.toml` 或第二份 Workspace configuration source。
- **Descriptor completeness:** Descriptor 保存当前 Resolved Workspace Flow 适用的全部 catalog 参数，包括等于默认值的参数；打开时只做严格校验，不补默认值。
- **Breaking format:** upstream 旧 `params.toml`、旧 Descriptor 和缺字段 Descriptor 均不读取、不规范化、不迁移。它们返回稳定的不兼容错误并要求重新创建 Workspace。
- **Rollout:** CLI merge 与 Descriptor-contract merge 之间创建的 upstream-format Workspace 也属于不兼容范围。两次合并和发布应尽量靠近，PR 与 release notes 必须声明重新创建要求。
- **Project Configuration:** Project `ecc.toml` 保持稀疏、可编辑的 CLI authoring template。`param set/unset` 修改 Project Configuration，不直接修改已有 Workspace Descriptor。
- **Derived configuration:** backend parameter data 和 tool configuration 从 Descriptor 派生。`parameters.json` 及工具配置不是权威输入，不能反向覆盖 Descriptor。
- **Materialization boundary:** transaction recovery、Derived Backend Configuration materialization 和工具配置写入只允许出现在 Workspace creation、execution 或明确 mutation 中。
- **Parameter Catalog ownership:** `chipcompiler.data.parameter_schema` 是 Engine、CLI 和 Studio 的共享 catalog interface；现有 CLI parameter module 保持轻量 compatibility re-export。
- **Catalog placement:** upstream tool-specific config parameter definitions 归属 ECC data/configuration domain，而不是 CLI product layer。
- **No extra abstraction:** 不增加第二个 catalog class、单实现 adapter、factory 或同步层；复用现有 `ParamSchema`、resolution 和 validation 模型。
- **Configurable membership:** catalog membership 表示参数可配置，不增加 `editable` 字段。
- **Canonical vocabulary:** upstream dotted names 是 TOML、CLI、Workspace Spec、Descriptor 和 Studio contract 的唯一公开参数身份。backend keys、tool JSON paths 和 GUI labels 均不是 alias。
- **Parameter persistence:** 具有 backend semantic target 或 tool config target 的所有 catalog value 都存入 Descriptor 的 `[params.*]`。
- **No duplicate storage:** 新 Descriptor 不保存 `config_overrides`、raw backend keys 或独立 `step_options`，加载时也不重放这些结构。
- **PDK Resource Overrides:** 带 `pdk_target` 的 catalog entry 保持 Project Configuration 的 `[pdk.overrides]` 语义，不进入 Workspace `[params.*]`。
- **Workspace Binding:** Descriptor 的 `[pdk]` 只保存 portable requirement/provenance；machine-resolved files 和 installation paths 只存在于 transient Binding。
- **Step Configuration read contract:** 复用现有 Step Configuration command name。响应包含 Workspace identity、Workspace Revision、normalized Step identity，以及按 catalog 顺序排列的公开参数记录。
- **Public parameter record:** 每条记录只包含 `param`、`type`、`value`、`default`、`applies`、`description` 和可选 `range`、`choices`、`unit`。
- **Private targets:** Step Configuration response 不返回 `maps_to`、`config_target`、`json_path`、`pdk_target` 或 filesystem path。
- **Unavailable Steps:** 没有适用 catalog entry 的 Step 返回 unavailable；invalid/incomplete Descriptor 返回错误，不伪装成 missing configuration。
- **Step Configuration update contract:** 复用现有 update command name，以 flat canonical `parameters` map 代替 raw nested `options`，并保留 Workspace/Step identity、expected Revision 和 command identity。
- **Editing location:** Studio 只在 parameter normalized `applies` 对应的最早 Step 展示该参数。共享 tool config 不产生重复 UI 入口。
- **Structured values:** `type=json` 是单一 atomic Structured Parameter Value，只验证 upstream 已有的 top-level object-or-array contract，不引入 nested JSON Schema。
- **Invalidation:** `applies` 是最早受影响 Step。一个原子 patch 修改多个参数时，从最早 `applies` 开始失效；不增加第二个 invalidation scope。
- **Structural updates:** design inputs、PDK family、Flow structure 和 PDK Resource Overrides 不通过 Step Configuration update，继续走结构性 Workspace replacement。
- **Resolved Workspace Flow:** Descriptor 保存 Flow identity 和创建或替换时解析出的有序 canonical Step list。Flow ledger 只记录这份列表的执行状态。
- **Preset stability:** 现有 Workspace 的 open、resume 和 rerun 不用当前 ECC preset 重新解析 Flow。upstream 新增 Step 只影响新建或替换的 Workspace。
- **CLI preset:** `--preset` 只适用于 fresh run、新 run ID 或 explicit overwrite；对已有 Workspace 返回明确错误。
- **LEC Warning scope:** 只有 pre-implementation `lec` 且 tool 为 `yosys_lec` 时，失败可成为 Warning；`postRouteLec` 失败保持 blocking Incomplete。
- **Continuation semantics:** Warning 是 continuable terminal state。统一 ExecutionResult 对 Success 与 Warning 的 continuation 判定，Runtime Adapter 不把 Warning 转成 command failure。
- **State preservation:** Step 在 ledger、Engineering Snapshot、CLI 和 Studio 中保持 Warning；resume 将其视为已完成，但不改写为 Success。
- **Aggregate status:** Warning 计入 Flow completion 和 branch eligibility，不计入 successful-Step count 或 success ratio。全部完成且包含 Warning 时聚合为 Completed with warnings。
- **Comparison and Signoff:** Project Comparison 可以使用 Warning Step 的 current result 并保留标签；Signoff Readiness 继续由 checklist 独立决定。
- **QoR scoring module:** 抽取一个无 I/O 的 `chipcompiler.engine.qor_scoring`，统一 metric selection、area scoring Step、thresholds、dimension aggregation、weights 和 overall score。
- **QoR lifecycle boundary:** CLI `report qor` 继续按需读取当前 Workspace Analysis；Studio 继续只消费 Step commit 形成的 Engineering Snapshot。共享评分不改变两个产品的观察生命周期。
- **QoR presentation:** CLI 保留 report status 和 text generation，Snapshot QoR 模块保留 assessment assembly；二者把各自读取并验证的 schema-v3 metric records 交给纯评分模块。
- **STA Artifact names:** Snapshot 和 Signoff 直接复用 STA tool owner 定义的 report-name constants，不在 engine 中维护重复列表。
- **Expected STA reports:** `qor_summary.rpt` 和四个 `timing_max_{in2out,in2reg,reg2out,reg2reg}.rpt` 始终声明为预期 Artifact；`power.rpt` 只在实际存在时声明。
- **No artifact contract expansion:** 不增加 Artifact `required` 字段，不识别 legacy `timing_max.rpt`。
- **Signoff ownership:** 保留 upstream `ecc signoff inspect/export` 和 report modules，但 handler 调用 headless Signoff Engine Interface。
- **Signoff export contract:** Engine export 同时支持现有 `additional_files` 与 upstream `include_debug=false`，并以统一 Signoff domain error 报告失败。
- **Error mapping:** CLI 与 Studio Runtime Adapter 在各自 adapter boundary 独立映射 Signoff domain error，不把 Runtime transport error 放回 ECC engine。
- **Assessment ownership:** Signoff assessment 继续由单一 builder 生成，并保留 checklist unavailable 时的 status、groups、risks 和 detail。
- **Pure query rule:** 所有 query path 禁止调用有副作用的 Workspace loader；需要 Descriptor 时只调用 `read_workspace_descriptor()`。
- **Completely read-only commands:** `status`、`log`、`config`、`report step`、Step Configuration read 和 `signoff inspect` 不产生文件写入。
- **Workspace-derived export:** `report qor/checklist/summary` 与 `signoff export` 只写声明的 report/export target，不修改源 Descriptor、derived configuration、ledger、Snapshot 或 Workspace log。
- **Execution safety:** 保留输入读取失败、cell master 缺失、toolFailure diagnostics、step identity、postRouteLec aliases、obsolete-step filtering 和 Revision invalidation 行为。
- **PDK availability:** 缺失本地 PDK 不阻止 committed history inspection，但所有依赖该 PDK 的 execution fail closed。
- **Module size:** 评分职责进入独立纯模块；parameter schema 进入 data domain。不得继续把新职责塞进已经接近或超过维护阈值的 Workspace、Flow 或 lifecycle central module。
- **PR completeness:** ECC PR 在最新 main 上保持独立可运行，不提交会让 CLI 或 Runtime Adapter 暂时失效的半套 contract，也不让父仓库 gitlink 指向未发布 commit。

## Testing Decisions

- 测试断言公开命令结果、领域 contract、持久文件和可观察副作用，不固定 private helper、import route 或临时实现顺序。
- 主验收 seam 是 cross-creator Project/Workspace matrix：CLI 创建后由 Studio Runtime Adapter 打开、查询、更新和执行；Runtime Adapter 创建后由 CLI 发现、查询、更新和执行。
- 主 matrix 使用真实 Project Manifest、strict Workspace Descriptor、Derived Backend Configuration、Flow ledger 和 Engineering Snapshot，避免用两套互不相干的 mock 证明兼容。
- ECC Project/Workspace domain tests 是 atomicity、Revision conflict、idempotency、invalidation、Binding 和 execution readiness 的既有 prior art。
- ECC CLI command tests 是 config layering、Workspace selection、read-only inspection、run continuation、reports 和 Signoff output 的既有 prior art。
- Runtime Adapter cross-creator、Workspace API 和 Operation tests 是 request translation、error mapping、session/operation ownership 与 Snapshot commit 的既有 prior art。
- 参数 round-trip 覆盖 Project template defaults、CLI command overrides、catalog resolution、完整 Descriptor persistence、Derived Backend Configuration 和 Studio editor model。
- 参数测试覆盖 backend target、tool config target、PDK target、Structured Parameter Value、range/choice/type validation 和 unknown parameter rejection。
- Step Configuration tests 覆盖 ordered public record shape、private target exclusion、exact `applies` filtering、no-param Step unavailable 和 invalid Descriptor error。
- Update tests 覆盖 flat `parameters` payload、mixed-patch earliest invalidation、Revision conflict、duplicate command identity、atomic rollback 和 active Operation rejection。
- 严格格式测试覆盖 upstream-format `params.toml`、缺失 catalog field、raw backend key、`config_overrides`、独立 `step_options` 和绝对 PDK path 均被拒绝且不写文件。
- breaking rollout 测试以固定旧格式 fixture 证明错误稳定并要求 recreation；不测试已排除的迁移实现。
- Flow tests 固化 Workspace 创建时的 ordered Step list，然后替换当前 preset definition，验证 open/resume/rerun 仍使用 committed list。
- CLI preset tests 覆盖 fresh run、新 run ID、overwrite 成功，以及 existing Workspace 明确拒绝且文件树不变。
- Warning tests 覆盖 synthesis `lec + yosys_lec`、其他 tool 的 `lec`、`postRouteLec`、单 Step rerun、full Flow、resume、Snapshot commit 和 Adapter Operation outcome。
- aggregate tests 覆盖 Success-only、Success+Warning、blocking failure，验证 completion、branch eligibility、successful count、success ratio、Project Comparison label 和 independent Signoff result。
- QoR pure-function tests 使用同一组 schema-v3 metric records 验证 metric selection、polarity、missing values、area source、threshold boundaries、dimension weights 和 overall score。
- QoR integration tests 对同一已提交 metric fixture 分别经过 CLI current Analysis 与 Studio Snapshot assembly，验证评分一致而生命周期来源保持不同。
- STA Artifact tests 使用工具实际 report-name constants，覆盖五个预期报告、可选 power、缺失报告、checksum 和 legacy filename exclusion。
- Signoff tests 覆盖 inspect、archive export、`include_debug`、`additional_files`、checklist unavailable、blocked/attention、domain error 和两个 adapter 的错误映射。
- query purity tests 在命令前后比较源 Workspace 的递归目录项、文件内容和 modification time；读取不得创建、替换或改写任何源文件。
- report/export purity tests 只排除声明的输出目标，验证其余 Workspace tree 不变；显式外部 output path 不得在 Workspace 内产生额外文件。
- PDK tests 覆盖无 PDK 时历史读取可用、错误 Binding 执行失败、缺失 cell master 停止 Flow，并保留诊断和已提交历史。
- existing Flow tests 覆盖旧有有序列表、explicit replacement、新目标、single-Step rerun、postRouteLec alias 和 obsolete Step filtering。
- runner regression tests 保留 main 中数据库重建、输入错误传播和 Workspace path preservation 行为。
- conflict resolution 后运行 ECC 完整非打包 CI，包括版本一致性、pytest、coverage、Ruff format 和 Ruff lint。
- 预集成候选需要运行相同的聚焦行为矩阵和可在本地执行的 ECC CI；这些结果标记为 rehearsal evidence，上游正式 merge 后必须在最终 main 基线上重新运行。
- 使用真实依赖至少运行 RTL2GDS、synthesis LEC、STA 和 Signoff smoke，确认报告文件名、Warning continuation 和 package contents，不以只会制造旧 fixture 文件名的测试代替。
- 独立验证 ECC PyInstaller CLI entrypoint 和 Studio Runtime Adapter entrypoint；涉及父仓库 release inputs 时运行对应 Linux x86_64 build，或记录未运行原因和残余风险。
- 最终检查 complete diff、working tree、submodule gitlink、generated output、cache、credentials 和 unintended files，并分别报告 failed/pending CI 与 blocking reviews。

## Out of Scope

- 不支持 legacy Workspace Descriptor、upstream 旧 `params.toml` 或 `parameters.json` 自动读取、默认值补全和迁移。
- 不创建第二个 `workspace.toml`、兼容 Descriptor 或配置 source of truth。
- 不保留 persisted `config_overrides`、raw backend keys 或独立 `step_options`。
- 不增加 `editable`、第二个 invalidation scope、nested JSON Schema、通用 catalog adapter 或 speculative plugin system。
- 不让 Studio 读取或写入 `config/*.json`，不恢复 JSON-path parameter mapping 或 `workspace.syncConfig(configPath)`。
- 不把 PDK installation paths 持久化到 Descriptor，也不把 PDK Resource Overrides 当作 Step Options。
- 不让已有 Workspace 根据新版 preset 自动插入、删除或重排 Flow Step。
- 不把所有 LEC failure 降级为 Warning，不把 Warning 改写为 Success，也不弱化 post-route LEC failure。
- 不统一 CLI current Analysis 与 Studio committed Snapshot 的 QoR observation boundary。
- 不改变 upstream CLI QoR/report 的用户可见文本和 status，除非为已确认的 source-Workspace read-only contract 所必需。
- 不恢复 ECC Runtime、JSON-RPC server 或 `ecc rpc serve`。
- 不把 CLI handler、Electron、GUI、window 或 transport concern 放入 ECC engine。
- 不扩展 Artifact schema，不恢复 legacy `timing_max.rpt`。
- 不在本 Spec 中重设计 Studio 页面、参数编辑器布局或 Project Comparison UI。
- 不处理用户手工编辑 Descriptor 后的自动 reconcile、background migration 或 crash repair。
- 预集成阶段不 push、不创建 PR、不发布 issue，也不更新父仓库 ECC gitlink；这些动作等待最终 main 集成完成并由用户另行要求。

## Further Notes

- 本 Spec 综合截至 2026-09-07 已确认的讨论结果，不再需要额外产品 grilling。实现中只有在最新 upstream main 引入新的语义冲突时才重新讨论。
- 本 Spec 受 accepted ADR “Step Configuration uses the ECC Parameter Catalog and domain commands”与“Keep params.toml as the Workspace Descriptor”约束，并使用 Backend domain glossary 中的 Workspace Descriptor、Resolved Workspace Flow、Parameter Catalog、Pure Workspace Query、QoR Scoring Policy、Signoff Engine Interface 和 STA Report Artifact Set 术语。
- 本 Spec 明确取代旧规格中与以下事项冲突的结论：`workspace.toml` 文件名、legacy Descriptor migration、flat snake_case public parameter vocabulary、独立 `step_options` persistence，以及查询时加载或物化 Workspace。
- upstream 固定缓存引用的历史预演产生过 22 个冲突文件，但该数字不是当前远端分支或合并后 main 的验收事实。预集成开始前必须 fetch 最新 `yell/update_cli`；正式集成前还必须 fetch 最新 main、确认实际 merge commit 和 CI 状态，并再次计算 merge conflicts。
- 本地基线曾通过 213 项相关 ECC tests 和 76 项 Runtime Adapter tests；它们只证明合并前基线，不证明集成候选通过。
- 完整代码证据、缓存 commit identifiers、冲突列表和验证记录见 [ECC CLI 分支与本地后端改造合并研究](../ecc-cli-merge-research-2026-09-07.zh-CN.md)。
- 本文件仅保存在仓库中；按用户要求不发布 issue、不添加 tracker label。
