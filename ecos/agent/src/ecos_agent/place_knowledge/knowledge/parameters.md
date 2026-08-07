<a id="parameter.dreamplace.aux_input"></a>
## parameter.dreamplace.aux_input

**含义：** Bookshelf AUX 输入描述。

**算法作用：** 为 Bookshelf 格式的数据读取提供设计入口。

<a id="parameter.dreamplace.lef_input"></a>
## parameter.dreamplace.lef_input

**含义：** LEF 文件集合。

**算法作用：** 向布局数据库提供工艺层、site 和单元几何。

<a id="parameter.dreamplace.def_input"></a>
## parameter.dreamplace.def_input

**含义：** 输入 DEF 路径。

**算法作用：** 向布局数据库提供当前物理位置和约束；ECOS 在运行边界替换为 step 输入。

<a id="parameter.dreamplace.verilog_input"></a>
## parameter.dreamplace.verilog_input

**含义：** 输入网表路径。

**算法作用：** 向布局数据库提供逻辑连接；ECOS 在运行边界替换为 step 输入。

<a id="parameter.dreamplace.gpu"></a>
## parameter.dreamplace.gpu

**含义：** 是否请求 GPU 执行。

**算法作用：** 决定张量和已编译算子使用 CPU 或 CUDA 设备。

<a id="parameter.dreamplace.gpu_id"></a>
## parameter.dreamplace.gpu_id

**含义：** CUDA 设备编号。

**算法作用：** 在 GPU 模式下选择承载布局张量和算子的设备。

<a id="parameter.dreamplace.num_bins_x"></a>
## parameter.dreamplace.num_bins_x

**含义：** density bin 的 X 方向数量。

**算法作用：** 决定密度、电势和全局布局评估的空间离散粒度。

<a id="parameter.dreamplace.num_bins_y"></a>
## parameter.dreamplace.num_bins_y

**含义：** density bin 的 Y 方向数量。

**算法作用：** 决定密度、电势和全局布局评估的空间离散粒度。

<a id="parameter.dreamplace.global_place_stages"></a>
## parameter.dreamplace.global_place_stages

**含义：** 全局布局阶段表。

**算法作用：** 定义每个阶段的 bin 数、迭代次数、线长模型、优化器和学习率。

<a id="parameter.dreamplace.target_density"></a>
## parameter.dreamplace.target_density

**含义：** 全局布局中 density bin 的目标放置密度。它不是 floorplan 的 Core.Utilitization。

**算法作用：** 作为 density overflow 与 electric-potential 密度项的目标，平衡线长与可放置面积。

<a id="parameter.dreamplace.density_weight"></a>
## parameter.dreamplace.density_weight

**含义：** 密度惩罚的初始权重。

**算法作用：** 控制目标函数中 density penalty 相对平滑线长的影响，并参与权重更新。

<a id="parameter.dreamplace.random_seed"></a>
## parameter.dreamplace.random_seed

**含义：** 随机数种子。

**算法作用：** 初始化 Python、Torch 与 CUDA 随机状态，影响可重复的初始扰动。

<a id="parameter.dreamplace.result_dir"></a>
## parameter.dreamplace.result_dir

**含义：** 布局运行结果目录。

**算法作用：** 承载 DreamPlace 日志和中间结果。

<a id="parameter.dreamplace.scale_factor"></a>
## parameter.dreamplace.scale_factor

**含义：** 坐标和线长换算比例。

**算法作用：** 用于将布局数据库的数值在评估和输出时统一到相应尺度。

<a id="parameter.dreamplace.ignore_net_weight"></a>
## parameter.dreamplace.ignore_net_weight

**含义：** 大权重 net 的忽略阈值。

**算法作用：** 在加权 HPWL 评估中筛除过大权重 net。

<a id="parameter.dreamplace.shift_factor"></a>
## parameter.dreamplace.shift_factor

**含义：** 输入坐标平移量。

**算法作用：** 在数据读入阶段调整坐标原点。

<a id="parameter.dreamplace.ignore_net_degree"></a>
## parameter.dreamplace.ignore_net_degree

**含义：** net 度数忽略阈值。

**算法作用：** 用于屏蔽高扇出 net，避免其主导线长和部分评估算子。

<a id="parameter.dreamplace.gp_noise_ratio"></a>
## parameter.dreamplace.gp_noise_ratio

**含义：** 全局布局初始化噪声比例。

**算法作用：** 决定随机中心初始化时施加的位置扰动强度。

<a id="parameter.dreamplace.auto_adjust_bins"></a>
## parameter.dreamplace.auto_adjust_bins

