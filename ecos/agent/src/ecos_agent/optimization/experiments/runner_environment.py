"""Frozen runtime environment for the overnight experiment runners (P0.9).

Each planner model family connects through its own pinned CODEX_HOME with
proxy variables stripped; doing this by hand per shell export was the 0916
baseline run's repeated footgun.  GLM keeps the Studio-managed codex-glm
home; the second-model generalization check (FSE single-model review
response) pins gpt-5.6-terra to a sibling home so the two arms can never
share auth or a model catalog.  Secrets stay in the environment: this
module never reads, writes, or prints key material, it only fails loudly
when the key the target home requires is absent.
"""

from __future__ import annotations

import os
import sys
import tomllib
from pathlib import Path

_PROXY_VARIABLES = (
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ftp_proxy",
    "no_proxy",
)

_STUDIO_ROOT = Path.home() / ".local" / "share" / "ecos-studio"


def is_glm_model(model: str) -> bool:
    return model.startswith("glm")


def default_codex_home(model: str) -> Path:
    """GLM keeps the Studio-managed home; other models pin codex-terra."""
    return _STUDIO_ROOT / ("codex-glm" if is_glm_model(model) else "codex-terra")


def runner_model_from_argv(argv: list[str] | None = None) -> str:
    """``--model`` from the launcher argv so the env pin lands before argparse.

    Defaults to the GLM arm's model, matching the driver argparse defaults.
    """
    args = sys.argv if argv is None else argv
    for index, item in enumerate(args):
        if item == "--model" and index + 1 < len(args):
            return args[index + 1]
        if item.startswith("--model="):
            return item.split("=", 1)[1]
    return "glm-5.3-flash"


def apply_runner_environment(*, model: str, codex_home: str | None = None) -> dict[str, object]:
    """Pin CODEX_HOME for the model, require its key, and strip proxies.

    GLM models use the codex-glm home and require ZAI_API_KEY.  Any other
    model defaults to the codex-terra home and requires the env_key that
    home's config.toml declares for its active provider (none for auth-file
    providers).  Returns a redacted summary (paths and key names only) safe
    to print into run logs.
    """
    glm = is_glm_model(model)
    home = (
        codex_home
        or os.environ.get("ECOS_AGENT_CODEX_HOME", "").strip()
        or str(default_codex_home(model))
    )
    if not Path(home).is_dir():
        raise SystemExit(f"runner env: CODEX_HOME is unavailable: {home}")
    os.environ["CODEX_HOME"] = home
    required_key = "ZAI_API_KEY" if glm else _config_env_key(Path(home))
    if required_key and not os.environ.get(required_key):
        raise SystemExit(
            f"runner env: {required_key} is not set; the {model} path requires "
            "it in the environment (never pass it on the command line)"
        )
    stripped = []
    for name in _PROXY_VARIABLES:
        for key in (name, name.upper()):
            if key in os.environ:
                os.environ.pop(key)
                stripped.append(key)
    return {
        "CODEX_HOME": home,
        "model": model,
        "required_key": required_key or "none (codex auth config)",
        "proxy_variables_stripped": sorted(stripped),
    }


def _config_env_key(home: Path) -> str | None:
    """env_key the home's config.toml requires for its active provider."""
    try:
        payload = tomllib.loads((home / "config.toml").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        return None
    providers = payload.get("model_providers")
    name = payload.get("model_provider")
    if not isinstance(providers, dict) or not isinstance(name, str):
        return None
    provider = providers.get(name)
    key = provider.get("env_key") if isinstance(provider, dict) else None
    return key if isinstance(key, str) and key else None
