# ECOS Agent 权限模型设计

状态：已实现（第 2.1 / 5.3 节的原始判断在实测后被修正，见下）
适用范围：`ecos/agent`（Python provider）+ `ecos/gui`（Electron 主进程与渲染层）
Codex 版本基线：`codex-cli 0.146.0`（app-server protocol v2）

> **实现期修正**
>
> 落地时对本机 `codex-cli 0.146.0` 做了实测，两条原始判断不成立：
>
> 1. **不能断定 `runtimeWorkspaceRoots` / `permissions` 被丢弃。** 这些字段在二进制中
>    以精确字符串存在；而 app-server 对**任何**未知字段都静默接受（实测发送
>    `__bogus_probe_field` 同样返回成功），因此从外部无法区分「支持」与「忽略」。
>    这些字段予以保留，但在代码与文档中明确标注为纵深防御、不可作为依据。
>    仅移除了二进制中确实不存在的 `persistExtendedHistory`。
> 2. **`approvalPolicy` 不应改为 `granular`。** 本客户端没有审批请求处理器，任何
>    可能触发审批的策略都会让 turn 挂起到超时。保持 `never`，人工确认发生在 ECOS
>    合同层。
>
> 另有一项实测发现强化了本文的核心论点：本机启动 app-server 时报
> `Codex's Linux sandbox uses bubblewrap and needs access to create user namespaces`，
> 即沙箱在开启 AppArmor 限制的 Ubuntu 上可能根本不生效。**沙箱不能作为安全边界，
> 类型化提案链路才是**——这正是本文主张的方向。
>
> 域名白名单未实现：Codex 侧没有找到可验证的机制，宁可不做，也不上一个不起作用的
> 安全控制。

## 1. 结论先行

当前 Agent 的权限设计存在方向性错误：**沙箱层面没有真正限制住，产品层面又把最常用的能力关掉了**，两头都没拿到。

本文提出用**按资产类型分权**替代现有的按目录/沙箱档位分权：

- Codex 沙箱**永久保持只读**，不给任何文件写权限。
- 所有写操作通过**类型化补丁（typed patch）**表达，经本地校验与用户确认后由 GUI/ECC 执行。
- 放开的是**参数覆盖面**和**证据感知面**，不是沙箱权限。

核心论点：typed patch 比路径白名单更能表达「可以改参数，不能改源码」这条边界。路径白名单说的是「这个目录你能写」，写什么内容不受控；typed patch 说的是「你只能提交 `knob_id` + `value`」，结构上就够不到源码和工程结构。

## 2. 现状实测

以下均为对当前代码与 Codex 0.146.0 协议 schema 的实测结果。

### 2.1 声称的只读边界不成立

> 本节结论仍然成立，但论据已按实测更换（原论据「字段不存在」不成立，见开头修正）。

实测 app-server 对未知字段的处理：发送 `__bogus_probe_field` 到 `thread/start` 与
`turn/start` 均返回成功。**协议不校验未知字段**，因此传入一个字段并不代表它被采纳，
从客户端侧无法验证 `runtimeWorkspaceRoots` / `permissions` 是否真的生效。

同时，Codex 的 Linux 沙箱依赖 bubblewrap user namespace；本机启动时直接报错
`needs access to create user namespaces`。也就是说沙箱本身在常见发行版配置下可能不生效。

Codex 的 `read-only` 沙箱语义是**全盘可读、不可写**，不存在读边界概念。因此 README 中「项目根目录是 Codex 可读取建议的边界」在沙箱层面不成立——该边界只存在于 prompt 文字约束和 `_validated_recommendation` 的事后校验中。

结论：不要在文档中把它描述为沙箱隔离；它是提示词约束加输出校验。两条独立的实测
（未知字段静默接受 + 沙箱可能不生效）都指向同一个结论：**边界必须建在类型化提案
链路上**。

### 2.2 参数修改实际只覆盖 7 个 knob

「修改参数（只保存）」的可用集合是以下两个集合的**交集**：

- Python 侧 `_AUTHORIZED_KNOBS`（`parameter_authorization.py`）：仅 `place`、`CTS`、`legalization`、`route` 四个阶段，约 40 个 knob。
- TypeScript 侧 `applyParameterPatchToParametersJson`（`AIChatPanel.vue`）：硬编码 7 项映射。

