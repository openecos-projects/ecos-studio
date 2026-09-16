"""Frozen runtime environment for the overnight experiment runners (P0.9).

The GLM planning path must connect directly to the pinned CODEX_HOME with
proxy variables stripped; doing this by hand per shell export was the 0916
baseline run's repeated footgun.  Secrets stay in the environment: this
module never reads, writes, or prints key material, it only fails loudly
when the key is absent.
"""

from __future__ import annotations

import os
from pathlib import Path

_PROXY_VARIABLES = (
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ftp_proxy",
    "no_proxy",
)

_DEFAULT_CODEX_HOME = Path.home() / ".local" / "share" / "ecos-studio" / "codex-glm"


def apply_glm_runtime_environment(*, codex_home: str | None = None) -> dict[str, object]:
    """Pin CODEX_HOME, require the GLM key, and strip proxy variables.

    Returns a redacted summary (paths and stripped variable names only) safe
    to print into run logs.
    """
    home = (
        codex_home
        or os.environ.get("ECOS_AGENT_CODEX_HOME", "").strip()
        or str(_DEFAULT_CODEX_HOME)
    )
    if not Path(home).is_dir():
        raise SystemExit(f"runner env: CODEX_HOME is unavailable: {home}")
    os.environ["CODEX_HOME"] = home
    if not os.environ.get("ZAI_API_KEY"):
        raise SystemExit(
            "runner env: ZAI_API_KEY is not set; the GLM direct path requires "
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
        "proxy_variables_stripped": sorted(stripped),
        "zai_api_key": "present (value not read)",
    }
