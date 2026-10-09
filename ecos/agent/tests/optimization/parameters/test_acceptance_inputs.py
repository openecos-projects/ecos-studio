from __future__ import annotations

from pathlib import Path

import pytest

from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters import acceptance


def test_acceptance_requires_explicit_episode_roots_and_candidate_mapping(
    tmp_path: Path,
) -> None:
    revisions = acceptance._current_revisions()
    with pytest.raises(ValueError, match="episode root"):
        acceptance.build_acceptance(
            tmp_path,
            tmp_path / "output",
            candidates={"place.target_density": "candidate-1"},
            episode_roots=(),
            expected_ecos_revision=revisions["ecos_revision"],
            expected_ecc_revision="ecc-test-revision",
        )

    with pytest.raises(ValueError, match="candidate mapping"):
        acceptance.build_acceptance(
            tmp_path,
            tmp_path / "output",
            candidates={},
            episode_roots=(tmp_path / "episode",),
            expected_ecos_revision=revisions["ecos_revision"],
            expected_ecc_revision="ecc-test-revision",
        )

    with pytest.raises(ValueError, match="candidate id"):
        acceptance._validate_inputs(
            tmp_path,
            {"place.target_density": "../candidate-1"},
            (tmp_path / ".agent/optimization/episode-1",),
            revisions["ecos_revision"],
            "ecc-test-revision",
            {"place.target_density"},
        )


def test_acceptance_cli_requires_exactly_seven_unique_candidate_bindings() -> None:
    specs = [
        f"{knob.value}=candidate-{index}"
        for index, knob in enumerate(OptimizationKnob)
    ]

    assert acceptance._parse_candidates(specs) == {
        knob.value: f"candidate-{index}"
        for index, knob in enumerate(OptimizationKnob)
    }
    assert acceptance.IGNORED_KNOBS == ("cts.max_fanout",)
    with pytest.raises(ValueError, match="seven unique"):
        acceptance._parse_candidates(specs[:-1])


def test_acceptance_state_hash_binds_canonical_params_toml(tmp_path) -> None:
    for relative, content in (
        ("home/flow.json", "{}\n"),
        ("home/params.toml", '[params]\ndesign = "gcd"\n'),
        ("config/floorplan_ecc.json", "{}\n"),
        ("config/cts_ecc.json", "{}\n"),
        ("config/dreamplace_ecc.json", "{}\n"),
    ):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    before = acceptance._state_sha256(tmp_path)
    (tmp_path / "home/params.toml").write_text(
        '[params]\ndesign = "aes"\n', encoding="utf-8"
    )

    assert acceptance._state_sha256(tmp_path) != before
