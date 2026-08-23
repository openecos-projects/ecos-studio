from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import TerminalObservation
from ecos_agent.optimization_runtime import (
    OptimizationRuntimeError,
    _load_baseline_replays,
    _place_to_harden_runtime_seconds,
)


_STAGES = (
    "place",
    "CTS",
    "legalization",
    "route",
    "drc",
    "lvs",
    "filler",
    "RCX",
    "sta",
    "Harden",
)


def _write_flow(tmp_path: Path, *, states: dict[str, str] | None = None) -> None:
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "flow.json").write_text(
        json.dumps(
            {
                "steps": [
                    {
                        "name": stage,
                        "state": (states or {}).get(stage, "Success"),
                        "runtime": f"0:0:{index}",
                    }
                    for index, stage in enumerate(_STAGES)
                ]
            }
        ),
        encoding="utf-8",
    )


def test_place_to_harden_runtime_uses_successful_flow_records(tmp_path: Path) -> None:
    _write_flow(tmp_path)

    assert _place_to_harden_runtime_seconds(tmp_path) == sum(range(10))


def test_place_to_harden_runtime_fails_closed_on_incomplete_stage(tmp_path: Path) -> None:
    _write_flow(tmp_path, states={"place": "Ongoing"})

    with pytest.raises(OptimizationRuntimeError, match="flow completion evidence"):
        _place_to_harden_runtime_seconds(tmp_path)


def _write_baseline_replays(tmp_path: Path, parent_manifest_sha256: str) -> Path:
    destination = tmp_path / ".agent" / "optimization" / "baseline-replays.v1.json"
    destination.parent.mkdir(parents=True)
    metrics = {
        "route_dr_total_violation_count": 3.0,
        "route_la_total_overflow": 2.0,
        "route_wirelength": 100.0,
    }
    payload = {
        "schema_version": "ecos.optimization_baseline_replays.v1",
        "parent_manifest_sha256": parent_manifest_sha256,
        "replays": [
            {
                "replay_id": f"baseline-{index}",
                "candidate_root_ref": f".agent/candidates/baseline-{index}",
                "candidate_manifest_ref": (
                    f".agent/candidates/baseline-{index}/candidate-manifest.v1.json"
                ),
                "candidate_manifest_sha256": "sha256:" + str(index) * 64,
                "runtime_seconds": float(10 + index),
                "terminal_observation": {
                    "schema_version": "ecos.terminal_observation.v1",
                    "observation_id": f"baseline-{index}",
                    "evidence_manifest_sha256": "sha256:" + str(index) * 64,
                    "evidence_valid": True,
                    "harden_artifacts_complete": True,
                    "signoff_gates": {
                        "drc_clean": "pass",
                        "lvs_clean": "pass",
                        "rcx_corner_coverage": "pass",
                        "rcx_spef_parse_health": "pass",
                        "sta_setup_closed": "pass",
                        "sta_hold_closed": "pass",
                        "mpc_minimum_area": "not_applicable",
                        "mpc_maximum_area": "not_applicable",
                    },
                    "metrics": metrics,
                },
            }
            for index in range(1, 4)
        ],
    }
    payload["artifact_sha256"] = canonical_sha256(payload)
    destination.write_text(json.dumps(payload), encoding="utf-8")
    return destination


def test_load_baseline_replays_requires_three_hash_bound_terminal_runs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    parent_manifest = "sha256:" + "a" * 64
    _write_baseline_replays(tmp_path, parent_manifest)
    payload = json.loads(
        (tmp_path / ".agent/optimization/baseline-replays.v1.json").read_text(
            encoding="utf-8"
        )
    )
    observations = iter(
        TerminalObservation.model_validate(item["terminal_observation"])
        for item in payload["replays"]
    )
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime.build_candidate_terminal_observation",
        lambda *_args: next(observations),
    )

    evidence = _load_baseline_replays(tmp_path, parent_manifest)

    assert [replay.runtime_seconds for replay in evidence.replays] == [11, 12, 13]
    wirelengths = [
        replay.terminal_observation.metrics["route_wirelength"]
        for replay in evidence.replays
    ]
    assert wirelengths == [100, 100, 100]


def test_load_baseline_replays_fails_closed_when_missing_or_tampered(tmp_path: Path) -> None:
    parent_manifest = "sha256:" + "a" * 64
    with pytest.raises(OptimizationRuntimeError, match="baseline replay evidence is unavailable"):
        _load_baseline_replays(tmp_path, parent_manifest)

    artifact = _write_baseline_replays(tmp_path, parent_manifest)
    payload = json.loads(artifact.read_text(encoding="utf-8"))
    payload["replays"][0]["runtime_seconds"] = 99
    artifact.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(OptimizationRuntimeError, match="baseline replay evidence is invalid"):
        _load_baseline_replays(tmp_path, parent_manifest)
