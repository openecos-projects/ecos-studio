---
status: implemented
---

# Backend Create-time Top Module Confirmation v1

本文定义 Backend Workspace 创建时的 Top Module 发现与确认。目标是在提交 Workspace Identity 之前让用户从将交给 ECC 的 HDL 中确认顶层模块，从而同一份设计输入上不再提供创建后的 Top Module 编辑。本文不恢复旧 Config 页面，不放宽 ECC 对身份字段的轻量更新拒绝，也不把 Config 中心做成 Top Module 编辑器。

产品决策见已接受的 [ADR 0046](../adr/0046-top-module-is-confirmed-at-create.md) 与 [Backend Workspace Identity glossary](../glossary/backend-workspace-identity.md)。可发现的身份摘要壳仍由后续 [Backend Workspace Config Hub v1](./backend-workspace-config-hub-v1.zh-CN.md) 交付。已实现的配置表面见 [Backend Workspace Configuration Surface v1](./backend-workspace-configuration-surface-v1.zh-CN.md)。

本文只作为本地实现规格：不发布 Issue、不应用 triage 标签、不 push、不创建 PR。

## Problem Statement

Studio 用户在 New Workspace 向导里把 Top Module 当成必填手填。输错之后没有安全的就地纠正：轻量配置保存会弹回或被 ECC 拒绝，结构性 Update Workspace 又是六步向导加 Backup。用户真正要的是创建时就把名字定对，而不是创建后再发明一条身份写入。

当前向导不扫将编译的 HDL。默认值来自 Project Manifest 或空白占位。GUI 目录扫描只列文件。Agent 启发式只读一个 RTL 文件并取第一个 `module`。ECC 创建契约只要求非空 `topModule`。多文件设计和 filelist 很容易把错的顶层锁进 Workspace Identity。

同一输入上改 Top Module 会把先前 Engineering Snapshot 整份作废，或走目录替换。那些问题在创建时确认之后不再需要解决。换 RTL、filelist 或 `origin_verilog` 路径仍是结构性替换，必须再确认顶层，因为那已经不是同一份输入。

## Solution

Backend New Workspace 在 Spec Setting 用候选下拉确认 Top Module。Electron desktop 服务从这份向导将交给 ECC 的 HDL 发现全部 `module` / `macromodule`，预选启发式认为的顶层，并要求用户确认列表中的一项。创建成功后，同一输入路径集合上 Top Module 只读。纠正同一输入上的错误走 New Workspace。Update Workspace 只在输入路径变化时重新发现并再确认；未换路径时 Spec Setting 以只读文本展示已提交名字。

这不是静默填写。启发式只预选，不提交。Agent 对话不再手填 Top Module；Agent GUI review 使用同一套下拉。发现失败时：部分文件读失败则挡住创建；全部读失败或扫描触顶/超时时提示原因并允许手填合法 Verilog 标识符。

## User Stories

