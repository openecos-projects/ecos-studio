"""The episode's first candidate is judged against the rerun-path reference."""

from pathlib import Path

from ecos_agent.optimization.runtime import _calibration_reference_observation
from tests.optimization.controller.support import _eligible_terminal


def _write_replays(workspace: Path, observation_ids: tuple[str, ...]) -> None:
    for index, observation_id in enumerate(observation_ids, start=1):
        observation = _eligible_terminal(observation_id)
        replay_root = (
            workspace
            / ".agent"
            / "optimization"
            / "noise-calibration"
            / f"default-replay-{index}"
        )
        replay_root.mkdir(parents=True)
        (replay_root / "terminal-observation.v1.json").write_text(
            observation.model_dump_json()
        )


def test_middle_replay_is_the_reference_observation(tmp_path: Path) -> None:
    _write_replays(tmp_path, ("replay-a", "replay-b", "replay-c"))

    reference = _calibration_reference_observation(tmp_path)

    assert reference is not None
    assert reference.observation_id == "replay-b"


def test_missing_calibration_falls_back_to_none(tmp_path: Path) -> None:
    assert _calibration_reference_observation(tmp_path) is None


def test_ineligible_reference_falls_back_to_none(tmp_path: Path) -> None:
    _write_replays(tmp_path, ("replay-a", "replay-b"))
    replay_dir = (
        tmp_path
        / ".agent"
        / "optimization"
        / "noise-calibration"
        / "default-replay-2"
    )
    observation = _eligible_terminal("replay-b").model_copy(
        update={"evidence_valid": False}
    )
    (replay_dir / "terminal-observation.v1.json").write_text(
        observation.model_dump_json()
    )

    assert _calibration_reference_observation(tmp_path) is None
