<a id="algorithm.place.execution"></a>
## algorithm.place.execution

**调用链：** ecc_dreamplace.runner.run_placement() 获取 ECC module，构造 DreamplaceModule；DreamplaceModule._run() 构造 PlacementEngine，依次调用 setup_rawdb() 与 run()；后者建立 placement DB 并调用 NonLinearPlace。

**默认阶段：** 当前默认配置开启 global placement 与 internal legalization，关闭 detailed placement。

**后续：** place 返回后 runner 请求 placement feature map、保存数据和分析；这些调用不等同于证明所有产物都已成功落盘。

**源码证据：** **dreamplace.runner**, **dreamplace.module**, **dreamplace.placer**, **dreamplace.config**

<a id="algorithm.dreamplace.global_placement"></a>
## algorithm.dreamplace.global_placement

NonLinearPlace 以平滑线长和 density penalty 的目标迭代。当前 global_place_stages 配置是 32x32 bins、1000 iterations、weighted_average wirelength 与 nesterov optimizer。

如果最后一次度量的 overflow 大于 stop_overflow，或 objective 为 Inf 或 NaN，实现会跳过 legalizer 和 detailed placement，并返回无穷 HPWL 作为失败信号。

**源码证据：** **dreamplace.config**, **dreamplace.nonlinear**, **dreamplace.objective**

<a id="algorithm.dreamplace.routability_optimization"></a>
## algorithm.dreamplace.routability_optimization

routability_opt_flag 为 1 时，NonLinearPlace 进入可布线性优化路径。当前快照默认开启 EGR 面积调整，关闭 RUDY 和 pin 面积调整；具体是否发生调整仍取决于迭代中的阈值与数据。

**源码证据：** **dreamplace.config**, **dreamplace.nonlinear**, **dreamplace.objective**

<a id="algorithm.dreamplace.legalization"></a>
## algorithm.dreamplace.legalization

普通 place 的默认 legalize_flag 为 1，因此 global placement 收敛后会在同次布局中进行内部 legalization。CTS 后的独立 legalization 步调用同一模块，但强制 global_place_flag 为 0、legalize_flag 为 1、enable_fillers 为 0，所以它不是再次全局布局。

**源码证据：** **dreamplace.config**, **dreamplace.module**, **dreamplace.nonlinear**

<a id="algorithm.dreamplace.detailed_placement"></a>
## algorithm.dreamplace.detailed_placement

当前默认 detailed_place_flag 为 0，因此 detailed placement 不是默认 place 路径的一部分。PlacementEngine 仅在 detailed_place_engine 被设置且本地路径存在时调用外部 detailed placer；不存在时记录 warning。

**源码证据：** **dreamplace.config**, **dreamplace.placer**
