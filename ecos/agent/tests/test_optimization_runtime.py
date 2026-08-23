from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
)
from ecos_agent.optimization_contracts import (
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    TerminalObservation,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_runtime import (
    OptimizationRuntimeError,
    _load_baseline_replays,
    _optimization_objective,
    _place_to_harden_runtime_seconds,
    _prepare_baseline_replays,
)
from ecos_agent.optimization_rules import freeze_optimization_objective


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


def test_runtime_requires_a_hash_bound_optimization_objective() -> None:
    objective = freeze_optimization_objective(
        "Minimize wirelength without routing regressions.",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
            ),
            rationale_summary="Keep routing constraints while reducing wirelength.",
        ),
    )

    assert _optimization_objective(objective.model_dump(mode="json")) == objective
    with pytest.raises(OptimizationRuntimeError, match="optimization objective is missing"):
        _optimization_objective(None)
    tampered = objective.model_dump(mode="json")
    tampered["primary_metric"] = ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    with pytest.raises(OptimizationRuntimeError, match="optimization objective is invalid"):
        _optimization_objective(tampered)


def _write_baseline_replays(tmp_path: Path, parent_manifest_sha256: str) -> Path:
    destination = tmp_path / ".agent" / "optimization" / "baseline-replays.v2.json"
    destination.parent.mkdir(parents=True)
    metrics = {
        "route_dr_total_violation_count": 3.0,
        "route_la_total_overflow": 2.0,
        "route_wirelength": 100.0,
    }
    payload = {
        "schema_version": "ecos.optimization_baseline_replays.v2",
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
                    "schema_version": "ecos.terminal_observation.v2",
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
                    "timing_guardrail": {
                        "sta_setup_wns": index / 10,
                        "sta_setup_tns": 0.0,
                        "sta_hold_wns": index / 20,
                        "sta_hold_tns": 0.0,
                    },
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
        (tmp_path / ".agent/optimization/baseline-replays.v2.json").read_text(
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
    assert [
        replay.terminal_observation.timing_guardrail["sta_setup_wns"]
        for replay in evidence.replays
    ] == pytest.approx([0.1, 0.2, 0.3])


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


def test_load_baseline_replays_does_not_reuse_legacy_v1_evidence(tmp_path: Path) -> None:
    parent_manifest = "sha256:" + "a" * 64
    artifact = _write_baseline_replays(tmp_path, parent_manifest)
    artifact.rename(artifact.with_name("baseline-replays.v1.json"))

    with pytest.raises(OptimizationRuntimeError, match="baseline replay evidence is unavailable"):
        _load_baseline_replays(tmp_path, parent_manifest)


class _BaselineExecutor:
    def __init__(self, *, fail_at: int | None = None) -> None:
        self.calls: list[tuple[str, int, float]] = []
        self.fail_at = fail_at

    def start_baseline(
        self, episode_id: str, replay_number: int, target_density: float
    ) -> CandidateExecutionReceipt:
        self.calls.append((episode_id, replay_number, target_density))
        outcome = (
            OptimizationOutcomeKind.EXECUTION_FAILED
            if replay_number == self.fail_at
            else OptimizationOutcomeKind.EXECUTION_SUCCEEDED
        )
        return CandidateExecutionReceipt(
            execution_id=f"operation-{replay_number}",
            started=True,
            outcome=outcome,
            evidence=CandidateExecutionEvidence(
                candidate_root_ref=f".agent/candidates/baseline-{replay_number}",
                candidate_manifest_ref=(
                    f".agent/candidates/baseline-{replay_number}/analysis/"
                    "candidate_workspace.v1.json"
                ),
                candidate_manifest_sha256="sha256:" + str(replay_number) * 64,
            ),
        )


class _PendingBaselineExecutor(_BaselineExecutor):
    def __init__(self) -> None:
        super().__init__()
        self.cancelled: list[str] = []

    def start_baseline(
        self, episode_id: str, replay_number: int, target_density: float
    ) -> CandidateExecutionReceipt:
        self.calls.append((episode_id, replay_number, target_density))
        return CandidateExecutionReceipt(
            execution_id=f"operation-{replay_number}", started=True
        )

    def cancel(self, execution_id: str) -> CandidateExecutionReceipt:
        self.cancelled.append(execution_id)
        return CandidateExecutionReceipt(
            execution_id=execution_id,
            started=True,
            outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
        )


def _mock_successful_baseline_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    parent_manifest: str,
    *,
    observed_parent_manifest: str | None = None,
) -> None:
    template = _write_baseline_replays(tmp_path, parent_manifest)
    observations = [
        TerminalObservation.model_validate(item["terminal_observation"])
        for item in json.loads(template.read_text(encoding="utf-8"))["replays"]
    ]
    template.unlink()
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime.build_candidate_terminal_observation",
        lambda _workspace, evidence: observations[
            int(evidence.candidate_root_ref.rsplit("-", 1)[1]) - 1
        ],
    )
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime._place_to_harden_runtime_seconds",
        lambda candidate: 10.0 + int(candidate.name.rsplit("-", 1)[1]),
    )
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime._parent_manifest_sha256",
        lambda _workspace: observed_parent_manifest or parent_manifest,
    )


