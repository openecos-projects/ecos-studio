"""CLI surface of the knowledge treatment runner: the value-policy cross cell."""

from __future__ import annotations

import pytest

from ecos_agent.optimization.experiments import knowledge_treatment_runner


def _run_main(monkeypatch: pytest.MonkeyPatch, value_policy: str | None) -> dict:
    captured: dict = {}

    def fake_run_experiment(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return {}

    monkeypatch.setattr(
        knowledge_treatment_runner, "run_experiment", fake_run_experiment
    )
    monkeypatch.setattr(
        knowledge_treatment_runner,
        "load_experiment_manifest",
        lambda *args, **kwargs: object(),
    )
    argv = [
        "runner",
        "--design-manifest", "manifest.json",
        "--benchmark-root", "bench",
        "--pdk-root", "pdk",
        "--workspace-root", "ws",
        "--output", "out",
        "--run-id", "run1",
        "--tool-revision", "0.1.0-alpha.11",
    ]
    if value_policy is not None:
        argv += ["--value-policy", value_policy]
    monkeypatch.setattr("sys.argv", argv)
    knowledge_treatment_runner.main(provider_factory=lambda **kwargs: None)
    return captured


def test_value_policy_defaults_to_model_free_values(monkeypatch) -> None:
    captured = _run_main(monkeypatch, None)
    assert captured["kwargs"]["value_policy"] == "model"


def test_lattice_value_policy_reaches_the_experiment(monkeypatch) -> None:
    captured = _run_main(monkeypatch, "lattice")
    assert captured["kwargs"]["value_policy"] == "lattice"


def test_unknown_value_policy_is_rejected(monkeypatch) -> None:
    with pytest.raises(SystemExit):
        _run_main(monkeypatch, "unbounded")
