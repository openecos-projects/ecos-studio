# Contributing to ECOS Studio

Thanks for contributing to ECOS Studio. This repository is a monorepo for the
desktop application, supporting resources, IP/PDK submodules, and the ECC
toolchain integration used by the release build.

## Repository Layout

- `ecos/` - ECOS Studio desktop application and packaging scripts.
- `ecos/gui/` - Electron, Vue, TypeScript, and pnpm workspace.
- `ecc/` - ECC submodule.
- `ip/` - IP submodules and local templates.
- `pdk/` - PDK submodules.
- `.github/` - CI, release, version checks, and shared GitHub Actions.

Keep changes scoped to the component they affect. If a change needs work in a
submodule, commit that work in the submodule repository first, then update the
gitlink in this repository as a separate, explicit change.

## Environment

Release builds currently target Linux x86_64 with glibc 2.34 or newer. The
packaged ECC runtime includes native manylinux_2_34 artifacts, so older
distributions and non-x86_64 hosts are not expected to pass the full release
build.

The main tools are:

- Node.js LTS and pnpm for `ecos/gui`.
- Python 3.11 and uv for ECC CLI packaging inputs.
- Bazel 8.5.0 for release packaging.
- Git submodules for `ecc`, `ip/retroSoC`, and `pdk/icsprout55-pdk`.

From the repository root:

```bash
make setup
make dev
```

`make setup` initializes submodules and checks for the core tools. `make dev`
installs the GUI dependencies after setup.

## Working With Submodules

This repository tracks `ecc`, `ip/retroSoC`, and `pdk/icsprout55-pdk` as Git
submodules. During development, intermediate commits in the parent repository may
temporarily point at whatever submodule revision is useful for testing, including
local or in-progress submodule commits.

Before a PR is ready to merge, every changed submodule gitlink must point at the
latest appropriate commit that is already available in the submodule's online
remote repository. Do not merge a parent-repository PR whose submodule pointer
depends on an unpublished local commit.

For a submodule update, use this flow:

```bash
git submodule update --init --recursive
git -C <submodule-path> fetch origin
git -C <submodule-path> checkout <remote-branch-or-tag>
git add <submodule-path>
```

Then state the final submodule commit in the PR, why it is needed, and which
checks were run inside the submodule or against the parent repository.

## Branch Naming

When creating a branch directly in the main `ecos-studio` repository, prefix the
branch name with your username and a slash:

```text
<username>/<short-topic>
```

Examples:

```text
alice/fix-appimage-build
bob/feat-resource-manager
```

This convention applies only to branches created in the main repository. If you
develop from a fork, use any branch naming convention that works for your fork.

## Development Workflows

### GUI

```bash
cd ecos/gui
pnpm install --frozen-lockfile
pnpm run dev
```

For sandboxed or VM-like Linux environments:

```bash
cd ecos/gui
pnpm run dev:vm
```

Useful checks:

```bash
cd ecos/gui
pnpm run typecheck
pnpm run test
pnpm run build
```

Use the more focused package scripts when the change is limited to one package:

```bash
cd ecos/gui
pnpm run renderer:typecheck
pnpm run renderer:test
pnpm run desktop:typecheck
pnpm run desktop:test
```

### ECC CLI Debugging

The normal ECOS Studio build is a monorepo-style flow: the desktop package builds
the ECC CLI from the `ecc` submodule and includes that CLI runtime in the
packaged AppImage.

For Bazel-based debugging, choose the ECC source deliberately in the root
`MODULE.bazel`:

- Use `git_override(...)` when you want to lock `ecc` or `ecc-dreamplace` to a
  specific online repository commit.
- Use `local_path_override(...)` when you want the root build to use local source
  code from `ecc` or `ecc/chipcompiler/thirdparty/ecc-dreamplace`.

Do not use the `ecos-studio` PR checklist to require ECC's own Ruff, pytest, or
CLI smoke commands. If the change needs ECC source work, validate that work in
the ECC repository and use the `ecos-studio` PR to verify the integration path.

