---
status: accepted
implementation: completed 2026-09-03
---

# Event 承载瞬态运行状态，Query 返回已提交事实

stdout、stderr、Operation progress 和当前运行步骤通过 Runtime Event 链路驱动实时 UI；Flow Step Commit 完成后，ECC 的 Engineering Snapshot 才成为该 revision 的权威工程事实，Workspace Overview 与 Step Analysis query 只消费这些已提交事实。Event 可以重复、延迟或丢失，只通知消费者重新查询，不能替代 Snapshot、阻塞 ECC 执行或由 GUI render ACK 推进。相比每条高频事件都重新查询文件系统，这保留实时进度并避免扫描风暴；代价是 presentation 需要组合稳定 ReadModel 与独立的瞬态 execution state。

Project Comparison 还把 `project.json` 或 Project 声明的 `engineering-snapshot.json` 变化和窗口重新获得焦点视为失效提示，以覆盖 CLI、其他窗口和丢失的 Runtime Event；这些提示经过去重和合并后只触发 revision-aware query，不直接改变工程状态，也不使用固定间隔轮询。

Backend Renderer 已直接消费 typed Runtime Event，Project Comparison 通过持久化 Snapshot query 恢复 committed facts；旧 Backend event envelope 已删除并通过本地回归验证。
