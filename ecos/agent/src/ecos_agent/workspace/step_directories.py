"""Workspace-relative directories recorded by ECC in home/flow.json."""

import json
from pathlib import Path


def step_directories(flow: dict) -> dict[str, str]:
    directories = {}
    for step in flow["steps"]:
        name = step["name"]
        directory = step["directory"]
        if (
            not isinstance(directory, str)
            or Path(directory).name != directory
            or directory in {"", ".", ".."}
            or name in directories
        ):
            raise ValueError(f"Invalid ECC step directory for {name}")
        directories[name] = directory
    return directories


def step_directory(root: Path, step: str) -> str:
    ledger = root / "home" / "flow.json"
    if not ledger.resolve().is_relative_to(root.resolve()):
        raise ValueError("ECC flow ledger is outside the workspace")
    directory = step_directories(json.loads(ledger.read_text(encoding="utf-8")))[step]
    if (root / directory).is_symlink():
        raise ValueError("ECC step directory must not be a symlink")
    return directory
