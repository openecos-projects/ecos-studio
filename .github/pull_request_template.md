## Summary

-

## Scope

Select the areas touched by this PR:

- [ ] GUI - desktop UI/runtime changes in `ecos/gui`, including renderer, Electron, and shared packages.
- [ ] ECC - ECC submodule updates or ECOS Studio integration with the ECC CLI/runtime.
- [ ] Resource management - resource registry, downloads, installation, manifests, PDKs, or tool assets.
- [ ] Build, packaging, Bazel, Nix, or release workflow - build inputs, AppImage packaging, or release metadata.
- [ ] CI - GitHub Actions workflows, reusable actions, triggers, path filters, or automated checks.
- [ ] Documentation only - README, guides, templates, or docs with no runtime behavior change.

## What Changed

-

## Validation

List the commands you ran. Mark checks that are not applicable as N/A.

- [ ] `cd ecos/gui && pnpm run typecheck`
- [ ] `cd ecos/gui && pnpm run test`
- [ ] `cd ecos/gui && pnpm run build`
- [ ] `make build`
- [ ] `make demo-gcd`
- [ ] `make demo-retrosoc`
- [ ] Manual GUI smoke: `cd ecos/gui && pnpm run dev`
- [ ] Other:

Skipped checks and reason:

-

## Screenshots or Recordings

Required for visible GUI changes.

-

## Release, Packaging, and Runtime Impact

- [ ] No release, packaging, or runtime impact
- [ ] Version metadata changed
- [ ] AppImage or Electron packaging changed
- [ ] ECC CLI runtime resources changed
- [ ] OSS CAD Suite, PDK, resource download, or installer behavior changed
- [ ] Submodule gitlink changed

Notes:

-

## Checklist

- [ ] I kept the change scoped to the affected component.
- [ ] I updated docs or user-facing text where behavior changed.
- [ ] I included lockfile changes for dependency updates.
- [ ] I documented intentional submodule updates.
- [ ] I did not include local caches, virtual environments, or generated build outputs.
- [ ] I explained any skipped validation and remaining risk.
