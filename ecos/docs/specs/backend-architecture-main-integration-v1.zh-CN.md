---
status: accepted
---

# ECC Backend Architecture Main Integration v1

## 目标

在 ECC 独立仓库中，以最新 `origin/main` 为代码基线重建
`ekko/refactor-ecc-cli-integration`，只迁移 ECOS Studio 当前需要的
headless backend 能力和 CLI Step 参数过滤修复。最终 ECC PR 应尽量只展示
相对 main 的必要架构差异，不携带旧预集成分支已经被 main 取代的实现。

父仓库 `ecos-studio-electron` 的 `ekko/refactor-backend-architecture` 不参与
这次历史重建。其现有提交、GUI/Runtime Adapter 工作树修改和 ECC gitlink 在
ECC PR 合并并发布前保持不变。

## 决策优先级

冲突和语义差异按以下顺序判断：

1. 本 Spec 和仍有效的 accepted 产品/架构决策；
2. 最新 ECC `origin/main` 的代码结构与未被显式取代的行为；
3. 旧重构提交仅作为待迁移行为的证据，不作为整文件或完整行为基线。

双方修改同一文件时，以 main 当前模块结构为底稿，手工补入必要行为。除明确
删除的 ECC Runtime/RPC 外，不用旧分支整文件覆盖 main，不恢复 main 后续已经
拆分、修复或删除的实现和测试。

## 必须保留的 Main 行为

- 保留 main 现有 CLI 命令、公开参数名、校验、报告、文档布局和主要输出语义。
- 保留 main 的 Workspace 格式识别、legacy migration 和对应回归测试；不新增
  第二套兼容 parser、双向转换或 Studio-owned migration。
- 保留 main 当前的 Flow completion 语义。Synthesis LEC 失败不恢复为可继续的
  `Warning` terminal state。
- 保留 main 的 manifest、Step directory、Workspace input、SDC 和 Signoff 模块
  拆分，以及合并后进入 main 的 RCX、Yosys、依赖和版本修复。
- 新 headless API 必须复用 main 已有的 Workspace 加载和迁移入口，不绕过兼容
  路径，也不把迁移职责复制到 Runtime Adapter。

## 迁移范围

只迁移以下可观察能力：

- `fix-cli-step-parameter-filters` 的 Step 参数过滤行为及其测试；
- Workspace Spec 描述、校验、创建、打开和更新；
- Project Manifest 的 creator-independent 读写边界；
- Workspace 配置读取和更新、Step 配置读取和更新；
- Workspace Revision、Engineering Snapshot、stale result 和 rerun preparation；
- execution readiness、Workspace Binding、headless execution 和 Flow lifecycle；
- QoR、analysis 和 Signoff 的 headless interface；
- ECOS Studio Runtime Adapter 当前调用的 ECC public data/engine/project APIs；
- 删除由 ECOS Studio Runtime Adapter 取代的 ECC JSON-RPC、transport、server 和
  runtime orchestration 实现。

不迁移没有当前消费者、没有 accepted contract 或只是旧分支内部形态的实验性
抽象。是否迁移一个旧实现，以当前 Runtime Adapter 调用、CLI 用户行为或聚焦
领域测试能否证明其必要性为准。

## 提交结构

目标分支按依赖顺序形成五组可独立审查的提交：

1. CLI Step 参数过滤修复；
2. Workspace/Project model 与 public contract；
3. Revision、Snapshot 和配置更新；
4. execution、Flow、QoR、analysis 和 Signoff headless APIs；
5. CLI 接入，并删除 ECC Runtime/RPC。

测试与对应实现放在同一提交，不创建集中补测试提交。文档跟随改变其 contract
的实现提交。若 main 当前模块边界要求把某组机械拆成多个提交，可以继续细分，
但不得把五组压成一个总提交，也不得提交暂时破坏 ECC CLI 的半套 contract。

## Git 工作流

1. 获取最新 ECC `origin/main`，记录实际基线提交。
2. 为旧 `ekko/refactor-ecc-cli-integration` HEAD 创建仅本地的备份引用。
3. 放弃当前未提交的机械 merge 结果，从最新 `origin/main` 重建目标分支。
4. 按上述五组提交迁移和验证；旧 `77b8048` 等提交只作为实现证据。
5. 完整验证通过并检查最终 diff 后，才使用 `--force-with-lease` 更新远程目标
   分支；不创建额外远程备份分支。
6. ECC PR 合并并发布后，父仓库重构分支才更新 ECC gitlink。父仓库 PR 不得指向
   未发布的 ECC commit。

## 验收

必须同时满足：

- ECC `origin/main` 对当前改动路径要求的所有非打包 CI 检查继续通过；
- 本 Spec 所列迁移能力的 ECC 聚焦测试通过；
- ECOS Studio Runtime Adapter 与新 ECC public APIs 的集成和 cross-creator 测试
  通过；
- `git diff origin/main...ekko/refactor-ecc-cli-integration` 只包含上述迁移范围，
  没有旧依赖版本、生成文件、缓存、意外 submodule gitlink 或被覆盖的 main 修复；
- Ruff format/lint、版本一致性和 `git diff --check` 通过。

真实 RTL2GDS、LEC、STA、Signoff 或打包检查是否需要运行，以 ECC scoped
`AGENTS.md`、CI 路径条件和实际变更为准。未运行的相关检查及残余风险必须在 PR
中逐项记录。

## 明确不做

- 不恢复旧重构分支的 strict Workspace recreation 策略；
- 不恢复 synthesis LEC `Warning` continuation；
- 不维护 main Workspace 格式与旧重构 Descriptor 之间的双模型兼容层；
- 不重写父仓库 `ekko/refactor-backend-architecture` 的历史；
- 不在验证前 push、更新父仓库 gitlink 或创建 PR；
- 不借集成进行无消费者的抽象、通用 adapter 或与目标无关的重构。

## 当前状态

本文只记录已确认的集成策略。当前 ECC 预集成 worktree 中的机械 merge 结果不是
实现候选，尚未据此创建 merge commit。开始实现、重建分支、提交、push 和创建
PR 需要单独进入实施步骤。
