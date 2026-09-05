"""Source-audited failure records for ECOS flow stages."""

from __future__ import annotations


FAILURE_DETAILS = {
    "synthesis": (
        ("input", ("synthesis input missing", "yosys rtl filelist missing"), "The runner refuses to invoke Yosys when neither a readable RTL source nor a file list is available; this is an input failure, not a synthesis-quality result."),
        ("runtime", ("yosys unavailable", "synthesis runtime missing"), "The runner marks `run yosys` invalid when neither the bundled runtime nor PATH provides Yosys. It writes the error to the step log when possible and does not invoke Tcl."),
        ("process", ("yosys process failed", "synthesis tcl failed"), "A nonzero Yosys process result or an exception while launching the generated Tcl flow leaves synthesis incomplete; no downstream metric can promote that run to success."),
        ("plugin", ("synthesis slang plugin missing", "yosys read slang failed"), "A file list that requires Slang cannot be elaborated when the required plugin/runtime is unavailable; the generated pass schedule is not entered."),
        ("output_netlist", ("synthesis netlist missing", "yosys output missing"), "After the subprocess returns, the runner requires the configured output netlist to exist. A zero process exit without that file is reported as invalid synthesis."),
    ),
    "floorplan": (
        ("engine", ("floorplan ECC unavailable", "floorplan load data failed"), "If `get_eda_instance` returns no ECC module, the floorplan runner does not enter `init_fp` or `run_fp` and returns false."),
        ("config", ("floorplan config unreadable", "ifp config parse failed"), "iFP reads the configured JSON during `wrapConfig`; an unreadable or structurally invalid file prevents reliable initialization. The runner does not convert a failed native initialization into a valid floorplan."),
        ("io_layers", ("floorplan io layers invalid", "io placer layers unavailable"), "IO placement returns without changing pins when no configured layer resolves to one usable horizontal and one usable vertical routing layer, or when a selected layer has non-positive width or track pitch."),
        ("io_capacity", ("floorplan io capacity exceeded", "io pins exceed edge capacity"), "When legal edge slots at one-pitch spacing cannot hold every IO pin, IOPlacer emits a native error and leaves the pin assignment incomplete."),
        ("macro_placement", ("floorplan unplaced macro", "macro placement error"), "MacroPlacer logs an error for every unplaced block macro and does not relocate it; only already placed macros receive halos and participate in row cutting."),
        ("macro_core", ("floorplan macro outside core", "macro core containment error"), "MacroPlacer logs an error when a placed macro bounding box is not fully contained by the core. The check is diagnostic; it is not a relocation or repair algorithm."),
        ("native_progress", ("floorplan native error hidden", "floorplan subflow false success"), "`run_floorplan` marks init, tracks, IO pins, taps, PDN, and clock-net subflow entries successful without inspecting iFP native returns. Native logs and output artifacts are required to determine the actual result."),
        ("geometry", ("floorplan geometry missing", "floorplan manifest missing"), "For floorplan, shared persistence requires `geometry_snapshot_save` and an existing geometry manifest. Either failure causes `save_data` to return false."),
    ),
    "cts": (
        ("engine", ("cts ECC unavailable", "cts load data failed"), "Without an ECC module, CTS, its report, map, and timing feature facts are not executed."),
        ("native_flow", ("cts native flow failed", "cts synthesis optimization failed"), "The native API distinguishes not-initialized, no-op, synthesis, optimization, instantiation, evaluation, and report errors, but the ECC runner does not branch on those return statuses before updating its subflow."),
        ("no_op", ("cts no clock work", "cts no-op"), "A native no-op can mean that no usable clock domain was synthesized. It is not evidence that a clock tree was built or that skew targets were met."),
        ("report", ("cts report missing", "cts map missing"), "Report or map emission can fail independently of native CTS construction; the wrapper still proceeds, so the declared report/map paths must be checked."),
        ("timing_facts", ("cts timing facts missing", "cts skew unavailable"), "If `feature_cts_timing` cannot be persisted after `save_data`, the CTS runner logs an error and returns false. Missing timing facts cannot be repaired by the visual map."),
    ),
    "legalization": (
        ("engine", ("legalization ECC unavailable", "legalization load data failed"), "Without an ECC module, DreamPlace legalization is not constructed and no legal placement is produced."),
        ("runtime", ("legalization dreamplace unavailable", "dreamplace import failed"), "The DreamPlace runner returns false before construction when its runtime or native operators are unavailable."),
        ("input", ("legalization input missing", "legalization def verilog missing"), "The legalizer needs a readable incoming DEF/netlist and placement geometry; a missing or invalid input prevents `setup_rawdb()` from producing a candidate."),
        ("legality", ("legalization legality check failed", "illegal placement retained"), "If the legality check fails after greedy or Abacus refinement, DreamPlace retains the earlier designated candidate rather than claiming an illegal result is legal."),
        ("infinite_hpwl", ("legalization hpwl inf", "dreamplace legalization failed"), "`DreamplaceModule` returns false when `PlacementEngine.run()` reports infinite HPWL. The DreamPlace runner's progress record must not override that terminal tool result."),
    ),
    "sizer": (
        ("runtime", ("sizer runtime unavailable", "timing optimization scripts missing"), "The runner returns `Invalid` before subprocess execution when ECC, Sizer, or DreamPlace is unavailable, or when the generated Sizer env/cmd script paths do not exist."),
        ("command", ("sizer command unavailable", "sizer path not found"), "The current wrapper resolves an executable named `Sizer` from PATH; an environment-root binary override is not part of this source contract."),
        ("staging", ("sizer staging output missing", "timing optimization subprocess failed"), "A nonzero Sizer exit or absence of either staging DEF or staging Verilog marks `run sizer` incomplete and prevents legalization."),
        ("legalization", ("sizer legalization input failed", "timing optimization legalize failed"), "A missing DreamPlace legalizer or a failed legalize-only run prevents creation of the live ECC object required for publication."),
        ("publication", ("sizer legalization failed", "timing optimization publication failed"), "Legalization must return a live ECC object before persistence. If legalization or shared `save_data` fails, the wrapper removes partial published outputs and does not report stage success."),
    ),
    "route": (
        ("engine", ("route ECC unavailable", "routing load data failed"), "Without an ECC module, routing and conditional STA initialization do not run."),
        ("native_pipeline", ("route native module failed", "irt routing pipeline failed"), "The wrapper invokes iRT initialization, pin access, supply analysis, planar routing, layer assignment, track assignment, detailed routing, and violation reporting without checking the native return value; inspect route features and logs for module failures."),
        ("layer_range", ("route layer range invalid", "routing layers unavailable"), "An invalid or empty configured bottom/top routing-layer range prevents a meaningful 3D route even if the wrapper records the run subflow."),
        ("conditional_sta", ("route timing unavailable", "routing sta disabled"), "A completed route does not prove timing-aware routing. Verify that the route configuration enabled timing and that STA initialization/artifacts exist before making that claim."),
        ("geometry", ("route geometry missing", "routing save failed"), "Shared persistence can fail while native route work completed; geometry manifest, database, and exported layout artifacts are required for a terminal route result."),
    ),
    "drc": (
        ("engine", ("drc ECC unavailable", "drc load data failed"), "Without an ECC module, DRC initialization and rule checking do not run."),
        ("native_rules", ("drc rule validation failed", "idrc validator failed"), "Shape collection, cluster partitioning, enabled-rule dispatch, and geometric checks run natively while the wrapper ignores their return values; a report alone does not prove all enabled rules completed."),
        ("invalid_shape", ("drc invalid shape index", "drc negative result net"), "The wrapper converts result shapes and classifies special nets using `regular_net_num` before verification; malformed or missing result-shape mapping must be diagnosed rather than treated as zero violations."),
        ("report", ("drc report missing", "drc output unavailable"), "The configured report path and saved feature file are independent evidence. Missing either leaves the DRC count unknown even when the wrapper subflow says success."),
        ("feature", ("drc feature missing", "drc count unavailable"), "The DRC count comes from the saved feature record. If that record is absent or malformed, a missing number must not be reported as zero violations."),
    ),
    "filler": (
        ("engine", ("filler ECC unavailable", "filler load data failed"), "Without an ECC module, the runner does not invoke filler insertion."),
        ("config", ("filler min width invalid", "filler config invalid"), "The native filler model rejects a non-positive minimum filler width and filters out invalid row/master definitions before insertion."),
        ("segments", ("filler rows unavailable", "filler legal segments missing"), "Rows with unsupported orientation or no legal site segments produce no insertion candidates; this is not evidence that the design needed no fillers."),
        ("writeback", ("filler instance creation failed", "filler master missing"), "Missing design/master data or a failed unique-instance creation prevents selected filler cells from being written back to iDB."),
        ("native_progress", ("filler native error hidden", "filler subflow false success"), "The runner marks `run filler` successful without inspecting the native insertion return value, so saved database and geometry artifacts are the terminal evidence."),
        ("evidence", ("filler artifacts missing", "filler result unavailable"), "There is no dedicated filler metric in the GUI comparison set. Missing saved artifacts or checklist output leaves the filler result unverified."),
    ),
    "rcx": (
        ("engine", ("rcx ECC unavailable", "rcx load data failed"), "Without an ECC module, RCX cannot initialize with the workspace PDK."),
        ("config", ("rcx config or pdk invalid", "rcx process data missing"), "RCX requires a readable extraction configuration and workspace PDK process data; absent conductor, via, or capacitance tables leave affected records skipped."),
        ("topology", ("rcx topology unavailable", "rcx environment build failed"), "A malformed routed topology or environment overlap model prevents reliable per-corner electrical extraction even if the native runner returns to the wrapper."),
        ("spef_output", ("rcx spef output missing", "rcx spef writer failed"), "Generated SPEF files must exist at each declared corner output before copying and parsing; transient writer state is not a published extraction result."),
        ("native_progress", ("rcx native error hidden", "rcx subflow false success"), "The wrapper records `run rcx` successful without inspecting init/run/destroy return values; explicit save-data and SPEF-fact gates are the checked boundaries."),
        ("spef_facts", ("rcx spef facts missing", "rcx corner coverage missing"), "If RCX SPEF fact persistence fails after extraction, the runner returns false. Do not use transient files in `spef_writer` as a substitute for declared SPEF outputs."),
    ),
    "sta": (
        ("signoff", ("sta signoff matrix empty", "sta config missing"), "STA returns incomplete when no Liberty/RCX signoff item resolves or the workspace STA configuration path is unavailable."),
        ("missing_sdc", ("sta sdc missing", "sta constraint missing"), "STA marks its subflow incomplete and returns false when the workspace SDC path does not exist."),
        ("missing_corner_input", ("sta spef missing", "sta liberty missing"), "For every signoff item, a missing SPEF or any missing Liberty file marks STA incomplete before timing is run. The aggregate must preserve that incomplete coverage."),
        ("artifact_dirs", ("sta report feature directory missing", "sta output directory missing"), "A signoff item is incomplete when its report or structured-feature destination cannot be resolved; no corner result should be synthesized from absent output directories."),
        ("timing_run", ("sta timing run failed", "ista graph or propagation failed"), "Exceptions from native timing setup, graph construction, propagation, or reporting terminate the STA run; they must not be converted to zero WNS/TNS."),
        ("coverage", ("sta corner coverage incomplete", "sta partial signoff"), "The worst-corner aggregate must preserve missing or failed configured corners and cannot claim signoff from only a subset of the requested matrix."),
    ),
    "harden": (
        ("engine", ("harden ECC unavailable", "harden load data failed"), "Without an ECC module, abstract LEF, timing-model LIB, and hardened GDS are not generated."),
        ("signoff_config", ("harden sta config missing", "harden signoff input missing"), "Harden returns before artifact generation when the STA signoff matrix is empty or the workspace STA config path is unavailable."),
        ("lef", ("harden lef writer failed", "harden lef missing"), "A native abstract-LEF writer failure can leave the subflow marked successful; the declared LEF path must be checked independently."),
        ("lib", ("harden timing model failed", "harden lib missing"), "Timing-model extraction can fail or produce no unambiguous generated Liberty source; a missing output LIB makes the delivery package incomplete."),
        ("gds", ("harden gds writer failed", "harden gds missing"), "The hardened GDS writer may return failure while the wrapper continues to analysis; GDS existence is required for package completion."),
        ("delivery", ("harden artifact missing", "harden package incomplete"), "The final missing-artifact metric counts absent GDS, LEF, or LIB. It is a package-completeness gate, not a substitute for checking their contents."),
    ),
}


