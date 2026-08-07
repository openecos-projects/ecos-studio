#!/usr/bin/env python3
"""Build the committed, source-audited ECOS placement knowledge bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path


AGENT_ROOT = Path(__file__).parents[1]
ECOS_ROOT = AGENT_ROOT.parents[1]
DEFAULT_OUTPUT = AGENT_ROOT / "src" / "ecos_agent" / "place_knowledge"

SOURCE_PATHS = {
    "dreamplace.config": "ecc/chipcompiler/tools/ecc_dreamplace/configs/dreamplace.json",
    "dreamplace.overrides": "ecc/chipcompiler/tools/ecc_dreamplace/parameter_overrides.py",
    "ecos.params": "ecc/chipcompiler/cli/project/params.py",
    "dreamplace.runner": "ecc/chipcompiler/tools/ecc_dreamplace/runner.py",
    "dreamplace.module": "ecc/chipcompiler/tools/ecc_dreamplace/module.py",
    "dreamplace.placer": "ecc/chipcompiler/thirdparty/ecc-dreamplace/dreamplace/Placer.py",
    "dreamplace.nonlinear": "ecc/chipcompiler/thirdparty/ecc-dreamplace/dreamplace/NonLinearPlace.py",
    "dreamplace.objective": "ecc/chipcompiler/thirdparty/ecc-dreamplace/dreamplace/PlaceObj.py",
    "ecc.congestion": "ecc/chipcompiler/thirdparty/ecc-tools/src/evaluation/src/module/congestion/congestion_eval.cpp",
    "ecc.metrics": "ecc/chipcompiler/tools/ecc/metrics.py",
    "ecc.builder": "ecc/chipcompiler/tools/ecc/builder.py",
    "dreamplace.utility": "ecc/chipcompiler/tools/ecc_dreamplace/utility.py",
}

GUI_PARAMETER_MAP = {
    "target_density": "place.target_density",
    "stop_overflow": "place.target_overflow",
    "cell_padding_x": "place.cell_padding_x",
    "routability_opt_flag": "place.routability_opt",
}
FORCED_OFF = {"with_sta", "timing_opt_flag", "timing_eval_flag", "differentiable_timing_obj"}


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _revision(path: Path) -> str:
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def _source_inventory() -> dict[str, object]:
    sources = []
    for source_id, relative_path in SOURCE_PATHS.items():
        path = ECOS_ROOT / relative_path
        sources.append({"id": source_id, "path": relative_path, "sha256": _sha256(path.read_bytes())})
    return {
        "schema_version": "ecos-place-sources.v1",
        "repositories": {
            "ecc": _revision(ECOS_ROOT / "ecc"),
            "ecc_dreamplace": _revision(ECOS_ROOT / "ecc/chipcompiler/thirdparty/ecc-dreamplace"),
            "ecc_tools": _revision(ECOS_ROOT / "ecc/chipcompiler/thirdparty/ecc-tools"),
        },
        "sources": sources,
    }


def _section(entity_id: str, body: str, evidence: tuple[str, ...], *, include_evidence: bool) -> str:
    references = ", ".join(f"**{source_id}**" for source_id in evidence)
    suffix = f"\n\n**源码证据：** {references}" if include_evidence else ""
    return f'<a id="{entity_id}"></a>\n## {entity_id}\n\n{body.strip()}{suffix}\n'


def _add(entries: list[dict[str, object]], documents: dict[str, list[str]], *, entity_id: str, kind: str, aliases: tuple[str, ...], document: str, body: str, evidence: tuple[str, ...], include_evidence: bool = True) -> None:
    chunk = _section(entity_id, body, evidence, include_evidence=include_evidence)
    documents.setdefault(document, []).append(chunk)
    entries.append({
        "id": entity_id,
        "kind": kind,
        "aliases": list(aliases),
        "document": document,
        "anchor": entity_id,
        "review_status": "source-audited",
        "evidence": [{"source_id": source_id} for source_id in evidence],
        "chunk_sha256": _sha256(chunk.strip().encode("utf-8")),
    })


PARAMETER_SEMANTICS = {
    "aux_input": ("Bookshelf AUX 输入描述。", "为 Bookshelf 格式的数据读取提供设计入口。"),
    "lef_input": ("LEF 文件集合。", "向布局数据库提供工艺层、site 和单元几何。"),
    "def_input": ("输入 DEF 路径。", "向布局数据库提供当前物理位置和约束；ECOS 在运行边界替换为 step 输入。"),
    "verilog_input": ("输入网表路径。", "向布局数据库提供逻辑连接；ECOS 在运行边界替换为 step 输入。"),
    "gpu": ("是否请求 GPU 执行。", "决定张量和已编译算子使用 CPU 或 CUDA 设备。"),
    "gpu_id": ("CUDA 设备编号。", "在 GPU 模式下选择承载布局张量和算子的设备。"),
    "num_bins_x": ("density bin 的 X 方向数量。", "决定密度、电势和全局布局评估的空间离散粒度。"),
    "num_bins_y": ("density bin 的 Y 方向数量。", "决定密度、电势和全局布局评估的空间离散粒度。"),
    "global_place_stages": ("全局布局阶段表。", "定义每个阶段的 bin 数、迭代次数、线长模型、优化器和学习率。"),
    "target_density": ("全局布局中 density bin 的目标放置密度。它不是 floorplan 的 Core.Utilitization。", "作为 density overflow 与 electric-potential 密度项的目标，平衡线长与可放置面积。"),
    "density_weight": ("密度惩罚的初始权重。", "控制目标函数中 density penalty 相对平滑线长的影响，并参与权重更新。"),
    "random_seed": ("随机数种子。", "初始化 Python、Torch 与 CUDA 随机状态，影响可重复的初始扰动。"),
    "result_dir": ("布局运行结果目录。", "承载 DreamPlace 日志和中间结果。"),
    "scale_factor": ("坐标和线长换算比例。", "用于将布局数据库的数值在评估和输出时统一到相应尺度。"),
    "ignore_net_weight": ("大权重 net 的忽略阈值。", "在加权 HPWL 评估中筛除过大权重 net。"),
    "shift_factor": ("输入坐标平移量。", "在数据读入阶段调整坐标原点。"),
    "ignore_net_degree": ("net 度数忽略阈值。", "用于屏蔽高扇出 net，避免其主导线长和部分评估算子。"),
    "gp_noise_ratio": ("全局布局初始化噪声比例。", "决定随机中心初始化时施加的位置扰动强度。"),
    "auto_adjust_bins": ("自动调整 density bin 的开关。", "允许布局器根据设计数据调整密度网格设置。"),
    "enable_fillers": ("是否插入 filler 节点。", "filler 节点参与密度模型，使连续优化能反映可用面积。"),
    "global_place_flag": ("是否执行全局布局。", "控制是否进入 NonLinearPlace 的连续优化循环。"),
    "legalize_flag": ("是否执行内部合法化。", "控制全局布局后是否调用 legalizer 消除重叠并对齐 site。"),
    "detailed_place_flag": ("是否启用详细布局标志。", "标记详细布局阶段；当前 ECOS 默认流程不执行它。"),
    "stop_overflow": ("全局布局可接受 overflow 阈值。", "决定迭代停止与是否允许进入 legalization。"),
    "dtype": ("布局张量的数据类型。", "影响数值精度、内存占用和已编译算子的计算类型。"),
    "detailed_place_engine": ("外部详细布局器路径。", "路径存在时由 PlacementEngine 调用该工具处理全局布局后的结果。"),
    "detailed_place_command": ("外部详细布局器附加命令。", "作为外部 detailed placer 调用的命令片段。"),
    "plot_flag": ("绘图开关。", "控制布局迭代过程是否生成图形输出。"),
    "RePlAce_ref_hpwl": ("RePlAce 参考 HPWL。", "用于 RePlAce 风格的收敛或参数更新标定。"),
    "RePlAce_LOWER_PCOF": ("RePlAce 下界系数。", "参与 RePlAce 参数控制范围的判定。"),
    "RePlAce_UPPER_PCOF": ("RePlAce 上界系数。", "参与 RePlAce 参数控制范围的判定。"),
    "gamma": ("线长平滑参数。", "影响平滑线长近似的曲率与梯度。"),
    "RePlAce_skip_energy_flag": ("RePlAce energy 跳过标志。", "控制相关能量计算是否参与 RePlAce 迭代。"),
    "random_center_init_flag": ("随机中心初始化开关。", "将可移动单元从芯片中心附近随机展开，作为全局布局初始位置。"),
    "init_loc_perc_x": ("初始位置的 X 百分比。", "定义随机中心初始化相对布局边界的 X 坐标。"),
    "init_loc_perc_y": ("初始位置的 Y 百分比。", "定义随机中心初始化相对布局边界的 Y 坐标。"),
    "sort_nets_by_degree": ("按 net 度数排序开关。", "改变 net 处理顺序，服务于布局数据准备。"),
    "num_threads": ("CPU 线程数。", "设置 OpenMP 和 Torch 的并行线程数。"),
    "dump_global_place_solution_flag": ("全局布局解导出开关。", "控制是否在 legalizer 前保存 global placement 解。"),
    "dump_legalize_solution_flag": ("合法化解导出开关。", "控制是否保存 legalizer 的结果。"),
    "routability_opt_flag": ("可布线性优化开关。", "开启后允许 NonLinearPlace 进入面积调整等可布线性优化路径。"),
    "macro_place_flag": ("宏单元布局开关。", "启用宏单元的预处理和宏合法化相关路径。"),
    "use_bb": ("bounding-box 近似开关。", "影响线长或拥塞建模中使用的包围盒形式。"),
    "route_num_bins_x": ("路由评估网格 X 数量。", "决定可布线性和拥塞估计的 X 向网格粒度。"),
    "route_num_bins_y": ("路由评估网格 Y 数量。", "决定可布线性和拥塞估计的 Y 向网格粒度。"),
    "node_area_adjust_overflow": ("节点面积调整触发 overflow。", "在拥塞驱动布局中决定何时开始面积调整。"),
    "two_stage_density_scaler": ("两阶段密度缩放系数。", "参与多阶段 density 模型的缩放。"),
    "max_num_area_adjust": ("最大面积调整次数。", "限制可布线性优化中反复调整节点面积的轮数。"),
    "adjust_nctugr_area_flag": ("EGR 面积调整开关。", "使用 EGR 拥塞信息调节节点面积。"),
    "adjust_rudy_area_flag": ("RUDY 面积调整开关。", "使用 RUDY 拥塞估计调节节点面积。"),
    "adjust_pin_area_flag": ("pin 密度面积调整开关。", "使用 pin 密度信息调节节点面积。"),
    "area_adjust_stop_ratio": ("面积调整停止比例。", "当面积变化收敛到该比例时停止相关调整。"),
    "route_area_adjust_stop_ratio": ("路由面积调整停止比例。", "控制路由拥塞驱动的面积调整收敛条件。"),
    "pin_area_adjust_stop_ratio": ("pin 面积调整停止比例。", "控制 pin 密度驱动的面积调整收敛条件。"),
    "unit_horizontal_capacity": ("单位水平布线容量。", "用于将水平 routing demand 归一化为利用率。"),
    "unit_vertical_capacity": ("单位垂直布线容量。", "用于将垂直 routing demand 归一化为利用率。"),
    "unit_pin_capacity": ("单位 pin 容量。", "用于 pin 密度相关的可布线性估计。"),
    "max_route_opt_adjust_rate": ("最大路由面积调整率。", "限制单轮可布线性优化扩大节点面积的幅度。"),
    "route_opt_adjust_exponent": ("路由调整指数。", "塑造拥塞到面积调整率的非线性映射。"),
    "pin_stretch_ratio": ("pin 拉伸比例。", "在 pin 密度估计中扩展 pin 的有效影响范围。"),
    "max_pin_opt_adjust_rate": ("最大 pin 面积调整率。", "限制 pin 密度驱动的单轮面积调整幅度。"),
    "deterministic_flag": ("确定性执行开关。", "请求确定性的底层计算路径以降低重复运行差异。"),
    "get_congestion_map": ("拥塞图提取开关。", "在布局完成后计算拥塞图并汇总拥塞分数。"),
    "macro_halo_x": ("宏单元 X 向 halo。", "在布局和密度建模中为可移动宏扩展水平占用范围。"),
    "macro_halo_y": ("宏单元 Y 向 halo。", "在布局和密度建模中为可移动宏扩展垂直占用范围。"),
    "macro_overlap_flag": ("宏重叠惩罚开关。", "控制目标函数是否包含宏重叠惩罚。"),
    "macro_overlap_weight": ("宏重叠惩罚权重。", "调节宏重叠项在全局布局目标中的影响。"),
    "macro_overlap_mult_weight": ("宏重叠惩罚乘子。", "缩放宏重叠惩罚的更新强度。"),
    "cell_padding_x": ("标准单元 X 向 padding。", "在布局模型中扩大单元有效宽度，为后续合法化保留水平间距。"),
    "bndry_padding_x": ("布局边界 X 向 padding。", "缩小可移动单元的有效水平放置范围。"),
    "bndry_padding_y": ("布局边界 Y 向 padding。", "缩小可移动单元的有效垂直放置范围。"),
    "pin_density": ("pin 密度目标或阈值。", "参与 pin-density 拥塞估计和面积调整。"),
    "route_info_input": ("路由信息输入选择。", "决定布局器使用哪一份路由容量或拥塞信息。"),
    "evaluate_pl": ("已有布局评估模式开关。", "开启时关闭常规优化路径并对输入 placement 执行评估。"),
    "risa_weights": ("RISA 权重开关。", "控制相关加权策略是否参与布局目标或评估。"),
    "macro_pin_halo_x": ("宏 pin X 向 halo。", "扩展宏 pin 的水平影响范围，用于密度或拥塞建模。"),
    "macro_pin_halo_y": ("宏 pin Y 向 halo。", "扩展宏 pin 的垂直影响范围，用于密度或拥塞建模。"),
    "timing_opt_flag": ("时序优化开关。", "当前 ECOS 执行边界会关闭它，因此不参与当前布局算法。"),
    "timing_eval_flag": ("时序评估开关。", "当前 ECOS 执行边界会关闭它，因此不参与当前布局算法。"),
    "enable_net_weighting": ("net 权重更新开关。", "控制时序或其他策略是否更新 net 在布局目标中的权重。"),
    "with_sta": ("STA 集成开关。", "当前 ECOS 执行边界会关闭它，因此不初始化 STA 路径。"),
    "differentiable_timing_obj": ("可微时序目标开关。", "当前 ECOS 执行边界会关闭它，因此不加入布局目标。"),
    "pin2pin_max_weight": ("pin-to-pin 最大权重。", "限制 pin-to-pin 时序或连接加权的上界。"),
    "pin2pin_min_weight": ("pin-to-pin 最小权重。", "限制 pin-to-pin 时序或连接加权的下界。"),
    "pin2pin_accumulate_weight": ("pin-to-pin 累积权重。", "控制多轮 pin-to-pin 权重更新的累积程度。"),
    "pin2pin_weight": ("pin-to-pin 基础权重。", "为 pin-to-pin 相关加权提供初始尺度。"),
    "pin2pin_net_weighting": ("pin-to-pin net 加权开关。", "控制 pin-to-pin 信息是否反馈到 net 权重。"),
    "net_weighting_scheme": ("net 权重方案名称。", "选择 net 权重的计算或更新策略。"),
    "momentum_decay_factor": ("权重更新动量衰减。", "平滑跨迭代的权重变化。"),
    "start_iter": ("权重或优化起始迭代。", "延迟相关更新路径的启用时机。"),
    "max_net_weight": ("net 权重上限。", "防止少数 net 在布局目标中占据过大权重。"),
    "base_design_name": ("基础设计名。", "用于命名布局输出和中间文件。"),
}


def _parameter_body(name: str, _default: object) -> str:
    meaning, role = PARAMETER_SEMANTICS[name]
    return f"**含义：** {meaning}\n\n**算法作用：** {role}"


def _add_parameters(entries: list[dict[str, object]], documents: dict[str, list[str]], config: dict[str, object]) -> None:
    for name, default in config.items():
        evidence = ("dreamplace.config", "dreamplace.overrides", "dreamplace.module")
        if name in GUI_PARAMETER_MAP:
            evidence += ("ecos.params",)
        if name == "target_density":
            evidence += ("dreamplace.objective",)
        _add(entries, documents, entity_id=f"parameter.dreamplace.{name}", kind="parameter", aliases=(name, name.replace("_", " "), f"DreamPlace {name}"), document="parameters.md", body=_parameter_body(name, default), evidence=evidence, include_evidence=False)
    _add(entries, documents, entity_id="parameter.place.global_right_padding", kind="parameter", aliases=("global right padding", "global_right_padding", "布局右侧留白"), document="parameters.md", body="**含义：** placement site 的全局右侧 padding。\n\n**算法作用：** 缩小可用于布局与合法化的右侧 site 区域，为边界保留空间。", evidence=("ecos.params",), include_evidence=False)


def _add_algorithms(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    _add(entries, documents, entity_id="algorithm.place.execution", kind="algorithm", aliases=("place内部算法", "place算法", "布局算法", "布局流程", "place执行流程", "place如何执行", "place怎么执行", "place怎么运行", "place execution", "place flow", "how does place execute", "how does place work", "placement algorithm"), document="algorithms.md", body="**调用链：** ecc_dreamplace.runner.run_placement() 获取 ECC module，构造 DreamplaceModule；DreamplaceModule._run() 构造 PlacementEngine，依次调用 setup_rawdb() 与 run()；后者建立 placement DB 并调用 NonLinearPlace。\n\n**默认阶段：** 当前默认配置开启 global placement 与 internal legalization，关闭 detailed placement。\n\n**后续：** place 返回后 runner 请求 placement feature map、保存数据和分析；这些调用不等同于证明所有产物都已成功落盘。", evidence=("dreamplace.runner", "dreamplace.module", "dreamplace.placer", "dreamplace.config"))
    _add(entries, documents, entity_id="algorithm.dreamplace.global_placement", kind="algorithm", aliases=("global placement", "全局布局", "nesterov", "非线性布局"), document="algorithms.md", body="NonLinearPlace 以平滑线长和 density penalty 的目标迭代。当前 global_place_stages 配置是 32x32 bins、1000 iterations、weighted_average wirelength 与 nesterov optimizer。\n\n如果最后一次度量的 overflow 大于 stop_overflow，或 objective 为 Inf 或 NaN，实现会跳过 legalizer 和 detailed placement，并返回无穷 HPWL 作为失败信号。", evidence=("dreamplace.config", "dreamplace.nonlinear", "dreamplace.objective"))
    _add(entries, documents, entity_id="algorithm.dreamplace.routability_optimization", kind="algorithm", aliases=("routability optimization", "routability opt", "可布线优化", "拥塞驱动布局"), document="algorithms.md", body="routability_opt_flag 为 1 时，NonLinearPlace 进入可布线性优化路径。当前快照默认开启 EGR 面积调整，关闭 RUDY 和 pin 面积调整；具体是否发生调整仍取决于迭代中的阈值与数据。", evidence=("dreamplace.config", "dreamplace.nonlinear", "dreamplace.objective"))
    _add(entries, documents, entity_id="algorithm.dreamplace.legalization", kind="algorithm", aliases=("legalization", "合法化", "布局合法化", "cts后合法化"), document="algorithms.md", body="普通 place 的默认 legalize_flag 为 1，因此 global placement 收敛后会在同次布局中进行内部 legalization。CTS 后的独立 legalization 步调用同一模块，但强制 global_place_flag 为 0、legalize_flag 为 1、enable_fillers 为 0，所以它不是再次全局布局。", evidence=("dreamplace.config", "dreamplace.module", "dreamplace.nonlinear"))
    _add(entries, documents, entity_id="algorithm.dreamplace.detailed_placement", kind="algorithm", aliases=("detailed placement", "详细布局", "细节布局"), document="algorithms.md", body="当前默认 detailed_place_flag 为 0，因此 detailed placement 不是默认 place 路径的一部分。PlacementEngine 仅在 detailed_place_engine 被设置且本地路径存在时调用外部 detailed placer；不存在时记录 warning。", evidence=("dreamplace.config", "dreamplace.placer"))


def _add_metrics(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    descriptions = {
        "place_hpwl": "从 placement map 的 /Wirelength/HPWL 提取，单位为 um，极性为 lower-is-better。",
        "place_grwl": "从 placement map 的 /Wirelength/GRWL 提取，单位为 um，极性为 lower-is-better。",
        "place_flute_wirelength": "从 placement map 的 /Wirelength/FLUTE 提取，单位为 um，极性为 lower-is-better。",
        "place_congestion_egr_overflow_total": "从 placement map 的 EGR overflow.total.union 提取，单位为 count，极性为 lower-is-better。",
        "place_congestion_egr_overflow_max": "从 placement map 的 EGR overflow.max.union 提取，单位为 count，极性为 lower-is-better。",
        "place_lutrudy_utilization_max": "从 placement map 的 /Congestion/utilization/lutrudy/max/union 提取，单位为 ratio。此快照未在本块推断 LUT-RUDY 的内部公式。",
    }
    for metric, body in descriptions.items():
        _add(entries, documents, entity_id=f"metric.{metric}", kind="metric", aliases=(metric, metric.replace("_", " "), metric.removeprefix("place_")), document="metrics.md", body=body, evidence=("ecc.metrics",))
    _add(entries, documents, entity_id="metric.place_rudy_utilization_max", kind="metric", aliases=("RUDY", "RUDY指标", "RUDY如何计算", "rudy utilization", "how is rudy calculated", "how to calculate rudy"), document="metrics.md", body="**ECOS 对外指标：** place_rudy_utilization_max 从 placement map 的 /Congestion/utilization/rudy/max/union 读取。\n\n**计算：** ECC congestion evaluator 对每条 net 取 pins 的 bounding box，对每个相交 grid 计算 overlap_area。horizontal 贡献为 overlap_area / bbox_height / grid_area，vertical 贡献为 overlap_area / bbox_width / grid_area，union 为两者相加；退化 bbox 的对应倒数设为 1.0。evaluator 写出该 density grid；ECOS feature map 暴露 union 的 max，再由 metrics 提取。\n\n**边界：** 这是布局期、feature-map 的 RUDY 估计，不是详细布线完成后的真实 overflow；也不要把它与 DreamPlace 内部 torch RUDY operator 混为同一对外指标。", evidence=("ecc.congestion", "ecc.metrics", "dreamplace.placer"))


def _add_artifacts(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    paths = {
        "output_def": "output/{design}_place.def.gz",
        "output_verilog": "output/{design}_place.v.gz",
        "output_gds": "output/{design}_place.gds",
        "output_db": "output/{design}_place_db",
        "output_image": "output/{design}_place.png",
        "output_json": "output/{design}_place.json",
        "geometry": "output/geometry 和 geometry/geometry.manifest",
        "view_json": "output/{design}_place_view",
        "feature_db": "feature/place.db.json",
        "feature_step": "feature/place.step.json",
        "feature_map": "feature/place.map.json",
        "qor_metrics": "analysis/qor_metrics.json",
        "qor_summary": "analysis/qor_summary.json",
        "qor_hotspots": "analysis/qor_hotspots.json",
        "log": "log/place.log，DreamPlace module 默认日志名为 dreamplace_placement.log",
    }
    _add(entries, documents, entity_id="artifact.place.outputs", kind="artifact", aliases=("place产物", "布局产物", "place outputs", "place输出文件", "产物", "输出"), document="artifacts.md", body="ECOS builder 为 place 定义输出、feature、analysis、report、log 和 script 路径。下列实体描述预期路径；是否实际存在必须由 workspace artifact 检查确认。", evidence=("ecc.builder", "dreamplace.module"))
    for name, path in paths.items():
        _add(entries, documents, entity_id=f"artifact.place.{name}", kind="artifact", aliases=(name, name.replace("_", " "), path), document="artifacts.md", body=f"**预期路径：** {path}。\n\n**边界：** builder 的路径定义不是运行成功证明。", evidence=("ecc.builder", "dreamplace.module"))


def _add_failures(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    records = [
        ("dreamplace_import", ("dreamplace import failed", "DreamPlace导入失败"), "is_eda_exist() 捕获 DreamPlace import 异常并记录 dreamplace: import failed，随后 step 返回 False。检查运行环境中的 dreamplace 模块和编译依赖。", ("dreamplace.utility", "dreamplace.runner")),
        ("missing_ecc_module", ("ECC module unavailable", "ECC模块不可用"), "runner 只有在 get_eda_instance() 返回非空 ECC module 时才调用 DreamPlace；为空时 placement 不会进入 module。", ("dreamplace.runner",)),
        ("overflow_or_nonfinite_objective", ("place overflow nan inf", "布局overflow或NaN"), "NonLinearPlace 在最后 overflow 超过 stop_overflow，或 objective 是 Inf 或 NaN 时跳过 legalization 和 detail，并返回无穷 HPWL。", ("dreamplace.nonlinear",)),
        ("infinite_hpwl", ("hpwl inf", "HPWL无穷"), 'DreamplaceModule 将 ppa["hpwl"] == inf 视为失败并返回 False。', ("dreamplace.module",)),
        ("missing_feature_map", ("place map missing", "place map缺失"), "runner 会请求 feature_placement_map(json_path=step.feature.map)；预期 map 缺失时不能声称 QoR 指标已经生成。", ("dreamplace.runner", "ecc.builder")),
        ("missing_external_detailed_placer", ("detailed placer missing", "详细布局器缺失"), "如果设定了 detailed_place_engine 但路径不存在，PlacementEngine 仅记录 warning；当前默认 detailed placement 关闭。", ("dreamplace.placer", "dreamplace.config")),
        ("misleading_subflow_success", ("subflow success", "subflow成功但失败"), "当前 runner 在 DreamPlace 返回后无条件把 subflow 的 run-placement 标为 success，再由 save_data 覆盖 reslut。因此 subflow success 不能单独作为布局成功证据；需核对终态、日志和产物。", ("dreamplace.runner", "dreamplace.module")),
    ]
    for name, aliases, body, evidence in records:
        _add(entries, documents, entity_id=f"failure.place.{name}", kind="failure_mode", aliases=aliases, document="failures.md", body=body, evidence=evidence)


def _write_regression(output: Path) -> None:
    cases = [
        {"id": "target-density", "question": "place阶段的target density这个参数的含义是什么？", "entity_id": "parameter.dreamplace.target_density", "required_text": "目标放置密度"},
        {"id": "execution", "question": "place内部算法是如何执行的？", "entity_id": "algorithm.place.execution", "required_text": "NonLinearPlace"},
        {"id": "rudy", "question": "RUDY指标是如何计算的？", "entity_id": "metric.place_rudy_utilization_max", "required_text": "overlap_area"},
        {"id": "hpwl", "question": "place HPWL指标来自哪里？", "entity_id": "metric.place_hpwl", "required_text": "/Wirelength/HPWL"},
        {"id": "artifact", "question": "place阶段有哪些产物？", "entity_id": "artifact.place.outputs", "required_text": "预期路径"},
        {"id": "failure", "question": "dreamplace import failed 怎么理解？", "entity_id": "failure.place.dreamplace_import", "required_text": "dreamplace: import failed"},
    ]
    regression = output / "regression"
    regression.mkdir(exist_ok=True)
    regression.joinpath("place_questions.jsonl").write_text("".join(_json(case) + "\n" for case in cases), encoding="utf-8")


def _build(output: Path) -> None:
    config = json.loads((ECOS_ROOT / SOURCE_PATHS["dreamplace.config"]).read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    knowledge = output / "knowledge"
    knowledge.mkdir(exist_ok=True)
    entries: list[dict[str, object]] = []
    documents: dict[str, list[str]] = {}
    _add_parameters(entries, documents, config)
    _add_algorithms(entries, documents)
    _add_metrics(entries, documents)
    _add_artifacts(entries, documents)
    _add_failures(entries, documents)
    for name, chunks in documents.items():
        (knowledge / name).write_text("\n".join(chunks), encoding="utf-8")
    sources = _source_inventory()
    catalog = {"schema_version": "ecos-place-catalog.v2", "domain": "ecos_placement", "publication": {"status": "source-audited", "scope": "ECOS place and DreamPlace source snapshot"}, "entities": entries}
    (output / "catalog.json").write_text(_json(catalog) + "\n", encoding="utf-8")
    (output / "sources.json").write_text(_json(sources) + "\n", encoding="utf-8")
    _write_regression(output)
    files = {str(path.relative_to(output)): _sha256(path.read_bytes()) for path in sorted(output.rglob("*")) if path.is_file() and path.name != "manifest.json"}
    manifest = {"schema_version": "ecos-place-manifest.v1", "files": files, "entity_count": len(entries)}
    (output / "manifest.json").write_text(_json(manifest) + "\n", encoding="utf-8")


def _bundle_matches(generated: Path, current: Path) -> bool:
    return current.exists() and all((current / path.relative_to(generated)).is_file() and path.read_bytes() == (current / path.relative_to(generated)).read_bytes() for path in generated.rglob("*") if path.is_file())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.check:
        _build(args.output)
        return 0
    with tempfile.TemporaryDirectory() as directory:
        generated = Path(directory) / "place_knowledge"
        _build(generated)
        if not _bundle_matches(generated, args.output):
            raise SystemExit("place knowledge bundle is stale; run scripts/build_place_knowledge.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
