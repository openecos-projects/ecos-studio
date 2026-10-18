#!/usr/bin/env bash
set -euo pipefail

sha="${1:?usage: wait-ecc-ci.sh ECC_COMMIT_SHA}"
deadline=$((SECONDS + 3600))

while true; do
  runs="$(gh api "repos/openecos-projects/ecc/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100")"
  pending=false
  while IFS= read -r run_id; do
    jobs="$(gh api "repos/openecos-projects/ecc/actions/runs/${run_id}/jobs?per_page=100")"
    publishers="$(jq '[.jobs[] | select(.name == "Build PyInstaller Bundle" or .name == "Fetch PDK" or .name == "Fetch Sizer")]' <<<"$jobs")"
    if jq -e 'length == 3 and all(.[]; .conclusion == "success")' <<<"$publishers" >/dev/null; then
      artifacts="$(gh api "repos/openecos-projects/ecc/actions/runs/${run_id}/artifacts?per_page=100")"
      if ! jq -e '
        [.artifacts[] | select(.expired == false and .size_in_bytes > 0) | .name] as $names |
        ["ecc-cli-linux-x86_64", "icsprout55-pdk", "ecc-sizer"] | all(.[]; . as $name | $names | index($name) != null)
      ' <<<"$artifacts" >/dev/null; then
        printf 'ECC CI run %s is missing required runtime artifacts\n' "$run_id" >&2
        continue
      fi
      if jq -e --argjson run_id "$run_id" 'any(.workflow_runs[]; .id == $run_id and .conclusion != null and .conclusion != "success")' <<<"$runs" >/dev/null; then
        printf '::warning::ECC CI run %s has failures outside the successful runtime publishers; desktop E2E will validate these artifacts\n' "$run_id"
      fi
      printf 'Using ECC runtime artifacts from run %s for pinned ecc %s\n' "$run_id" "$sha"
      printf 'run_id=%s\n' "$run_id" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    if jq -e 'any(.[]; .status == "completed" and .conclusion != "success")' <<<"$publishers" >/dev/null; then
      printf 'ECC runtime publisher failed in run %s\n' "$run_id" >&2
      continue
    fi
    if jq -e --argjson run_id "$run_id" 'any(.workflow_runs[]; .id == $run_id and .status != "completed")' <<<"$runs" >/dev/null; then
      pending=true
    fi
  done < <(jq -r --arg sha "$sha" '.workflow_runs[] | select(.head_sha == $sha) | .id' <<<"$runs")
  if [[ "$pending" != true ]]; then
    printf '::error::No ready or active ECC runtime publishers for pinned ecc %s\n' "$sha" >&2
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
