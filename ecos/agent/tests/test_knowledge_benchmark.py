from __future__ import annotations

import hashlib
import json
import runpy
import subprocess
from collections import Counter
from pathlib import Path

from ecos_agent.knowledge_retriever import tokenize
from ecos_agent.step_knowledge import STEP_KNOWLEDGE_SPECS, StepKnowledge


AGENT_ROOT = Path(__file__).parents[1]
BENCHMARK_ROOT = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval"


def test_frozen_benchmark_is_current_and_meets_test_minimums() -> None:
    subprocess.run(["uv", "run", "python", "scripts/build_knowledge_benchmark.py", "--check"], cwd=AGENT_ROOT, check=True, capture_output=True, text=True)
    benchmark = (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8")
    cases = [json.loads(line) for line in benchmark.splitlines()]
    counts = Counter((case["split"], case["language"], case["category"]) for case in cases)
    test_categories = Counter(case["category"] for case in cases if case["split"] == "test")

    assert len(cases) >= 300
    assert counts[("test", "en", "semantic_paraphrase")] >= 36
    assert counts[("test", "zh", "semantic_paraphrase")] >= 36
    assert test_categories["cross_stage"] >= 24
    assert test_categories["no_answer"] >= 36
    assert json.loads((BENCHMARK_ROOT / "manifest.v1.json").read_text(encoding="utf-8"))["seed"] == 20260808


def test_semantic_cases_do_not_contain_a_complete_target_alias() -> None:
    aliases = {
        entity.entity_id: entity.aliases
        for spec in STEP_KNOWLEDGE_SPECS
        for entity in StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec).entities
    }
    cases = [json.loads(line) for line in (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8").splitlines()]

    for case in cases:
        if not case["forbidden_alias_overlap"]:
            continue
        query_tokens = set(tokenize(case["query"]))
        for entity_id in case["target_entity_ids"]:
            assert all(
                not (alias_tokens and alias_tokens <= query_tokens)
                for alias in aliases[entity_id]
                for alias_tokens in (set(tokenize(alias)),)
            )


def test_semantic_cases_share_target_chunk_vocabulary() -> None:
    bundles = {
        spec.slug: StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / spec.slug, spec)
        for spec in STEP_KNOWLEDGE_SPECS
    }
    cases = [json.loads(line) for line in (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8").splitlines()]

    for case in cases:
        if case["category"] != "semantic_paraphrase":
            continue
        target = case["target_entity_ids"][0]
        chunk_tokens = set(tokenize(bundles[case["stage"]].chunk_text(target)))
        assert len(set(tokenize(case["query"])) & chunk_tokens) >= 2


def test_alias_leak_check_ignores_aliases_without_tokens() -> None:
    aliases_leak = runpy.run_path(AGENT_ROOT / "scripts" / "build_knowledge_benchmark.py")["_aliases_leak"]
    assert not aliases_leak("Which phase prepares a cell netlist?", ("the",))
    assert aliases_leak("Which phase prepares a mapped gate netlist?", ("mapped gate",))


def test_frozen_benchmark_has_isolated_unique_coverage_and_manifest_dimensions() -> None:
    benchmark = (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8")
    cases = [json.loads(line) for line in benchmark.splitlines()]
    manifest = json.loads((BENCHMARK_ROOT / "manifest.v1.json").read_text(encoding="utf-8"))
    stage_ids = {spec.slug for spec in STEP_KNOWLEDGE_SPECS}
    target_splits: dict[str, set[str]] = {}

    assert len(cases) == 300
    assert len({case["query"].casefold() for case in cases}) == len(cases)
    for case in cases:
        targets = case["target_entity_ids"]
        target_groups = case.get("target_stage_entity_ids", [])
        assert len(target_groups) == len(targets)
        for target_group in target_groups:
            stage, _separator, _entity_id = target_group.partition(":")
            assert stage in stage_ids
            target_splits.setdefault(target_group, set()).add(case["split"])
    assert all(len(splits) == 1 for splits in target_splits.values())

    counts = Counter((case["stage"], case["language"], case["category"]) for case in cases)
    test_counts = Counter((case["stage"], case["language"], case["category"]) for case in cases if case["split"] == "test")
    for stage in stage_ids:
        assert counts[(stage, "en", "semantic_paraphrase")] >= 6
        assert counts[(stage, "zh", "semantic_paraphrase")] >= 6
        assert counts[(stage, "en", "identifier")] >= 4
        assert test_counts[(stage, "en", "semantic_paraphrase")] >= 3
        assert test_counts[(stage, "zh", "semantic_paraphrase")] >= 3
        assert test_counts[(stage, "en", "identifier")] >= 2

    categories = Counter(case["category"] for case in cases)
    no_answer_kinds = Counter(case.get("no_answer_kind") for case in cases if not case["answerable"])
    hard_pairs = Counter(case.get("hard_pair") for case in cases if case["category"] == "cross_stage")
    assert categories["cross_stage"] >= 48
    assert categories["no_answer"] >= 60
    assert no_answer_kinds["non_eda"] >= 20
    assert no_answer_kinds["other_eda"] >= 20
    assert no_answer_kinds["shared_generic"] >= 20
    assert hard_pairs["cts:synthesis"] >= 16
    assert hard_pairs["place:legalization"] >= 16
    assert hard_pairs["rcx:sta"] >= 16
    assert sum(case["language"] == "mixed" for case in cases) >= 24
    assert sum(len(case["target_entity_ids"]) > 1 for case in cases) >= 24
    assert any(case.get("ambiguous") and case["answerable"] for case in cases)

    counts_by_dimension = manifest["counts"]
    assert set(counts_by_dimension) == {"by_category", "by_language", "by_split", "by_stage", "by_split_language_category"}
    assert counts_by_dimension["by_stage"] == dict(sorted(Counter(case["stage"] for case in cases).items()))
    assert counts_by_dimension["by_split"] == dict(sorted(Counter(case["split"] for case in cases).items()))
    assert counts_by_dimension["by_language"] == dict(sorted(Counter(case["language"] for case in cases).items()))
    assert counts_by_dimension["by_category"] == dict(sorted(Counter(case["category"] for case in cases).items()))
    assert counts_by_dimension["by_split_language_category"] == dict(sorted(Counter(f"{case['split']}|{case['language']}|{case['category']}" for case in cases).items()))
    assert manifest["data_version"] == "ecos-knowledge-retrieval-benchmark.v1"
    assert manifest["generator_version"] == "ecos-knowledge-benchmark.v2"
    assert manifest["benchmark_sha256"] == hashlib.sha256(benchmark.encode("utf-8")).hexdigest()


def test_frozen_test_split_meets_the_lexical_retrieval_quality_gate(tmp_path: Path) -> None:
    output = tmp_path / "evaluation.json"
    subprocess.run(
        [
            "uv",
            "run",
            "python",
            "scripts/evaluate_knowledge_retrieval.py",
            "--aliases",
            "off",
            "--top-k",
            "3",
            "--output",
            str(output),
        ],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    evaluation = json.loads(output.read_text(encoding="utf-8"))
    assert evaluation["frozen_config"]["include_aliases"] is False
    test = evaluation["results"]["test"]["3"]

    assert test["overall"]["recall_at_3"] >= 0.95
    assert test["subsets"]["semantic_en"]["recall_at_3"] >= 0.90
    assert test["subsets"]["semantic_zh"]["recall_at_3"] >= 0.90
    assert test["subsets"]["no_answer"]["no_answer_false_positive_rate"] <= 0.05