1. 作为 Studio 用户，我希望创建 Workspace 时从发现到的 module 列表确认 Top Module，从而不必手打一个可能拼错的名字。
2. 作为 Studio 用户，我希望列表默认选中启发式认为的顶层，从而多数设计只需确认而不必翻找。
3. 作为 Studio 用户，我希望仍能看到全部候选，从而默认选错时我可以改选真正的 top。
4. 作为 Studio 用户，我希望候选列表可以搜索过滤，从而大 SoC 的长列表仍然可用。
5. 作为 Studio 用户，我希望长列表不被截断，从而真正的 top 不会藏在“前 50 个”之外。
6. 作为 Studio 用户，我希望建议项置顶并被标明，从而我知道哪一项是产品认为的 top。
7. 作为 Studio 用户，我希望确认仍在 Spec Setting，从而不必多走一个向导步骤。
8. 作为 Studio 用户，我希望进入 Spec Setting 时已经完成发现，从而我看到的是当前 Design Files 对应的列表。
9. 作为 Studio 用户，我希望改了 Design Files 路径后再进入 Spec Setting 时列表会更新，从而旧候选不会冒充新输入。
10. 作为 Studio 用户，我希望完整发现时不能手填列表外的名字，从而 LUT4A 这种 typo 进不了创建。
11. 作为 Studio 用户，我希望零候选时不能创建，从而没有 `module` 的输入不会被当成成功身份。
12. 作为 Studio 用户，我希望零候选时被带回 Design Files，从而我去补文件而不是在 Spec Setting 硬填。
13. 作为 Studio 用户，我希望 RTL 起步时 Design Files 强制 RTL 与 filelist 二选一，从而发现扫的就是 ECC 会编译的那一份。
14. 作为 Studio 用户，我希望项目默认值同时有 RTL 和 filelist 时只预填 filelist，从而向导不会先填两份再悄悄丢掉一份。
15. 作为 Studio 用户，我希望我仍能在 Design Files 改成另一份输入，从而预填不是锁死。
16. 作为 Studio 用户，我希望从 Floorplan 及之后起步时对 `origin_verilog` 做同样的发现，从而网表顶层也要确认。
17. 作为 Studio 用户，我希望 PDK Verilog 不出现在候选里，从而单元库 module 不会冒充设计 top。
18. 作为 Studio 用户，我希望 `ifdef` 分支里的 module 都在列表中，从而产品不在没问 define 的情况下删掉一个 top。
19. 作为 Studio 用户，我希望创建成功后同一输入上不能再改 Top Module，从而身份在提交后稳定。
20. 作为 Studio 用户，我希望同一输入上选错了就开 New Workspace，从而纠正顶层不会伪装成参数 Save。
21. 作为 Studio 用户，我希望 Update Workspace 未换输入路径时 Top Module 是只读文本，从而我不会以为这是改 top 的入口。
22. 作为 Studio 用户，我希望换了 RTL、filelist 或 `origin_verilog` 路径后再确认 Top Module，从而新输入不会绑着旧顶层。
23. 作为 Studio 用户，我希望换路径后若旧名字仍在新列表里就继续预选它，从而同一设计换文件时不必重选。
24. 作为 Studio 用户，我希望旧名字不在新列表里时改用新启发式，从而失效的顶层不会被提交。
25. 作为 Studio 用户，我希望没换路径时不监视文件内容，从而改磁盘上的 `top.v` 不会突然打开身份编辑器。
26. 作为 Studio 用户，我希望打开已有 Workspace 时 Home 仍显示已提交 Top Module，从而打开动作不会重扫源码。
27. 作为 Studio 用户，我希望部分文件读失败时不能带着不完整列表继续，从而真正的 top 不会留在没读到的文件里。
28. 作为 Studio 用户，我希望全部 HDL 都读失败时看到原因并可以手填合法标识符，从而创建不会因为发现崩溃而卡死。
29. 作为 Studio 用户，我希望扫描触顶或超时时看到原因并可以手填合法标识符，从而超大 filelist 不会把向导锁死。
30. 作为 Studio 用户，我希望触顶后看到的不是截断列表，从而我不会以为“全部 module”其实只扫了一部分。
31. 作为 Studio 用户，我希望手填必须是 Verilog 标识符，从而空格、路径和带点的名字进不了逃生口。
32. 作为 Studio 用户，我希望可读但没有 `module` 时仍不能手填，从而“看见了源码但认不出来”不会退回 typo 入口。
33. 作为 Studio 用户，我希望空 filelist 或未选 RTL 被当成 Design Files 未就绪，从而那不是手填逃生口。
34. 作为 Studio 用户，我希望改 Design Name 且我还没另选时建议跟着更新，从而默认能跟上设计名。
35. 作为 Studio 用户，我希望我已经另选过候选后改 Design Name 不覆盖我的选择，从而启发式不会抢走确认。
36. 作为 Studio 用户，我希望从已有 Workspace 派生时默认优先源已提交 Top Module，从而后续 Flow 沿用已经确认过的顶层。
37. 作为 Studio 用户，我希望源名字不在新网表里时不要锁死它，从而派生仍能改选新候选。
38. 作为 Agent 用户，我希望聊天里不再被问 Top Module Name，从而确认只发生在可见的候选列表。
39. 作为 Agent 用户，我希望 GUI review 面板有同一套候选下拉，从而我不必为了选 top 再走六步向导。
40. 作为 Agent 用户，我希望选中列表项之前不能确认创建，从而 Agent 不能代我锁死身份。
41. 作为 Agent 用户，我希望合同仍是现有 setup v2，从而这次不升级跨进程协议。
42. 作为工程师，我希望发现跑在 Electron desktop 服务，从而 Renderer 不解析 HDL。
43. 作为工程师，我希望 GUI 向导和 Agent review 共用同一个发现 API，从而两套创建路径不会各写一套正则。
44. 作为工程师，我希望 Agent 旧的单文件 `infer_design_defaults` 不再当产品发现路径，从而多文件设计不会取第一个 module。
45. 作为工程师，我希望不新增 Runtime Adapter 发现协议，从而这次不改 ECC 跨进程契约。
46. 作为工程师，我希望 ECC 继续只要求非空 `topModule`，从而本轮不把启发式做成 ECC 校验。
47. 作为工程师，我希望轻量 `workspace.updateConfiguration` 继续拒绝 Top Module，从而 #215 那种保存弹回不会换一种形式回来。
48. 作为工程师，我希望不发明就地身份写入，从而不需要 Backup 或整份 Snapshot 作废规则来改 top。
49. 作为 Frontend 用户，我希望这篇 Backend spec 不改变 Frontend 创建和 `cpu_top_module`，从而前后端顶层规则保持分离。
50. 作为维护者，我希望 Config 中心这轮不一起做，从而创建路径可以单独落地。
51. 作为维护者，我希望这篇 spec 只作为本地实现规格，从而不依赖 Issue 或 triage 标签才能开工。

