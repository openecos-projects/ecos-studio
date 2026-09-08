# Agent 新后端架构诊断

日期：2026-09-07。检查基线：`d1616f0c` 加当前工作树。

## 结论

Agent 已有部分迁移。开发态 Provider 能正常启动，参数保存和继续执行已经接入新命令；隔离重跑仍混用旧文件操作和新 Runtime Operation，不能判定整个 Agent 已迁移完成。

本次完成调用链诊断、测试基线和一处确定的 Revision 取值修复。下文的迁移事项仍是待实施工作，不代表通过了真实 RTL-to-GDS 验收。

## 功能清单

| 功能 | 当前入口与实现 | 新架构状态 |
| --- | --- | --- |
| Provider 发现、启动、停止 | `main/index.ts` -> `createAgentRuntimeFromEnvironment` -> `AgentRuntimeManager` -> `AgentProviderProcessRuntime` -> Python stdio | 已实测开发 manifest 的 start、首页会话、选项事件、stop |
| Codex 检测、安装、登录、指定路径 | `AgentCodexSetupCard.vue`、`codexDependencyService.ts` | 独立依赖服务已有测试；本次未安装工具或改变登录状态 |
| 首页创建 Project / Workspace | `provider.py` 设置状态机 -> `AgentWorkspaceSetupPanel.vue` -> `App.vue:createWorkspaceFromAgent` -> `newProject` | 创建复用现有 Workspace 创建入口；仍需真实新格式工程验收 |
| 创建后运行完整流程 | `pendingPostCreateFlow` -> `AIChatPanel.vue:maybeRunPostCreateFlow` -> `useFlowRunner` | 已使用 Operation 启动并等待终态；GUI 交接仍由组件负责 |
| 当前 Project 下新建 Workspace | 与首页共用创建链路，预填 Project | 已复用创建能力；需覆盖 MPC / PDK 继承和创建失败恢复 |
| 修改参数，只保存 | Python knob 提案 -> Electron 确认 token、白名单转换 -> `executeConfirmedWorkspaceParameterUpdate` | 已使用 `workspace.updateConfiguration` 和 `workspace.updateStepConfiguration`，无旧参数文件直接写入 |
| 继续未完成流程 | `workspace_continue` -> `runAllFlow({ rerun: false })` -> 等待 Operation | 核心执行已迁移；会话绑定与后台结果回传仍需集成验证 |
| 隔离重跑单步 / 到标准终点 | Python `GuiWorkspaceRerunResolver` -> Electron `prepareWorkspaceRerun` -> `executeWorkspaceRerunDomain` | 准备阶段尚未迁移；执行阶段已有新 Operation，但有本次修复的 Revision 错误 |
| 自然语言分流、只读问答 | `provider.py`、`codex_provider.py`、`codex_rpc.py` | 使用受 schema 限制的提案；部分测试意外依赖真实 Codex |
| 阶段知识检索 | `step_knowledge.py`、`knowledge_bundle.py`、`knowledge/` | 有 11 个阶段知识包；生成检查失败，来源需要随重构更新 |
| 工具活动、结构化选项、消息排队 | `AgentToolCard`、`AgentChoiceCard`、`AIChatPanel`、消息 store | 相关单测通过；不等同于真实聊天界面端到端覆盖 |
| 多聊天标签、Workspace 切换 | `agentShellStore`、`agentTabContext`、Electron session subscription | 已有上下文隔离，但 Runtime Handle 生命周期尚未完整对齐 |
| Stop | `agent.interrupt` -> Provider / Codex 当前 turn | 停止的是 Agent turn；没有自动对应到 ECC `operation.cancel` |
| 网络检索 | `ECOS_AGENT_CODEX_WEB_SEARCH`，默认关闭 | 已有协议测试；本次未做真实联网模型验收 |
| 自动工程诊断、PPA 优化闭环、自进化 | Agent README 的 TODO | 尚不是已实现功能，不应当作迁移后自然具备的能力 |

## 已修复：重跑读错 Revision 层级

位置：`gui/apps/desktop-electron/electron/main/registerIpc.ts`，`workspaceExecuteFlowAgentRerun` handler。

实际 `workspace.snapshot` 把工程 Revision 放在 `engineeringSnapshot.workspaceRevision`。原 handler 读取顶层 `workspaceRevision`，传给执行器的是 `undefined`，执行器随后报 `Workspace rerun revision is unavailable.`。

