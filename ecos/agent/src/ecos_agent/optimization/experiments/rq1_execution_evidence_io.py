"""Persisted-episode loading for the RQ1 execution-evidence analyzer."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.experiments.rq1_execution_evidence import analyze_records
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerManifest,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationTerminalOutcome,
)

def _diagnostic_metrics(path: Path) -> dict[str, Any]:
    usage = Counter()
    errors = Counter()
    if not path.is_file():
        return {"usage": {}, "errors": {}, "available": False}
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            errors["record_format"] += 1
            continue
        if not isinstance(row, Mapping):
            errors["record_format"] += 1
            continue
        raw_usage = row.get("usage") or row.get("token_usage") or row.get("tokenUsage")
        if isinstance(raw_usage, Mapping):
            aliases = {
                "input_tokens": ("input_tokens", "inputTokens"),
                "output_tokens": ("output_tokens", "outputTokens"),
                "total_tokens": ("total_tokens", "totalTokens"),
            }
            for key, names in aliases.items():
                for name in names:
                    value = raw_usage.get(name)
                    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                        usage[key] += value
                        break
        error = row.get("error") or row.get("failure")
        if error:
            errors["provider"] += 1
        for key in ("schema_error", "schema_errors", "validation_error", "repair", "repairs"):
            value = row.get(key)
            if isinstance(value, int) and not isinstance(value, bool):
                errors["schema" if "schema" in key or "validation" in key else "repair"] += value
    return {"usage": dict(usage), "errors": dict(errors), "available": True}


def _episode_run_metrics(root: Path, provider_calls: int) -> dict[str, Any]:
    metrics_root = root
    if root.parent.name == "optimization" and root.parent.parent.name == ".agent":
        workspace = root.parent.parent.parent
        if workspace.parent.name == "workspaces":
            report_root = (
                workspace.parent.parent / "reports" / workspace.name / root.name
            )
            if report_root.is_dir():
                metrics_root = report_root
    summary_path = metrics_root / "episode-summary.v1.json"
    summary: Mapping[str, Any] = {}
    if summary_path.is_file():
        try:
            loaded = json.loads(summary_path.read_text(encoding="utf-8"))
            if isinstance(loaded, Mapping):
                summary = loaded
        except (OSError, json.JSONDecodeError):
            summary = {}
    budget = summary.get("budget") if isinstance(summary.get("budget"), Mapping) else {}
    diagnostics = _diagnostic_metrics(metrics_root / "codex-diagnostics.jsonl")
    comparisons = (
        summary.get("metric_comparison", {}).get("metrics", {})
        if isinstance(summary.get("metric_comparison"), Mapping)
        else {}
    )
    route_comparison = (
        comparisons.get("route_wirelength")
        if isinstance(comparisons.get("route_wirelength"), Mapping)
        else {}
    )
    return {
        "planning_calls": provider_calls,
        "wall_time_seconds": budget.get("elapsed_wall_time_seconds"),
        "token_usage": diagnostics["usage"],
        "provider_errors": diagnostics["errors"].get("provider", 0),
        "schema_errors": diagnostics["errors"].get("schema", 0),
        "repair_errors": diagnostics["errors"].get("repair", 0),
        "summary_planning_calls": summary.get("planning_calls"),
        "summary_available": bool(summary),
        "route_wirelength_best": route_comparison.get("best"),
        "route_wirelength_reference": route_comparison.get("reference"),
    }

def analyze_episode(root: Path) -> dict[str, Any]:
    ledger = OptimizationLedger(root)
    replay = ledger.verify()
    integrity: dict[str, Any] = {"ledger": "passed", "audits": {}}
    manifest_path = root / "optimization-ledger-manifest.v1.json"
    if manifest_path.exists():
        manifest = OptimizationLedgerManifest.model_validate_json(manifest_path.read_bytes())
        ledger.verify_manifest(manifest)
    provider_replay = None
    for name, factory in (
        ("decision", OptimizationDecisionAudit),
        ("planning", OptimizationPlanningAudit),
        ("provider", OptimizationPlanningProviderEvidenceAudit),
    ):
        integrity["audits"][name] = "passed"
        verified = factory(root).verify()
        if name == "provider":
            provider_replay = verified
    provider_calls = len(provider_replay.entries) if provider_replay is not None else 0
    run_metrics = _episode_run_metrics(root, provider_calls)
    if run_metrics["summary_planning_calls"] is not None:
        integrity["summary_cross_check"] = {
            "planning_calls": run_metrics["summary_planning_calls"],
            "provider_audit_calls": provider_calls,
            "match": run_metrics["summary_planning_calls"] == provider_calls,
        }
    starts = [entry.payload for entry in replay.entries if isinstance(entry.payload, OptimizationInterventionStart)]
    outcomes = [entry.payload for entry in replay.entries if isinstance(entry.payload, OptimizationTerminalOutcome)]
    return analyze_records(starts, outcomes, integrity=integrity, strict=True, planning_calls=provider_calls, run_metrics=run_metrics)