**含义：** 自动调整 density bin 的开关。

**算法作用：** 允许布局器根据设计数据调整密度网格设置。

<a id="parameter.dreamplace.enable_fillers"></a>
## parameter.dreamplace.enable_fillers

**含义：** 是否插入 filler 节点。

**算法作用：** filler 节点参与密度模型，使连续优化能反映可用面积。

<a id="parameter.dreamplace.global_place_flag"></a>
## parameter.dreamplace.global_place_flag

**含义：** 是否执行全局布局。

**算法作用：** 控制是否进入 NonLinearPlace 的连续优化循环。

<a id="parameter.dreamplace.legalize_flag"></a>
## parameter.dreamplace.legalize_flag

**含义：** 是否执行内部合法化。

**算法作用：** 控制全局布局后是否调用 legalizer 消除重叠并对齐 site。

<a id="parameter.dreamplace.detailed_place_flag"></a>
## parameter.dreamplace.detailed_place_flag

**含义：** 是否启用详细布局标志。

**算法作用：** 标记详细布局阶段；当前 ECOS 默认流程不执行它。

<a id="parameter.dreamplace.stop_overflow"></a>
## parameter.dreamplace.stop_overflow

**含义：** 全局布局可接受 overflow 阈值。

**算法作用：** 决定迭代停止与是否允许进入 legalization。

<a id="parameter.dreamplace.dtype"></a>
## parameter.dreamplace.dtype

**含义：** 布局张量的数据类型。

**算法作用：** 影响数值精度、内存占用和已编译算子的计算类型。

<a id="parameter.dreamplace.detailed_place_engine"></a>
## parameter.dreamplace.detailed_place_engine

**含义：** 外部详细布局器路径。

**算法作用：** 路径存在时由 PlacementEngine 调用该工具处理全局布局后的结果。

<a id="parameter.dreamplace.detailed_place_command"></a>
## parameter.dreamplace.detailed_place_command

**含义：** 外部详细布局器附加命令。

**算法作用：** 作为外部 detailed placer 调用的命令片段。

<a id="parameter.dreamplace.plot_flag"></a>
## parameter.dreamplace.plot_flag

**含义：** 绘图开关。

**算法作用：** 控制布局迭代过程是否生成图形输出。

<a id="parameter.dreamplace.RePlAce_ref_hpwl"></a>
## parameter.dreamplace.RePlAce_ref_hpwl

**含义：** RePlAce 参考 HPWL。

**算法作用：** 用于 RePlAce 风格的收敛或参数更新标定。

<a id="parameter.dreamplace.RePlAce_LOWER_PCOF"></a>
## parameter.dreamplace.RePlAce_LOWER_PCOF

**含义：** RePlAce 下界系数。

**算法作用：** 参与 RePlAce 参数控制范围的判定。

<a id="parameter.dreamplace.RePlAce_UPPER_PCOF"></a>
## parameter.dreamplace.RePlAce_UPPER_PCOF

**含义：** RePlAce 上界系数。

**算法作用：** 参与 RePlAce 参数控制范围的判定。

<a id="parameter.dreamplace.gamma"></a>
## parameter.dreamplace.gamma

**含义：** 线长平滑参数。

**算法作用：** 影响平滑线长近似的曲率与梯度。

<a id="parameter.dreamplace.RePlAce_skip_energy_flag"></a>
## parameter.dreamplace.RePlAce_skip_energy_flag

**含义：** RePlAce energy 跳过标志。

**算法作用：** 控制相关能量计算是否参与 RePlAce 迭代。

<a id="parameter.dreamplace.random_center_init_flag"></a>
## parameter.dreamplace.random_center_init_flag

**含义：** 随机中心初始化开关。

**算法作用：** 将可移动单元从芯片中心附近随机展开，作为全局布局初始位置。

<a id="parameter.dreamplace.init_loc_perc_x"></a>
## parameter.dreamplace.init_loc_perc_x

**含义：** 初始位置的 X 百分比。

**算法作用：** 定义随机中心初始化相对布局边界的 X 坐标。

<a id="parameter.dreamplace.init_loc_perc_y"></a>
## parameter.dreamplace.init_loc_perc_y

**含义：** 初始位置的 Y 百分比。

**算法作用：** 定义随机中心初始化相对布局边界的 Y 坐标。

<a id="parameter.dreamplace.sort_nets_by_degree"></a>
## parameter.dreamplace.sort_nets_by_degree

**含义：** 按 net 度数排序开关。

**算法作用：** 改变 net 处理顺序，服务于布局数据准备。

