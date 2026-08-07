<a id="failure.place.dreamplace_import"></a>
## failure.place.dreamplace_import

is_eda_exist() 捕获 DreamPlace import 异常并记录 dreamplace: import failed，随后 step 返回 False。检查运行环境中的 dreamplace 模块和编译依赖。

**源码证据：** **dreamplace.utility**, **dreamplace.runner**

<a id="failure.place.missing_ecc_module"></a>
## failure.place.missing_ecc_module

runner 只有在 get_eda_instance() 返回非空 ECC module 时才调用 DreamPlace；为空时 placement 不会进入 module。

**源码证据：** **dreamplace.runner**

<a id="failure.place.overflow_or_nonfinite_objective"></a>
## failure.place.overflow_or_nonfinite_objective

NonLinearPlace 在最后 overflow 超过 stop_overflow，或 objective 是 Inf 或 NaN 时跳过 legalization 和 detail，并返回无穷 HPWL。

**源码证据：** **dreamplace.nonlinear**

<a id="failure.place.infinite_hpwl"></a>
## failure.place.infinite_hpwl

DreamplaceModule 将 ppa["hpwl"] == inf 视为失败并返回 False。

**源码证据：** **dreamplace.module**

<a id="failure.place.missing_feature_map"></a>
## failure.place.missing_feature_map

runner 会请求 feature_placement_map(json_path=step.feature.map)；预期 map 缺失时不能声称 QoR 指标已经生成。

**源码证据：** **dreamplace.runner**, **ecc.builder**

<a id="failure.place.missing_external_detailed_placer"></a>
## failure.place.missing_external_detailed_placer

如果设定了 detailed_place_engine 但路径不存在，PlacementEngine 仅记录 warning；当前默认 detailed placement 关闭。

**源码证据：** **dreamplace.placer**, **dreamplace.config**

<a id="failure.place.misleading_subflow_success"></a>
## failure.place.misleading_subflow_success

当前 runner 在 DreamPlace 返回后无条件把 subflow 的 run-placement 标为 success，再由 save_data 覆盖 reslut。因此 subflow success 不能单独作为布局成功证据；需核对终态、日志和产物。

**源码证据：** **dreamplace.runner**, **dreamplace.module**