原 IPC 测试伪造了顶层 Revision，掩盖了跨进程不一致。已把普通路径和 canonical path alias 两个测试改成实际结构，并修复读取位置。

复现命令，在 `ecos/gui` 执行：

```bash
pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/main/registerIpc.test.ts -t 'executes a prepared rerun'
```

修复前：期望执行器收到 `1`，实际为 `undefined`。修复后通过；全量 Electron 测试也通过。

会话初始化和普通消息处理原本就读取嵌套 Revision。本次没有证据表明这两处存在同一个层级错误。

## 待迁移问题

### 1. 隔离重跑仍由 Electron 改写工程文件

`gui/apps/desktop-electron/electron/services/eccRpc/workspaceRerun.ts` 的准备流程：

1. 递归复制整个 source Workspace。
2. 修改目标 `home/flow.json`，补齐阶段、重置状态、清理阶段目录。
3. 重写 `home/*.json` 中的路径，并裁剪旧 Home / Checklist 聚合。

这条路径没有通过 ECC 的 Workspace 创建或派生命令提交新的 Descriptor、身份和工程结果。复制内容包含 `workspace.toml`、`engineering-snapshot.json`、stale predecessor 和 `runtime-commands.json`，但没有相应的新身份与账本初始化逻辑。

ECC `ensure_engineering_snapshot` 对当前版本的现有快照直接返回；打开 Workspace 又使用其中的 `workspaceId` 并加载执行账本。因此复制后的目标可能继承源身份、源执行记录，以及已被删除产物对应的成功事实。这里只完成了源码调用链验证，尚未用真实目标 Workspace 验证全部后果。

另一个一致性风险是：补齐至 Harden 只更新旧 Flow 文件，没有更新 Descriptor 的 Flow 范围。后续从 Descriptor 重建 Flow、更新配置或重新打开工程时，执行范围可能与确认合同不一致。

迁移要求：隔离派生成为经过 Electron 校验的领域命令，由工程所有者提交目标配置、全新身份、合法前置输入和当前快照。源 Workspace 必须保持不变。

### 2. 重跑资格仍由旧文件和文件名猜测

`agent/src/ecos_agent/workspace_rerun.py` 直接读取 `home/flow.json`，筛选 `Success`，按工具目录和 `.def.gz` / `.v.gz` / `.gds` 后缀寻找输出，冻结 Flow 文件和单个产物的 hash。

它没有消费新架构的已提交 Engineering Snapshot、Artifact identity、Result Freshness 或 Active Operation。需要把“哪些阶段允许重跑、使用哪些前置输入”的事实查询放到 Electron / ECC 边界，Provider 只接收受限候选并形成提案；用户切换 source 时也要重新查询和授权。

### 3. 参数当前值与 Runtime Handle 只在初始绑定

`agentStartSession` 从 ECC 读取参数和 Step Options；`agentSendMessage` 随后仅刷新 Revision。Python 保存会话初始的 `workspaceParameterValues`，主要在自身成功保存后更新本地值。

因此手动配置修改、外部配置同步或部分参数提交失败之后，下一张 Agent 合同可能展示过时的旧值。Revision 检查能阻止某些过期提交，但不能保证合同展示值新鲜。

此外 Electron `trackAgentSession` 保留初始 `workspaceId`，已有 subscription 直接返回；普通消息一直使用该 Handle 查询快照。新架构会释放无后台操作的旧 Runtime Session，Workspace 重开后的 Handle 需要重新绑定，否则旧聊天可能在发送普通消息前失败。

迁移要求：用稳定 Workspace 身份关联聊天，在需要工程操作时解析该窗口当前拥有的 Runtime Handle；生成合同前同时刷新 Revision、canonical 参数和 Step Options，确认期间保持冻结的预期 Revision。

### 4. 执行结果仍依赖聊天组件回传

创建、继续和重跑等待终态后，由 `AIChatPanel.vue` 发送 `workspace_*_result:` 文本给 Provider。底层 ECC Operation 已支持后台运行，但 Agent 的执行关联与结果回传仍与组件生命周期耦合。

需要在 Electron 按 session、command、Operation 身份记录执行关联，处理切换 Workspace、组件卸载和 Runtime 恢复。Stop 的产品语义也应明确区分中断模型 turn 与取消 ECC Operation。

### 5. 知识包、文档和测试基线落后于重构

