# ECOS Agent 受控自动优化性能剖析与修复

日期：2026-09-05，复查：2026-09-06

## 1. 结论

本轮以 ICS55 GCD 的真实 `place -> Harden` candidate rerun 为主负载，结合
`cProfile`、RPC 压力测试和 workspace clone 微基准进行分析。受控优化执行路径确认是：

```text
ecos_agent optimization
  -> EccContentLengthRpcClient
  -> ecc-agent-rpc
  -> AgentRuntimeServer
  -> candidate.rerun
  -> AgentEngineFlow
```

没有使用通用 `ecc rpc serve`。ECC 侧修改全部位于 `ecc/agent/**`。

识别并修复了四类问题：

1. candidate rerun 无条件生成 GUI 展示图，造成主要 wall time 和内存开销；
2. candidate clone 先复制、随后删除大量下游 artifact；
3. 知识初始化重复读取 Markdown、重复加载参数卡、重复分词；
4. RPC client 将所有非终态事件加入等待队列，噪声事件导致轮询放大。

最终 GCD 运行中，Agent 可控开销已不再是主要瓶颈。约 79.7 秒耗在 place、CTS 和
legalization 的 EDA 子流程中，占 driver 总时间 84.51 秒的约 94.3%。未再发现有实测证据、
收益显著、且能在 Agent 所有权边界内继续修复的性能热点。

## 2. 环境与证据边界

- CPU：2 x AMD EPYC 9654，384 logical CPUs
- 内存：约 1.5 TiB
- 父仓库基线：`e95acac3cece8c592951d8d77e1259bbb0a433f4`
- ECC 基线：`3adb5d02d9005887b2aaed838025944e255db6ee`
- Agent RPC：`ecc/.venv/bin/ecc-agent-rpc`
- GCD 基线证据：`/tmp/ecos-agent-perf-gcd-baseline-20260905.kIvfBd`
- GCD 修后证据：`/tmp/ecos-agent-perf-gcd-after-20260905`
- RPC 压力测试：`/tmp/ecc_agent_rpc_noise_repro.md`
- clone 微基准：`/tmp/bench_ecos_candidate_clone_artifacts.py`

`/tmp` 文件是本机原始测量记录，不作为发布产物。本文件保留关键数值、方法和边界，便于审阅。

最终 candidate 在 `Timing optimization` 到达既有 Sizer availability 边界后以
`execution_failed` 终止。因此，本报告证明到达该边界前的性能和证据完整性，不把结果表述为
完整 Harden 成功、QoR 改善或 signoff。

## 3. 热点一：candidate 展示图

### 3.1 证据

冷运行 baseline 中：

- candidate wait：约 252.5 秒；
- 峰值 RSS：2,544,192 KiB；
- place 的 21 张 array-map PNG：约 159 秒；
- CTS 的 18 张 array-map PNG：约 19 秒；
- 绘图约占 candidate wait 的 70.5%。

该冷运行受字体、matplotlib 和文件缓存影响，不能直接与热运行比较。为控制缓存影响，采用
intervention-3 热运行作为 A/B baseline：

| 指标 | 热 baseline | 最终版本 | 变化 |
|---|---:|---:|---:|
| wall time | 101.78 s | 85.17 s | -16.3% |
| max RSS | 2,603,340 KiB | 1,647,412 KiB | -36.7% |
| place/CTS/legalization 阶段尾延迟合计 | 22.97 s | 0.30 s | -98.7% |

阶段尾延迟定义为最后一个 `subflow.stage` 到 `step.completed` 的时间。它比总 wall 更能隔离
EDA 核心运行波动和展示产物开销。

### 3.2 根因

`chipcompiler.tools.ecc.runner.run_analysis()` 在每个 candidate step 中执行通用
`ECCToolsPlot.plot()`；`AgentEngineFlow` 又在成功 step 后生成 KLayout snapshot。
这些 PNG 不属于 candidate manifest、parameter receipt、terminal observation 或 QoR JSON 的
审计证据，却在每个候选上重复生成。

