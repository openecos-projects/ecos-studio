#!/usr/bin/env python3
"""Build source-audited ECOS knowledge bundles for non-placement flow steps."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from build_place_knowledge import PARAMETER_SEMANTICS as DREAMPLACE_PARAMETER_SEMANTICS

AGENT_ROOT = Path(__file__).parents[1]
ECOS_ROOT = AGENT_ROOT.parents[1]
DEFAULT_OUTPUT = AGENT_ROOT / "src" / "ecos_agent"

METRICS = {
    "synthesis": ("synthesis_cell_area", "synthesis_cell_count", "synthesis_port_count", "synthesis_wire_count"),
    "floorplan": ("die_area", "core_area", "core_utilization", "instance_count", "net_count"),
    "fixfanout": ("fanout_max", "instance_count", "net_count"),
    "cts": ("clock_path_max_buffer", "clock_path_min_buffer", "clock_wirelength", "cts_buffer_area", "cts_buffer_count", "cts_clock_tree_max_level", "cts_clock_wirelength_max", "cts_worst_optimized_skew_ns", "cts_worst_max_insertion_latency_ns", "cts_skew_target_unmet_count", "instance_count", "io_pin_count", "net_count"),
    "legalization": (),
    "route": ("route_dr_total_patch_count", "route_dr_total_via_count", "route_dr_total_violation_count", "route_dr_total_wirelength", "route_la_total_demand", "route_la_total_overflow", "route_via_count", "route_wirelength"),
    "drc": ("drc_count",),
    "filler": (),
    "rcx": ("rcx_missing_corner_count", "rcx_spef_parse_failure_count", "rcx_worst_total_capacitance_ff", "rcx_worst_total_resistance_ohm"),
    "sta": ("sta_setup_wns", "sta_setup_tns", "sta_hold_wns", "sta_hold_tns", "sta_frequency_mhz"),
    "harden": ("harden_artifact_missing_count",),
}


@dataclass(frozen=True)
class Stage:
    slug: str
    step_name: str
    aliases: tuple[str, ...]
    execution: str
    failure: str
    metric_source: str
    config_path: str | None = None
    tool_source_ids: tuple[str, ...] = ("ecc.runner", "ecc.module")


STAGES = (
    Stage(
        "synthesis",
        "Synthesis",
        ("synthesis", "synthesis stage", "综合阶段"),
        "The Yosys runner resolves the bundled or PATH runtime, validates that either RTL or a filelist exists, runs `yosys_synthesis.tcl`, and accepts the stage only when the configured output netlist exists. It then optionally runs supplemental netlist STA, publishes Yosys statistics, and runs its checklist.",
        "A missing Yosys runtime, no valid RTL or filelist, an unavailable required Slang plugin, or a missing output netlist marks the `run yosys` subflow invalid. A failed supplemental post-synthesis STA does not invalidate an otherwise generated netlist.",
        "Yosys reads its stat JSON and publishes cell count, cell area, wire count, and port count; available post-synthesis power facts are added separately.",
        tool_source_ids=("yosys.runner", "yosys.metrics", "ecc.runner"),
    ),
    Stage(
        "floorplan",
        "Floorplan",
        ("floorplan", "floor plan", "floorplanning", "floorplan stage", "布局规划阶段"),
        "The ECC runner loads the design database, calls `init_fp` with the Floorplan configuration, runs the floorplanner, and records track creation, IO-pin placement, tap-cell insertion, and PDN as subflow steps. It destroys the floorplan engine, saves the updated database and geometry snapshot, then runs analysis and checklist generation.",
        "The step cannot proceed without an ECC database instance. Its subflow status is progress evidence only; inspect saved artifacts and analysis records before claiming a successful floorplan.",
        "ECC reads design-layout and design-statistics facts to publish die/core area, core utilization, instance count, and net count.",
        "ecc/chipcompiler/tools/ecc/configs/fp_default_config.json",
    ),
    Stage(
        "fixfanout",
        "fixFanout",
        ("fixfanout", "fix fanout", "fanout optimization", "fanout stage", "扇出优化阶段"),
        "The ECC runner loads the current database, marks the configured clock net when present, invokes `run_net_opt`, saves the resulting design and geometry snapshot, and then produces metrics and checklist evidence.",
        "The step cannot execute when ECC input loading fails. The reported maximum fanout is evidence from the saved feature database or workspace parameter, not proof that every timing or electrical constraint is closed.",
        "ECC publishes maximum fanout together with database instance and net counts after net optimization.",
        "ecc/chipcompiler/tools/ecc/configs/no_default_config_fixfanout.json",
    ),
    Stage(
        "cts",
        "CTS",
        ("cts", "clock tree synthesis", "clock tree", "cts stage", "时钟树阶段"),
        "The ECC runner loads the design, invokes `run_cts` for clock-tree synthesis with the CTS configuration and step data directory, writes a CTS report and map, saves the design, persists clock-timing feature facts, and then runs analysis and checklist generation.",
        "The step cannot execute without an ECC database instance. CTS metric availability depends on the persisted `CTS` feature facts; absent timing-quality facts must remain unavailable rather than be interpreted as zero skew.",
        "ECC reads the `CTS` feature record for buffer, clock-path, wirelength, level, skew, and insertion-latency facts, then the GUI selects the published normalized metrics.",
        "ecc/chipcompiler/tools/ecc/configs/cts_default_config.json",
    ),
    Stage(
        "legalization",
        "legalization",
        ("legalization", "legalize", "placement legalization", "legalization stage", "合法化阶段"),
        "The DreamPlace runner loads ECC data, builds `DreamplaceModule`, forces legalization-only parameters, creates the placement engine, and runs it. In legalization-only mode global placement and fillers are disabled while `legalize_flag` is enabled; the runner then saves the design and runs analysis and checklist generation.",
        "A missing ECC instance prevents execution. DreamPlace reports failure when its PPA result has infinite HPWL, so subflow progress alone is not terminal legalization evidence.",
        "The standard GUI stage comparison has no legalization-specific numeric metric. Database and QoR artifacts are still produced by the shared analysis path when the run reaches it.",
        "ecc/chipcompiler/tools/ecc_dreamplace/configs/dreamplace.json",
        ("dreamplace.runner", "dreamplace.module", "ecc.runner", "ecc.module"),
    ),
    Stage(
        "route",
        "route",
        ("route", "routing", "route stage", "布线阶段"),
        "The ECC runner loads the design, initializes STA first only when routing timing is enabled by the route configuration, invokes `run_routing`, saves the resulting design and geometry snapshot, then runs analysis and checklist generation.",
        "The step cannot execute without an ECC database instance. Routing timing initialization is conditional on the configuration, so timing data must not be assumed from route completion alone.",
        "ECC collects database net wirelength and via counts plus route feature facts; the GUI exposes detailed-route patch, via, violation, wirelength, demand, and overflow records when available.",
        "ecc/chipcompiler/tools/ecc/configs/rt_default_config.json",
    ),
    Stage(
        "drc",
        "drc",
        ("drc", "design rule check", "drc stage", "设计规则检查阶段"),
        "The ECC runner loads the design, initializes the DRC engine in the step data directory, invokes `run_drc` with the configured report path, saves the design, persists DRC feature data, and then runs analysis and checklist generation.",
        "The step cannot execute without an ECC database instance. A DRC run needs its feature/report artifacts to distinguish zero reported violations from missing analysis output.",
        "ECC reads the `drc.number` feature fact to publish the DRC count used by the GUI.",
        "ecc/chipcompiler/tools/ecc/configs/drc_default_config.json",
    ),
    Stage(
        "filler",
        "filler",
        ("filler", "filler insertion", "filler stage", "填充单元阶段"),
        "The ECC runner loads the design, invokes `run_filler` with the workspace Filler configuration, saves the updated design and geometry snapshot, then runs analysis and checklist generation.",
        "The step cannot execute without an ECC database instance. The standard GUI has no filler-specific comparison metric, so artifact and checklist evidence are required to assess its result.",
        "The standard GUI stage comparison has no filler-specific numeric metric; shared database and QoR artifacts remain the available evidence.",
    ),
    Stage(
        "rcx",
        "RCX",
        ("rcx", "parasitic extraction", "spef", "rcx stage", "寄生参数提取阶段"),
        "The ECC runner loads the design, initializes RCX with the workspace PDK, runs and destroys RCX, copies generated SPEF files to the declared output paths, saves the design, persists bounded SPEF feature facts, and runs analysis and checklist generation.",
        "The step cannot execute without an ECC database instance. Missing SPEF outputs or unparseable corner files must remain visible through RCX feature and signoff metrics rather than being treated as a successful extraction.",
        "ECC derives SPEF file and expected-corner coverage, parses electrical totals by corner, and publishes missing-corner, parse-failure, worst-capacitance, and worst-resistance facts.",
        "ecc/chipcompiler/tools/ecc/configs/rcx.json",
    ),
    Stage(
        "sta",
        "sta",
        ("sta", "static timing analysis", "timing signoff", "sta stage", "静态时序分析阶段"),
        "The ECC runner expands configured STA signoff items into Liberty and RCX-corner combinations. For each item it requires the SDC, SPEF, and Liberty files, runs timing into corner-specific report and feature directories, saves the design, and then builds multi-corner analysis and checklist evidence.",
        "No signoff items, a missing SDC, SPEF, Liberty file, or report/feature directory terminates STA as incomplete. The stage does not synthesize missing corners, and its aggregate results must preserve that coverage state.",
        "ECC reads all available corner QoR summaries, selects the worst setup/hold WNS and TNS and lowest frequency, records violation and coverage counts, then emits signoff facts and timing-issue artifacts.",
        "ecc/chipcompiler/tools/ecc/configs/sta.json",
    ),
    Stage(
        "harden",
        "Harden",
        ("harden", "hardening", "harden stage", "交付阶段"),
        "The ECC runner loads the database, requires at least one configured STA signoff item, writes an abstract LEF, writes a timing-model LIB from the selected signoff inputs, exports hardened GDS, and then runs final package analysis.",
        "Without signoff STA items the runner returns failure before artifact generation. Final delivery evidence requires the generated GDS, LEF, and LIB package artifacts, not merely a completed subflow record.",
        "ECC checks hardened GDS, LEF, and LIB existence and publishes the count of missing required delivery artifacts.",
        "ecc/chipcompiler/tools/ecc/configs/sta.json",
    ),
)

SOURCE_PATHS = {
    "ecc.runner": "ecc/chipcompiler/tools/ecc/runner.py",
    "ecc.module": "ecc/chipcompiler/tools/ecc/module.py",
    "ecc.metrics": "ecc/chipcompiler/tools/ecc/metrics.py",
    "ecc.builder": "ecc/chipcompiler/tools/ecc/builder.py",
    "ecc.subflow": "ecc/chipcompiler/tools/ecc/subflow.py",
    "ecc.flow": "ecc/chipcompiler/rtl2gds/builder.py",
    "gui.step_metrics": "ecos/gui/apps/renderer/src/utils/projectManagement.ts",
    "yosys.runner": "ecc/chipcompiler/tools/yosys/runner.py",
    "yosys.metrics": "ecc/chipcompiler/tools/yosys/metrics.py",
    "dreamplace.runner": "ecc/chipcompiler/tools/ecc_dreamplace/runner.py",
    "dreamplace.module": "ecc/chipcompiler/tools/ecc_dreamplace/module.py",
}

ALGORITHM_DETAILS = {
    "synthesis": (
        ("input_gate", ("synthesis inputs", "yosys input validation"), "**Input gate:** The runner accepts either an existing RTL file or an existing filelist. It obtains the Yosys runtime before invoking the Tcl script and, when required by the step data, verifies the Slang plugin before synthesis starts."),
        ("completion", ("synthesis completion", "yosys output netlist"), "**Completion gate:** Yosys process exit alone is insufficient. The runner accepts synthesis only after `step.output.verilog` exists, then records `run yosys` success and publishes statistics and checklist evidence."),
    ),
    "floorplan": (
        ("subflow", ("floorplan subflow", "floorplan stage order"), "**Subflow order:** `load data -> init floorplan -> create tracks -> place IO pins -> tap cell -> PDN -> set clock net -> save data -> analysis`. These are recorded progress checkpoints around one `init_fp`/`run_fp` invocation."),
        ("physical_setup", ("floorplan die core pdn", "floorplan tracks pins taps"), "**Physical setup:** The Floorplan configuration drives die/core construction, routing tracks, IO placement, well taps and endcaps, then PDN global-connect, rail, stripe and layer-connect generation. The saved result is the baseline physical database for downstream stages."),
    ),
    "fixfanout": (
        ("subflow", ("fixfanout subflow", "fanout stage order"), "**Subflow order:** `load data -> set clock net -> run net optimization -> save data -> analysis`. Clock tagging is conditional on the workspace Clock parameter being non-empty; it is not inferred from a net name."),
        ("fanout_source", ("fixfanout max fanout", "fanout metric source"), "**Result boundary:** Net optimization mutates the ECC database through `run_net_opt`. The reported maximum fanout is read from `Pins.max_fanout` in the saved feature database, falling back to the workspace parameter only when that fact is absent."),
    ),
    "cts": (
        ("subflow", ("cts subflow", "clock tree stage order"), "**Subflow order:** `load data -> run CTS -> save data -> analysis`. Inside the CTS runner, `run_cts`, `report_cts`, and `feature_cts_map` execute before persistence; timing feature facts are saved after the database has been saved."),
        ("timing_quality", ("cts timing quality", "cts skew calculation"), "**Clock-quality boundary:** Buffer and wirelength facts come from the `CTS` feature record. Skew, insertion latency and target-unmet counts are emitted only when `timing_quality.availability` is `available`; missing timing facts must not be represented as zero."),
    ),
    "legalization": (
        ("parameter_overrides", ("legalization overrides", "dreamplace legalize only"), "**Forced mode:** `DreamplaceModule._build_params()` overrides global placement, filler insertion and random-center initialization to off; it forces `legalize_flag=1` and enables automatic bin adjustment. These runtime assignments take precedence over the serialized DreamPlace defaults."),
        ("subflow", ("legalization subflow", "legalization completion"), "**Subflow order:** `load data -> run legalization -> save data -> analysis`. `PlacementEngine.run()` is the tool boundary. A finite PPA HPWL is required from `DreamplaceModule` before it returns success, but the runner must still save valid terminal artifacts for the stage claim to be auditable."),
    ),
    "route": (
        ("timing_setup", ("route timing setup", "routing timing enable"), "**Conditional timing setup:** Before routing, the runner calls `is_rt_timing_enable(config)`. Only a true result releases any prior STA state and initializes STA with the workspace top module, Liberty files and SDC; otherwise routing proceeds without that timing initialization."),
        ("subflow", ("route subflow", "routing stage order"), "**Subflow order:** `load data -> run routing -> save data -> analysis`. Route analysis publishes database wirelength/via facts and detailed-routing or layer-assignment feature facts only when their source records are available."),
    ),
    "drc": (
        ("engine_lifecycle", ("drc engine lifecycle", "drc report generation"), "**Engine lifecycle:** The runner initializes DRC in the step data directory, executes `run_drc` with the workspace configuration and step report path, then saves both the common design artifacts and DRC-specific feature data."),
        ("subflow", ("drc subflow", "drc stage order"), "**Subflow order:** `load data -> run DRC -> save data -> analysis`. A numerical `drc.number` is a count from the persisted feature record; it cannot distinguish an empty rule report from an analysis file that was never generated without the artifact evidence."),
    ),
    "filler": (
        ("subflow", ("filler subflow", "filler stage order"), "**Subflow order:** `load data -> run filler -> save data -> analysis`. Filler insertion is delegated to `ECCToolsModule.run_filler` with the workspace Filler configuration, then the changed ECC database is serialized for downstream signoff stages."),
        ("result_boundary", ("filler result evidence", "filler completion"), "**Result boundary:** This flow version does not publish a filler-specific GUI comparison metric. A filler-success claim therefore requires the saved post-filler database/geometry and the step checklist, not an assumed change in instance count."),
    ),
    "rcx": (
        ("extraction_lifecycle", ("rcx extraction lifecycle", "rcx spef generation"), "**Extraction lifecycle:** The runner initializes RCX with the workspace PDK, runs extraction, destroys the RCX engine, then copies SPEFs from the RCX writer directory to the declared step outputs. The copied outputs, rather than the transient writer files, are the downstream STA inputs."),
        ("feature_facts", ("rcx corner coverage", "rcx electrical facts"), "**Feature facts:** `save_rcx_spef_feature_facts` records expected SPEF corners, output existence, parse failures and per-corner electrical totals after copy. The stage returns false if that fact publication fails."),
    ),
    "sta": (
        ("signoff_matrix", ("sta signoff matrix", "sta corners"), "**Signoff matrix:** `collect_sta_signoff_items` expands each configured Liberty corner and its listed RCX corners into one timing run. STA iterates that complete matrix; it does not select a single worst corner before analysis."),
        ("aggregate", ("sta worst corner", "sta multi corner aggregation"), "**Aggregation:** The metric builder reads available corner QoR summaries, selects the minimum setup/hold WNS and TNS and minimum frequency, sums setup/hold violation counts, and retains loaded/missing-corner coverage in the structured STA facts."),
    ),
    "harden": (
        ("package_generation", ("harden package generation", "abstract lef timing lib"), "**Package generation:** Harden takes the first resolved STA signoff item, writes an abstract LEF, derives a timing-model LIB from that item's Liberty/SDC/SPEF inputs, and exports GDS with `is_harden=True`. It does not call the common `save_data` path."),
        ("completion", ("harden completion", "harden delivery artifacts"), "**Completion gate:** Final analysis checks the existence of the generated GDS, LEF and LIB and publishes their missing-count. A completed harden subflow without this three-artifact package is not delivery completion."),
    ),
}

FAILURE_DETAILS = {
    "synthesis": (
        ("runtime", ("yosys unavailable", "synthesis runtime missing"), "The runner marks `run yosys` invalid when neither the bundled runtime nor PATH provides Yosys. It writes the error to the step log when possible and does not invoke Tcl."),
        ("output_netlist", ("synthesis netlist missing", "yosys output missing"), "After the subprocess returns, the runner requires the configured output netlist to exist. A zero process exit without that file is reported as invalid synthesis."),
    ),
    "floorplan": (
        ("engine", ("floorplan ECC unavailable", "floorplan load data failed"), "If `get_eda_instance` returns no ECC module, the floorplan runner does not enter `init_fp` or `run_fp` and returns false."),
        ("geometry", ("floorplan geometry missing", "floorplan manifest missing"), "For floorplan, shared persistence requires `geometry_snapshot_save` and an existing geometry manifest. Either failure causes `save_data` to return false."),
    ),
    "fixfanout": (
        ("engine", ("fixfanout ECC unavailable", "fixfanout load data failed"), "If ECC input loading fails, the runner never calls `run_net_opt`; no subflow success state is evidence of a fanout fix."),
        ("metric_fallback", ("fixfanout metric fallback", "fanout evidence missing"), "When `Pins.max_fanout` is absent, the metric builder falls back to the workspace parameter. Treat that fallback as a configured limit reference, not measured post-optimization fanout evidence."),
    ),
    "cts": (
        ("engine", ("cts ECC unavailable", "cts load data failed"), "Without an ECC module, CTS, its report, map, and timing feature facts are not executed."),
        ("timing_facts", ("cts timing facts missing", "cts skew unavailable"), "If `feature_cts_timing` cannot be persisted after `save_data`, the CTS runner logs an error and returns false. Missing timing facts cannot be repaired by the visual map."),
    ),
    "legalization": (
        ("engine", ("legalization ECC unavailable", "legalization load data failed"), "Without an ECC module, DreamPlace legalization is not constructed and no legal placement is produced."),
        ("infinite_hpwl", ("legalization hpwl inf", "dreamplace legalization failed"), "`DreamplaceModule` returns false when `PlacementEngine.run()` reports infinite HPWL. The DreamPlace runner's progress record must not override that terminal tool result."),
    ),
    "route": (
        ("engine", ("route ECC unavailable", "routing load data failed"), "Without an ECC module, routing and conditional STA initialization do not run."),
        ("conditional_sta", ("route timing unavailable", "routing sta disabled"), "A completed route does not prove timing-aware routing. Verify that the route configuration enabled timing and that STA initialization/artifacts exist before making that claim."),
    ),
    "drc": (
        ("engine", ("drc ECC unavailable", "drc load data failed"), "Without an ECC module, DRC initialization and rule checking do not run."),
        ("feature", ("drc feature missing", "drc count unavailable"), "The DRC count comes from the saved feature record. If that record is absent or malformed, a missing number must not be reported as zero violations."),
    ),
    "filler": (
        ("engine", ("filler ECC unavailable", "filler load data failed"), "Without an ECC module, the runner does not invoke filler insertion."),
        ("evidence", ("filler artifacts missing", "filler result unavailable"), "There is no dedicated filler metric in the GUI comparison set. Missing saved artifacts or checklist output leaves the filler result unverified."),
    ),
    "rcx": (
        ("engine", ("rcx ECC unavailable", "rcx load data failed"), "Without an ECC module, RCX cannot initialize with the workspace PDK."),
        ("spef_facts", ("rcx spef facts missing", "rcx corner coverage missing"), "If RCX SPEF fact persistence fails after extraction, the runner returns false. Do not use transient files in `spef_writer` as a substitute for declared SPEF outputs."),
    ),
    "sta": (
        ("missing_sdc", ("sta sdc missing", "sta constraint missing"), "STA marks its subflow incomplete and returns false when the workspace SDC path does not exist."),
        ("missing_corner_input", ("sta spef missing", "sta liberty missing"), "For every signoff item, a missing SPEF or any missing Liberty file marks STA incomplete before timing is run. The aggregate must preserve that incomplete coverage."),
    ),
    "harden": (
        ("engine", ("harden ECC unavailable", "harden load data failed"), "Without an ECC module, abstract LEF, timing-model LIB, and hardened GDS are not generated."),
        ("delivery", ("harden artifact missing", "harden package incomplete"), "The final missing-artifact metric counts absent GDS, LEF, or LIB. It is a package-completeness gate, not a substitute for checking their contents."),
    ),
}

METRIC_DETAILS = {
    "synthesis_cell_area": ("The total mapped cell area after Yosys synthesis.", "Yosys reads `design.area` from its stat JSON and rounds it to two decimal places before publishing the normalized record."),
    "synthesis_cell_count": ("The number of mapped cells in the synthesized design.", "Yosys reads `design.num_cells` from the stat JSON; it is a post-synthesis structural count."),
    "synthesis_port_count": ("The number of synthesized port bits.", "Yosys reads `design.num_port_bits` from the stat JSON."),
    "synthesis_wire_count": ("The number of synthesized wires.", "Yosys reads `design.num_wires` from the stat JSON."),
    "die_area": ("The physical die area in square micrometers.", "ECC reads `Design Layout.die_area` from the saved database feature summary and rounds the displayed value to three decimals."),
    "core_area": ("The physical core area in square micrometers.", "ECC reads `Design Layout.core_area` from the saved database feature summary and rounds the displayed value to three decimals."),
    "core_utilization": ("The fraction of usable core area occupied by the design.", "ECC maps `Design Layout.core_usage` into the normalized core-utilization metric; availability follows the saved database feature summary."),
    "instance_count": ("The current number of design instances.", "ECC reads `Design Statis.num_instances` from the saved database feature summary after the stage has mutated the database."),
    "net_count": ("The current number of design nets.", "ECC reads `Design Statis.num_nets` from the saved database feature summary after the stage has mutated the database."),
    "fanout_max": ("The maximum observed pin fanout after net optimization.", "ECC uses `Pins.max_fanout` from the feature database; only when it is absent does the metric builder use the workspace Max fanout parameter as a fallback."),
    "io_pin_count": ("The current number of IO pins.", "ECC reads `Design Statis.num_iopins` from the saved database feature summary."),
    "clock_path_max_buffer": ("The largest buffer count on a clock path.", "ECC reads `CTS.clock_path_max_buffer` from the CTS step feature record."),
    "clock_path_min_buffer": ("The smallest buffer count on a clock path.", "ECC reads `CTS.clock_path_min_buffer` from the CTS step feature record."),
    "clock_wirelength": ("The total clock-network wirelength.", "ECC reads `CTS.total_clock_wirelength` and publishes it through the normalized clock-wirelength metric."),
    "cts_buffer_area": ("The total area of buffers inserted by CTS.", "ECC reads `CTS.buffer_area` from the CTS step feature record."),
    "cts_buffer_count": ("The number of buffers inserted by CTS.", "ECC reads `CTS.buffer_num` from the CTS step feature record."),
    "cts_clock_tree_max_level": ("The maximum hierarchy level of a clock tree.", "ECC reads `CTS.max_level_of_clock_tree` from the CTS step feature record."),
    "cts_clock_wirelength_max": ("The maximum wirelength of an individual clock tree.", "ECC reads `CTS.max_clock_wirelength` from the CTS step feature record."),
    "cts_worst_optimized_skew_ns": ("The worst optimized clock skew in nanoseconds.", "When `CTS.timing_quality.availability` is `available`, ECC reads `worst_optimized_skew_ns`; otherwise the metric is omitted."),
    "cts_worst_max_insertion_latency_ns": ("The largest clock insertion latency in nanoseconds.", "When CTS timing quality is available, ECC reads `timing_quality.worst_max_insertion_latency_ns`; otherwise the metric is omitted."),
    "cts_skew_target_unmet_count": ("The number of clocks whose skew target remains unmet.", "When CTS timing quality is available, ECC reads `timing_quality.target_unmet_count`; otherwise the metric is omitted."),
    "route_wirelength": ("The total routed-net wirelength represented in the ECC database.", "ECC reads `Nets.wire_len` from the saved database feature summary."),
    "route_via_count": ("The total via count represented in the ECC database.", "ECC reads `Nets.num_via` from the saved database feature summary."),
    "route_dr_total_patch_count": ("The total detailed-routing patch count.", "The QoR record is selected from the route step feature's detailed-routing `route.DR` facts."),
    "route_dr_total_via_count": ("The total detailed-routing via count.", "The QoR record is selected from the route step feature's detailed-routing `route.DR` facts."),
    "route_dr_total_violation_count": ("The total detailed-routing violation count.", "The QoR record is selected from the route step feature's detailed-routing `route.DR` facts."),
    "route_dr_total_wirelength": ("The total detailed-routing wirelength.", "The QoR record is selected from the route step feature's detailed-routing `route.DR` facts."),
    "route_la_total_demand": ("The total layer-assignment routing demand.", "The QoR record is selected from the route step feature's layer-assignment `route.LA` facts."),
    "route_la_total_overflow": ("The total layer-assignment routing overflow.", "The QoR record is selected from the route step feature's layer-assignment `route.LA` facts."),
    "drc_count": ("The total number of reported DRC violations.", "ECC reads `drc.number` from the DRC step feature record; no record means the metric is unavailable, not zero."),
    "rcx_missing_corner_count": ("The number of expected RCX corners without a published SPEF.", "ECC counts missing expected corners in the persisted `rcx.signoff_metrics` facts."),
    "rcx_spef_parse_failure_count": ("The number of SPEF files that could not be parsed for electrical aggregation.", "ECC reads `rcx.electrical_summary.parse_failure_count` after parsing the published SPEFs."),
    "rcx_worst_total_capacitance_ff": ("The largest total capacitance across parsed RCX corners in femtofarads.", "ECC takes the worst parsed per-corner total capacitance in `rcx.electrical_summary`."),
    "rcx_worst_total_resistance_ohm": ("The largest total resistance across parsed RCX corners in ohms.", "ECC takes the worst parsed per-corner total resistance in `rcx.electrical_summary`."),
    "sta_setup_wns": ("The worst setup slack across loaded STA corners.", "ECC selects the minimum `setup_wns` from all available corner QoR summaries and records the responsible corner."),
    "sta_setup_tns": ("The worst setup total negative slack across loaded STA corners.", "ECC selects the minimum `setup_tns` from all available corner QoR summaries and records the responsible corner."),
    "sta_hold_wns": ("The worst hold slack across loaded STA corners.", "ECC selects the minimum `hold_wns` from all available corner QoR summaries and records the responsible corner."),
    "sta_hold_tns": ("The worst hold total negative slack across loaded STA corners.", "ECC selects the minimum `hold_tns` from all available corner QoR summaries and records the responsible corner."),
    "sta_frequency_mhz": ("The lowest analyzed operating frequency across loaded STA corners.", "ECC selects the minimum corner `frequency_mhz`; missing configured corners remain recorded in STA coverage facts."),
    "harden_artifact_missing_count": ("The number of required final delivery artifacts that are absent.", "ECC checks the hardened GDS, abstract LEF, and timing-model LIB paths and sums the missing checks."),
}

PARAMETER_DETAILS = {
    "floorplan": {
        "ifp.temp_directory_path": ("The floorplan temporary-directory path.", "It selects the scratch location used by the floorplan engine."),
        "ifp.thread_number": ("The floorplan worker-thread count.", "It bounds parallel work performed by the floorplan engine."),
        "macro_placer.macro_placement_halo": ("The halo reserved around placed macros.", "It keeps standard-cell and routing resources away from macro boundaries during macro placement."),
        "macro_placer.macro_routing_halo": ("The routing halo reserved around macros.", "It reserves routing clearance around macro boundaries."),
        "macro_placer.macro_location_path": ("The macro-location input path.", "It supplies fixed or guided macro positions to the macro placer."),
        "die_builder.mode": ("The die-construction mode.", "It selects whether die geometry is derived from utilization or an explicit size."),
        "die_builder.site_name": ("The core placement-site name.", "It selects the technology site used to build core rows."),
        "die_builder.die_util.aspect_ratio": ("The target die aspect ratio in utilization mode.", "It shapes the die dimensions while the target utilization determines area."),
        "die_builder.die_util.utilization": ("The target die utilization in utilization mode.", "It determines the die area required for the current design content."),
        "die_builder.die_size.width_micron": ("The explicit die width in micrometers.", "It is used when the die-construction mode selects explicit dimensions."),
        "die_builder.die_size.height_micron": ("The explicit die height in micrometers.", "It is used when the die-construction mode selects explicit dimensions."),
        "io_placer.io_layer_list": ("The routing layers eligible for IO-pin placement.", "It constrains where the floorplan can place IO pins."),
        "io_placer.width_micron": ("The IO-pin width in micrometers.", "It defines the physical width of generated IO-pin shapes."),
        "io_placer.depth_micron": ("The IO-pin depth in micrometers.", "It defines the physical depth of generated IO-pin shapes."),
        "pdn_generator.global_connect": ("The global power/ground connection rules.", "It maps instance pins to named power and ground nets before PDN construction."),
        "pdn_generator.rail": ("The follow-pin PDN rail definitions.", "It creates local power rails on declared routing layers."),
        "pdn_generator.stripe": ("The PDN stripe definitions.", "It creates wider periodic power stripes with declared width, pitch, and offset."),
        "pdn_generator.connect_layers": ("The PDN layer-connection definitions.", "It specifies routing-layer pairs to connect through the power network."),
    },
    "fixfanout": {
        "insert_buffer": ("The buffer cell selection for fanout repair.", "It supplies the buffer implementation used when net optimization inserts drivers."),
        "max_fanout": ("The maximum allowed fanout constraint.", "It is the threshold that directs fanout optimization and validates the resulting fanout metric."),
        "file_path.sdc_file": ("The timing-constraint input path.", "It supplies constraints used by the net-optimization tool."),
        "file_path.lib_files": ("The Liberty input collection.", "It supplies cell timing and drive models to net optimization."),
        "file_path.lef_files": ("The LEF input collection.", "It supplies physical cell and routing data to net optimization."),
    },
    "cts": {
        "skew_bound": ("The target upper bound for clock skew.", "It directs CTS optimization and is compared against derived clock-quality facts."),
        "max_buf_tran": ("The maximum transition allowed at clock-buffer outputs.", "It constrains inserted-buffer electrical behavior during CTS."),
        "root_input_slew": ("The transition assumed at a clock-tree root.", "It seeds CTS timing propagation from the source clock pin."),
        "max_sink_tran": ("The maximum transition allowed at clock sinks.", "It constrains the delivered clock waveform at sink pins."),
        "max_cap": ("The maximum allowed clock-net capacitance.", "It bounds clock-tree loading during buffering and routing."),
        "max_fanout": ("The maximum allowed clock-buffer fanout.", "It limits how many sinks an inserted buffer may drive."),
        "max_length": ("The maximum permitted clock-wire segment length.", "It encourages buffering or topology changes for long clock connections."),
        "wirelength_iterations": ("The number of clock-wirelength optimization iterations.", "It bounds repeated CTS wirelength improvement passes."),
        "slew_steps": ("The number of transition optimization steps.", "It bounds CTS effort applied to transition repair."),
        "cap_steps": ("The number of capacitance optimization steps.", "It bounds CTS effort applied to capacitance repair."),
        "routing_layer": ("The routing layers available to CTS.", "It constrains clock-tree routing to the selected layer set."),
        "buffer_type": ("The buffer cell types eligible for CTS insertion.", "It limits the implementation choices available to the clock-tree builder."),
        "use_netlist": ("The switch selecting a supplied clock-net list.", "When enabled, CTS uses `net_list` rather than discovering clock nets from the database."),
        "net_list": ("The explicit clock-net list.", "It identifies the nets that CTS should synthesize when explicit selection is enabled."),
    },
    "route": {
        "RT.-temp_directory_path": ("The routing temporary-directory path.", "It selects scratch storage for the routing engine."),
        "RT.-bottom_routing_layer": ("The lowest routing layer available to routing.", "It constrains the lower bound of the routing stack."),
        "RT.-top_routing_layer": ("The highest routing layer available to routing.", "It constrains the upper bound of the routing stack."),
        "RT.-thread_number": ("The routing worker-thread count.", "It bounds routing-engine parallelism."),
        "RT.-enable_timing": ("The routing timing-awareness switch.", "It controls whether the runner initializes STA before routing."),
        "RT.-output_csv": ("The routing CSV-export switch.", "It controls emission of routing data in CSV form."),
        "RT.-output_inter_result": ("The routing intermediate-result switch.", "It controls persistence of intermediate routing results."),
    },
    "rcx": {
        "thread_num": ("The RCX worker-thread count.", "It bounds parallel parasitic extraction work."),
        "output": ("The RCX output directory.", "It is the source directory from which published SPEF outputs are copied."),
    },
    "sta": {
        "liberty": ("The Liberty-corner inventory.", "It maps each STA corner name and temperature to the Liberty files used for timing runs."),
        "signoff": ("The STA-to-RCX corner signoff matrix.", "It expands each Liberty corner into the RCX corners that must be analyzed."),
    },
    "harden": {
        "liberty": ("The Liberty-corner inventory reused by Harden.", "Harden takes the selected signoff item's Liberty files to derive its timing-model LIB."),
        "signoff": ("The STA-to-RCX corner matrix reused by Harden.", "Harden requires the first resolved signoff item to locate the SDC and SPEF inputs for LIB generation."),
    },
}

LEGALIZATION_OVERRIDES = {
    "global_place_flag": ("Whether continuous global placement runs.", "The legalization runner forces it to `0`, so global placement is skipped regardless of the serialized default."),
    "legalize_flag": ("Whether DreamPlace legalization runs.", "The legalization runner forces it to `1`, enabling the legalizer."),
    "enable_fillers": ("Whether filler nodes participate in the placement model.", "The legalization runner forces it to `0`, so it does not insert filler nodes."),
    "random_center_init_flag": ("Whether random-center initialization runs.", "The legalization runner forces it to `0`, preserving the incoming placed state for legalization."),
    "auto_adjust_bins": ("Whether DreamPlace may adjust density bins automatically.", "The legalization runner forces it to `1` for its legalize-only setup."),
}


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _revision(path: Path) -> str:
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def _stage_sources(stage: Stage) -> tuple[dict[str, str], tuple[str, ...]]:
    paths = dict(SOURCE_PATHS)
    source_ids = tuple(paths)
    if stage.config_path:
        config_id = f"config.{stage.slug}"
        paths[config_id] = stage.config_path
        source_ids += (config_id,)
    return paths, source_ids


def _source_inventory(stage: Stage) -> dict[str, object]:
    paths, _source_ids = _stage_sources(stage)
    return {
        "schema_version": "ecos-step-sources.v1",
        "repositories": {
            "ecos_studio": _revision(ECOS_ROOT),
            "ecc": _revision(ECOS_ROOT / "ecc"),
            "ecc_dreamplace": _revision(ECOS_ROOT / "ecc/chipcompiler/thirdparty/ecc-dreamplace"),
            "ecc_tools": _revision(ECOS_ROOT / "ecc/chipcompiler/thirdparty/ecc-tools"),
        },
        "sources": [
            {"id": source_id, "path": path, "sha256": _sha256((ECOS_ROOT / path).read_bytes())}
            for source_id, path in paths.items()
        ],
    }


def _section(entity_id: str, body: str, evidence: tuple[str, ...]) -> str:
    references = ", ".join(f"**{source_id}**" for source_id in evidence)
    return f'<a id="{entity_id}"></a>\n## {entity_id}\n\n{body.strip()}\n\n**Source evidence:** {references}\n'


def _add(
    entries: list[dict[str, object]],
    documents: dict[str, list[str]],
    *,
    entity_id: str,
    kind: str,
    aliases: tuple[str, ...],
    document: str,
    body: str,
    evidence: tuple[str, ...],
) -> None:
    chunk = _section(entity_id, body, evidence)
    documents.setdefault(document, []).append(chunk)
    entries.append(
        {
            "id": entity_id,
            "kind": kind,
            "aliases": list(aliases),
            "document": document,
            "anchor": entity_id,
            "review_status": "source-audited",
            "evidence": [{"source_id": source_id} for source_id in evidence],
            "chunk_sha256": _sha256(chunk.strip().encode("utf-8")),
        }
    )


def _flatten_config(value: object, prefix: str = "") -> list[tuple[str, object]]:
    if isinstance(value, dict):
        result: list[tuple[str, object]] = []
        for key in sorted(value):
            path = f"{prefix}.{key}" if prefix else str(key)
            result.extend(_flatten_config(value[key], path))
        return result
    return [(prefix, value)]


def _identifier(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value.casefold()).strip("_")


def _config_entries(stage: Stage) -> list[tuple[str, object]]:
    if not stage.config_path:
        return []
    config = json.loads((ECOS_ROOT / stage.config_path).read_text(encoding="utf-8"))
    return _flatten_config(config)


def _parameter_detail(stage: Stage, key: str) -> tuple[str, str]:
    if stage.slug == "legalization":
        if key in LEGALIZATION_OVERRIDES:
            return LEGALIZATION_OVERRIDES[key]
        if key in DREAMPLACE_PARAMETER_SEMANTICS:
            return DREAMPLACE_PARAMETER_SEMANTICS[key]
    detail = PARAMETER_DETAILS.get(stage.slug, {}).get(key)
    if detail is not None:
        return detail
    if key.startswith("die_builder.margin."):
        side = key.rsplit(".", 1)[-1].replace("_micron", "")
        return (f"The {side} die-to-core margin in micrometers.", "It offsets the core boundary from the corresponding die edge.")
    if key.startswith("phy_placer.well_tap"):
        return ("The well-tap insertion setting.", "It selects the tap cell and maximum spacing used to maintain well connectivity.")
    if key.startswith("phy_placer.side_endcap") or key.startswith("phy_placer.edge_endcap"):
        return ("The boundary endcap-cell setting.", "It selects cells that protect rows and block edges during physical-cell insertion.")
    if key.startswith("phy_placer.boundary_tap"):
        return ("The boundary-tap setting.", "It selects boundary tap cells and their placement rule along the core edge.")
    if key.startswith("file_path."):
        return (f"The net-optimization `{key.rsplit('.', 1)[-1]}` path.", "It identifies an input or output consumed by the fanout-optimization tool.")
    return (f"The `{key}` configuration field for {stage.step_name}.", "It is parsed by the underlying stage tool and has effect only when that tool consumes the field.")


def _add_virtual_parameters(
    stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]
) -> None:
    records = {
        "synthesis": (
            ("input", "**Meaning:** The RTL-or-filelist source boundary.\n\n**Role:** The Yosys runner requires at least one existing source before invoking `yosys_synthesis.tcl`."),
            ("runtime", "**Meaning:** The bundled-or-PATH Yosys runtime selection.\n\n**Role:** The runner resolves it before synthesis and records an invalid subflow when no executable is available."),
        ),
        "drc": (
            ("workspace_config", "**Meaning:** The DRC workspace-configuration boundary.\n\n**Role:** The runner passes it to `run_drc` together with the step report path after DRC initialization."),
            ("report_path", "**Meaning:** The step-specific DRC report destination.\n\n**Role:** It receives the DRC engine report and is separate from the persisted DRC feature JSON."),
        ),
        "filler": (
            ("workspace_config", "**Meaning:** The Filler workspace-configuration boundary.\n\n**Role:** The runner passes it to `run_filler` before saving the post-insertion database."),
            ("cell_selection", "**Meaning:** The filler-cell selection supplied by the workspace configuration.\n\n**Role:** It constrains which physical filler cells the underlying tool may insert."),
        ),
    }[stage.slug]
    for name, body in records:
        _add(
            entries,
            documents,
            entity_id=f"parameter.{stage.slug}.{name}",
            kind="parameter",
            aliases=tuple(f"{alias} {name.replace('_', ' ')}" for alias in stage.aliases),
            document="parameters.md",
            body=body,
            evidence=stage.tool_source_ids,
        )


def _add_parameters(
    stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]
) -> None:
    config_entries = _config_entries(stage)
    if not config_entries:
        _add_virtual_parameters(stage, entries, documents)
        return
    evidence = (*stage.tool_source_ids, f"config.{stage.slug}")
    for key, _value in config_entries:
        meaning, role = _parameter_detail(stage, key)
        _add(
            entries,
            documents,
            entity_id=f"parameter.{stage.slug}.{_identifier(key)}",
            kind="parameter",
            aliases=tuple(f"{alias} {key}" for alias in stage.aliases),
            document="parameters.md",
            body=f"**Meaning:** {meaning}\n\n**Role:** {role}",
            evidence=evidence,
        )


def _add_metrics(
    stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]
) -> None:
    evidence = (*stage.tool_source_ids, "ecc.metrics", "gui.step_metrics")
    metric_ids = METRICS[stage.slug]
    if not metric_ids:
        records = (
            ("database_summary", "The saved ECC database summary used by downstream analysis.", "The shared analysis path reads the stage feature database after persistence; it provides structural context but no stage-specific GUI comparison metric."),
            ("qor_availability", "The availability state of the stage QoR artifacts.", "Metrics, summary, and hotspot payloads are written only when the shared metric builder finds valid source facts; absent artifacts remain unavailable."),
        )
        for name, meaning, calculation in records:
            _add(
                entries,
                documents,
                entity_id=f"metric.{stage.slug}.{name}",
                kind="metric",
                aliases=tuple(f"{alias} {name.replace('_', ' ')}" for alias in stage.aliases),
                document="metrics.md",
                body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}",
                evidence=evidence,
            )
        return
    for metric_id in metric_ids:
        meaning, calculation = METRIC_DETAILS[metric_id]
        display_name = metric_id.replace("_", " ")
        _add(
            entries,
            documents,
            entity_id=f"metric.{metric_id}",
            kind="metric",
            aliases=(display_name, *(f"{alias} {display_name}" for alias in stage.aliases)),
            document="metrics.md",
            body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}",
            evidence=evidence,
        )


def _add_artifact_records(
    stage: Stage,
    entries: list[dict[str, object]],
    documents: dict[str, list[str]],
    records: tuple[tuple[str, tuple[str, ...], str, str], ...],
    evidence: tuple[str, ...],
) -> None:
    for name, aliases, meaning, calculation in records:
        _add(
            entries,
            documents,
            entity_id=f"artifact.{stage.slug}.{name}",
            kind="artifact",
            aliases=aliases,
            document="artifacts.md",
            body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}",
            evidence=evidence,
        )


def _add_artifacts(
    stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]
) -> None:
    aliases = stage.aliases
    evidence = (*stage.tool_source_ids, "ecc.runner", "ecc.builder", "ecc.metrics")
    if stage.slug == "synthesis":
        _add_artifact_records(stage, entries, documents, (
            ("outputs", tuple(f"{alias} artifacts" for alias in aliases), "The synthesis output set: mapped Verilog, Yosys stat JSON, log, optional netlist-STA artifacts, metrics, and checklist evidence.", "The runner invokes Yosys, accepts the run only after the output netlist exists, then publishes the stat-derived analysis and checklist."),
            ("output_verilog", ("synthesis netlist", "synthesis output verilog"), "The mapped gate-level Verilog netlist produced by Yosys.", "The runner uses existence of `step.output.verilog` as its synthesis completion gate."),
            ("stat", ("synthesis stat json", "yosys statistics"), "The Yosys statistical feature record containing design area, cell, wire, and port counts.", "Yosys metrics read this record after netlist acceptance."),
            ("post_synthesis_sta", ("synthesis sta artifacts", "netlist sta"), "The optional netlist-level STA report and structured power artifacts produced after synthesis.", "Supplemental STA is attempted only after the netlist exists; its failure does not invalidate synthesis."),
            ("log", ("synthesis log", "yosys log"), "The Yosys execution log for runtime, plugin, Tcl, and output-netlist diagnostics.", "The runner directs subprocess stdout and stderr to `step.log.file` when executing Yosys."),
        ), evidence)
        return
    if stage.slug == "harden":
        _add_artifact_records(stage, entries, documents, (
            ("outputs", tuple(f"{alias} artifacts" for alias in aliases), "The final Harden delivery package: abstract LEF, timing-model LIB, hardened GDS, and package-completeness metrics.", "The runner writes all three implementation artifacts from the selected signoff item before final analysis."),
            ("output_lef", ("harden abstract lef", "harden lef"), "The abstract LEF describing the hardened block for integration.", "`write_abstract_lef` serializes the abstract physical interface to `step.output.lef`."),
            ("output_lib", ("harden timing lib", "harden lib"), "The timing-model Liberty file for the hardened block.", "`write_timing_model` uses the selected signoff Liberty, SDC, and SPEF inputs to write `step.output.lib`."),
            ("output_gds", ("harden gds", "harden output gds"), "The hardened GDS layout stream.", "The runner calls `gds_save(..., is_harden=True)` for `step.output.gds`."),
            ("package_metrics", ("harden package metrics", "harden artifact completeness"), "The package-completeness QoR record for the required GDS, LEF, and LIB outputs.", "The harden metric builder checks each declared path and sums absent artifacts."),
        ), evidence)
        return
    feature_step_disabled = stage.slug in {"floorplan", "legalization", "rcx", "sta"}
    feature_step_calculation = (
        "This runner calls `save_data(..., feature_step=False)`, so the generic stage feature file is intentionally not emitted."
        if feature_step_disabled
        else "The shared persistence path invokes `feature_step(step=...)` and serializes the stage-specific feature summary."
    )
    records = (
        ("outputs", tuple(f"{alias} artifacts" for alias in aliases), f"The {stage.step_name} output set: current DEF, Verilog, GDS, database checkpoint, geometry snapshot, feature/QoR records, and analysis evidence.", "The runner updates the ECC database, calls shared persistence, then runs analysis and checklist generation."),
        ("output_def", tuple(f"{alias} def" for alias in aliases), "The current physical DEF exported from the ECC database after this stage.", "`save_data` calls `def_save` after the stage tool has updated the in-memory database."),
        ("output_verilog", tuple(f"{alias} verilog" for alias in aliases), "The current gate-level logical-netlist export from the ECC database.", "`save_data` calls `verilog_save`; it represents connectivity rather than placement or routing geometry."),
        ("output_gds", tuple(f"{alias} gds" for alias in aliases), "The current GDS physical-layout export from the ECC database.", "`save_data` calls `gds_save` after the stage tool updates the current physical state."),
        ("output_db", tuple(f"{alias} database" for alias in aliases), "The ECC database checkpoint used as an input to a following stage.", "`save_data` calls `save_data(path=step.output.db)` to serialize the reconstructible design state."),
        ("geometry", tuple(f"{alias} geometry" for alias in aliases), "The GUI geometry snapshot and manifest for the current stage state.", "For supported steps, shared persistence writes the geometry snapshot and requires its manifest to exist before returning success."),
        ("feature_db", tuple(f"{alias} feature database" for alias in aliases), "The source-derived ECC design summary used by metric builders.", "Shared persistence calls `feature_sammry` to write the database feature JSON."),
        ("feature_step", tuple(f"{alias} step feature" for alias in aliases), "The stage-specific ECC feature summary when the runner enables it.", feature_step_calculation),
        ("qor_metrics", tuple(f"{alias} qor metrics" for alias in aliases), "The structured per-metric QoR payload for the stage.", "Analysis calls the stage metric builder, normalizes valid source facts, and writes the QoR metric records."),
        ("qor_summary", tuple(f"{alias} qor summary" for alias in aliases), "The stage quality-status summary and gate results.", "The QoR builder groups metric records, evaluates availability and quality gates, then writes the summary payload."),
        ("qor_hotspots", tuple(f"{alias} qor hotspots" for alias in aliases), "The actionable QoR-hotspot subset for the stage.", "The QoR builder retains only recognized stage symptoms with source evidence and writes them as hotspot records."),
    )
    _add_artifact_records(stage, entries, documents, records, evidence)
    if stage.slug == "rcx":
        _add_artifact_records(stage, entries, documents, (
            ("spef", ("rcx spef outputs", "published spef"), "The published SPEF files for the extracted RCX corners.", "The runner copies files from the RCX writer directory to declared `step.output.spef` paths, which STA later consumes."),
            ("electrical_facts", ("rcx electrical facts", "rcx spef parse"), "The bounded per-corner RCX electrical summary and parse-status facts.", "`save_rcx_spef_feature_facts` parses published SPEFs and persists coverage, capacitance, resistance, and parse-failure data."),
        ), evidence)
    if stage.slug == "sta":
        _add_artifact_records(stage, entries, documents, (
            ("corner_reports", ("sta corner reports", "sta timing reports"), "The per-signoff-corner plaintext timing reports.", "Each Liberty/RCX combination receives a corner-specific report directory during `run_timing`."),
            ("corner_features", ("sta corner features", "sta structured timing"), "The per-signoff-corner structured QoR, timing-path, and power artifacts.", "Each timing run writes structured artifacts to its matching corner-specific feature directory before aggregation."),
            ("timing_issues", ("sta timing issues", "sta path issues"), "The aggregated timing-issue artifact for actionable failing path information.", "The STA metric builder reads corner timing-path artifacts and persists the bounded issue payload with coverage diagnostics."),
        ), evidence)


def _add_failures(
    stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]
) -> None:
    _add(
        entries,
        documents,
        entity_id=f"failure.{stage.slug}.preconditions",
        kind="failure_mode",
        aliases=tuple(f"{alias} failed" for alias in stage.aliases),
        document="failures.md",
        body=f"**Failure mode:** {stage.failure}",
        evidence=stage.tool_source_ids,
    )
    for name, aliases, body in FAILURE_DETAILS[stage.slug]:
        _add(
            entries,
            documents,
            entity_id=f"failure.{stage.slug}.{name}",
            kind="failure_mode",
            aliases=aliases,
            document="failures.md",
            body=f"**Failure mode:** {body}",
            evidence=stage.tool_source_ids,
        )
    _add(
        entries,
        documents,
        entity_id=f"failure.{stage.slug}.terminal_evidence",
        kind="failure_mode",
        aliases=tuple(f"{alias} completion evidence" for alias in stage.aliases),
        document="failures.md",
        body="**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.",
        evidence=stage.tool_source_ids,
    )


def _add_stage(stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    _add(
        entries,
        documents,
        entity_id=f"algorithm.{stage.slug}.execution",
        kind="algorithm",
        aliases=(*stage.aliases, *(f"{alias} execution" for alias in stage.aliases)),
        document="algorithms.md",
        body=f"**Execution path:** {stage.execution}",
        evidence=stage.tool_source_ids,
    )
    for name, aliases, body in ALGORITHM_DETAILS[stage.slug]:
        _add(
            entries,
            documents,
            entity_id=f"algorithm.{stage.slug}.{name}",
            kind="algorithm",
            aliases=aliases,
            document="algorithms.md",
            body=body,
            evidence=stage.tool_source_ids,
        )
    _add_parameters(stage, entries, documents)
    _add_metrics(stage, entries, documents)
    _add_artifacts(stage, entries, documents)
    _add_failures(stage, entries, documents)


def _write_regression(stage: Stage, output: Path, entries: list[dict[str, object]]) -> None:
    detail_name, detail_aliases, _detail_body = ALGORITHM_DETAILS[stage.slug][0]
    metric_id = f"metric.{METRICS[stage.slug][0]}" if METRICS[stage.slug] else f"metric.{stage.slug}.database_summary"
    parameter_id = next(entry["id"] for entry in entries if str(entry["id"]).startswith(f"parameter.{stage.slug}."))
    cases = (
        {"id": f"{stage.slug}-execution", "question": f"How does the {stage.step_name} stage execute?", "entity_id": f"algorithm.{stage.slug}.execution", "required_text": "Execution path:"},
        {"id": f"{stage.slug}-{detail_name}", "question": max(detail_aliases, key=len), "entity_id": f"algorithm.{stage.slug}.{detail_name}", "required_text": "Source evidence:"},
        {"id": f"{stage.slug}-parameter", "question": str(parameter_id).replace("parameter.", "").replace(".", " "), "entity_id": parameter_id, "required_text": "**Role:**"},
        {"id": f"{stage.slug}-metric", "question": metric_id.removeprefix("metric.").replace("_", " "), "entity_id": metric_id, "required_text": "**Calculation:**"},
        {"id": f"{stage.slug}-artifact", "question": f"{stage.slug} artifacts", "entity_id": f"artifact.{stage.slug}.outputs", "required_text": "**Meaning:**"},
        {"id": f"{stage.slug}-failure", "question": f"{stage.slug} failed", "entity_id": f"failure.{stage.slug}.preconditions", "required_text": "**Failure mode:**"},
    )
    regression = output / "regression"
    regression.mkdir(exist_ok=True)
    regression.joinpath(f"{stage.slug}_questions.jsonl").write_text(
        "".join(_json(case) + "\n" for case in cases), encoding="utf-8"
    )


def _build_bundle(stage: Stage, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    knowledge = output / "knowledge"
    knowledge.mkdir(exist_ok=True)
    entries: list[dict[str, object]] = []
    documents: dict[str, list[str]] = {name: [] for name in ("algorithms.md", "parameters.md", "metrics.md", "artifacts.md", "failures.md")}
    _add_stage(stage, entries, documents)
    for name, chunks in documents.items():
        (knowledge / name).write_text("\n".join(chunks), encoding="utf-8")
    catalog = {
        "schema_version": "ecos-step-catalog.v1",
        "domain": f"ecos_{stage.slug}",
        "publication": {"status": "source-audited", "scope": f"ECOS {stage.step_name} source snapshot"},
        "entities": entries,
    }
    (output / "catalog.json").write_text(_json(catalog) + "\n", encoding="utf-8")
    (output / "sources.json").write_text(_json(_source_inventory(stage)) + "\n", encoding="utf-8")
    _write_regression(stage, output, entries)
    files = {
        str(path.relative_to(output)): _sha256(path.read_bytes())
        for path in sorted(output.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }
    manifest = {"schema_version": "ecos-step-manifest.v1", "files": files, "entity_count": len(entries)}
    (output / "manifest.json").write_text(_json(manifest) + "\n", encoding="utf-8")


def _bundle_matches(generated: Path, current: Path) -> bool:
    generated_files = {path.relative_to(generated) for path in generated.rglob("*") if path.is_file()}
    current_files = {path.relative_to(current) for path in current.rglob("*") if path.is_file()} if current.exists() else set()
    return generated_files == current_files and all((generated / path).read_bytes() == (current / path).read_bytes() for path in generated_files)


def _build_all(output: Path) -> None:
    for stage in STAGES:
        _build_bundle(stage, output / f"{stage.slug}_knowledge")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.check:
        _build_all(args.output)
        return 0
    with tempfile.TemporaryDirectory() as directory:
        generated = Path(directory)
        _build_all(generated)
        for stage in STAGES:
            name = f"{stage.slug}_knowledge"
            if not _bundle_matches(generated / name, args.output / name):
                raise SystemExit(f"{stage.slug} knowledge bundle is stale; run scripts/build_step_knowledge.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
