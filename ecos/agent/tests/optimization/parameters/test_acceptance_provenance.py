from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.optimization.parameters import acceptance
from tests.optimization.parameters.acceptance_support import terminal, write_candidate
from tests.optimization.parameters.acceptance_trace_support import (
    build_acceptance,
    patch_acceptance_for_single_knob,
    write_trace,
)


def test_acceptance_rejects_planning_domain_receipt_context_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = write_candidate(workspace)
    observation = terminal()
    episode_root = write_trace(
        workspace,
        paths,
        observation,
        domain_context_sha256="sha256:" + "b" * 64,
    )
    patch_acceptance_for_single_knob(monkeypatch, observation)

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert any(
        "planning domain context" in issue for issue in report["entries"][0]["issues"]
    )


def test_acceptance_is_not_current_when_ecc_gitlink_differs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    output = tmp_path / "output"
    paths = write_candidate(workspace)
    observation = terminal()
    episode_root = write_trace(workspace, paths, observation)
    patch_acceptance_for_single_knob(monkeypatch, observation)
    revisions = acceptance._current_revisions()
    monkeypatch.setattr(
        acceptance,
        "_current_revisions",
        lambda: {**revisions, "ecc_gitlink_revision": "ecc-other-revision"},
    )

    build_acceptance(workspace, output, (episode_root,))

    report = json.loads(
        (output / "acceptance-report.v1.json").read_text(encoding="utf-8")
    )
    assert report["classification"] == "Engineering Incomplete"
    assert report["provenance"]["current"] is False
