# 07: checklist 有界投影与 GUI findings 迁移

**What to build:** ECC 的 snapshot 中 checklist 段从整份内联改为有界投影：每条只含 id/title/state/blocked/step/category/summary，写入硬上限 512 条；完整 checklist.json 仍在 workspace 内，作为 artifact 被索引。GUI 的 findings 列表改从投影渲染（不再假设每条带 evidence/source）；用户点开某条 finding 查看 evidence 详情时，经 backend artifact 通道懒加载 checklist.json 原文（路径安全 + 大小上限，无内容指纹）。stalePredecessor 的 current/stale findings 对比在投影形态下保持可用。

**Blocked by:** 01（GUI 指纹移除，提供无指纹的 artifact 懒加载通道）、03（ECC 新核心）、05（GUI validator 重写）

**Status:** ready-for-agent

- [x] findings 列表完全由 checklist 投影渲染，包括 pass 条目，含 flow 状态 reconcile 行为
- [x] evidence 详情经 artifact 通道按需读取成功；文件缺失时显示明确不可用状态
- [x] checklist 超过 512 条时写入侧视为 producer 错误而非静默截断
- [x] 失效前后（current vs stalePredecessor）的 findings 对比视图行为不回归

依据：ADR-0007、`docs/specs/engineering-snapshot-reimplementation.md`。
