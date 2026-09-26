# GCD 七参数受控闭环有效性审计

日期：2026-09-06

> 历史实验记录：本文保留当时的 v1 参数状态和 gap 定义，不代表当前实现。
> 当前采用请求值、实际使用值及 effective/inactive/unknown 三态；特别是 target_overflow
> 以最终 overflow 严格小于实际阈值判断生效。下述历史分类未按新定义重新计算。

## 1. 审计结论

本轮在 ICS55 GCD 上完成了 3 次 canonical baseline 和 76 个正式 parameter-gap
candidate。所有流程调用均为 `ecc-agent-rpc`，没有使用通用 `ecc rpc serve`。

正式 v12 报告结论为 `gap_confirmed_on_gcd`：

- `place.target_density`、`place.cell_padding_x`、`place.density_weight`、
  `floorplan.core_util`、`floorplan.aspect_ratio` 均观察到可重复的参数有效性 gap；
- `place.routability_opt` 在 GCD 固定上下文中未观察到 gap；
- `place.target_overflow` 的 20 个成功值均按请求写入、采用并激活，但正式运行中的
  `0` 和 `1` 被旧 ECOS verifier 的整数/浮点 canonical 差异阻断，因此正式结论仍为
  `indeterminate`；
- 独立 repair 证明 `target_overflow=1` 可以完整闭环；`target_overflow=0` 已被工具读取，
  但 1000 次 placement iteration 后仍未达到零 overflow，属于真实 native execution failure；
- 独立 repair 证明 `aspect_ratio=1/5` 可通过新 verifier，但 GCD 的 Floorplan 使用
  `die_size` 模式，两个请求均未被 aspect-ratio geometry solver 激活。

该实验是 RQ1 testability/parameter-effectiveness gate，不是优化效用实验。正式 72 个
terminal-closed candidate 中只有 3 个满足全部 signoff gates；报告明确保留
`utility_claim=not_assessed`，不能声称 QoR 改善、signoff 达成或知识/LLM 因果收益。

## 2. 可审计输入与运行边界

### 2.1 正式运行

- run id：`gcd-gap-4c403cfe-v12`
- 结果根目录：
  `/tmp/ecos-agent-gcd-7knob-20260906-v5/gcd-gap-4c403cfe-v12`
- 配置：`experiments/gcd-gap-config.20260906.v10.json`
- 配置 SHA-256：
  `sha256:9a86e9413cf2008c29fe8f2615e00576d463a3247a9827addba58d97bb3e5c69`
- frozen ECOS revision：`4c403cfec9c3c395648233db642816b91df2b2e7`
- frozen ECC revision：`5cf42f801a8baa64c10dac7440bed36d386c576c`
- PDK revision：`c5d66f93ddc49c6f2b1d26f64949f1be55c88e0d`
- seed：`0`
- worker：`1`
- terminal timeout：`1800 s`
- baseline replay：`3`
- 正式 candidate：`76`；terminal closed：`72`

`run-manifest.v1.json` 绑定 RTL、filelist、SDC、PDK、参数卡、ECC executable 和配置 hash。
`gcd-gap-report.v1.json`、`gcd-probes.v1.csv` 和 `gcd-gap-summary.md` 是从全部已落盘
probe-result 重建的汇总；原 `failure.v1.json` 被保留，用于证明旧 runner 的报告生成失败。

### 2.2 Repair 运行

- repair 根目录：
  `/tmp/ecos-agent-gcd-7knob-20260906-v5/gcd-gap-4c403cfe-v12-repair-numeric`
- manifest：`repair-manifest.v1.json`
- results：`repair-results.v1.json`
- `formal_denominator=false`

Repair 使用新 intervention/candidate ID，不覆盖正式 v12 的四个失败目录，也不进入正式
76 个 candidate 的 denominator。

### 2.3 ECC Agent RPC 证据

正式 manifest 的 `readiness.ecc_executable` 为：

```text
/home/yhqiu1/iagent-survey/ecos-studio/ecc/.venv/bin/ecc-agent-rpc
```

调用链为：

```text
parameter_gap_runner
  -> EccContentLengthRpcClient
  -> ecc-agent-rpc
  -> AgentRuntimeServer
  -> candidate.rerun
  -> AgentEngineFlow
```

正式和 repair 的 `rpc-call.v1.json` 均记录 `candidate.rerun`。本实验未把当前机器上另一个
普通 GUI/ECC RPC 进程作为受控优化 backend。

## 3. 七参数定义与固定上下文