### 3.3 修复

- `ecc/agent/plot.py`：增加 `AgentECCToolsPlot`；仅对
  `.agent/candidates/<candidate-id>` 跳过展示图。
- `ecc/agent/tools.py`：只在 `ecc-agent-rpc` 进程内将 ECC runner 的 plotter 绑定到
  Agent plotter。
- `ecc/agent/engine.py`：candidate workspace 跳过 KLayout snapshot；普通 Agent Quick Start
  仍保留原始绘图和 snapshot。

最终 candidate 的 target 及后续阶段结果：

- place CSV：49 个；CTS CSV：45 个；
- place/CTS/legalization 的 `qor_metrics.json`、`qor_summary.json`、`qor_hotspots.json` 均保留；
- target 及后续阶段没有 `analysis/*.png` 或 `feature/*.png`；
- 仍有 13 张 place 和 2 张 legalization 的 DREAMPlace 内部 iteration PNG。

DREAMPlace iteration PNG 的单独测量总耗时低于约 1 秒，继续 patch 第三方算法路径没有显著收益，
且会扩大修改边界，故不处理。

## 4. 热点二：candidate workspace clone

### 4.1 证据

GCD workspace 在排除 `.agent` 后约 41.2 MB。`place -> Harden` 的旧路径先复制全部数据，
再由 `_prepare_candidate_rerun()` 删除 33,022,822 bytes、348 files、213 directories。

同机 5 轮中位数：

| 路径 | clone | prepare | 合计 |
|---|---:|---:|---:|
| 完整复制后删除 | 0.1424 s | 0.0310 s | 0.1734 s |
| clone 时跳过待清理 artifact | 0.0417 s | 0.0023 s | 0.0440 s |

合计 wall time 下降约 74.6%。两种路径最终保留的数据均为 8,203,435 bytes，证明修复没有删除
原先应保留的 step 根目录文件。

从 `Timing optimization` 开始时只有 1,801 bytes artifact 可省，结果处于测量波动范围，
说明该优化主要服务于 place 等较早 target。

### 4.2 修复

`ecc/agent/workspace_api.py` 在 `copytree` 阶段读取 hash-bound parent 的 `home/flow.json`，
仅跳过 target 及后续 step 中本来就会清空的 `output/data/feature/analysis/report/log` 子目录。
`checklist.json`、`subflow.json`、workspace config、前序 step 和 `.agent` 隔离语义保持不变；
后续 `_prepare_candidate_rerun()` 仍作为清理和路径校验兜底。

没有采用 hardlink 或 reflink，避免 candidate 的原地写操作污染 parent workspace。

## 5. 热点三：知识初始化

### 5.1 证据

`OptimizationKnowledgeRetriever()` 初始化：

| 指标 | 修前 | 最终版本 |
|---|---:|---:|
| 中位 wall time | 0.445376 s | 0.160988 s |
| 文件读取次数 | 1,243 | 245 |
| 读取字节数 | 31,952,829 | 3,108,487 |

wall time 受 OS cache 影响；读取次数和字节数是更稳定的根因证据。

### 5.2 根因与修复

- `knowledge/bundle.py`：同一 Markdown 文档过去会按 entity 重读和重切分；现在每次 bundle
  加载只读一次，并继续逐 chunk 校验 SHA-256。
- `optimization/knowledge/compiler_runtime.py`：过去每个 binding 都重新加载七张参数卡；现在
  有 binding 时整批只加载一次，无 binding 的只读 claim 不触发参数卡依赖。
- `knowledge/retriever.py`：过去 metadata、token set 和 FTS row 对相同字段重复 tokenize；现在
  每个不同字段只 tokenize 一次，并复用预计算 index row。

最终 profile 的剩余时间主要是 628 个知识 entity 的必要分词、stemming 和内存 FTS5 建表。
初始化只在 episode runtime 建立时发生一次，约占最终 GCD candidate wall 的 0.2%。未引入持久缓存，
以免绕过 bundle freshness 和 hash 校验。

