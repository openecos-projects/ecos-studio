# ECOS Agent

`ecos_agent` 是 ECOS Studio 内置的受控 GUI Flow Agent。它将设计输入、已有流程
证据和用户意图转化为可审核的物理设计建议：推荐 RTL、filelist、SDC 和 PDK 路径，
发现可安全重跑的阶段，并将参数请求限制在该阶段允许的配置集合内。

它通过“建议 -> 本地校验 -> 用户确认 -> 固定 ECC RPC 执行”的确定性链路，将
完整流程和隔离重跑融入 GUI。Agent 不直接执行 shell 命令，也不直接修改流程状态；
ECOS Studio 负责 workspace、合同、执行和结果记录，使交互效率与过程可追溯性同时
得到保证。

## 使用前准备

Linux 打包版 ECOS Studio 已包含 Agent 的 Python 运行时，但**不包含 Codex CLI、
登录状态或任何凭据**。Agent 依赖本机可用的 Codex CLI。

### 推荐：在 GUI 内一键就绪（Linux）

打开 Agent 聊天后，若未检测到 Codex CLI，会显示就绪引导卡：

1. **一键安装**：下载官方 Linux musl 二进制到 Studio 托管目录（`userData/codex-cli`），并自动写入设置中的 `agent.codexBin`。
2. **打开登录**：拉起 `codex login`（通常会打开浏览器）；完成后点「我已完成登录」。
3. **继续使用 Agent**：检测通过后自动重试启动。

也可在卡上选择本机已有的 `codex` 可执行文件。探测顺序为：应用设置路径 →
`ECOS_AGENT_CODEX_BIN` → 托管安装路径 → 进程 `PATH` 中的 `codex`。

### 手动配置（可选）

若更希望自行安装，可在终端执行：

```bash
npm install -g @openai/codex
codex login
command -v codex
codex --version
codex app-server --help
```

从同一终端启动 ECOS Studio 时，可将绝对路径传给 GUI：

```bash
ECOS_AGENT_CODEX_BIN="$(command -v codex)" ./ECOS-Studio_*.AppImage
```

或在 systemd 桌面环境写入：

```bash
codex_bin="$(command -v codex)" || exit 1
mkdir -p "$HOME/.config/environment.d"
printf 'ECOS_AGENT_CODEX_BIN=%s\n' "$codex_bin" \
  > "$HOME/.config/environment.d/ecos-agent.conf"
```

Agent 仅接受可执行的 `ECOS_AGENT_CODEX_BIN` / 设置路径；无效时依次回退到托管安装
路径和 GUI 进程 `PATH` 中的 `codex`。启动检查失败时不会创建 workspace，也不会启动
ECC 流程。

## 在 ECOS Studio 中使用

Agent 区分 **Project**（含 `project.json` 的容器）与 **Workspace**（可打开跑
flow 的子目录）。Design Name 是设计标识（`parameters.design`），不必等于
Workspace 目录名。

Topbar Chat 按当前页面提供不同入口：

- **首页**：手工创建 Workspace 并运行完整 RTL-to-GDS flow、从已完成的 baseline
  Workspace 启动受约束优化，以及面向 GCD/ICS55 的 Quick Start。
- **Workspace**：从指定阶段隔离重跑、继续未完成 flow、启动受约束优化；绑定了
  Project Root 时还可在当前 Project 下新建 Workspace。参数只保存不是列表按钮，
  需要直接说明明确的参数修改意图。

在空闲态也可询问 IC、EDA、ECOS Studio 或当前任务相关问题。Agent 会先做本地知识
检索和受控源码检索，再返回只读答复、当前允许的一项操作或有限选项的澄清；无关
请求不会改变会话状态。

### 1. 首页：先 Project，再 Workspace

手工入口用于在 Project 下创建 Workspace，并从 RTL 执行指定终点的 ECC 流程。

1. 在首页打开 Topbar Chat，点击「开始创建 Workspace 并运行完整 RTL 到 GDS
   流程」，或直接描述创建意图（可同时带上已有 Project 路径、Workspace 名、设计名，
   明确字段会被跳过）。
