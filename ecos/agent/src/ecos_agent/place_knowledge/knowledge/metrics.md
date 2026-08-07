<a id="metric.place_hpwl"></a>
## metric.place_hpwl

从 placement map 的 /Wirelength/HPWL 提取，单位为 um，极性为 lower-is-better。

**源码证据：** **ecc.metrics**

<a id="metric.place_grwl"></a>
## metric.place_grwl

从 placement map 的 /Wirelength/GRWL 提取，单位为 um，极性为 lower-is-better。

**源码证据：** **ecc.metrics**

<a id="metric.place_flute_wirelength"></a>
## metric.place_flute_wirelength

从 placement map 的 /Wirelength/FLUTE 提取，单位为 um，极性为 lower-is-better。

**源码证据：** **ecc.metrics**

<a id="metric.place_congestion_egr_overflow_total"></a>
## metric.place_congestion_egr_overflow_total

从 placement map 的 EGR overflow.total.union 提取，单位为 count，极性为 lower-is-better。

**源码证据：** **ecc.metrics**

<a id="metric.place_congestion_egr_overflow_max"></a>
## metric.place_congestion_egr_overflow_max

从 placement map 的 EGR overflow.max.union 提取，单位为 count，极性为 lower-is-better。

**源码证据：** **ecc.metrics**

<a id="metric.place_lutrudy_utilization_max"></a>
## metric.place_lutrudy_utilization_max

从 placement map 的 /Congestion/utilization/lutrudy/max/union 提取，单位为 ratio。此快照未在本块推断 LUT-RUDY 的内部公式。

**源码证据：** **ecc.metrics**

<a id="metric.place_rudy_utilization_max"></a>
## metric.place_rudy_utilization_max

**ECOS 对外指标：** place_rudy_utilization_max 从 placement map 的 /Congestion/utilization/rudy/max/union 读取。

**计算：** ECC congestion evaluator 对每条 net 取 pins 的 bounding box，对每个相交 grid 计算 overlap_area。horizontal 贡献为 overlap_area / bbox_height / grid_area，vertical 贡献为 overlap_area / bbox_width / grid_area，union 为两者相加；退化 bbox 的对应倒数设为 1.0。evaluator 写出该 density grid；ECOS feature map 暴露 union 的 max，再由 metrics 提取。

**边界：** 这是布局期、feature-map 的 RUDY 估计，不是详细布线完成后的真实 overflow；也不要把它与 DreamPlace 内部 torch RUDY operator 混为同一对外指标。

**源码证据：** **ecc.congestion**, **ecc.metrics**, **dreamplace.placer**
