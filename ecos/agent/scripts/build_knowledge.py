#!/usr/bin/env python3
"""Build every committed, source-audited ECOS knowledge bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path

from knowledge import steps


AGENT_ROOT = Path(__file__).parents[1]
DEFAULT_OUTPUT = AGENT_ROOT / "knowledge"


def _build(output: Path) -> None:
    steps.build_all(output)


def _tree(root: Path) -> dict[Path, bytes]:
    return {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def _normalised_tree(root: Path) -> dict[Path, bytes]:
    # Parameter-effectiveness cards are maintained by their own manifest and
    # are not emitted by the stage-bundle generator.
    tree = {
        path: value
        for path, value in _tree(root).items()
        if path.parts[:1] != ("optimization",)
    }
    for sources_path in (path for path in tree if path.name == "sources.json"):
        sources = json.loads(tree[sources_path])
        for repository in sources["repositories"]:
            sources["repositories"][repository] = "<workspace-revision>"
        sources_bytes = _json_bytes(sources)
        tree[sources_path] = sources_bytes
        manifest_path = sources_path.with_name("manifest.json")
        manifest = json.loads(tree[manifest_path])
        manifest["files"]["sources.json"] = hashlib.sha256(sources_bytes).hexdigest()
        tree[manifest_path] = _json_bytes(manifest)
    return tree


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
