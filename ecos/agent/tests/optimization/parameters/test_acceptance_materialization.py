from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.optimization.contracts import OptimizationKnob
from tests.optimization.parameters.acceptance_support import (
    terminal,
    write_candidate,
    write_json,
)
from tests.optimization.parameters.acceptance_trace_support import (
    build_acceptance,
    patch_acceptance_for_single_knob,
    rewrite_receipt,
    write_padding_candidate,
    write_trace,
)


def test_acceptance_allows_different_actual_target_density(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    observation_payload = {
        "target_density": 0.8,
        "density_tensor_value": 0.8,
        "density_operator_call_count": 1,
    }
    paths = write_candidate(
        workspace,
        requested_value=0.2,
        actual_value=0.8,
        observation_payload=observation_payload,
    )
    observation = terminal()
    episode_root = write_trace(workspace, paths, observation)
    patch_acceptance_for_single_knob(monkeypatch, observation)

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v2.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Complete"
    assert report["entries"][0]["issues"] == []
    assert report["entries"][0]["requested"] == 0.2
    assert report["entries"][0]["actual_value"] == 0.8
    assert report["entries"][0]["status"] == "effective"
    assert report["entries"][0]["reason"] is None
    assert "activation_status" not in report["entries"][0]
    assert report["terminal_closed_knobs"] == ["place.target_density"]


def test_acceptance_requires_materialization_binding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = write_candidate(workspace)

    def remove_materialization_binding(receipt: dict) -> None:
        receipt["materialization"].update(
            {
                "target_step": None,
                "config_ref": None,
                "before_snapshot_ref": None,
                "before_snapshot_sha256": None,
                "after_snapshot_ref": None,
                "after_snapshot_sha256": None,
                "parent_state_sha256": None,
            }
        )

    rewrite_receipt(paths, remove_materialization_binding)
    observation = terminal()
    episode_root = write_trace(workspace, paths, observation)
    patch_acceptance_for_single_knob(monkeypatch, observation)

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v2.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert any("candidate artifact" in item for item in report["entries"][0]["issues"])
    assert report["terminal_closed_knobs"] == []


@pytest.mark.parametrize(
    ("paths_mutation", "classification"),
    (
        (None, "Engineering Complete"),
        ("clamped_padding", "Engineering Complete"),
        ("wrong_written_value", "Engineering Incomplete"),
    ),
)
def test_acceptance_validates_cell_padding_site_to_dbu_materialization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    paths_mutation: str | None,
    classification: str,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = write_padding_candidate(
        workspace,
        written_value=(2 if paths_mutation == "wrong_written_value" else 4000),
        actual_value=(
            0.001 if paths_mutation == "wrong_written_value"
            else 1 if paths_mutation == "clamped_padding"
            else 2
        ),
    )
    observation = terminal()
    episode_root = write_trace(workspace, paths, observation)
    patch_acceptance_for_single_knob(
        monkeypatch,
        observation,
        knob=OptimizationKnob.CELL_PADDING_X,
    )

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v2.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == classification
    if classification == "Engineering Complete":
        assert report["terminal_closed_knobs"] == ["place.cell_padding_x"]
    else:
        assert any(
            "candidate artifact" in item for item in report["entries"][0]["issues"]
        )
        assert report["terminal_closed_knobs"] == []


@pytest.mark.parametrize("mutation", ("missing_config", "tampered_after_snapshot"))
def test_acceptance_rejects_unavailable_or_tampered_materialization_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = write_candidate(workspace)
    candidate_root = paths["manifest"].parents[1]
    if mutation == "missing_config":
        (candidate_root / "config/dreamplace_ecc.json").unlink()
    else:
        write_json(
            candidate_root / "analysis/snapshots/dreamplace_ecc.after.json",
            {"target_density": 0.7},
        )
    observation = terminal()
    episode_root = write_trace(workspace, paths, observation)
    patch_acceptance_for_single_knob(monkeypatch, observation)

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v2.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert any("candidate artifact" in item for item in report["entries"][0]["issues"])
    assert report["terminal_closed_knobs"] == []
