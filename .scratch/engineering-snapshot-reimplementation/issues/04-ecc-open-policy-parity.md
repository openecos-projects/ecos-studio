# 04: ECC 打开策略表统一四个入口

**What to build:** 无论从 legacy open、spec open、RPC open 还是 GUI 目录读取进入，同一个 workspace 的 snapshot 状态得到一致处理：snapshot 缺失时自动重建（只在文件不存在时写，永不覆盖已存在的 snapshot）；snapshot 损坏或 schemaVersion 不支持时 fail-closed 返回 `snapshot_rebuild_required`，重建只能由用户显式触发；workspaceId 与 manifest/command 元数据冲突时 fail-closed 报 identity 错误，不提供一键重建。不再有"legacy 入口吞错误以 revision 0 继续"的分裂行为。

**Blocked by:** 03（ECC 新 snapshot 核心与 canonical fixtures）

**Status:** ready-for-agent

- [ ] 缺失/损坏/旧版本/identity 冲突四种情形，从全部打开入口得到相同错误分类与错误码
- [ ] 缺失时自动重建成功，snapshot 带 `workspace.rebuild.on_open` 类 cause；已有 snapshot 永不被自动覆盖
- [ ] 损坏的 snapshot 文件在重建前保持原样（证据保留）
- [ ] 手工复制的 workspace（identity 冲突）被所有入口明确拒绝

依据：ADR-0009。
