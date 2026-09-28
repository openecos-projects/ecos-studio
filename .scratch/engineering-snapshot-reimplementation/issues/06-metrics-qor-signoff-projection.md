# 06: metrics/qor/signoff 投影与 GUI 对比视图迁移

**What to build:** ECC 在 snapshot 中产出扁平单份 metrics 投影（每条带步骤、单位、方向、corner 上下文、分析 schema）、qorSnapshotExtension 评分投影与 signoffAssessment 摘要，不再有内联 analysis data 与 qorAssessment 重复段。GUI 的项目对比视图改为只读这些有界投影：打开项目、跨 workspace 对比指标不触发任何报告/分析文件的扫描，大设计 workspace 秒开；不可比的指标（不同 schema/corner 上下文）不被伪装成精确排名。

**Blocked by:** 03（ECC 新 snapshot 核心）、05（GUI validator 重写）

**Status:** ready-for-agent

- [x] 项目对比视图的数据全部来自 snapshot 投影，无 per-workspace 文件扫描（可用插桩/计数断言）
- [x] metrics 只存在一份（扁平投影），GUI 不再有 qorAssessment 优先于 metrics 的回退分支
- [x] 指标携带步骤/单位/方向/corner 上下文，schema 不一致的 workspace 对比时明确标注
- [x] 投影在 ECC fixtures 中有对应样本，GUI validator 接受

依据：ADR-0005、ADR-0007、`docs/specs/engineering-snapshot-reimplementation.md`。
