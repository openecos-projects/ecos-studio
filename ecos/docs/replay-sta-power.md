# STA 路径与 Power 热图 Replay

## 已确认的展示行为

- STA 按 corner、setup/hold 分组，展示各自 Top-K 路径；K 使用工具报告中的 `path_limit`，不在 UI 再截断。目前工具输出 K=20。
- 同一个 corner 的所有 setup/hold Top-K 路径同时从 startpoint 向 endpoint 展开。沿真实金属走线与过孔显示移动亮点、线条辉光和逐段增量延迟；完成后短暂停留，标注 slack、arrival、required，然后切换下一个 corner。Setup 橙色，Hold 青色。
- 点击 STA 完成圆点进入 corner 播放，右侧选择 corner 可直接定位并重新播放；选择某条路径暂停并单独检查其完整布线和报告，再播放时恢复该 corner 的全部路径。底部仍用同一条进度条，暂停、倍速、拖动均作用于同一展示时钟。
- Power 默认 total，可切换 internal、switching、leakage。热图沿单元空间顺序平滑显现，显示完毕后停留。右侧高亮当前分量，色标单位 W。
- 普通 Power 版图窗口也能加载同一热图，默认 total，复用 Place 的热图面板和渲染器。
- 两类视图仅在 step 成功完成后出现；Replay 是已记录结果的动态讲解，不表示信号的真实传播速度，也不表示随仿真时间变化的功耗波形。

## STA 数据与播放

继续使用各 corner 的 `feature/**/timing_paths.json`，由 ECC 冻结到当前 Replay attempt 的 analysis overlays。每条路径保留原始 stages、增量延迟和终点结果；无需增加新的工具采集格式。

### 真实布线与并行播放（按最新反馈修正）

读取同一 Replay attempt 已冻结并校验过的 `final_geometry` 快照，使用普通 STA 版图相同的 `ChipViewDb` 引脚查询、net 连通关系及原生 wire/via 几何。源到目标分支搜索与普通 STA 视图共用 `timing_route::connected_chain`。

对于报告中的每个 net_arc：确认源/目标引脚属于同一 net；查询该 net 的金属矩形与过孔，按真实相交关系建立连通图；同层可直接相连，跨层只允许属于**同一个真实 via owner/path** 的形状相连。起终点必须在真实引脚与对应层走线的交叠区域内，只保留通往目标的分支。沿被选中金属矩形内部的正交轴线逐段展开，转角保持正交；过孔只改变层高。不会把不同层的 XY 交叉当成连接，不会把整个扇出 net 当成当前路径，更不会用斜线或人为 L 形折线补接缺失布线。

Cell arc 不包含单元内部物理走线数据，只高亮对应真实引脚区域并显示 cell 延迟，不绘制跨单元示意线。无法验证的 net arc 保持缺失并报告计数；缺少 frozen geometry 时提示重跑 STA，不读取可能已经变化的 live 数据。

旧报告按 setup/hold 分开的 views 在读取时按 corner 合并，原文件不修改。每个 corner 固定 6 秒（4.5 秒同时展开所有路径，1.5 秒停留），与 K 无关；底部进度条、倍速、暂停和拖动共享同一展示时钟。GCD ws_0004 的 5 个 corner、每个 40 条路径共展示 30 秒，替代之前约 17 分钟的逐条展示。

路径每段动画按其真实布线长度推进，画面中的线全部落在已解析金属形状内。2D 使用 XY；3D 使用相同 XY 和快照层号，对应当前 layer stack 的金属层高度，过孔垂直连接层间。文字使用投影位置和公共避让区域，密集重叠处可点击某条路径单独检查；文字引线也为屏幕正交折线，不混入斜线式连接示意图。

路径解析在 worker 中执行，pin、net 连通图、相同端点 route 缓存复用，绘制时不做数据库搜索。一个 net 超过 4096 shapes 时报告无法解析而不截断后伪造路径。该限制只影响 Replay 显示，不影响原算法。

## Power 数据契约

只在 ECC Replay capture 上下文启用时，将字符串配置 `-replay_geometry_directory` 传给 iPW。关闭时不收集 bbox，不建立单元坐标索引，不生成地图或额外快照，不重新遍历功耗报告。

输出位置：`powerAnalysis_ecc/output/geometry/power/`（该 step 的 geometry 目录）。

| 文件 | 内容 |
| --- | --- |
| `instance_power_geometry.tsv` | instance_name、lx/ly/hx/hy（DBU）、internal/switching/leakage/total_power_w |
| `power_map/layout.csv` | pixel_row/pixel_col 与真实单元矩形对应关系 |
| `power_map/*_power_w.csv` | 每个矩形对应功耗；四种分量，单位 W |
| `metadata.json` | schema、坐标单位、数值单位、reported/matched/unresolved 数量、average 或 per_instance_peak 口径 |

这里的 CSV 索引是单元矩形索引，每行一单元，并非规则物理网格。普通 viewer 复用 Place 的空间矩形渲染能力。显示的是**单元功耗**，不是温度或功耗密度；峰值模式中的各单元独立峰值不代表同一时刻的全芯片峰值。

iPW 只为已放置/固定/cover 且边界有效的 instance 取 IDB bbox。导出器读取已写出的 `instance_power.tsv`，直接保留其中四列数值，避免平均/峰值口径发生偏差。缺失坐标不会填造矩形，覆盖数量由 metadata 记录。文件全部关闭后才发布 geometry/power 目录，失败仅记录 Replay warning，不改变功耗分析算法结果。

ECC 在每次重跑前失效旧地图，包括后来关闭 Replay 的重跑。采集优先读取本次新生成 geometry TSV；不存在、过期或格式无效则回退本次原 TSV，按精确名称匹配最终 scene。Replay 冻结原始来源、内容摘要和元数据，播放不读取后续重跑的 live 数据。地图只描述完成结果，因此不虚构算法过程 timestamp；播放时间与真实采集时间分离。

## 实现位置

- ECC-Tools：iPW `PWInterface::wrapConfig/wrapInstance`、`PowerReporter::report`、独立 `PowerGeometry.cpp`；Python binding 保持字符串配置契约。
- ECC：`tools/ecc/module.py`、`runner.py`、`power_artifacts.py`、`replay_analysis.py`。
- Native：`timing_route.rs` 负责真实布线、引脚/层/过孔解析及公共分支搜索，`replay_timing.rs` 负责按 corner 归并与并行动画；`replay_analysis.rs` 负责结果切换和 Power 渐显；`replay_plan.rs`/`replay_playback.rs` 统一展示时间；普通视图通过 `map_data.rs` 发现 Power maps。

## 数据兼容与测试

已有含 stages 的 STA Replay 无需重跑 flow。已有 Power Replay 可按单元名称显示四分量；要得到新的 geometry 文件及普通 Power 版图热图，只需启用 Replay 后重跑 powerAnalysis，不需要重新跑完整 flow。

验证包含真实引脚匹配、缺失布线不跨接、扇出分支筛选、同 XY 不同层隔离、过孔层间连接、正交走线、连续插值、随机 seek、按 corner 固定计时、地图默认 total、DBU 矩形映射、来源冻结、过期/损坏文件回退、重跑清理，以及 Replay 开关的 native 配置传递。真实 GCD 使用独立临时输出目录进行 iPW 开/关验证，不更改用户 workspace。
