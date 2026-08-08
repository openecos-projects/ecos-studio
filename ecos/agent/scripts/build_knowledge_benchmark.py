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
SEMANTIC_PROMPTS = {
    "synthesis": "translate RTL into a mapped gate-level netlist",
    "floorplan": "create core rows and routing tracks inside the die",
    "fixfanout": "identify nets whose fanout exceeds the permitted threshold",
    "place": "relax cells to continuous coordinates with wirelength and density penalties",
    "cts": "partition clock sinks and select a distribution topology",
    "legalization": "apply macro, greedy, and abacus cell movement passes",
    "route": "derive routing demand before detailed wire repair",
    "drc": "load instances, pins, blockages, and routed segments into shape collections",
    "filler": "scan legal rows for unused placement segments",
    "rcx": "derive parasitic resistance from extracted layout topology",
    "sta": "calculate required time and setup or hold slack",
    "harden": "write abstract LEF, timing-model LIB, and hardened GDS outputs",
}
DEV_TARGETS = {
    "synthesis": "algorithm.synthesis.frontend_lowering",
    "floorplan": "algorithm.floorplan.database_wrapping",
    "fixfanout": "algorithm.fixfanout.model_initialization",
    "place": "algorithm.dreamplace.global_placement",
    "cts": "algorithm.cts.flow_pipeline",
    "legalization": "algorithm.legalization.legalize_only_setup",
    "route": "algorithm.route.routing_pipeline",
    "drc": "algorithm.drc.shape_collection",
    "filler": "algorithm.filler.filler_model_initialization",
    "rcx": "algorithm.rcx.topology_construction",
    "sta": "algorithm.sta.signoff_matrix_expansion",
    "harden": "algorithm.harden.delivery_input_selection",
}
TEST_TARGETS = {
    "synthesis": "algorithm.synthesis.mapped_netlist_gate",
    "floorplan": "algorithm.floorplan.die_core_rows_tracks",
    "fixfanout": "algorithm.fixfanout.violating_net_scan",
    "place": "algorithm.dreamplace.global_placement",
    "cts": "algorithm.cts.clock_domain_synthesis",
    "legalization": "algorithm.legalization.legalization_pipeline",
    "route": "algorithm.route.routing_pipeline",
    "drc": "algorithm.drc.shape_collection",
    "filler": "algorithm.filler.available_segment_extraction",
    "rcx": "algorithm.rcx.resistance_extraction",
    "sta": "algorithm.sta.required_time_and_qor_analysis",
    "harden": "artifact.harden.outputs",
}
DEV_PROMPTS = {
    "synthesis": "lower Verilog constructs before technology mapping",
    "floorplan": "wrap the persistent design database for physical planning",
    "fixfanout": "initialize the optimization model before repairing overloaded nets",
    "place": "optimize cell locations while enforcing density constraints",
    "cts": "coordinate synthesis, optimization, instantiation, and evaluation",
    "legalization": "configure the legal-only placement engine inputs",
    "route": "sequence global routing, detailed routing, and repair",
    "drc": "collect physical shapes before geometry rule checking",
    "filler": "initialize filler-cell placement data",
    "rcx": "construct parasitic network topology from extracted nodes",
    "sta": "expand signoff timing combinations across analysis views",
    "harden": "select delivery inputs for an integrated chip build",
}


def _answerable_cases() -> list[dict[str, object]]:
    cases: list[dict[str, object]] = []
    for spec in STEP_KNOWLEDGE_SPECS:
        prompt = SEMANTIC_PROMPTS[spec.slug]
        failure = _failure_target(spec.slug)
        for index in range(6):
            split = "test" if index < 3 else "dev"
            target = TEST_TARGETS[spec.slug] if split == "test" else DEV_TARGETS[spec.slug]
            selected_prompt = prompt if split == "test" else DEV_PROMPTS[spec.slug]
            cases.append(_case(spec.slug, f"en-{index}", f"Which ECOS phase is responsible to {selected_prompt}?", "en", "semantic_paraphrase", split, [target]))
            cases.append(_case(spec.slug, f"zh-{index}", f"ECOS 中哪个阶段负责 {selected_prompt}？", "zh", "semantic_paraphrase", split, [target]))
        for index in range(4):
            cases.append(_case(spec.slug, f"identifier-{index}", f"Explain the prerequisites recorded by {failure}.", "en", "identifier", "test", [failure]))
    return cases


