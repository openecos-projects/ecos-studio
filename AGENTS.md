# ECOS Studio

ECOS Studio is an integrated RTL-to-silicon design environment. This repository
combines the desktop application, chip-design runtimes, native visualization,
open-source IP, and PDK resources.

See [Repository Layout](CONTRIBUTING.md#repository-layout) for the monorepo map
and [CONTRIBUTING.md](CONTRIBUTING.md) for setup and development workflows.

## Repository Ownership

- The parent repository owns product integration, packaging, and release
  validation.
- `ecos/` owns the desktop product, its built-in Agent, and native Chip Viewer.
- ECC and ECC-FE remain independent repositories so their source, tests, and
  releases are maintained by the toolchain owners.
- IP and PDK repositories remain pinned inputs rather than parent-repository
  source trees.

## Scoped Instructions

- `ecos/**`: @ecos/AGENTS.md
- `ecos/gui/**`: @ecos/gui/AGENTS.md
- `ecos/agent/**`: @ecos/agent/AGENTS.md
- `ecos/chip-viewer/**`: @ecos/chip-viewer/AGENTS.md
- `ecc/**`: @ecc/AGENTS.md
- Other submodules follow their own instructions and README.

## Submodules And Dependencies

- Follow [Working With Submodules](CONTRIBUTING.md#working-with-submodules). Do
  not prepare a parent PR whose gitlink depends on an unpublished submodule
  commit.
- Follow [Dependency and Lockfile Changes](CONTRIBUTING.md#dependency-and-lockfile-changes).
  Use the owning package manager and do not hand-edit lockfiles.
- Do not hand-edit generated build, release, packaged-resource, cache, or virtual
  environment contents.

## Validation And CI

- Treat `.github/workflows/ci.yml` as the source of truth for product CI jobs
  and `.github/workflows/pr-metadata.yml` for commit and PR-title checks.
  The `e2e-desktop-flow` job runs the product e2e suite
  (`ecos/gui/apps/desktop-electron/e2e/`, invoked via `pnpm run desktop:e2e`)
  across a matrix of ecc-ci-designs rtl2gds designs against the pinned ECC
  runtime artifacts (also on the nightly schedule, which covers the full
  design set including aes); see `ecos/gui/AGENTS.md` for the local
  environment requirements. Its `Product E2E` summary matches the required
  main-branch check. PR title or description edits only run PR Metadata and
  do not replace or cancel product CI results.
- Resolve third-party E2E inputs from a successful packaged-design job in the
  pinned ECC CI run. Keep PDK and Sizer artifacts in that same run, and reuse
  its OSS CAD Suite release, Kepler artifact run, and design-suite commit.
  Preserve the uploaded `ecc-toolchain-provenance` manifest when diagnosing
  toolchain differences; do not substitute the latest available tools.
  Update `.github/ecc-ci-toolchain.json` alongside an ECC pin change using
  `python3 .github/scripts/resolve-ecc-toolchain.py <run-id> <ecc-sha>
  --refresh-from-logs --output .github/ecc-ci-toolchain.json` with a maintainer
  token that can read ECC logs. Product CI verifies this lock using public
  metadata and does not require cross-repository log permissions.
- Run the narrowest relevant check while iterating, then run the local equivalent
  of every non-packaging CI job enabled by the changed paths. Use the commands in
  the affected component's scoped instructions.
- For release, packaging, version, or native-resource changes, run `make build`
  or report why the Linux x86_64 release build was not run.
- Reproduce CI failures with the same command, working directory, mode, and
  relevant environment before treating them as unrelated or flaky.
- When reporting PR status, report blocking reviews and failed or pending CI
  checks separately.
- Report the exact checks run, every relevant check not run, and the remaining
  risk.

## Pull Requests And Review

- Follow [Commit Messages](CONTRIBUTING.md#commit-messages),
  [Pull Requests](CONTRIBUTING.md#pull-requests), and the repository
  [PR template](.github/pull_request_template.md).
- When inspecting an unrelated branch or PR while the current checkout has
  changes, use a separate Git worktree instead of switching branches or stashing
  the user's work.
- Before publishing, inspect the complete diff and working tree for unrelated
  changes, generated output, caches, credentials, and unintended gitlinks.
- In the PR body, identify the affected components, list exact validation
  commands, explain skipped checks, and record any GUI, release, packaging,
  runtime, dependency, or submodule impact.
- Include screenshots or recordings for visible GUI changes.
- Review cross-process contracts, persisted formats, filesystem and subprocess
  boundaries, resource downloads, and user-controlled paths for compatibility,
  failure handling, and security impact.
- Resolve blocking CI failures before non-blocking cleanup or style feedback.
