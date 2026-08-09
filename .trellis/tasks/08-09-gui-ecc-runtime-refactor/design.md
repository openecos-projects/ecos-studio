# 已确认架构设计

完整设计已由用户审阅并确认，见 [`.claude/refactor.md`](../../../.claude/refactor.md)。

## 关键决策

- Electron main 的 `ProjectRuntimeSupervisor` 是运行时所有者；renderer 使用 `runtime.attach/detach/snapshot`，不持有 ECC session。
- ECC stdio 从同步请求-响应升级为响应加 notification；Coordinator 保持控制面可用，Worker 执行 flow、NFS 读取、日志和预览。
- GUI flow 使用 `FlowObserver`、`GuiFlowEventSink` 和 `StepRenderGate`；CLI 使用 `CliFlowEventSink`。
- NFS 数据通过本地缓存、`WorkspaceSnapshotLoader`、`ProjectSnapshotLoader` 和按需预览隔离；资源索引只允许在后台 Loader/Worker 内构建。
- 日志、metric、progress 和原始事件均有背压与内存上限；终态 step 使用幂等 ACK。
- layout edit 使用受锁保护的 `LayoutEditWorker` 和本地命令桥；非 flow 的配置、reset、签核使用 SnapshotLoader 或一次性 UtilityWorker。

## 实施前门槛

任何实现开始前，必须完成 `implement.md` 的阶段拆分，阅读 ECC、Electron main、renderer 三个包的 Trellis 规范，并确认 shared contracts 的兼容策略。

## 后续修复设计（2026-08-09）

本次 AppImage 监视发现的 warning 分为三个独立问题。修复不得通过放宽
项目路径权限、删除恢复 journal 或恢复 renderer 文件轮询来规避。

### 路径与 journal 恢复

Electron 路径边界判断必须按相对路径段判断越界：只拒绝相对路径恰为
`..` 或以平台路径分隔符连接的 `..` 开头，允许根目录内合法的名字，
例如 `..ws_0002.replace-backup-*`。该规则适用于 Workspace replacement
journal、Project scope 及其他共享的只读路径保护点；真实的父目录跳转、
绝对路径和符号链接逃逸仍必须被拒绝。

现有 journal 不应被删除。修复后，启动恢复继续使用 journal 的
`projectRoot`、`targetPath`、`backupPath` 和 recovery mode 进行既有的
幂等回滚/清理逻辑。

### ECC DB 与绘图日志

Synthesis 在缺少物理实现输入时本来就不能构造 ECC native DB。它是
`not-applicable`，不是 `initialization-failed`：Flow 保持返回“未建库”，
但不写 warning。对于需要物理输入的 step，建库失败仍为 warning，不能被
静默。此修改不改变 tool 执行、状态机、snapshot、`step.log` 或 GUI ACK。

`sta` 没有专用绘图支持属于能力缺失提示，不在本修复中补图片生成；它不应
改变 step 成功语义或 layout snapshot 选择。

### Project/Home 只读 scope

当前 workspace 打开时，项目概览只能通过已经注册的父项目只读 scope 读取
同一 manifest 声明的 workspace。读取 flow 与 QoR 输入前必须先注册该
scope，且不得调用 `registerProjectRoot()` 覆盖活跃 workspace root。

对于不属于当前 workspace 父项目的 Project 卡片，延迟其跨 workspace 的
分析数据读取，直到用户切换到该项目或有对应的受限 scope。这样保留路径
安全边界，并防止 Home/Project 管理界面在 NFS 上发起无效并发读。

### 验收与测试

- `..ws_*` 子目录被允许恢复，`../outside` 和符号链接越界继续被拒绝。
- Synthesis 不再产生虚假的 DB 初始化 warning；物理 step 的真实失败仍告警。
- 打开 `/mpc/gcd/ws_0003` 后，读取 manifest 所列 `ws_0001`、`ws_0002`
  的只读状态不触发 project-scope 拒绝，也不改变 active workspace root。
- Flow 的事件顺序、最终 snapshot、日志流/ACK 和 NFS 运行态无轮询约束保持
  现有行为。