## 6. 热点四：RPC 事件队列放大

### 6.1 证据

fake `ecc-agent-rpc` 分别发送 0、5,000、20,000 个 `step.log`，随后发送 terminal event：

| noise events | 修前 status 次数 / elapsed | 最终 status 次数 / elapsed |
|---:|---:|---:|
| 0 | 1 / 0.2911 s | 1 / 0.2073 s |
| 5,000 | 5,001 / 0.5068 s | 1 / 0.2339 s |
| 20,000 | 20,001 / 1.5816 s | 1 / 0.4721 s |

旧实现每取出一个非终态事件都会回到循环顶部再次调用 `operation.status`，形成事件数相关的轮询放大。

### 6.2 修复

`ecos/agent/.../ecc/rpc_client.py` 仍对每个 `step.completed` 发送固定 ACK，但等待队列只保留
`operation.completed/failed/cancelled`。最终 GCD 实际收到 122 个 runtime event，其中
94 个是 `step.log`，只发送 34 次 status 请求。

没有在 `AgentRuntimeServer` 服务端丢弃 `step.log`。普通 Quick Start 的 GUI 使用这些事件展示
实时日志，服务端全局过滤会造成功能回归；客户端队列优化已经解决受控优化的放大问题。

## 7. 运行中发现的正确性阻塞

`place.target_density=0.25` 的首次运行在 DREAMPlace 报错：

```text
AttributeError: 'function' object has no attribute 'reset'
```

原因是 Agent 参数 observer 将 callable operator 替换为普通函数，丢失了 `reset()` 等属性。
`ecc/agent/data/parameter_runtime_observer.py` 现在用透明 callable proxy 转发这些属性，并保持
scoped/restored hook 语义。修后该 candidate 完成 place、CTS 和 legalization，density operator
被调用 564 次，最终仅在既有 Sizer availability 边界失败。

该修复本身不是性能优化，但它使 target-density 的真实性能测量不再被 observer 提前中断。
参数变化后的约 5 分钟 DREAMPlace 计算属于算法收敛路径变化，不是 Agent 空转。

## 8. 已检查但未认定为性能问题

| 项目 | 实测结论 | 处理 |
|---|---|---|
| ECC RPC 启动 | 每个 episode 启动一次，不是每个 turn 启动 | 不改 |
| observation | 约 0.003-0.009 s | 不改 |
| ledger replay/persist | 两个 turn 合计约 0.029 s | 保留 fsync、hash 和 replay |
| 214 threads | 384 logical CPU 主机上平均约 4.58 cores | 没有限线程可改善 wall 的证据 |
| DREAMPlace iteration PNG | 总耗时低于约 1 s | 不 patch 第三方路径 |
| Sizer unavailable | runtime/correctness 边界，不是性能热点 | 与本报告分开处理 |

## 9. 验证

已执行：

```text
cd ecc
uv run ruff check agent
uv run ruff format --check agent
# passed

uv run pytest -q agent/test
# 216 passed

cd ecos/agent
uv run python scripts/build_knowledge.py --check
# passed

uv run pytest -q tests/knowledge/test_general_catalog.py \
  tests/knowledge/test_global_retriever.py \
  tests/knowledge/test_place_bundle.py \
  tests/optimization/knowledge/test_action_support_compiler.py \
  tests/optimization/test_ecc_rpc_client.py
# 61 passed

uv run pytest -q
# 742 passed, 4 failed
```

GUI 边界回归测试另以 Node 23 执行：desktop runtimeEnv/runtimeService `43 passed`，renderer
Agent workspace/chat/flow IPC `51 passed`。普通 GUI/Quick Start 的 Agent runtime 解析为
`ecc-agent-rpc`；RPC 非终态事件过滤仅存在于受控优化 Python client，不影响 GUI sidecar 日志事件。

四个 full-suite 失败在本任务开始前已存在：

