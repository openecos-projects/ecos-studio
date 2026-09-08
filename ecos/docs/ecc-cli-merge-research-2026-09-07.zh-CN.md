# ECC CLI 分支与本地后端改造合并研究

研究日期：2026-09-07。范围：`openecos-projects/ecc` 的 `yell/update_cli`、本地 ECC 修改，以及当前 Studio 对这些修改的依赖。

用户要求本轮不修改代码。本轮仅新增本报告；未切换分支、执行实际 merge/rebase、调整 gitlink、提交或发布 PR。合并预演使用 `git merge-tree`，只生成 Git 对象，不修改工作区或索引。

## 1. 结论

按“`yell/update_cli` 先进入 ECC main，本地 ECC 改造随后进入 main，最后 Studio 更新 ECC 指向”的顺序推进是合理的，但第二步不是简单解决文本冲突。

上游扩展 CLI 用户能力，本地改造 ECC 的领域归属与持久化契约，两者目标可以共存。建议保留上游命令、参数覆盖范围、诊断、报表和 LEC 行为，让 CLI 与 Studio Runtime Adapter 使用同一套 ECC Project、Workspace、配置和执行实现。不要长期保留两套参数 schema、配置重放或 QoR 判定。

已确认需要处理的主要事项：

1. 参数 schema 的字段和职责不一致，自动合并的调用方不能直接使用本地 schema。
2. 自动合并后 `config_overrides` 会在 `step_options` 之后再次写配置，存在覆盖已提交配置的风险。
3. 上游 signoff 命令引用本地已删除的 runtime 模块，导出函数签名和异常类型也不同。
4. 上游新增 `Warning`，本地统一执行入口和 Studio 单步执行仍只接受 `Success`。
5. 上游 STA 拆分报告与本地 Snapshot 的报告声明不同；两套 QoR 判定的数据来源也不同。
6. 本地 CLI 查看 Workspace 配置会重写派生文件，与上游只读查询约定不一致。

针对现有提交的 Git 预演发现 **22 个冲突文件**；本地针对性测试 **289 项通过**。这些测试验证的是当前本地基线，不能作为合并后通过的证明。

## 2. 证据边界与提交关系

### 使用的固定版本

| 对象 | 分支或引用 | SHA |
| --- | --- | --- |
| Studio 当前 HEAD | `ekko/refactor-backend-architecture` | `d1616f0c0c267d47e10e9154f1e5626eaf4b7d6e` |
| Studio 已记录的 ECC gitlink | `HEAD:ecc` | `3383c276a7551f8711a800a5d6889b49eb9a8070` |
| 本地 ECC HEAD | `ekko/refactor-workspace-update-semantics` | `3383c276a7551f8711a800a5d6889b49eb9a8070` |
| 本地缓存 ECC main | `origin/main` | `7468d89ff60279ad1c7dad2b3ae5559055825962` |
| 本地缓存 CLI 分支 | `origin/yell/update_cli` | `6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a` |
| CLI 分支与本地 HEAD 的共同祖先 | merge-base | `9e529e9ee65d5cbdc5a2209d59eed4030317f19d` |

本地 ECC 工作区干净，修改已经形成提交；Studio 有用户正在进行的 GUI 修改，本轮未触碰。Studio 的 ECC 指向与子模块当前 HEAD 一致，因此不能通过父仓库的“未提交 ECC 差异”发现这些改造，必须比较子模块提交历史。

