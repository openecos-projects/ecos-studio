# Agent 模型配置问题核查与修复记录

时间：2026-09-10 深夜 → 2026-09-11 凌晨（供次日核查）
范围：`ecos/gui` 桌面端模型来源（GLM / Codex）配置与运行链路，及 `ecos/agent` 错误透明度
分支：`yhqiu/flow-agent-v3`

每个问题按「现象 → 根因 → 修复 → 验证」记录。

---

## 问题 1：配置了 Codex GPT 的 API，运行时仍然是 GLM 模型

**结论：配置实际生效了一半——运行模型确实还是 GLM，不是显示错误。**

### 根因（两个叠加）

1. **遗留 wrapper 劫持 `CODEX_HOME`（直接原因）**
   `settings.json` 存在 `agent.codexBin = /home/yhqiu1/.codex-ecos/codex-glm`（本轮开发
   前期的手工绕过方案）。该 wrapper 内部 `export CODEX_HOME=~/.codex-ecos`（一份 GLM
   配置）。ECOS codex 模式尊重用户选择的 codex 二进制，注入的环境被 wrapper 覆盖，
   codex 实际读取 GLM 配置。这个 settings 值此前删过一次，但桌面应用运行中持有
   SettingsStore 内存缓存（`readAll` 有 cache，`writeAll` 整体回写），随其他设置写入时
   把旧值写了回去。
2. **切换模型来源后 provider 子进程不重启（结构性原因）**
   `AgentProviderProcessRuntime.syncEnvironmentOverrides` 原来只在
   `ECOS_AGENT_CODEX_BIN` 变化时回收子进程。切换 glm↔codex 改变的是
   `CODEX_HOME` / `ZAI_API_KEY` / `OPENAI_API_KEY`，二进制不变，Python provider
   进程（连同其派生的 codex app-server、内部缓存的 `_model='glm-5.3'`）继续用旧环境。

### 修复

- `codexDependencyService.resolveBinPath`：GLM 模式忽略 settings 级 `agent.codexBin`
  （受管 CODEX_HOME 不允许被 wrapper 劫持）；codex 模式保留该特性。
- `agentProviderProcessRuntime.syncEnvironmentOverrides`：对生效环境做整体快照比较
  （`stableEnvKey`），任何变化都回收 provider 子进程，下次请求以新环境重启。
- 遗留 wrapper `~/.codex-ecos/codex-glm` 已改为纯透传（不再导出 CODEX_HOME）。

### 验证

- 新增运行时测试：同二进制、仅 CODEX_HOME/OPENAI_API_KEY 变化 → 子进程被回收、
  新 spawn env 正确（`agentProviderProcessRuntime.test.ts` 39 用例全过）。
- 新增服务测试：GLM 模式下 settings bin 被忽略，env 使用受管 CODEX_HOME
  （`codexDependencyService.test.ts` 11 用例全过）。
- 真实 E2E：codex 源（用户自己的 `~/.codex` + `OPENAI_API_KEY` 注入）objective
  proposal 37.7s 成功；GLM 源 22.2s 成功（见问题 2）。

### 待你核查的残留动作

- **重启 GUI dev server**（Electron 主进程修复必须重启才生效）。
- 重启后 `agent.codexBin` 那条 settings 仍是残留值（应用内存缓存），但已无害：
  wrapper 已透传 + GLM 模式忽略该值。想彻底清掉可在应用里重选一次设置，或告诉我再清。

---

## 问题 2：GLM 模式下运行 quick start optimization 等功能报错

**结论：不是模型切换或结构化输出的问题，是环境里失效的本地代理。另修复了一个
暴露出的 ECOS 缺陷：重试期间的错误原因被完全吞掉。**

### 根因

用真实 key 直接驱动 `ecos_agent` provider 复现：turn 反复
`error(willRetry=true)` 直至超时。抓取原始错误通知得到：
`"Connection failed: error sending request"`（`httpStatusCode: null`，请求未发出）。
环境变量里有 `HTTPS_PROXY=http://127.0.0.1:27900`，而本机 27900 端口当前没有代理
进程监听（`Connection refused`）；codex（reqwest）遵循该环境变量，连接死代理失败。
绕过代理直连 `open.bigmodel.cn` 76ms 即通。**代理失效对 codex 源同样致命**
（`api.wallvps.fun` 直连 200 正常，走死代理同样连接失败）。

