"""P0.9 runner env: per-model CODEX_HOME pins and proxy stripping."""

from __future__ import annotations

import os

from ecos_agent.optimization.experiments.runner_environment import (
    apply_runner_environment,
    runner_model_from_argv,
)


def _clear_proxy_variables(monkeypatch) -> None:
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


def test_glm_pins_home_requires_zai_key_and_strips_proxies(
    monkeypatch, tmp_path
) -> None:
    _clear_proxy_variables(monkeypatch)
    monkeypatch.setenv("ECOS_AGENT_CODEX_HOME", str(tmp_path))
    monkeypatch.setenv("ZAI_API_KEY", "test-key")
    for name in ("http_proxy", "HTTPS_PROXY", "all_proxy", "no_proxy"):
        monkeypatch.setenv(name, "http://old:3128")

    summary = apply_runner_environment(model="glm-5.3-flash")

    assert summary["CODEX_HOME"] == str(tmp_path)
    assert summary["model"] == "glm-5.3-flash"
    assert summary["required_key"] == "ZAI_API_KEY"
    assert set(summary["proxy_variables_stripped"]) == {
        "http_proxy",
        "HTTPS_PROXY",
        "all_proxy",
        "no_proxy",
    }
    assert "test-key" not in str(summary)
    assert os.environ.get("http_proxy") is None
    assert os.environ.get("HTTPS_PROXY") is None


def test_glm_fails_loudly_without_key(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ECOS_AGENT_CODEX_HOME", str(tmp_path))
    monkeypatch.delenv("ZAI_API_KEY", raising=False)

    try:
        apply_runner_environment(model="glm-5.3-flash")
    except SystemExit as exc:
        assert "ZAI_API_KEY" in str(exc)
    else:
        raise AssertionError("missing key must fail loudly")


def test_fails_loudly_with_unavailable_home(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ECOS_AGENT_CODEX_HOME", str(tmp_path / "missing"))
    try:
        apply_runner_environment(model="glm-5.3-flash")
    except SystemExit as exc:
        assert "unavailable" in str(exc)
    else:
        raise AssertionError("missing CODEX_HOME must fail loudly")


def test_terra_uses_default_home_and_config_env_key(monkeypatch, tmp_path) -> None:
    _clear_proxy_variables(monkeypatch)
    monkeypatch.delenv("ECOS_AGENT_CODEX_HOME", raising=False)
    monkeypatch.delenv("ZAI_API_KEY", raising=False)
    monkeypatch.setattr(
        "ecos_agent.optimization.experiments.runner_environment._STUDIO_ROOT",
        tmp_path,
    )
    home = tmp_path / "codex-terra"
    home.mkdir()
    (home / "config.toml").write_text(
        'model = "gpt-5.6-terra"\n'
        'model_provider = "sub2api"\n'
        "\n"
        "[model_providers.sub2api]\n"
        'env_key = "SUB2API_API_KEY"\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("SUB2API_API_KEY", "test-key")

    summary = apply_runner_environment(model="gpt-5.6-terra")

    assert summary["CODEX_HOME"] == str(home)
    assert summary["required_key"] == "SUB2API_API_KEY"
    assert "test-key" not in str(summary)
    assert os.environ["CODEX_HOME"] == str(home)


def test_terra_fails_loudly_without_provider_env_key(
    monkeypatch, tmp_path
) -> None:
    _clear_proxy_variables(monkeypatch)
    monkeypatch.delenv("ECOS_AGENT_CODEX_HOME", raising=False)
    monkeypatch.delenv("SUB2API_API_KEY", raising=False)
    monkeypatch.setattr(
        "ecos_agent.optimization.experiments.runner_environment._STUDIO_ROOT",
        tmp_path,
    )
    home = tmp_path / "codex-terra"
    home.mkdir()
    (home / "config.toml").write_text(
        'model_provider = "sub2api"\n'
        "[model_providers.sub2api]\n"
        'env_key = "SUB2API_API_KEY"\n',
        encoding="utf-8",
    )

    try:
        apply_runner_environment(model="gpt-5.6-terra")
    except SystemExit as exc:
        assert "SUB2API_API_KEY" in str(exc)
    else:
        raise AssertionError("missing provider env key must fail loudly")


def test_runner_model_defaults_to_glm_and_reads_both_argv_forms() -> None:
    assert runner_model_from_argv(["prog"]) == "glm-5.3-flash"
    assert runner_model_from_argv(["prog", "--model", "gpt-5.6-terra"]) == (
        "gpt-5.6-terra"
    )
    assert runner_model_from_argv(["prog", "--model=gpt-5.6-terra"]) == (
        "gpt-5.6-terra"
    )
