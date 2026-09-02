"""Frozen configuration and readiness gates for the RQ1 gap screen."""

from __future__ import annotations

import os
import platform
import re
import subprocess
from pathlib import Path
from typing import Any, Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
from ecos_agent.optimization.experiments.gate0 import (
    Gate0Baseline,
    Gate0Design,
    _ecc_executable,
    _pdk_site_width_dbu,
    _snapshot_path,
)
from ecos_agent.optimization.experiments.parameter_gap import KnobGapSummary
from ecos_agent.optimization.parameters.contracts import ParameterSemanticsCard
from ecos_agent.optimization.parameters.semantics import load_parameter_cards

_REVISION = re.compile(r"^[0-9a-f]{40}$")
_RUNTIME_VERSION = re.compile(
    r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


class ParameterGapError(RuntimeError):
    """The gap screen cannot produce trustworthy evidence."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ParameterGapConfig(_Model):
    schema_version: Literal["ecos.rq1_parameter_gap_config.v1"]
    expected_ecos_revision: str
    expected_ecc_revision: str
    expected_ecc_runtime_version: str
    expected_pdk_revision: str
    expected_ecc_executable_sha256: str
    pdk_root: str
    seed: Literal[0] = 0
    baseline_replays: Literal[3] = 3
    terminal_timeout_seconds: int | float = Field(gt=0)
    max_workers: Literal[1] = 1
    baseline: Gate0Baseline
    design: Gate0Design

    @field_validator(
        "expected_ecos_revision", "expected_ecc_revision", "expected_pdk_revision"
    )
    @classmethod
    def validate_revision(cls, value: str) -> str:
        if not _REVISION.fullmatch(value):
            raise ValueError("expected revision is invalid")
        return value

    @field_validator("expected_ecc_runtime_version")
    @classmethod
    def validate_runtime_version(cls, value: str) -> str:
        if not _RUNTIME_VERSION.fullmatch(value):
            raise ValueError("expected ECC runtime version is invalid")
        return value

    @field_validator("expected_ecc_executable_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("expected executable hash is invalid")
        return value

    @field_validator("pdk_root")
    @classmethod
    def validate_pdk_root(cls, value: str) -> str:
        if not value or "\x00" in value:
            raise ValueError("PDK root is invalid")
        return value


class ParameterGapResumeConfig(_Model):
    schema_version: Literal["ecos.rq1_parameter_gap_resume_config.v1"]
    source_run_id: str
    resume_id: str
    source_config_sha256: str
    expected_ecos_revision: str
    expected_ecc_revision: str
    expected_ecc_runtime_version: str
    expected_pdk_revision: str
    expected_ecc_executable_sha256: str
    pdk_root: str
    reason: Literal[
        "candidate_materialization_lifecycle_fix", "bounded_parallel_resume"
    ]
    previous_resume_id: str | None = None
    expected_previous_manifest_sha256: str | None = None
    max_workers: int = Field(default=1, ge=1, le=4)

    @field_validator("source_run_id", "resume_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,127}", value):
            raise ValueError("resume identifier is invalid")
        return value

    @field_validator("previous_resume_id")
    @classmethod
    def validate_previous_id(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,127}", value):
            raise ValueError("previous resume identifier is invalid")
        return value

    @field_validator("expected_previous_manifest_sha256")
    @classmethod
    def validate_previous_manifest_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("previous resume manifest hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_previous_resume_binding(self) -> "ParameterGapResumeConfig":
        if (self.previous_resume_id is None) != (
            self.expected_previous_manifest_sha256 is None
        ):
            raise ValueError("previous resume id and manifest hash must be paired")
        return self

    @field_validator("max_workers", mode="before")
    @classmethod
    def validate_max_workers(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("max workers must be an integer")
        return value

    @field_validator(
        "expected_ecos_revision", "expected_ecc_revision", "expected_pdk_revision"
    )
    @classmethod
    def validate_revision(cls, value: str) -> str:
        if not _REVISION.fullmatch(value):
            raise ValueError("expected revision is invalid")
        return value

    @field_validator("source_config_sha256", "expected_ecc_executable_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("expected hash is invalid")
        return value

    @field_validator("expected_ecc_runtime_version")
    @classmethod
    def validate_runtime_version(cls, value: str) -> str:
        if not _RUNTIME_VERSION.fullmatch(value):
            raise ValueError("expected ECC runtime version is invalid")
        return value

    @field_validator("pdk_root")
    @classmethod
    def validate_pdk_root(cls, value: str) -> str:
        if not value or "\x00" in value:
            raise ValueError("PDK root is invalid")
        return value


def load_parameter_gap_config(path: Path) -> ParameterGapConfig:
    config_path = Path(path).resolve()
    try:
        config = ParameterGapConfig.model_validate_json(
            config_path.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as exc:
        raise ParameterGapError("parameter gap config is invalid") from exc
    for snapshot in (config.design.rtl, config.design.filelist, config.design.sdc):
        source = _snapshot_path(config_path, snapshot)
        if source.is_symlink() or file_sha256(source) != snapshot.sha256:
            raise ParameterGapError(f"snapshot hash does not match: {snapshot.path}")
    return config


def load_parameter_gap_resume_config(path: Path) -> ParameterGapResumeConfig:
    try:
        return ParameterGapResumeConfig.model_validate_json(
            Path(path).resolve().read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as exc:
        raise ParameterGapError("parameter gap resume config is invalid") from exc


def screen_values(
    card: ParameterSemanticsCard, current: bool | int | float
) -> tuple[bool | int | float, ...]:
    lattice = tuple(card.requested_domain.values)
    if isinstance(current, bool):
        return (not current,)
    numeric = tuple(value for value in lattice if not isinstance(value, bool))
    lower = tuple(value for value in numeric if value < current)
    upper = tuple(value for value in numeric if value > current)
    selected = (
        numeric[0],
        lower[-1] if lower else None,
        upper[0] if upper else None,
        numeric[-1],
    )
    return tuple(
        dict.fromkeys(
            value for value in selected if value is not None and value != current
        )
    )


def overall_verdict(summaries: Iterable[KnobGapSummary]) -> str:
    verdicts = {item.verdict for item in summaries}
    if "gap_confirmed" in verdicts:
        return "gap_confirmed_on_gcd"
    if verdicts == {"no_gap_observed"}:
        return "no_gap_observed_on_gcd_at_fixed_context"
    return "indeterminate"


def readiness_report(config_path: Path) -> dict[str, Any]:
    path = Path(config_path).resolve()
    config = load_parameter_gap_config(path)
    agent_root = Path(__file__).resolve().parents[4]
    revisions = _repository_readiness(agent_root, config)
    pdk = _pdk_readiness(path, config)
    ecc = _ecc_readiness(config)
    cards = load_parameter_cards()
    return {
        "schema_version": "ecos.rq1_parameter_gap_readiness.v1",
        "ready": True,
        "config_sha256": file_sha256(path),
        **revisions,
        **ecc,
        **pdk,
        "parameter_cards": {
            knob.value: file_sha256(
                agent_root
                / "knowledge/optimization/parameter-effectiveness/cards"
                / f"{knob.value}.json"
            )
            for knob in cards
        },
        "inputs": {
            key: getattr(config.design, key).sha256
            for key in ("rtl", "filelist", "sdc")
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
        },
    }


def resume_readiness_report(config_path: Path, resume_config_path: Path) -> dict[str, Any]:
    path = Path(config_path).resolve()
    resume_path = Path(resume_config_path).resolve()
    config = load_parameter_gap_config(path)
    resume = load_parameter_gap_resume_config(resume_path)
    if file_sha256(path) != resume.source_config_sha256:
        raise ParameterGapError("source parameter gap config hash does not match")
    agent_root = Path(__file__).resolve().parents[4]
    revisions = _repository_readiness(agent_root, resume)
    pdk = _pdk_readiness(resume_path, resume)
    ecc = _ecc_readiness(resume)
    cards = load_parameter_cards()
    return {
        "schema_version": "ecos.rq1_parameter_gap_resume_readiness.v1",
        "ready": True,
        "source_run_id": resume.source_run_id,
        "resume_id": resume.resume_id,
        "previous_resume_id": resume.previous_resume_id,
        "expected_previous_manifest_sha256": (
            resume.expected_previous_manifest_sha256
        ),
        "max_workers": resume.max_workers,
        "resume_config_sha256": file_sha256(resume_path),
        "source_config_sha256": resume.source_config_sha256,
        **revisions,
        **ecc,
        **pdk,
        "parameter_cards": {
            knob.value: file_sha256(
                agent_root
                / "knowledge/optimization/parameter-effectiveness/cards"
                / f"{knob.value}.json"
            )
            for knob in cards
        },
        "inputs": {
            key: getattr(config.design, key).sha256 for key in ("rtl", "filelist", "sdc")
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
        },
    }


def _repository_readiness(
    agent_root: Path, config: ParameterGapConfig
) -> dict[str, str]:
    repo_root = agent_root.parents[1]
    ecos_revision = _git(repo_root, "rev-parse", "HEAD")
    ecc_revision = _git(repo_root / "ecc", "rev-parse", "HEAD")
    if ecos_revision != config.expected_ecos_revision:
        raise ParameterGapError("ECOS revision does not match frozen config")
    if ecc_revision != config.expected_ecc_revision:
        raise ParameterGapError("ECC revision does not match frozen config")
    for name, root in (("ECOS", repo_root), ("ECC", repo_root / "ecc")):
        if _git(root, "status", "--porcelain", "--untracked-files=no"):
            raise ParameterGapError(f"{name} tracked worktree is not clean")
    return {"ecos_revision": ecos_revision, "ecc_revision": ecc_revision}


def _pdk_readiness(
    config_path: Path, config: ParameterGapConfig
) -> dict[str, Any]:
    pdk_root = (config_path.parent / config.pdk_root).resolve()
    required = (
        "prtech/techLEF/N551P6M_ecos.lef",
        "IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CH/lef/ics55_LLSC_H7CH_ecos.lef",
        "IP/STD_cell/ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7CH/liberty/"
        "ics55_LLSC_H7CH_typ_tt_1p2_25_nldm.lib",
    )
    if pdk_root.is_symlink() or any(
        not (pdk_root / item).is_file() for item in required
    ):
        raise ParameterGapError("ICS55 PDK readiness check failed")
    revision = _git(pdk_root, "rev-parse", "HEAD")
    if revision != config.expected_pdk_revision:
        raise ParameterGapError("PDK revision does not match frozen config")
    site_width = _pdk_site_width_dbu(pdk_root)
    return {
        "pdk_root": str(pdk_root),
        "pdk_revision": revision,
        "site_width_dbu": site_width,
        "pdk": {"root": str(pdk_root), "site_width_dbu": site_width},
    }


def _ecc_readiness(config: ParameterGapConfig) -> dict[str, Any]:
    executable = _ecc_executable()
    executable_sha256 = file_sha256(executable)
    if executable_sha256 != config.expected_ecc_executable_sha256:
        raise ParameterGapError("ECC executable hash does not match frozen config")
    client = EccContentLengthRpcClient(executable, response_timeout_seconds=30)
    try:
        runtime_version = client.ecc_revision()
    finally:
        client.close()
    if runtime_version != config.expected_ecc_runtime_version:
        raise ParameterGapError("ECC runtime version does not match frozen config")
    return {
        "ecc_runtime_version": runtime_version,
        "ecc_executable": str(executable),
        "ecc_executable_sha256": executable_sha256,
        "ecc": {"executable": str(executable)},
    }


def _git(root: Path, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        raise ParameterGapError("git provenance check failed") from exc
