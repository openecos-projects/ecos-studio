"""Build source-audited ECOS knowledge bundles for every flow stage."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .algorithm_details import ALGORITHM_DETAILS, SOURCE_PATHS as ALGORITHM_SOURCE_PATHS
from .metric_details import METRIC_DETAILS, SOURCE_PATHS as METRIC_SOURCE_PATHS
from .failure_details import FAILURE_DETAILS, FAILURE_NATIVE_SOURCE_IDS
from .place_details import (
    PLACE_PARAMETER_SEMANTICS,
    PLACE_REGRESSION_CASES,
    PLACE_SOURCE_PATHS,
    add_place_entries,
)

AGENT_ROOT = Path(__file__).parents[4]
ECOS_ROOT = AGENT_ROOT.parents[1]

METRICS = {
    "synthesis": ("synthesis_cell_area", "synthesis_cell_count", "synthesis_port_count", "synthesis_wire_count"),
    "floorplan": ("die_area", "core_area", "core_utilization", "instance_count", "net_count"),
    "cts": ("clock_path_max_buffer", "clock_path_min_buffer", "clock_wirelength", "cts_buffer_area", "cts_buffer_count", "cts_clock_tree_max_level", "cts_clock_wirelength_max", "cts_worst_optimized_skew_ns", "cts_worst_max_insertion_latency_ns", "cts_skew_target_unmet_count", "instance_count", "io_pin_count", "net_count"),
    "legalization": (),
    "sizer": (),
    "route": ("route_dr_total_patch_count", "route_dr_total_via_count", "route_dr_total_violation_count", "route_dr_total_wirelength", "route_la_total_demand", "route_la_total_overflow", "route_via_count", "route_wirelength"),
    "drc": ("drc_count",),
    "filler": (),
    "rcx": ("rcx_missing_corner_count", "rcx_spef_parse_failure_count", "rcx_worst_total_capacitance_ff", "rcx_worst_total_resistance_ohm"),
    "sta": ("sta_setup_wns", "sta_setup_tns", "sta_hold_wns", "sta_hold_tns", "sta_frequency_mhz"),
    "harden": ("harden_artifact_missing_count",),
}


def _add_place_stage_entries(
    _stage: Stage,
    entries: list[dict[str, object]],
    documents: dict[str, list[str]],
) -> None:
    config = json.loads(
        (ECOS_ROOT / PLACE_SOURCE_PATHS["dreamplace.config"]).read_text(
            encoding="utf-8"
        )
    )
    add_place_entries(entries, documents, config)


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
    entry_writer: Callable[
        [Stage, list[dict[str, object]], dict[str, list[str]]], None
    ] | None = None
    catalog_schema: str = "ecos-step-catalog.v2"
    manifest_schema: str = "ecos-step-manifest.v1"
    source_schema: str = "ecos-step-sources.v1"
    domain: str | None = None
    publication_scope: str | None = None
    source_paths: tuple[tuple[str, str], ...] = ()
    regression_cases: tuple[dict[str, str], ...] = ()


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
        "The ECC runner loads the design database, calls `init_fp` with the Floorplan configuration, runs iFP in the native order `DieBuilder -> IOPlacer -> MacroPlacer -> PDNGenerator -> PhyPlacer`, destroys the floorplan engine, saves the updated database and geometry snapshot, then runs analysis and checklist generation. The runner marks each subflow item successful without branching on the native iFP return values.",
        "The step cannot proceed without an ECC database instance. iFP can log configuration, layer/capacity, macro-placement, or geometry errors while the wrapper still records subflow progress; inspect native logs, saved artifacts, and analysis records before claiming a successful floorplan.",
        "ECC reads design-layout and design-statistics facts to publish die/core area, core utilization, instance count, and net count.",
        "ecc/chipcompiler/tools/ecc/configs/floorplan_ecc.json",
    ),
    Stage(
        "place",
        "Place",
        ("place", "placement", "place stage", "布局阶段"),
        "The DreamPlace runner loads the current ECC design, constructs the placement engine, runs global placement with its acceptance gate, then optionally legalizes and refines the result before publishing maps, artifacts, and QoR analysis.",
        "A missing ECC module, a failed DreamPlace import, or infinite HPWL prevents a successful placement result. Subflow progress is not terminal evidence; inspect the tool result and published artifacts.",
        "DreamPlace and ECC publish placement wirelength, density, and congestion facts together with the placement-map resources consumed by the GUI.",
        "ecc/chipcompiler/tools/ecc_dreamplace/configs/dreamplace_ecc.json",
        ("dreamplace.runner", "dreamplace.module", "ecc.runner", "ecc.module"),
        entry_writer=_add_place_stage_entries,
        catalog_schema="ecos-place-catalog.v3",
        manifest_schema="ecos-place-manifest.v1",
        source_schema="ecos-place-sources.v1",
        domain="ecos_placement",
        publication_scope="ECOS place and DreamPlace source snapshot",
        source_paths=tuple(PLACE_SOURCE_PATHS.items()),
        regression_cases=PLACE_REGRESSION_CASES,
    ),
    Stage(
        "cts",
        "CTS",
        ("cts", "clock tree synthesis", "clock tree", "cts stage", "时钟树阶段"),
        "The ECC runner loads the design, invokes `run_cts` for clock-tree synthesis with the CTS configuration and step data directory, writes a CTS report and map, saves the design, persists clock-timing feature facts, and then runs analysis and checklist generation. The wrapper does not branch on the native `run_cts`, report, or map return values; timing-fact persistence and shared save-data results are the explicit gates it checks.",
        "The step cannot execute without an ECC database instance. Native CTS may return not-initialized, no-op, synthesis, optimization, instantiation, evaluation, or report errors that are not reflected by the wrapper's subflow updates; CTS metric availability also depends on persisted `CTS` feature facts and must not be interpreted as zero skew.",
        "ECC reads the `CTS` feature record for buffer, clock-path, wirelength, level, skew, and insertion-latency facts, then the GUI selects the published normalized metrics.",
        "ecc/chipcompiler/tools/ecc/configs/cts_ecc.json",
    ),
    Stage(
        "legalization",
        "legalization",
        ("legalization", "legalize", "placement legalization", "legalization stage", "合法化阶段"),
        "The DreamPlace runner loads ECC data, builds `DreamplaceModule`, forces legalization-only parameters, creates the placement engine, and runs it. In legalization-only mode global placement and fillers are disabled while `legalize_flag` is enabled; the runner then saves the design and runs analysis and checklist generation.",
        "A missing ECC instance prevents execution. DreamPlace reports failure when its PPA result has infinite HPWL, so subflow progress alone is not terminal legalization evidence.",
        "The standard GUI stage comparison has no legalization-specific numeric metric. Database and QoR artifacts are still produced by the shared analysis path when the run reaches it.",
        "ecc/chipcompiler/tools/ecc_dreamplace/configs/dreamplace_ecc.json",
        ("dreamplace.runner", "dreamplace.module", "ecc.runner", "ecc.module"),
    ),
    Stage(
        "sizer",
        "Timing optimization",
        ("sizer", "timing optimization", "timing optimization stage", "时序优化阶段"),
        "The Sizer runner resets the three-step subflow, checks the ECC, Sizer, and DreamPlace runtimes plus generated script paths, runs Sizer, and requires both staging DEF and Verilog outputs. It then invokes DreamPlace legalization on those staging files and calls shared ECC persistence only after legalization succeeds. The verified wrapper order is `run sizer` -> `run legalization` -> `save data`.",
        "Missing runtimes or scripts invalidate the stage. A nonzero Sizer exit, missing staging output, failed legalization, or failed persistence leaves the stage incomplete; failed publication also removes partial published outputs.",
        "The Sizer metrics adapter delegates to the legalization metric builder. These records describe the legalized saved state and do not expose or prove a native Sizer optimization algorithm.",
        tool_source_ids=("sizer.runner", "sizer.builder", "sizer.subflow", "sizer.metrics", "dreamplace.runner", "ecc.runner"),
    ),
    Stage(
        "route",
        "route",
        ("route", "routing", "route stage", "布线阶段"),
        "The ECC runner loads the design, initializes STA first only when routing timing is enabled by the route configuration, invokes the iRT pipeline, saves the resulting design and geometry snapshot, then runs analysis and checklist generation. The wrapper marks the routing subflow successful without inspecting the native routing return value.",
        "The step cannot execute without an ECC database instance. iRT initialization, pin access, planar/layer/track/detailed routing, or violation reporting can fail while the wrapper still records progress; routing timing initialization is conditional, so timing data must not be assumed from route completion alone.",
        "ECC collects database net wirelength and via counts plus route feature facts; the GUI exposes detailed-route patch, via, violation, wirelength, demand, and overflow records when available.",
        "ecc/chipcompiler/tools/ecc/configs/route_ecc.json",
    ),
    Stage(
        "drc",
        "drc",
        ("drc", "design rule check", "drc stage", "设计规则检查阶段"),
        "The ECC runner loads the design, initializes the DRC engine in the step data directory, invokes `run_drc` with the configured report path, saves the design, persists DRC feature data, and then runs analysis and checklist generation. The wrapper does not branch on native DRC initialization or run results, so report and feature artifacts are the observable completion evidence.",
        "The step cannot execute without an ECC database instance. Shape collection, cluster partitioning, enabled-rule dispatch, or report/feature persistence can fail while the wrapper records subflow progress; a DRC run needs its feature/report artifacts to distinguish zero reported violations from missing analysis output.",
        "ECC reads the `drc.number` feature fact to publish the DRC count used by the GUI.",
        "ecc/chipcompiler/tools/ecc/configs/drc_ecc.json",
    ),
    Stage(
        "filler",
        "filler",
        ("filler", "filler insertion", "filler stage", "填充单元阶段"),
        "The ECC runner loads the design, invokes `run_filler` with the workspace Filler configuration, saves the updated design and geometry snapshot, then runs analysis and checklist generation. The wrapper records the filler subflow successful without inspecting the native insertion return value.",
        "The step cannot execute without an ECC database instance. Native filler initialization, row/master filtering, segment extraction, packing, or instance writeback can fail while the wrapper records progress; the standard GUI has no filler-specific comparison metric, so artifact and checklist evidence are required.",
        "The standard GUI stage comparison has no filler-specific numeric metric; shared database and QoR artifacts remain the available evidence.",
    ),
    Stage(
        "rcx",
        "RCX",
        ("rcx", "parasitic extraction", "spef", "rcx stage", "寄生参数提取阶段"),
        "The ECC runner loads the design, initializes RCX with the workspace PDK, runs and destroys RCX, copies generated SPEF files to the declared output paths, saves the design, persists bounded SPEF feature facts, and runs analysis and checklist generation. Native RCX return values are not used as wrapper gates; save-data and parsed SPEF facts are checked explicitly.",
        "The step cannot execute without an ECC database instance. Topology/environment construction, process-table extraction, SPEF writing, or output copying can fail before the checked persistence gates; missing SPEF outputs or unparseable corner files must remain visible through RCX feature and signoff metrics rather than being treated as successful extraction.",
        "ECC derives SPEF file and expected-corner coverage, parses electrical totals by corner, and publishes missing-corner, parse-failure, worst-capacitance, and worst-resistance facts.",
        "ecc/chipcompiler/tools/ecc/configs/rcx_ecc.json",
    ),
    Stage(
        "sta",
        "sta",
        ("sta", "static timing analysis", "timing signoff", "sta stage", "静态时序分析阶段"),
        "The ECC runner expands configured STA signoff items into Liberty and RCX-corner combinations. For each item it requires the SDC, SPEF, and Liberty files, runs timing into corner-specific report and feature directories, saves the design, and then builds multi-corner analysis and checklist evidence.",
        "No signoff items, a missing SDC, SPEF, Liberty file, or report/feature directory terminates STA as incomplete. The stage does not synthesize missing corners, and its aggregate results must preserve that coverage state.",
        "ECC reads all available corner QoR summaries, selects the worst setup/hold WNS and TNS and lowest frequency, records violation and coverage counts, then emits signoff facts and timing-issue artifacts.",
        "ecc/chipcompiler/tools/ecc/configs/sta_ecc.json",
    ),
    Stage(
        "harden",
        "Harden",
        ("harden", "hardening", "harden stage", "交付阶段"),
        "The ECC runner loads the database, requires at least one configured STA signoff item, writes an abstract LEF, writes a timing-model LIB from the selected signoff inputs, exports hardened GDS, and then runs final package analysis. Native writer return values are not wrapper gates; the runner marks the harden subflow successful and relies on package analysis to expose missing outputs.",
        "Without an ECC module, a configured STA signoff item, or a workspace STA config path the runner returns failure before delivery. LEF/LIB/GDS writer errors can still leave a successful subflow record, so final evidence requires all generated package artifacts and their completeness metric.",
        "ECC checks hardened GDS, LEF, and LIB existence and publishes the count of missing required delivery artifacts.",
        "ecc/chipcompiler/tools/ecc/configs/sta_ecc.json",
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
    "sizer.runner": "ecc/chipcompiler/tools/ecc_sizer/runner.py",
    "sizer.builder": "ecc/chipcompiler/tools/ecc_sizer/builder.py",
    "sizer.subflow": "ecc/chipcompiler/tools/ecc_sizer/subflow.py",
    "sizer.metrics": "ecc/chipcompiler/tools/ecc_sizer/metrics.py",
    **ALGORITHM_SOURCE_PATHS,
    **METRIC_SOURCE_PATHS,
}

PARAMETER_DETAILS = {
    "floorplan": {
        "ifp.temp_directory_path": ("The floorplan temporary-directory path.", "It selects the scratch location used by the floorplan engine."),
        "ifp.thread_number": ("The floorplan worker-thread count.", "It bounds parallel work performed by the floorplan engine."),
        "macro_placer.macro_placement_halo": ("The halo reserved around placed macros.", "It keeps standard-cell and routing resources away from macro boundaries during macro placement."),
        "macro_placer.macro_routing_halo": ("The routing halo reserved around macros.", "It reserves routing clearance around macro boundaries."),
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


def _stage_sources(stage: Stage) -> dict[str, str]:
    paths = dict(SOURCE_PATHS)
    paths.update(stage.source_paths)
    if stage.config_path:
        paths[f"config.{stage.slug}"] = stage.config_path
    return paths


def _referenced_sources(
    paths: dict[str, str], entries: list[dict[str, object]]
) -> dict[str, str]:
    source_ids = {
        evidence["source_id"]
        for entry in entries
        for evidence in entry["evidence"]
    }
    return {source_id: paths[source_id] for source_id in sorted(source_ids)}


def _source_inventory(paths: dict[str, str], schema_version: str) -> dict[str, object]:
    return {
        "schema_version": schema_version,
        "sources": [
            {"id": source_id, "path": path, "sha256": _sha256((ECOS_ROOT / path).read_bytes())}
            for source_id, path in paths.items()
        ],
    }


def _stage_source_inventory(
    stage: Stage, entries: list[dict[str, object]]
) -> dict[str, object]:
    paths = _referenced_sources(_stage_sources(stage), entries)
    return _source_inventory(paths, stage.source_schema)


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
    stages: tuple[str, ...] = (),
) -> None:
    chunk = _section(entity_id, body, evidence)
    documents.setdefault(document, []).append(chunk)
    entry: dict[str, object] = {
        "id": entity_id,
        "kind": kind,
        "document": document,
        "anchor": entity_id,
        "review_status": "source-audited",
        "evidence": [{"source_id": source_id} for source_id in evidence],
        "chunk_sha256": _sha256(chunk.strip().encode("utf-8")),
    }
    if stages:
        entry["stages"] = list(stages)
    entries.append(entry)


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
        if key in PLACE_PARAMETER_SEMANTICS:
            return PLACE_PARAMETER_SEMANTICS[key]
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
        "sizer": (
            ("script_inputs", "**Meaning:** The generated Sizer environment and command files.\n\n**Role:** The wrapper requires both files before invoking the fixed Sizer command; they materialize workspace paths and tool inputs."),
            ("staging_outputs", "**Meaning:** The Sizer staging DEF and Verilog paths.\n\n**Role:** Both files must exist before the wrapper can pass the result into DreamPlace legalization."),
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
        if stage.slug == "floorplan" and key == "macro_placer.macro_location_path":
            # Compatibility-only field; the main iFP flow does not consume it.
            continue
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
    evidence = (*stage.tool_source_ids, "ecc.metrics", "gui.step_metrics", "gui.qor_trend", "gui.qor_data")
    metric_ids = METRICS[stage.slug]
    if not metric_ids:
        records = (
            (
                "database_summary",
                "The saved ECC database summary available to shared QoR analysis.",
                "After stage persistence, the shared metric builder may read `Design Layout` and `Design Statis` facts from the feature database to publish generic structural records.",
                f"{stage.step_name} currently publishes no stage-specific numeric comparison metric; shared database facts are context, not proof of stage success or timing improvement.",
            ),
            (
                "qor_availability",
                "Whether this stage has publishable structured QoR records for the GUI.",
                "ECC writes `qor_metrics.json` only from finite numeric records with valid `feature/` sources, and the GUI accepts schema-v3 records with valid source metadata.",
                "An available QoR artifact proves only that its records passed the publication contract. Missing artifacts or filtered records must not be interpreted as zero-valued metrics or stage success.",
            ),
        )
        for name, meaning, calculation, boundary in records:
            _add(
                entries,
                documents,
                entity_id=f"metric.{stage.slug}.{name}",
                kind="metric",
                aliases=tuple(f"{alias} {name.replace('_', ' ')}" for alias in stage.aliases),
                document="metrics.md",
                body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}\n\n**Boundary:** {boundary}",
                evidence=evidence,
            )
        return
    for metric_id in metric_ids:
        meaning, calculation, boundary, source_ids = METRIC_DETAILS[metric_id]
        display_name = metric_id.replace("_", " ")
        _add(
            entries,
            documents,
            entity_id=f"metric.{metric_id}",
            kind="metric",
            aliases=(display_name, *(f"{alias} {display_name}" for alias in stage.aliases)),
            document="metrics.md",
            body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}\n\n**Boundary:** {boundary}",
            evidence=tuple(dict.fromkeys((*evidence, *source_ids))),
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
    feature_step_disabled = stage.slug in {"floorplan", "legalization", "sizer", "rcx", "sta"}
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
    evidence = tuple(
        dict.fromkeys((*stage.tool_source_ids, *FAILURE_NATIVE_SOURCE_IDS.get(stage.slug, ())))
    )
    _add(
        entries,
        documents,
        entity_id=f"failure.{stage.slug}.preconditions",
        kind="failure_mode",
        aliases=tuple(f"{alias} failed" for alias in stage.aliases),
        document="failures.md",
        body=f"**Failure mode:** {stage.failure}",
        evidence=evidence,
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
            evidence=evidence,
        )
    _add(
        entries,
        documents,
        entity_id=f"failure.{stage.slug}.terminal_evidence",
        kind="failure_mode",
        aliases=tuple(f"{alias} completion evidence" for alias in stage.aliases),
        document="failures.md",
        body="**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.",
        evidence=evidence,
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
    for name, aliases, body, source_ids in ALGORITHM_DETAILS[stage.slug]:
        _add(
            entries,
            documents,
            entity_id=f"algorithm.{stage.slug}.{name}",
            kind="algorithm",
            aliases=aliases,
            document="algorithms.md",
            body=body,
            evidence=tuple(dict.fromkeys((*stage.tool_source_ids, *source_ids))),
        )
    _add_parameters(stage, entries, documents)
    _add_metrics(stage, entries, documents)
    _add_artifacts(stage, entries, documents)
    _add_failures(stage, entries, documents)


def _write_regression(stage: Stage, output: Path, entries: list[dict[str, object]]) -> None:
    cases = [
        {**case, "question": f"Explain {case['entity_id']}"}
        for case in stage.regression_cases
    ] or _stage_regression_cases(stage, entries)
    regression = output / "regression"
    regression.mkdir(exist_ok=True)
    regression.joinpath(f"{stage.slug}_questions.jsonl").write_text(
        "".join(_json(case) + "\n" for case in cases), encoding="utf-8"
    )


def _stage_regression_cases(
    stage: Stage, entries: list[dict[str, object]]
) -> list[dict[str, object]]:
    metric_id = f"metric.{METRICS[stage.slug][0]}" if METRICS[stage.slug] else f"metric.{stage.slug}.database_summary"
    parameter_id = next(entry["id"] for entry in entries if str(entry["id"]).startswith(f"parameter.{stage.slug}."))
    cases = [
        {"id": f"{stage.slug}-execution", "question": f"Explain algorithm.{stage.slug}.execution", "entity_id": f"algorithm.{stage.slug}.execution", "required_text": "Execution path:"},
    ]
    cases.extend(
        {
            "id": f"{stage.slug}-{name}",
            "question": f"Explain {stage.slug} algorithm {name.replace('_', ' ')}.",
            "entity_id": f"algorithm.{stage.slug}.{name}",
            "required_text": "Source evidence:",
        }
        for name, aliases, _body, _source_ids in ALGORITHM_DETAILS[stage.slug]
    )
    cases.extend((
        {"id": f"{stage.slug}-parameter", "question": f"Explain {parameter_id}", "entity_id": parameter_id, "required_text": "**Role:**"},
        {"id": f"{stage.slug}-metric", "question": f"Explain {metric_id}", "entity_id": metric_id, "required_text": "**Calculation:**"},
        {"id": f"{stage.slug}-artifact", "question": f"Explain artifact.{stage.slug}.outputs", "entity_id": f"artifact.{stage.slug}.outputs", "required_text": "**Meaning:**"},
        {"id": f"{stage.slug}-failure", "question": f"Explain failure.{stage.slug}.preconditions", "entity_id": f"failure.{stage.slug}.preconditions", "required_text": "**Failure mode:**"},
    ))
    return cases


def _build_bundle(stage: Stage, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    knowledge = output / "knowledge"
    knowledge.mkdir(exist_ok=True)
    entries: list[dict[str, object]] = []
    documents: dict[str, list[str]] = {name: [] for name in ("algorithms.md", "parameters.md", "metrics.md", "artifacts.md", "failures.md")}
    (stage.entry_writer or _add_stage)(stage, entries, documents)
    for name, chunks in documents.items():
        (knowledge / name).write_text("\n".join(chunks), encoding="utf-8")
    catalog = {
        "schema_version": stage.catalog_schema,
        "domain": stage.domain or f"ecos_{stage.slug}",
        "publication": {
            "status": "source-audited",
            "scope": stage.publication_scope
            or f"ECOS {stage.step_name} source snapshot",
        },
        "entities": entries,
    }
    (output / "catalog.json").write_text(_json(catalog) + "\n", encoding="utf-8")
    (output / "sources.json").write_text(
        _json(_stage_source_inventory(stage, entries)) + "\n", encoding="utf-8"
    )
    _write_regression(stage, output, entries)
    files = {
        str(path.relative_to(output)): _sha256(path.read_bytes())
        for path in sorted(output.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }
    manifest = {"schema_version": stage.manifest_schema, "files": files, "entity_count": len(entries)}
    (output / "manifest.json").write_text(_json(manifest) + "\n", encoding="utf-8")


def build_all(output: Path) -> None:
    for stage in STAGES:
        _build_bundle(stage, output / "tool" / stage.slug)
    from .general_details import GENERAL_KNOWLEDGE_METRICS, build_general_bundle
    for metric in GENERAL_KNOWLEDGE_METRICS:
        build_general_bundle(output / "general" / metric, metric)
    (output / "retrieval-config.v1.json").write_text(
        _json({"schema_version": "ecos-frozen-knowledge-retrieval-config.v1", "top_k": 3, "field_weights": [10.0, 20.0, 10.0, 1.0], "max_query_tokens": 32, "max_raw_bm25": None, "min_score_margin": 0.0, "min_token_overlap": 3, "max_document_frequency": 0, "allow_metadata_match": False}) + "\n",
        encoding="utf-8",
    )
