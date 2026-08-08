#!/usr/bin/env python3
"""Evaluate frozen ECOS knowledge retrieval without GUI or network access."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import select
import shutil
import subprocess
import tempfile
import time
import tracemalloc
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from ecos_agent.knowledge_retriever import DEFAULT_RETRIEVAL_CONFIG, GlobalKnowledgeRetriever, RetrievalConfig
from ecos_agent.step_knowledge import load_default_step_knowledge


AGENT_ROOT = Path(__file__).parents[1]
BENCHMARK = AGENT_ROOT / "tests" / "data" / "knowledge_retrieval" / "benchmark.v1.jsonl"
_CONFIG_SCHEMA = "ecos-frozen-knowledge-retrieval-config.v1"
_WEIGHT_NAMES = ("stage", "identifier", "aliases", "content")
_PROTOCOL_QUERY = "RUDY指标是如何计算的？"


@dataclass(frozen=True)
class FrozenRetrievalConfig:
    include_aliases: bool
    retrieval: RetrievalConfig

    def contract(self) -> dict[str, object]:
        return self.retrieval.contract(include_aliases=self.include_aliases)


@dataclass(frozen=True)
class CaseOutcome:
    case: dict[str, object]
    answer_ids: tuple[str, ...]
    latency_ms: float
    grounding: bool
    attribution: bool
    audited_fallback: bool


def _sha256(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _rank(answer_ids: tuple[str, ...], targets: list[str]) -> int | None:
    return next((index for index, entity_id in enumerate(answer_ids, 1) if entity_id in targets), None)


def _percentile(samples: list[float], percentile: float) -> float:
    return samples[round((len(samples) - 1) * percentile)] if samples else 0.0


def _case_stages(case: dict[str, object]) -> tuple[str, ...]:
    if not case["answerable"]:
        return ("no_answer",)
    entity_ids = case["required_evidence"] or case["target_entity_ids"]
    return tuple(sorted({str(entity_id).split(".")[1] for entity_id in entity_ids}))


def _answer_checks(answer: object) -> tuple[tuple[str, ...], bool, bool]:
    if answer is None:
        return (), False, False
    answer_ids = tuple(answer.entity_ids)
    contract = answer.contract
    matches = contract.get("matches")
    sources = contract.get("source_ids")
    if not isinstance(matches, list) or not isinstance(sources, list):
        return answer_ids, False, False
    match_ids = tuple(match.get("entity_id") for match in matches if isinstance(match, dict))
    grounded = (
        contract.get("schema_version") == "ecos-knowledge-answer.v2"
        and contract.get("read_only") is True
        and answer_ids == match_ids
        and all(
            isinstance(match, dict)
            and match.get("rank") == index
            and isinstance(match.get("chunk_sha256"), str)
            and bool(match["chunk_sha256"])
            for index, match in enumerate(matches, 1)
        )
    )
    attributed = grounded and all(
        isinstance(match.get("source_ids"), list)
        and bool(match["source_ids"])
        and set(match["source_ids"]).issubset(sources)
        for match in matches
        if isinstance(match, dict)
    )
    return answer_ids, grounded, attributed


def _evaluate_cases(cases: list[dict[str, object]], frozen: FrozenRetrievalConfig) -> list[CaseOutcome]:
    retriever = GlobalKnowledgeRetriever(
        load_default_step_knowledge(),
        include_aliases=frozen.include_aliases,
        config=frozen.retrieval,
    )
    outcomes: list[CaseOutcome] = []
    for case in cases:
        started = time.perf_counter()
        answer = retriever.reply(str(case["query"]))
        latency_ms = (time.perf_counter() - started) * 1000
        answer_ids, grounding, attribution = _answer_checks(answer)
        audited_fallback = (
            (answer is None and not case["answerable"])
            or (answer is not None and grounding and attribution)
        )
        outcomes.append(CaseOutcome(case, answer_ids, latency_ms, grounding, attribution, audited_fallback))
    return outcomes


def _rate(values: list[bool]) -> float:
    return sum(values) / len(values) if values else 0.0


def _metrics(outcomes: list[CaseOutcome]) -> dict[str, float | int | dict[str, float]]:
    answerable = [outcome for outcome in outcomes if outcome.case["answerable"]]
    ranks = [_rank(outcome.answer_ids, list(outcome.case["target_entity_ids"])) for outcome in answerable]
    latencies = sorted(outcome.latency_ms for outcome in answerable)
    no_answer = [outcome for outcome in outcomes if not outcome.case["answerable"]]
    resolved = [outcome for outcome in answerable if outcome.answer_ids]
    required = [
        set(outcome.case["required_evidence"]).issubset(outcome.answer_ids)
        for outcome in answerable
    ]
    denominator = len(ranks) or 1
    return {
        "cases": len(outcomes),
        "recall_at_1": sum(rank == 1 for rank in ranks) / denominator,
        "recall_at_3": sum(rank is not None and rank <= 3 for rank in ranks) / denominator,
        "recall_at_5": sum(rank is not None and rank <= 5 for rank in ranks) / denominator,
        "mrr": sum(1 / rank if rank else 0 for rank in ranks) / denominator,
        "ndcg_at_3": sum(1 / math.log2(rank + 1) if rank and rank <= 3 else 0 for rank in ranks) / denominator,
        "no_answer_false_positive_rate": _rate([bool(outcome.answer_ids) for outcome in no_answer]),
        "latency_ms_p50": _percentile(latencies, 0.50),
        "latency_ms_p95": _percentile(latencies, 0.95),
        "quality": {
            "required_evidence_all_recall": _rate(required),
            "grounding_coverage": _rate([bool(outcome.answer_ids) for outcome in answerable]),
            "grounding_pass_rate": _rate([outcome.grounding for outcome in resolved]),
            "attribution_pass_rate": _rate([outcome.attribution for outcome in resolved]),
            "audited_fallback_pass_rate": _rate([outcome.audited_fallback for outcome in [*resolved, *no_answer]]),
        },
    }


def _breakdowns(outcomes: list[CaseOutcome]) -> dict[str, dict[str, dict[str, float | int | dict[str, float]]]]:
    def groups(key: str) -> dict[str, list[CaseOutcome]]:
        result: dict[str, list[CaseOutcome]] = {}
        for outcome in outcomes:
            values = _case_stages(outcome.case) if key == "stage" else (str(outcome.case[key]),)
            for value in values:
                result.setdefault(value, []).append(outcome)
        return result

    return {key: {value: _metrics(items) for value, items in groups(key).items()} for key in ("language", "category", "stage")}


def _failure_report(outcomes: list[CaseOutcome]) -> dict[str, object]:
    failures = []
    for outcome in outcomes:
        case = outcome.case
        if not case["answerable"]:
            continue
        required = set(case["required_evidence"])
        missing = sorted(required.difference(outcome.answer_ids))
        if missing:
            failures.append(
                {
                    "id": case["id"],
                    "language": case["language"],
                    "category": case["category"],
                    "stages": list(_case_stages(case)),
                    "required_evidence": sorted(required),
                    "returned_entity_ids": list(outcome.answer_ids),
                    "missing_required_evidence": missing,
                }
            )
    return {"required_evidence": failures[:20], "truncated": len(failures) > 20, "total": len(failures)}


def _result_for_split(cases: list[dict[str, object]], frozen: FrozenRetrievalConfig) -> dict[str, object]:
    outcomes = _evaluate_cases(cases, frozen)
    semantic_en = [outcome for outcome in outcomes if outcome.case["category"] == "semantic_paraphrase" and outcome.case["language"] == "en"]
    semantic_zh = [outcome for outcome in outcomes if outcome.case["category"] == "semantic_paraphrase" and outcome.case["language"] == "zh"]
    no_answer = [outcome for outcome in outcomes if outcome.case["category"] == "no_answer"]
    metrics = _metrics(outcomes)
    return {
        "overall": metrics,
        "quality": metrics["quality"],
        "subsets": {"semantic_en": _metrics(semantic_en), "semantic_zh": _metrics(semantic_zh), "no_answer": _metrics(no_answer)},
        "breakdowns": _breakdowns(outcomes),
        "failures": _failure_report(outcomes),
    }


def _read_config(path: Path | None, args: argparse.Namespace) -> FrozenRetrievalConfig:
    raw: dict[str, object] = {}
    if path:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid frozen retrieval config: {path}") from exc
        if not isinstance(raw, dict) or raw.get("schema_version") != _CONFIG_SCHEMA:
            raise ValueError(f"frozen retrieval config must use {_CONFIG_SCHEMA}")
    unknown = set(raw) - {"schema_version", "include_aliases", *RetrievalConfig.__dataclass_fields__}
    if unknown:
        raise ValueError(f"unknown frozen retrieval config fields: {', '.join(sorted(unknown))}")
    include_aliases = raw.get("include_aliases", True)
    if not isinstance(include_aliases, bool):
        raise ValueError("frozen retrieval include_aliases must be boolean")
    values = {name: raw.get(name, getattr(DEFAULT_RETRIEVAL_CONFIG, name)) for name in RetrievalConfig.__dataclass_fields__}
    if isinstance(values["field_weights"], list):
        values["field_weights"] = tuple(values["field_weights"])
    if args.aliases:
        include_aliases = args.aliases == "on"
    if args.top_k:
        values["top_k"] = args.top_k
    if args.field_weights:
        values["field_weights"] = tuple(args.field_weights)
    try:
        return FrozenRetrievalConfig(include_aliases, RetrievalConfig(**values))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid frozen retrieval config: {exc}") from exc


def _load_cases(split: str) -> list[dict[str, object]]:
    marker = f'"split": "{split}"'
    return [json.loads(line) for line in BENCHMARK.read_text(encoding="utf-8").splitlines() if marker in line]


def _selection_key(result: dict[str, object], config: FrozenRetrievalConfig) -> tuple[float, float, float, str]:
    overall = result["overall"]
    quality = overall["quality"]
    return (
        -float(quality["required_evidence_all_recall"]),
        -float(overall["recall_at_3"]),
        -float(overall["mrr"]),
        json.dumps(config.contract(), sort_keys=True, separators=(",", ":")),
    )


def _select_dev_config(paths: list[Path], args: argparse.Namespace) -> dict[str, object]:
    if not paths:
        raise ValueError("--select-dev-config requires one or more --config files")
    if args.aliases or args.top_k or args.field_weights:
        raise ValueError("--select-dev-config accepts only explicit frozen --config files")
    dev_cases = _load_cases("dev")
    evaluated = []
    seen: set[str] = set()
    for path in paths:
        config = _read_config(path, args)
        frozen_json = json.dumps(config.contract(), sort_keys=True, separators=(",", ":"))
        if frozen_json in seen:
            raise ValueError("--select-dev-config has duplicate frozen configs")
        seen.add(frozen_json)
        result = _result_for_split(dev_cases, config)
        evaluated.append((config, result, frozen_json))
    fpr_limit = 0.05
    eligible = [
        item
        for item in evaluated
        if float(item[1]["overall"]["no_answer_false_positive_rate"]) <= fpr_limit
    ]
    selected = min(eligible, key=lambda item: _selection_key(item[1], item[0])) if eligible else None
    candidates = [
        {
            "config_sha256": _sha256(config.contract()),
            "frozen_config": config.contract(),
            "metrics": result["overall"],
            "eligible": (float(result["overall"]["no_answer_false_positive_rate"]) <= fpr_limit),
            "required_evidence_failures": result["failures"]["total"],
        }
        for config, result, _frozen_json in evaluated
    ]
    return {
        "evaluation_split": "dev",
        "selection_rule": "no-answer FPR <= 0.05, then max required evidence recall, recall@3, MRR, canonical config",
        "no_answer_fpr_limit": fpr_limit,
        "test_cases_evaluated": 0,
        "candidates": candidates,
        "selected": None if selected is None else {
            "config_sha256": _sha256(selected[0].contract()),
            "frozen_config": selected[0].contract(),
            "frozen_config_json": selected[2],
        },
    }


def _protocol_lines(process: subprocess.Popen[bytes], request_id: str, records: list[dict[str, object]]) -> dict[str, object]:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.stdout is None:
            break
        ready, _, _ = select.select([process.stdout], [], [], 0.2)
        if not ready:
            if process.poll() is not None:
                break
            continue
        line = process.stdout.readline().decode("utf-8")
        if not line:
            break
        payload = json.loads(line)
        records.append(payload)
        if payload.get("id") == request_id:
            return payload
    raise RuntimeError(f"provider did not respond to {request_id}")


def _write_request(process: subprocess.Popen[bytes], payload: dict[str, object]) -> None:
    if process.stdin is None:
        raise RuntimeError("provider stdin is unavailable")
    process.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
    process.stdin.flush()


def _run_protocol(binary: Path) -> tuple[dict[str, object], float, int]:
    strace = shutil.which("strace")
    if not strace:
        raise RuntimeError("strace is required for headless no-network evidence")
    with tempfile.TemporaryDirectory(prefix="ecos-agent-audit-") as directory:
        trace_path = Path(directory) / "network.trace"
        environment = dict(os.environ)
        environment.update({"ECOS_AGENT_CODEX_BIN": "/nonexistent/ecos-agent-codex", "ECOS_AGENT_CODEX_WEB_SEARCH": "0"})
        process = subprocess.Popen(
            [strace, "-qq", "-f", "-e", "trace=network", "-o", str(trace_path), str(binary)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            bufsize=0,
            env=environment,
        )
        records: list[dict[str, object]] = []
        started = time.perf_counter()
        _write_request(process, {"id": "start-1", "method": "startSession", "params": {"mode": "home"}})
        started_session = _protocol_lines(process, "start-1", records)
        result = started_session.get("result")
        session_id = result.get("sessionId") if isinstance(result, dict) else None
        if not isinstance(session_id, str) or not session_id:
            raise RuntimeError("provider did not return a session ID")
        startup_ms = (time.perf_counter() - started) * 1000
        _write_request(process, {"id": "message-1", "method": "sendMessage", "params": {"sessionId": session_id, "message": _PROTOCOL_QUERY}})
        _protocol_lines(process, "message-1", records)
        if process.stdin is not None:
            process.stdin.close()
        process.wait(timeout=20)
        if process.returncode:
            raise RuntimeError(f"provider protocol exited with {process.returncode}")
        connect_calls = trace_path.read_text(encoding="utf-8").count("connect(")
    answer = next(
        (record["event"]["contract"] for record in records if record.get("type") == "event" and isinstance(record.get("event"), dict) and isinstance(record["event"].get("contract"), dict)),
        None,
    )
    if not isinstance(answer, dict):
        raise RuntimeError("provider did not emit a knowledge-answer contract")
    return answer, startup_ms, connect_calls


def _headless_runtime(binary: Path) -> dict[str, object]:
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError(f"provider binary is not executable: {binary}")
    first, startup_ms, connect_calls = _run_protocol(binary)
    second, _second_startup_ms, second_connect_calls = _run_protocol(binary)
    retrieval = first.get("retrieval")
    fts5 = isinstance(retrieval, dict) and retrieval.get("backend") == "sqlite_fts5_bm25"
    return {
        "provider_startup_ms": startup_ms,
        "binary": {"path": str(binary), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "size_bytes": binary.stat().st_size},
        "network": {"method": "strace-network", "connect_calls": connect_calls + second_connect_calls, "web_search_enabled": False},
        "protocol": {"transport": "jsonl-stdio", "fts5": fts5, "codex_fallback": first.get("schema_version") == "ecos-knowledge-answer.v2" and fts5},
        "replay_trace": {"query_sha256": _sha256(_PROTOCOL_QUERY), "contract_sha256": _sha256(first), "contracts_identical": first == second},
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--config", type=Path, action="extend", nargs="+", help="frozen retrieval config JSON")
    parser.add_argument("--select-dev-config", action="store_true")
    parser.add_argument("--aliases", choices=("on", "off"))
    parser.add_argument("--top-k", type=int, choices=(3, 5, 8))
    parser.add_argument("--field-weights", type=float, nargs=4, metavar=_WEIGHT_NAMES)
    parser.add_argument("--provider-binary", type=Path, help="headless PyInstaller provider binary")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    tracemalloc.start()
    if args.select_dev_config:
        payload: dict[str, object] = {
            "schema_version": "ecos-knowledge-retrieval-evaluation.v2",
            "dev_config_selection": _select_dev_config(args.config or [], args),
        }
    else:
        if args.config and len(args.config) != 1:
            raise ValueError("evaluation accepts exactly one --config; use --select-dev-config for a grid")
        frozen = _read_config(args.config[0] if args.config else None, args)
        sweep = (frozen,) if args.config or args.aliases or args.top_k or args.field_weights else tuple(FrozenRetrievalConfig(True, replace(DEFAULT_RETRIEVAL_CONFIG, top_k=top_k)) for top_k in (3, 5, 8))
        splits = ("test",) if args.config else ("dev", "test")
        results = {split: {str(config.retrieval.top_k): _result_for_split(_load_cases(split), config) for config in sweep} for split in splits}
        payload = {
            "schema_version": "ecos-knowledge-retrieval-evaluation.v2",
            "results": results,
            "evaluated_configs": {str(config.retrieval.top_k): config.contract() for config in sweep},
        }
        if len(sweep) == 1:
            payload["frozen_config"] = sweep[0].contract()
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    payload["peak_bytes"] = peak
    if args.provider_binary:
        runtime = _headless_runtime(args.provider_binary)
        runtime["peak_bytes"] = peak
        payload["headless_runtime"] = runtime
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