| Knob | Stage / surface | 请求 domain | GCD current | Native consumer |
|---|---|---|---:|---|
| `place.target_density` | `place`; `target_density` | 21 值，`0.1..0.95` | `0.2` | `dreamplace.density_objective` |
| `place.target_overflow` | `place`; `stop_overflow` | 23 值，`0..1` | `0.1` | `dreamplace.overflow_predicate` |
| `place.cell_padding_x` | `place`; `cell_padding_x` | `0,1,2,3,4,5,6,7,8,10,12,16` sites | `2` sites | `dreamplace.cell_size_expansion` |
| `place.routability_opt` | `place`; `routability_opt_flag` | `false,true` | `true` | `dreamplace.routability_branch` |
| `place.density_weight` | `place`; `density_weight` | 18 值，`1e-5..1e-2` | `0.00085` | `dreamplace.density_preconditioner` |
| `floorplan.core_util` | `Floorplan`; `core.utilitization` | 16 值，`0.2..0.95` | `0.4` | `ifp.die_builder.die_utilization` |
| `floorplan.aspect_ratio` | `Floorplan`; `core.aspect_ratio` | 13 值，`0.2..5` | `0.9746835443` | `ifp.die_builder.die_aspect_ratio` |

完整离散 lattice 和 source-span hash 位于 `knowledge/optimization/<knob>.json`。本次未修改
这些 cards，也没有让模型在 domain 外自由构造值。

## 4. 证据链语义

每个 probe 分开审计以下事实：

```text
requested
  -> written
  -> effective_initial
  -> effective_final
  -> activation
  -> terminal
  -> QoR
  -> signoff eligibility
```

- `requested`：受控 action 中的 typed 值；
- `written`：hash-bound materialization receipt 中实际写入配置的值；
- `effective_initial`：native tool 接纳/归一化后的初值；
- `effective_final`：native 运行时调整结束后的值；
- `activation`：是否有目标 consumer 的直接运行时证据；
- `terminal`：ECC operation 是否完成到 Harden，并具有 terminal observation；
- `QoR`：terminal observation 中带 source refs 的 PPA/DRC/timing/routing 指标；
- `signoff eligibility`：DRC/LVS/RCX/STA/Harden gates 的合取。

数值相等只证明写入或采用相等，不自动证明 activation、terminal、QoR 或 signoff。

## 5. 正式 v12 参数结果

| Knob | Tested requests | Candidates / closed | requested -> written -> effective | Activation / gap |
|---|---|---:|---|---|
| `target_density` | `0.1,0.15,0.25,0.95` | `12/12` | 前三者写入原值后均被抬升为 `0.6678301093`; `0.95 -> 0.95` | 12 次均 `unknown`; 9 次 adoption gap，12 次 activation gap |
| `target_overflow` | `0,0.02..0.095,0.105..0.75,1` | `22/20` | 20 个成功值均 `requested=written=effective`; `0/1` 被旧 verifier 阻断 | 20 个成功值均 `used`; 正式 verdict `indeterminate` |
| `cell_padding_x` | `0,1,3,16` | `8/8` | `0 -> 0`; `1 -> 200`; `3 -> 600`; `16 -> written 3200 -> effective 1000` DBU | `0` 未激活；`1/3/16` used；确认 activation/adoption gap |
| `routability_opt` | `false,true` | `2/2` | `false -> 0`; `true -> 1` | false arm 未激活符合语义；true arm used；无 gap |
| `density_weight` | `1e-5,0.00075,0.001,0.01` | `12/12` | initial 分别为 `3.8127e-9,2.8595e-7,3.8127e-7,3.8127e-6`; final 约 `0.0944..0.0966` | 全部 used；确认 adoption + runtime-adjustment gap |
| `core_util` | `0.2,0.35,0.45,0.95` | `12/12` | written/initial 等于请求；final 均为 `null` | `mode=die_size`; 全部 not_activated；确认 activation/runtime gap |
| `aspect_ratio` | `0.2,0.75,1,5` | `8/6` | `0.2/0.75` written/initial 等于请求且 final `null`; `1/5` 被旧 verifier 阻断 | 已关闭的 6 次均 not_activated；确认 activation/runtime gap |

### 5.1 Target density

`0.1`、`0.15`、`0.25` 各重复三次，native utilization floor 均产生相同
`effective_initial=effective_final=0.6678301093355762`。`0.95` 未被 floor 改写，但四组
请求的 activation 均为 `unknown`，不能把 effective 数值存在误报成 density objective 已被观测。

### 5.2 Cell padding

site width 为 `200 DBU`。`1/3 sites` 的 `200/600 DBU` 是预期单位映射，分类为
`mapping_only`，不是 gap。`16 sites` 虽写入 `3200 DBU`，三次运行均被 native capacity
限制为 `1000 DBU`，且 consumer `used`，因此是可重复 adoption gap。