## Implementation Decisions

- 本轮只覆盖 Backend Workspace 的 New Workspace、输入路径变化时的 Update Workspace、以及 Agent GUI review。Clock、Design name、PDK family 仍按现有创建填写和结构性 Update Workspace 处理。不发现 clock port。Frontend Workspace、`cpu_top_module`、ecc-fe filelist 不变。
- 发现集合是这份向导将交给 ECC 的 HDL：RTL 起步为已选 RTL **或** filelist 展开源，二者互斥；Floorplan 及之后为 `origin_verilog`。不扫 PDK Verilog。filelist 按 ECC 规则只收直接 HDL 路径，不展开 `-f` / `-v` / `-y`。`.gz` 先解压再解析。
- Design Files 在离开该步前强制 RTL 与 filelist 二选一。Project Manifest 同时带两份时只预填 filelist。用户仍可改选另一份。
- 去掉注释后匹配 `module` 与 `macromodule`，允许可选 `(* ... *)` 属性前缀。不收录 `interface`、`package`、VHDL `entity`。重名去重。不做 `ifdef` 预处理；互斥分支里的声明都是候选。
- Electron desktop 服务提供发现 API：入参为将提交的 RTL 路径或 filelist 或 `origin_verilog`，以及用于启发式的 Design Name、可选 Manifest `top_module`、可选源 Workspace `topModule`。出参为去重候选列表、启发式默认项、以及完整 / 部分读失败 / 全部读失败 / 触顶或超时状态。Renderer 只渲染下拉或逃生口，不读源文件。
- 启发式按顺序取第一个仍在列表中的：源 Workspace 已提交 Top Module（派生创建且名字仍在列表）→ Manifest `top_module` → Design Name → 唯一未被其他已发现 module 以 `Foo inst (` 或 `Foo #(...) inst (` 实例化的名字 → 未实例化名字中接近 Design Name / 文件 stem 且排除 `*_tb` / `tb_*` / `*_test` → 稳定排序的第一个未实例化名，否则第一个候选。源身份缺失则跳过该档。匹配大小写敏感；仅接近度排序可忽略大小写。提交值永远是发现到的精确标识符。实例化排名不隐藏候选。不跑 Slang / Yosys。
- Spec Setting 将手填改为可搜索下拉。建议项置顶并标明。列表不截断。不新增向导步骤。发现在进入 Spec Setting 以及 Design Files 路径变化时运行。
- 用户看见下拉后：路径变化则重发现，当前选中仍在新列表则保留，否则用新启发式。只改 Design Name 且列表不变时，若当前值仍是建议项则按新 Design Name 更新；用户已另选则不覆盖。
- 完整发现且有可读文本时，提交必须来自列表。可读但零 `module` / `macromodule` 挡住创建并回到 Design Files。部分读失败整次失败，不继续部分列表，不能手填。全部读失败或扫描触顶/超时：提示原因，允许手填 Verilog 标识符 `[A-Za-z_][A-Za-z0-9_$]*`（去首尾空白）。触顶不是截断列表。空选择不是手填。
- 创建成功后同一输入路径集合上 Top Module 只读。Home、Step Configuration、打开已有 Workspace 不重扫、不因当前文件缺少该名字而警告。不发明就地身份命令，不放宽 `workspace_structure_change_requires_update`，不让 `workspace.updateConfiguration` 接受 Top Module。
- Update Workspace 未换路径：Spec Setting 显示已提交名字的只读文本，不是禁用下拉。换了 RTL / filelist / `origin_verilog` 路径：同一控件变为下拉并再确认；旧名字仍在则预选，否则用新启发式。换路径后提交时名字必须仍在新列表中（逃生口规则同样适用）。
- Agent 对话删除 Top Module 手填 prompt。setup 合同保持 `flow-agent.workspace_setup_contract.v2`；`top_module` 可空或仅为同一发现 API 的启发式默认。GUI review 展示下拉，未选列表项前不能确认。确认后创建请求带上确认过的名字。不新增合同 v3，不打开六步向导只为选 top。
- ECC `workspace.create` / 结构性 `workspace.update` 仍只要求非空 `topModule`。本轮不增加“名字必须出现在提交的 HDL 中”的 ECC 校验，不新增 Adapter 发现协议。CLI 或直接 Adapter 调用仍可能提交 Studio 会拒绝的非空名字。
- Config 中心本轮不实现。后续壳只读展示已提交 Top Module，不提供改名入口。ADR 0045 的就地身份写入已被 0046 取代。

