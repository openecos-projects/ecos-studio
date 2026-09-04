#!/usr/bin/env python3
"""Build every committed, source-audited ECOS knowledge bundle."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from . import steps


AGENT_ROOT = Path(__file__).parents[4]
DEFAULT_OUTPUT = AGENT_ROOT / "knowledge"


def _build(output: Path) -> None:
    steps.build_all(output)


def _tree(root: Path) -> dict[Path, bytes]:
    return {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}


def _normalised_tree(root: Path) -> dict[Path, bytes]:
    # Authoring inputs and parameter-effectiveness cards are not emitted by
    # the stage-bundle generator.
    return {
        path: value
        for path, value in _tree(root).items()
        if path.parts[0] not in {"inputs", "optimization"}
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.check:
        _build(args.output)
        return 0
    with tempfile.TemporaryDirectory() as directory:
        generated = Path(directory)
        _build(generated)
        if _normalised_tree(generated) != _normalised_tree(args.output):
            raise SystemExit("knowledge bundles are stale; run scripts/build_knowledge.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