```
place.target_density   -> Target density
place.target_overflow  -> Target overflow
place.cell_padding_x   -> Cell padding x
place.routability_opt  -> Routability opt flag
cts.max_fanout         -> Max fanout
route.bottom_layer     -> Bottom layer
route.top_layer        -> Top layer
```

不在映射表中的 knob 命中 `if (!key) continue` 被**静默丢弃**，随后仍上报 `succeeded`。用户在合同里确认了一项修改，实际什么都没发生，且被告知成功。

### 2.3 参数修改写入后不生效

GUI 自身的参数保存路径是「写 `home/parameters.json` → 调 `ecc.workspace.refreshConfig` → 失效 `parameters`/`home`/`step-config`/`flow` 资源」（`useParameters.ts`）。

Agent 的参数更新路径写完 `home/parameters.json` 后**直接上报成功，未调用 `refreshConfig`**。ECC 侧 `refresh_config` 会调用 `data_api.refresh_workspace_config(workspace)` 由 parameters 重新生成 step config；不调用则 step config 不更新，参数改动不进入后续执行。

### 2.4 读写面不一致

- 合同中展示的「旧值」由 Python 侧 `_current_parameter_value` 从 `config/dreamplace.json`、`config/cts_default_config.json`、`config/rt_default_config.json` 读取。
- 实际写入落在 `home/parameters.json`。

两者不同步时，合同展示的 `旧值 → 新值` 中的旧值不可信。

另外 GUI 保存使用 4 空格缩进，Agent 使用 2 空格，每次 Agent 改参数都会产生整文件 diff。

### 2.5 可改参数被错误地耦合到「阶段已完成」

`GuiWorkspaceRerunResolver.parameter_values` 要求 `target_step in source.allowed_stages`，而 `allowed_stages` 来自 `flow.json` 中 `state == "Success"` 且能定位到产物文件的阶段。

这导致：**跑完 place 之前，一个参数都改不了。**

「重跑必须有完成证据」是正确约束，应当保留；「改参数必须有完成证据」没有依据，应当解除。这是两件事被耦合在了一起。

### 2.6 创建时可设、创建后不可改

`workspace_setup.py` 在创建 workspace 时写入的参数包含 `clock`、`frequency_max`、`max_fanout`、`die_area_mode`、`margin`、`utilitization`、`target_density`、`target_overflow`、`top_module`。

这些字段在创建后全部无法通过 Agent 修改。它们不在任何 `_AUTHORIZED_KNOBS` 中，且其命名（如 `frequency_max`）不满足 `knob_id` 正则 `^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$`（要求含点分隔）。

频率、die area、utilization、max fanout 恰是用户最常调整的参数。

### 2.7 联网被关闭，且关的是最无效的一条通道

联网存在三条独立通道：

| 通道 | 现状 | 实际作用 |
| --- | --- | --- |
| 模型 API 调用 | 始终开启 | 设计数据已经出网 |
| Hosted web tool（`web__run`） | 从未启用 | 搜索与网页读取，不经过本地沙箱 |
| Sandbox network | 强制关闭 | 仅影响沙箱内命令联网 |

`sandboxPolicy: {"type": "readOnly", "networkAccess": false}` 只作用于第三条。在只读沙箱中本就无法安装或写入任何内容，关闭它带来的安全收益接近于零，却造成「Agent 是离线的」这一错误认知。

真实的数据边界是「哪些内容进入 prompt」，该边界已被跨越。

### 2.8 未使用的 Codex 权限原语

0.146.0 已提供但当前完全未使用：

- `WebSearchMode`：`disabled` / `cached` / `indexed` / `live`
- `WebSearchToolConfig.allowed_domains`：域名白名单
- `AskForApproval.granular`：`sandbox_approval`、`rules`、`mcp_elicitations`、`request_permissions`、`skill_approval`
- `SandboxPolicy.workspaceWrite`：`writableRoots`、`networkAccess`、`excludeSlashTmp`
- `ThreadStartParams.config`：`additionalProperties: true`，可注入完整 Config