2. 选择「使用已有 Project」或「新建 Project」；已有 Project 可从 Project
   Management 历史列表选择，或输入含 `project.json` 的根目录。
3. 填写 Workspace Name（自动建议下一个 `ws_NNNN`，也可点“使用默认值”或自行输入）、
   Design Name、流程终止阶段、RTL；可选 filelist/SDC 可点“跳过”或“使用推荐路径”，
   PDK/默认参数可点“使用推荐/默认值”，也可继续手动输入。Workspace 路径为
   `<project_root>/<workspace_name>`。
4. 检查 Agent 展示的设置合同（Project Root / Workspace / Design Name 分栏）。
   需要修改时，可以用自然语言说明需要调整的字段（可一次改多个明确字段）。
5. 点击“确认并开始运行”。ECOS Studio 创建 workspace，写入 `project.json`，进入
   工程并展开侧栏 Agent，再通过固定 ECC RPC 启动完整流程；点击“取消”不会创建
   workspace 或执行 ECC。
6. Workspace shell 等待该次 runtime operation 结束后再回报成功或失败；到达 Harden
   时继续检查 signoff checklist，并在没有 blocked 项时询问是否导出 signoff 包。

### 2. 首页：Quick Start

Quick Start 是 GUI 执行的固定 `ecos.quick_start.workflow.v1` 工作流，不由 Codex
规划。它先检查 GCD 示例、ICS55 PDK 和 MPC 是否 Ready，再依次打开 Project
Management、创建 Project 和 Workspace、切换到新 Workspace，并启动从 Synthesis
到 Harden 的完整 flow。各步状态和资源快照写入 `quick_start_run.json`；聊天中显示
“Quick Start 已完成”只代表设置完成且 flow 已启动，最终完成或失败由后台 runtime
结果更新到该记录。设置和启动过程中可单独 Stop Quick Start；flow 已启动后不再由
这个按钮停止。

### 3. Workspace：重跑或继续 flow

“从指定阶段重跑”基于 source workspace 的流程记录和产物，只允许选择有完成证据
的阶段。确认冻结合同后，GUI 创建隔离 target workspace，通过固定 ECC RPC 执行：

- 只重跑所选阶段后停止；或
- 从所选阶段继续到标准终点（当前为 Harden），而不是 source workspace 原先的终点。

“继续未完成 flow”经确认后在当前 workspace 原地执行
`runAllFlow({ rerun: false })`，不会创建隔离 target。重跑或继续到 Harden 后同样进入
signoff checklist 检查与可选导出。

### 4. Workspace：修改参数（只保存）

在聊天中明确描述参数变更后，Agent 只接受当前 workspace 已发现的 tunable knobs，
验证补丁并展示当前值到目标值的保存合同。确认后 GUI 按 knob registry 给出的目标
写入 `home/parameters.json` 或对应 `config/*.json`，再通过 ECC sync/refresh 保持两个
参数 surface 一致，**不会**自动跑 flow。

### 5. Workspace：在当前 Project 下新建 Workspace

当 Agent 已绑定 Project Root 时可选。跳过 Project 选择，直接询问 Workspace
Name 与 Design Name（可默认继承当前设计名），其余 setup 与首页相同；创建成功后
仍自动 `runAllFlow` 并打开新 workspace。

### 6. 受约束优化 episode

首页入口先要求一个已完成到 Harden 的 baseline workspace；Workspace 入口直接使用
当前 workspace。用户用自然语言描述目标后，Codex 只解析白名单内的主指标、保持
指标和理由，本地 ECOS 补齐固定 signoff gates、冻结 objective hash，并再次要求明确
确认。

确认后，`OptimizationEpisodeRunner` 在由 baseline 重跑时间冻结的候选数、规划调用和
墙钟预算内循环执行。每轮由 Codex 生成类型化参数提案，本地 controller 校验知识支持、
有效参数域、预算和状态，再由固定 `candidate.rerun` ECC adapter 在隔离候选 workspace
执行；GUI 持续报告 proposal、candidate 终态、incumbent 和审计状态。运行中只接受
pause、resume 或 stop。缺失终态回执或观测时结果进入 indeterminate/quarantined 路径，
不会按成功候选处理。