1. proposal provider 的 bounded-context 字段断言未同步；
2. progressive recovery 测试的 native requested receipt 与 controller request 不一致；
3. terminal observation 测试未包含新增的三个 violation-count objective；
4. `optimization/observations.py` 已有 805 行，超过 800 行架构阈值。

这些失败与本轮性能修改无关；focused 测试和 ECC Agent 全量测试均通过。

## 10. 停止条件

最终真实运行、微基准和 profile 均表明：

- candidate 展示图热点已消除；
- clone、知识初始化和 RPC 队列的重复工作已消除；
- receipt、runtime report、terminal failure evidence、manifest SHA-256、CSV/QoR JSON 均保留；
- 剩余 wall time 主要是 EDA 核心计算；
- 剩余 Agent 开销没有达到值得增加缓存、并发或修改第三方工具路径的量级。

因此在当前 GCD 工作负载和 Agent-only 修改边界内停止继续优化。该结论不等价于所有设计、所有 PDK
或成功 Harden 路径均无性能问题；后续只有在新 profile 显示新的 Agent-owned hotspot 时再扩展修复。

## 11. 2026-09-06 复查补充

### 11.1 Sizer 可用后的完整 GCD candidate

使用 `CHIPCOMPILER_ECC_SIZER_ROOT=/tmp/ecc-sizer-official-31361700161/ecc-sizer`
复跑同一个 GCD `place -> Harden` candidate，路径仍为：

```text
ecos_agent optimization -> EccContentLengthRpcClient -> ecc-agent-rpc -> candidate.rerun
```

结果：

| 指标 | 数值 |
|---|---:|
| candidate wait | 230.19 s |
| driver total | 231.48 s |
| max RSS | 2,513,708 KiB |
| runtime events | 160 |
| `operation.status` | 58 |
| `operation.ack_step_rendered` | 22 |
| terminal outcome | `execution_succeeded` |

阶段证据显示，`sta` 从约 50.99 s 持续到 219.33 s，约 168.34 s；`Harden` 约 12.11 s。
这两段合计约占 candidate wait 的 78.4%。它们是 Sizer/STA/Harden 原生工具执行时间，不是
Agent 等待队列、知识检索、clone 或展示图开销。

该完整成功路径仍没有恢复 candidate 展示图：candidate root 中只有前序 Floorplan 已存在 PNG、
DREAMPlace/Sizer 内部少量 iteration PNG；target 及后续 step 的 `analysis/*.png` 展示图仍被跳过。

### 11.2 RPC step ACK 重复

复查完整 GCD stdout 发现每个 successful `step.completed` 事件成对出现，11 个成功 step 产生
22 次 `operation.ack_step_rendered`。这些 ACK 不是主要 wall-time 热点，但属于可消除的 RPC 放大。

修复：

- `ecos/agent/src/ecos_agent/optimization/ecc/rpc_client.py`：按
  `(operationId, eventId)` 对 step-render ACK 做幂等去重；仍保留不同 operation 复用同一
  eventId 时各自 ACK，避免跨 operation 漏确认。
- `ecos/agent/tests/optimization/test_ecc_rpc_client.py`：新增重复 step 事件只 ACK 一次、不同
  operation 同 eventId 仍分别 ACK 的回归覆盖。

### 11.3 `params.toml` 兼容性阻塞

七参数 GCD pilot 的 canonical baseline 完整跑到 Harden 后失败在 Agent observation：

```text
OptimizationObservationError: workspace evidence path is unsafe or unavailable
missing: home/parameters.json
```

原因：当前 ECC workspace 已落 `home/params.toml`，而 Agent terminal/candidate observation 仍固定读取
legacy `home/parameters.json`。这不是性能热点，但会阻断后续七参数性能剖析与 acceptance evidence。

修复：

- `ecos/agent/src/ecos_agent/workspace/parameters.py`：新增 workspace 参数读取单一入口，按 ECC 语义优先
  `home/params.toml`，fallback legacy `home/parameters.json`；canonical TOML 存在但为 symlink/不可安全读取时
  fail-closed，不静默 fallback。
