from __future__ import annotations

import json
import subprocess
from collections import Counter
from pathlib import Path

from ecos_agent.knowledge_retriever import tokenize
from ecos_agent.step_knowledge import STEP_KNOWLEDGE_SPECS, StepKnowledge


AGENT_ROOT = Path(__file__).parents[1]
BENCHMARK_ROOT = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval"


def test_frozen_benchmark_is_current_and_meets_test_minimums() -> None:
    subprocess.run(["uv", "run", "python", "scripts/build_knowledge_benchmark.py", "--check"], cwd=AGENT_ROOT, check=True, capture_output=True, text=True)
    cases = [json.loads(line) for line in (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8").splitlines()]
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
            assert all(not set(tokenize(alias)) <= query_tokens for alias in aliases[entity_id])


def test_frozen_test_split_meets_the_lexical_retrieval_quality_gate(tmp_path: Path) -> None:
    output = tmp_path / "evaluation.json"
    subprocess.run(
        ["uv", "run", "python", "scripts/evaluate_knowledge_retrieval.py", "--output", str(output)],
        cwd=AGENT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    test = json.loads(output.read_text(encoding="utf-8"))["results"]["test"]["3"]

    assert test["overall"]["recall_at_3"] >= 0.95
    assert test["subsets"]["semantic_en"]["recall_at_3"] >= 0.90
    assert test["subsets"]["semantic_zh"]["recall_at_3"] >= 0.90
    assert test["subsets"]["no_answer"]["no_answer_false_positive_rate"] <= 0.05