交互卡作答后会保留“已选择”状态且不可重复点击。GUI 通过专用 answer channel
提交后端生成的 `requestId`：点击选项提交 `optionId`，点击“其他”则在原选项位置输入
并提交受控的 `text` 回答；表单一次性提交经过字段约束的 `values`。手工创建、重跑、
继续、参数保存和优化均在结构化合同或授权确认后执行；Quick Start 则以用户点击固定
workflow 入口作为启动授权。普通 turn 可 Stop，也可排队一条后续消息；优化 episode
使用独立的 pause/resume/stop 控制。

## Codex CLI 在哪里发挥作用

ECOS Agent 通过 `codex app-server` 使用 Codex CLI。Codex 负责语言理解、只读检索规划
和类型化提案，不持有 workspace 或流程执行权限。当前调用点包括：

- **聊天与操作路由**：将问题路由到最多 3 个流程阶段，选择本地知识和受控源码检索
  查询，并返回 `flow-agent.gui_chat_response.v1`。它只能选择当前 `allowed_operations`
  中唯一明确的一项，或返回只读答复/有限澄清；检索证据不授权执行。
- **Workspace 设置与参数**：在允许的 filesystem roots 内只读发现 RTL、filelist、
  SDC 等候选路径，将自然语言修正转换为 workspace setup 提案，并将参数请求限制为
  当前 workspace 的 allowed knobs。Quick Start 的固定 GUI workflow 不经过这些提案。
- **受约束优化**：先把自然语言目标解析为白名单 objective，再依据 observation、历史、
  有效参数域和 `supported_action_view` 生成类型化规划提案。Codex 不生成 ECC RPC、
  shell 命令、workspace 路径或执行指令。
- **聊天会话管理**：`/model`、`/goal`、`/compact`、`/new`、`/resume`、`/fork`、
  `/rename`、`/status`、`/permissions` 和只读 `/review` 映射到 app-server 能力；
  `/shell`、`/exec`、`/terminal` 等命令明确拒绝。

优化规划中的知识使用采用两阶段本地门禁。`ecos.optimization_retrieval_request.v2`
继续作为 value-free、metric-ID-only baseline；目标路径另外生成
`ecos.optimization_state_evidence_request.v1`，用 observation hash 绑定当前指标、相对
reference/incumbent 的 delta、历史 trend、current values 和可用的 spatial evidence。
确定性 compiler 扫描当前 stage 兼容的全部 structured claims，将其与 hash-locked tool
binding 和当轮 legal actions 求交，再只把 `ecos.supported_action_view.v2` 中稳定排序后的
最多 3 条 `pass` / `weak` claim-action 关系交给 planner。完整候选、匹配和截断结果留在内部
审计 view；planner payload 只含 exposed claims 和完整审计 hash。
缺观测、anti-condition、stale binding 或 unsupported action 均 fail closed。

默认 `ecos.optimization_proposal.v2` 从 compiled view 支持的 knob/direction 及匹配的
dynamic effective-domain allowlist 中选择 exact value。现有人工离散值仅作为参考锚点；
controller 根据当前值、已尝试值和 receipt 阈值，确定性生成每个方向最多 3 个候选。
validator 同时检查知识支持关系、domain hash、方向和有界搜索域。兼容的 v1 lane 仍由本地
controller 在参考值中选择。两个 lane 的执行权都保留在 controller，知识模块只消费
Parameter Effectiveness 的公开合同，不复制其能力。

### 如何阅读参数和结果证据

实现保留四类参数证据字段，但它们不是四个并列功能：

| 字段 | 含义 |
|---|---|
| `requested` | Agent 提议的请求值，只代表动作意图 |
| `materialization.written_value` | L1 实际写入工具输入的值，包含单位映射 |
| `effective_initial/final` | 工具经过准入、归一化、裁剪、覆盖或运行期调整后采用的值 |
| `activation.status` | 参数是否进入真实 branch、operator 或 consumer |