def test_prepare_baseline_replays_executes_three_default_full_flows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    parent_manifest = "sha256:" + "a" * 64
    _mock_successful_baseline_artifacts(monkeypatch, tmp_path, parent_manifest)
    executor = _BaselineExecutor()
    progress: list[str] = []

    evidence = _prepare_baseline_replays(
        tmp_path,
        parent_manifest,
        "episode-new",
        executor,
        0.55,
        progress.append,
        lambda: False,
    )

    assert executor.calls == [
        ("episode-new", 1, 0.55),
        ("episode-new", 2, 0.55),
        ("episode-new", 3, 0.55),
    ]
    assert [replay.runtime_seconds for replay in evidence.replays] == [11, 12, 13]
    assert progress == [
        "Preparing baseline replay 1/3.",
        "Baseline replay 1/3 completed.",
        "Preparing baseline replay 2/3.",
        "Baseline replay 2/3 completed.",
        "Preparing baseline replay 3/3.",
        "Baseline replay 3/3 completed.",
    ]
    assert (tmp_path / ".agent/optimization/baseline-replays.v2.json").is_file()
    assert not list(
        (tmp_path / ".agent/optimization").glob(".baseline-replays.v2.json.*.tmp")
    )


def test_prepare_baseline_replays_rejects_parent_manifest_drift(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    parent_manifest = "sha256:" + "a" * 64
    _mock_successful_baseline_artifacts(
        monkeypatch,
        tmp_path,
        parent_manifest,
        observed_parent_manifest="sha256:" + "b" * 64,
    )

    with pytest.raises(OptimizationRuntimeError, match="workspace changed"):
        _prepare_baseline_replays(
            tmp_path,
            parent_manifest,
            "episode-new",
            _BaselineExecutor(),
            0.55,
            lambda _text: None,
            lambda: False,
        )

    assert not (tmp_path / ".agent/optimization/baseline-replays.v2.json").exists()


def test_prepare_baseline_replays_does_not_publish_partial_evidence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "ecos_agent.optimization_runtime.build_candidate_terminal_observation",
        lambda *_args: pytest.fail("failed replay must not be observed"),
    )

    with pytest.raises(OptimizationRuntimeError, match="baseline replay 1 failed"):
        _prepare_baseline_replays(
            tmp_path,
            "sha256:" + "a" * 64,
            "episode-new",
            _BaselineExecutor(fail_at=1),
            0.55,
            lambda _text: None,
            lambda: False,
        )

    assert not (tmp_path / ".agent/optimization/baseline-replays.v2.json").exists()


def test_prepare_baseline_replays_cancels_an_interrupted_operation(tmp_path: Path) -> None:
    executor = _PendingBaselineExecutor()
    cancellation_checks = iter((False, True))

    with pytest.raises(OptimizationRuntimeError, match="interrupted"):
        _prepare_baseline_replays(
            tmp_path,
            "sha256:" + "a" * 64,
            "episode-new",
            executor,
            0.55,
            lambda _text: None,
            lambda: next(cancellation_checks),
        )

    assert executor.cancelled == ["operation-1"]
    assert not (tmp_path / ".agent/optimization/baseline-replays.v2.json").exists()
