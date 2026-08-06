import json
from pathlib import Path

import pytest

from ecos_agent.place_optimization import (
    OptimizationEvaluation,
    OptimizationRunSpec,
    append_evaluation,
    generate_candidates,
)
from ecos_agent.workspace_rerun import GuiWorkspaceRerunSource


def _spec() -> OptimizationRunSpec:
    return OptimizationRunSpec(
        run_id="scan_001",
        source_workspace="/tmp/gcd",
        baseline_id="baseline",
        objective="place_hpwl",
        knob_id="place.target_density",
        lower=0.4,
        upper=0.8,
        direction="decrease",
        seed=3000,
        budget=5,
        requires_gui_review=True,
    )


def test_generates_four_deterministic_candidates_without_the_baseline() -> None:
    candidates = generate_candidates(_spec())

    assert [candidate.candidate_id for candidate in candidates] == ["candidate_1", "candidate_2", "candidate_3", "candidate_4"]
    assert [candidate.value for candidate in candidates] == [0.7, 0.6, 0.5, 0.4]


def test_rejects_an_empty_target_density_interval() -> None:
    with pytest.raises(ValueError, match="interval"):
        OptimizationRunSpec(
            run_id="scan_001",
            source_workspace="/tmp/gcd",
            baseline_id="baseline",
            objective="place_hpwl",
            knob_id="place.target_density",
            lower=0.8,
            upper=0.4,
            direction="decrease",
            seed=3000,
            budget=5,
            requires_gui_review=True,
        )


def test_rejects_success_without_complete_fixed_rpc_evidence() -> None:
    with pytest.raises(ValueError, match="evidence is incomplete"):
        OptimizationEvaluation(candidate_id="candidate_1", status="succeeded")


def test_appends_a_non_secret_evaluation_record(tmp_path: Path) -> None:
    append_evaluation(
        tmp_path / "memory.jsonl",
        run_id="scan_001",
        candidate_id="candidate_1",
        status="succeeded",
        value=0.7,
        metrics={"place_hpwl": 12.5},
        artifact_refs=["place_dreamplace/analysis/qor_metrics.json"],
    )

    record = json.loads((tmp_path / "memory.jsonl").read_text(encoding="utf-8"))
    assert record["status"] == "succeeded"
    assert record["metrics"] == {"place_hpwl": 12.5}


def test_evaluation_memory_keeps_frozen_run_metadata_without_workspace_paths(tmp_path: Path) -> None:
    append_evaluation(
        tmp_path / "memory.jsonl",
        run_spec=_spec(),
        design_id="gcd",
        protected_metrics=["place_hpwl"],
        candidate_id="candidate_1",
        status="failed",
        value=0.7,
        metrics={},
        artifact_refs=[],
        reason="execution_failed",
    )

    record = json.loads((tmp_path / "memory.jsonl").read_text(encoding="utf-8"))
    assert record["fixed_rpc_operation"] == "candidate.rerun"
    assert record["run_spec"]["seed"] == 3000
    assert "source_workspace" not in record["run_spec"]
    assert record["input_artifact_refs"] == []
    assert record["error"] == "execution_failed"


def test_freezes_baseline_and_four_candidates_as_isolated_rerun_contracts(tmp_path: Path) -> None:
    from ecos_agent.place_optimization import freeze_rerun_contracts

    source = GuiWorkspaceRerunSource(
        workspace_path=tmp_path / "gcd",
        design_id="gcd",
        flow_json_sha256="sha256:flow",
        end_step="place",
        allowed_stages=("place",),
        stage_artifact_ref={"place": "place_dreamplace/output/gcd_place.def.gz"},
        stage_artifact_sha256={"place": "sha256:artifact"},
    )
    spec = _spec().model_copy(update={"source_workspace": str(source.workspace_path)})
    contracts = freeze_rerun_contracts(spec, source)

    assert [contract.rerun_id for contract in contracts] == [
        "scan_001_baseline",
        "scan_001_candidate_1",
        "scan_001_candidate_2",
        "scan_001_candidate_3",
        "scan_001_candidate_4",
    ]
    assert contracts[0].parameter_patch == []
    assert [item.value for item in contracts[1].parameter_patch] == [0.7]
    assert len({contract.target_workspace for contract in contracts}) == 5