- `uv run python scripts/build_knowledge.py --check` 实际失败：`knowledge bundles are stale`。
- 生成器仍把 Renderer 的 `projectManagement.ts` 作为 `gui.step_metrics` 审计来源，需要核对迁移后的事实所有者后再生成，不能只改 hash。
- 阶段知识包覆盖 11 项，当前执行枚举为 14 项；`Timing optimization`、`lvs`、`postRouteLec` 没有专属知识包。
- README 仍描述参数保存直接写 `home/parameters.json`；权限文档也残留旧 `syncConfig` / `refreshConfig` 的完成记录。
- `test_provider_answers_cts_question_without_changing_operation_state` 未注入聊天解析器；无 Codex 时走本地知识回退，返回结构与其断言不同。真实 Codex 可用时测试还会产生模型请求和长超时。
- `AIChatPanel.contract.test.ts` 的两项测试检查源码字符串，无法覆盖真实创建、导航、执行和回传链路。

## 迁移顺序与验收

1. 会话与查询：刷新参数上下文、重新解析 Runtime Handle，覆盖创建后、手动保存后、关闭重开、跨 Workspace 标签。
2. 隔离派生：统一权威证据查询与领域创建命令，移除 Electron 手写 Flow / 配置 / 快照；验证目标身份与源不同、源文件不变、无历史执行继承。
3. Operation 关联：在 Electron 记录 Agent 执行与终态，验证成功、失败、取消、切换页面与 Runtime 恢复。
4. 知识与回归：更新来源、重新生成知识包、隔离单测中的真实模型依赖、同步说明文档。
5. 用真实的小型 RTL 工程验证首页创建、Project 内创建、只保存参数、继续执行、单步隔离重跑、完整隔离重跑。参数失效范围必须与新架构一致，不能为了通过重跑而把 stale 结果当作前置输入。

## 本次验证记录

以下 GUI 命令的工作目录为 `ecos/gui`，Python Agent 命令的工作目录为 `ecos/agent`。

| 检查 | 结果 |
| --- | --- |
| 开发 manifest 启动探针：启动实际 Provider，发送 start / Home startSession / stop，校验响应及 choice 事件 | 通过；没有发起模型生成或 ECC 执行 |
| `pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/agent electron/ipc/handlers/agent` | 6 文件，49 通过；实际测试位于 services/agent，第二个筛选路径不存在 |
| `pnpm --filter @ecos-studio/renderer exec vitest run src/components/AIChatPanel.contract.test.ts src/composables/useAgentFlowProgress.test.ts src/stores/agentShellStore.test.ts` | 3 文件，11 通过 |
| `uv run pytest -q` | 运行 367 秒后主动中断：95 通过，1 失败；期间发现真实 Codex 子进程 |
| `env PATH=/home/ekko/.local/bin:/usr/bin:/bin ECOS_AGENT_CODEX_BIN=/nonexistent/ecos-test-codex /home/ekko/.local/bin/uv run pytest -q --durations=5` | 96 通过，2 失败，2.70 秒；失败见知识包和 CTS 测试说明 |
| `uv run python scripts/build_knowledge.py --check` | 失败，知识包过期 |
| `pnpm run check` | typecheck、lint 通过；fmt:check 被已有改动 `StepDashboard.vue` 的格式问题阻断 |
| `pnpm run test` | 全部通过：infra 7、shared 107、Electron 791、Renderer 869，共 1,774 项 |
| 根目录 `python3 .github/scripts/check-version.py` | 通过，`0.1.0-alpha.9` |
| `pnpm run desktop:build` | 通过 |
| `pnpm run desktop:smoke` | 默认环境因本机 Electron SUID sandbox 配置失败 |
| `env ELECTRON_DISABLE_SANDBOX=1 ECOS_ELECTRON_DISABLE_GPU=1 LIBGL_ALWAYS_SOFTWARE=1 pnpm run desktop:smoke` | 通过；使用仓库开发 VM 设置，未修改系统 sandbox 文件 |

未执行：真实模型提案与完整 ECC RTL-to-GDS 的端到端组合、真实 Codex 安装或登录、跨窗口交互验收、`make build` 的完整 Linux release 打包。未改打包输入或原生资源，桌面生产构建不能替代 release 验证。没有运行不受此次改动影响的 Rust / ECC 自身测试。

当前工作树已有 GUI 与 Project Comparison 改动；本次代码修改限于重跑 Revision 读取和对应 IPC 测试。
