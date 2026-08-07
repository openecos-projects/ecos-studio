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


def _add_parameters(stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]], evidence: tuple[str, ...]) -> None:
    config_entries = _config_entries(stage)
    if not config_entries:
        _add(
            entries,
            documents,
            entity_id=f"parameter.{stage.slug}.workspace_config",
            kind="parameter",
            aliases=tuple(f"{alias} config" for alias in stage.aliases),
            document="parameters.md",
            body=f"**Meaning:** The workspace configuration boundary for the {stage.step_name} stage.\n\n**Role:** The runner receives this stage configuration from the workspace; this source snapshot has no committed leaf defaults for this stage.",
            evidence=stage.tool_source_ids,
        )
        return
    config_evidence = (*stage.tool_source_ids, f"config.{stage.slug}")
    for key, _value in config_entries:
        aliases = tuple(f"{alias} {key}" for alias in stage.aliases)
        _add(
            entries,
            documents,
            entity_id=f"parameter.{stage.slug}.{_identifier(key)}",
            kind="parameter",
            aliases=aliases,
            document="parameters.md",
            body=f"**Meaning:** `{key}` is a committed configuration field for the {stage.step_name} stage.\n\n**Role:** The stage runner passes the workspace configuration to its underlying tool; this field participates only according to that tool's configuration parser.",
            evidence=config_evidence,
        )


def _add_metrics(stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]], evidence: tuple[str, ...]) -> None:
    metric_ids = METRICS[stage.slug]
    if not metric_ids:
        _add(
            entries,
            documents,
            entity_id=f"metric.{stage.slug}.availability",
            kind="metric",
            aliases=tuple(f"{alias} metrics" for alias in stage.aliases),
            document="metrics.md",
            body=f"**Meaning:** Numeric metric availability for {stage.step_name}.\n\n**Calculation:** {stage.metric_source}",
            evidence=evidence,
        )
        return
    for metric_id in metric_ids:
        _add(
            entries,
            documents,
            entity_id=f"metric.{metric_id}",
            kind="metric",
            aliases=tuple(f"{alias} {metric_id}" for alias in stage.aliases),
            document="metrics.md",
            body=f"**Meaning:** `{metric_id}` is the normalized {stage.step_name} metric shown by ECOS when its source fact is available.\n\n**Calculation:** {stage.metric_source} Missing source data remains unavailable; it is not converted to zero or a success claim.",
            evidence=evidence,
        )


def _add_artifacts(stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]], evidence: tuple[str, ...]) -> None:
    if stage.slug == "harden":
        meaning = "The Harden output package contains an abstract LEF, timing-model LIB, and hardened GDS."
        calculation = "The runner writes the LEF and LIB from the selected signoff inputs and exports GDS with the harden flag before final analysis checks package completeness."
    elif stage.slug == "sta":
        meaning = "The STA output set contains corner-specific timing reports and structured feature artifacts."
        calculation = "For every configured Liberty/RCX combination, the runner writes report and feature artifacts to a corner-specific directory before aggregate multi-corner analysis."
    elif stage.slug == "rcx":
        meaning = "The RCX output set contains extracted SPEF files plus the shared saved design, geometry, feature, QoR, and checklist artifacts."
        calculation = "After RCX finishes, the runner copies SPEFs from its writer directory to declared outputs, saves the ECC design, and persists SPEF feature facts before analysis."
    else:
        meaning = f"The {stage.step_name} output set contains saved DEF, Verilog, GDS, database, geometry snapshot, feature, QoR, and checklist artifacts when the shared persistence path succeeds."
        calculation = "The shared `save_data` path serializes the current ECC database, writes the geometry snapshot for supported steps, and analysis then builds metrics, plots, and checklist records."
    _add(
        entries,
        documents,
        entity_id=f"artifact.{stage.slug}.outputs",
        kind="artifact",
        aliases=tuple(f"{alias} artifacts" for alias in stage.aliases),
        document="artifacts.md",
        body=f"**Meaning:** {meaning}\n\n**Calculation:** {calculation}",
        evidence=evidence,
    )


def _add_stage(stage: Stage, entries: list[dict[str, object]], documents: dict[str, list[str]]) -> None:
    tool_evidence = stage.tool_source_ids
    metric_evidence = (*tool_evidence, "ecc.metrics", "gui.step_metrics")
    _add(
        entries,
        documents,
        entity_id=f"algorithm.{stage.slug}.execution",
        kind="algorithm",
        aliases=(*stage.aliases, *(f"{alias} execution" for alias in stage.aliases)),
        document="algorithms.md",
        body=f"**Execution path:** {stage.execution}",
        evidence=tool_evidence,
    )
    _add_parameters(stage, entries, documents, tool_evidence)
    _add_metrics(stage, entries, documents, metric_evidence)
    _add_artifacts(stage, entries, documents, (*tool_evidence, "ecc.runner", "ecc.builder"))
    _add(
        entries,
        documents,
        entity_id=f"failure.{stage.slug}.preconditions",
        kind="failure_mode",
        aliases=tuple(f"{alias} failed" for alias in stage.aliases),
        document="failures.md",
        body=f"**Failure mode:** {stage.failure}",
        evidence=tool_evidence,
    )


def _write_regression(stage: Stage, output: Path) -> None:
    case = {
        "id": f"{stage.slug}-execution",
        "question": f"How does the {stage.step_name} stage execute?",
        "entity_id": f"algorithm.{stage.slug}.execution",
        "required_text": "Execution path:",
    }
    regression = output / "regression"
    regression.mkdir(exist_ok=True)
    regression.joinpath(f"{stage.slug}_questions.jsonl").write_text(_json(case) + "\n", encoding="utf-8")


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
    _write_regression(stage, output)
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