- `ecos/agent/src/ecos_agent/optimization/observations.py`：参数证据支持
  `home/parameters.json` 和 `home/params.toml`，manifest 绑定实际存在的参数文件；Design/MPC 信息从
  `params.toml [params]` / `[params.mpc]` 读取。
- `ecos/agent/src/ecos_agent/optimization/runtime.py`：受控优化 runtime 的 design id、PDK evidence、
  current-values 和 parent manifest 同样改为绑定实际参数文件，避免 episode 启动路径再次硬依赖
  legacy JSON。
- `ecos/agent/tests/optimization/test_terminal_observations.py`：覆盖只存在 `params.toml` 的 terminal
  observation。
- `ecos/agent/tests/optimization/test_candidate_observations.py`：覆盖 candidate root 只存在
  `params.toml` 的 terminal observation。
- `ecos/agent/tests/workspace/test_parameters.py` 和
  `ecos/agent/tests/optimization/test_runtime_artifacts.py`：覆盖 canonical TOML 优先级、legacy fallback、
  symlink fail-closed 和 runtime helper。

在失败现场 workspace 上直接重建 observation 已通过：

```text
terminal-Harden harden_artifacts_complete=True evaluation_metrics_complete=True
```

### 11.4 Sizer preflight 前移

ECC Agent RPC 侧已有 Sizer runtime preflight，用于在进入 `Timing optimization` 前给出明确的
Sizer availability 错误。但复查发现 preflight 位于 candidate clone 之后：当 Sizer 不可用时，仍会先复制
candidate workspace，再失败。

修复：

- `ecc/agent/workspace_api.py`：先从 parent workspace 的持久化 flow 数据按
  `targetStep/endStep/executionScope` 计算 candidate step range 并执行 Sizer preflight；不构建或修改
  parent flow。preflight 失败则不 clone、不 materialize candidate；旧 fake workspace 缺少持久化 flow
  数据时，保留 clone 后 preflight fallback，不改变原有错误优先级。
- `ecc/agent/test/test_workspace_api.py`：覆盖 Sizer preflight 失败不会调用 candidate clone。

该修复只影响 `ecc-agent-rpc` 的 candidate rerun 路径；普通 GUI Quick Start 仍按原 flow 执行。

### 11.5 复查停止条件

截至 2026-09-06 复查，仍未发现新的、收益显著且属于 Agent 所有权边界的性能热点：

- Sizer 可用后完整 candidate 已成功，剩余主要时间在原生 STA/Harden；
- RPC 非终态队列放大和 duplicate ACK 已消除或幂等化；
- observation 的 `params.toml` 阻塞已修复，未削弱 hash-bound evidence；
- 继续削减 STA/Harden、DREAMPlace/Sizer 内部 iteration PNG 或 full-flow baseline 时间需要进入
  native 工具/普通 GUI 行为边界，本轮不扩散。

### 11.6 repair sequence 004 补充审计

复查对象：

- repair probe：
  `/tmp/ecos-agent-gcd-baseline-repair-20260906/core-util-0.2-fixed-339f03ef/probes/rq1-floorplan-core_util-004`
- candidate root：
  `/tmp/ecos-agent-gcd-7knob-20260906-v2/gcd-gap-a236fdba-v2/baseline-1/workspace/.agent/candidates/candidate-02ea4dd42a43ad5f-rq1-floorplan-core_util-004`
- 当前父仓库：`0a991b2cc5bfa3db6e39de5d4ab298f4563a5a2a`
- 当前 ECC：`4feb98480d38ad0af7a4ff7d9fdfecabf9444301`

关键结果：

