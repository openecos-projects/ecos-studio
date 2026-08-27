# ECOS Agent

`ecos_agent` 是 ECOS Studio 内置的受控 GUI Flow Agent。它将设计输入、已有流程
证据和用户意图转化为可审核的物理设计建议：推荐 RTL、filelist、SDC 和 PDK 路径，
发现可安全重跑的阶段，并将参数请求限制在该阶段允许的配置集合内。

它通过“建议 -> 本地校验 -> 用户确认 -> 固定 ECC RPC 执行”的确定性链路，将
完整流程和隔离重跑融入 GUI。Agent 不直接执行 shell 命令，也不直接修改流程状态；
ECOS Studio 负责 workspace、合同、执行和结果记录，使交互效率与过程可追溯性同时
得到保证。

## 使用前准备

打包版 ECOS Studio 已包含 Agent 的 Python 运行时，但**不包含 Codex CLI、
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

按上下文分流：

- **未打开 workspace（首页）**：Topbar Chat 打开 Agent 聊天。开场给出主 CTA
  「开始创建 Workspace」，也可直接用自然语言说明意图（例如已有 Project 路径、
  Workspace 名、设计名）；寒暄或无关输入会留在开场；Agent 可提供只读答复，无法处理时会提示错误或重新展示可用选项。随后选择或新建Project，再创建其下的 Workspace 并运行完整流程。
- **已打开 workspace**：Home / 步骤页共用 Topbar Chat。欢迎语同时展示 Project 与
  Workspace。操作是「修改参数（只保存）」「从指定阶段重跑」
  「继续未完成 flow」「在当前 Project 下新建 Workspace」。Standalone workspace
  （无 `project.json` 父目录）不提供第 4 项。自然语言仅在能明确映射到上述操作时
  前进；其他输入会给出只读答复并保留当前操作选项。

Agent 会将操作、重跑源、阶段、执行范围和最终确认显示为结构化选项；合同确认前
不会执行流程。运行时状态条显示 Agent 状态，工具活动合并在可展开的 Tool 卡中。
可以 Stop 中断当前 turn，也可排队一条后续消息。

### 1. 首页：先 Project，再 Workspace

此功能用于在 Project 下创建 Workspace，并从 RTL 执行完整 ECC 流程。

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
6. 只有 ECC 返回终态成功后，Agent 才会报告该次 workspace 创建和流程执行成功；
   失败会报告失败原因，不会将未完成流程标记为成功。

### 2. Workspace：从特定阶段重跑

此功能用于基于当前已打开 workspace 的可验证产物，从指定阶段开始在隔离
workspace 中重跑。原始 workspace 不会被覆盖。

1. 在已打开的工程中展开 Agent，点击“从指定阶段重跑”。
2. 确认当前 workspace 作为 source（可按需改选）；设计名由当前工程推断。
3. Agent 从该 workspace 的流程记录和产物中发现允许重跑的阶段；只能选择有
   完成证据的阶段。
4. 选择起始阶段，描述需要调整的参数，并选择执行范围：
   - 只重跑所选阶段后停止；或
   - 从所选阶段重跑，并继续到**标准流程终点**（当前为 Harden；随 ECC
     流程序列扩展而变化），而不是源 workspace 原先规划/跑到的终点。
5. 检查冻结的重跑合同，包括源/目标 workspace、起始阶段、终点阶段、参数补丁和
   执行范围。
6. 点击“确认并开始运行”。ECOS Studio 创建隔离重跑 workspace，必要时把 flow
   补齐到标准终点，并通过固定 ECC RPC 执行合同中的重跑动作；点击“取消”会返回
   操作选择，不执行重跑。

### 3. Workspace：继续未完成 flow

对齐 Agent 接入前的 GUI：在当前 workspace 原地执行 `runAllFlow({ rerun: false })`。
确认合同后不会创建隔离 target。

### 4. Workspace：修改参数（只保存）

描述参数变更并确认合同后，GUI 将补丁写入当前 workspace 的
`home/parameters.json`，**不会**自动跑 flow。

### 5. Workspace：在当前 Project 下新建 Workspace

当 Agent 已绑定 Project Root 时可选。跳过 Project 选择，直接询问 Workspace
Name 与 Design Name（可默认继承当前设计名），其余 setup 与首页相同；创建成功后
仍自动 `runAllFlow` 并打开新 workspace。

