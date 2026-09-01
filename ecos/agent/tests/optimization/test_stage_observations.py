from __future__ import annotations

import json
from pathlib import Path

import pytest
from ecos_agent.hashing import (
    canonical_sha256,
    file_sha256,
)
from ecos_agent.optimization.observations import (
    OptimizationObservationError,
    build_stage_observation,
)



from tests.optimization.observation_support import (
    _budget,
    _metrics,
    _write_json,
    frozen_workspace,
)

def test_stage_observation_reads_only_the_fixed_stage_artifacts(
    frozen_workspace: Path,
) -> None:
    _write_json(
        frozen_workspace / "place_dreamplace/analysis/qor_hotspots.json",
        {
            "schema_version": 3,
            "analysis_revision": "quality-gates-v4",
            "tool": "dreamplace",
            "step": "place",
            "design": "tiny",
            "hotspots": [
                {
                    "kind": "congestion",
                    "severity": "warning",
                    "metric_id": "place_lutrudy_utilization_max",
                    "value": 0.88,
                    "unit": "ratio",
                },
                {
                    "kind": "congestion",
                    "severity": "critical",
                    "metric_id": "place_lutrudy_utilization_max",
                    "value": 0.91,
                    "unit": "ratio",
                },
            ],
        },
    )
    observation = build_stage_observation(
        frozen_workspace,
        "place",
        budget=_budget(),
    )

    assert observation.observation_id == "stage-place"
    assert observation.metrics == {
        "place_lutrudy_utilization_max": 0.88,
        "place_total_wirelength": 123.0,
        "runtime_seconds": 1.0,
        "peak_memory_mb": 100.0,
    }
    artifact_sha256 = file_sha256(
        frozen_workspace / "place_dreamplace/analysis/qor_hotspots.json"
    )
    expected_hotspots = [
        {
            "kind": "congestion",
            "severity": "warning",
            "metric_id": "place_lutrudy_utilization_max",
            "value": 0.88,
            "unit": "ratio",
        },
        {
            "kind": "congestion",
            "severity": "critical",
            "metric_id": "place_lutrudy_utilization_max",
            "value": 0.91,
            "unit": "ratio",
        },
    ]
    assert [item.model_dump(mode="json") for item in observation.state_evidence] == [
        {
            "feature_id": "place_lutrudy_utilization_max",
            "value": 0.88,
            "evidence_sha256": canonical_sha256(
                {
                    "artifact_sha256": artifact_sha256,
                    "evidence_ref": "place_dreamplace/analysis/qor_hotspots.json#/hotspots/0",
                    "hotspot": expected_hotspots[0],
                }
            ),
            "evidence_ref": "place_dreamplace/analysis/qor_hotspots.json#/hotspots/0",
        },
        {
            "feature_id": "place_lutrudy_utilization_max_hotspot_1",
            "value": 0.91,
            "evidence_sha256": canonical_sha256(
                {
                    "artifact_sha256": artifact_sha256,
                    "evidence_ref": "place_dreamplace/analysis/qor_hotspots.json#/hotspots/1",
                    "hotspot": expected_hotspots[1],
                }
            ),
            "evidence_ref": "place_dreamplace/analysis/qor_hotspots.json#/hotspots/1",
        },
    ]
    assert observation.requested_knobs == ()
    assert observation.budget.remaining_candidates == 19

    repeated = build_stage_observation(frozen_workspace, "place", budget=_budget())
    assert repeated.evidence_manifest_sha256 == observation.evidence_manifest_sha256


def test_stage_observation_rejects_incomplete_and_unsafe_workspace_evidence(
    frozen_workspace: Path,
    tmp_path: Path,
) -> None:
    flow_path = frozen_workspace / "home/flow.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    flow["steps"][0]["state"] = "Running"
    _write_json(flow_path, flow)

    with pytest.raises(OptimizationObservationError, match="not successful"):
        build_stage_observation(frozen_workspace, "place", budget=_budget())

    flow["steps"][0]["state"] = "Success"
    _write_json(flow_path, flow)
    external = tmp_path / "external.json"
    _write_json(external, _metrics(("place_lutrudy_utilization_max", 0.88)))
    metrics_path = frozen_workspace / "place_dreamplace/analysis/qor_metrics.json"
    metrics_path.unlink()
    metrics_path.symlink_to(external)

    with pytest.raises(OptimizationObservationError, match="unsafe"):
        build_stage_observation(frozen_workspace, "place", budget=_budget())
