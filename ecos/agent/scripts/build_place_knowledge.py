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
    "ecc.service": "ecc/chipcompiler/tools/ecc/service.py",
    "ecc.feature_union": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/builder/feature_eval_union.cpp",
    "ecc.feature_parser": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/parser/feature_parser_eval.cpp",
    "ecc.density": "ecc/chipcompiler/thirdparty/ecc-tools/src/evaluation/src/module/density/density_eval.cpp",
    "ecc.wirelength": "ecc/chipcompiler/thirdparty/ecc-tools/src/evaluation/src/module/wirelength/wirelength_eval.cpp",
    "gui.place_metrics": "ecos/gui/apps/renderer/src/utils/projectManagement.ts",
    "gui.map_gallery": "ecos/gui/apps/desktop-electron/electron/services/workspaceResourceService.ts",
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


def _section(entity_id: str, body: str, evidence: tuple[str, ...], *, include_evidence: bool, evidence_label: str) -> str:
    references = ", ".join(f"**{source_id}**" for source_id in evidence)
    suffix = f"\n\n**{evidence_label}** {references}" if include_evidence else ""
    return f'<a id="{entity_id}"></a>\n## {entity_id}\n\n{body.strip()}{suffix}\n'


def _add(entries: list[dict[str, object]], documents: dict[str, list[str]], *, entity_id: str, kind: str, aliases: tuple[str, ...], document: str, body: str, evidence: tuple[str, ...], include_evidence: bool = True, evidence_label: str = "源码证据：") -> None:
    chunk = _section(entity_id, body, evidence, include_evidence=include_evidence, evidence_label=evidence_label)
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


def _metric_body(meaning: str, calculation: str, boundary: str) -> str:
    return f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}\n\n**Boundary:** {boundary}"


def _add_metric(entries: list[dict[str, object]], documents: dict[str, list[str]], *, name: str, aliases: tuple[str, ...], meaning: str, calculation: str, boundary: str, evidence: tuple[str, ...]) -> None:
    _add(entries, documents, entity_id=f"metric.{name}", kind="metric", aliases=aliases, document="metrics.md", body=_metric_body(meaning, calculation, boundary), evidence=evidence, evidence_label="Source evidence:")


