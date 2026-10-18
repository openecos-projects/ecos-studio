#!/usr/bin/env bash
set -euo pipefail

sha="${1:?usage: wait-ecc-ci.sh ECC_COMMIT_SHA}"
deadline=$((SECONDS + 3600))

while true; do
  runs="$(gh api "repos/openecos-projects/ecc/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100")"
  run_id="$(jq -r '[.workflow_runs[] | select(.conclusion == "success") | .id][0] // empty' <<<"$runs")"
  if [[ -n "$run_id" ]]; then
    printf 'Using successful ECC CI run %s for pinned ecc %s\n' "$run_id" "$sha"
    printf 'run_id=%s\n' "$run_id" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  if ! jq -e 'any(.workflow_runs[]; .status != "completed")' <<<"$runs" >/dev/null; then
    printf '::error::No successful or active ECC CI run for pinned ecc %s\n' "$sha" >&2
    jq -r '.workflow_runs[] | "\(.html_url): \(.conclusion)"' <<<"$runs" >&2
    exit 1
  fi
  if ((SECONDS >= deadline)); then
    printf '::error::Timed out waiting for ECC CI for pinned ecc %s\n' "$sha" >&2
    exit 1
  fi
  printf 'Waiting for ECC CI for pinned ecc %s\n' "$sha"
  sleep 30
done