`tool.parameter_application_receipt.v1` 是 ECC/tool adapter 基于原生运行观测生成的参数应用回执；
Agent 不从配置文本或日志推断缺失事实。L3 terminal observation 则证明候选是否完整到达 `Harden`
并留下可验证的 signoff、manifest 和产物。前者回答参数实际发生了什么，后者回答完整候选最终得到
什么；二者均不单独证明 QoR 改善。

`ecos.supported_action_view.v2` 的 `pass/weak/blocked/unknown` 是机器可检查的动作支持关系：它只
说明当前状态、工具版本、知识 binding 和有效参数域是否允许某个动作，不代表知识正确或有收益。
equal-budget artifact 中的 `terminal_utility` 只是冻结 objective metric 的相反数（越大越好），不是
综合 QoR；研究判断必须同时检查可行性、`success@k`、PPA/DRC/timing/congestion、runtime 和 memory。

Workspace 设置/路径发现只有这两类调用启用 `read_only_workspace` tool policy；其他
提案默认禁止 tool activity。聊天源码证据由 ECOS 在批准的 repository source roots 中
做本地 literal search，Codex 只选择固定文本查询和引用返回的 evidence ID。Codex 不可用、
超时、触发越权 activity 或返回不符合 schema 的内容时，当前提案失败，不会因此调用 ECC。

### 边界靠什么保证

真正的执行边界是**类型化提案链路**：只有受 schema 约束且通过本地 allowlist、状态、
预算和证据校验的提案，才能进入 GUI 确认或 controller；普通聊天文本和检索结果永远
不会被解释为命令。所有 workspace 写入、ECC RPC、终态判断和 ledger 记录都由 ECOS
的固定代码路径完成。

传给 app-server 的 `sandboxPolicy`、`runtimeWorkspaceRoots`、`permissions`
只是纵深防御，不能当作依据：Codex 的 Linux 沙箱依赖 bubblewrap user namespace，
在很多主机（含开启 AppArmor 限制的 Ubuntu）上无法生效；而 app-server 对**任何
未知字段都静默接受**，因此无法从外部确认某个字段是否真的被采纳。

## 当前实现与证据边界

- **Parameter Engineering Implementation Complete**：7 个冻结的单参数 knob 已接入
  effective-domain exact-value 提案；L0-L3 证据链包含原生参数回执、终态观测、ledger
  和确定性回放。
- **Knowledge Engineering Implementation Partial**：state-conditioned 双层知识、
  post-match top-3 和 zero-shot knowledge treatment 门禁已接入；显式 objective/current-toolchain
  compatibility、冻结 state-rule manifest、noise-aware trend 和真实 episode replay 验收仍待完成。
- **Runtime Acceptance Pending**：尚无当前最终 revision 上覆盖全部目标参数和知识路径的
  完整运行验收证据。
- **Research Claim Not Assessed**：现有实现、单元测试、参数回执和知识支持关系均不能替代
  equal-budget 终态实验，暂不声称优化收益、知识效用或因果改善。

## 常见问题

**Agent 无法启动，提示需要 Codex CLI**

优先在 Agent 聊天的就绪引导卡中使用「一键安装」与「打开登录」（Linux）。
也可按上文手动安装后，用「选择本地 codex」或 `ECOS_AGENT_CODEX_BIN` /
`~/.config/environment.d/ecos-agent.conf` 暴露路径。

**为什么不能任意选择重跑阶段？**

重跑只能基于 source workspace 中已有的流程状态和产物证据。这样可以保证输入
可追溯、目标 workspace 隔离，并避免跳过必需前置步骤。

## 开发者入口

仅在开发或调试 provider 时需要本节。桌面打包版无需安装 `uv` 或本机 Python。

```bash
cd ecos/agent
uv sync --locked
uv run python -m ecos_agent.gui
```

开发态 manifest 使用 `uv run --locked`；打包构建会将 provider 生成为独立的
`ecos-agent` 可执行文件，并随 Electron 资源一起发布。

```bash
uv run pytest -q
```
