from __future__ import annotations

import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from ecos_agent.knowledge.retriever import tokenize
from ecos_agent.knowledge.benchmark import _aliases_leak
from ecos_agent.knowledge import routing_collection
from ecos_agent.knowledge.step import STEP_KNOWLEDGE_SPECS, StepKnowledge
from tests.paths import AGENT_ROOT


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
    aliases = json.loads((BENCHMARK_ROOT / "legacy-alias-terms.v1.json").read_text(encoding="utf-8"))["terms"]
    cases = [json.loads(line) for line in (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8").splitlines()]

    for case in cases:
        if not case["forbidden_alias_overlap"]:
            continue
        query_tokens = set(tokenize(case["query"]))
        for stage_entity_id in case["target_stage_entity_ids"]:
            assert all(
                not (alias_tokens and alias_tokens <= query_tokens)
                for alias in aliases[stage_entity_id]
                for alias_tokens in (set(tokenize(alias)),)
            )


def test_semantic_cases_share_target_chunk_vocabulary() -> None:
    bundles = {
        spec.slug: StepKnowledge.from_directory(AGENT_ROOT / "knowledge" / "tool" / spec.slug, spec)
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
    assert not _aliases_leak("Which phase prepares a cell netlist?", ("the",))
    assert _aliases_leak("Which phase prepares a mapped gate netlist?", ("mapped gate",))


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
    test = evaluation["results"]["test"]["3"]

    assert test["overall"]["recall_at_3"] >= 0.95
    assert test["subsets"]["semantic_en"]["recall_at_3"] >= 0.90
    assert test["subsets"]["semantic_zh"]["recall_at_3"] >= 0.90
    assert test["subsets"]["no_answer"]["no_answer_false_positive_rate"] <= 0.05


def test_ablation_suite_replays_hash_locked_stage_proposals(tmp_path: Path) -> None:
    cases = [
        json.loads(line)
        for line in (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    case = next(item for item in cases if item["split"] == "test" and item["stage"] == "place")
    replay = tmp_path / "routing-proposals.v1.jsonl"
    replay.write_text(
        json.dumps(
            {
                "schema_version": "ecos-stage-routing-replay.v1",
                "query_sha256": hashlib.sha256(case["query"].encode("utf-8")).hexdigest(),
                "candidate_stages": ["place"],
                "rationale": "offline replay",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "ablation.json"

    subprocess.run(
        [
            "uv",
            "run",
            "python",
            "scripts/evaluate_knowledge_retrieval.py",
            "--ablation-suite",
            "--ablation-split",
            "test",
            "--routing-proposals",
            str(replay),
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
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert set(payload["ablation"]) == {"test"}
    test = payload["ablation"]["test"]
    assert set(test["strategies"]) == {
        "global_bm25",
        "deterministic_scope_bm25",
        "codex_hard_filter",
        "hybrid_union",
    }
    assert test["routing_replay"]["sha256"] == hashlib.sha256(replay.read_bytes()).hexdigest()
    assert test["strategies"]["hybrid_union"]["overall"]["unsafe_exclusion_rate"] == 0.0
    assert {"query_sha256", "candidate_stages", "final_entity_ids"} <= set(test["traces"][0])


def test_stage_routing_collector_uses_only_query_and_audited_catalog() -> None:
    cases = [
        json.loads(line)
        for line in (BENCHMARK_ROOT / "benchmark.v1.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    case = next(item for item in cases if item["split"] == "dev")
    contexts: list[dict[str, object]] = []

    class FakeProvider:
        codex_bin = "codex-fake"

        def new_ephemeral_thread(self) -> None:
            return None

        def propose_stage_routing(self, context: dict[str, object]) -> dict[str, object]:
            contexts.append(context)
            return {
                "schema_version": "flow-agent.stage_routing_proposal.v1",
                "scope": "in_scope",
                "candidate_stages": ["place"],
                "rationale": "test routing",
            }

    records, attempts = routing_collection._collect(
        FakeProvider(),
        [case],
        [{"stage": "place", "summary": "Audited placement stage.", "chunk_sha256": "a" * 64}],
        max_failures=1,
    )

    assert records[0]["query_sha256"] == hashlib.sha256(case["query"].encode("utf-8")).hexdigest()
    assert attempts[0]["status"] == "accepted"
    assert set(contexts[0]) == {"natural_language_request", "stage_catalog"}
    assert "target_entity_ids" not in str(contexts[0])


def test_stage_routing_collector_audit_rejects_failed_or_partial_collection(tmp_path: Path) -> None:
    replay = tmp_path / "routing-proposals.v1.jsonl"
    replay.write_text("", encoding="utf-8")
    audit = routing_collection._audit(
        SimpleNamespace(
            split="dev", max_cases=2, max_failures=1, attempts_per_case=2, timeout_seconds=30
        ),
        b"benchmark",
        SimpleNamespace(corpus_sha256="a" * 64),
        [],
        [
            {
                "case_id": "case-1",
                "query_sha256": "b" * 64,
                "status": "failed",
                "failure_class": "timeout",
            }
        ],
        replay,
        expected_cases=2,
    )

    assert audit["complete"] is False
    assert audit["coverage"] == {"expected_cases": 2, "attempted_cases": 1, "failed_cases": 1}


def test_stage_routing_collector_counts_only_consecutive_failures() -> None:
    responses: list[object] = [
        ValueError("first failure"),
        {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": [],
            "rationale": "abstain",
        },
        ValueError("second failure"),
        {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": [],
            "rationale": "abstain",
        },
    ]

    class FakeProvider:
        def new_ephemeral_thread(self) -> None:
            return None

        def propose_stage_routing(self, _context: dict[str, object]) -> dict[str, object]:
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

    cases = [{"id": f"case-{index}", "query": f"query-{index}"} for index in range(4)]
    records, attempts = routing_collection._collect(
        FakeProvider(),
        cases,
        [{"stage": "place", "summary": "Audited placement stage.", "chunk_sha256": "a" * 64}],
        max_failures=2,
    )

    assert len(records) == 2
    assert [attempt["status"] for attempt in attempts] == ["failed", "abstained", "failed", "abstained"]


def test_stage_routing_collector_retries_a_transient_case_failure() -> None:
    responses: list[object] = [
        ValueError("transient failure"),
        {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": ["place"],
            "rationale": "placement question",
        },
    ]

    class FakeProvider:
        def __init__(self) -> None:
            self.thread_starts = 0

        def new_ephemeral_thread(self) -> None:
            self.thread_starts += 1

        def propose_stage_routing(self, _context: dict[str, object]) -> dict[str, object]:
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

    provider = FakeProvider()
    records, attempts = routing_collection._collect(
        provider,
        [{"id": "case-1", "query": "query-1"}],
        [{"stage": "place", "summary": "Audited placement stage.", "chunk_sha256": "a" * 64}],
        max_failures=1,
        attempts_per_case=2,
    )

    assert records[0]["candidate_stages"] == ["place"]
    assert provider.thread_starts == 2
    assert attempts == [
        {
            "case_id": "case-1",
            "query_sha256": hashlib.sha256(b"query-1").hexdigest(),
            "status": "accepted",
            "candidate_stages": ["place"],
            "attempt_count": 2,
            "retry_failure_classes": ["validation_error"],
        }
    ]
