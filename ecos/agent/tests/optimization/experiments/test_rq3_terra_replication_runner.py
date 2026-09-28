"""Isolated Terra RQ3 launcher contract; no provider or ECC execution."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from ecos_agent.optimization.experiments.runner_environment import default_codex_home

SCRIPT = Path(__file__).parents[3] / "scripts/run_rq3_terra_replication.py"


def _load_runner():
    spec = importlib.util.spec_from_file_location("run_rq3_terra_replication", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_forwards_only_frozen_terra_model_and_effort(monkeypatch) -> None:
    runner = _load_runner()
    captured = {}

    def fake_environment(*, model):
        captured["environment_model"] = model
        return {"model": model}

    def fake_run(provider):
        captured["provider"] = provider
        captured["argv"] = sys.argv.copy()
        return 17

    monkeypatch.setattr(runner, "apply_runner_environment", fake_environment)
    monkeypatch.setattr(runner, "run_closed_loop", fake_run)
    monkeypatch.setattr(sys, "argv", ["runner"])

    assert runner.main(["--design", "gcd"]) == 17
    assert captured["environment_model"] == "gpt-5.6-terra"
    assert captured["provider"] is runner.CodexAppServerProposalProvider
    assert captured["argv"] == [
        "runner",
        "--design",
        "gcd",
        "--model",
        "gpt-5.6-terra",
        "--reasoning-effort",
        "medium",
    ]


@pytest.mark.parametrize(
    "override",
    (
        ["--model", "glm-5.3-flash"],
        ["--model=glm-5.3-flash"],
        ["--reasoning-effort", "high"],
        ["--reasoning-effort=high"],
    ),
)
def test_rejects_model_and_effort_overrides(override) -> None:
    runner = _load_runner()
    with pytest.raises(SystemExit, match="frozen by the Terra RQ3 contract"):
        runner.main(override)


def test_terra_runtime_home_is_separate_from_glm() -> None:
    terra = default_codex_home("gpt-5.6-terra")
    glm = default_codex_home("glm-5.3-flash")
    assert terra.name == "codex-terra"
    assert glm.name == "codex-glm"
    assert terra != glm