已打开用户指定的 [GitHub 分支页面](https://github.com/openecos-projects/ecc/tree/yell/update_cli)。但本轮 `git fetch`、GitHub CLI 和 API 请求遇到 TLS/EOF/连接失败，直连也失败，**未能确认上述缓存引用就是远端最新 HEAD**。远端 PR 的存在与状态、阻塞 review、失败或 pending CI 均未取得实时证据；不能据此声称它们通过或没有阻塞。

以下代码事实以表中的 SHA 为准。上游链接固定到提交；本地源码链接指向当前 checkout，阅读时应核对 HEAD。

### 分支规模

| 比较 | 独有提交数 | 文件变化 | 增删行 |
| --- | ---: | ---: | ---: |
| `origin/main...origin/yell/update_cli` | 35 | 141 | +16,028 / -983 |
| `origin/main...HEAD` | 14，含 2 个 merge commit | 142 | +10,128 / -15,016 |

这是对应 merge-base 的净差异，不能把上游全部新增行理解成产品代码；其双语教程、参考文档和测试占了显著部分。本地的大量删除包含 RPC/runtime 及其测试退出 ECC 的变化，不能只用净减行数衡量复杂度。

本地 HEAD 已包含缓存 main。CLI 分支尚未包含 main 的四个提交：

| main 提交 | 合并时要保留的能力 |
| --- | --- |
| `0b062d2` | 动态 Flow 中的 post-route LEC aliases |
| `9d6b776` | home reset 保留 Workspace paths |
| `50c1d7a` | PDK cell master 缺失时停止 Flow，保留数据库读取错误 |
| `7468d89` | Nix Python 依赖中的 `tomli-w` |

因此直接比较两个分支 tip 时看到某段 main 代码在 CLI 分支不存在，不等于该分支有意删除它；须用共同祖先解释差异。

## 3. `yell/update_cli` 实际包含什么

| 领域 | 最终能力 | 主要源码证据 |
| --- | --- | --- |
| CLI 命令与输出 | `doctor`；PDK setup/set-root/show/unset；`run --preset`；统一 command handlers 与输出选项；version 展示工具版本 | [app.py][up-app]、[project commands][up-project-commands] |
| Workspace 查询 | status/log/config 可通过 `--workspace` 直接选择 Workspace；处理与 project/run-id 的互斥；路径解析与会加载、迁移的接口分开 | [discovery.py][up-discovery]、[inspect.py][up-inspect] |
| 参数配置 | 除原参数外增加 CTS、Floorplan、DreamPlace、route、filler、RCX、STA、PDK 的配置 schema；支持直接配置目标与 PDK 目标；提供描述、筛选和 TOML 编辑 | [params.py][up-params]、[config_params/common.py][up-schema] |
| 报表 | `report qor/checklist/summary/step`；step 报告支持 feature/analysis/checklist；summary/QoR/checklist 生成文本文件 | [report handler][up-report]、[qor_report.py][up-qor] |
| Signoff | `signoff inspect/export`，Workspace 选择、归档输出和 debug 选项 | [signoff handler][up-signoff] |
| Flow 行为 | 默认 RTL2GDS 在 Synthesis 后加入 `lec`，物理流程后保留 `postRouteLec`；合成 LEC 失败可记录为 Warning 并继续 | [rtl2gds/builder.py][up-flow-builder]、[engine/flow.py][up-flow]、[data/step.py][up-step] |
| 工具与环境 | STA 消费按路径类型拆分的 setup 报告；默认 PDK 路径移至 Studio 布局；Sizer 命令支持安装根目录优先；诊断检查安装完整性 | [sta_qor.py][up-sta]、[pdk.py][up-pdk]、[Sizer utility][up-sizer] |
| 工程配套 | CI PDK checkout 改到 `../pdk/icsprout55-pdk`；更新 ecc-tools gitlink；增加双语教程和配置说明 | [CI][up-ci]、固定提交的 Git diff |

需要避免的误读：

- 上游 `param set/unset` 当前修改的是项目模板 `ecc.toml`，不是本地已经实现的带 revision 的 Workspace 更新命令。
- `report step` 是直接读取已有证据的预览；`report qor/checklist/summary` 会生成报告文件，并通过加载 Workspace 获取数据。不能把所有 report 都当成纯只读接口。
- `Warning` 的非阻塞判定限定在 `name == lec` 且 `tool == yosys_lec`；不应把 post-route LEC 或所有工具错误统一放行。
- `--preset` 的帮助语义是本次运行覆盖、不修改项目模板；接入本地“已有 Workspace 以已提交 Descriptor 为准”的模型时，必须明确它对已有 Workspace 的适用范围。

## 4. 当前本地 ECC 改造

| 提交或阶段 | 本地变化 | Studio 依赖与 PR 要点 |
| --- | --- | --- |
| `cc76f4d` | 删除 ECC 自带 RPC/stdio runtime 和部分 Agent API；抽出 headless execution、workspace lifecycle、analysis、QoR、signoff | Studio 的 RPC 生命周期由 `ecos/runtime-adapter` 拥有；ECC 保留可独立调用的工程 API |
| `5135103` | PDK 重新绑定时保留 timing 输入 | 不能让新的 PDK CLI 设置覆盖 Workspace 已提交输入或破坏绑定验证 |
| `ff9bd5c`、`4fa6113`、`c54de4b` | 持久化 Engineering Snapshot、声明 analysis/artifacts、提交 Dashboard 工程事实 | Studio 比较与详情读取依赖 Snapshot，不能重新退回任意扫描当前磁盘结果 |
| `ba47546` | 去掉 Workspace 命名中的版本标签 | 保留明确身份与 lineage，名称不承担版本语义 |
| `c7f7038` | 将已有 main 的 Project Manifest/Workspace 配置与本地领域模型合并；引入共享 Project owner、`workspace.toml` 和 CLI adapter | 这是含重要手工整合的 merge commit，不是可随意略过的同步提交 |
| `8120ebe` | 合入 `7468d89` | 缓存 main 已在本地历史中 |
| `a341b99` | 参数与 Step Options 带 revision 更新、事务回滚、旧结果失效并保留 stale Snapshot | 对应 GUI 和 Agent 配置写入边界 |
| `be5e5da` | Step Configuration 的纯读取 API | 配置查看不应制造 Operation、迁移或重建运行状态 |
| `3383c27` | 补齐 revision 下的 Flow、配置及旧结果语义 | 必须连同前述基础能力一起验证，不能只提交最后三次修改 |

另外三个历史提交涉及 alpha.11 版本、README 和 Yosys port 命名；对应行为已经进入 main，当前净差异中版本元数据与 README 没有重复修改。准备 PR 应以相对最终 main 的完整 diff 为准，不能只依赖 `git log --no-merges` 挑提交。

本地核心证据：[execution.py](../../ecc/chipcompiler/engine/execution.py)、[workspace_lifecycle.py](../../ecc/chipcompiler/engine/workspace_lifecycle.py)、[workspace_configuration.py](../../ecc/chipcompiler/engine/workspace_configuration.py)、[workspace_descriptor.py](../../ecc/chipcompiler/data/workspace_descriptor.py)、[snapshot.py](../../ecc/chipcompiler/engine/snapshot.py)、[Project Manifest](../../ecc/chipcompiler/project/manifest.py)。

父仓库调用链已核对：Electron 的 [workspaceRuntimeCommands.ts](../../ecos/gui/apps/desktop-electron/electron/services/eccRpc/workspaceRuntimeCommands.ts) 调用 Runtime Adapter；[workspace_spec_api.py](../../ecos/runtime-adapter/ecos_runtime_adapter/workspace_spec_api.py) 直接使用 ECC 的 Project、Workspace 配置、Snapshot 与绑定 API；[workspace_api.py](../../ecos/runtime-adapter/ecos_runtime_adapter/workspace_api.py) 使用统一执行与 signoff API。相关设计依据是 [Project/Workspace 对齐规格](../../ecos/docs/specs/ecc-project-workspace-contract-alignment.md)。

## 5. 合并预演

### 上游先进入缓存 main

```bash
git -C ecc merge-tree --write-tree --name-only origin/main origin/yell/update_cli
```

返回码 1，唯一文本冲突是 `chipcompiler/tools/ecc/runner.py`。预演树为 `bc5823715385742ac76fd6b6903908e78307c944`。

上游改为从当前设计输入重建数据库、关闭序列化 DB 的加载/保存；main 的 `50c1d7a` 同时加强了读取失败的传播。两项责任都应保留：重建数据库的策略不应吞掉缺少 cell master 等错误。

ecc-tools 自动合并选择 `2c11c6c7721f47eb251de5ef2d6f415e17d152be`，而 CLI 分支是 `3e016d1e078736ab206adbb3fb9e513893d1d5e2`。Git 判定前者可快进包含后者，因此不应看到上游“bump ecc-tools”提交就把 main 的较新指向倒退。此处确认的是本地对象中的祖先关系，远端可用性仍需发布前核对。

### 上游与当前本地 HEAD

```bash
git -C ecc merge-tree --write-tree --name-only HEAD origin/yell/update_cli
```

返回码 1，预演树为 `f8b433b3e1eb45797c3ddfed27c28c1260789c47`。22 个冲突文件如下：

| 类别 | 冲突文件，均相对 ECC 根目录 |
| --- | --- |
| CLI，9 个 | `cli/app.py`、`cli/command_handlers/{inspect,param,project}.py`、`cli/project/{manifest,params,run_prepare}.py`、`cli/rendering/progress.py`、`cli/workspace/__init__.py`，以上均在 `chipcompiler/` 下 |
| 数据/引擎/工具，4 个 | `chipcompiler/data/step.py`、`chipcompiler/engine/rerun.py`、`chipcompiler/runtime/signoff_export.py`、`chipcompiler/tools/ecc/runner.py` |
| 文档，1 个 | `docs/specification/cli-design.md` |
| 测试，8 个 | `test/cli/commands/test_{config_layers,effective_config,flow_continuation,manifest_run,run}.py`、`test/cli/test_cli_module_layout.py`、`test/cli/test_typer_cli.py`、`test/test_engine_flow.py` |

`cli/workspace/__init__.py` 是上游删除、本地修改；runtime signoff 及两个旧配置测试是本地删除、上游修改。测试冲突应保留仍有效的行为断言并迁移到新的所有者，不能统一选删除或恢复旧实现。

**22 是固定快照的直接合并结果，不是未来 main 合并完成后必然出现的冲突数。** 上游对 runner 的解决以及后续新增提交都会改变结果。此预演树含冲突标记，不是可运行候选版本。

## 6. 必须处理的兼容问题

### 6.1 参数 schema 与配置重放：阻塞

本地 [parameter_schema.py](../../ecc/chipcompiler/data/parameter_schema.py) 持有 canonical 参数，例如 `frequency_max`、`core_utilization`，CLI `project/params.py` 只是导出它。上游 schema 则新增 `config_target`、`pdk_target`、`has_direct_target`，`ResolvedParam` 也增加 `is_explicit`。[来源][up-schema]

自动合并的 `cli/inspection/config_view.py` 已增加 `rp.schema.has_direct_target` 和 `rp.is_explicit` 的使用，但本地 schema 没有这些属性。如果解决 `params.py` 冲突时仅保留本地导出，项目配置查看等路径将发生属性错误。这不是文件路径重命名问题；旧 handlers import 在该文件中已被 Git 正确更新。

更隐蔽的是自动合并的 `data/workspace/__init__.py` 第 848 至 854 行：先 `apply_descriptor_step_options(workspace)`，再 `apply_config_overrides(...)`。已用两边真实合并函数做内存探针：Step Options 将 `skew_bound` 更新为 0.08，旧 `config_overrides` 随后将其改回 0.12。

已确认处理：保留上游参数覆盖范围、CLI 命令及 dotted public names，将 `chipcompiler.data.parameter_schema` 作为 CLI 和 Studio 共享的 Parameter Catalog 入口。Workspace Parameter 与 Step Option 都存入完整 Descriptor 的 `[params.*]`；Step Option 只描述最早失效 Step，不再拥有独立存储。`config_overrides`、原始 backend keys 和 `step_options` 都不进入新 Descriptor，也不在加载时重放。旧格式不迁移、不补默认值，直接判为不符合当前 Workspace contract。

发布边界也已确认：`yell/update_cli` 进入 main 后、完整 Descriptor 契约进入 main 前创建的上游旧格式 `params.toml`，升级后同样判为不兼容并要求重新创建 Workspace。本地 PR 不为这个合并窗口增加 fallback 或迁移；应缩短两次合并及发布的间隔，并在 PR 与 release notes 中明确这一破坏性变化。

### 6.2 Signoff：阻塞

上游 [signoff handler][up-signoff] 第 12、59、62 行依赖 `chipcompiler.runtime.signoff_export` 和 `runtime.workspace_api.RuntimeApiError`。本地已经删除 runtime，提供 [engine/signoff_export.py](../../ecc/chipcompiler/engine/signoff_export.py) 与 `SignoffExportError`。

即使改了 import 仍不完整：上游调用 `export_signoff_package_archive(..., include_debug=...)`，本地函数接收 `additional_files`，没有 `include_debug`。函数签名探针已确认会产生 `unexpected keyword argument 'include_debug'`。

建议：保留 CLI signoff 能力，将调用接到 headless engine，并保留 debug 和 additional-files 两种已有能力；明确错误映射。不要为了兼容 CLI 在 ECC 恢复 Studio RPC 的实现。本地 assessment 已提供 handler 读取的 status/groups/risks 结构，适配时保留这些字段，并验证其 blocked/attention 与导出结果的一致性。

已确认处理：完整保留上游 `ecc signoff inspect/export` 与报告模块，但 CLI handler 改为调用 `chipcompiler.engine.signoff_export`。Engine 导出接口同时保留 `additional_files` 并接受上游 `include_debug=False`；它抛出 `SignoffExportError`，CLI 和 Studio-owned Runtime Adapter 分别在自己的边界映射错误。Signoff assessment 继续由本地 `build_signoff_assessment()` 单点生成并补齐上游 checklist 不可用时的 detail，不恢复 `chipcompiler.runtime`。

### 6.3 LEC Warning 与执行结果：阻塞

本地 [execution.py](../../ecc/chipcompiler/engine/execution.py) 第 51 行对单 Step 用 `state == StateEnum.Success` 计算 `succeeded`；Studio [workspace_api.py](../../ecos/runtime-adapter/ecos_runtime_adapter/workspace_api.py) 第 444 行也按字符串 `Success` 判断成功。上游则为合成 LEC 引入 `Warning`。[来源][up-step]

使用上游实际 `StateEnum` 注入本地 execution 的隔离探针结果：`Success -> succeeded=True`，`Warning -> succeeded=False`。因此整条 Flow 能继续，不代表本地单步 rerun 或 Studio 操作也会继续。

建议：共用 ECC 中“能否继续执行”的领域判定，同时保留真实 Warning 状态及 LEC 证据。执行允许继续和 signoff 证明通过是两个结果。检查单步、整流、resume、Snapshot 提交、Adapter 操作结束及 GUI 状态映射，覆盖 `lec` 与 `postRouteLec` 的区别。

已确认处理：`Warning` 是可继续的终态。`ExecutionResult.succeeded` 对 `Success` 和 `Warning` 都成立，Runtime Adapter 不将 Warning 映射为命令失败，后台 Operation 正常完成；Step 自身在 ledger、Snapshot、CLI 和 Studio 中始终保留独立 Warning 状态，resume 将其视为已完成。只有前置综合 `lec` + `yosys_lec` 可降级为 Warning，`postRouteLec` 失败仍为阻塞的 Incomplete。

聚合规则也已确认：Warning 计入 Flow 完成度与分支资格，但不计入成功 Step 数或成功率。全部 Step 均完成且至少一个 Warning 时，Workspace 显示 `Completed with warnings`；存在阻塞失败时仍显示 Failed。Project Comparison 可使用 Warning Step 的当前结果并保留警告标识，Signoff Readiness 继续由 checklist 独立判断。

### 6.4 STA Artifact 与两套 QoR：合并前必须核对

上游 [sta_qor.py][up-sta] 声明四个 `timing_max_{in2out,in2reg,reg2out,reg2reg}.rpt`。本地 [analysis.py](../../ecc/chipcompiler/engine/analysis.py) 的 `_STA_REPORT_FILENAMES` 仍是 `qor_summary.rpt`、`timing_max.rpt`、`power.rpt`。该文件在本地新增，Git 不会因为上游报告改名而提示冲突。

推论：沿用这个声明器时，四个新报告不会以对应的 STA `report_text` Artifact 被声明；依赖已声明 Artifact 的 Studio 读取路径可能缺失它们。需要用新工具真实输出验证，不应只依靠仍制造旧文件名的测试。

上游 [qor_report.py][up-qor] 又复制了一套 GUI 评分权重、阈值和步骤目录映射，通过现有 metrics 文件计算报表；本地 [qor.py](../../ecc/chipcompiler/engine/qor.py) 已从提交的 analysis 计算工程事实，Snapshot 还区分 current 与 stale。两者在步骤集合、gate 来源、缺失结果和 stale 结果上可能给出不同答案。

已确认处理：CLI 与 Studio 保留不同的观察边界。`ecc report qor` 继续按需读取当前 Workspace Analysis，Studio 继续只使用 Step commit 时生成的 Engineering Snapshot；本次不改变任一产品的数据生命周期。为避免评分规则漂移，从两套实现中抽取一个无 I/O 的 `chipcompiler.engine.qor_scoring` 模块，统一 metric 选择、area scoring Step、单指标阈值、维度聚合、权重和 overall score。CLI 保留报告状态与文本格式，`engine.qor` 保留 Snapshot assessment 组装；两边把各自读取并验证的 schema-v3 metric records 交给同一个纯评分接口。

STA Artifact 仍是独立兼容修复。已确认本地 Snapshot 声明器直接复用上游 `chipcompiler.tools.ecc.sta_qor` 的文件名常量：`qor_summary.rpt` 和四个 `timing_max_*` 报告始终作为预期 Artifact 声明，`power.rpt` 仅在实际存在时声明；删除本地硬编码与旧 `timing_max.rpt`。不扩展 Artifact contract，也不增加 `required` 字段。

### 6.5 配置查询只读性：本地已存在的待修复问题

本地 [config_view.py](../../ecc/chipcompiler/cli/inspection/config_view.py) 第 14 行用 `load_workspace_descriptor` 查看配置。这个 loader 会恢复事务、迁移旧格式，并重写 `home/parameters.json`；同一模块已经有不写入的 `read_workspace_descriptor`。[实现](../../ecc/chipcompiler/data/workspace_descriptor.py)

临时目录探针已经复现：对合法的已提交 Workspace 调用 `build_workspace_config_items`，返回码为 0，但派生参数文件被原子替换。上游新 status/log/config 路径明确约定查询不加载或迁移 Workspace。[只读路径][up-discovery]、[测试][up-readonly-test]

已确认产品边界：所有查询路径禁止调用有副作用的 Workspace loader；查询 Workspace Descriptor 时只能调用 `read_workspace_descriptor()`。事务恢复和 Derived Backend Configuration 物化只发生在 execution 或 mutation 路径。`status`、`log`、`config`、`report step`、Step Configuration 查询和 `signoff inspect` 不产生任何文件写入；`report qor/checklist/summary` 与 `signoff export` 只可写其声明的报告或导出目标，不得恢复事务、迁移或重写配置、物化后端文件、刷新 ledger/Snapshot 或追加 Workspace 日志。计算本身不是允许修改源 Workspace 的理由。

上游目前只部分实现该边界：`status`、`log`、`config` 和 `report step` 已使用无副作用的路径解析；其余报告和 Signoff 命令仍通过 `resolve_loaded_workspace`，三个文本报告还默认写入 `<workspace>/signoff/`。本地 Step Configuration 查询应使用 `read_workspace_descriptor`；`config_view.py` 调用带副作用 loader 属于集成回归。为保持本次集成最小，评分逻辑抽取不顺带改变上游 CLI 的输出行为，但共享评分接口本身不得执行 I/O。

### 6.6 旧 Flow 与既有安全修复：必须保留

默认 Flow 新增前置 LEC 后，已有 ledger 可能不再是新流程的简单前缀。本地还具有 step identity、`postRouteLec` alias、废弃步骤过滤和 revision 失效语义。应分别验证旧流程继续运行、显式切换新目标、只重跑某 Step 三种情况，不能简单按新默认列表覆盖旧 ledger。

已确认处理：Workspace Descriptor 保存 Flow identity 及创建时解析出的有序 canonical Step 列表。preset 只在新建或替换 Workspace 时解析；打开、resume 或 rerun 已有 Workspace 时不再用当前 ECC 的 preset 定义重算流程。Flow ledger 只保存这份已提交列表的执行状态，不作为配置来源。CLI `--preset` 仅适用于 fresh run、新 run ID 或显式 overwrite，对已有 Workspace 直接拒绝。上游新增的前置 `lec` 因此只进入新建或替换后的 Workspace。

上游进入 main 时应保留 `50c1d7a` 的输入读取失败处理；本地后续集成要继续保留 `toolFailure` 诊断与 Snapshot 提交。PDK 缺失不应阻止历史结果查看，但必须阻止需要该 PDK 的执行。

### 6.7 文件规模：后续实现的约束

本地 `workspace_configuration.py` 755 行、`workspace_lifecycle.py` 691 行、`data/workspace/__init__.py` 1,429 行、`engine/flow.py` 844 行。ECC review guidelines 将跨越 700 行视为需要说明的结构性问题，AGENTS 也禁止继续无边界扩张大模块。

后续适配应先明确参数 schema、单 Step 配置、执行结果和报告数据各自的所有者，避免把上游新增能力继续塞进这些中心模块。此处记录已发现的规模风险，本轮没有实施完整维护性审查或结构重构。

## 7. 后续 PR 的落地顺序

1. **先完成 CLI 分支进入 ECC main。** 解决 runner 的数据库重建与错误传播冲突，确认四个 main 修复及较新的 ecc-tools gitlink 都保留，跑上游 CI。
2. **从当前 ECC HEAD 创建独立集成 worktree，再合入更新后的 main。** 当前 Studio checkout 保持不动。优先保留现有历史的 merge 路线；不要默认使用普通 rebase 或只 cherry-pick 非 merge commits，`c7f7038` 中有大量实际契约整合工作。
3. **在 ECC 集成分支完成共享契约适配。** 先参数 schema/Descriptor/配置写入，再统一执行与 Warning，再接 CLI reports/signoff 和只读查询。每一部分都保留上游行为测试，并补双方交叉调用的断言。
4. **提交一个可独立运行的 ECC PR 到最新 main。** 可以用多个清晰提交组织审查，但不建议为拆 PR 留下暂时失效的 CLI/runtime 或两套权威配置。仅提交最后三个 revision 相关提交不足以提供 Studio 需要的基础 API。
5. **ECC 提交发布并合并后，再完成 Studio PR。** Runtime Adapter、GUI、打包入口以及 gitlink 一起核对。父仓库不得依赖仅本地存在的子模块提交；本地缓存远端引用尚无包含当前 ECC HEAD 的分支，真实发布状态需重新确认。[仓库规定](../../CONTRIBUTING.md#working-with-submodules)

建议对 ECC PR 的审核目标表述为：“统一 CLI 与外部宿主使用的 Project/Workspace 工程 API，提供已提交 Snapshot 和 revision 配置更新，并保留现有 CLI 命令行为。”这比只描述为 Studio RPC 重构更准确。

## 8. 验证记录与后续门槛

### 本轮已执行

在 `ecc/` 中，使用现有虚拟环境、不同步依赖、不产生 Python 字节码与 pytest cache：

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider test/project test/data/test_workspace_descriptor.py test/engine/test_workspace_lifecycle.py test/engine/test_snapshot.py test/engine/test_execution.py test/cli/params test/cli/commands/test_manifest_run.py test/cli/commands/test_flow_continuation.py -q
```

结果：**213 passed in 3.49s**。

在 Studio 根目录中：

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=ecos/runtime-adapter:ecc ecc/.venv/bin/python -m pytest -p no:cacheprovider ecos/runtime-adapter/test/test_cross_creator.py ecos/runtime-adapter/test/test_workspace_api.py ecos/runtime-adapter/test/test_operations.py -q
```

结果：**76 passed in 1.56s**。

另已执行第 5 节的两次 `merge-tree`；用 Python AST、实际函数调用和签名检查确认 Warning、配置重放覆盖、schema 字段缺失、signoff 参数不兼容；用临时目录实际调用确认配置查询重写文件。它们是研究探针，不是合并代码的回归测试，结果见第 6 节。

### 本轮未执行

- 合并后测试：尚未解决冲突或生成候选实现，未执行。
- ECC 完整 CI pytest、Ruff lint/format、版本校验：本轮仅研究，没有修改产品代码；针对性测试不替代这些检查。
- 上游分支的独立全量测试、远端 PR checks/reviews：未取得可验证的实时远端状态，也未切换当前子模块。
- 真实 RTL2GDS/LEC/STA/Sizer Flow、PyInstaller bundle 和父仓库 `make build`：本轮未做运行时或打包修改，未执行；工具报告与打包兼容仍属于后续风险。
- GUI typecheck/lint/format/test、完整 Runtime Adapter 测试：本轮未修改 GUI；Adapter 只运行上述三个相关测试文件。

后续 ECC PR 至少按最终 `.github/workflows/ci.yml` 执行以下非打包检查，并复现同样的容器、PDK、Yosys、Sizer 依赖条件：

```bash
# ECC 根目录
bash .github/scripts/check-version.sh
uv run --no-sync pytest test/ --ignore=test/examples/test_soc.py --cov=chipcompiler --cov-report=
uv run --no-sync ruff format --check chipcompiler test
uv run --no-sync ruff check --output-format=github chipcompiler test
```

还需验证独立 ECC PyInstaller CLI 和 Studio Runtime Adapter 的双入口打包；Studio 集成时按路径启用对应 GUI 检查并运行 `make build`，或说明未执行的具体原因。`ecc.spec` 的本地变化已经涉及 `ECOS_ECC_ENTRYPOINT` 和 `ECOS_ECC_BINARY_NAME`，仅运行源码 pytest 不足以覆盖发布路径。

最有价值的集成交叉用例：

| 场景 | 应验证的结果 |
| --- | --- |
| CLI 建项目，Studio 打开；Studio 建项目，CLI 打开 | 共享 Manifest/Descriptor，不依赖创建方或强制存在 `ecc.toml` |
| 上游旧 Workspace 携带 direct config overrides，Studio 修改 Step Options | 不丢历史配置；新值不会被第二套重放覆盖 |
| 参数更新、过期 revision、同 commandId 重试、中途写入失败 | 正确拒绝、幂等、回滚，旧 Snapshot 保留为 stale |
| 合成 LEC Warning 后全流与单步运行 | 能继续执行，Warning 与实际证据保留；post-route LEC 的阻塞语义独立验证 |
| 新 STA 拆分报告生成后读取 Snapshot/GUI/CLI 报表 | Artifact 声明与真实文件匹配；QoR、缺失和 stale 的含义一致 |
| 查看 config/status/log/step options | 文件内容、目录项及相关文件修改时间不发生非预期变化 |
| 无 PDK 查看历史、有错误 PDK 执行、缺少 cell master | 历史可读，执行可靠失败并保留诊断 |
| CLI signoff export 与 Studio export | debug、额外文件、异常映射、归档路径与完整性一致 |

[up-app]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/app.py
[up-project-commands]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/commands/project.py
[up-discovery]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/inspection/discovery.py#L159
[up-inspect]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/command_handlers/inspect.py
[up-params]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/project/params.py
[up-schema]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/project/config_params/common.py
[up-report]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/command_handlers/report.py
[up-qor]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/engine/qor_report.py
[up-signoff]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/cli/command_handlers/signoff.py
[up-flow-builder]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/rtl2gds/builder.py
[up-flow]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/engine/flow.py
[up-step]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/data/step.py#L33
[up-sta]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/tools/ecc/sta_qor.py#L9
[up-pdk]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/data/pdk.py#L286
[up-sizer]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/chipcompiler/tools/ecc_sizer/utility.py
[up-ci]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/.github/workflows/ci.yml
[up-readonly-test]: https://github.com/openecos-projects/ecc/blob/6d9a2dfc6f8ede915d1ae01e1630a8186f11dd2a/test/cli/commands/test_readonly_workspace.py
