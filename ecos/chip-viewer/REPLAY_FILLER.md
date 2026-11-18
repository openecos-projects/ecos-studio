# Filler Replay: auxiliary extraction ownership

## Root cause

AES ws_0007's Filler attempt e568b5b6d3bc4b0595e4b5aa0e5ee4f0 has
164 filler-row samples and two auxiliary RCX events. Its geometry manifest binds
nine RCX display assets. These came from the optional post-route clock-tree delay
analysis in ecc/chipcompiler/tools/ecc/clock_tree.py: RCX generates SPEFs, then
iSTA uses TYPICAL RC / TYP Liberty at 25°C to export the clock graph.

The viewer inferred result ownership solely from asset availability. Consequently
Filler's completion stage cycled through RCX corners, added their presentation
time and displayed the SPEF extraction caption. This is a cross-layer ownership
bug; it does not demonstrate incorrect electrical calculations.

## Corrected behavior

- Filler rows remain one shared-mesh reveal, now up to 4 seconds at 1× speed
  instead of 1.5 seconds. Individual recorded rows remain seekable. No geometry
  coordinates, source timestamps or EDA runtime values change.
- Completion presents the final layout, changed/new instances, key metrics,
  routed clock-net highlights and the real-delay clock-tree view when available.
- RCX views are admitted only when the recording's step is RCX (case-insensitive).
  Both geometry-backed and explicit analysis indexes use this rule. Planning
  and rendering agree, so filtered views leave no empty playback intervals.
- Old Filler run-rcx deltas are still applied and validated to preserve revision
  continuity and final geometry; they receive no automatic presentation clip.
- ECC suppresses helper capture while preserving the final clock graph, and
  excludes auxiliary RCX display assets from Filler's geometry publication/index.
  This avoids new redundant Replay assets without changing the analysis tools.

Existing workspaces can use the corrected viewer immediately. A rerun with the
updated ECC is needed only to produce the cleaner capture/artifact set. Do not
manually remove frozen assets: their fingerprints are part of capture integrity.

## Prevention and checks

Availability of a report is not proof that its enclosing step owns the analysis.
Any new helper analysis must define capture scope and result ownership, and tests
must cover both the helper's enclosing stage and the genuine analysis stage.

Unit tests cover shared RCX reports, view/duration agreement, skipped helper clips,
final geometry, fractional reveal, pause/seek and exact source nodes. ECC tests
cover publication, opt-in enabled/disabled, exceptions and nested suspension.
Opt-in AES tests verify the complete Filler result including clock overlays, plus
RCX's retained corner overlays and native-net resolution.

Commands (respective repository roots):

    cargo fmt --all -- --check
    cargo test --workspace -- --test-threads=1
    cargo test --release -p chip-viewer-native real_filler_subflow_navigation_preserves_reveal -- --ignored --nocapture --test-threads=1
    cargo test --release -p chip-viewer-native real_rcx_nets_resolve_and_share_native_geometry_across_corners -- --ignored --nocapture --test-threads=1
    cargo build --release -p chip-viewer-native
    .venv/bin/pytest -q test/tools

The real tests use ECOS_FILLER_CATALOG (a temporary Filler-only catalog retaining
the original workspace) and ECOS_REPLAY_TEST_CATALOG (the workspace's catalog).
Logs are /tmp/replay-filler-{workspace,aes-test,rcx-test,python-all,native-build}.log.

## Verification and local installation (2026-11-18)

- Rust workspace tests: 564 passed, 19 opt-in tests ignored. The two relevant
  real-data tests were then run explicitly in release mode and both passed.
- AES ws_0007: 18,299 filler cells reveal progressively; the completed result
  retains 552 clock routes, has no RCX analysis views, and lasts 6.85 seconds
  overall at 1×, including the 4-second filler reveal. The actual RCX stage
  retains nine corners, resolving 12,884 nets against 396,195 shared shapes.
- ECC tools suite: 699 passed. Ruff lint/format checks on changed Python files
  and basedpyright on the four changed production modules passed. Rust format
  and both repositories' diff-whitespace checks passed.
- Native release build and ECC PyInstaller onedir build succeeded. The installed
  ECC wrapper points to ~/.local/share/ecc/
  v0.1.0-alpha.12-replay-filler-20261118-155136. Installed version and help
  commands passed; the previous installation and wrapper backup are retained.
- An isolated Xvfb launch of the rebuilt native viewer confirmed the completed
  Filler caption, routed clock highlights, and real-delay clock tree visually.
  Screenshots are in /tmp/replay-filler-visual-wccmjj0k/.

The full physical flow, complete ECC repository suite, full product packaging
(`make build`), product E2E, and non-Linux builds were not run for this fix.
GUI source was unchanged by this fix; its prior loading-dialog build is retained.
The new capture suppression is covered by enabled/disabled helper tests; its
end-to-end artifact output still requires a newly run flow. Existing capture
rendering was verified with the real AES data and needs no rerun.