Be careful when debugging `ecc-tools` or `ecc-dreamplace`: `ecc/pyproject.toml`
pins those Python packages to exact versions and resolves them from GitHub
Release wheel URLs. Changing the nested local source tree is not enough if the
runtime still installs the pinned release wheel. For dependency-level debugging,
build or publish the local wheel first, update the ECC dependency source or
installation inputs to point at that wheel, then reinstall/sync the ECC
environment before testing.

### Release Build

For changes that affect Bazel, packaging scripts, ECC runtime resources, version
metadata, Electron release configuration, or native assets:

```bash
make build
```

To launch the built AppImage after a successful build:

```bash
make gui
```

The Bazel release target is `//:ecos_studio_bundle`. CI builds an AppImage from
that target and checks that the artifact exists in the produced bundle.

### CLI Demos

For changes that affect the ECC integration or demo flows:

```bash
make demo-gcd
make demo-retrosoc
```

These targets require setup, the expected PDK resources, and a compatible Linux
host.

## Testing Expectations

Run the smallest checks that prove your change, then add broader checks when the
blast radius is larger.

- Documentation-only changes: proofread the updated docs and check affected
  links or paths.
- GUI renderer or shared TypeScript changes: run the relevant pnpm typecheck
  and tests.
- Electron main/preload or desktop bridge changes: run desktop typecheck/tests
  and a manual `pnpm run dev` smoke check when possible.
- Build, release, version, or packaging changes: run `make build` or explain why
  it could not be run locally.
- ECC CLI or ECC runtime changes: state whether Bazel used `git_override` or
  `local_path_override`, and verify the actual CLI/runtime version being tested.
- Resource download, archive extraction, or installer changes: cover checksums,
  path traversal, symlinks, and failed-download behavior with tests.
- Submodule updates: state the new submodule commit, why it is needed, and which
  nested-repository checks were run.

If you skip a relevant check, say why in the PR and describe the residual risk.

## Commit Messages

Use Conventional Commit-style subjects. This repository's release notes are
generated from commit messages.

Examples:

```text
feat(gui): add workspace reload indicator
fix(nix): restore ecos-studio build
chore(ecc): update ECC submodule
docs: add contributor guide
ci: tighten AppImage artifact check
```

Prefer these common scopes when they fit: `gui`, `ecc`, `build`, `ci`, `nix`,
`docs`, `resource`, `pdk`, and `ip`.

Keep commits focused. Avoid mixing unrelated GUI, ECC, submodule, and packaging
changes in the same commit unless they are required for one behavior change.

## Pull Requests

Every PR should include:

- A short summary of the behavior or documentation change.
- The touched area of the repository.
- The validation commands that were run.
- Screenshots or screen recordings for visible GUI changes.
- Notes about version, release, packaging, PDK, or submodule impact.

Before opening a PR, check:

- The working tree contains only intentional changes.
- Generated artifacts, virtual environments, caches, and local build outputs are
  not included.
- Version changes are reflected consistently across the files guarded by the
  version check.
- Submodule gitlink changes are intentional and documented.
- The PR template has been filled out honestly, including skipped checks.

## Dependency and Lockfile Changes

Dependency updates must include the corresponding lockfile updates:

- `ecos/gui/pnpm-lock.yaml` for pnpm dependency changes.
- `ecc/uv.lock` for ECC uv dependency changes.
- `MODULE.bazel.lock` for Bazel module resolution changes.
- `flake.lock` for Nix input changes.

Do not hand-edit lockfiles. Regenerate them with the appropriate package
manager and include a short rationale in the PR.

## Version and Release Notes

The release workflow checks version consistency before building an AppImage.
When changing release versions or package metadata, update all affected version
surfaces together and run the version check through CI or the local action path
when practical.

Release notes are grouped by commit message type through `.github/cliff.toml`.
Clear commit subjects make the generated changelog useful.

## Security-Sensitive Changes

Treat downloads, archive extraction, filesystem writes, subprocess execution,
and user-controlled paths as security-sensitive. Validate paths structurally
rather than with ad hoc string checks, reject unsafe archive members, and keep
resource mutation logic in shared code paths instead of duplicating behavior
across GUI and CLI adapters.
