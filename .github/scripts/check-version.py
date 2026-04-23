#!/usr/bin/env python3
import json
import os
import re
import sys
import tomllib
from pathlib import Path


expected_tag = os.environ.get("EXPECTED_TAG", "").strip()


def normalize_version(v: str) -> str:
    """Normalize semver prerelease tags (e.g. 0.1.0-alpha.3) to PEP 440 (e.g. 0.1.0a3)
    so they can be compared with uv.lock / packaging canonical forms."""
    return re.sub(r"-(alpha|beta|rc)\.?(\d+)", lambda m: m.group(1)[0] + m.group(2), v)


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


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


versions: list[tuple[str, str]] = []

module_version = parse_regex(
    "MODULE.bazel",
    r'(?m)^\s*version\s*=\s*"([^"]+)"',
    label="MODULE.bazel version",
)
versions.append(("MODULE.bazel", module_version))

server_pyproject = tomllib.loads(read("ecos/server/pyproject.toml"))["project"]["version"]
versions.append(("ecos/server/pyproject.toml", server_pyproject))

server_default_nix = parse_regex(
    "ecos/server/default.nix",
    r'(?m)^\s*version\s*=\s*"([^"]+)"\s*;',
    label="ecos/server/default.nix version",
)
versions.append(("ecos/server/default.nix", server_default_nix))

server_main_fastapi = parse_regex(
    "ecos/server/ecos_server/main.py",
    r'FastAPI\(.*?version\s*=\s*"([^"]+)"',
    flags=re.S,
    label="ecos/server/ecos_server/main.py FastAPI version",
)
versions.append(("ecos/server/ecos_server/main.py (FastAPI)", server_main_fastapi))

server_main_root = parse_regex(
    "ecos/server/ecos_server/main.py",
    r'"version"\s*:\s*"([^"]+)"',
    label="ecos/server/ecos_server/main.py root endpoint version",
)
versions.append(("ecos/server/ecos_server/main.py (root endpoint)", server_main_root))

server_uv_lock = parse_regex(
    "ecos/server/uv.lock",
    r'\[\[package\]\]\s+name\s*=\s*"ecos-server"\s+version\s*=\s*"([^"]+)"',
    flags=re.S,
    label="ecos/server/uv.lock root package version",
)
versions.append(("ecos/server/uv.lock", server_uv_lock))

gui_package = json.loads(read("ecos/gui/package.json"))["version"]
versions.append(("ecos/gui/package.json", gui_package))

gui_default_nix = parse_regex(
    "ecos/gui/default.nix",
    r'(?m)^\s*version\s*=\s*"([^"]+)"\s*;',
    label="ecos/gui/default.nix version",
)
versions.append(("ecos/gui/default.nix", gui_default_nix))

gui_cargo_toml = tomllib.loads(read("ecos/gui/src-tauri/Cargo.toml"))["package"][
    "version"
]
versions.append(("ecos/gui/src-tauri/Cargo.toml", gui_cargo_toml))

gui_cargo_lock = parse_regex(
    "ecos/gui/src-tauri/Cargo.lock",
    r'\[\[package\]\]\s+name\s*=\s*"ecos-studio"\s+version\s*=\s*"([^"]+)"',
    flags=re.S,
    label="ecos/gui/src-tauri/Cargo.lock root package version",
)
versions.append(("ecos/gui/src-tauri/Cargo.lock", gui_cargo_lock))

gui_tauri_conf = json.loads(read("ecos/gui/src-tauri/tauri.conf.json"))["version"]
versions.append(("ecos/gui/src-tauri/tauri.conf.json", gui_tauri_conf))

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

github_output = os.environ["GITHUB_OUTPUT"]
with open(github_output, "a", encoding="utf-8") as fh:
    fh.write(f"version={module_version}\n")
    fh.write(f"tag={tag}\n")

print("")
print(f"Version check passed: {module_version}")
