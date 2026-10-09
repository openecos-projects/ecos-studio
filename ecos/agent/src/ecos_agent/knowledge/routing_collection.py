#!/usr/bin/env python3
"""Collect bounded, hash-locked Codex stage-routing proposals for evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from ecos_agent.errors import ProposalProviderError
from ecos_agent.knowledge.contracts import StageRoutingProposal
from ecos_agent.knowledge.retriever import GlobalKnowledgeRetriever, load_production_retrieval_config
from ecos_agent.knowledge.step import load_default_step_knowledge


AGENT_ROOT = Path(__file__).parents[3]
BENCHMARK = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval" / "benchmark.v1.jsonl"
REPLAY_SCHEMA = "ecos-stage-routing-replay.v1"
AUDIT_SCHEMA = "ecos-stage-routing-collection-audit.v1"


def _query_sha256(query: str) -> str:
    return hashlib.sha256(query.encode("utf-8")).hexdigest()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_cases(benchmark: Path, split: str, limit: int) -> tuple[list[dict[str, object]], bytes]:
    raw = benchmark.read_bytes()
    cases = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
    selected = cases if split == "all" else [case for case in cases if case["split"] == split]
    if not selected:
        raise ValueError(f"benchmark split is empty: {split}")
    selected.sort(key=lambda case: _query_sha256(str(case["query"])))
    return selected[:limit], raw


def _collect(
    provider: Any,
    cases: list[dict[str, object]],
    stage_catalog: list[dict[str, str]],
    *,
    max_failures: int,
    attempts_per_case: int = 1,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    records: list[dict[str, object]] = []
    attempts: list[dict[str, object]] = []
    stage_ids = {item["stage"] for item in stage_catalog}
    consecutive_failures = 0
    for case in cases:
        query = str(case["query"])
        query_sha256 = _query_sha256(query)
        retry_failure_classes: list[str] = []
        proposal = None
        for attempt_count in range(1, attempts_per_case + 1):
            try:
                proposal = _proposal_for_case(provider, query, stage_catalog, stage_ids)
            except (ProposalProviderError, ValueError) as exc:
                retry_failure_classes.append(_failure_class(exc))
                continue
            break
        if proposal is None:
            consecutive_failures += 1
            attempts.append(
                _failed_attempt(
                    case,
                    query_sha256,
                    attempt_count=attempts_per_case,
                    retry_failure_classes=retry_failure_classes,
                )
            )
            if consecutive_failures >= max_failures:
                break
            continue
        consecutive_failures = 0
        record = {
            "schema_version": REPLAY_SCHEMA,
            "query_sha256": query_sha256,
            "candidate_stages": list(proposal.candidate_stages),
            "rationale": proposal.rationale,
        }
        records.append(record)
        attempts.append(
            {
                "case_id": case["id"],
                "query_sha256": query_sha256,
                "status": "accepted" if proposal.candidate_stages else "abstained",
                "candidate_stages": list(proposal.candidate_stages),
                "attempt_count": attempt_count,
                "retry_failure_classes": retry_failure_classes,
            }
        )
    return records, attempts


def _proposal_for_case(
    provider: Any,
    query: str,
    stage_catalog: list[dict[str, str]],
    stage_ids: set[str],
) -> StageRoutingProposal:
    provider.new_ephemeral_thread()
    proposal = StageRoutingProposal.model_validate(
        provider.propose_stage_routing(
            {"natural_language_request": query, "stage_catalog": stage_catalog}
        )
    )
    if any(stage not in stage_ids for stage in proposal.candidate_stages):
        raise ValueError("proposal contains an unpublished stage")
    return proposal


def _failure_class(exc: Exception) -> str:
    return exc.failure_class if isinstance(exc, ProposalProviderError) else "validation_error"


def _failed_attempt(
    case: dict[str, object],
    query_sha256: str,
    *,
    attempt_count: int,
    retry_failure_classes: list[str],
) -> dict[str, object]:
    return {
        "case_id": case["id"],
        "query_sha256": query_sha256,
        "status": "failed",
        "failure_class": retry_failure_classes[-1],
        "attempt_count": attempt_count,
        "retry_failure_classes": retry_failure_classes,
    }


def _write_atomic(path: Path, text: str) -> None:
    if not path.parent.is_dir():
        raise ValueError(f"output directory is unavailable: {path.parent}")
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def _new_output_path(path: Path) -> None:
    if path.exists():
        raise ValueError(f"refusing to overwrite existing artifact: {path}")


def _audit(
    args: argparse.Namespace,
    benchmark_bytes: bytes,
    retriever: GlobalKnowledgeRetriever,
    records: list[dict[str, object]],
    attempts: list[dict[str, object]],
    replay_path: Path,
    *,
    expected_cases: int,
) -> dict[str, object]:
    replay_bytes = replay_path.read_bytes()
    failed_cases = sum(attempt["status"] == "failed" for attempt in attempts)
    return {
        "schema_version": AUDIT_SCHEMA,
        "collected_at_utc": datetime.now(UTC).isoformat(),
        "collector": {
            "split": args.split,
            "max_cases": args.max_cases,
            "max_failures": args.max_failures,
            "attempts_per_case": args.attempts_per_case,
            "timeout_seconds": args.timeout_seconds,
            "fresh_thread_per_case": True,
            "web_search_enabled": False,
            "python": platform.python_version(),
        },
        "inputs": {
            "benchmark_path": str(BENCHMARK),
            "benchmark_sha256": _sha256(benchmark_bytes),
            "corpus_sha256": retriever.corpus_sha256,
        },
        "replay": {
            "path": str(replay_path),
            "sha256": _sha256(replay_bytes),
            "records": len(records),
        },
        "coverage": {
            "expected_cases": expected_cases,
            "attempted_cases": len(attempts),
            "failed_cases": failed_cases,
        },
        "attempts": attempts,
        "complete": len(attempts) == expected_cases and failed_cases == 0,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--audit-output", type=Path)
    parser.add_argument("--split", choices=("dev", "test", "all"), default="dev")
    parser.add_argument("--max-cases", type=int, default=20)
    parser.add_argument("--max-failures", type=int, default=3)
    parser.add_argument("--attempts-per-case", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    return parser.parse_args()


def main(provider_factory: Callable[..., Any]) -> int:
    args = _parse_args()
    if (
        not 1 <= args.max_cases <= 300
        or args.max_failures <= 0
        or not 1 <= args.attempts_per_case <= 3
        or not 1 <= args.timeout_seconds <= 60
    ):
        raise ValueError("collection limits are invalid")
    replay_path = args.output.resolve()
    audit_path = (args.audit_output or replay_path.with_suffix(".audit.v1.json")).resolve()
    _new_output_path(replay_path)
    _new_output_path(audit_path)
    cases, benchmark_bytes = _load_cases(BENCHMARK, args.split, args.max_cases)
    retriever = GlobalKnowledgeRetriever(
        load_default_step_knowledge(), config=load_production_retrieval_config()
    )
    provider = provider_factory(
        cwd=AGENT_ROOT,
        runtime_workspace_roots=(AGENT_ROOT,),
        timeout_seconds=args.timeout_seconds,
    )
    try:
        records, attempts = _collect(
            provider,
            cases,
            list(retriever.stage_catalog),
            max_failures=args.max_failures,
            attempts_per_case=args.attempts_per_case,
        )
    finally:
        provider.close()
    _write_atomic(replay_path, "".join(json.dumps(record, sort_keys=True) + "\n" for record in records))
    audit = _audit(
        args,
        benchmark_bytes,
        retriever,
        records,
        attempts,
        replay_path,
        expected_cases=len(cases),
    )
    _write_atomic(audit_path, json.dumps(audit, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"replay": str(replay_path), "records": len(records), "complete": audit["complete"]}))
    return 0 if audit["complete"] else 2
