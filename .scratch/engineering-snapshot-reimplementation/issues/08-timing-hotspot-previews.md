# 08: timingPreview 与 hotspotPreview 投影及 GUI 渲染

**What to build:** ECC 在 snapshot 中产出两个语义有界投影：timingPreview（STA 按 worst slack 排序的 top-N issue，只含标量字段，不含 stage 列表）与 hotspotPreview（top-N 热点 + 计数）。每个投影携带截断真相（总数 + 是否截断），UI 能区分"这就是全部"与"这只是头部"。GUI 的 STA 概览与热点面板改从投影渲染；用户查看完整 issue 列表或某条路径的完整 stage 时，经 artifact 通道懒加载原始分析文件。大设计（多 corner、深路径）的概览不再因文件超限而整份丢数据。

**Blocked by:** 01（GUI 指纹移除，提供无指纹的 artifact 懒加载通道）、03（ECC 新核心）、05（GUI validator 重写）

**Status:** ready-for-agent

- [x] 32 corner 满配 STA 产物的合成 workspace：timingPreview 有界且含正确的 issueCount/issuesTruncated
- [x] 完整 timing issues（含 stage 列表）经 artifact 通道懒加载可读
- [x] hotspotPreview 同构：top-N + 计数 + 截断真相
- [x] 投影条数上限为固定常量，不依赖工具侧参数（如 timing_path_limit）的隐含前提
- [x] 小设计行为不回归（未截断时投影与完整数据语义一致）

依据：ADR-0007、`docs/specs/engineering-snapshot-scale-boundedness.md`。