<a id="parameter.dreamplace.num_threads"></a>
## parameter.dreamplace.num_threads

**含义：** CPU 线程数。

**算法作用：** 设置 OpenMP 和 Torch 的并行线程数。

<a id="parameter.dreamplace.dump_global_place_solution_flag"></a>
## parameter.dreamplace.dump_global_place_solution_flag

**含义：** 全局布局解导出开关。

**算法作用：** 控制是否在 legalizer 前保存 global placement 解。

<a id="parameter.dreamplace.dump_legalize_solution_flag"></a>
## parameter.dreamplace.dump_legalize_solution_flag

**含义：** 合法化解导出开关。

**算法作用：** 控制是否保存 legalizer 的结果。

<a id="parameter.dreamplace.routability_opt_flag"></a>
## parameter.dreamplace.routability_opt_flag

**含义：** 可布线性优化开关。

**算法作用：** 开启后允许 NonLinearPlace 进入面积调整等可布线性优化路径。

<a id="parameter.dreamplace.macro_place_flag"></a>
## parameter.dreamplace.macro_place_flag

**含义：** 宏单元布局开关。

**算法作用：** 启用宏单元的预处理和宏合法化相关路径。

<a id="parameter.dreamplace.use_bb"></a>
## parameter.dreamplace.use_bb

**含义：** bounding-box 近似开关。

**算法作用：** 影响线长或拥塞建模中使用的包围盒形式。

<a id="parameter.dreamplace.route_num_bins_x"></a>
## parameter.dreamplace.route_num_bins_x

**含义：** 路由评估网格 X 数量。

**算法作用：** 决定可布线性和拥塞估计的 X 向网格粒度。

<a id="parameter.dreamplace.route_num_bins_y"></a>
## parameter.dreamplace.route_num_bins_y

**含义：** 路由评估网格 Y 数量。

**算法作用：** 决定可布线性和拥塞估计的 Y 向网格粒度。

<a id="parameter.dreamplace.node_area_adjust_overflow"></a>
## parameter.dreamplace.node_area_adjust_overflow

**含义：** 节点面积调整触发 overflow。

**算法作用：** 在拥塞驱动布局中决定何时开始面积调整。

<a id="parameter.dreamplace.two_stage_density_scaler"></a>
## parameter.dreamplace.two_stage_density_scaler

**含义：** 两阶段密度缩放系数。

**算法作用：** 参与多阶段 density 模型的缩放。

<a id="parameter.dreamplace.max_num_area_adjust"></a>
## parameter.dreamplace.max_num_area_adjust

**含义：** 最大面积调整次数。

**算法作用：** 限制可布线性优化中反复调整节点面积的轮数。

<a id="parameter.dreamplace.adjust_nctugr_area_flag"></a>
## parameter.dreamplace.adjust_nctugr_area_flag

**含义：** EGR 面积调整开关。

**算法作用：** 使用 EGR 拥塞信息调节节点面积。

<a id="parameter.dreamplace.adjust_rudy_area_flag"></a>
## parameter.dreamplace.adjust_rudy_area_flag

**含义：** RUDY 面积调整开关。

**算法作用：** 使用 RUDY 拥塞估计调节节点面积。

<a id="parameter.dreamplace.adjust_pin_area_flag"></a>
## parameter.dreamplace.adjust_pin_area_flag

**含义：** pin 密度面积调整开关。

**算法作用：** 使用 pin 密度信息调节节点面积。

<a id="parameter.dreamplace.area_adjust_stop_ratio"></a>
## parameter.dreamplace.area_adjust_stop_ratio

**含义：** 面积调整停止比例。

**算法作用：** 当面积变化收敛到该比例时停止相关调整。

<a id="parameter.dreamplace.route_area_adjust_stop_ratio"></a>
## parameter.dreamplace.route_area_adjust_stop_ratio

**含义：** 路由面积调整停止比例。

**算法作用：** 控制路由拥塞驱动的面积调整收敛条件。

<a id="parameter.dreamplace.pin_area_adjust_stop_ratio"></a>
## parameter.dreamplace.pin_area_adjust_stop_ratio

**含义：** pin 面积调整停止比例。

**算法作用：** 控制 pin 密度驱动的面积调整收敛条件。

<a id="parameter.dreamplace.unit_horizontal_capacity"></a>
## parameter.dreamplace.unit_horizontal_capacity

**含义：** 单位水平布线容量。

**算法作用：** 用于将水平 routing demand 归一化为利用率。

<a id="parameter.dreamplace.unit_vertical_capacity"></a>
## parameter.dreamplace.unit_vertical_capacity

