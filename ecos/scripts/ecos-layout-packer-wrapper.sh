#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../ecos/layout-viewer"
exec cargo run --package ecos-layout-packer --bin ecos-layout-packer -- "$@"
