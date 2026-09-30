"""Cache-only reuse must never dispatch or rewrite historical evidence."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.experiments import calibration_reuse as reuse
from ecos_agent.optimization.experiments import knowledge_treatment_execution as execution
from ecos_agent.optimization.observation_contracts import deterministic_noise_profile
from tests.optimization.experiments.equal_budget_support import _terminal_observation


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def _seal(path, payload):
    payload.pop("manifest_sha256", None)
    payload["manifest_sha256"] = canonical_sha256(payload)
    _write(path, payload)


@pytest.fixture
def donor(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("cache-only must not execute calibration, ECC or prebuild")

    for name in ("_run_default_replay", "_calibrate", "_ensure_workspace", "_run_canonical_flow"):
        monkeypatch.setattr(execution, name, forbidden)
    context = {
        "calibration_protocol": "phase8-default-replay-v1",
        "ecc_executable_sha256": canonical_sha256("ecc"),
        "pdk_revision": "pdk-revision",
        "design_inputs": {"gcd.v": canonical_sha256("rtl")},
        "baseline": {"frequency_mhz": 100},
        "flow_steps": ["Synthesis", "Harden"],
    }
    provenance = {"ecos_revision": "old", "ecc_revision": "ecc-revision", "pdk_revision": "pdk-revision"}
    monkeypatch.setattr(reuse, "_noise_context_payload", lambda *a: context)
    monkeypatch.setattr(reuse, "_noise_context_provenance", lambda *a: provenance)
    monkeypatch.setattr(reuse, "_verify_workspace_binding", lambda *a: None)
    monkeypatch.setattr(reuse, "_workspace_flow_succeeded", lambda *a: True)
    root = tmp_path / "donor"
    obs = [_terminal_observation(), _terminal_observation()]
    # Preserve real nonzero noise rather than forcing epsilon to zero.
    metric = next(iter(obs[1].metrics))
    obs[1] = obs[1].model_copy(update={"metrics": {**obs[1].metrics, metric: obs[1].metrics[metric] + 2}})
    payloads = {
        "noise-context.v1.json": {"schema_version": "ecos.noise_context.v2", "context": context.copy(), "provenance": provenance.copy(), "fingerprint": canonical_sha256(context)},
        "noise-epsilon.v1.json": {"schema_version": "ecos.noise_epsilon.v1", "comparison_key": "(metric_id, corner)", "noise_context_fingerprint": canonical_sha256(context), "replay_count": 2, **deterministic_noise_profile(obs)},
    }
    for i, observation in enumerate(obs, 1):
        payloads[f"default-replay-{i}/terminal-observation.v1.json"] = observation.model_dump(mode="json")
        payloads[f"default-replay-{i}/runtime.v1.json"] = {"elapsed_seconds": i * 10.0}
    for name, data in payloads.items():
        _write(root / name, data)
    _write(root / "candidate-receipt.json", {"must_not_copy": True})
    spec = {
        "schema_version": "ecos.calibration_reuse.v1", "design_id": "gcd",
        "donor_root": str(root), "replay_count": 2,
        "donor_fingerprint": canonical_sha256(context),
        "target_fingerprint": canonical_sha256(context),
        "target_runtime_sha256": canonical_sha256({"context": context, "provenance": provenance}),
        "artifact_sha256": {name: file_sha256(root / name) for name in payloads},
    }
    path = tmp_path / "reuse.json"
    _seal(path, spec)
    return SimpleNamespace(root=root, path=path, spec=spec, context=context, provenance=provenance, output=tmp_path / "output", observations=obs)


def _run(d):
    return reuse.reuse_calibration(None, SimpleNamespace(design_id="gcd"), Path("workspace"), d.path, d.output)


def _update_artifact(d, name, change):
    path = d.root / name
    data = json.loads(path.read_text())
    change(data)
    _write(path, data)
    d.spec["artifact_sha256"][name] = file_sha256(path)
    _seal(d.path, d.spec)


def test_reuses_only_verified_noise_bytes_and_is_idempotent(donor):
    before = {p: p.read_bytes() for p in donor.root.rglob("*.json")}
    reference, runtime, noise = _run(donor)
    assert reference == donor.observations[0]
    assert runtime == 15.0
    assert max(noise["epsilon"].values()) == 2
    assert noise["replay_count"] == 2
    assert not (donor.output / "candidate-receipt.json").exists()
    assert all(p.read_bytes() == data for p, data in before.items())
    for name in donor.spec["artifact_sha256"]:
        assert (donor.output / name).read_bytes() == (donor.root / name).read_bytes()
    assert _run(donor) == (reference, runtime, noise)


@pytest.mark.parametrize("case", ["missing", "tampered", "schema", "identity", "self_hash", "fingerprint", "target", "runtime_pin", "one_replay", "extra_artifact", "epsilon", "observation"])
def test_fail_closed_without_replay(donor, case):
    if case == "missing":
        (donor.root / "default-replay-2/runtime.v1.json").unlink()
    elif case == "tampered":
        (donor.root / "default-replay-2/runtime.v1.json").write_text('{"elapsed_seconds": 1000}')
    elif case in ("schema", "identity", "fingerprint", "target", "runtime_pin", "one_replay", "extra_artifact"):
        key, value = {
            "schema": ("schema_version", "wrong"), "identity": ("design_id", "xtea"),
            "fingerprint": ("donor_fingerprint", canonical_sha256("wrong")),
            "target": ("target_fingerprint", canonical_sha256("wrong")),
            "runtime_pin": ("target_runtime_sha256", canonical_sha256("wrong")),
            "one_replay": ("replay_count", 1),
            "extra_artifact": ("artifact_sha256", {**donor.spec["artifact_sha256"], "candidate-receipt.json": file_sha256(donor.root / "candidate-receipt.json")}),
        }[case]
        donor.spec[key] = value
        _seal(donor.path, donor.spec)
    elif case == "self_hash":
        donor.spec["design_id"] = "xtea"
        _write(donor.path, donor.spec)
    elif case == "epsilon":
        _update_artifact(donor, "noise-epsilon.v1.json", lambda p: p.update(epsilon={k: 0 for k in p["epsilon"]}))
    else:
        _update_artifact(donor, "default-replay-2/terminal-observation.v1.json", lambda p: p.update(evidence_valid=False))
    with pytest.raises((ValueError, OSError)):
        _run(donor)
    assert not donor.output.exists()


@pytest.mark.parametrize("runtime", [True, 0, -1, "12", float("inf"), float("nan")])
def test_invalid_runtime_is_not_repaired(donor, runtime):
    _update_artifact(donor, "default-replay-2/runtime.v1.json", lambda p: p.update(elapsed_seconds=runtime))
    with pytest.raises(ValueError):
        _run(donor)


def test_reviewed_legacy_mapping_preserves_old_fingerprint(donor):
    legacy = {**donor.context, **donor.provenance}
    legacy.pop("calibration_protocol")
    legacy["design_inputs"] = {**legacy["design_inputs"], "filelist": canonical_sha256("list"), "filelist.f": canonical_sha256("list")}
    donor.context["design_inputs"]["filelist.f"] = canonical_sha256("list")
    fingerprint = canonical_sha256(legacy)
    _update_artifact(donor, "noise-context.v1.json", lambda p: p.update(schema_version="ecos.noise_context.v1", context=legacy, fingerprint=fingerprint, provenance={}))
    _update_artifact(donor, "noise-epsilon.v1.json", lambda p: p.update(noise_context_fingerprint=fingerprint))
    donor.provenance["ecos_revision"] = "new"
    donor.spec.update(donor_fingerprint=fingerprint, target_fingerprint=canonical_sha256(donor.context), target_runtime_sha256=canonical_sha256({"context": donor.context, "provenance": donor.provenance}))
    _seal(donor.path, donor.spec)
    with pytest.raises(ValueError, match="reviewed runtime mapping"):
        _run(donor)
    donor.spec["runtime_mapping"] = {"reviewed_by": "mainline-review", "reason": "Agent wiring only; ECC and physical inputs unchanged", "unchanged_ecc_and_physical_inputs": True}
    _seal(donor.path, donor.spec)
    _run(donor)
    assert json.loads((donor.output / "noise-context.v1.json").read_text())["fingerprint"] == fingerprint
    receipt = json.loads((donor.output / "calibration-reuse.v1.json").read_text())
    assert receipt["new_default_flow_replays"] == 0


@pytest.mark.parametrize("change", ["ecc_executable_sha256", "design_inputs", "baseline", "flow_steps", "pdk_revision", "ecc_revision"])
def test_approval_cannot_override_physical_contract(donor, change):
    if change == "ecc_revision":
        donor.provenance[change] = "changed"
    else:
        donor.context[change] = "changed"
    donor.spec.update(target_fingerprint=canonical_sha256(donor.context), target_runtime_sha256=canonical_sha256({"context": donor.context, "provenance": donor.provenance}), runtime_mapping={"reviewed_by": "reviewer", "reason": "not sufficient", "unchanged_ecc_and_physical_inputs": True})
    _seal(donor.path, donor.spec)
    with pytest.raises(ValueError):
        _run(donor)


def test_conflicting_output_not_overwritten(donor):
    _write(donor.output / "candidate-receipt.json", {"unrelated": True})
    with pytest.raises(ValueError, match="output"):
        _run(donor)
    assert json.loads((donor.output / "candidate-receipt.json").read_text()) == {"unrelated": True}
