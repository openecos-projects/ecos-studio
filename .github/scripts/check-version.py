#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path


expected_tag = os.environ.get("EXPECTED_TAG", "").strip()


def normalize_version(v: str) -> str:
    """Normalize semver prerelease tags (e.g. 0.1.0-alpha.3) to PEP 440 (e.g. 0.1.0a3)
    so they can be compared with uv.lock / packaging canonical forms."""
    return re.sub(r"-(alpha|beta|rc)\.?(\d+)", lambda m: m.group(1)[0] + m.group(2), v)


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def read_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def parse_regex(
    path: str,
    pattern: str,
    *,
    flags: int = 0,
    label: str | None = None,
) -> str:
    text = read(path)
    match = re.search(pattern, text, flags)
    if not match:
        raise SystemExit(f"ERROR: failed to parse {label or path}")
    return match.group(1)


def iter_workspace_package_manifests() -> list[Path]:
    manifests: list[Path] = []
    for pattern in ("ecos/gui/apps/*/package.json", "ecos/gui/packages/*/package.json"):
        manifests.extend(sorted(Path().glob(pattern)))
    return manifests


versions: list[tuple[str, str]] = []

module_version = parse_regex(
    "MODULE.bazel",
    r'(?m)^\s*version\s*=\s*"([^"]+)"',
    label="MODULE.bazel version",
)
versions.append(("MODULE.bazel", module_version))

gui_package = read_json("ecos/gui/package.json")["version"]
versions.append(("ecos/gui/package.json", gui_package))

for manifest in iter_workspace_package_manifests():
    package_json = read_json(manifest)
    version = package_json.get("version")
    if version is None:
        continue
    versions.append((str(manifest), version))

gui_default_nix = parse_regex(
    "ecos/gui/default.nix",
    r'(?m)^\s*version\s*=\s*"([^"]+)"\s*;',
    label="ecos/gui/default.nix version",
)
versions.append(("ecos/gui/default.nix", gui_default_nix))

print("Detected versions:")
for name, value in versions:
    print(f"  {name}: {value}")

normalized_module = normalize_version(module_version)
mismatches = [
    (name, value)
    for name, value in versions
    if normalize_version(value) != normalized_module
]
if mismatches:
    print("")
    print(
        "ERROR: version mismatch detected. "
        f"Expected all files to match MODULE.bazel ({module_version}).",
        file=sys.stderr,
    )
    for name, value in mismatches:
        print(f"  {name}: {value}", file=sys.stderr)
    sys.exit(1)

tag = f"v{module_version}"
if expected_tag and expected_tag != tag:
    print(
        f"ERROR: tag mismatch. expected {tag} from version files, got {expected_tag}.",
        file=sys.stderr,
    )
    sys.exit(1)

github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
if github_output:
    with open(github_output, "a", encoding="utf-8") as fh:
        fh.write(f"version={module_version}\n")
        fh.write(f"tag={tag}\n")

print("")
print(f"Version check passed: {module_version}")
