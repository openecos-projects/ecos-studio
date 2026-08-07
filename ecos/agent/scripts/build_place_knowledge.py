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
    "aux_input": ("The Bookshelf AUX input descriptor.", "It supplies the design entry point for Bookshelf-format input."),
    "lef_input": ("The LEF file set.", "It provides technology layers, sites, and cell geometry to the placement database."),
    "def_input": ("The input DEF path.", "It provides physical locations and constraints; ECOS replaces it with the current step input at runtime."),
    "verilog_input": ("The input netlist path.", "It provides logical connectivity; ECOS replaces it with the current step input at runtime."),
    "gpu": ("Whether to request GPU execution.", "It selects CPU or CUDA execution for tensors and compiled operators."),
    "gpu_id": ("The CUDA device index.", "It selects the device that owns placement tensors and operators in GPU mode."),
    "num_bins_x": ("The number of density bins along X.", "It sets the spatial resolution for density, electric potential, and global-placement evaluation."),
    "num_bins_y": ("The number of density bins along Y.", "It sets the spatial resolution for density, electric potential, and global-placement evaluation."),
    "global_place_stages": ("The global-placement stage schedule.", "It defines bins, iterations, wirelength model, optimizer, and learning rate for each stage."),
    "target_density": ("The target placement density of each density bin during global placement. It is not floorplan Core.Utilitization.", "It is the target of the density-overflow and electric-potential terms, balancing wirelength against placeable area."),
    "density_weight": ("The initial density-penalty weight.", "It controls the density penalty relative to smooth wirelength and participates in weight updates."),
    "random_seed": ("The random seed.", "It initializes Python, Torch, and CUDA random state for reproducible initial perturbations."),
    "result_dir": ("The placement result directory.", "It receives DreamPlace logs and intermediate outputs."),
    "scale_factor": ("The coordinate and wirelength conversion scale.", "It keeps placement-database values consistent during evaluation and output."),
    "ignore_net_weight": ("The threshold for ignoring high-weight nets.", "It filters excessively weighted nets from weighted-HPWL evaluation."),
    "shift_factor": ("The input-coordinate shift.", "It changes the coordinate origin while input data is loaded."),
    "ignore_net_degree": ("The net-degree ignore threshold.", "It masks high-fanout nets so they do not dominate wirelength and selected evaluation operators."),
    "gp_noise_ratio": ("The global-placement initialization noise ratio.", "It sets the positional perturbation applied by random-center initialization."),
    "auto_adjust_bins": ("The automatic density-bin adjustment switch.", "It allows the placer to adapt density-grid settings to design data."),
    "enable_fillers": ("Whether filler nodes are inserted.", "Filler nodes participate in the density model so continuous optimization represents available area."),
    "global_place_flag": ("Whether global placement runs.", "It controls entry into the NonLinearPlace continuous optimization loop."),
    "legalize_flag": ("Whether internal legalization runs.", "It controls whether the legalizer removes overlaps and aligns cells to sites after global placement."),
    "detailed_place_flag": ("The detailed-placement enable flag.", "It marks detailed placement; the current ECOS default flow does not execute that stage."),
    "stop_overflow": ("The acceptable global-placement overflow threshold.", "It controls convergence and whether legalization may proceed."),
    "dtype": ("The placement-tensor data type.", "It affects numerical precision, memory use, and the type used by compiled operators."),
    "detailed_place_engine": ("The external detailed-placer path.", "When the path exists, PlacementEngine invokes that tool after global placement."),
    "detailed_place_command": ("Additional command text for the external detailed placer.", "It is appended to the external detailed-placer invocation."),
    "plot_flag": ("The plotting switch.", "It controls whether placement iterations produce graphical outputs."),
    "RePlAce_ref_hpwl": ("The RePlAce reference HPWL.", "It calibrates RePlAce-style convergence or parameter updates."),
    "RePlAce_LOWER_PCOF": ("The RePlAce lower coefficient.", "It participates in the RePlAce parameter-control range."),
    "RePlAce_UPPER_PCOF": ("The RePlAce upper coefficient.", "It participates in the RePlAce parameter-control range."),
    "gamma": ("The wirelength smoothing parameter.", "It affects the curvature and gradient of the smooth wirelength approximation."),
    "RePlAce_skip_energy_flag": ("The RePlAce energy-skip flag.", "It controls whether the related energy calculation participates in RePlAce iterations."),
    "random_center_init_flag": ("The random-center initialization switch.", "It spreads movable cells from around the chip center to form the global-placement initial state."),
    "init_loc_perc_x": ("The X percentage of the initial location.", "It defines the X coordinate of random-center initialization relative to the layout boundary."),
    "init_loc_perc_y": ("The Y percentage of the initial location.", "It defines the Y coordinate of random-center initialization relative to the layout boundary."),
    "sort_nets_by_degree": ("The net-degree sorting switch.", "It changes net processing order during placement-data preparation."),
    "num_threads": ("The CPU thread count.", "It sets OpenMP and Torch parallel thread counts."),
    "dump_global_place_solution_flag": ("The global-placement solution dump switch.", "It controls whether the global-placement solution is saved before legalization."),
    "dump_legalize_solution_flag": ("The legalized-solution dump switch.", "It controls whether the legalizer result is saved."),
    "routability_opt_flag": ("The routability-optimization switch.", "When enabled, it allows NonLinearPlace to enter routability-driven paths such as area adjustment."),
    "macro_place_flag": ("The macro-placement switch.", "It enables macro preprocessing and macro-legalization paths."),
    "use_bb": ("The bounding-box approximation switch.", "It affects the bounding-box form used by wirelength or congestion modeling."),
    "route_num_bins_x": ("The routing-evaluation grid count along X.", "It sets the X resolution for routability and congestion estimation."),
    "route_num_bins_y": ("The routing-evaluation grid count along Y.", "It sets the Y resolution for routability and congestion estimation."),
    "node_area_adjust_overflow": ("The overflow threshold for node-area adjustment.", "It determines when congestion-driven placement begins area adjustment."),
    "two_stage_density_scaler": ("The two-stage density scale factor.", "It scales the density model across placement stages."),
    "max_num_area_adjust": ("The maximum number of area adjustments.", "It limits repeated node-area adjustment during routability optimization."),
    "adjust_nctugr_area_flag": ("The EGR area-adjustment switch.", "It uses EGR congestion information to adjust node area."),
    "adjust_rudy_area_flag": ("The RUDY area-adjustment switch.", "It uses RUDY congestion estimates to adjust node area."),
    "adjust_pin_area_flag": ("The pin-density area-adjustment switch.", "It uses pin-density information to adjust node area."),
    "area_adjust_stop_ratio": ("The area-adjustment stopping ratio.", "It stops the related adjustment when area changes converge to this ratio."),
    "route_area_adjust_stop_ratio": ("The routing-area-adjustment stopping ratio.", "It controls convergence of routing-congestion-driven area adjustment."),
    "pin_area_adjust_stop_ratio": ("The pin-area-adjustment stopping ratio.", "It controls convergence of pin-density-driven area adjustment."),
    "unit_horizontal_capacity": ("The unit horizontal routing capacity.", "It normalizes horizontal routing demand into utilization."),
    "unit_vertical_capacity": ("The unit vertical routing capacity.", "It normalizes vertical routing demand into utilization."),
    "unit_pin_capacity": ("The unit pin capacity.", "It is used by pin-density routability estimation."),
    "max_route_opt_adjust_rate": ("The maximum routing area-adjustment rate.", "It limits node-area expansion in one routability-optimization round."),
    "route_opt_adjust_exponent": ("The routing-adjustment exponent.", "It shapes the nonlinear mapping from congestion to area-adjustment rate."),
    "pin_stretch_ratio": ("The pin-stretch ratio.", "It expands the effective pin influence region in pin-density estimation."),
    "max_pin_opt_adjust_rate": ("The maximum pin-area-adjustment rate.", "It limits one round of pin-density-driven area adjustment."),
    "deterministic_flag": ("The deterministic-execution switch.", "It requests deterministic lower-level computation paths to reduce run-to-run variation."),
    "get_congestion_map": ("The congestion-map extraction switch.", "It computes a congestion map and aggregate congestion score after placement."),
    "macro_halo_x": ("The macro halo along X.", "It expands the effective horizontal occupancy of movable macros in placement and density modeling."),
    "macro_halo_y": ("The macro halo along Y.", "It expands the effective vertical occupancy of movable macros in placement and density modeling."),
    "macro_overlap_flag": ("The macro-overlap penalty switch.", "It controls whether the objective includes a macro-overlap penalty."),
    "macro_overlap_weight": ("The macro-overlap penalty weight.", "It sets the macro-overlap term's influence in the global-placement objective."),
    "macro_overlap_mult_weight": ("The macro-overlap penalty multiplier.", "It scales the update strength of the macro-overlap penalty."),
    "cell_padding_x": ("The standard-cell padding along X.", "It expands effective cell width in the placement model to reserve horizontal spacing for legalization."),
    "bndry_padding_x": ("The placement-boundary padding along X.", "It shrinks the effective horizontal placement range of movable cells."),
    "bndry_padding_y": ("The placement-boundary padding along Y.", "It shrinks the effective vertical placement range of movable cells."),
    "pin_density": ("The pin-density target or threshold.", "It participates in pin-density congestion estimation and area adjustment."),
    "route_info_input": ("The routing-information input selection.", "It selects the routing-capacity or congestion information used by the placer."),
    "evaluate_pl": ("The existing-placement evaluation-mode switch.", "When enabled, it disables the normal optimization path and evaluates the input placement."),
    "risa_weights": ("The RISA weighting switch.", "It controls whether the related weighting strategy participates in the objective or evaluation."),
    "macro_pin_halo_x": ("The macro-pin halo along X.", "It expands the horizontal macro-pin influence region for density or congestion modeling."),
    "macro_pin_halo_y": ("The macro-pin halo along Y.", "It expands the vertical macro-pin influence region for density or congestion modeling."),
    "timing_opt_flag": ("The timing-optimization switch.", "The current ECOS execution boundary disables it, so it does not participate in the placement algorithm."),
    "timing_eval_flag": ("The timing-evaluation switch.", "The current ECOS execution boundary disables it, so it does not participate in the placement algorithm."),
    "enable_net_weighting": ("The net-weight-update switch.", "It controls whether timing or another strategy updates net weights in the placement objective."),
    "with_sta": ("The STA integration switch.", "The current ECOS execution boundary disables it, so the STA path is not initialized."),
    "differentiable_timing_obj": ("The differentiable-timing-objective switch.", "The current ECOS execution boundary disables it, so it is not added to the placement objective."),
    "pin2pin_max_weight": ("The maximum pin-to-pin weight.", "It limits the upper bound of pin-to-pin timing or connectivity weighting."),
    "pin2pin_min_weight": ("The minimum pin-to-pin weight.", "It limits the lower bound of pin-to-pin timing or connectivity weighting."),
    "pin2pin_accumulate_weight": ("The pin-to-pin accumulated weight.", "It controls accumulation across pin-to-pin weight-update rounds."),
    "pin2pin_weight": ("The base pin-to-pin weight.", "It supplies the initial scale for pin-to-pin weighting."),
    "pin2pin_net_weighting": ("The pin-to-pin net-weighting switch.", "It controls whether pin-to-pin information feeds back into net weights."),
    "net_weighting_scheme": ("The net-weighting scheme name.", "It selects the net-weight calculation or update strategy."),
    "momentum_decay_factor": ("The weight-update momentum decay.", "It smooths weight changes across iterations."),
    "start_iter": ("The weight-update or optimization start iteration.", "It delays activation of the related update path."),
    "max_net_weight": ("The net-weight upper bound.", "It prevents a small number of nets from dominating the placement objective."),
    "base_design_name": ("The base design name.", "It is used to name placement outputs and intermediate files."),
}


def _parameter_body(name: str, _default: object) -> str:
    meaning, role = PARAMETER_SEMANTICS[name]
    return f"**Meaning:** {meaning}\n\n**Role:** {role}"


def _add_parameters(entries: list[dict[str, object]], documents: dict[str, list[str]], config: dict[str, object]) -> None:
    for name, default in config.items():
        evidence = ("dreamplace.config", "dreamplace.overrides", "dreamplace.module")
        if name in GUI_PARAMETER_MAP:
            evidence += ("ecos.params",)
        if name == "target_density":
            evidence += ("dreamplace.objective",)
        _add(entries, documents, entity_id=f"parameter.dreamplace.{name}", kind="parameter", aliases=(name, name.replace("_", " "), f"DreamPlace {name}"), document="parameters.md", body=_parameter_body(name, default), evidence=evidence, include_evidence=False)


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
        {"id": "target-density", "question": "place阶段的target density这个参数的含义是什么？", "entity_id": "parameter.dreamplace.target_density", "required_text": "target placement density"},
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
