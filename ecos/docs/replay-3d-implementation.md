# Replay 同步双视图实现与验证

2026-11-16，`yell/replay`。设计依据：[replay-3d-design.md](replay-3d-design.md)。

## 使用方式与范围

关闭旧 Replay 窗口后重新打开，勾选顶部 **Sync 3D**。左侧 2D、右侧上部 3D 使用同一进度条，右侧下部保留阶段信息、完成后的 Maps、时钟树和 checklist。拖动分隔条可调整大小；关闭 **Reports** 可将右侧全部用于 3D。

现有 Replay 数据可直接使用，无须重跑 flow。阶段顺序仍来自当前 workspace 的动态 flow；没有物理版图的阶段显示空态。该功能不增加工具采集，不改变 ECC 的 Replay 开关或关闭时的算法开销。

相机按 step 和 phase 选视角：Place/Filler/合法化偏俯视，PDN/TA/详细布线偏倾斜，Map 接近顶视。阶段内视角过渡由播放位置决定，暂停和回退不会继续转动。拖动、缩放或选择 Iso/Top/Front 后由用户接管；**Stage camera** 恢复阶段视角。**2D region** 将当前 2D 区域定位到 3D，Layers 和 Z 控件可分层观察。

打开 **Sync 3D** 时默认使用 Iso 视角，并以设计 XY 中心为旋转目标缓慢环绕，速度约 4°/秒。拖拽、缩放、点击版图对象、2D region、Iso/Top/Front、Fit 或 Stage camera 都会关闭自动旋转，保留原有手动/阶段相机行为；播放进度和几何数据不受相机旋转影响。

## 模块与接口

| 位置 | 职责 |
| --- | --- |
| `replay_scene3d.rs` | 冻结元数据、局部坐标、稳定层高、当前场景体块和容量降级 |
| `replay_camera_plan.rs` | `Preset::for_phase(step, phase, map)`、确定性角度插值与画面适配 |
| `replay_canvas3d.rs` | 按需开启、相机交互、图层、拾取、GPU callback |
| `replay_overlays3d.rs` | 边界、移动轨迹、删除残影、Map、布线区域和分析标记的投影 |
| `replay_loader.rs` | 在同一个 generation 内准备 2D、3D 和结果资源 |
| `canvas_gpu3d.rs` | 普通 Viewer 与 Replay 共用渲染器；独立 callback 资源实例 |

关键签名：

```rust
// Request / Prepared 的内部字段，不是磁盘格式。
three_d_budget: Option<usize>
three_d: Option<Result<Scene3d, String>>

pub fn read_manifest(path: &Path) -> Result<GeometryManifest>;
pub fn read_layer_metadata(path: Option<&Path>) -> Result<Vec<LayerMetadata>>;
```

持久格式仅增加对已有可选 `final_geometry` 字段的解析；没有增加新的必要字段。现有文件的 attempt、路径范围、指纹验证继续生效。

## 同步与资源契约

1. 一个 Request 恢复一个 Scene，准备同一 Motion/Reveal 的两种投影；一次交付后同时更新。等待期间播放时钟冻结，旧 generation 不得覆盖新请求。
2. `GpuShapeInstance3d` 为 80 字节，包含目标 XY、起点 XY 和动画窗口。每个动画 tick 只更新 progress uniform，GPU 使用与 2D 相同的 smoothstep；未出现体块同时排除颜色与深度写入。
3. 精确子步骤节点使用源帧序号。开关 3D 必须保留已选或正在加载的精确帧；不能仅用展示时间反查，否则合批片段可能跳到另一帧。
4. 暂停时几何与阶段相机都保持不变。手动相机跨 step 保留，直到用户恢复 Stage camera。该恢复操作立即应用预设；播放中的阶段内过渡按展示时间插值。
5. `CanvasGpu3dCallback<true>` 与 `<false>` 使用不同资源类型。容量按实际需要增长，并受设备存储缓冲区上限约束；同 key 不上传，变更时仅上传首尾脏区间之间的数据。关闭 3D 移除其 GPU callback 资源和场景缓存。
6. 元数据只读取冻结 manifest/layers，绝不读取最终 shapes 或 view tiles 来填充过程帧。旧录制扫描 layer 名称，生成整个录制固定的示意层栈。局部原点和缩放避免大坐标直接转为 GPU f32。
7. 新增/修改对象优先保留且高亮；静态背景超出容量时按 kind/layer/空间格聚合，并显示简化提示。动画对象自身超出容量时明确报告 3D 无法完整显示，2D 仍可用。
8. 地图与右侧列表共用当前 Map；时钟树及完成报告沿用完成节点门控。两侧拾取共享对象 ID，轮廓随插值位置变化。

## 校验、兼容与错误