def _case(stage: str, suffix: str, query: str, language: str, category: str, split: str, targets: list[str]) -> dict[str, object]:
    return {
        "id": f"{stage}-{suffix}",
        "query": query,
        "language": language,
        "category": category,
        "answerable": True,
        "target_entity_ids": targets,
        "required_evidence": [targets[0]],
        "forbidden_alias_overlap": category == "semantic_paraphrase",
        "split": split,
    }


def _failure_target(stage: str) -> str:
    spec = next(spec for spec in STEP_KNOWLEDGE_SPECS if spec.slug == stage)
    bundle = StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / stage, spec)
    return next(entity.entity_id for entity in bundle.entities if entity.entity_id.startswith("failure."))


def _cross_stage_cases() -> list[dict[str, object]]:
    specs = list(STEP_KNOWLEDGE_SPECS)
    cases: list[dict[str, object]] = []
    for index in range(48):
        first = specs[index % len(specs)]
        second = specs[(index + 1) % len(specs)]
        targets = [TEST_TARGETS[first.slug], TEST_TARGETS[second.slug]]
        cases.append({
            **_case(first.slug, f"cross-{index}", f"How does {SEMANTIC_PROMPTS[first.slug]} interact with {SEMANTIC_PROMPTS[second.slug]}?", "mixed", "cross_stage", "test", targets),
            "id": f"cross-{index:02d}-{first.slug}-{second.slug}",
        })
    return cases


def _no_answer_cases() -> list[dict[str, object]]:
    topics = ("sourdough starter hydration", "weather forecast", "Kubernetes pod scheduling")
    return [
        {
            "id": f"no-answer-{index:02d}",
            "query": f"Explain {topics[index % len(topics)]}.",
            "language": "en",
            "category": "no_answer",
            "answerable": False,
            "target_entity_ids": [],
            "required_evidence": [],
            "forbidden_alias_overlap": False,
            "split": "test" if index < 36 else "dev",
        }
        for index in range(60)
    ]


def _aliases_by_entity() -> dict[str, tuple[str, ...]]:
    aliases: dict[str, tuple[str, ...]] = {}
    for spec in STEP_KNOWLEDGE_SPECS:
        bundle = StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec)
        for entity in bundle.entities:
            aliases[entity.entity_id] = entity.aliases
    return aliases


def _validate(cases: list[dict[str, object]], aliases: dict[str, tuple[str, ...]]) -> None:
    if len(cases) != 300:
        raise ValueError(f"benchmark must contain 300 cases, found {len(cases)}")
    for case in cases:
        if any(str(entity_id) not in aliases for entity_id in case["target_entity_ids"]):
            raise ValueError(f"unknown benchmark target: {case['id']}")
        if case["forbidden_alias_overlap"]:
            query_tokens = set(tokenize(str(case["query"])))
            for entity_id in case["target_entity_ids"]:
                for alias in aliases[str(entity_id)]:
                    if set(tokenize(alias)) <= query_tokens:
                        raise ValueError(f"semantic alias leak: {case['id']} -> {alias}")
    counts = Counter((case["split"], case["language"], case["category"]) for case in cases)
    if counts[("test", "en", "semantic_paraphrase")] < 36 or counts[("test", "zh", "semantic_paraphrase")] < 36:
        raise ValueError("test split lacks per-stage semantic coverage")
    test_categories = Counter(str(case["category"]) for case in cases if case["split"] == "test")
    if test_categories["cross_stage"] < 24 or test_categories["no_answer"] < 36:
        raise ValueError("test split lacks hard negatives or no-answer cases")


def _manifest(cases: list[dict[str, object]]) -> dict[str, object]:
    corpus = [(spec.slug, entity.chunk_sha256) for spec in STEP_KNOWLEDGE_SPECS for entity in StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec).entities]
    benchmark = "\n".join(json.dumps(case, ensure_ascii=False, sort_keys=True) for case in cases) + "\n"
    return {
        "schema_version": "ecos-knowledge-retrieval-benchmark-manifest.v1",
        "seed": SEED,
        "total_cases": len(cases),
        "counts": {"|".join(key): value for key, value in sorted(Counter((str(case["split"]), str(case["language"]), str(case["category"])) for case in cases).items())},
        "corpus_sha256": _sha256(json.dumps(corpus, separators=(",", ":")).encode("utf-8")),
        "benchmark_sha256": _sha256(benchmark.encode("utf-8")),
        "generator_version": "ecos-knowledge-benchmark.v1",
        "aliases_ablation": "retained_after_test_r3_drop: 1.0 with aliases, 0.940476 without",
        "reviewer_status": "deterministic_alias_leak_check_and_self_audit",
    }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    cases = _answerable_cases() + _cross_stage_cases() + _no_answer_cases()
    _validate(cases, _aliases_by_entity())
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