**含义：** 单位垂直布线容量。

**算法作用：** 用于将垂直 routing demand 归一化为利用率。

<a id="parameter.dreamplace.unit_pin_capacity"></a>
## parameter.dreamplace.unit_pin_capacity

**含义：** 单位 pin 容量。

**算法作用：** 用于 pin 密度相关的可布线性估计。

<a id="parameter.dreamplace.max_route_opt_adjust_rate"></a>
## parameter.dreamplace.max_route_opt_adjust_rate

**含义：** 最大路由面积调整率。

**算法作用：** 限制单轮可布线性优化扩大节点面积的幅度。

<a id="parameter.dreamplace.route_opt_adjust_exponent"></a>
## parameter.dreamplace.route_opt_adjust_exponent

**含义：** 路由调整指数。

**算法作用：** 塑造拥塞到面积调整率的非线性映射。

<a id="parameter.dreamplace.pin_stretch_ratio"></a>
## parameter.dreamplace.pin_stretch_ratio

**含义：** pin 拉伸比例。

**算法作用：** 在 pin 密度估计中扩展 pin 的有效影响范围。

<a id="parameter.dreamplace.max_pin_opt_adjust_rate"></a>
## parameter.dreamplace.max_pin_opt_adjust_rate

**含义：** 最大 pin 面积调整率。

**算法作用：** 限制 pin 密度驱动的单轮面积调整幅度。

<a id="parameter.dreamplace.deterministic_flag"></a>
## parameter.dreamplace.deterministic_flag

**含义：** 确定性执行开关。

**算法作用：** 请求确定性的底层计算路径以降低重复运行差异。

<a id="parameter.dreamplace.get_congestion_map"></a>
## parameter.dreamplace.get_congestion_map

**含义：** 拥塞图提取开关。

**算法作用：** 在布局完成后计算拥塞图并汇总拥塞分数。

<a id="parameter.dreamplace.macro_halo_x"></a>
## parameter.dreamplace.macro_halo_x

**含义：** 宏单元 X 向 halo。

**算法作用：** 在布局和密度建模中为可移动宏扩展水平占用范围。

<a id="parameter.dreamplace.macro_halo_y"></a>
## parameter.dreamplace.macro_halo_y

**含义：** 宏单元 Y 向 halo。

**算法作用：** 在布局和密度建模中为可移动宏扩展垂直占用范围。

<a id="parameter.dreamplace.macro_overlap_flag"></a>
## parameter.dreamplace.macro_overlap_flag

**含义：** 宏重叠惩罚开关。

**算法作用：** 控制目标函数是否包含宏重叠惩罚。

<a id="parameter.dreamplace.macro_overlap_weight"></a>
## parameter.dreamplace.macro_overlap_weight

**含义：** 宏重叠惩罚权重。

**算法作用：** 调节宏重叠项在全局布局目标中的影响。

<a id="parameter.dreamplace.macro_overlap_mult_weight"></a>
## parameter.dreamplace.macro_overlap_mult_weight

**含义：** 宏重叠惩罚乘子。

**算法作用：** 缩放宏重叠惩罚的更新强度。

<a id="parameter.dreamplace.cell_padding_x"></a>
## parameter.dreamplace.cell_padding_x

**含义：** 标准单元 X 向 padding。

**算法作用：** 在布局模型中扩大单元有效宽度，为后续合法化保留水平间距。

<a id="parameter.dreamplace.bndry_padding_x"></a>
## parameter.dreamplace.bndry_padding_x

**含义：** 布局边界 X 向 padding。

**算法作用：** 缩小可移动单元的有效水平放置范围。

<a id="parameter.dreamplace.bndry_padding_y"></a>
## parameter.dreamplace.bndry_padding_y

**含义：** 布局边界 Y 向 padding。

**算法作用：** 缩小可移动单元的有效垂直放置范围。

<a id="parameter.dreamplace.pin_density"></a>
## parameter.dreamplace.pin_density

**含义：** pin 密度目标或阈值。

**算法作用：** 参与 pin-density 拥塞估计和面积调整。

<a id="parameter.dreamplace.route_info_input"></a>
## parameter.dreamplace.route_info_input

**含义：** 路由信息输入选择。

**算法作用：** 决定布局器使用哪一份路由容量或拥塞信息。

<a id="parameter.dreamplace.evaluate_pl"></a>
## parameter.dreamplace.evaluate_pl

**含义：** 已有布局评估模式开关。

**算法作用：** 开启时关闭常规优化路径并对输入 placement 执行评估。

