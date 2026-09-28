# 10: 集成、发布配对与性能验收

**What to build:** 全部切片汇合后的端到端集成：parent 仓 gitlink 更新到包含新 snapshot 实现的 ECC 版本，GUI 与 ECC 配对发布；两侧 CI 均消费同一组 canonical fixtures 并全绿。用确定性大 fixture（32 corner STA 产物 + 满 checklist + 大设计指标）完成性能验收并记录基线数据。

**Blocked by:** 02（ECC 指纹阶段二）、06（metrics/qor/signoff 投影）、07（checklist 投影）、08（timing/hotspot 投影）、09（GUI 打开恢复）

**Status:** ready-for-agent

- [ ] ECC 生成物 == canonical fixtures；GUI validator 接受/拒绝同一组 fixtures；两侧 CI 绿
- [ ] 大 fixture 下 snapshot 体积 < 1 MiB，无任何段被截断丢弃
- [ ] 连续 10 次提交的构建耗时与 workspace 产物总量无关
- [ ] macro 编辑保存 → 立即导出 signoff 全链路回归通过
- [ ] 打开策略表四种情形在最终发布组合下行为一致
- [ ] parent 仓 gitlink 仅指向已发布的 ECC 提交；发布说明记录版本错配行为（旧 GUI + 新 ECC 为 fail-closed 明确报错）

依据：全部 ADR（0005~0010）与两份 spec 的验收标准汇总。