另外 `-c mcp_servers={}` 会静默清空用户在 `~/.codex/config.toml` 中配置的 MCP 服务，无任何提示。

## 3. 设计原则

**权限边界按资产类型划分，不按目录或沙箱档位划分。**

推论：

1. Codex 沙箱固定为 `readOnly`，不随功能档位变化。
2. 写能力不通过文件系统授予，只通过类型化补丁授予。
3. 放开能力 = 扩大补丁覆盖的参数集合 + 扩大只读证据的感知面。
4. 每个可写参数必须有值域校验。值域校验是实际的安全网，比沙箱有效。
5. 用户确认环节不因档位提升而省略。

## 4. 资产分级

| 资产 | 权限 | 保证机制 |
| --- | --- | --- |
| RTL / filelist / SDC 源文件 | 永不可写 | 沙箱只读 + 无文件写工具 |
| PDK 内容 | 永不可写 | 同上 |
| `project.json`、workspace 目录结构 | 不可改动既有结构 | 同上 |
| 已完成阶段产物 | 永不可写 | 同上，保证可追溯性 |
| 新建 workspace / project | 可创建 | 走既有合同确认链路 |
| `home/parameters.json` 全局参数 | 可写 | typed patch + 值域校验 + 合同确认 |
| step config 参数 | 可写 | 同上，经 ECC `sync_config` |
| flow 起止阶段 | 可写 | 同上 |
| 隔离 rerun workspace 内部 | 可写 | 目标为新建目录，不覆盖 source |

关于「工程的建立」：**新建允许**（当前操作 1 与操作 5 的行为，保留），**改动既有结构不允许**——不重命名、不删除、不覆盖 `project.json`、不调整目录布局。

## 5. 参数写入面统一设计

### 5.1 两个参数面

ECOS 存在两套参数存储：

- `home/parameters.json`：全局设计参数，ICS55 扁平模板。字段如 `Clock`、`Frequency max [MHz]`、`Max fanout`、`Core.Utilitization`、`Core.Margin`、`Die.Size`、`Target density`、`Target overflow`、`Cell padding x`、`Routability opt flag`、`Bottom layer`、`Top layer`。
- `config/*.json`：每步工具配置，如 `dreamplace.json`、`cts_default_config.json`、`rt_default_config.json`。

ECC 提供双向同步：

- `refresh_config`：parameters → step config（`data_api.refresh_workspace_config`）
- `sync_config`：step config → parameters，若 parameters 发生变化则再执行一次 refresh（`data_api.sync_workspace_config_to_parameters`）

部分字段在两个面同时存在（`Target density`、`Target overflow`、`Cell padding x`、`Routability opt flag`）。

### 5.2 写入规则

1. 补丁只描述逻辑 knob，不描述文件路径。
2. 由**单一映射表**决定每个 knob 落在哪个面、哪个 key。该映射表必须是唯一事实来源，Python 与 TypeScript 侧共用同一份定义，不允许两侧各自硬编码。
3. 落在 `home/parameters.json` 的改动，写入后**必须调用 `refreshConfig`**。
4. 落在 `config/*.json` 的改动，写入后**必须调用 `syncConfig`**。
5. 未知 knob 必须**报错**，不得静默跳过。
6. 写入格式与 GUI 保持一致（4 空格缩进），避免无意义 diff。
7. 合同展示的「旧值」必须从该 knob 的**实际写入面**读取。

### 5.3 knob 命名空间扩展

现有前缀 `place.` / `cts.` / `legalization.` / `route.` 保留。新增用于全局参数的前缀：

- `design.clock`、`design.frequency_max`、`design.max_fanout`、`design.top_module`
- `floorplan.utilitization`、`floorplan.margin`、`floorplan.die_width`、`floorplan.die_height`、`floorplan.aspect_ratio`、`floorplan.die_area_mode`

命名需满足 `knob_id` 正则（至少一个点分隔）。

### 5.4 值域校验

每个新增 knob 必须在 `_validate_value` 中登记约束。参数写错导致 flow 失败是扩大覆盖面的**主要实际风险**，安全风险次之。

示例约束：

- `floorplan.utilitization`：`0 < v <= 1`
- `design.frequency_max`：`v > 0`
- `design.max_fanout`：整数，`v >= 1`
- `floorplan.die_width` / `die_height`：`v > 0`，上界依 PDK 而定

