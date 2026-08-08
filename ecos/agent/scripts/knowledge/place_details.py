"""Placement-specific content for the unified flow-stage knowledge builder."""

from __future__ import annotations

import hashlib

PLACE_SOURCE_PATHS = {
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
    "ecc.runner": "ecc/chipcompiler/tools/ecc/runner.py",
    "ecc.module": "ecc/chipcompiler/tools/ecc/module.py",
    "ecc.plot": "ecc/chipcompiler/tools/ecc/plot.py",
    "ecc.feature_manager": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/feature_manager.cpp",
    "ecc.feature_summary": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/parser/feature_parser.cpp",
    "ecc.geometry": "ecc/chipcompiler/thirdparty/ecc-tools/src/database/manager/builder/geometry_builder/GeometrySnapshotWriter.cpp",
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


PLACE_PARAMETER_SEMANTICS = {
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
    meaning, role = PLACE_PARAMETER_SEMANTICS[name]
    return f"**Meaning:** {meaning}\n\n**Role:** {role}"


def _add_parameters(entries: list[dict[str, object]], documents: dict[str, list[str]], config: dict[str, object]) -> None:
    for name, default in config.items():
        evidence = ("dreamplace.config", "dreamplace.overrides", "dreamplace.module")
        if name in GUI_PARAMETER_MAP:
            evidence += ("ecos.params",)
        if name == "target_density":
            evidence += ("dreamplace.objective",)
        aliases = (name, name.replace("_", " "), f"DreamPlace {name}")
        if name == "stop_overflow":
            aliases += ("target overflow", "placement target overflow", "placer target overflow")
        _add(entries, documents, entity_id=f"parameter.dreamplace.{name}", kind="parameter", aliases=aliases, document="parameters.md", body=_parameter_body(name, default), evidence=evidence, include_evidence=False)


def _add_algorithms(entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    records = (
        (
            "algorithm.place.execution",
            ("place内部算法", "place算法", "布局算法", "布局流程", "place执行流程", "place如何执行", "place怎么执行", "place怎么运行", "place execution", "place flow", "place stage", "how does place execute", "how does place work", "placement algorithm"),
            "**Execution path:** The ECOS `place` runner obtains the ECC module, constructs `DreamplaceModule`, builds `PlacementEngine`, imports the ECC-backed raw database with `setup_rawdb()`, builds the Python placement database, and invokes `NonLinearPlace`.\n\n**Stage order inside one place invocation:** When the corresponding controls are enabled, the order is `global placement -> acceptance gate -> legalization -> detailed placement`. The acceptance gate runs after global placement; excessive overflow or a non-finite objective returns infinite HPWL and prevents later stages.\n\n**Flow distinction:** ECOS also has a separate `legalization` flow step after CTS. That step invokes the same module with global placement disabled, so it legalizes its incoming placement rather than rerunning global placement.\n\n**Post-processing boundary:** The runner requests feature maps, saves data, and runs analysis after DreamPlace returns. Those calls are not independent proof that every requested artifact was produced.",
            ("dreamplace.runner", "dreamplace.module", "dreamplace.placer", "dreamplace.nonlinear"),
        ),
        (
            "algorithm.dreamplace.global_placement",
            ("global placement", "continuous density-aware cell movement", "全局布局", "nesterov", "非线性布局"),
            "**Idea:** Global placement relaxes cells to continuous coordinates and minimizes a differentiable objective. It is the density-aware continuous-cell-movement phase before legalization. `PlaceObj` combines smoothed wirelength with a density penalty, and can add a macro-overlap penalty. The weighted-average wirelength model supplies gradients where exact HPWL is not differentiable, while density and overflow are evaluated over placement bins.\n\n**Optimization structure:** Each configured global stage runs **three nested optimization loops**: an outer gamma loop reduces wirelength smoothing, a middle loop updates density weight, and an inner loop performs optimizer descent. The selected optimizer can be Adam, SGD variants, or Nesterov; each descent step projects cells back into the placement boundary, evaluates HPWL and overflow, differentiates the objective, and preconditions gradients by density and node area.\n\n**Convergence control:** The implementation tracks the best-overflow position, updates density weight and gamma as optimization progresses, stops on overflow/HPWL/density criteria, and can roll back after divergence detection. The final global-placement metric is the gate for later legalization and detailed refinement.",
            ("dreamplace.nonlinear", "dreamplace.objective"),
        ),
        (
            "algorithm.dreamplace.routability_optimization",
            ("routability optimization", "routability opt", "可布线优化", "拥塞驱动布局"),
            "**Trigger:** When routability optimization is enabled, the global-placement loop considers area adjustment only after density overflow falls below its configured threshold and while adjustment rounds remain.\n\n**Algorithm:** It obtains a routing-utilization map from EGR or the routing estimator, and optionally a pin-utilization map. `adjust_node_area_op` uses those maps to modify movable-cell area models so the following placement iterations can spread demand away from congested or pin-dense regions.\n\n**Restart after adjustment:** After an area change, DreamPlace resets density and overflow operators, reinitializes density weight and the optimizer state, estimates a new learning rate, and resumes the nested optimization loop. These are placement-time estimators, not evidence of detailed-routing completion.",
            ("dreamplace.nonlinear", "dreamplace.objective"),
        ),
        (
            "algorithm.dreamplace.legalization",
            ("legalization", "合法化", "布局合法化", "cts后合法化"),
            "**Purpose:** Legalization converts continuous placement coordinates into legal site and row locations while honoring die bounds, fixed objects, and fence-region constraints.\n\n**Internal sequence:** The standard legalization operator runs `MacroLegalize -> GreedyLegalize -> AbacusLegalize`. Macro legalization places movable macros first. Greedy legalization produces a fast overlap-free standard-cell placement. Abacus legalization then compacts rows to improve displacement while preserving legality. A legality check follows greedy legalization and another follows Abacus legalization; a failed check retains the earlier legal candidate.\n\n**Fence regions and flow use:** Designs with fence regions use a per-region legalization operator and validate the merged result. The standalone ECOS `legalization` flow step uses this same legalization path without a preceding global-placement run.",
            ("dreamplace.runner", "dreamplace.module", "dreamplace.nonlinear", "dreamplace.placer"),
        ),
        (
            "algorithm.dreamplace.detailed_placement",
            ("detailed placement", "详细布局", "细节布局"),
            "**Precondition:** Detailed refinement runs only when enabled and starts from the legalized placement. Every candidate sequence is checked for legality, and an illegal result stops refinement at the last legal position.\n\n**In-process refinement:** DreamPlace constructs an ABCDPlace-style sequence: `K-Reorder -> IndependentSetMatching -> GlobalSwap -> K-Reorder`. K-Reorder searches local cell permutations, independent-set matching permits non-conflicting moves in parallel, and global swap evaluates broader exchanges. The final K-Reorder restores local ordering after swaps.\n\n**External refinement:** After the in-process placement engine reports finite HPWL, `PlacementEngine` can invoke a configured external detailed placer when its executable path exists. That external call is distinct from the internal ABCDPlace-style sequence.",
            ("dreamplace.nonlinear", "dreamplace.placer"),
        ),
    )
    for entity_id, aliases, body, evidence in records:
        _add(entries, documents, entity_id=entity_id, kind="algorithm", aliases=aliases, document="algorithms.md", body=body, evidence=evidence, evidence_label="Source evidence:")


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
    records = (
        (
            "output_def",
            "output/{design}_place.def.gz",
            "The placed DEF is the physical-design interchange file exported from the current ECC database. Compared with the floorplan input DEF, its COMPONENTS section contains the standard-cell placement coordinates and row orientation written back by DreamPlace; it also carries the current die, rows, pins, blockages, macros, and net connectivity.",
            "`NonLinearPlace` applies the optimized movable-cell positions to `macroPlaceDB`, which unscales the coordinates and writes them into ECC. The common place `save_data` path then invokes `def_save` on that updated database.",
            ("dreamplace.nonlinear", "dreamplace.placer", "dreamplace.runner", "ecc.runner", "ecc.module"),
        ),
        (
            "output_verilog",
            "output/{design}_place.v.gz",
            "The place Verilog is a gate-level logical-netlist export of the current ECC database: module structure, cell instances, ports, and logical net connectivity. It does not encode physical placement coordinates; those belong to the DEF, GDS, database checkpoint, and geometry snapshot.",
            "After DreamPlace has updated the in-memory design, `save_data` calls `verilog_save`, which delegates to ECC's netlist exporter and writes the resulting logical connectivity to this path.",
            ("dreamplace.runner", "ecc.runner", "ecc.module"),
        ),
        (
            "output_gds",
            "output/{design}_place.gds",
            "The place GDS is a binary physical-layout export of the current ECC database. It represents the die-level physical geometry and current placed instance hierarchy, including the standard-cell locations produced by placement, in stream format suitable for physical-layout viewers.",
            "The placement solution is written into ECC before the common persistence path calls `gds_save`; ECC serializes that current physical database as the GDS file.",
            ("dreamplace.nonlinear", "dreamplace.runner", "ecc.runner", "ecc.module"),
        ),
        (
            "output_db",
            "output/{design}_place_db",
            "The place database directory is an ECC checkpoint for subsequent flow stages. Its layout files include metadata, units, die, layers, sites, rows, routing grids, cell masters, via rules, and vias; its design files include metadata, instances, IO pins, nets, special nets, blockages, regions, slots, groups, and fills.",
            "The common persistence path calls `save_data` after placement. The next stage can load this directory to reconstruct the same placed ECC database instead of reparsing the source design.",
            ("dreamplace.runner", "ecc.runner", "ecc.module"),
        ),
        (
            "output_image",
            "output/{design}_place.png",
            "This is the reserved direct PNG path exposed by the step-output schema. The placement visualizations are instead the placement plots generated from the QoR metrics and feature-map data, such as the metric chart and density or congestion heatmaps.",
            "The builder allocates this path, while `run_analysis` invokes `ECCToolsPlot` to write plot files beside the analysis and feature inputs. The standard place runner has no writer that targets `output.image`, so this reserved path is not emitted as the placement result itself.",
            ("ecc.builder", "ecc.runner", "ecc.plot"),
        ),
        (
            "output_json",
            "output/{design}_place.json",
            "This is the reserved JSON-export path for a serialized current ECC design. It is distinct from the feature JSON files and from the GUI geometry snapshot; the standard place flow does not publish a design JSON at this path.",
            "The builder allocates the path and `ECCToolsModule` exposes `json_save`, but the common place persistence path does not call it. It also intentionally skips view-JSON serialization because the GUI reads the geometry snapshot.",
            ("ecc.builder", "ecc.runner", "ecc.module"),
        ),
        (
            "geometry",
            "output/geometry/geometry.manifest",
            "The geometry directory is the GUI-rendering snapshot of the placed ECC database. `geometry.manifest` identifies the active epoch and the side files holding shape records, owners, packed geometry payload, names, shape-ID mapping, view tiles, layer, site, master, via, grid, connectivity, net, bus, and group metadata.",
            "After saving the placed database, the common persistence path calls `geometry_snapshot_save` for the place step and requires `geometry.manifest` to exist. The snapshot writer emits epoch-local side files and publishes the manifest that references them.",
            ("ecc.builder", "ecc.runner", "ecc.module", "ecc.geometry"),
        ),
        (
            "view_json",
            "output/{design}_place_view",
            "This is the reserved directory for a view-JSON package, whose API would write a manifest and layout package files for the current ECC design. The standard place flow uses the geometry snapshot instead, so it does not emit this package.",
            "The builder allocates the directory and `ECCToolsModule.view_json_save` can create the package, but `save_data` explicitly skips view-JSON serialization and directs the GUI to the geometry snapshot.",
            ("ecc.builder", "ecc.runner", "ecc.module"),
        ),
        (
            "feature_db",
            "feature/place.db.json",
            "This JSON is the source-derived summary of the placed ECC database. Its top-level content includes `Design Information`, `Design Layout`, `Design Statis`, `Instances`, `Macros Statis`, `Macros`, `Nets`, `Layers`, and `Pins`, which describe the design state from which placement metrics and plots are interpreted.",
            "The common persistence path calls `feature_sammry`, which invokes ECC's feature-summary builder to extract those categories from the current database and serialize them to JSON.",
            ("dreamplace.runner", "ecc.runner", "ecc.module", "ecc.feature_summary"),
        ),
        (
            "feature_step",
            "feature/place.step.json",
            "This reserved file would contain the stage-specific `place` feature summary, including the placement-tool summary produced for a normal ECOS placement step. It is not emitted by the DreamPlace place runner.",
            "`feature_step` can call ECC's `feature_tool` with `place`, but the DreamPlace runner invokes the common persistence function with `feature_step=False`; the call is skipped and no `place.step.json` is written.",
            ("dreamplace.runner", "ecc.runner", "ecc.module", "ecc.feature_manager", "ecc.feature_summary"),
        ),
        (
            "feature_map",
            "feature/place.map.json",
            "This JSON is the placement evaluation-map index. It records the generated density, pin-density, net-density, RUDY, LUT-RUDY, and EGR map resources that the GUI and plotting code use to render placement heatmaps.",
            "Immediately after DreamPlace returns, the place runner calls `feature_placement_map`. ECC initializes the placement evaluator, builds the union placement-evaluation summary, and serializes the map-resource paths through `feature_pl_eval`.",
            ("dreamplace.runner", "ecc.module", "ecc.feature_manager", "ecc.feature_union", "ecc.feature_parser"),
        ),
        (
            "qor_metrics",
            "analysis/qor_metrics.json",
            "This JSON is the structured per-metric QoR record for the place step. Its top-level `\"metrics\"` array contains entries with an identifier, display name, value, unit, category, optimization direction, scope, rating, confidence, and source selector; the payload also records its schema, tool, step, design, detail records, source files, and integrity status.",
            "ECC builds step metrics from the placed feature data, maps recognized values into QoR records, rejects records whose source escapes the current step feature directory, sorts the surviving records, and writes the resulting payload with `save_qor_metrics`.",
            ("dreamplace.runner", "ecc.runner", "ecc.metrics"),
        ),
        (
            "qor_summary",
            "analysis/qor_summary.json",
            "This JSON is the quality-status summary derived from the place QoR metrics. It contains the analysis and quality status, metric count, per-dimension counts, the top-level `\"gates\"` array, missing-metric diagnostics, and the name of the backing metrics file.",
            "ECC rebuilds the QoR metric payload, groups records by category, determines valid or incomplete analysis status from metric availability and source integrity, evaluates the step quality gates, and writes the summary with `save_qor_summary`.",
            ("dreamplace.runner", "ecc.runner", "ecc.metrics"),
        ),
        (
            "qor_hotspots",
            "analysis/qor_hotspots.json",
            "This JSON is the actionable QoR-hotspot subset for the place step. A hotspot is a recognized congestion symptom, represented with its kind, warning severity, metric ID, display name, value, unit, category, source selector, and description rather than as every bin of a heatmap.",
            "ECC first builds the QoR metric records, then retains only recognized place congestion metrics such as EGR total or peak overflow and RUDY or LUT-RUDY peak utilization when their numeric value > 0. Each retained record receives the fixed warning severity and its evidence source before `save_qor_hotspots` writes the list.",
            ("dreamplace.runner", "ecc.runner", "ecc.metrics"),
        ),
        (
            "log",
            "log/place.log",
            "The place log is the chronological DreamPlace execution record. It contains root logger messages for parameter setup, placement-database initialization, nonlinear placement progress and final PPA, congestion extraction, warnings, and failures; the default standalone filename is `dreamplace_placement.log` when no step log path is supplied.",
            "`DreamplaceModule` chooses `step.log.file` when available, otherwise its default filename, opens it in write mode, and temporarily attaches it as a root logger handler around the whole placement run.",
            ("dreamplace.module", "dreamplace.placer"),
        ),
    )
    _add(
        entries,
        documents,
        entity_id="artifact.place.outputs",
        kind="artifact",
        aliases=("place artifacts", "place outputs", "placement artifacts", "布局产物", "place输出文件", "产物", "输出"),
        document="artifacts.md",
        body="**Meaning:** The place artifact set is the collection of source artifacts, structured feature and QoR records, GUI geometry data, and execution logs produced around a DreamPlace placement run. Each file exposes a different view of the same placed design state or of the analysis performed on it.\n\n**Calculation:** The DreamPlace runner updates the ECC database, produces placement-map features, persists the physical outputs and checkpoint, then runs QoR analysis and plotting. The records below identify the actual content and generation chain for every published or reserved place artifact path.",
        evidence=("ecc.builder", "dreamplace.runner", "ecc.runner"),
        evidence_label="Source evidence:",
    )
    for name, path, meaning, calculation, evidence in records:
        aliases = (name, name.replace("_", " "), path)
        if name == "output_def":
            aliases += ("place def", "placed def", "what does the placed def contain")
        _add(
            entries,
            documents,
            entity_id=f"artifact.place.{name}",
            kind="artifact",
            aliases=aliases,
            document="artifacts.md",
            body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}",
            evidence=evidence,
            evidence_label="Source evidence:",
        )


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


PLACE_REGRESSION_CASES = (
        {"id": "target-density", "question": "place阶段的target density这个参数的含义是什么？", "entity_id": "parameter.dreamplace.target_density", "required_text": "target placement density"},
        {"id": "target-overflow", "question": "what is the target overflow in placer", "entity_id": "parameter.dreamplace.stop_overflow", "required_text": "acceptable global-placement overflow threshold"},
        {"id": "execution", "question": "place内部算法是如何执行的？", "entity_id": "algorithm.place.execution", "required_text": "global placement -> acceptance gate -> legalization -> detailed placement"},
        {"id": "rudy", "question": "RUDY指标是如何计算的？", "entity_id": "metric.place_rudy_utilization_max", "required_text": "overlap_area"},
        {"id": "hpwl", "question": "place HPWL指标来自哪里？", "entity_id": "metric.place_hpwl", "required_text": "/Wirelength/HPWL"},
        {"id": "cell-density-map", "question": "How is the cell density map calculated?", "entity_id": "metric.place.map.cell_density", "required_text": "overlap_area"},
        {"id": "pin-density-map", "question": "How is the pin density map calculated?", "entity_id": "metric.place.map.pin_density", "required_text": "containing bin"},
        {"id": "net-density-map", "question": "How is the global net density map calculated?", "entity_id": "metric.place.map.global_net_density", "required_text": "bounding boxes"},
        {"id": "lutrudy", "question": "How is LUT-RUDY utilization calculated?", "entity_id": "metric.place_lutrudy_utilization_max", "required_text": "getLUT"},
        {"id": "artifact", "question": "place阶段有哪些产物？", "entity_id": "artifact.place.outputs", "required_text": "source artifacts"},
        {"id": "place-def-artifact", "question": "What does the placed DEF contain?", "entity_id": "artifact.place.output_def", "required_text": "standard-cell placement coordinates"},
        {"id": "qor-hotspots-artifact", "question": "How does qor_hotspots.json select place hotspots?", "entity_id": "artifact.place.qor_hotspots", "required_text": "value > 0"},
        {"id": "failure", "question": "dreamplace import failed 怎么理解？", "entity_id": "failure.place.dreamplace_import", "required_text": "dreamplace: import failed"},
)


def add_place_entries(
    entries: list[dict[str, object]], documents: dict[str, list[str]], config: dict[str, object]
) -> None:
    _add_parameters(entries, documents, config)
    _add_algorithms(entries, documents)
    _add_metrics(entries, documents)
    _add_artifacts(entries, documents)
    _add_failures(entries, documents)
