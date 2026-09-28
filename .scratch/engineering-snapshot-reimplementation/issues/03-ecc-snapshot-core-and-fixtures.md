# 03: ECC 新 snapshot 核心与 canonical fixtures

**What to build:** ECC 侧重新实现的 snapshot 生产/读取核心可用：workspace 创建、提交、读取都走新形态——身份段（schemaVersion/workspaceId/workspaceRevision/cause）、flow、parameters、纯索引 artifacts。提交协议为全量重建（无 dirty-set 协议，ADR-0006），不内联任何 payload、不计算任何哈希（ADR-0010），compact JSON 序列化，临时文件 + 原子替换保留，写入失败保留旧文件。schemaVersion 语义为破坏性变更计数器（ADR-0005）。canonical fixtures 目录建立：新契约的 valid/invalid 样本各一组，ECC 测试断言生成物与 fixtures 一致。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 新形态 snapshot 可 create/commit/read round-trip，字段形状与 fixtures 逐字节一致
- [ ] 构建过程无内联 payload、无 artifact 哈希；连续多次提交耗时与 workspace 产物总量无关
- [ ] 原子写：注入超限内容时写入失败且旧 snapshot 文件保留
- [ ] schemaVersion 不识别的读取 fail-closed，报 rebuild 类稳定错误码
- [ ] fixtures 位于 ECC 仓库正式 fixture 目录，供 GUI 经 submodule 只读消费

依据：ADR-0005、ADR-0006、ADR-0010、`docs/specs/engineering-snapshot-reimplementation.md`。