### 5.5 解除与完成证据的耦合

`parameter_values` 不再要求 `target_step in allowed_stages`。改为：

- **改参数**：不要求完成证据，读取当前值即可；若某 knob 在配置中不存在则该 knob 不可用。
- **重跑**：保留 `allowed_stages` 约束不变。

## 6. Codex 侧配置

### 6.1 沙箱与审批

```
sandboxPolicy: {"type": "readOnly", "networkAccess": false}
```

固定不变，不随档位调整。

固定不变，不随档位调整。

~~`approvalPolicy` 从 `never` 改为 `granular`~~ —— **已否决**。本客户端没有审批请求
处理器，`granular` 下 Codex 发出的审批请求无人应答，turn 会挂起到 150 秒超时，属于
功能回退。保持 `never`；人工裁决点放在 ECOS 合同确认环节，那里用户看得到具体改动内容，
比在 Codex 层裁决一个孤立的文件写请求信息量更大。代码中已就此写明原因，并有测试防止
被改回。

### 6.2 协议参数

只移除 `persistExtendedHistory`（二进制中确实不存在）。`runtimeWorkspaceRoots`、
`permissions`、`approvalsReviewer` 等予以保留：无法证明其被忽略，保留无害，但已在
代码注释与 README 中标注为纵深防御、不可作为安全依据。

只读边界改为在 prompt 与输出校验两层表达，README 中关于「沙箱边界」的描述已同步修正。

### 6.3 MCP

`-c mcp_servers={}` 保留为默认值（避免用户 MCP 配置引入不可控行为），但需要：

- 在 Agent 面板注明「用户 MCP 配置在 ECOS 内不生效」
- 提供设置项允许显式开启

## 7. 联网设计

### 7.1 只开 hosted web tool

启动 app-server 时显式传入配置项（实现如此，与原草案的 `thread/start config` 写法不同）：

```
codex app-server -c mcp_servers={} -c tools.web_search=<true|false>
```

由环境变量 `ECOS_AGENT_CODEX_WEB_SEARCH` 控制，**默认关闭**。沙箱 `networkAccess`
保持 `false`；hosted web tool 不经过本地沙箱，两者互不冲突。

**域名白名单未实现。** 草案中的 `tools.web_search.allowed_domains` 在 0.146.0 中找不到
可验证的支持证据。上一个不生效的安全控制比没有更糟——它会让人以为查询去向受限。
需要限制去向的部署应在企业网络层面处理。

### 7.2 联网解决的具体问题

- **EDA 报错解读**：flow log 中 OpenROAD / Yosys / OpenSTA 的报错，多数答案只存在于 GitHub issue。这是设计状态诊断能力的必要输入。
- **PDK 语义查询**：corner 命名、LEF/LIB 字段含义、standard cell 特性。
- **开源 IP 检索**：`resourceManagerService` 已在访问 `ecos-registry` 与 GitHub，Agent 需要同等感知面才能参与。
- **方法学参考**：参数调整的业界经验不存在于 workspace 内。

### 7.3 风险与对策

**Prompt injection。** 网页内容进入上下文后，模型输出仍需通过 typed JSON schema、路径校验、合同展示与用户确认。网页内容只能影响「建议什么」，无法影响「能做什么」。这是本权限模型的结构性优势。

唯一注入面是 `summary` 字段（512 字符自由文本，直接渲染）。渲染时不解析 markdown 链接。

**查询内容外泄。** 模型可能将设计名、net 名、RTL 片段写入搜索 query。对策：默认关闭，
需显式开启；开启后每次检索的 query 都会作为活动进度显示在聊天中（`_readonly_activity`
新增 `web_search` 分支）；`ECOS_AGENT_CODEX_DIAGNOSTICS_PATH` 可开启完整 RPC 审计轨迹
（默认关闭，因为轨迹本身含设计名与路径）。

**离线环境。** fab 与企业内网常无外网。web search 是模型可选调用的工具而非硬依赖，
不可用时 turn 照常完成，只是少一个信息源；默认关闭本身就是离线环境的正确配置。

