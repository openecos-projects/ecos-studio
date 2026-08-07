"""Source-audited metric definitions for non-placement ECOS stages."""

from __future__ import annotations


MetricDetail = tuple[str, str, str, tuple[str, ...]]


SOURCE_PATHS = {
    "ecc.sta_qor": "ecc/chipcompiler/tools/ecc/sta_qor.py",
    "ecc.feature.summary": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/parser/feature_parser_summary.cpp",
    "ecc.feature.tools": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/parser/feature_parser_tools.cpp",
    "ecc.feature.builder": "ecc/chipcompiler/thirdparty/ecc-tools/src/feature/builder/feature_builder.cpp",
    "icts.qor": "ecc/chipcompiler/thirdparty/ecc-tools/src/operation/iCTS/source/module/evaluation/qor/QOREvaluation.cc",
    "icts.qor_metrics": "ecc/chipcompiler/thirdparty/ecc-tools/src/operation/iCTS/source/module/evaluation/qor/QOREvaluationMetrics.cc",
    "gui.qor_trend": "ecos/gui/apps/renderer/src/utils/projectQorTrend.ts",
    "gui.qor_data": "ecos/gui/apps/renderer/src/views/project-management/projectWorkspaceAnalysisData.ts",
}


METRIC_DETAILS: dict[str, MetricDetail] = {
    "synthesis_cell_area": (
        "The total mapped standard-cell area reported by Yosys after technology mapping.",
        "`yosys/metrics.py` reads `/design/area` from the Yosys stat JSON and publishes `round(area, 2)`.",
        "It is a library-area estimate of the synthesized netlist, not placed area, utilization, or post-route area.",
        ("yosys.metrics", "ecc.metrics"),
    ),
    "synthesis_cell_count": (
        "The number of mapped cells in the synthesized netlist.",
        "Yosys reads `/design/num_cells` from the stat JSON and publishes that structural count.",
        "It counts the current mapped netlist only; it does not include later CTS, fanout-repair, filler, or routing edits.",
        ("yosys.metrics", "ecc.metrics"),
    ),
    "synthesis_port_count": (
        "The number of synthesized port bits.",
        "Yosys reads `/design/num_port_bits` from the stat JSON without a cross-stage aggregation.",
        "This is a bit count, not a count of logical port declarations and not a physical IO-pin count.",
        ("yosys.metrics", "ecc.metrics"),
    ),
    "synthesis_wire_count": (
        "The number of wires in the synthesized Yosys netlist.",
        "Yosys reads `/design/num_wires` from the stat JSON and publishes the resulting structural count.",
        "A Yosys wire is a netlist representation; it is not routed wirelength or a count of physical nets after implementation.",
        ("yosys.metrics", "ecc.metrics"),
    ),
    "die_area": (
        "The current physical die area in square micrometres.",
        "The feature parser writes `Design Layout.die_area`; the metric builder converts it to a finite number and publishes `round(value, 3)`.",
        "It is a database geometry fact at this step, not cell area and not evidence that utilization or DRC constraints pass.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "core_area": (
        "The current usable core area in square micrometres.",
        "The feature parser writes `Design Layout.core_area`; the metric builder publishes the finite value rounded to three decimals.",
        "It describes the saved core rectangle, not the free placement area after macro halos, blockages, or routing reservations.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "core_utilization": (
        "The feature database's current core-usage ratio.",
        "The parser publishes `Design Layout.core_usage`, and the metric builder normalizes its finite numeric value before publication.",
        "It is the tool's summary ratio, not a proof of legal placement, density closure, or available routing capacity.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "instance_count": (
        "The number of instances in the saved physical database.",
        "The parser writes `Design Statis.num_instances`; the stage metric builder publishes that finite count after the stage mutation is saved.",
        "This includes whatever the current database represents at that stage and is not limited to movable standard cells.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "net_count": (
        "The number of nets in the saved physical database.",
        "The parser writes `Design Statis.num_nets`; the metric builder publishes that finite count after persistence.",
        "It is a database connectivity count, not a count of routed nets, timing paths, or DRC violations.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "fanout_max": (
        "The fanout threshold field exposed by the post-fixFanout feature database.",
        "The metric builder first reads `Pins.max_fanout`; only when it is absent does it fall back to the workspace `Max fanout` parameter. The native feature builder initializes this field to 32 and bins pin fanout as `0..32` and `>32`.",
        "Despite its name, this path does not rescan every final net to prove an observed maximum fanout; interpret it as the published threshold or fallback reference.",
        ("ecc.metrics", "ecc.feature.summary", "ecc.feature.builder", "izh.fanout"),
    ),
    "io_pin_count": (
        "The number of IO pins in the saved physical database.",
        "The parser writes `Design Statis.num_iopins`, which the metric builder publishes as a finite count.",
        "It is a physical IO-pin count at the saved step state, not Yosys port-bit count or a measure of IO-placement legality.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "clock_path_max_buffer": (
        "The largest inserted-buffer count found on a reachable clock path.",
        "CTS evaluates clock-path depth statistics and writes `CTS.clock_path_max_buffer`, which the metric builder reads directly.",
        "When path statistics are unavailable the native summary currently retains zero, so zero is not independently validated proof of a buffer-free clock tree.",
        ("ecc.metrics", "icts.qor", "icts.qor_metrics", "icts.api", "ecc.feature.tools"),
    ),
    "clock_path_min_buffer": (
        "The smallest inserted-buffer count found on a reachable clock path.",
        "CTS writes the minimum path-depth statistic to `CTS.clock_path_min_buffer`, and the metric builder publishes it directly.",
        "It is a descriptive minimum rather than a closure target; an unavailable native path statistic can currently appear as zero.",
        ("ecc.metrics", "icts.qor", "icts.qor_metrics", "icts.api", "ecc.feature.tools"),
    ),
    "clock_wirelength": (
        "The total wirelength of reachable clock nets reported by CTS.",
        "CTS sums clock-net wirelengths into `total_clock_network_wirelength_dbu`; the current feature bridge writes that DBU field as `CTS.total_clock_wirelength`, and the metric builder publishes it.",
        "The GUI metadata labels this metric `um`, but the current C++ bridge supplies a DBU field without conversion. Do not treat the displayed value as verified micrometres until that interface is reconciled.",
        ("ecc.metrics", "icts.qor", "icts.qor_metrics", "icts.api", "ecc.feature.tools"),
    ),
    "cts_buffer_area": (
        "The total area of unique buffers inserted into clock trees, in square micrometres when the layout query is available.",
        "CTS de-duplicates clock-buffer instances and sums `queryCellAreaUm2(master)` into `CTS.buffer_area`; the metric builder publishes the finite result.",
        "If the layout or a buffer-master area is unavailable the native value is null and this metric is omitted; omission is not zero inserted-buffer area.",
        ("ecc.metrics", "icts.qor", "icts.api", "ecc.feature.tools"),
    ),
    "cts_buffer_count": (
        "The number of unique buffer instances counted across constructed clock trees.",
        "CTS inserts each clock-buffer instance into a set and increments `final_clock_buffer_count` only on first occurrence; it is emitted as `CTS.buffer_num`.",
        "It counts buffers identified by the CTS evaluator, not every buffer cell in the full design database.",
        ("ecc.metrics", "icts.qor", "icts.api", "ecc.feature.tools"),
    ),
    "cts_clock_tree_max_level": (
        "The maximum CTS clock-tree path level.",
        "The CTS bridge writes `pathBufferStats().max_buffer_count` into `CTS.max_level_of_clock_tree`, and the metric builder publishes it.",
        "In the current implementation this is the same path-buffer-depth statistic, not an independently computed topology-level metric.",
        ("ecc.metrics", "icts.qor_metrics", "icts.api", "ecc.feature.tools"),
    ),
    "cts_clock_wirelength_max": (
        "The greatest wirelength of one reachable clock net reported by CTS.",
        "CTS finds the maximum clock-net wirelength in DBU and writes it as `CTS.max_clock_wirelength`; the metric builder reads that field.",
        "As with total clock wirelength, GUI metadata says `um` while the current C++ bridge writes DBU, so the published unit is not source-verified.",
        ("ecc.metrics", "icts.qor", "icts.qor_metrics", "icts.api", "ecc.feature.tools"),
    ),
    "cts_worst_optimized_skew_ns": (
        "The largest optimized skew over clocks for which CTS timing facts are available, in nanoseconds.",
        "The native CTS timing bridge takes `max(clock.optimized_skew_ns)` and the metric builder publishes it only when `CTS.timing_quality.availability == 'available'`.",
        "This is CTS timing-feature coverage, not multi-corner post-route STA signoff; unavailable timing facts omit the metric rather than reporting zero skew.",
        ("ecc.metrics", "icts.api"),
    ),
    "cts_worst_max_insertion_latency_ns": (
        "The largest maximum insertion latency over available CTS clock timing facts, in nanoseconds.",
        "The native CTS timing bridge takes `max(clock.max_insertion_latency_ns)` and the metric builder requires `timing_quality.availability == 'available'` before publishing it.",
        "It is omitted when CTS timing facts are unavailable and must not be substituted by a default latency or an STA result.",
        ("ecc.metrics", "icts.api"),
    ),
    "cts_skew_target_unmet_count": (
        "The number of available CTS clocks whose skew target is not met.",
        "The native timing bridge sums `1` for each clock with `target_met == false`; publication is gated by `CTS.timing_quality.availability`.",
        "It only covers clocks returned by the CTS timing feature and is not a count of timing-path violations across all STA corners.",
        ("ecc.metrics", "icts.api"),
    ),
    "route_wirelength": (
        "The total routed-net wirelength represented by the saved ECC database.",
        "The route metric builder reads `Nets.wire_len` from the route database feature summary and publishes the finite value.",
        "This database summary is distinct from detailed-router iteration wirelength and does not identify the iteration or layer contributions.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "route_via_count": (
        "The total via count represented by the saved ECC database.",
        "The route metric builder reads `Nets.num_via` from the route database feature summary and publishes the finite count.",
        "This database count is distinct from detailed-router per-iteration via totals and does not isolate vias introduced by a particular route pass.",
        ("ecc.metrics", "ecc.feature.summary"),
    ),
    "route_dr_total_patch_count": (
        "The total detailed-routing patch count for the selected final detailed-routing iteration.",
        "The detailed router counts every patch rectangle while collecting layer totals; the metric builder obtains `total_patch_num` from `_latest_route_iteration(route.DR)`.",
        "The builder does not blindly read the last array item: it prefers the greatest numeric `iter`, while a later nonnumeric item becomes the selected record. It is not a DRC-violation count.",
        ("ecc.metrics", "irt.detailed_router", "ecc.feature.tools"),
    ),
    "route_dr_total_via_count": (
        "The total detailed-routing via crossings for the selected final iteration.",
        "For each cross-layer routed segment, the detailed router counts each adjacent-layer crossing and emits `total_via_num`; the metric builder reads it from the selected DR iteration.",
        "It is iteration-scoped and differs from the aggregate database `route_via_count`; DR iteration selection follows `_latest_route_iteration(route.DR)`.",
        ("ecc.metrics", "irt.detailed_router", "ecc.feature.tools"),
    ),
    "route_dr_total_violation_count": (
        "The total detailed-routing violation count for the selected final iteration.",
        "The detailed router traverses its route-violation list, increments per-layer counts and `total_violation_num`, then the metric builder reads that field from the selected DR iteration.",
        "It is the router's iteration result, not an independent iDRC signoff count; DR iteration selection follows `_latest_route_iteration(route.DR)`.",
        ("ecc.metrics", "irt.detailed_router", "ecc.feature.tools"),
    ),
    "route_dr_total_wirelength": (
        "The detailed-routing wirelength for the selected final iteration, in micrometres.",
        "For same-layer routed segments, the detailed router adds Manhattan distance divided by `micron_dbu` to `total_wire_length`; the metric builder reads it from the selected DR iteration.",
        "It excludes cross-layer segment length and is distinct from the aggregate database wirelength; DR iteration selection follows `_latest_route_iteration(route.DR)`.",
        ("ecc.metrics", "irt.detailed_router", "ecc.feature.tools"),
    ),
    "route_la_total_demand": (
        "The total layer-assignment routing demand across routing-edge grids.",
        "The layer assigner sums `routing_edge.get_demand()` for horizontal and vertical edges of every routing layer into `route.LA.total_demand`; the metric builder publishes that aggregate.",
        "It is a layer-assignment grid demand quantity, not detailed-route wirelength, physical utilization, or a DRC count.",
        ("ecc.metrics", "irt.layer_assigner", "ecc.feature.tools"),
    ),
    "route_la_total_overflow": (
        "The total layer-assignment routing overflow across routing-edge grids.",
        "The layer assigner sums `routing_edge.get_overflow()` for each routing layer into `route.LA.total_overflow`; the metric builder publishes that aggregate.",
        "It is an early routing-capacity excess, not the detailed router's violation count or a final signoff DRC result.",
        ("ecc.metrics", "irt.layer_assigner", "ecc.feature.tools"),
    ),
    "drc_count": (
        "The total DRC violations reported by the saved DRC feature record.",
        "The metric builder reads `drc.number` from the DRC step feature and publishes the finite count; the DRC clean gate requires it to equal zero.",
        "A missing or malformed feature is unavailable, not zero violations, and this number does not describe which rules or shapes caused the violations.",
        ("ecc.metrics", "idrc.interface", "ecc.feature.tools"),
    ),
    "rcx_missing_corner_count": (
        "The number of declared RCX corners without a published SPEF output.",
        "RCX metrics compare expected SPEF corner paths with published files and write the missing count into the persisted RCX coverage facts.",
        "It measures output coverage, not electrical correctness of SPEFs that do exist and not timing coverage until STA consumes them.",
        ("ecc.metrics", "ircx.spef_writer", "ecc.sta_qor"),
    ),
    "rcx_spef_parse_failure_count": (
        "The number of published SPEF files that cannot be parsed into an electrical summary.",
        "ECC parses each published SPEF, records unsuccessful parses, and publishes the aggregate `parse_failure_count` from `rcx.electrical_summary`.",
        "A parseable SPEF is not proof that extraction is physically accurate; missing outputs are tracked separately by the corner-coverage metric.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "rcx_worst_total_capacitance_ff": (
        "The largest parsed total capacitance across RCX corners, in femtofarads.",
        "For each parseable SPEF, ECC converts ground and coupling capacitance to fF, sums them as total capacitance, then publishes the maximum corner value.",
        "Only parseable published corners participate; a missing or unparseable declared corner affects coverage and must not be silently treated as zero capacitance.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "rcx_worst_total_resistance_ohm": (
        "The largest parsed total resistance across RCX corners, in ohms.",
        "ECC converts per-corner SPEF resistance totals to ohms and publishes the maximum over parseable published corners.",
        "It is a corner summary, not a path delay or signoff timing result; incomplete SPEF coverage remains separately visible.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "sta_setup_wns": (
        "The worst setup worst negative slack across parseable STA corners, in nanoseconds.",
        "ECC reads each corner `/summary/setup/wns`, selects the numerical minimum, and records the responsible corner in the signoff facts.",
        "Worst means the smallest number, not the greatest absolute magnitude. Missing or unparseable corners do not enter the aggregate and instead reduce coverage.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "sta_setup_tns": (
        "The worst setup total negative slack across parseable STA corners, in nanoseconds.",
        "ECC reads each corner `/summary/setup/tns` and publishes the numerical minimum over available summaries.",
        "Missing or unparseable corners do not contribute a zero TNS; their absence is captured only by STA coverage facts.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "sta_hold_wns": (
        "The worst hold worst negative slack across parseable STA corners, in nanoseconds.",
        "ECC reads each corner `/summary/hold/wns` and publishes the numerical minimum over available summaries.",
        "This is an aggregate of available corner reports, not a replacement for checking whether every configured Liberty/RCX corner completed.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "sta_hold_tns": (
        "The worst hold total negative slack across parseable STA corners, in nanoseconds.",
        "ECC reads each corner `/summary/hold/tns` and publishes the numerical minimum over available summaries.",
        "Missing or unparseable corners do not enter the minimum; they must be evaluated through the separate coverage and gate evidence.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "sta_frequency_mhz": (
        "The lowest valid analyzed setup frequency across parseable STA corners, in MHz.",
        "ECC reads `/summary/setup/frequency_mhz` from each available corner and publishes the numerical minimum after rejecting nonpositive values.",
        "It does not derive a clock frequency from WNS, and incomplete corner coverage remains a separate signoff limitation.",
        ("ecc.metrics", "ecc.sta_qor"),
    ),
    "harden_artifact_missing_count": (
        "The number of required Harden package artifacts that are absent.",
        "ECC tests for GDS, LEF, and LIB existence, stores each boolean fact, and sums the zero-valued checks into a count from 0 through 3.",
        "This is package-path completeness only: it does not validate GDS/LEF/LIB contents, multi-corner timing correctness, or final QoR closure.",
        ("ecc.metrics", "ecc.runner"),
    ),
}
