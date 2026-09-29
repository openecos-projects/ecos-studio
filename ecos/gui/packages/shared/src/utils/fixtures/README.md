# Engineering Snapshot fixtures

`snapshot/` contains copies of the canonical fixtures from the pinned ECC commit's
`test/formal/fixtures/snapshot/` directory. Shared validator, Electron reader, and
QoR tests use these copies so GUI checks run without initializing submodules.

The CI version job compares the filenames and parsed JSON values with ECC's
originals. Refresh the copies when an ECC pin update changes those fixtures, then
format them with `pnpm exec oxfmt --write packages/shared/src/utils/fixtures/snapshot`
from `ecos/gui`. JSON formatting differences do not affect the comparison.