**代理兼容性。** 用户可能配置自定义 `base_url` 与 `disable_response_storage = true`，hosted web tool 在此组合下是否可用需实测，失败时按离线降级处理。

## 8. 可观测性与审计

### 8.1 活动可见性

`codex_rpc.py` 的 `_readonly_activity` 仅匹配 `commandexecution` 类型的 item，web search 相关事件将完全静默，用户会看到 Agent 无响应而不知其在执行什么。

需增加 `webSearch` 分支，在 Tool 卡中展示查询内容与访问域名。

依据：`PRODUCT.md` —— Make the current state and next valid action immediately visible。

### 8.2 审计

`_RpcDiagnostics` 此前是**死代码**：`diagnostics_path` 从未被任何调用方传入。已接到
`ECOS_AGENT_CODEX_DIAGNOSTICS_PATH`，开启后落 JSONL 完整 RPC 轨迹。

**默认关闭**（与草案的「默认开启」不同）：轨迹包含设计名与 workspace 路径，不应在
用户未要求时写盘。用户可见的透明度由 8.1 的活动进度承担，那是默认开启的。

## 9. 非目标

本设计明确不做以下事项：

- 不给 Codex 沙箱写权限
- 不允许 Codex 直接执行 shell 或 ECC 命令
- 不允许修改 source workspace 的既有结构
- 不允许在缺少 ECC 终态证据的情况下宣称流程成功
- 不开启沙箱全网访问

## 10. 落地情况

**阶段一：修复既有缺陷（不涉及权限放开）** — 已完成

1. ✅ 统一 knob 映射为单一事实来源（新增 `knob_registry.py`），合同直接携带解析后的
   写入目标，GUI 不再持有第二份映射表；未知 knob 报错而非静默跳过
2. ✅ 参数写入后按写入面调用 `syncConfig`（先）与 `refreshConfig`（后）
3. ✅ 合同旧值从 ECC 规范面读取，step config 尚未生成时回退到 `parameters.json`
4. ✅ 写入缩进由文件现有格式推断，不再产生整文件 diff
5. ✅ 协议参数按实测处理（见 6.2），README 边界描述已修正

**阶段二：扩大参数覆盖面** — 已完成

6. ✅ 新增 `design.` 与 `floorplan.` 命名空间，共 9 个全局 knob
7. ✅ 映射统一由 `knob_registry.py` 承担，前缀分发逻辑已移除
8. ✅ 新 knob 均登记值域校验
9. ✅ 解除改参数与完成证据的耦合（`stage_parameter_values`）

**阶段三：联网与感知面** — 已完成（域名白名单除外）

10. ✅ hosted web search，默认关闭，`ECOS_AGENT_CODEX_WEB_SEARCH` 开启；❌ 域名白名单（无可验证机制）
11. ✅ `_readonly_activity` 新增 web search 分支，展示查询内容
12. ✅ 审计接线可用，默认关闭（理由见 8.2）
13. ✅ 离线即默认配置；代理兼容性无需特殊处理（工具不可用不影响 turn）

**阶段四：审批策略** — 已核实并否决

14. ❌ `approvalPolicy` 保持 `never`（理由见 6.1）
15. ⬜ MCP 设置项与说明 —— 未做，需要 GUI 设置面板改动，独立于本次范围

## 11. 待验证事项

已解决：

- ✅ 未知协议字段在 0.146.0 下被静默接受（实测 `__bogus_probe_field` 返回成功）
- ✅ 新增 `design.` / `floorplan.` knob 的写入面为 `home/parameters.json`，路径已在
  `knob_registry.py` 中登记
- ✅ `refresh_config` 从 `parameters.json` 重新展开 step config，因此 step-config 类
  knob 必须先 `sync_config` 再 `refresh_config`——实现已按此顺序，并有测试锁定

仍待验证（需要真实 workspace 与真实 Codex 会话）：

- hosted web tool 在自定义 `base_url` 代理与 `disable_response_storage = true` 组合下是否可用
- 新增 9 个全局 knob 改动后跑通完整 flow 的端到端效果（尤其 `Die.Size` / `Core.Margin`
  这类数组下标写入，ECC 是否按预期消费）
- 未知协议字段是否在其它 Codex 版本下也被静默忽略，或存在版本会报错