## Testing Decisions

- 测试只验证用户可观察行为和发现契约，不固定私有正则实现或下拉内部 DOM。最高价值 seam 有两处，都复用现有测试入口：New Workspace 向导行为，以及 Electron 发现服务（现有目录扫描测试的同类 seam）。Agent GUI review 是第三条产品入口，只断言确认规则，不重测解析。
- 向导行为测试是 prior art。扩展现有 New Workspace 行为测试：Spec Setting 在完整发现时展示候选而非自由输入；默认选中启发式项；RTL 与 filelist 不能同时带着离开 Design Files；项目默认两份都有时只预填 filelist；完整发现时列表外名字不能提交；零候选挡住并指向 Design Files；未换路径的 Update Workspace 把 Top Module 画成只读文本；换路径后要求再确认。
- Electron 发现服务测试是 prior art（现有 RTL 目录扫描测试只列文件）。新增同层测试：从 RTL 或 filelist 展开源收集 `module` / `macromodule`；解压 `.gz`；忽略 `interface` / `package`；`ifdef` 分支都保留；filelist 不展开 `-f`；部分读失败；全部读失败；触顶/超时返回不完整状态而不是截断列表；启发式顺序与大小写敏感匹配；实例化只在已发现 module 之间认 `Foo inst (` 形式。
- Agent 侧 prior art 是现有 provider 测试里的 “Top Module Name” choice。改为断言对话不再发出该 prompt；review 合同允许空 `top_module`；创建请求在 GUI 确认后才带名字。不把 Agent 单文件 `infer_design_defaults` 测成产品发现。
- 不新增 ECC、Runtime Adapter 或打开已有 Workspace 的重扫测试。若实现误把身份 Save 接到 `workspace.updateConfiguration`，应在 Renderer 入口断言该动作不存在。不恢复旧 Config 页面测试。

## Out of Scope

- 不实现 Config 中心对话框升格；那是 Config Hub spec 的后续迭代。
- 不恢复旧 `/workspace/configure` 页面或通用参数表。
- 不放宽 `workspace_structure_change_requires_update`，不让轻量配置更新接受 Top Module。
- 不发明就地身份写入、不要求 Backup 来改同一输入上的 Top Module。
- 不发现 Clock、不锁 Design name / PDK family 为创建后只读。
- 不跑 Slang、Yosys、`+define` 预处理或 elaboration。
- 不新增 Runtime Adapter 发现协议，不把“名字必须出现在 HDL 中”写进 ECC 创建契约。
- 不升级 Agent setup 合同到 v3。
- 不改变 Frontend Workspace 创建、`cpu_top_module` 或 ecc-fe filelist。
- 不在打开已有 Workspace、Home 或 Step Configuration 时重扫或警告缺失的 top。
- 不监视已选路径的文件内容变化。
- 不发布 GitHub Issue，不应用 `ready-for-agent` 或其他 triage 标签。

## Further Notes

- 术语：Workspace Identity、Create-time Top Module Confirmation、Discovered Module Candidate 见 [Backend Workspace Identity glossary](../glossary/backend-workspace-identity.md)。Workspace、Workspace Descriptor、Workspace Configuration、Workspace Parameter、Step Option、Parameter Catalog、Engineering Snapshot 仍沿用既有 Backend domain glossary。
- 相关已接受决策：ADR 0038、ADR 0039、ADR 0040、ADR 0041、ADR 0046。ADR 0045 已被 0046 取代。
- alpha.8 issue #215 的产品教训是：Top Module 不能当轻量字段 Save。本 spec 的回答是创建时确认、同一输入上只读，而不是再提供一条创建后写入。
- 完成标准：Backend New Workspace 能从将提交的 HDL 列出候选并确认；默认项为启发式 top；完整发现不能手填列表外名字；Design Files 互斥 RTL/filelist；Update Workspace 未换路径只读、换路径再确认；Agent 对话不再问 Top Module；GUI review 用同一套下拉；Electron 发现测试覆盖解析与失败/触顶语义；相关向导行为测试通过。
- 本 spec 仅保存到本地仓库，不创建 Issue、不应用 `ready-for-agent` 标签、不 push、不创建 PR。