| 输入或操作 | 预期行为 |
| --- | --- |
| 有冻结元数据的录制 | 按冻结层顺序/单位呈现，仅画当前 diff 恢复的对象 |
| 旧数据缺少 `final_geometry` | 固定的启发式层栈；无单位时标注 DBU |
| 没有物理版图 | 3D 空态，继续显示该阶段的信息 |
| 越界路径/指纹失效 | 拒绝读取；3D 准备错误不使 2D 崩溃 |
| 拖动时旧请求晚到 | generation 淘汰旧结果 |
| 等待期间暂停或关闭 3D | 不自动恢复播放；取消旧准备，恢复 2D 请求 |
| 设备缺少 storage buffer | 给出明确提示，保持 2D |
| 静态背景超预算 | 空间聚合并标注简化 |
| 变化对象超预算 | 3D 提示容量错误，不悄悄丢掉变化对象 |

正确：在同一源帧上将 `Motion::start_bounds` 和 `Reveal::interval` 转为 3D 属性，使用共享 progress。错误：3D 独立定时播放最终 geometry 快照，或开关视图时用压缩展示时间代替精确源帧。

## 验证

Linux x86_64 / RTX 4090 Vulkan。执行：

```bash
cd ecos/chip-viewer
cargo fmt --all -- --check
cargo test --workspace -- --test-threads=1
cargo install --path apps/chip-viewer-native --locked --force --root ~/.local

cd ../gui
pnpm --filter @ecos-studio/desktop-electron exec vitest run \
  electron/services/chipViewerService.test.ts electron/services/replayService.test.ts
xvfb-run -a pnpm run desktop:smoke

cd ../..
python3 .github/scripts/check-version.py
CHIPCOMPILER_ECC_SIZER_ROOT="$HOME/.local/share/ecc/tools/ecc-sizer/replay-complete-20261116" make build
```

Rust 490 项通过、4 项按默认设置忽略；Electron Native/Replay 服务 60 项通过、1 项默认跳过。覆盖 XY 中间态、Filler 出现窗口、旧层定义、大坐标、路径逃逸、相机预设、暂停、精确节点开关和普通 3D 渲染回归。串行 Rust 测试避免本机并行 GPU 初始化争用。默认忽略的真实窗口测试另行显式执行如下；另外三项可选 CPU profile/canvas/decoding 基准本轮未执行。

```bash
ECOS_REPLAY_TEST_CATALOG=<catalog.json> ECOS_REPLAY_TEST_3D=1 \
ECOS_REPLAY_TEST_STEP=<step> DISPLAY=:189 \
cargo test --release -p chip-viewer-native \
  real_window_gpu_playback_and_seek_readback -- --ignored --nocapture --test-threads=1
```

| 真实数据 | 随机定位 | 活跃帧 CPU+render P95 | 活跃帧间隔 P95 | 请求到 GPU 回读 P95 |
| --- | --- | --- | --- | --- |
| GCD `ws_0004` Filler | 100/100 通过 | 1.0 ms | 2.6 ms | 69.8 ms |
| AES Place | 100/100 通过 | 1.1 ms | 3.3 ms | 897.5 ms |
| AES Route grid | 100/100 通过 | 13.0 ms | 19.6 ms | 3739.2 ms |

Filler 播放很快结束，不能称为连续播放 30 秒；Place/Route 测试播放上限 30 秒后执行定位。活跃帧统计不含等待加载，GPU 回读不等同于显示器呈现延时；测试期间还有构建和流程任务，不是隔离环境基准。Route 的重建 P95 为 2368.8 ms，索引加 3D 准备为 837.3 ms；远距离定位仍有明显等待。日志中的 `index` 计时包含 3D 准备，不应误标为纯索引耗时。

实际录屏和截图保存在本地 `.claude/replay-evidence/dual-20261116/`，包含 Filler、Floorplan PDN、Place 和 Route。原 workspace 只读，验证目录及临时 catalog 位于 `/tmp`。

默认跳过的真实 catalog 测试已单独通过：在 `ecos/gui` 执行 `ECOS_REPLAY_TEST_WORKSPACE=/tmp/ecos-replay-validation-20261115/aes/compact pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/replayService.test.ts -t 'builds a catalog from the supplied completed tool workspace'`。该补测仅运行指定测试，其余 7 项因名称过滤跳过；完整服务测试已在前述命令中通过。

## 构建、安装与边界

ECC CLI 在 `ecc/` 中使用 `.venv/bin/pyinstaller ecc.spec --clean --noconfirm --distpath /tmp/ecc-replay-dual-dist --workpath /tmp/ecc-replay-dual-build` 重建，安装到 `~/.local/share/ecc/v0.1.0-alpha.12-replay-dual-20261116`；`~/.local/bin/ecc` 已指向此版本。旧安装保留，包装脚本备份为 `~/.local/share/ecc/replay-dual-previous-wrapper.sh`。`ecc --version`、`ecc --help`、`ecc version` 已验证。

