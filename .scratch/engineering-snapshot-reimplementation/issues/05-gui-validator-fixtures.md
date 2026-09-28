# 05: GUI validator 按新契约重写并消费 canonical fixtures

**What to build:** GUI 共享包的 snapshot validator 按新契约重写：接受新形态 snapshot；对不认识的字段一律忽略（tolerant reader，ADR-0005）；对不支持的 schemaVersion fail-closed 并映射到"需要重建/升级"的稳定错误。validator 测试直接消费 ECC 仓库的 canonical fixtures（经 parent 仓 submodule 路径只读引用）：valid fixture 全部接受，invalid fixture 逐一拒绝。ECC 侧契约变化导致 fixture 更新而 GUI 未跟进时，GUI CI 变红。

**Blocked by:** 03（ECC 新 snapshot 核心与 canonical fixtures）

**Status:** ready-for-agent

- [ ] GUI 测试对 ECC fixtures 的接受/拒绝断言全部通过，且 fixture 文件不经复制、直接引用
- [ ] 携带未知新字段的 snapshot 被接受（tolerant reader）
- [ ] 不支持版本的 snapshot 得到明确 fail-closed 错误，不静默降级渲染
- [ ] renderer 不直接接触 snapshot 文件，一切经 backend 边界

依据：ADR-0005、`docs/specs/engineering-snapshot-reimplementation.md`。
