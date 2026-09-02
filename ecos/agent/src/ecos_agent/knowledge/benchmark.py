#!/usr/bin/env python3
"""Build the frozen, alias-leak-free knowledge retrieval benchmark."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from ecos_agent.knowledge.retriever import tokenize
from ecos_agent.knowledge.step import STEP_KNOWLEDGE_SPECS, StepKnowledge


AGENT_ROOT = Path(__file__).parents[3]
OUTPUT_ROOT = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval"
LEGACY_ALIAS_TERMS = OUTPUT_ROOT / "legacy-alias-terms.v1.json"
SEED = 20260808
DATA_VERSION = "ecos-knowledge-retrieval-benchmark.v1"
GENERATOR_VERSION = "ecos-knowledge-benchmark.v2"
NO_ANSWER_KINDS = ("non_eda", "other_eda", "shared_generic")
HARD_PAIRS = ("cts:synthesis", "place:legalization", "rcx:sta")
SEMANTIC_TARGETS = {
    "synthesis": ("algorithm.synthesis.frontend_lowering", "algorithm.synthesis.mapped_netlist_gate"),
    "floorplan": ("algorithm.floorplan.database_wrapping", "algorithm.floorplan.die_core_rows_tracks"),
    "sizer": ("algorithm.sizer.runtime_and_script_preconditions", "algorithm.sizer.command_and_staging_gate"),
    "place": ("algorithm.place.execution", "algorithm.dreamplace.global_placement"),
    "cts": ("algorithm.cts.flow_pipeline", "algorithm.cts.clock_domain_synthesis"),
    "legalization": ("algorithm.legalization.legalize_only_setup", "algorithm.legalization.legalization_pipeline"),
    "route": ("algorithm.route.routing_pipeline", "algorithm.route.planar_global_routing"),
    "drc": ("algorithm.drc.shape_collection", "algorithm.drc.geometric_rule_dispatch"),
    "filler": ("algorithm.filler.filler_model_initialization", "algorithm.filler.available_segment_extraction"),
    "rcx": ("algorithm.rcx.topology_construction", "algorithm.rcx.resistance_extraction"),
    "sta": ("algorithm.sta.signoff_matrix_expansion", "algorithm.sta.required_time_and_qor_analysis"),
    "harden": ("algorithm.harden.delivery_input_selection", "algorithm.harden.abstract_lef_generation"),
}
SEMANTIC_WORK = {
    "synthesis": ("read Verilog or Slang sources into RTLIL modules and purge dead logic before mapping", "require `check -mapped` and the declared final Verilog output before accepting the run"),
    "floorplan": ("convert the live iDB design, routing layers, instances, nets, and IO pins into an internal physical model before geometry", "derive die dimensions from utilization, align the core to the placement site, and emit routing-layer track grids"),
    "sizer": ("check the ECC, Sizer, and DreamPlace runtimes plus generated script paths before execution", "require a zero Sizer exit and both staging DEF and Verilog before legalization"),
    "place": ("run global placement, an acceptance gate, legalization, and detailed refinement in that order", "minimize smoothed wirelength and density over continuous cell coordinates, with overflow controlling convergence"),
    "cts": ("run Synthesis, Optimization, Instantiation, and Evaluation on shared clock-layout state", "separate hard-macro and regular clock sinks before `Topology::formClock()` commits a clock topology"),
    "legalization": ("disable global placement, fillers, and random-center initialization while enabling `legalize_flag`", "apply `MacroLegalize`, `GreedyLegalize`, then `AbacusLegalize` to the continuous position tensor"),
    "route": ("run PinAccessor through ViolationReporter against shared global and detailed route maps", "rip up overflow nets and reroute them with A* for at most five iterations"),
    "drc": ("turn OBS, pins, vias, routed segments, and blockages into validation shape vectors", "query per-layer rectangle, boundary, and cut R-trees only for enabled rule types"),
    "filler": ("reject a non-positive minimum filler width and retain only site-width-multiple core filler masters", "convert clipped blockages to unavailable site ranges, then scan contiguous placement gaps"),
    "rcx": ("normalize local nodes and edges from regular-net segments and vias into one global pool", "accumulate wire-edge overlap with sheet resistance, plus via shape-area resistance"),
    "sta": ("enumerate every Liberty corner with its listed RCX corners and SPEF path before timing runs", "back-propagate from endpoints and retain worst setup/hold WNS and TNS across loaded corners"),
    "harden": ("select the first STA signoff record to provide Liberty, SDC, and SPEF inputs", "serialize the current iDB physical database through `saveLef()` to the declared LEF path"),
}
SEMANTIC_WORK_ZH = {
    "synthesis": ("将 Verilog 或 Slang 源读入 RTLIL 模块，并在 mapping 前清除死逻辑", "只有 `check -mapped` 通过且声明的 final Verilog 已生成时才接受本次运行"),
    "floorplan": ("在生成 geometry 前，将 live iDB design 的 routing layers、instances、nets 和 IO pins 转为内部物理模型", "按 utilization 推导 die 尺寸，将 core 对齐 placement site，并生成 routing-layer track grids"),
    "sizer": ("执行前检查 ECC、Sizer、DreamPlace runtime 和已生成的脚本路径", "只有 Sizer 返回零且 staging DEF 与 Verilog 同时存在后才进入 legalization"),
    "place": ("按 global placement、acceptance gate、legalization、detailed refinement 的顺序执行", "在连续 cell coordinates 上最小化 smoothed wirelength 与 density，并用 overflow 控制收敛"),
    "cts": ("在共享 clock-layout state 上依次执行 Synthesis、Optimization、Instantiation 和 Evaluation", "先区分 hard-macro 与 regular clock sinks，再由 `Topology::formClock()` 提交时钟拓扑"),
    "legalization": ("关闭 global placement、fillers 和 random-center initialization，同时启用 `legalize_flag`", "对连续 position tensor 依次应用 `MacroLegalize`、`GreedyLegalize`、`AbacusLegalize`"),
    "route": ("在共享 global/detailed route maps 上，从 PinAccessor 执行到 ViolationReporter", "对 overflow nets rip-up 后用 A* reroute，最多五轮"),
    "drc": ("将 OBS、pins、vias、routed segments 与 blockages 转为用于 validation 的 shape vectors", "仅对 enabled rule types 查询各层的 rectangle、boundary 与 cut R-trees"),
    "filler": ("非正 minimum filler width 应被拒绝，只保留宽度为 site-width 整数倍的 core filler masters", "将 clipped blockages 标成 unavailable site ranges，再扫描连续的 placement gaps"),
    "rcx": ("把 regular-net segments 与 vias 的局部 nodes/edges 规范化到同一个 global pool", "用 sheet resistance 累积 wire-edge overlap，并加入由 via shape area 得到的电阻"),
    "sta": ("在 timing runs 前枚举每个 Liberty corner、其 RCX corners 和 SPEF path", "从 endpoints 向后推导 timing，并跨已加载 corners 保留最差 setup/hold WNS、TNS"),
    "harden": ("选择第一条 STA signoff record 作为 Liberty、SDC、SPEF 输入", "通过 `saveLef()` 将当前 iDB physical database 写入声明的 LEF path"),
}
EN_TEMPLATES = (
    "During chip implementation, which ECOS phase should {work}?",
    "A designer needs to {work}; where is that handled in the ECOS flow?",
    "Name the flow step used when an implementation must {work}.",
)
ZH_TEMPLATES = (
    "{work} 属于 ECOS 的哪个流程阶段？",
    "工程师需要 {work}，应进入 ECOS 的哪一步？",
    "遇到 {work} 时，ECOS 由哪个流程阶段处理？",
)
NON_EDA_TOPICS = (
    "sourdough starter hydration", "city museum opening hours", "polar weather forecast", "orchid pruning", "marathon nutrition",
    "astronomy telescope alignment", "piano chord inversion", "vegetable fermentation", "railway ticket refund", "language pronunciation",
    "home insurance renewal", "mountain trail permit", "aquarium water cycling", "photography aperture", "garden compost ratio",
    "novel manuscript editing", "coffee roast profile", "bike tire pressure", "solar eclipse viewing", "library book renewal",
)
OTHER_EDA_TOPICS = (
    "OpenROAD ODB ECO syntax", "Innovus NanoRoute command", "Calibre RVE session", "Magic extraction deck", "Yosys ABC pass",
    "Genus iSpatial option", "PrimeTime PX annotation", "ICC2 NDM import", "Fusion Compiler MSCTS switch", "VCS coverage database",
    "Verilator lint waiver", "KLayout PCell macro", "TritonRoute guide format", "OpenSTA Tcl namespace", "Spectre ADE corner",
    "Virtuoso SKILL callback", "Xcelium waveform database", "Tempus SI command", "Aprisa power-grid wizard", "Nitro-SoC synthesis recipe",
)
GENERIC_TOPICS = (
    "quarterly revenue", "museum attendance", "classroom seating", "book club discussion", "garden harvest",
    "volunteer roster", "festival schedule", "travel itinerary", "kitchen inventory", "fitness routine",
    "customer survey", "sports league", "weather journal", "language course", "library circulation",
    "community newsletter", "photography workshop", "music rehearsal", "charity auction", "restaurant reservation",
)


def _case(
    stage: str,
    case_id: str,
    query: str,
    language: str,
    category: str,
    split: str,
    targets: list[str],
    *,
    target_stages: list[str] | None = None,
    **extra: object,
) -> dict[str, object]:
    target_stages = target_stages or [stage] * len(targets)
    return {
        "id": case_id,
        "stage": stage,
        "query": query,
        "language": language,
        "category": category,
        "answerable": True,
        "target_entity_ids": targets,
        "target_stage_entity_ids": [f"{target_stage}:{target}" for target_stage, target in zip(target_stages, targets, strict=True)],
        "required_evidence": targets,
        "forbidden_alias_overlap": category == "semantic_paraphrase",
        "split": split,
        **extra,
    }


def _semantic_cases() -> list[dict[str, object]]:
    cases: list[dict[str, object]] = []
    for spec in STEP_KNOWLEDGE_SPECS:
        dev_target, test_target = SEMANTIC_TARGETS[spec.slug]
        dev_work, test_work = SEMANTIC_WORK[spec.slug]
        dev_work_zh, test_work_zh = SEMANTIC_WORK_ZH[spec.slug]
        for index, template in enumerate(EN_TEMPLATES):
            cases.append(_case(spec.slug, f"{spec.slug}-dev-en-{index}", template.format(work=dev_work), "en", "semantic_paraphrase", "dev", [dev_target], ambiguous=index == 2))
            cases.append(_case(spec.slug, f"{spec.slug}-test-en-{index}", template.format(work=test_work), "en", "semantic_paraphrase", "test", [test_target], ambiguous=index == 2))
        for index, template in enumerate(ZH_TEMPLATES):
            cases.append(_case(spec.slug, f"{spec.slug}-dev-zh-{index}", template.format(work=dev_work_zh), "zh", "semantic_paraphrase", "dev", [dev_target], ambiguous=index == 2))
            cases.append(_case(spec.slug, f"{spec.slug}-test-zh-{index}", template.format(work=test_work_zh), "zh", "semantic_paraphrase", "test", [test_target], ambiguous=index == 2))
    return cases


def _identifier_cases() -> list[dict[str, object]]:
    cases: list[dict[str, object]] = []
    for spec in STEP_KNOWLEDGE_SPECS:
        bundle = StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / "tool" / spec.slug, spec)
        by_kind = {
            kind: [entity.entity_id for entity in bundle.entities if entity.entity_id.startswith(f"{kind}.")]
            for kind in ("parameter", "metric", "artifact")
        }
        targets = [by_kind["parameter"][0], by_kind["parameter"][1], by_kind["metric"][0], by_kind["artifact"][0]]
        for index, target in enumerate(targets):
            split = "dev" if index % 2 == 0 else "test"
            noun = "parameter" if target.startswith("parameter.") else "metric" if target.startswith("metric.") else "artifact"
            cases.append(_case(spec.slug, f"{spec.slug}-identifier-{index}", f"In ECOS {spec.slug}, what does the {noun} identifier `{target}` record?", "en", "identifier", split, [target]))
    return cases


def _cross_stage_cases() -> list[dict[str, object]]:
    prompts = {
        "cts:synthesis": "How should clock sink topology planning relate to producing a mapped gate-level netlist?",
        "place:legalization": "How do density-aware continuous cell movement and site-legal cell movement work together?",
        "rcx:sta": "How do extracted wire resistance and required-time slack analysis connect at signoff?",
    }
    cases: list[dict[str, object]] = []
    for pair in HARD_PAIRS:
        first, second = pair.split(":")
        targets = [SEMANTIC_TARGETS[first][1], SEMANTIC_TARGETS[second][1]]
        for index in range(16):
            language = "mixed" if index < 8 else "en"
            suffix = f" 请说明情形 {index + 1} 中两个阶段的边界。" if language == "mixed" else f" Explain the boundary for scenario {index + 1}."
            cases.append(_case(first, f"hard-{pair.replace(':', '-')}-{index:02d}", prompts[pair] + suffix, language, "cross_stage", "test", targets, target_stages=[first, second], hard_pair=pair))
    return cases


def _no_answer_cases() -> list[dict[str, object]]:
    topics_by_kind = {
        "non_eda": ("Explain", NON_EDA_TOPICS),
        "other_eda": ("Explain", OTHER_EDA_TOPICS),
        "shared_generic": ("What does the report say about", GENERIC_TOPICS),
    }
    cases: list[dict[str, object]] = []
    for kind in NO_ANSWER_KINDS:
        prefix, topics = topics_by_kind[kind]
        for index, topic in enumerate(topics):
            split = "test" if index < 12 else "dev"
            cases.append({
                "id": f"no-answer-{kind}-{index:02d}",
                "stage": "none",
                "query": f"{prefix} {topic}.",
                "language": "en",
                "category": "no_answer",
                "answerable": False,
                "target_entity_ids": [],
                "target_stage_entity_ids": [],
                "required_evidence": [],
                "forbidden_alias_overlap": False,
                "split": split,
                "no_answer_kind": kind,
            })
    return cases


def _aliases_by_target() -> dict[str, tuple[str, ...]]:
    payload = json.loads(LEGACY_ALIAS_TERMS.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != "ecos-knowledge-legacy-alias-terms.v1":
        raise ValueError("legacy alias audit terms are invalid")
    terms = payload.get("terms")
    if not isinstance(terms, dict):
        raise ValueError("legacy alias audit terms are invalid")
    aliases = {str(key): tuple(str(value) for value in values) for key, values in terms.items() if isinstance(values, list)}
    for spec in STEP_KNOWLEDGE_SPECS:
        bundle = StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / "tool" / spec.slug, spec)
        if any(f"{spec.slug}:{entity.entity_id}" not in aliases for entity in bundle.entities):
            raise ValueError("legacy alias audit terms are incomplete")
    return aliases


def _aliases_leak(query: str, aliases: tuple[str, ...]) -> bool:
    query_tokens = set(tokenize(query))
    return any((alias_tokens := set(tokenize(alias))) and alias_tokens <= query_tokens for alias in aliases)


def _validate(cases: list[dict[str, object]], aliases: dict[str, tuple[str, ...]]) -> None:
    if len(cases) != 300:
        raise ValueError(f"benchmark must contain 300 cases, found {len(cases)}")
    if len({str(case["id"]) for case in cases}) != len(cases) or len({str(case["query"]).casefold() for case in cases}) != len(cases):
        raise ValueError("benchmark contains duplicate ids or queries")
    split_by_target: dict[str, str] = {}
    for case in cases:
        targets = list(case["target_entity_ids"])
        target_groups = list(case["target_stage_entity_ids"])
        if len(targets) != len(target_groups) or list(case["required_evidence"]) != targets:
            raise ValueError(f"invalid target contract: {case['id']}")
        for target, target_group in zip(targets, target_groups, strict=True):
            if not str(target_group).endswith(f":{target}") or str(target_group) not in aliases:
                raise ValueError(f"unknown benchmark target: {case['id']} -> {target_group}")
            if previous_split := split_by_target.setdefault(str(target_group), str(case["split"])):
                if previous_split != case["split"]:
                    raise ValueError(f"split target leak: {target_group}")
        if case["forbidden_alias_overlap"] and any(_aliases_leak(str(case["query"]), aliases[str(target_group)]) for target_group in target_groups):
            raise ValueError(f"semantic alias leak: {case['id']}")
    _validate_coverage(cases)


def _validate_coverage(cases: list[dict[str, object]]) -> None:
    stages = tuple(spec.slug for spec in STEP_KNOWLEDGE_SPECS)
    counts = Counter((str(case["stage"]), str(case["language"]), str(case["category"])) for case in cases)
    test_counts = Counter((str(case["stage"]), str(case["language"]), str(case["category"])) for case in cases if case["split"] == "test")
    for stage in stages:
        if counts[(stage, "en", "semantic_paraphrase")] < 6 or counts[(stage, "zh", "semantic_paraphrase")] < 6 or counts[(stage, "en", "identifier")] < 4:
            raise ValueError(f"stage coverage missing: {stage}")
        if test_counts[(stage, "en", "semantic_paraphrase")] < 3 or test_counts[(stage, "zh", "semantic_paraphrase")] < 3 or test_counts[(stage, "en", "identifier")] < 2:
            raise ValueError(f"test coverage missing: {stage}")
    categories = Counter(str(case["category"]) for case in cases)
    no_answer_kinds = Counter(str(case.get("no_answer_kind")) for case in cases if not case["answerable"])
    hard_pairs = Counter(str(case.get("hard_pair")) for case in cases if case["category"] == "cross_stage")
    if categories["cross_stage"] < 48 or categories["no_answer"] < 60 or any(no_answer_kinds[kind] < 20 for kind in NO_ANSWER_KINDS):
        raise ValueError("benchmark lacks hard negatives or no-answer coverage")
    if any(hard_pairs[pair] < 16 for pair in HARD_PAIRS) or sum(case["language"] == "mixed" for case in cases) < 24 or sum(len(case["target_entity_ids"]) > 1 for case in cases) < 24:
        raise ValueError("benchmark lacks pair, mixed-language, or multi-entity coverage")
    if not any(case.get("ambiguous") and case["answerable"] for case in cases):
        raise ValueError("benchmark lacks answerable ambiguous queries")


def _count_dict(values: list[object]) -> dict[str, int]:
    return dict(sorted(Counter(str(value) for value in values).items()))


def _manifest(cases: list[dict[str, object]]) -> dict[str, object]:
    corpus = [(spec.slug, entity.chunk_sha256) for spec in STEP_KNOWLEDGE_SPECS for entity in StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / "tool" / spec.slug, spec).entities]
    benchmark = "\n".join(json.dumps(case, ensure_ascii=False, sort_keys=True) for case in cases) + "\n"
    counts = {
        "by_category": _count_dict([case["category"] for case in cases]),
        "by_language": _count_dict([case["language"] for case in cases]),
        "by_split": _count_dict([case["split"] for case in cases]),
        "by_stage": _count_dict([case["stage"] for case in cases]),
        "by_split_language_category": _count_dict(["|".join((str(case["split"]), str(case["language"]), str(case["category"]))) for case in cases]),
    }
    return {
        "schema_version": "ecos-knowledge-retrieval-benchmark-manifest.v1",
        "data_version": DATA_VERSION,
        "generator_version": GENERATOR_VERSION,
        "seed": SEED,
        "total_cases": len(cases),
        "counts": counts,
        "corpus_sha256": _sha256(json.dumps(corpus, separators=(",", ":")).encode("utf-8")),
        "benchmark_sha256": _sha256(benchmark.encode("utf-8")),
        "reviewer_status": "deterministic_alias_leak_check_and_self_audit",
    }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    cases = _semantic_cases() + _identifier_cases() + _cross_stage_cases() + _no_answer_cases()
    _validate(cases, _aliases_by_target())
    benchmark = "\n".join(json.dumps(case, ensure_ascii=False, sort_keys=True) for case in cases) + "\n"
    manifest = json.dumps(_manifest(cases), indent=2, sort_keys=True) + "\n"
    paths = (OUTPUT_ROOT / "benchmark.v1.jsonl", OUTPUT_ROOT / "manifest.v1.json")
    if args.check:
        if not all(path.is_file() for path in paths) or paths[0].read_text(encoding="utf-8") != benchmark or paths[1].read_text(encoding="utf-8") != manifest:
            raise SystemExit("knowledge retrieval benchmark is stale; run scripts/build_knowledge_benchmark.py")
        return 0
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    paths[0].write_text(benchmark, encoding="utf-8")
    paths[1].write_text(manifest, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
