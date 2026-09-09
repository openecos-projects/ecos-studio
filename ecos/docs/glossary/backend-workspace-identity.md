---
status: accepted
---

# Backend Workspace Identity glossary

本词汇表只收录 Config Hub 与创建时 Top Module 确认方案锁定后的新术语。Workspace、Workspace Descriptor、Workspace Configuration、Workspace Handle、Workspace Revision、Workspace Parameter、Step Option、Parameter Catalog、Engineering Snapshot 仍沿用既有 Backend domain glossary。

先前草案中的 In-place Identity Update 与 Identity-wide Stale 已撤回：本方案不再为纠正 Top Module 提供创建后的身份写入。

## Workspace Identity

Workspace 的已提交设计身份：至少包括 Design name、Top Module、Clock 和 PDK family。它是 Workspace Descriptor 的一部分，不是 Parameter Catalog 里的 Step Option，也不是跨 Step Workspace Parameter。

Top Module 在创建 Workspace 时由用户从发现到的 module 候选中确认。同一份设计输入路径集合上提交后只读。纠正同一输入上的 Top Module 不走轻量配置保存，也不走就地身份写入。Config 中心只展示已提交的 Top Module，不提供改名入口。Update Workspace 只有在更换 RTL、filelist 或 `origin_verilog` **路径** 时才重新发现并再确认；未换路径时 Spec Setting 以只读文本展示已提交名字，不是禁用下拉。打开已有 Backend Workspace、Home、Step Configuration 不重扫、不因当前文件缺少该名字而警告。不监视同一路径上的文件内容。本轮只锁 Backend Workspace 的 Top Module；Clock、Design name、PDK family 仍可经结构性 Update Workspace 修改。Frontend Workspace 创建、`cpu_top_module` 和 ecc-fe filelist 不在本轮。

## Create-time Top Module Confirmation

New Workspace 向导在 Spec Setting 用候选下拉确认 Top Module，并预选启发式认为的值。进入该步或 Design Files 路径变化时发现一次。路径变化后：当前选中仍在新列表里则保留，否则用新启发式。只改 Design Name 且列表不变时：若当前值仍是建议项则按新 Design Name 更新建议，用户已另选则不覆盖。只要有文件读出文本且发现完整，用户必须从该列表确认一项；列表外手填、零候选、可读但没有 `module` 都不能提交。部分文件读失败则整次发现失败，回到 Design Files。发现集合里每一个 HDL 路径都读不出文本，或扫描触顶/超时未完成时，提示原因并允许手填 Verilog 标识符（`[A-Za-z_][A-Za-z0-9_$]*`）。空 filelist / 未选 RTL 是 Design Files 未就绪，不是手填。触顶不是截断列表后继续。创建成功后，该 Top Module 只读。不新增向导步骤。

这不是静默填写。启发式可以预选，但不能在用户未确认时提交。Agent 对话不再手填 Top Module。Agent GUI review 在现有确认面板展示同一套候选下拉；setup 合同仍为 v2，`top_module` 可空或只带启发式默认，确认后再写入创建请求。Agent 不能代用户确认，也不能提交列表外的名字。发现由 Electron desktop 服务完成，向导和 Agent GUI review 共用该本地结果；Renderer 不解析 HDL。ECC 创建契约本轮不增加 “topModule 必须出现在提交的 HDL 中” 的校验。

## Discovered Module Candidate

从这份 Workspace 创建时将交给 ECC 的 HDL 中解析出的 `module` / `macromodule` 名（含可选 `(* ... *)` 属性前缀；不含 `interface`、`package`、VHDL `entity`）。不做 `ifdef` 预处理，互斥分支里的声明都进入候选。RTL 起步时 Design Files 在离开该步前强制 RTL 与 filelist 二选一；项目默认值两份都有时只预填 filelist。发现只扫将提交的那一份。Floorplan 及之后扫 `origin_verilog`。不扫 PDK Verilog。候选列表去重后完整展示，可搜索过滤，不截断；启发式默认项置顶并标明建议。启发式只决定默认选中项：从已有 Workspace 派生时优先源已提交 Top Module（仍须在新列表中），然后 Manifest `top_module`、Design Name、唯一未被其他已发现 module 以 `Foo inst (` / `Foo #(...) inst (` 实例化的名字，再按文件名接近度排除 testbench。不把候选列表外的单元库名或 `interface` 算作实例化。源 / Manifest / Design Name 匹配大小写敏感；提交值永远是发现到的精确标识符。不隐藏其余候选。
