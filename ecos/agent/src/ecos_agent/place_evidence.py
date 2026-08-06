"""Build bounded, read-only Placement evidence from an ECOS workspace."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ecos_agent.hashing import artifact_fingerprint
from ecos_agent.place_contracts import PlaceArtifact, PlaceEvidence


_FILES = (
    "home/flow.json",
    "config/dreamplace.json",
    "place_dreamplace/analysis/qor_metrics.json",
    "legalization_dreamplace/analysis/qor_metrics.json",
)
_METRICS = frozenset(
    {
        "place_hpwl",
        "place_grwl",
        "place_flute_wirelength",
        "place_congestion_egr_overflow_total",
        "place_congestion_egr_overflow_max",
        "place_rudy_utilization_max",
        "place_lutrudy_utilization_max",
    }
)


def build_place_evidence(workspace: Path) -> PlaceEvidence:
    root = workspace.expanduser().resolve()
    if not root.is_dir() or root.is_symlink():
        raise ValueError("workspace evidence root is invalid")
    payloads = {relative: _read_json(root, relative) for relative in _FILES}
    artifacts = [
        PlaceArtifact(relative_path=relative, fingerprint=artifact_fingerprint(root / relative))
        for relative, payload in payloads.items()
        if payload is not None
    ]
    flow = payloads["home/flow.json"]
    config = payloads["config/dreamplace.json"]
    return PlaceEvidence(
        workspace_id=root.name,
        step_status=_step_status(flow),
        effective_config=_config(config),
        metrics=_metrics(payloads),
        artifacts=artifacts,
        findings=_findings(flow, payloads),
    )


def _read_json(root: Path, relative: str) -> Any | None:
    path = _safe_file(root, relative)
    if path is None:
        return None
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("workspace evidence file exceeds the read limit")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("workspace evidence JSON is invalid") from exc


def _safe_file(root: Path, relative: str) -> Path | None:
    current = root
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("workspace evidence path escapes through a symlink")
    if not current.is_file():
        return None
    try:
        current.resolve().relative_to(root)
    except ValueError as exc:
        raise ValueError("workspace evidence path escapes its root") from exc
    return current


def _step_status(flow: Any) -> dict[str, str]:
    if not isinstance(flow, dict) or not isinstance(flow.get("steps"), list):
        return {}
    return {
        item["name"]: item["state"]
        for item in flow["steps"]
        if isinstance(item, dict)
        and item.get("name") in {"place", "legalization"}
        and isinstance(item.get("state"), str)
    }


def _config(config: Any) -> dict[str, object]:
    if not isinstance(config, dict):
        return {}
    return {key: config[key] for key in sorted(config) if isinstance(config[key], (str, int, float, bool))}


def _metrics(payloads: dict[str, Any | None]) -> dict[str, float]:
    values: dict[str, float] = {}
    for payload in payloads.values():
        if not isinstance(payload, dict) or not isinstance(payload.get("metrics"), list):
            continue
        for metric in payload["metrics"]:
            if not isinstance(metric, dict) or metric.get("id") not in _METRICS:
                continue
            value = metric.get("value")
            if type(value) in {int, float} and math.isfinite(value):
                values[metric["id"]] = float(value)
    return values


def _findings(flow: Any, payloads: dict[str, Any | None]) -> list[str]:
    findings = []
    status = _step_status(flow)
    if status.get("place") != "Success":
        findings.append("place_step_not_successful")
    if not payloads["place_dreamplace/analysis/qor_metrics.json"]:
        findings.append("place_metrics_unavailable")
    return findings