FAILURE_NATIVE_SOURCE_IDS = {
    "synthesis": ("yosys.runner", "yosys.script"),
    "floorplan": ("ecc.workspace", "ifp.interface", "ifp.io_placer", "ifp.macro_placer"),
    "cts": ("icts.api", "icts.synthesis", "icts.topology", "icts.htree", "icts.router", "icts.optimization"),
    "legalization": (
        "dreamplace.runner",
        "dreamplace.module",
        "dreamplace.basic_place",
        "dreamplace.placer",
        "dreamplace.nonlinear",
        "dreamplace.macro_legalize",
        "dreamplace.greedy_legalize",
        "dreamplace.abacus_legalize",
    ),
    "route": ("irt.interface", "irt.planar_router", "irt.layer_assigner", "irt.track_assigner", "irt.detailed_router"),
    "drc": ("idrc.interface", "idrc.validator", "idrc.metal_short", "idrc.minimum_width", "idrc.cut_spacing"),
    "filler": ("izh.filler",),
    "rcx": ("ircx.topo", "ircx.env", "ircx.var_processor", "ircx.res_extractor", "ircx.cap_extractor", "ircx.spef_writer"),
    "sta": ("ista.interface", "ista.graph_builder", "ista.propagator", "ista.analyzer"),
    "harden": ("idb.python", "idb.builder", "ista.interface", "ista.characterizer"),
}
