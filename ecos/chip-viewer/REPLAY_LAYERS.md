# Replay stage layers and DRC review

Replay defaults to **Auto layers** in the synchronized 3D view:

| Recorded activity | Display |
| --- | --- |
| Floorplan, placement, sizing, CTS, filler | Cells and boundaries; hide obstructing power/signal geometry |
| PDN rails/rings/stripes/connections | Current revealed layer, subdued lower layers, hidden higher layers |
| Routing | Signal geometry; suppress background PDN and focus changed/revealed layers when available |
| Step completion and checkers | Complete current checkpoint |
| DRC result review | Routing metals from low to high, then restore the complete stack |

The DRC sweep reviews recorded results; it does not claim that the tool ran
checks sequentially or that a displayed layer passed. A scan plane follows the
current layer in 3D and the existing 2D caption names it. The 2D view highlights
that layer's recorded shapes. Known-layer violation boxes follow the selected
layer; unassigned violations remain available in the report and full result.
No violations are invented when the result is clean.

Clicking a completion node immediately shows the full result. Manual layer
checkboxes or the layer-height cutoff suspend Auto layers. Selecting Auto layers
resumes the policy; camera controls and Z scale do not suspend it.

## Data and rendering

- Reuse the selected recording's final geometry layer metadata and current
  reconstructed scene. No new ECC capture, duplicated geometry, or rerun is
  required for recordings with existing metadata and DRC analysis.
- Missing layer metadata leaves DRC as a full result view. Unknown steps default
  to all layers; partial/custom flows do not assume RTL-to-harden ordering.
- Semantic classes distinguish PDN and signal geometry on the same physical
  layer. Small GPU uniforms control coverage; hidden fragments do not write
  depth and hidden objects cannot be picked. Geometry buffers and camera fit
  remain stable. Regular viewer defaults preserve full coverage.
- All transitions derive from the replay cursor, including reveal groups.
  Pause and seek do not rely on a wall-clock animation.
- DRC uses metadata order and native layer-stack heights. Its sweep lasts
  0.9 seconds per metal, bounded to 2–10 seconds, plus a 1-second restoration.
  The 2D layer mesh is cached by layer/viewport and bounded to 80,000 shapes;
  dense views show a zoom-to-inspect notice.

## Validation (2026-11-18)

From ecos/chip-viewer:

    cargo fmt --all -- --check
    cargo test --workspace -- --test-threads=1
    cargo build --release -p chip-viewer-native
    ECOS_REPLAY_TEST_CATALOG=/nfs/home/huangzengrong/projects/benchmark/gcd/ws_0009/home/replay-view.json ECOS_LAYER_EVIDENCE=/tmp/ecos-replay-layer-evidence xvfb-run -a -s '-screen 0 1600x1000x24' cargo test -p chip-viewer-native replay::layer_validation::real_stage_layers_and_drc_screenshots -- --ignored --test-threads=1 --nocapture

Workspace tests passed: 547 tests, with 18 opt-in tests skipped. The separate
real-window test passed on an RTX 4090 Vulkan device and captured seven images:
PDN, place, route, three DRC layers, and full completion. It checks manual
override and completion restoration. GCD is clean; nonzero marker layer matching
is covered by unit tests rather than this screenshot case.

Evidence: /tmp/ecos-replay-layer-evidence. Logs:
/tmp/ecos-replay-layers-tests.log, /tmp/ecos-replay-layer-visual.log,
/tmp/ecos-replay-layers-build.log.

The desktop development launcher uses the release target through
ecos/scripts/chip-viewer-native-wrapper.sh. Close and reopen Replay to load the
new executable. Full make build, desktop E2E, and macOS/Windows builds were not
run: this change is confined to native rendering and does not change the desktop
launch contract, ECC runtime, or packaged resources.