### 5.3 Density weight

四个 request 每个重复三次，initial/final 在重复间完全一致。请求值先参与 native
density-weight initialization，再被算法自适应更新；final 约 `0.095` 不是 agent 请求值，
也不能反向表述为 agent 直接选择了该 final 值。

### 5.4 Floorplan 两参数

GCD baseline 已给出固定 die/core 尺寸。运行时报告的 `mode=die_size`，realized core
utilization 约 `0.3849345744`、realized aspect ratio 约 `0.9723502304`。因此
`core_util` 和 `aspect_ratio` 虽成功写入配置，但没有进入参数卡要求的 `die_util`
geometry solver，final 为 `null`，应判为未激活。

## 6. Numeric verifier repair

| 正式失败 | Repair candidate | requested -> written -> effective | Activation | Terminal |
|---|---|---|---|---|
| `target_overflow-013` | `target_overflow-1013` | `0 -> 0.0 -> 0.0` | `unknown` | failed: place Incomplete |
| `target_overflow-016` | `target_overflow-1016` | `1 -> 1.0 -> 1.0` | `used` | closed |
| `aspect_ratio-075` | `aspect_ratio-1075` | `1 -> 1.0 -> initial 1.0 -> final null` | `not_activated` | closed |
| `aspect_ratio-076` | `aspect_ratio-1076` | `5 -> 5.0 -> initial 5.0 -> final null` | `not_activated` | closed |

`target_overflow=0` repair 记录了 `threshold_read_count=3847`、
`observed_overflow_count=1000`、minimum observed overflow `0.0052467980`、final overflow
`0.0268145669` 和 `threshold_reached=false`。因此 verifier 修复有效，但该请求在此固定上下文
下仍不能形成 terminal-closed candidate。

其余三个 repair 证明整数请求与 native 浮点 materialization 的语义绑定已恢复。修复仍严格
校验 knob、数值语义、patch hash、receipt hash、config 和 candidate；`bool` 不与 `int`
混同。

## 7. Terminal、QoR 与 signoff

### 7.1 Baseline

三次 baseline wall time 为 `278.625 s`、`280.151 s`、`291.781 s`。三个 observation
在下列目标上完全一致：

- route DR violations：`0`
- route LA overflow：`0`
- route wirelength：`4697.535`
- setup WNS/TNS：`8.169/0`
- hold WNS/TNS：`0.102/0`
- DRC count：`4`

三次 baseline 的 evidence、Harden artifacts 和 evaluation metrics 均完整，但
`drc_clean=fail`，所以不具备 incumbent/signoff eligibility。零 QoR epsilon 只说明这三个
固定 seed replay 的已选指标一致，不代表所有工具输出无噪声。

### 7.2 正式 candidates

- terminal observations：`72`
- signoff eligible：`3`
- DRC count 分布：`0:3, 2:52, 4:2, 6:14, 8:1`
- route DR violations：全部 `0`
- route LA overflow：`0..2`
- route wirelength：`4447.649..6444.846`
- STA standard-cell area：`1146..1302 um^2`
- typical dynamic power：`65.3975..67.9499 uW`
- typical leakage power：`0.2473213..0.2641111 uW`
- setup WNS：`8.007..9.448`；setup TNS 全部 `0`
- hold WNS：`0.095..0.299`；hold TNS 全部 `0`

这些区间证明 candidate 产生了可观测结果差异，但本 screen 没有注册等预算优化比较、统计检验
或 incumbent promotion claim，因此不能从区间中挑选最好值并宣称优化成功。

## 8. 性能审计

72 个 terminal-closed candidate 的实测：

| 指标 | Median | P95 | Range |
|---|---:|---:|---:|
| probe driver runtime | `231.140 s` | `237.656 s` | `213.383..250.011 s` |
| native `flow_tool_runtime` | `225.136 s` | `231.621 s` | `207.462..243.544 s` |
| driver - native metric | `6.104 s` | `6.467 s` | `5.661..6.773 s` |
| probe wrapper - candidate wait | `0.766 s` | `0.873 s` | `0.702..1.053 s` |

native flow metric 约占中位 driver 时间的 `97.4%`。`driver - native` 还包含 `home/flow.json`
逐 stage 整秒 runtime 的量化误差、candidate clone/materialization、RPC 等待、receipt 与
terminal observation；其窄范围没有显示新的 Agent-owned 长尾热点。

正式 v12 的 `peak_child_memory_mb=2712.73046875` 在所有 probe 中重复，不能作为 per-candidate
内存：旧实现读取 `RUSAGE_CHILDREN.ru_maxrss`，它是整个 runner 生命周期累计高水位。审计改用
每个 terminal observation 的 `flow_peak_memory`，范围为 `1111.770..1121.195 MB`。代码已删除
误导性的累计字段，未来 probe 改写为 `flow_peak_memory_mb`；失败且无 terminal observation 的
候选记录 `null`。

