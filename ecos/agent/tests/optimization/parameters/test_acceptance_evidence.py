from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.optimization import memory as optimization_memory
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters import acceptance
from tests.optimization.parameters.acceptance_support import (
    HASH,
    card,
    terminal,
    write_candidate,
    write_json,
)
from tests.optimization.parameters.acceptance_trace_support import (
    build_acceptance,
    rewrite_receipt,
    write_trace,
)


def test_density_floor_override_accepts_float32_tensor_rounding() -> None:
    receipt = {
        "requested": {"knob_id": "place.target_density", "value": 0.2},
        "effective_initial": {"value": 0.65},
        "effective_final": {"value": 0.65},
        "consumer_observation": {
            "effective_target_density": 0.65,
            "density_tensor_value": 0.6499999761581421,
            "density_operator_call_count": 1,
        },
        "transitions": [
            {
                "to": "overridden",
                "rule_id": "dreamplace.target_density.utilization_floor",
                "value": 0.65,
                "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                "evidence_sha256": HASH,
            }
        ],
    }

    assert acceptance._has_native_density_floor_override(receipt) is True


@pytest.mark.parametrize(
    ("case", "classification", "issue"),
    [
        ("valid", "Engineering Complete", None),
        ("outside_lattice", "Engineering Incomplete", "receipt contract"),
        ("ineligible_terminal", "Engineering Incomplete", "terminal observation"),
        ("tampered_runtime", "Engineering Incomplete", "runtime report"),
        ("foreign_runtime_tool", "Engineering Incomplete", "runtime report tool"),
        ("missing_runtime", "Engineering Incomplete", "runtime report"),
        ("missing_card_source", "Engineering Incomplete", "tool source"),
        ("unbound_replay", "Engineering Incomplete", "replay candidate manifest"),
        ("tampered_chain", "Engineering Incomplete", "optimization trace replay"),
    ],
)
def test_acceptance_fails_closed_on_unbound_evidence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    classification: str,
    issue: str | None,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = write_candidate(workspace)
    monkeypatch.setattr(
        acceptance,
        "load_parameter_cards",
        lambda: {OptimizationKnob.TARGET_DENSITY: card()},
    )
    monkeypatch.setattr(
        optimization_memory,
        "load_parameter_cards",
        lambda: {OptimizationKnob.TARGET_DENSITY: card()},
    )
    monkeypatch.setattr(acceptance, "_state_sha256", lambda _: HASH)
    revisions = acceptance._current_revisions()
    monkeypatch.setattr(
        acceptance,
        "_current_revisions",
        lambda: {**revisions, "ecc_gitlink_revision": "ecc-test-revision"},
    )
    eligible = case != "ineligible_terminal"
    observation = terminal(eligible=eligible)
    episode_root = write_trace(workspace, paths, observation)
    monkeypatch.setattr(
        acceptance,
        "build_candidate_terminal_observation",
        lambda *_: observation,
    )
    if case == "outside_lattice":
        rewrite_receipt(
            paths,
            lambda receipt: (
                receipt["requested"].update(value=0.05),
                receipt["materialization"].update(written_value=0.05),
                receipt["effective_initial"].update(value=0.05),
                receipt["effective_final"].update(value=0.05),
                receipt["consumer_observation"].update(
                    effective_target_density=0.05,
                    density_tensor_value=0.05,
                ),
            ),
        )
    elif case == "tampered_runtime":
        paths["runtime"].write_text("{}", encoding="utf-8")
    elif case == "foreign_runtime_tool":
        runtime = json.loads(paths["runtime"].read_text(encoding="utf-8"))
        runtime["tool"]["source_sha256"] = "sha256:" + "f" * 64
        write_json(paths["runtime"], runtime)
    elif case == "missing_runtime":
        paths["runtime"].unlink()
    elif case == "missing_card_source":
        rewrite_receipt(
            paths, lambda receipt: receipt["tool"].update(source_sha256=None)
        )
    elif case == "unbound_replay":
        replay = json.loads(paths["replay"].read_text(encoding="utf-8"))
        replay["candidate_manifest_sha256"] = None
        write_json(paths["replay"], replay)
    elif case == "tampered_chain":
        audit = episode_root / "optimization-planning-audit.v1.jsonl"
        audit.write_text(
            audit.read_text(encoding="utf-8").replace('"sequence":1', '"sequence":9'),
            encoding="utf-8",
        )

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == classification
    issues = report["entries"][0]["issues"]
    if issue is None:
        assert issues == []
        assert report["terminal_closed_knobs"] == ["place.target_density"]
        assert report["provenance"]["current"] is True
        assert report["provenance"]["expected_ecc_revision"] == "ecc-test-revision"
        assert report["provenance"]["observed_ecc_revisions"] == [
            "ecc-test-revision"
        ]
    else:
        assert any(issue in item for item in issues)
        assert report["terminal_closed_knobs"] == []
