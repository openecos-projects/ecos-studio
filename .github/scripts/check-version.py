#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path


expected_tag = os.environ.get("EXPECTED_TAG", "").strip()
expected_ref = (os.environ.get("EXPECTED_REF") or expected_tag).strip()


def normalize_version(v: str) -> str:
    """Normalize semver prerelease tags (e.g. 0.1.0-alpha.3) to PEP 440 (e.g. 0.1.0a3)
    so they can be compared with uv.lock / packaging canonical forms."""
    return re.sub(r"-(alpha|beta|rc)\.?(\d+)", lambda m: m.group(1)[0] + m.group(2), v)


def normalize_expected_version(ref: str) -> str:
    if not ref:
        return ""
    if ref.startswith("refs/tags/v"):
        return ref.removeprefix("refs/tags/v")
    if ref.startswith("refs/heads/release/v"):
        return ref.removeprefix("refs/heads/release/v")
    if ref.startswith("release/v"):
        return ref.removeprefix("release/v")
    if ref.startswith("v"):
        return ref.removeprefix("v")

    print(f"ERROR: unsupported expected ref '{ref}'", file=sys.stderr)
    raise SystemExit(1)


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

normalized_release_version = normalize_version(gui_package)
mismatches = [
    (name, value)
    for name, value in versions
    if normalize_version(value) != normalized_release_version
]
if mismatches:
    print("")
    print(
        "ERROR: version mismatch detected. "
        f"Expected all files to match ecos/gui/package.json ({gui_package}).",
        file=sys.stderr,
    )
    for name, value in mismatches:
        print(f"  {name}: {value}", file=sys.stderr)
    sys.exit(1)

tag = f"v{gui_package}"
expected_version = normalize_expected_version(expected_ref)
if expected_version and expected_version != gui_package:
    print(
        f"ERROR: ref mismatch. ref='{expected_ref}' expected='{tag}'.",
        file=sys.stderr,
    )
    sys.exit(1)

github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
if github_output:
    with open(github_output, "a", encoding="utf-8") as fh:
        fh.write(f"version={gui_package}\n")
        fh.write(f"tag={tag}\n")

print("")
print(f"Version check passed: {gui_package}")