交互卡作答后会保留“已选择”状态且不可重复点击。GUI 通过专用 answer channel
提交后端生成的 `requestId`：点击选项提交 `optionId`，点击“其他”则在原选项位置输入
并提交受控的 `text` 回答；表单一次性提交经过字段约束的 `values`。用户不需要手动输入状态机数字
或执行值。

## Codex CLI 在哪里发挥作用

Codex CLI 仅用于生成**只读、带类型约束的建议**，不会取得流程执行权限。

- 在完整流程中，它可在已确认的项目根目录内推荐 RTL、filelist、SDC 等候选路径，
  并将自然语言修改建议转换为待验证的 workspace 设置提案。
- 在特定阶段重跑中，它可将自然语言参数请求转换为受允许参数集合约束的候选补丁。
- Codex 的建议必须经过本地校验并展示给用户确认。它不能执行 shell/ECC 命令、
  不能自行选择没有证据的阶段、不能创建或覆盖 workspace，也不能宣称流程成功。

优化规划中的知识使用采用两阶段本地门禁。`ecos.optimization_retrieval_request.v2`
继续作为 value-free、metric-ID-only baseline；目标路径另外生成
`ecos.optimization_state_evidence_request.v1`，用 observation hash 绑定当前指标、相对
reference/incumbent 的 delta、历史 trend、current values 和可用的 spatial evidence。
确定性 compiler 将召回 claim、hash-locked tool binding 与当轮 legal actions 求交，
只把 `ecos.supported_action_view.v1` 中 `pass` / `weak` 的 claim-action 关系交给 planner。
缺观测、anti-condition、stale binding 或 unsupported action 均 fail closed。

当前 `ecos.optimization_proposal.v1` 仍只允许 knob/direction；validator 除了检查引用属于
本轮集合，还要求至少一个引用实际支持所选 knob/direction。数值选择和执行继续由本地
controller 负责。exact value、effective-domain hash 和 allowed value lattice 只消费
Parameter Effectiveness 的公开合同，本模块不复制这些能力。

项目根目录和重跑 source workspace 是 Codex 可读取建议的边界。Codex 不可用、
超时或返回不符合合同的内容时，不会生成可执行合同或调用 ECC；Agent 会保留当前
输入步骤，供用户修正输入后重试。

### 边界靠什么保证

真正的边界是**类型化提案链路**：Codex 只能返回受 schema 约束的 JSON 提案，
写入动作全部由 ECOS 校验后执行，Codex 自身没有任何写入通道。

传给 app-server 的 `sandboxPolicy`、`runtimeWorkspaceRoots`、`permissions`
只是纵深防御，不能当作依据：Codex 的 Linux 沙箱依赖 bubblewrap user namespace，
在很多主机（含开启 AppArmor 限制的 Ubuntu）上无法生效；而 app-server 对**任何
未知字段都静默接受**，因此无法从外部确认某个字段是否真的被采纳。

### 联网

Codex 托管的 web search 默认关闭，需显式开启：

```bash
ECOS_AGENT_CODEX_WEB_SEARCH=1
```

开启后 Codex 可查询公开资料（例如工具选项含义、报错信息）来辅助生成提案，
其检索动作会作为活动进度显示在聊天中。关闭时 Agent 全部功能仍可用，只是
少了外部资料这一信息来源。

需要注意：这一开关控制的是 Codex 的联网检索工具，**不是**数据外发的总开关——
模型调用本身就要联网。密态设计应结合企业侧网络策略评估，Codex 侧目前没有可
验证的域名白名单机制。

## TODO

以下是规划中的能力，不代表当前版本已经提供。

1. **设计状态诊断与受控流程建议**：从 workspace 流程记录、QoR、DRC、时序和
   拥塞等证据中定位问题，给出带证据的参数调节或流程重访候选；每项建议仍须满足
   参数白名单、合同校验和用户确认。
2. **受控 PPA 优化闭环**：在隔离 workspace 中，以明确的基线、目标、资源预算和
   通过门槛生成并执行候选实验，比较功耗、性能、面积及签核相关指标；保留配置、
   随机种子、命令、产物和指标，以支持复现、回滚和结果审计。
3. **Agent 能力自进化**：基于用户明确允许保存的执行轨迹、合同校验结果和实验
   反馈，离线评估并版本化更新策略或知识；新版本须通过基准评测、审批与回滚机制，
   不得绕过既有的权限边界和确定性执行链路。

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
uv run python -m ecos_agent.provider
```

开发态 manifest 使用 `uv run --locked`；打包构建会将 provider 生成为独立的
`ecos-agent` 可执行文件，并随 Electron 资源一起发布。

```bash
uv run pytest -q
```
