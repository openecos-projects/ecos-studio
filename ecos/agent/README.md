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

打开桌面应用后，进入 Agent 聊天面板，按提示选择操作：`1` 为运行完整流程，
`2` 为从特定阶段重跑。Agent 会在关键位置显示待确认的结构化合同；确认前不会
执行流程。

### 1. 运行完整流程

此功能用于从 RTL 开始创建 workspace 并执行完整 ECC 流程。

1. 在 Agent 聊天面板输入 `1`。
2. 依次填写项目根目录、流程终止阶段、设计名、RTL 文件、可选 filelist/SDC、
   PDK 路径、顶层模块、时钟与物理设计参数。
3. 检查 Agent 展示的 workspace 设置合同。需要修改时，可以用自然语言说明
   需要调整的字段。
4. 选择确认执行。ECOS Studio 创建 workspace，并通过固定 ECC RPC 启动完整流程。
5. 只有 ECC 返回终态成功后，Agent 才会报告该次 workspace 创建和流程执行成功；
   失败会报告失败原因，不会将未完成流程标记为成功。

### 2. 从特定阶段重跑

此功能用于基于已有 workspace 的可验证产物，从指定阶段开始在隔离 workspace
中重跑。原始 workspace 不会被覆盖。

1. 在 Agent 聊天面板输入 `2`。
2. 输入设计名，并确认当前 GUI workspace 或填写已有 source workspace 路径。
3. Agent 从该 workspace 的流程记录和产物中发现允许重跑的阶段；只能选择有
   完成证据的阶段。
4. 选择目标阶段，描述需要调整的参数，并选择单阶段执行或继续执行到流程终点。
5. 检查冻结的重跑合同，包括源/目标 workspace、目标阶段、终止阶段、参数补丁和
   执行范围。
6. 选择确认执行。ECOS Studio 创建隔离重跑 workspace，并通过固定 ECC RPC
   执行合同中的重跑动作。

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