def _add_numeric_metrics(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    records = (
        ("place_hpwl", ("place hpwl", "HPWL", "half perimeter wirelength"), "The total half-perimeter wirelength of the placed netlist in micrometres; lower is better.", "For every net, the evaluator finds its pin-coordinate extrema and adds `(max_x - min_x) + (max_y - min_y)`; it sums that value over all nets, writes `/Wirelength/HPWL` to `place.map.json`, and ECOS reads that selector.", "This is a bounding-box estimate, not routed wire length or timing delay.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.wirelength")),
        ("place_grwl", ("place grwl", "GRWL", "global routing wirelength"), "The total global-routing guide wirelength in micrometres; lower is better.", "The wirelength evaluator parses the early router's `route.guide`, sums its EGR guide wirelength, stores it as `/Wirelength/GRWL`, and ECOS extracts that value from `place.map.json`.", "It reflects the early-routing guide, not detailed-routing geometry.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.wirelength")),
        ("place_flute_wirelength", ("place flute wirelength", "FLUTE", "flute wirelength"), "The total FLUTE rectilinear Steiner-tree wirelength in micrometres; lower is better.", "For a two-pin net, the evaluator uses Manhattan distance. For a net with more than two pins, it invokes `flute(pin_count, x, y, 8)` and uses the returned tree length; it then sums all nets and publishes `/Wirelength/FLUTE`.", "It is a Steiner-tree estimate and does not include detailed-routing detours or vias.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.wirelength")),
        ("place_congestion_egr_overflow_total", ("place egr overflow total", "EGR overflow total", "total overflow"), "The total union-direction early-global-routing overflow count; lower is better.", "The congestion evaluator reads the selected `overflow_map_*` CSV values, selects all routing directions for `union`, and sums every bin value. The feature parser publishes that aggregate at `/Congestion/overflow/total/union`, which ECOS exposes as this metric.", "It is an early-routing capacity-demand excess, not a post-route DRC count.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion")),
        ("place_congestion_egr_overflow_max", ("place egr overflow max", "EGR overflow max", "maximum overflow"), "The largest union-direction early-global-routing overflow observed in one grid bin; lower is better.", "The congestion evaluator scans the union overflow CSV and retains the greatest bin value. The feature parser writes `/Congestion/overflow/max/union`, and ECOS extracts it as this metric.", "A small total can still coexist with a severe local peak, so this metric complements total overflow.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion")),
        ("place_rudy_utilization_max", ("RUDY", "RUDY metric", "rudy utilization", "rudy utilization max", "how is rudy calculated", "how to calculate rudy"), "The maximum union-direction RUDY routing-demand estimate over placement bins; lower is better.", "For each net, ECC forms the pin bounding box and accumulates `overlap_area / bbox_height / grid_area` horizontally and `overlap_area / bbox_width / grid_area` vertically in every overlapping bin; union adds both. A zero bbox dimension uses reciprocal `1.0`. The metric is the maximum union-bin value at `/Congestion/utilization/rudy/max/union`.", "This is a placement-time demand estimate, not detailed-routing overflow and not DreamPlace's internal Torch RUDY operator.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion")),
        ("place_lutrudy_utilization_max", ("LUT-RUDY", "lutrudy", "lutrudy utilization", "lutrudy utilization max"), "The maximum union-direction LUT-RUDY routing-demand estimate over placement bins; lower is better.", "LUT-RUDY uses the same bounding-box overlap accumulation as RUDY, but multiplies each non-degenerate horizontal or vertical contribution by `getLUT(pin_count, aspect_ratio, l_ness)`. ECOS reports the largest union-bin value at `/Congestion/utilization/lutrudy/max/union`.", "The lookup factor is an estimator based on pin count, bbox aspect ratio, and L-ness; it is not a routed utilization measurement.", ("gui.place_metrics", "ecc.metrics", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion")),
    )
    for name, aliases, meaning, calculation, boundary, evidence in records:
        _add_metric(entries, documents, name=name, aliases=aliases, meaning=meaning, calculation=calculation, boundary=boundary, evidence=evidence)


def _add_density_map_metrics(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    boundary = "The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace."
    records = (
        ("cell_density", ("cell density", "cell density map", "all cell density"), "A per-bin map of total movable-cell area fraction.", "For each cell and every overlapping bin, ECC adds `overlap_area / grid_area`; the all-cell variant includes both macros and standard cells."),
        ("macro_density", ("macro density", "macro density map"), "A per-bin map of macro area fraction.", "ECC runs the same overlap-area accumulation as cell density but filters input cells to `macro` before adding `overlap_area / grid_area`."),
        ("stdcell_density", ("stdcell density", "standard cell density", "stdcell density map"), "A per-bin map of standard-cell area fraction.", "ECC runs the same overlap-area accumulation as cell density but filters input cells to `stdcell` before adding `overlap_area / grid_area`."),
        ("pin_density", ("pin density", "pin density map", "all cell pin density"), "A per-bin map of placed-pin count.", "ECC assigns each selected pin to its containing bin and increments that bin. When the evaluator is invoked with neighbor mode, it replaces each bin with the sum of its 3-by-3 neighborhood; the published all-cell map includes macro and standard-cell pins."),
        ("macro_pin_density", ("macro pin density", "macro pin density map"), "A per-bin map of macro-pin count.", "ECC assigns only pins belonging to macros to their containing bins and increments the corresponding bin; neighbor mode, when requested, replaces each bin with its 3-by-3 neighborhood sum."),
        ("stdcell_pin_density", ("stdcell pin density", "standard cell pin density", "stdcell pin density map"), "A per-bin map of standard-cell-pin count.", "ECC assigns only pins belonging to standard cells to their containing bins and increments the corresponding bin; neighbor mode, when requested, replaces each bin with its 3-by-3 neighborhood sum."),
        ("net_density", ("net density", "net density map", "all net density"), "A per-bin map of all net coverage counts.", "ECC classifies a net as local when its bounding box fits one bin and increments that bin; otherwise it increments every bin crossed by the bounding box. The all-net map combines both cases."),
        ("global_net_density", ("global net density", "global net density map"), "A per-bin map of multi-bin net coverage counts.", "ECC selects nets whose bounding boxes span more than one bin and increments every bin covered by each selected bounding box."),
        ("local_net_density", ("local net density", "local net density map"), "A per-bin map of single-bin net counts.", "ECC selects nets whose bounding boxes remain inside one bin and increments only that bin."),
    )
    for name, aliases, meaning, calculation in records:
        _add_metric(entries, documents, name=f"place.map.{name}", aliases=aliases, meaning=meaning, calculation=calculation, boundary=boundary, evidence=("gui.map_gallery", "ecc.service", "ecc.feature_union", "ecc.feature_parser", "ecc.density"))


def _add_congestion_map_metrics(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    boundary = "The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success."
    for direction, layer_scope in (("horizontal", "horizontal-preferred routing layers"), ("vertical", "vertical-preferred routing layers"), ("union", "all routing layers")):
        _add_metric(entries, documents, name=f"place.map.egr_{direction}", aliases=(f"egr {direction}", f"egr {direction} map", f"{direction} egr map"), meaning=f"An early-global-routing overflow map summed over {layer_scope}.", calculation=f"ECC reads `overflow_map_*` CSV files from the early router, selects {layer_scope}, and sums matching matrices cell by cell. The resulting path is stored under `/Congestion/map/egr/{direction}`.", boundary=boundary, evidence=("gui.map_gallery", "ecc.service", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion"))
        _add_metric(entries, documents, name=f"place.map.rudy_{direction}", aliases=(f"rudy {direction}", f"rudy {direction} map", f"{direction} rudy map"), meaning=f"A {direction}-direction RUDY routing-demand map.", calculation=f"For each net bounding box and overlapping bin, ECC accumulates `overlap_area / grid_area` times the reciprocal bbox height for horizontal demand, the reciprocal bbox width for vertical demand, or their sum for union. A zero dimension uses reciprocal `1.0`; the path is `/Congestion/map/rudy/{direction}`.", boundary=boundary, evidence=("gui.map_gallery", "ecc.service", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion"))
        _add_metric(entries, documents, name=f"place.map.lutrudy_{direction}", aliases=(f"lutrudy {direction}", f"lut rudy {direction}", f"lutrudy {direction} map"), meaning=f"A {direction}-direction LUT-RUDY routing-demand map.", calculation=f"ECC applies the RUDY overlap accumulation, then scales each non-degenerate directional reciprocal by `getLUT(pin_count, aspect_ratio, l_ness)` before writing `/Congestion/map/lutrudy/{direction}`.", boundary=boundary, evidence=("gui.map_gallery", "ecc.service", "ecc.feature_union", "ecc.feature_parser", "ecc.congestion"))


def _add_metrics(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    _add_numeric_metrics(entries, documents)
    _add_density_map_metrics(entries, documents)
    _add_congestion_map_metrics(entries, documents)


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
        ("dreamplace_import", ("dreamplace import failed", "DreamPlace导入失败"), "`is_eda_exist()` catches a DreamPlace import exception, records `dreamplace: import failed`, and makes the step return `False`. Check the runtime `dreamplace` module and its compiled dependencies.", ("dreamplace.utility", "dreamplace.runner")),
        ("missing_ecc_module", ("ECC module unavailable", "ECC模块不可用"), "The runner invokes DreamPlace only when `get_eda_instance()` returns an ECC module. If it returns no module, placement does not enter the module.", ("dreamplace.runner",)),
        ("overflow_or_nonfinite_objective", ("place overflow nan inf", "布局overflow或NaN"), "When final overflow exceeds `stop_overflow`, or the objective is `Inf` or `NaN`, `NonLinearPlace` skips legalization and detailed placement and returns infinite HPWL.", ("dreamplace.nonlinear",)),
        ("infinite_hpwl", ("hpwl inf", "HPWL无穷"), '`DreamplaceModule` treats `ppa["hpwl"] == inf` as a failure and returns `False`.', ("dreamplace.module",)),
        ("missing_feature_map", ("place map missing", "place map缺失"), "The runner requests `feature_placement_map(json_path=step.feature.map)`. When the expected map is missing, it must not claim that QoR metrics were generated.", ("dreamplace.runner", "ecc.builder")),
        ("missing_external_detailed_placer", ("detailed placer missing", "详细布局器缺失"), "When `detailed_place_engine` is configured but its path does not exist, `PlacementEngine` records only a warning. Detailed placement is disabled in the current default flow.", ("dreamplace.placer", "dreamplace.config")),
        ("misleading_subflow_success", ("subflow success", "subflow成功但失败"), "After DreamPlace returns, the runner unconditionally marks the subflow `run-placement` as successful, and `save_data` can later overwrite the result. Subflow success alone is not placement-success evidence; check terminal state, logs, and artifacts.", ("dreamplace.runner", "dreamplace.module")),
    ]
    for name, aliases, body, evidence in records:
        _add(entries, documents, entity_id=f"failure.place.{name}", kind="failure_mode", aliases=aliases, document="failures.md", body=body, evidence=evidence, evidence_label="Source evidence:")


def _write_regression(output: Path) -> None:
    cases = [
        {"id": "target-density", "question": "place阶段的target density这个参数的含义是什么？", "entity_id": "parameter.dreamplace.target_density", "required_text": "target placement density"},
        {"id": "execution", "question": "place内部算法是如何执行的？", "entity_id": "algorithm.place.execution", "required_text": "NonLinearPlace"},
        {"id": "rudy", "question": "RUDY指标是如何计算的？", "entity_id": "metric.place_rudy_utilization_max", "required_text": "overlap_area"},
        {"id": "hpwl", "question": "place HPWL指标来自哪里？", "entity_id": "metric.place_hpwl", "required_text": "/Wirelength/HPWL"},
        {"id": "cell-density-map", "question": "How is the cell density map calculated?", "entity_id": "metric.place.map.cell_density", "required_text": "overlap_area"},
        {"id": "pin-density-map", "question": "How is the pin density map calculated?", "entity_id": "metric.place.map.pin_density", "required_text": "containing bin"},
        {"id": "net-density-map", "question": "How is the global net density map calculated?", "entity_id": "metric.place.map.global_net_density", "required_text": "bounding boxes"},
        {"id": "lutrudy", "question": "How is LUT-RUDY utilization calculated?", "entity_id": "metric.place_lutrudy_utilization_max", "required_text": "getLUT"},
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
