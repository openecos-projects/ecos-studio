# 01: GUI 移除全部 artifact 指纹验证（指纹移除阶段一）

**What to build:** 用户在 macro 布局编辑保存后可以立即导出 signoff 包，不再被"指纹不匹配"错误阻断。GUI 删除 signoff 导出漂移守卫、已验证读取通道中的指纹比对分支、以及所有 integrity/指纹相关的展示逻辑；snapshot validator 把旧快照中的 `sha256`/`sizeBytes` 当作可忽略的遗留字段（tolerant reader，ADR-0005），旧快照保持可读。详情读取保留路径安全与读取大小上限检查。`ARTIFACT_REVISION_MISMATCH` 与 `SIGNOFF_ARTIFACT_REVISION_MISMATCH` 错误码随之删除。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] macro 编辑保存后立即导出 signoff 成功（端到端回归，覆盖 ADR-0010 报告的原始 bug）
- [ ] 携带 `sha256`/`sizeBytes` 的旧形状快照被 validator 接受；缺失这两个字段的新形状同样被接受
- [ ] 详情读取在文件被外部修改后正常返回当前内容，不再报 mismatch
- [ ] 路径穿越、符号链接、读取大小上限的检查保持不变（与漂移无关的安全机制）
- [ ] 指纹相关失败用例全部删除（对已删除逻辑不做负向测试）

依据：ADR-0010、`docs/specs/artifact-fingerprint-removal.md`。
