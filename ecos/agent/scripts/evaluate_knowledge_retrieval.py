#!/usr/bin/env python3
"""Evaluate the frozen ECOS knowledge retrieval benchmark without network access."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import tracemalloc
from pathlib import Path

from ecos_agent.knowledge_retriever import GlobalKnowledgeRetriever
from ecos_agent.step_knowledge import load_default_step_knowledge


AGENT_ROOT = Path(__file__).parents[1]
BENCHMARK = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval" / "benchmark.v1.jsonl"


def _rank(answer_ids: tuple[str, ...], targets: list[str]) -> int | None:
    return next((index for index, entity_id in enumerate(answer_ids, start=1) if entity_id in targets), None)


def _percentile(samples: list[float], percentile: float) -> float:
    if not samples:
        return 0.0
    return samples[round((len(samples) - 1) * percentile)]


def _metrics(cases: list[dict[str, object]], top_k: int) -> dict[str, float | int]:
    retriever = GlobalKnowledgeRetriever(load_default_step_knowledge(), top_k=top_k)
    answerable = [case for case in cases if case["answerable"]]
    no_answer = [case for case in cases if not case["answerable"]]
    latencies: list[float] = []
    ranks: list[int | None] = []
    for case in answerable:
        started = time.perf_counter()
        answer = retriever.reply(str(case["query"]))
        latencies.append((time.perf_counter() - started) * 1000)
        ranks.append(_rank(answer.entity_ids if answer else (), list(case["target_entity_ids"])))
    false_positives = sum(retriever.reply(str(case["query"])) is not None for case in no_answer)
    latencies.sort()
    recall_denominator = len(ranks) or 1
    return {
        "cases": len(cases),
        "recall_at_1": sum(rank == 1 for rank in ranks) / recall_denominator,
        "recall_at_3": sum(rank is not None and rank <= 3 for rank in ranks) / recall_denominator,
        "recall_at_5": sum(rank is not None and rank <= 5 for rank in ranks) / recall_denominator,
        "mrr": statistics.fmean(1 / rank if rank else 0 for rank in ranks) if ranks else 0.0,
        "ndcg_at_3": statistics.fmean(1 / math.log2(rank + 1) if rank and rank <= 3 else 0 for rank in ranks) if ranks else 0.0,
        "no_answer_false_positive_rate": false_positives / len(no_answer) if no_answer else 0.0,
        "latency_ms_p50": _percentile(latencies, 0.50),
        "latency_ms_p95": _percentile(latencies, 0.95),
    }


def _result_for_split(cases: list[dict[str, object]], top_k: int) -> dict[str, object]:
    semantic_en = [case for case in cases if case["category"] == "semantic_paraphrase" and case["language"] == "en"]
    semantic_zh = [case for case in cases if case["category"] == "semantic_paraphrase" and case["language"] == "zh"]
    no_answer = [case for case in cases if case["category"] == "no_answer"]
    return {
        "overall": _metrics(cases, top_k),
        "subsets": {
            "semantic_en": _metrics(semantic_en, top_k),
            "semantic_zh": _metrics(semantic_zh, top_k),
            "no_answer": _metrics(no_answer, top_k),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    cases = [json.loads(line) for line in BENCHMARK.read_text(encoding="utf-8").splitlines()]
    tracemalloc.start()
    results = {
        split: {
            str(top_k): _result_for_split(
                [case for case in cases if case["split"] == split], top_k
            )
            for top_k in (3, 5, 8)
        }
        for split in ("dev", "test")
    }
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    payload = {"schema_version": "ecos-knowledge-retrieval-evaluation.v1", "peak_bytes": peak, "results": results}
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
