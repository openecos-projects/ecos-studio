"""Fail-closed, read-only donor validation; no replay/prebuild execution path.

``--calibration-donor`` names a self-hashed ``ecos.calibration_reuse.v1``
manifest, not an unverified index or a candidate directory. Mainline must
review/freeze this manifest; its self-hash is integrity, not a signature.
Only the named noise context, noise profile and default replay observations/
runtimes are copied, byte-for-byte. Historical fingerprints are never rebased.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import TerminalObservation
from ecos_agent.optimization.experiments.knowledge_treatment_execution import (
    DesignSpec,
    ExperimentManifest,
    _noise_context_payload,
    _noise_context_provenance,
    _semantic_noise_context,
    _verify_workspace_binding,
    _workspace_flow_succeeded,
)
from ecos_agent.optimization.observation_contracts import deterministic_noise_profile

Sha256 = Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]
Nonempty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class RuntimeMapping(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    reviewed_by: Nonempty
    reason: Nonempty
    unchanged_ecc_and_physical_inputs: Literal[True]


class CalibrationReuseManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal["ecos.calibration_reuse.v1"]
    design_id: Nonempty
    donor_root: Nonempty
    replay_count: int = Field(ge=2)
    donor_fingerprint: Sha256
    target_fingerprint: Sha256
    # canonical_sha256({"context": _noise_context_payload(...),
    #                   "provenance": _noise_context_provenance(...)})
    target_runtime_sha256: Sha256
    artifact_sha256: dict[str, Sha256]
    runtime_mapping: RuntimeMapping | None = None
    manifest_sha256: Sha256


def _json_object(data: bytes) -> dict:
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("calibration artifact must be a JSON object")
    return value


def _provenance(payload: dict) -> dict:
    context = payload["context"]
    provenance = payload.get("provenance", {})
    if not isinstance(provenance, dict):
        raise ValueError("invalid donor provenance")
    result = {}
    for key in ("ecos_revision", "ecc_revision", "pdk_revision"):
        value = provenance.get(key, context.get(key))
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"missing donor runtime identity: {key}")
        if key in context and context[key] != value:
            raise ValueError(f"conflicting donor runtime identity: {key}")
        result[key] = value
    return result


def reuse_calibration(
    manifest: ExperimentManifest,
    design: DesignSpec,
    workspace: Path,
    donor_manifest: Path,
    output: Path,
) -> tuple[TerminalObservation, float, dict[str, object]]:
    """Validate everything before writing; a missing cache always raises.

    The target workspace must already be prepared by its owner. This function
    cannot create/repair a workspace or call ``_calibrate``/``_run_default_replay``.
    ``replay_count`` and epsilon come from the frozen donor, not a CLI default.
    """
    raw = _json_object(donor_manifest.read_bytes())
    spec = CalibrationReuseManifest.model_validate(raw)
    if spec.manifest_sha256 != canonical_sha256(
        {k: v for k, v in raw.items() if k != "manifest_sha256"}
    ):
        raise ValueError("calibration reuse manifest hash mismatch")
    if spec.design_id != design.design_id:
        raise ValueError("calibration donor design identity mismatch")
    donor = Path(spec.donor_root)
    if not donor.is_absolute():
        raise ValueError("calibration donor_root must be absolute")
    donor = donor.resolve(strict=True)
    target = output.resolve()
    if target == donor or target.is_relative_to(donor) or donor.is_relative_to(target):
        raise ValueError("calibration output must be separate from donor")
    names = {"noise-context.v1.json", "noise-epsilon.v1.json"}
    for index in range(1, spec.replay_count + 1):
        names.update(f"default-replay-{index}/{name}.v1.json" for name in ("terminal-observation", "runtime"))
    if set(spec.artifact_sha256) != names:
        raise ValueError("calibration artifact allowlist mismatch")
    artifacts = {}
    for name in sorted(names):
        path = donor / name
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(donor):
            raise ValueError("calibration donor artifact escapes donor root")
        data = path.read_bytes()
        if "sha256:" + hashlib.sha256(data).hexdigest() != spec.artifact_sha256[name]:
            raise ValueError(f"calibration artifact hash mismatch: {name}")
        artifacts[name] = data
    stored = _json_object(artifacts["noise-context.v1.json"])
    if stored.get("schema_version") not in ("ecos.noise_context.v1", "ecos.noise_context.v2"):
        raise ValueError("unsupported noise context schema")
    context = stored.get("context")
    if not isinstance(context, dict) or stored.get("fingerprint") != canonical_sha256(context):
        raise ValueError("invalid donor noise context fingerprint")
    if stored["fingerprint"] != spec.donor_fingerprint:
        raise ValueError("donor fingerprint does not match manifest")
    donor_provenance = _provenance(stored)

    # These helpers only read existing files; never use _ensure_workspace here.
    _verify_workspace_binding(manifest, design, workspace)
    if not _workspace_flow_succeeded(workspace):
        raise ValueError("cache-only requires an already prepared workspace")
    current = _noise_context_payload(manifest, workspace)
    provenance = _noise_context_provenance(manifest)
    if canonical_sha256(current) != spec.target_fingerprint:
        raise ValueError("target noise context fingerprint mismatch")
    if canonical_sha256({"context": current, "provenance": provenance}) != spec.target_runtime_sha256:
        raise ValueError("target runtime identity hash mismatch")
    # Compatibility can remove legacy metadata/duplicate filelist aliases, but
    # never permit changed ECC, RTL/SDC, PDK, baseline or flow steps.
    if _semantic_noise_context(context) != current or any(
        donor_provenance[key] != provenance.get(key) for key in ("ecc_revision", "pdk_revision")
    ):
        raise ValueError("calibration ECC or physical contract changed")
    if (spec.donor_fingerprint != spec.target_fingerprint or donor_provenance != provenance) and spec.runtime_mapping is None:
        raise ValueError("calibration reuse requires an explicit reviewed runtime mapping")

    observations, runtimes = [], []
    for index in range(1, spec.replay_count + 1):
        prefix = f"default-replay-{index}"
        observation = TerminalObservation.model_validate_json(artifacts[f"{prefix}/terminal-observation.v1.json"])
        if not observation.evidence_valid or not observation.harden_artifacts_complete or observation.consistency_violations:
            raise ValueError("invalid calibration terminal evidence")
        runtime = _json_object(artifacts[f"{prefix}/runtime.v1.json"]).get("elapsed_seconds")
        if isinstance(runtime, bool) or not isinstance(runtime, (int, float)) or not math.isfinite(runtime) or runtime <= 0:
            raise ValueError("invalid calibration replay runtime")
        observations.append(observation)
        runtimes.append(float(runtime))
    noise = _json_object(artifacts["noise-epsilon.v1.json"])
    if (
        noise.get("schema_version") != "ecos.noise_epsilon.v1"
        or noise.get("comparison_key") != "(metric_id, corner)"
        or noise.get("noise_context_fingerprint") != spec.donor_fingerprint
        or type(noise.get("replay_count")) is not int
        or noise["replay_count"] != spec.replay_count
    ):
        raise ValueError("invalid donor noise schema/identity/count")
    profile = deterministic_noise_profile(observations)
    for key in ("reference", "epsilon"):
        values = noise.get(key)
        if not isinstance(values, dict) or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in values.values()
        ) or values != profile[key]:
            raise ValueError(f"donor noise {key} does not match replay data")
    runtime = statistics.median(runtimes)
    receipt = {
        "schema_version": "ecos.calibration_reuse_receipt.v1",
        "manifest": raw,
        "target_context": current,
        "target_provenance": provenance,
        "reference_runtime_seconds": runtime,
        "new_default_flow_replays": 0,
    }
    artifacts["calibration-reuse.v1.json"] = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode()
    # Same-ID continuation is permitted only for identical owned artifacts.
    # Never overwrite conflicting data or let inherited candidate files hide here.
    if output.exists():
        for path in output.rglob("*"):
            name = path.relative_to(output).as_posix()
            if path.is_symlink() or (path.is_file() and (name not in artifacts or path.read_bytes() != artifacts[name])):
                raise ValueError("conflicting calibration output")
    for name, data in artifacts.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            with path.open("xb") as stream:
                stream.write(data)
    return observations[0], runtime, {
        "artifact": str(output / "noise-epsilon.v1.json"),
        "replay_count": spec.replay_count,
        "metric_key_count": len(noise["epsilon"]),
        "drifting_metric_keys": sorted(k for k, v in noise["epsilon"].items() if v > 0),
        "epsilon": noise["epsilon"],
    }
