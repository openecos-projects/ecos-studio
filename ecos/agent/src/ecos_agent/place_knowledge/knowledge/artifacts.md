<a id="artifact.place.outputs"></a>
## artifact.place.outputs

ECOS builder 为 place 定义输出、feature、analysis、report、log 和 script 路径。下列实体描述预期路径；是否实际存在必须由 workspace artifact 检查确认。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.output_def"></a>
## artifact.place.output_def

**预期路径：** output/{design}_place.def.gz。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.output_verilog"></a>
## artifact.place.output_verilog

**预期路径：** output/{design}_place.v.gz。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.output_gds"></a>
## artifact.place.output_gds

**预期路径：** output/{design}_place.gds。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.output_db"></a>
## artifact.place.output_db

**预期路径：** output/{design}_place_db。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.output_image"></a>
## artifact.place.output_image

**预期路径：** output/{design}_place.png。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.output_json"></a>
## artifact.place.output_json

**预期路径：** output/{design}_place.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.geometry"></a>
## artifact.place.geometry

**预期路径：** output/geometry 和 geometry/geometry.manifest。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.view_json"></a>
## artifact.place.view_json

**预期路径：** output/{design}_place_view。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.feature_db"></a>
## artifact.place.feature_db

**预期路径：** feature/place.db.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.feature_step"></a>
## artifact.place.feature_step

**预期路径：** feature/place.step.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.feature_map"></a>
## artifact.place.feature_map

**预期路径：** feature/place.map.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.qor_metrics"></a>
## artifact.place.qor_metrics

**预期路径：** analysis/qor_metrics.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.qor_summary"></a>
## artifact.place.qor_summary

**预期路径：** analysis/qor_summary.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.qor_hotspots"></a>
## artifact.place.qor_hotspots

**预期路径：** analysis/qor_hotspots.json。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**

<a id="artifact.place.log"></a>
## artifact.place.log

**预期路径：** log/place.log，DreamPlace module 默认日志名为 dreamplace_placement.log。

**边界：** builder 的路径定义不是运行成功证明。

**源码证据：** **ecc.builder**, **dreamplace.module**
