#!/usr/bin/env python3
"""Extract the pinned Kepler package without installing external filesystem links."""

import argparse
from pathlib import Path, PurePosixPath
import re
import tarfile


def package_filter(member, destination):
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe Kepler archive member: {member.name}")
    hook = re.fullmatch(r"kepler-formal/lib/(python3\.\d+)/sitecustomize\.py", member.name)
    if member.issym() and hook:
        if member.linkname == f"/etc/{hook.group(1)}/sitecustomize.py":
            print(f"Skipping host-specific Python startup hook: {member.name}")
            return None
    return tarfile.data_filter(member, destination)


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as package:
        package.extractall(destination, filter=package_filter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    extract(args.archive, args.destination)


if __name__ == "__main__":
    main()
