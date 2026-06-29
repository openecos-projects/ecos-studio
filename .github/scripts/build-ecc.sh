#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_FILE/../../ecc"

if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  version="$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml | head -n 1)"

  mkdir -p dist/ecc
  gh release download "v$version" \
    --repo openecos-projects/ecc \
    --pattern '*.tar.gz' \
    --output dist/ecc.tar.gz \
    --clobber
  tar -xvf dist/ecc.tar.gz -C dist/ecc
  exit 0
fi

if [ "${ECOS_ECC_USE_NIX:-}" = "1" ]; then
  exec nix develop --command uv run pyinstaller ecc.spec --clean --noconfirm
fi

uv run pyinstaller ecc.spec --clean --noconfirm
