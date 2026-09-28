# 02: ECC 停止计算与写入 artifact 指纹（指纹移除阶段二）

**What to build:** ECC 生成的 snapshot 中 artifact 索引条目收敛为纯定位索引（artifactId/kind/name/stepId/reference/availability），不再携带 `sha256`/`sizeBytes`；`availability` 只出现 `missing | available`；16 MiB 哈希上限常量与"超限误标 stale"逻辑删除；snapshot 构建不再计算任何 artifact 哈希；`validate_artifacts` 严格读取路径整体删除（无生产调用方）。保留 artifactId 派生校验、引用路径安全校验、LEC 输入新鲜度摘要、layout edit 并发指纹、agent candidate 回执哈希（这些与漂移检测无关）。canonical fixtures 同步去除这两个字段。

**Blocked by:** 01（GUI 移除全部指纹验证）+ 包含 01 的 Studio 版本已发布（发布门禁）

**Status:** ready-for-agent

- [ ] 新生成的 snapshot 不含 `sha256`/`sizeBytes`，且与更新后的 canonical fixtures 一致
- [ ] 旧形状快照（携带遗留字段）读取成功，字段被忽略
- [ ] 任意大小的 artifact（含 >16 MiB）都得到 `availability: available`，无 stale 误标
- [ ] 路径安全校验（绝对路径、`..`、符号链接）行为不变
- [ ] LEC 新鲜度、layout edit 并发、agent 回执三套独立机制零改动

依据：ADR-0010、`docs/specs/artifact-fingerprint-removal.md`。错配窗口（阶段一之前的旧 GUI 读本阶段之后的 snapshot）已在 ADR-0010 中明确接受。
