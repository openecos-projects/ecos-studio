"""Workspace-relative directories recorded by ECC in home/flow.json."""

import json
from pathlib import Path


def step_directories(flow: object) -> dict[str, str]:
    if not isinstance(flow, dict) or not isinstance(flow.get("steps"), list):
        raise ValueError("Invalid ECC flow steps")
    directories = {}
    for step in flow["steps"]:
        if not isinstance(step, dict):
            raise ValueError("Invalid ECC flow step")
        name = step.get("name")
        directory = step.get("directory")
        if (
            not isinstance(name, str)
            or not name
            or not isinstance(directory, str)
            or Path(directory).name != directory
            or any(char in directory for char in ("\\", ":", "\0"))
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
    directory = step_directories(json.loads(ledger.read_text(encoding="utf-8"))).get(step)
    if directory is None:
        raise ValueError(f"ECC flow does not contain {step}")
    if (root / directory).is_symlink():
        raise ValueError("ECC step directory must not be a symlink")
    return directory