<a id="parameter.dreamplace.risa_weights"></a>
## parameter.dreamplace.risa_weights

**含义：** RISA 权重开关。

**算法作用：** 控制相关加权策略是否参与布局目标或评估。

<a id="parameter.dreamplace.macro_pin_halo_x"></a>
## parameter.dreamplace.macro_pin_halo_x

**含义：** 宏 pin X 向 halo。

**算法作用：** 扩展宏 pin 的水平影响范围，用于密度或拥塞建模。

<a id="parameter.dreamplace.macro_pin_halo_y"></a>
## parameter.dreamplace.macro_pin_halo_y

**含义：** 宏 pin Y 向 halo。

**算法作用：** 扩展宏 pin 的垂直影响范围，用于密度或拥塞建模。

<a id="parameter.dreamplace.timing_opt_flag"></a>
## parameter.dreamplace.timing_opt_flag

**含义：** 时序优化开关。

**算法作用：** 当前 ECOS 执行边界会关闭它，因此不参与当前布局算法。

<a id="parameter.dreamplace.timing_eval_flag"></a>
## parameter.dreamplace.timing_eval_flag

**含义：** 时序评估开关。

**算法作用：** 当前 ECOS 执行边界会关闭它，因此不参与当前布局算法。

<a id="parameter.dreamplace.enable_net_weighting"></a>
## parameter.dreamplace.enable_net_weighting

**含义：** net 权重更新开关。

**算法作用：** 控制时序或其他策略是否更新 net 在布局目标中的权重。

<a id="parameter.dreamplace.with_sta"></a>
## parameter.dreamplace.with_sta

**含义：** STA 集成开关。

**算法作用：** 当前 ECOS 执行边界会关闭它，因此不初始化 STA 路径。

<a id="parameter.dreamplace.differentiable_timing_obj"></a>
## parameter.dreamplace.differentiable_timing_obj

**含义：** 可微时序目标开关。

**算法作用：** 当前 ECOS 执行边界会关闭它，因此不加入布局目标。

<a id="parameter.dreamplace.pin2pin_max_weight"></a>
## parameter.dreamplace.pin2pin_max_weight

**含义：** pin-to-pin 最大权重。

**算法作用：** 限制 pin-to-pin 时序或连接加权的上界。

<a id="parameter.dreamplace.pin2pin_min_weight"></a>
## parameter.dreamplace.pin2pin_min_weight

**含义：** pin-to-pin 最小权重。

**算法作用：** 限制 pin-to-pin 时序或连接加权的下界。

<a id="parameter.dreamplace.pin2pin_accumulate_weight"></a>
## parameter.dreamplace.pin2pin_accumulate_weight

**含义：** pin-to-pin 累积权重。

**算法作用：** 控制多轮 pin-to-pin 权重更新的累积程度。

<a id="parameter.dreamplace.pin2pin_weight"></a>
## parameter.dreamplace.pin2pin_weight

**含义：** pin-to-pin 基础权重。

**算法作用：** 为 pin-to-pin 相关加权提供初始尺度。

<a id="parameter.dreamplace.pin2pin_net_weighting"></a>
## parameter.dreamplace.pin2pin_net_weighting

**含义：** pin-to-pin net 加权开关。

**算法作用：** 控制 pin-to-pin 信息是否反馈到 net 权重。

<a id="parameter.dreamplace.net_weighting_scheme"></a>
## parameter.dreamplace.net_weighting_scheme

**含义：** net 权重方案名称。

**算法作用：** 选择 net 权重的计算或更新策略。

<a id="parameter.dreamplace.momentum_decay_factor"></a>
## parameter.dreamplace.momentum_decay_factor

**含义：** 权重更新动量衰减。

**算法作用：** 平滑跨迭代的权重变化。

<a id="parameter.dreamplace.start_iter"></a>
## parameter.dreamplace.start_iter

**含义：** 权重或优化起始迭代。

**算法作用：** 延迟相关更新路径的启用时机。

<a id="parameter.dreamplace.max_net_weight"></a>
## parameter.dreamplace.max_net_weight

**含义：** net 权重上限。

**算法作用：** 防止少数 net 在布局目标中占据过大权重。

<a id="parameter.dreamplace.base_design_name"></a>
## parameter.dreamplace.base_design_name

**含义：** 基础设计名。

**算法作用：** 用于命名布局输出和中间文件。

<a id="parameter.place.global_right_padding"></a>
## parameter.place.global_right_padding

**含义：** placement site 的全局右侧 padding。

**算法作用：** 缩小可用于布局与合法化的右侧 site 区域，为边界保留空间。
