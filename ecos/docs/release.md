# Release Guide

ECOS Studio releases are branch-verified and tag-published.

Use a `release/v<version>` branch to prepare and validate the exact commit that
will be released. After the release branch CI is green, create the `v<version>`
tag from the remote release branch tip. The tag push triggers
`.github/workflows/release.yml`, which builds the AppImage and creates the
GitHub Release.

Do not tag an older commit with a new version if that commit still contains old
version metadata. The release workflow checks that the tag and ECOS Studio
version files agree.

## Version Files

The release version is defined by `ecos/gui/package.json`. The version check
requires these files to match:

- `ecos/gui/package.json`
- `ecos/gui/apps/*/package.json`
- `ecos/gui/packages/*/package.json`
- `ecos/gui/default.nix`

## Release Flow

Set the release variables first:

```bash
OLD_VERSION=0.1.0-alpha.5
NEW_VERSION=0.1.0-alpha.6
TAG=v${NEW_VERSION}
RELEASE_BRANCH=release/${TAG}
BASE_COMMIT=origin/main
```

Create the release branch from the commit you want to release:

```bash
git fetch origin
git switch -c "${RELEASE_BRANCH}" "${BASE_COMMIT}"
```

Bump every ECOS Studio version file on the release branch:

```bash
sed -i "s/\"version\": \"${OLD_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" \
  ecos/gui/package.json \
  ecos/gui/apps/desktop-electron/package.json \
  ecos/gui/apps/renderer/package.json \
  ecos/gui/packages/shared/package.json

sed -i "s/version = \"${OLD_VERSION}\"/version = \"${NEW_VERSION}\"/" \
  ecos/gui/default.nix

git add \
  ecos/gui/package.json \
  ecos/gui/apps/desktop-electron/package.json \
  ecos/gui/apps/renderer/package.json \
  ecos/gui/packages/shared/package.json \
  ecos/gui/default.nix
git commit -m "chore: bump version to ${TAG}"
```

Run the local version check from the repository root:

```bash
nix develop -c env EXPECTED_REF="${RELEASE_BRANCH}" python3 .github/scripts/check-version.py
```

Push the release branch:

```bash
git push -u origin "${RELEASE_BRANCH}"
```

Wait for the `release/v*` branch CI to pass. CI checks the branch name against
the source version, so a branch named `release/v0.1.0-alpha.6` must contain
version `0.1.0-alpha.6` in all version files.

After CI is green, create the annotated tag from the remote release branch tip:

```bash
git fetch origin
git tag -a "${TAG}" "origin/${RELEASE_BRANCH}" -m "ECOS Studio ${TAG}"
git push origin "${TAG}"
```

The tag push starts `.github/workflows/release.yml`. That workflow checks out
the tagged commit, verifies the tag/version match, builds the Electron release
bundle, uploads the AppImage artifact, and creates the GitHub Release.

## Hotfix Releases

For a hotfix, set `BASE_COMMIT` to the last known good commit you want to patch,
not to `main`. Cherry-pick only the fixes and release infrastructure that should
be part of the hotfix.

Before pushing the release branch, verify that an unwanted commit is not in the
branch history:

```bash
UNWANTED_COMMIT=<commit-sha>

if git merge-base --is-ancestor "${UNWANTED_COMMIT}" HEAD; then
  echo "ERROR: unwanted commit is included in this release branch"
  exit 1
fi
```

Do not merge `main` into a hotfix release branch just to pick up unrelated
changes. If the base commit does not contain the current release workflow, copy
or cherry-pick only the release infrastructure commits that are required for the
hotfix.

## Checklist

- The release branch is named `release/v<version>`.
- All ECOS Studio version files contain the same version.
- The release branch CI is green before creating the tag.
- The tag is annotated and points to `origin/release/v<version>`.
- No unwanted commit is an ancestor of a hotfix release branch.
- The GitHub Release is created by the `v*` tag workflow, not by an automatic
  tag from `main`.
