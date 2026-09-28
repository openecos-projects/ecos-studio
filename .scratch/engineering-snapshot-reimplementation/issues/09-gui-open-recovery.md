# 09: GUI 打开/恢复策略落地

**What to build:** GUI 端落地 ADR-0009 的打开策略表：打开缺失 snapshot 的 workspace 时无感自动重建并正常显示；snapshot 损坏或版本不受支持时，界面给出明确的"需要重建"状态与显式重建入口（不静默覆盖、不以空状态冒充）；手工复制造成的 identity 冲突被明确告知并拒绝打开。所有状态文案与 ECC 错误码一一对应。

**Blocked by:** 04（ECC 打开策略表统一）、05（GUI validator 重写）

**Status:** ready-for-agent

- [x] 缺失 snapshot 的 workspace 打开后自动可见，无需手动操作
- [x] 损坏/旧版本 snapshot 显示 rebuild 入口；点击重建后正常打开
- [x] identity 冲突显示明确错误，无一键重建按钮
- [x] 同一损坏 snapshot 在 GUI 与 ECC CLI 入口的错误分类一致

依据：ADR-0009。