| 指标 | 数值 |
|---|---:|
| `runtime.v1.json elapsed_seconds` | 227.49 s |
| `probe-result.v1.json runtime_seconds` | 228.29 s |
| `/usr/bin/time` wall | 229.23 s |
| `/usr/bin/time` max RSS | 2,540,232 KiB |
| `probe-result.v1.json peak_child_memory_mb` | 2,480.70 MiB |
| terminal state | `succeeded` |
| execution outcome | `execution_succeeded` |

阶段证据来自 candidate `home/flow.json`、各 step `subflow.json` 与 native log timestamp：

| 阶段 | `home/flow.json` runtime | native timestamp span | 判断 |
|---|---:|---:|---|
| Floorplan | 0 s | 0 s | 非热点 |
| place | 27 s | 27 s | 原生 placement/early route |
| CTS | 13 s | 14 s | 原生 CTS/early route |
| legalization | 0 s | 1 s | 非热点 |
| Timing optimization | 7 s | log timestamp 不完整 | 原生 Sizer + legalization |
| route | 2 s | 3 s | 原生 routing |
| DRC/LVS/filler/RCX | 0 s | 0 s | 非热点 |
| postRouteLec | 2 s | 无 native timestamp | 非热点 |
| STA | 157 s | 157 s | 最大剩余原生 STA 开销 |
| Harden | 11 s | 12 s | 原生 harden/lib extraction |

可控 Agent 开销边界：

- `Floorplan -> Harden` 主段 native timestamp 从 `12:24:41` 到 `12:28:26`，约 225 s；
  与 driver `227.49 s` 的差值约 2.5 s。
- 该差值包含 JSON-RPC polling、candidate receipt 写入、terminal observation、manifest/hash
  校验和 Python driver book-keeping；未达到值得继续引入缓存或并发复杂度的量级。
- 剩余最大单项是 `sta_ecc/log/sta.log` 的 157 s；日志显示 STA 在多个 timing corner 上重复
  `readLib -> initSTA -> wrapTimingLibrary -> runSTA/report`。这是 ECC/native STA 语义路径，
  不属于 `ecc-agent-rpc` 或 `ecos/agent` 客户端队列开销。

绘图复查：

- candidate root 内共 26 张 PNG、约 683,957 bytes；
- 分布为 DREAMPlace/Sizer 内部 iteration 图：`place_dreamplace/data` 22 张、
  `legalization_dreamplace/data` 2 张、`timing_optimization_sizer/data` 2 张；
- target 及后续 step 没有恢复 `analysis/*.png` 或 `feature/*.png` 展示图；
- 这些 iteration PNG 的日志单次约 0.02 s，总量远低于 STA/Harden 原生耗时，且继续删除需要进入
  DREAMPlace/Sizer 内部工具边界，本轮不处理。

产物大小复查：

| step root | 文件数 | 字节数 |
|---|---:|---:|
| `Floorplan_ecc` | 54 | 5,220,078 |
| `place_dreamplace` | 131 | 11,054,616 |
| `CTS_ecc` | 115 | 8,713,741 |
| `timing_optimization_sizer` | 70 | 8,345,019 |
| `sta_ecc` | 251 | 17,639,059 |
| `Harden_ecc` | 13 | 91,719 |

本轮补充审计未发现报告前文未覆盖的、可在 Agent 所有权边界内继续修复的显著性能问题：

- `ecc/agent/workspace_api.py` 已在 candidate clone 前执行 Sizer preflight，并在 clone 时跳过
  后续会清理的 target/subsequent artifacts；
- `ecc/agent/plot.py` 与 `ecc/agent/engine.py` 已对 candidate-only 展示图和 KLayout snapshot
  做跳过，普通 Quick Start/GUI 行为仍保留；
- `ecos/agent/.../ecc/rpc_client.py` 已只缓存 terminal runtime events，并对
  `operation.ack_step_rendered` 做 `(operationId, eventId)` 幂等去重；
- repair sequence 004 的剩余 wall/RSS 主要来自原生 EDA 工具，尤其 STA 多 corner 分析和 harden
  timing characterization；继续优化会越过本任务限定的 Agent/ecc-agent-rpc 边界。
