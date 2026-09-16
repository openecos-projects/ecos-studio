"""P0.9 runner env: GLM direct connection pins and proxy stripping."""

from __future__ import annotations

from ecos_agent.optimization.experiments.runner_environment import (
    apply_glm_runtime_environment,
)


def test_applies_pinned_home_and_strips_proxy_variables(
    monkeypatch, tmp_path
) -> None:
    for name in (
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "ftp_proxy",
        "no_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "FTP_PROXY",
        "NO_PROXY",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ECOS_AGENT_CODEX_HOME", str(tmp_path))
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    for name in ("http_proxy", "HTTPS_PROXY", "all_proxy", "no_proxy"):
        monkeypatch.setenv(name, "http://old:3128")

    summary = apply_glm_runtime_environment()

    import os

    assert summary["CODEX_HOME"] == str(tmp_path)
    assert set(summary["proxy_variables_stripped"]) == {
        "http_proxy",
        "HTTPS_PROXY",
        "all_proxy",
        "no_proxy",
    }
    assert "test-key" not in str(summary)
    assert os.environ.get("http_proxy") is None
    assert os.environ.get("HTTPS_PROXY") is None


def test_fails_loudly_without_key(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ECOS_AGENT_CODEX_HOME", str(tmp_path))
    monkeypatch.delenv("ZAI_API_KEY", raising=False)

    try:
        apply_glm_runtime_environment()
    except SystemExit as exc:
        assert "ZAI_API_KEY" in str(exc)
    else:
        raise AssertionError("missing key must fail loudly")


def test_fails_loudly_with_unavailable_home(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ECOS_AGENT_CODEX_HOME", str(tmp_path / "missing"))
    try:
        apply_glm_runtime_environment()
    except SystemExit as exc:
        assert "unavailable" in str(exc)
    else:
        raise AssertionError("missing CODEX_HOME must fail loudly")