该 CLI 构建来自当前 ECC 工作树，包含已有的 workspace execution 配置改动；安装 provenance 记录在 `~/.local/share/ecc/replay-dual-install-20261116.json`。本轮没有修改 ECC/EDA 采集源码，没有替换 Sizer，也没有变更父仓库 ECC 发布 pin 或 CI toolchain lock。

Native 已安装到 `~/.local/bin/chip-viewer-native`，Linux `make build` 更新桌面 AppImage/deb 及内置 Native。安装文件、release target 与桌面包内 Native 的 SHA-256 一致：`d3b7c59af64290fc1a31d278f2c2d046de1e6536eee2a0f9fd75c0f1b60ff82a`。最终桌面 smoke 通过。

完整 GUI/CLI/并发流程回归：3 个文件、9 项通过、1 项跳过，耗时 1321 秒。GUI 和内置 Terminal 启动的 GCD 流程均完成全部 21 个步骤；并发测试覆盖两个完整流程、同时启动及取消隔离。跳过项为 `signoff-lit artifact gate`，因为本次没有提供 `ECOS_E2E_LIT_SUITE` 外部产物；不将此结果声明为全设计矩阵或工艺签核验证。

完整流程回归使用新安装的系统 ECC，命令在 `ecos/gui` 中执行；这是本机分支运行时验证，不声称使用未改变的 CI pin：

```bash
ECOS_E2E_ECC_BIN_DIR="$HOME/.local/bin" \
ECOS_E2E_PDK_ROOT="$HOME/.local/share/ecc/pdks/icsprout55/v1.10.103" \
CHIPCOMPILER_OSS_CAD_DIR="$HOME/.local/share/ecc/tools/oss-cad-suite/20260827" \
CHIPCOMPILER_ECC_SIZER_ROOT="$HOME/.local/share/ecc/tools/ecc-sizer/replay-complete-20261116" \
CHIPCOMPILER_KEPLER_FORMAL_ROOT="$HOME/.local/share/ecc/tools/kepler-formal/replay-complete-20261116" \
ECOS_E2E_OUT=/tmp/replay-dual-product-e2e \
xvfb-run -a pnpm --filter @ecos-studio/desktop-electron exec vitest run \
  --config vitest.e2e.config.ts rtl2gds cli-flow flow-concurrency
```

显示边界：实例采用已采集的包围盒；Z 高度为示意值，via 使用记录的 cut layer 高度，不推断未采集的真实连接。边界、Map 和算法 grid 是投影到同一坐标系的语义叠加，不参与 GPU 深度遮挡。静态背景聚合不是精确几何替代；GPU 使用连续脏区间上传，不是永久对象槽位。Linux 外的平台、完整显存峰值矩阵与旧/新版本隔离对照基准本轮未执行。

## RCX / STA 分析矩形投影修正

初版 `ReplayAnalysis::paint` 将两个对角点投影后调用屏幕矩形 API，导致分析区域始终水平/垂直于显示器。修正为依次投影版图 bbox 的四角，使用封闭凸多边形绘制填充和描边；屏幕包围盒只用于裁剪判断。RCX、STA 及共用分析渲染器的诊断视图均遵守这一规则。3D 仍采用当前相机的版图平面投影，2D 保持正交矩形。

回归测试 `analysis_boxes_follow_all_four_projected_corners_in_2d_and_rotated_3d` 检查实际输出绘图形状，覆盖两类报告、2D 和两个不同的 3D yaw，验证四角坐标、填充、封闭描边及倾斜边方向。此修正只影响显示，无须重新运行 flow 或生成 Replay 数据。

修正验证：`cargo test -p chip-viewer-native replay_analysis::tests -- --test-threads=1` 两项通过；`cargo test --workspace -- --test-threads=1` 491 项通过、4 项默认忽略；`cargo fmt --all -- --check` 通过。使用 `gcd/ws_0004` 的真实 RCX/STA 数据检查 3D 画面，截图位于 `.claude/replay-evidence/dual-20261116/projection-RCX/` 与 `projection-sta/`。

再次执行前述 Native 安装和根目录 `make build`，`xvfb-run -a pnpm run desktop:smoke` 通过；本次系统安装、release target 和桌面包内 Native 的 SHA-256 一致为 `1bb016d60a886a4b750701837625036f19e7a58c3761309eb5cf5502de041cbe`，替代上一节的初次双视图构建。未改 ECC、数据格式或启动接口，本次未重复完整 EDA flow、Electron 服务测试、随机定位基准及跨平台验证。
