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
登录状态或任何凭据**。使用 Agent 前，请自行安装并完成 Codex CLI 认证。

### 配置 Codex CLI（使 GUI 可识别）

在终端执行以下命令安装、登录并检查 Codex CLI：

```bash
npm install -g @openai/codex
codex login
command -v codex
codex --version
codex app-server --help
```

从同一终端启动 ECOS Studio 时，下面的命令会将 Codex 的绝对路径和当前 `PATH`
一同传给 GUI。请在 AppImage 所在目录执行：

```bash
ECOS_AGENT_CODEX_BIN="$(command -v codex)" ./ECOS-Studio_*.AppImage
```

若始终从桌面图标启动应用，请在使用 systemd 的 Linux 桌面环境中持久化 Codex
绝对路径，然后注销并重新登录桌面会话，再启动 ECOS Studio：

```bash
codex_bin="$(command -v codex)" || exit 1
mkdir -p "$HOME/.config/environment.d"
printf 'ECOS_AGENT_CODEX_BIN=%s\n' "$codex_bin" \
  > "$HOME/.config/environment.d/ecos-agent.conf"
```

Agent 仅接受可执行的 `ECOS_AGENT_CODEX_BIN`，否则回退到 GUI 进程 `PATH` 中的
`codex`。启动检查失败时不会创建 workspace，也不会启动 ECC 流程。

## 在 ECOS Studio 中使用

Agent 区分 **Project**（含 `project.json` 的容器）与 **Workspace**（可打开跑
flow 的子目录）。Design Name 是设计标识（`parameters.design`），不必等于
Workspace 目录名。

按上下文分流：

- **未打开 workspace（首页）**：Topbar Chat 打开右侧 Agent 抽屉。先选择或新建
  Project，再创建其下的 Workspace 并运行完整流程。
- **已打开 workspace**：Topbar Chat 展开右侧聊天栏（Home / 步骤页共用）。欢迎语
  同时展示 Project 与 Workspace。操作是「修改参数（只保存）」「从指定阶段重跑」
  「继续未完成 flow」「在当前 Project 下新建 Workspace」。Standalone workspace
  （无 `project.json` 父目录）不提供第 4 项。

Agent 会将操作、重跑源、阶段、执行范围和最终确认显示为结构化选项；合同确认前
不会执行流程。运行时状态条显示 Agent 状态，工具活动合并在可展开的 Tool 卡中。
可以 Stop 中断当前 turn，也可排队一条后续消息。

### 1. 首页：先 Project，再 Workspace

此功能用于在 Project 下创建 Workspace，并从 RTL 执行完整 ECC 流程。

1. 在首页打开 Topbar Chat，点击“在 Project 下创建 Workspace 并运行完整 RTL 到
   GDS 流程”。
2. 选择「使用已有 Project」或「新建 Project」；已有 Project 可从 Project
   Management 历史列表选择，或输入含 `project.json` 的根目录。
3. 填写 Workspace Name（子目录名，如 `ws_0001`）、Design Name、流程终止阶段、
   RTL；可选 filelist/SDC 可点“跳过”或“使用推荐路径”，PDK/默认参数可点
   “使用推荐/默认值”，也可继续手动输入。Workspace 路径为
   `<project_root>/<workspace_name>`。
4. 检查 Agent 展示的设置合同（Project Root / Workspace / Design Name 分栏）。
   需要修改时，可以用自然语言说明需要调整的字段。
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
4. 选择目标阶段，描述需要调整的参数，并选择单阶段执行或继续执行到流程终点。
5. 检查冻结的重跑合同，包括源/目标 workspace、目标阶段、终止阶段、参数补丁和
   执行范围。
6. 点击“确认并开始运行”。ECOS Studio 创建隔离重跑 workspace，并通过固定 ECC
   RPC 执行合同中的重跑动作；点击“取消”会返回操作选择，不执行重跑。

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

选择卡作答后会保留“已选择”状态且不可重复点击。底层仍发送兼容状态机的选项值，
但用户不需要手动输入数字。

## Codex CLI 在哪里发挥作用

Codex CLI 仅用于生成**只读、带类型约束的建议**，不会取得流程执行权限。

- 在完整流程中，它可在已确认的项目根目录内推荐 RTL、filelist、SDC 等候选路径，
  并将自然语言修改建议转换为待验证的 workspace 设置提案。
- 在特定阶段重跑中，它可将自然语言参数请求转换为受允许参数集合约束的候选补丁。
- Codex 的建议必须经过本地校验并展示给用户确认。它不能执行 shell/ECC 命令、
  不能自行选择没有证据的阶段、不能创建或覆盖 workspace，也不能宣称流程成功。

项目根目录和重跑 source workspace 是 Codex 可读取建议的边界。Codex 不可用、
超时或返回不符合合同的内容时，当前操作会失败关闭，ECC 不会被调用。

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

按上文“配置 Codex CLI（使 GUI 可识别）”执行 `command -v codex`、
`codex --version` 与 `codex app-server --help`。若终端检查通过而桌面应用仍失败，
使用 `ECOS_AGENT_CODEX_BIN="$(command -v codex)"` 从该终端启动应用，或写入
`~/.config/environment.d/ecos-agent.conf` 后注销并重新登录。

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
