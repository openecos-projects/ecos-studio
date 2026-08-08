#!/usr/bin/env python3
"""Build the frozen, alias-leak-free knowledge retrieval benchmark."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from ecos_agent.knowledge_retriever import tokenize
from ecos_agent.step_knowledge import STEP_KNOWLEDGE_SPECS, StepKnowledge


AGENT_ROOT = Path(__file__).parents[1]
OUTPUT_ROOT = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval"
SEED = 20260808
DATA_VERSION = "ecos-knowledge-retrieval-benchmark.v1"
GENERATOR_VERSION = "ecos-knowledge-benchmark.v2"
NO_ANSWER_KINDS = ("non_eda", "other_eda", "shared_generic")
HARD_PAIRS = ("cts:synthesis", "place:legalization", "rcx:sta")
SEMANTIC_TARGETS = {
    "synthesis": ("algorithm.synthesis.frontend_lowering", "algorithm.synthesis.mapped_netlist_gate"),
    "floorplan": ("algorithm.floorplan.database_wrapping", "algorithm.floorplan.die_core_rows_tracks"),
    "fixfanout": ("algorithm.fixfanout.model_initialization", "algorithm.fixfanout.violating_net_scan"),
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
    "synthesis": ("lower RTL constructs before technology mapping", "produce a mapped gate-level netlist"),
    "floorplan": ("prepare the persistent physical design database", "create die, core, rows, and routing tracks"),
    "fixfanout": ("prepare the overloaded-net repair model", "find nets above the permitted fanout limit"),
    "place": ("run the placement engine for an implementation", "relax cell coordinates with wirelength and density costs"),
    "cts": ("coordinate clock implementation substeps", "partition clock sinks into a distribution topology"),
    "legalization": ("configure the legal-only placement inputs", "move spread cells back to valid physical sites"),
    "route": ("orchestrate routing and repair", "estimate planar routing demand before detailed wires"),
    "drc": ("collect layout shapes for checking", "dispatch physical geometry rules to the relevant checks"),
    "filler": ("initialize filler placement data", "find unused legal placement segments"),
    "rcx": ("form the extracted parasitic topology", "derive wire resistance from the extracted layout"),
    "sta": ("enumerate signoff analysis views", "calculate required time with setup and hold slack"),
    "harden": ("choose delivery inputs for an integrated build", "export the abstract LEF macro interface"),
}
SEMANTIC_WORK_ZH = {
    "synthesis": ("在工艺映射前拆解 RTL 结构", "把逻辑映射为门级网表"),
    "floorplan": ("准备持久化的物理设计数据库", "建立芯片边界、核心区、标准单元行和布线轨道"),
    "fixfanout": ("初始化修复过载网络的模型", "找出扇出超过限制的网络"),
    "place": ("运行实现所需的布局引擎", "在连线长度和密度代价下放松单元坐标"),
    "cts": ("协调时钟实现的多个子步骤", "把时钟接收端划分为分发拓扑"),
    "legalization": ("配置仅合法化的布局输入", "把扩散后的单元放回合法物理位置"),
    "route": ("组织布线与修复", "在详细连线前估算平面布线需求"),
    "drc": ("收集检查所需的版图形状", "将物理几何规则分派到对应检查"),
    "filler": ("初始化填充单元放置数据", "找出未占用的合法放置区间"),
    "rcx": ("形成提取得到的寄生网络拓扑", "从提取版图计算导线电阻"),
    "sta": ("枚举签核分析视图", "计算要求到达时间以及建立和保持裕量"),
    "harden": ("选择集成交付的输入", "导出抽象的 LEF 宏接口"),
}
EN_TEMPLATES = (
    "During chip implementation, which ECOS phase should {work}?",
    "A designer needs to {work}; where is that handled in the ECOS flow?",
    "Name the flow step used when an implementation must {work}.",
)
ZH_TEMPLATES = (
    "芯片实现中，ECOS 的哪个阶段负责 {work}？",
    "设计人员需要 {work}，应进入 ECOS 的哪一步？",
    "若实现任务必须 {work}，ECOS 中由哪个流程阶段处理？",
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
        bundle = StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec)
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
    aliases: dict[str, tuple[str, ...]] = {}
    for spec in STEP_KNOWLEDGE_SPECS:
        bundle = StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec)
        aliases.update({f"{spec.slug}:{entity.entity_id}": entity.aliases for entity in bundle.entities})
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
    corpus = [(spec.slug, entity.chunk_sha256) for spec in STEP_KNOWLEDGE_SPECS for entity in StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec).entities]
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