结合 `CONTROLLED_OPTIMIZATION_PERFORMANCE.md` 中展示图、clone、知识初始化、RPC 事件队列和
重复 ACK 的测量，当前 GCD 剩余 wall time 主要属于 native EDA 计算。没有继续修改 STA、Sizer、
DREAMPlace 或通用 ECC 路径，因为没有 Agent-owned hotspot 的实测证据。

## 9. 运行问题与修复记录

| Run | 事实证据 | 根因/处理 | 是否进入正式分母 |
|---|---|---|---|
| v8 | readiness `0.95 s` 通过；run 在 `4:54.59` 收到 `KeyboardInterrupt` | 无 terminal/failure 证据，不推断工具根因 | 否 |
| v9 | readiness `0.24 s` 失败 | config 使用 8 位 `expected_ecos_revision=4c403cfe`，被 40 位 revision schema 拒绝；v10 改为完整 hash | 否 |
| v10 | readiness `0.97 s` 通过；两次 baseline 完成，第三次已启动但无最终 artifact | 运行未完成，证据不足，不归因 | 否 |
| v11 | canonical baseline 在 Timing optimization 失败 | `Sizer tools not available`; runtime 检查过晚；新增 Agent RPC preflight 并前移到 baseline/candidate clone 前 | 否 |
| v12 | 76 个 probe 完成；四个整数请求被旧 verifier 拒绝 | native `0.0/1.0/5.0` 与请求 `0/1/5` canonical hash 不同；按数值语义重算并保持其余 binding 严格 | 是 |
| v12 report | 原始 `failure.v1.json`: `default replays cannot define a noise profile` | parameter-gap 允许完整但 signoff-ineligible baseline，report 却复用 Gate0 eligibility 前提；增加显式 `require_eligible=False`，Gate0 默认不变 | 汇总恢复，不改变 denominator |
| v12 repair | 4 个新 candidate | 验证 numeric fix；3 closed，`target_overflow=0` 为真实 native failure | 否 |
| memory metric | 所有正式 probe 显示同一累计 RSS | `RUSAGE_CHILDREN` 不是 per-candidate；改用 terminal `flow_peak_memory` | 后续运行生效 |

ECC runtime preflight 修复提交为 `ecc:5a52d21`；ECOS readiness/numeric verifier 修复提交为
`5105020d`。报告-noise 与 per-candidate memory 修复由本次审计提交。

## 10. FSE 证据边界

### 可支持

1. 在固定 GCD/ICS55/seed/config 上，requested value 与 native effective/activation 存在多种、
   可重复的 gap：normalization、capacity clamp、runtime adjustment、inactive mode。
2. hash-bound receipt、runtime report、terminal observation 和隔离 repair 可以把“模型请求值”与
   “工具实际奏效值”分开审计。
3. 一个只看配置写入成功的 Agent 会误判 `target_density`、`cell_padding_x=16`、
   `density_weight` 和两个 Floorplan knob；consumer-level evidence 是必要的。
4. failure-preserving repair protocol 能区分 verifier defect 与 native infeasibility。

### 不可支持

1. 七参数控制提高了 GCD QoR，或优于某个 baseline/其他 optimizer；
2. 任一参数值是全局最优值；
3. 结果可直接泛化到其他 design、PDK、frequency 或 seed；
4. 知识检索或 LLM 推理导致了指标改善；
5. receipt 或 terminal closure 等价于 signoff。

可进一步孵化的算法问题是：在 proposal 前利用 effective-domain/activation history 预测
`requested -> effective` 可达性，并用固定预算比较“naive requested-space search”与
“effective-space-aware search”。该问题需要新的多设计、设计隔离、等预算实验，不能由本次
screen 直接得出。

## 11. 停止条件

本轮在以下条件均满足后停止：

- 七个 knob 都有真实 `ecc-agent-rpc` candidate；
- 正式 76 个 candidate、原始失败、恢复报告和 4 个 repair 均已落盘；
- numeric verifier、signoff-ineligible noise report、per-candidate memory 三个新问题已定位并修复；
- 剩余 candidate wall time 由 native flow 主导，未发现新的、可测量且属于 Agent 边界的热点；
- requested、written、effective initial/final、activation、terminal、QoR、signoff 已分层；
- repair 未污染正式 denominator。

`idea_for_fse.md` 在本仓库及 `/home/yhqiu1/iagent-survey` 下未找到，因此本文没有声称读取或引用
其中内容。
