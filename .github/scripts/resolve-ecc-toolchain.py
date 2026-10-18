#!/usr/bin/env python3
"""Recover the toolchain actually used by a successful pinned ECC design job."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time


ECC_REPO = "openecos-projects/ecc"
KEPLER_REPO = "openecos-projects/kepler-formal"


def api(path, *, raw=False):
    result = subprocess.run(
        ["gh", "api", path], check=True, capture_output=True, text=True, timeout=120
    )
    return result.stdout if raw else json.loads(result.stdout)


def unique_match(pattern, logs, label):
    values = set(re.findall(pattern, logs, re.MULTILINE))
    if len(values) != 1:
        raise ValueError(f"Expected one {label} in ECC job logs, found {len(values)}")
    return values.pop()


def parse_toolchain(logs):
    version = unique_match(
        r"https://github\.com/YosysHQ/oss-cad-suite-build/releases/download/"
        r"(\d{4}-\d{2}-\d{2})/oss-cad-suite-linux-x64-\d+\.tgz",
        logs,
        "OSS CAD Suite release",
    )
    kepler_run = unique_match(
        r"Downloading kepler-formal-linux-x64 from "
        r"openecos-projects/kepler-formal CI run (\d+)\s*$",
        logs,
        "Kepler CI run",
    )
    checkout = logs.split("Syncing repository: openecos-projects/ecc-ci-designs", 1)
    if len(checkout) != 2:
        raise ValueError("ECC job logs do not contain the design checkout")
    commit = re.search(
        r"\[command\][^\n]*git log -1 --format=%H\r?\n"
        r"(?:\S+Z\s+)?([0-9a-f]{40})\s*$",
        checkout[1],
        re.MULTILINE,
    )
    if not commit:
        raise ValueError("ECC job logs do not contain the design commit")
    return {
        "oss_cad_suite_version": version,
        "kepler_run_id": kepler_run,
        "designs_sha": commit.group(1),
    }


def artifact_records(payload, names):
    records = {}
    for name in names:
        matches = [item for item in payload["artifacts"] if item["name"] == name]
        if len(matches) != 1:
            raise ValueError(f"Expected one artifact named {name}")
        artifact = matches[0]
        if artifact["expired"] or artifact["size_in_bytes"] <= 0:
            raise ValueError(f"Artifact {name} is expired or empty")
        records[name] = {
            key: artifact.get(key) for key in ("id", "name", "digest", "size_in_bytes")
        }
    return records


def resolve(run_id, sha, timeout):
    run = api(f"repos/{ECC_REPO}/actions/runs/{run_id}")
    if run["head_sha"] != sha:
        raise ValueError("ECC runtime run does not match the pinned ECC commit")
    deadline = time.monotonic() + timeout
    while True:
        jobs = api(f"repos/{ECC_REPO}/actions/runs/{run_id}/jobs?per_page=100")["jobs"]
        designs = [job for job in jobs if job["name"].startswith("E2E Packaged Flow (")]
        successful = [job for job in designs if job["conclusion"] == "success"]
        if successful:
            job = successful[0]
            break
        if not designs or all(job["status"] == "completed" for job in designs):
            raise ValueError("ECC run has no successful packaged design job to establish tool provenance")
        if time.monotonic() >= deadline:
            raise ValueError("Timed out waiting for a successful ECC packaged design job")
        print("Waiting for ECC design validation to establish tool provenance", flush=True)
        time.sleep(min(30, max(0, deadline - time.monotonic())))
    manifest = parse_toolchain(api(f"repos/{ECC_REPO}/actions/jobs/{job['id']}/logs", raw=True))
    manifest.update({"ecc_sha": sha, "ecc_run_id": str(run_id), "ecc_job_id": job["id"]})
    manifest["artifacts"] = artifact_records(
        api(f"repos/{ECC_REPO}/actions/runs/{run_id}/artifacts?per_page=100"),
        ("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
    )
    kepler_run = manifest["kepler_run_id"]
    kepler = api(f"repos/{KEPLER_REPO}/actions/runs/{kepler_run}")
    if kepler["conclusion"] != "success":
        raise ValueError("The Kepler run used by ECC is no longer successful")
    manifest["kepler_sha"] = kepler["head_sha"]
    manifest["kepler_artifacts"] = artifact_records(
        api(f"repos/{KEPLER_REPO}/actions/runs/{kepler_run}/artifacts?per_page=100"),
        ("kepler-formal-linux-x64",),
    )
    return manifest


def verify_lock(manifest, run_id, sha):
    if manifest["ecc_sha"] != sha or manifest["ecc_run_id"] != str(run_id):
        raise ValueError("Update the ECC toolchain lock for the pinned ECC commit and runtime run")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", manifest["oss_cad_suite_version"]):
        raise ValueError("Invalid locked OSS CAD Suite release")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest["designs_sha"]):
        raise ValueError("Invalid locked design-suite commit")
    run = api(f"repos/{ECC_REPO}/actions/runs/{run_id}")
    if run["head_sha"] != sha:
        raise ValueError("ECC runtime run does not match the pinned ECC commit")
    jobs = api(f"repos/{ECC_REPO}/actions/runs/{run_id}/jobs?per_page=100")["jobs"]
    if not any(job["id"] == manifest["ecc_job_id"] and job["conclusion"] == "success"
               and job["name"].startswith("E2E Packaged Flow (") for job in jobs):
        raise ValueError("Locked ECC design validation job is no longer successful")
    actual = artifact_records(
        api(f"repos/{ECC_REPO}/actions/runs/{run_id}/artifacts?per_page=100"),
        ("ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"),
    )
    if actual != manifest["artifacts"]:
        raise ValueError("ECC runtime artifact metadata differs from the validated lock")
    kepler_run = manifest["kepler_run_id"]
    kepler = api(f"repos/{KEPLER_REPO}/actions/runs/{kepler_run}")
    if kepler["conclusion"] != "success" or kepler["head_sha"] != manifest["kepler_sha"]:
        raise ValueError("Kepler run differs from the validated lock")
    actual_kepler = artifact_records(
        api(f"repos/{KEPLER_REPO}/actions/runs/{kepler_run}/artifacts?per_page=100"),
        ("kepler-formal-linux-x64",),
    )
    if actual_kepler != manifest["kepler_artifacts"]:
        raise ValueError("Kepler artifact metadata differs from the validated lock")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id", type=int)
    parser.add_argument("ecc_sha")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--lock", type=Path, default=Path(".github/ecc-ci-toolchain.json"))
    parser.add_argument("--refresh-from-logs", action="store_true",
                        help="Regenerate provenance using a maintainer token with ECC log access")
    args = parser.parse_args()
    if args.refresh_from_logs:
        manifest = resolve(args.run_id, args.ecc_sha, args.timeout)
    else:
        manifest = verify_lock(json.loads(args.lock.read_text()), args.run_id, args.ecc_sha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for key in ("oss_cad_suite_version", "kepler_run_id", "designs_sha"):
                output.write(f"{key}={manifest[key]}\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
