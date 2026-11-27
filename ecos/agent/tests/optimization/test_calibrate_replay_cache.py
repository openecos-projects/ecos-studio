"""The replay cache re-parses on observation-code drift and fails closed on toolchain drift."""

import json
import shutil
from types import SimpleNamespace

import pytest

from ecos_agent.optimization.calibrate_workspace import (
    _load_replay_manifest,
    _run_replay,
    _store_replay_cache,
    write_noise_epsilon_artifact,
)
from ecos_agent.optimization.experiments.frozen_contexts import (
    OPPORTUNITY_CONTEXT_FILE,
    build_frozen_context,
)
from ecos_agent.optimization.experiments.opportunity_coverage import analyze_replay
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
    workspace = tmp_path / "ws"
    (workspace / "home").mkdir(parents=True)
    (workspace / "home/params.toml").write_text('[design]\nname = "other"\n', encoding="utf-8")
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._terminal_observation", _bomb
    )

    result = _run_replay(
        workspace, replay_root, 1, 60.0, dict(_FINGERPRINT)
    )

    assert result == observation
    assert json.loads(
        (replay_root / "replay-cache-manifest.v1.json").read_text(encoding="utf-8")
    )["provenance"] == "produced"


@pytest.mark.parametrize("parser_changed", [False, True])
def test_retained_managed_cache_saves_evidence_before_release(
    tmp_path, monkeypatch, parser_changed
) -> None:
    from ecos_agent.optimization import calibrate_workspace as calibration

    replay_root = tmp_path / "default-replay-1"
    managed = tmp_path / "managed-replay"
    managed.mkdir()
    observation = _terminal_observation()
    old = dict(_FINGERPRINT, parser_sha256="old") if parser_changed else _FINGERPRINT
    _store_replay_cache(replay_root, observation, old, "produced", managed)
    evidence = replay_root / OPPORTUNITY_CONTEXT_FILE
    if parser_changed:
        evidence.write_text("old evidence", encoding="utf-8")

    def save(root, directory, index, revision):
        assert (root, directory, index, revision) == (
            replay_root, managed, 1, _FINGERPRINT["ecc_revision"],
        )
        assert managed.is_dir()
        evidence.write_text("new evidence", encoding="utf-8")

    def release(*_args):
        assert evidence.read_text(encoding="utf-8") == "new evidence"
        managed.rmdir()

    monkeypatch.setattr(calibration, "_store_opportunity_context", save)
    monkeypatch.setattr(calibration, "_release_replay", release)
    monkeypatch.setattr(calibration, "_terminal_observation", lambda _path: observation)
    assert _run_replay(tmp_path / "ws", replay_root, 1, 60, _FINGERPRINT) == observation
    assert not managed.exists()
    assert _load_replay_manifest(replay_root)["components"] == _FINGERPRINT


def test_parser_change_reparses_cached_flow_artifacts(tmp_path, monkeypatch) -> None:
    replay_root = tmp_path / "default-replay-1"
    (replay_root / "workspace").mkdir(parents=True)
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


@pytest.mark.parametrize("cache", ["old_parser", "missing_context", "legacy_workspace"])
def test_unusable_workspace_reruns_the_flow_and_records_provenance(
    tmp_path, monkeypatch, cache
) -> None:
    replay_root = tmp_path / "default-replay-1"
    workspace = tmp_path / "ws"
    (workspace / "home").mkdir(parents=True)
    (workspace / "home/params.toml").write_text('[design]\nname = "gcd"\n', encoding="utf-8")
    if cache == "legacy_workspace":
        home = replay_root / "workspace" / "home"
        home.mkdir(parents=True)
        (home / "flow.json").write_text(
            json.dumps({"steps": [{"name": "Harden", "state": "Success"}]}),
            encoding="utf-8",
        )
    else:
        fingerprint = (
            dict(_FINGERPRINT, parser_sha256="old") if cache == "old_parser" else _FINGERPRINT
        )
        _store_replay_cache(
            replay_root, _terminal_observation(), fingerprint,
            "produced", tmp_path / "cleaned-replay",
        )
    managed_replay = tmp_path / "managed-replay"
    (managed_replay / "home").mkdir(parents=True)
    (managed_replay / "home" / "params.toml").write_text(
        '[design]\nname = "gcd"\n', encoding="utf-8"
    )
    opportunity = build_frozen_context({
        "design_id": "gcd",
        "objective_contract_sha256": "objective",
        "legal_domain_sha256": "domain",
        "knowledge_bundle_sha256": "catalog",
        "stratum": "knowledge_opportunity",
        "expected_behavior": "abstain",
        "label_evidence": "fixture has no supported actions",
        "planning_context": {
            "supported_action_view": {"actions": [], "matches": [], "candidate_refs": []},
        },
    })

    def capture(**kwargs):
        assert kwargs["workspace"] == managed_replay
        assert kwargs["ecc_revision"] == _FINGERPRINT["ecc_revision"]
        assert managed_replay.is_dir()
        return [opportunity]

    monkeypatch.setattr(
        "ecos_agent.optimization.experiments.knowledge_pilot.build_context_bank", capture
    )
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
                assert params == {"directory": str(workspace)}
                return {"workspaceHandle": "handle-parent"}
            if method == "workspace.deriveCalibrationReplay":
                assert params["workspaceHandle"] == "handle-parent"
                return {
                    "workspaceHandle": "handle-1",
                    "workspaceRevision": 2,
                    "directory": str(managed_replay),
                }
            if method == "workspace.run":
                return {
                    "operationId": "operation-1",
                    "state": "succeeded",
                    "workspaceId": "workspace-1",
                }
            if method == "workspace.releaseCalibrationReplay":
                assert _load_replay_manifest(replay_root)["components"] == _FINGERPRINT
                assert (replay_root / OPPORTUNITY_CONTEXT_FILE).is_file()
                shutil.rmtree(managed_replay)
                return {"ok": True}
            raise AssertionError(f"unexpected host method {method}")

    host = FakeHost()
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._require_host_transport",
        lambda: host,
    )

    result = _run_replay(workspace, replay_root, 1, 60.0, dict(_FINGERPRINT))
    assert host.calls[0][0] == "workspace.open"
    assert host.calls[1][0] == "workspace.deriveCalibrationReplay"
    method, payload = host.calls[2]
    assert payload.pop("idempotencyKey").startswith("noise-calibration.default-replay-1.")
    assert (method, payload) == (
        "workspace.run",
        {
            "workspaceHandle": "handle-1",
            "expectedWorkspaceRevision": 2,
            "rerun": True,
        },
    )

    assert result == produced
    assert host.calls[3] == ("workspace.releaseCalibrationReplay", host.calls[1][1])
    assert _load_replay_manifest(replay_root)["provenance"] == "produced"

    assert not managed_replay.exists()
    row = analyze_replay(
        "gcd", 1, replay_root, workspace, tmp_path,
        SimpleNamespace(catalog_sha256="catalog"), {},
    )
    assert row["context_fingerprint"] == opportunity["context_fingerprint"]
    assert row["covered_replay"] is False
    assert _run_replay(workspace, replay_root, 1, 60.0, _FINGERPRINT) == produced
    assert len(host.calls) == 4


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
