"""Consume ECC's resolved PDK evidence; never guess process paths or sites."""

import json
import re
from pathlib import Path

from ecos_agent.hashing import file_sha256


def _context(workspace: Path) -> dict:
    path = workspace / "home" / "ecc-pdk-context.json"
    try:
        context = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("resolved PDK context is unavailable; recreate the workspace with ECC") from exc
    if not isinstance(context, dict) or context.get("schema_version") != 1:
        raise ValueError("unsupported resolved PDK context")
    digest = context.get("content_digest")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("invalid PDK content digest")
    return context


def pdk_fingerprint(workspace: Path) -> str:
    """Verify all locked resources and return ECC's complete content identity."""
    context = _context(workspace)
    root = Path(context["resource_root"]).resolve()
    resources = context.get("resources")
    if not isinstance(resources, dict) or not resources:
        raise ValueError("PDK resource evidence is unavailable")
    for resource in resources.values():
        path = (root / resource["path"]).resolve()
        if not path.is_relative_to(root) or file_sha256(path).removeprefix("sha256:") != resource["sha256"]:
            raise ValueError("PDK content differs from the resolved workspace context")
    return "sha256:" + context["content_digest"]


def site_width_dbu(workspace: Path) -> int:
    """Use ECC's selected site and unit conversion, not a second LEF parser."""
    width = _context(workspace).get("site_width_dbu")
    if type(width) is not int or width <= 0:
        raise ValueError("PDK site width is unavailable")
    return width
