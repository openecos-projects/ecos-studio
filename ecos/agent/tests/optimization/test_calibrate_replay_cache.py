"""The replay cache re-parses on observation-code drift and fails closed on toolchain drift."""

import json

import pytest

from ecos_agent.optimization.calibrate_workspace import (
    _load_replay_manifest,
    _run_replay,
    _store_replay_cache,
    write_noise_epsilon_artifact,
)
from ecos_agent.optimization.runtime import OptimizationRuntimeError
from tests.optimization.experiments.equal_budget_support import _terminal_observation

_FINGERPRINT = {
    "ecc_revision": "rev-1",
    "origin_sha256": "origin-1",
    "parameters_sha256": "params-1",
    "pdk_sha256": "pdk-1",
    "parser_sha256": "parser-1",
}


def _bomb(*_args: object, **_kwargs: object) -> object:
    raise AssertionError("unexpected ECC-side call")


def test_matching_cache_reuses_the_stored_observation(tmp_path, monkeypatch) -> None:
    replay_root = tmp_path / "default-replay-1"
    replay_root.mkdir()
    observation = _terminal_observation()
    _store_replay_cache(replay_root, observation, _FINGERPRINT, "produced")
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._terminal_observation", _bomb
    )

    result = _run_replay(
        tmp_path / "ws", replay_root, 1, 60.0, dict(_FINGERPRINT)
    )

    assert result == observation
    assert json.loads(
        (replay_root / "replay-cache-manifest.v1.json").read_text(encoding="utf-8")
    )["provenance"] == "produced"


def test_parser_change_reparses_cached_flow_artifacts(tmp_path, monkeypatch) -> None:
    replay_root = tmp_path / "default-replay-1"
    replay_root.mkdir()
    stale = dict(_FINGERPRINT, parser_sha256="parser-0")
    _store_replay_cache(replay_root, _terminal_observation(), stale, "produced")
    reparsed = _terminal_observation()
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._terminal_observation",
        lambda workspace: reparsed,
    )
    messages: list[str] = []

    result = _run_replay(
        tmp_path / "ws",
        replay_root,
        1,
        60.0,
        dict(_FINGERPRINT),
        progress=messages.append,
    )

    assert result == reparsed
    manifest = _load_replay_manifest(replay_root)
    assert manifest["provenance"] == "reparsed"
    assert manifest["components"]["parser_sha256"] == "parser-1"
    assert any("re-parsed" in message for message in messages)


def test_legacy_finished_flow_is_adopted_with_unverified_provenance(
    tmp_path, monkeypatch
) -> None:
    replay_root = tmp_path / "default-replay-1"
    (replay_root / "workspace").mkdir(parents=True)
    (replay_root / "terminal-observation.v1.json").write_text("stale", encoding="utf-8")
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._workspace_flow_succeeded",
        lambda workspace: True,
    )
    adopted = _terminal_observation()
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._terminal_observation",
        lambda workspace: adopted,
    )

    result = _run_replay(tmp_path / "ws", replay_root, 1, 60.0, dict(_FINGERPRINT))

    assert result == adopted
    assert (replay_root / "terminal-observation.v1.json").read_text(
        encoding="utf-8"
    ) == adopted.model_dump_json()
    manifest = _load_replay_manifest(replay_root)
    assert manifest["provenance"] == "adopted"
    assert manifest["components"] == _FINGERPRINT


def test_toolchain_drift_refuses_to_reuse_the_cache(tmp_path) -> None:
    replay_root = tmp_path / "default-replay-1"
    replay_root.mkdir()
    drifted = dict(_FINGERPRINT, ecc_revision="rev-0")
    _store_replay_cache(replay_root, _terminal_observation(), drifted, "produced")
    before = (replay_root / "terminal-observation.v1.json").read_text(encoding="utf-8")

    with pytest.raises(OptimizationRuntimeError, match="ecc_revision"):
        _run_replay(
            tmp_path / "ws", replay_root, 1, 60.0, dict(_FINGERPRINT)
        )

    assert (
        replay_root / "terminal-observation.v1.json"
    ).read_text(encoding="utf-8") == before
    assert _load_replay_manifest(replay_root)["components"]["ecc_revision"] == "rev-0"


def test_missing_workspace_reruns_the_flow_and_records_provenance(
    tmp_path, monkeypatch
) -> None:
    replay_root = tmp_path / "default-replay-1"
    workspace = tmp_path / "ws"
    workspace.mkdir()
    produced = _terminal_observation()
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._terminal_observation",
        lambda workspace_path: produced,
    )

    class FakeHost:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, object]]] = []

        def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
            self.calls.append((method, params))
            if method == "workspace.open":
                return {
                    "workspaceHandle": "handle-1",
                    "workspaceRevision": 2,
                    "directory": str(params["directory"]),
                }
            if method == "workspace.run":
                return {
                    "operationId": "operation-1",
                    "state": "succeeded",
                    "workspaceId": "workspace-1",
                }
            raise AssertionError(f"unexpected host method {method}")

    host = FakeHost()
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._require_host_transport",
        lambda: host,
    )

    result = _run_replay(workspace, replay_root, 1, 60.0, dict(_FINGERPRINT))
    assert host.calls[0][0] == "workspace.open"
    assert host.calls[1] == (
        "workspace.run",
        {
            "workspaceHandle": "handle-1",
            "expectedWorkspaceRevision": 2,
            "rerun": True,
            "idempotencyKey": "noise-calibration.default-replay-1",
        },
    )

    assert result == produced
    assert _load_replay_manifest(replay_root)["provenance"] == "produced"


def test_epsilon_artifact_records_calibration_metadata(tmp_path) -> None:
    observation = _terminal_observation()
    artifact = tmp_path / "noise-epsilon.v1.json"

    payload = write_noise_epsilon_artifact(
        (observation, observation),
        artifact,
        metadata={
            "calibration_fingerprint": dict(_FINGERPRINT),
            "replay_provenance": {"1": "adopted", "2": "produced"},
        },
    )

    assert payload["calibration_fingerprint"] == _FINGERPRINT
    assert payload["replay_provenance"] == {"1": "adopted", "2": "produced"}
    assert json.loads(artifact.read_text(encoding="utf-8")) == payload