### 修复

- `ecos/agent/src/ecos_agent/codex/rpc.py`：turn 等待循环此前在 `willRetry=true`
  时完全丢弃错误消息，用户只能看到无来由的超时。现在记录最后一次重试错误，
  超时异常附带 `; last provider error: <真实原因>`，GUI 能显示如
  "Connection failed: error sending request"。
- 新增测试 `test_turn_timeout_carries_last_retriable_error`（`tests/codex/` 10 用例全过）。

### 验证（真实 key，绕过死代理）

- GLM objective proposal：22.2s 成功，结构化输出（`outputSchema`）正常，
  返回合法 `ecos.optimization_objective_proposal.v1`。
- Codex objective proposal：37.7s 成功。

### 你需要检查的环境问题

- 启动 GUI 的终端里有 `http_proxy/https_proxy=127.0.0.1:27900` 但代理进程没起。
  要么把代理拉起来，要么启动前 `unset http_proxy https_proxy`（GLM 和 wallvps
  都可直连）。这不是 ECOS 代码问题，但会让两个模型源全部不可用。

---

## 问题 3：想重新配置新的 API，点击“API 配置…”后没有反应

### 根因

组件测试稳定复现。`openCodexSetup()` 先置 `codexSetupManageOpen = true`，紧接着它
调用的 `refreshCodexStatus()` 在上一轮实现里带了
`if (status.state === 'ready') codexSetupManageOpen.value = false`——设置卡刚要打开
就被状态刷新关掉了。关闭 manage 应只属于“用户保存成功后收起”的路径。

### 修复

- `refreshCodexStatus` 不再改动 `codexSetupManageOpen`（各保存成功路径各自关闭）。

### 验证

- 新增挂载测试 `AIChatPanel.codexSetup.test.ts`：mock 桌面 API，从模型菜单点
  “API 配置…” → 卡片在就绪状态下重新出现 → 输入新 key 提交 → `setGlmApiKey`
  以新值被调用。修复前失败、修复后通过。

---

## 问题 4（自查发现）：GLM 模式下“选择本地 codex”选了也不生效

GLM 模式现在忽略 settings 级 codex 二进制（问题 1 修复），但卡片上仍显示
“选择本地 codex”按钮，选了文件对模型源毫无影响——又一个“点了没反应”。
修复：GLM 模式下隐藏该按钮（仅 codex 模式提供），卡片测试补充断言。

## 附带核查（未发现问题的部分）

- GLM 结构化输出：objective proposal 的 `outputSchema` 走 GLM Responses API 正常
  （22.2s 成功），quick start 的报错与 schema 无关。
- GLM 受管配置目录 `~/.local/share/ecos-studio/codex-glm/`（config.toml + models.json）
  内容正确，`model/list` 返回 glm-5.3 / glm-5.3-flash。
- codex 源模型目录返回用户自己 config 的 GPT 系列（gpt-6-astra/gpt-5.6-\* 等），
  UI 模型菜单会随来源切换显示对应目录。

## 无关发现（未处理，避免扩大范围）

- `ecos/agent` 工作树中存在并行会话的未提交修改（`codex/provider.py` 的 knowledge
  claim 提示词、`optimization/knowledge/compiler.py` 等，服务于正在运行的
  knowledge pilot），本轮未触碰。
- `tests/test_package_architecture.py` 有 4 个失败，全部指向上述并行修改的
  `scripts/run_knowledge_offline_pilot.py` 与 `knowledge/compiler.py`，
  与本轮修复无关，未改动。
- `settings.json` 的 SettingsStore 在应用运行期间以内存缓存为准：外部直接改
  settings.json 可能被应用写回旧值。排查配置问题前先重启应用。

## 检查与提交

- `ecos/gui`：shared/renderer/desktop-electron 三包 typecheck ✓，oxlint ✓，
  oxfmt ✓，测试 132 + 1365+1(new) + 861+1(new) 全绿。
- `ecos/agent`：focused pytest（`tests/codex/` 10 用例）✓；全量 1140 passed，
  4 failed 均为上述并行修改所致（与本轮无关）。
- 提交：见分支 `yhqiu/flow-agent-v3` 最新提交（本轮一个 feat/fix 提交，
  不含并行会话文件）。
