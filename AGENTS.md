# ECOS Studio

ECOS Studio is an integrated RTL-to-silicon design environment. This repository
combines the desktop application, chip-design runtimes, native visualization,
open-source IP, and PDK resources.

For setup, contribution, submodule, and release workflows, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Technology Stack

- Electron, Vue 3, TypeScript, and pnpm for the desktop application.
- Python 3.11 and uv for ECC, ECC-FE, and the ECOS Agent.
- Rust and Cargo for the native Chip Viewer.
- Nix for reproducible development and packaging environments.
- Git submodules for independently maintained toolchains, IP, and PDK sources.

## Repository Structure

- `ecos/`: ECOS Studio application code and integration scripts.
- `ecc/`: RTL-to-GDS toolchain submodule.
- `ecc-fe/`: front-end chip-design runtime submodule.
- `ip/`: open-source IP submodules.
- `pdk/`: PDK submodules.
- `.github/`: CI, release, version, and packaging automation.

## Repository Ownership

- The parent repository owns product integration, packaging, and release
  validation.
- `ecos/` owns the desktop product, its built-in Agent, and native Chip Viewer.
- ECC and ECC-FE remain independent repositories so their source, tests, and
  releases are maintained by the toolchain owners.
- IP and PDK repositories remain pinned inputs rather than parent-repository
  source trees.

## Scoped Instructions

Before working in a component, read its scoped instructions:

- `ecos/**`: `ecos/AGENTS.md`
- `ecos/gui/**`: `ecos/AGENTS.md`, then `ecos/gui/AGENTS.md`
- `ecos/agent/**`: `ecos/AGENTS.md`, then `ecos/agent/AGENTS.md`
- `ecos/chip-viewer/**`: `ecos/AGENTS.md`, then `ecos/chip-viewer/AGENTS.md`
- `ecc/**`: `ecc/AGENTS.md`
- Other submodules: follow that repository's own instructions and README.

## Setup

From the repository root:

```bash
make setup
cd ecc
nix develop
uv sync --no-build-isolation-package ecc-dreamplace \
  --no-build-isolation-package ecc-tools-bin --verbose
cd ../ecos/gui
pnpm install --frozen-lockfile
pnpm run dev
```

If Nix is unavailable, skip `nix develop`.

## Code Changes

- Understand the existing implementation and tests before editing.
- Make the smallest coherent change that satisfies the request.
- Reuse existing code, platform capabilities, and installed dependencies before
  adding new implementations or dependencies.
- Keep changes scoped to the owning component and preserve unrelated worktree
  changes.
- New hand-written production files should target fewer than 500 LoC.
- At roughly 800 LoC, split by a real responsibility boundary or explain why the
  file must remain cohesive.
- If an implementation approaches 200 lines while an equally clear and correct
  direct solution could be about 50, reconsider the design.
- Do not reduce line count by removing validation, error handling, security, or
  readability. Generated code, vendored code, fixtures, snapshots, lockfiles,
  and declarative data are exempt from source-size guidance.

## Submodules

- Commit source changes in the submodule repository first, then update the
  parent gitlink explicitly.
- Before merge, every changed gitlink must reference a commit available from the
  submodule's remote repository.
- Record the new commit, why it is needed, and the checks run in both the
  submodule and parent integration.

## Dependencies And Generated Files

- Use the owning package manager and update its lockfile; do not hand-edit
  lockfiles.
- Do not hand-edit generated build, release, packaged-resource, cache, or virtual
  environment contents.

## Validation

- Run the narrowest relevant check first, then the affected component's full
  check from its scoped instructions.
- For release, packaging, version, or native-resource changes, run `make build`
  or report why the Linux x86_64 release build was not run.
- Report every relevant check that was not run and the remaining risk.
