# Replay clock-network highlights

Clock-bearing completion nodes display the same clock network in the 2D layout
and synchronized 3D view. The existing sidebar clock-tree analysis remains
available. postFloorplan and CTS use flylines between captured clock pin
coordinates; filler follows physical wires and vias from the same attempt's
verified final native geometry.

## Data and rendering

`replay_loader` reads the frozen clock snapshot once and prepares both the tree
panel and `replay_clock::ClockOverlay` outside the UI thread. Filler reuses
`timing_route::Resolver`: endpoint identities select the net, connected wire
rectangles select a physical path, and vias retain their native layer IDs.
There is no flyline fallback for missing routed geometry. Missing branches and
snapshot errors are surfaced in the clock-tree panel. No additional ECC data
capture or flow run is required when those frozen assets already exist.

Only net edges are drawn. Cell edges participate in root-to-leaf traversal but
do not invent internal cell routing. Multiple roots and cycles are supported.
Branches at the same depth unfold together. Each clock completes its reveal
within 1.4 display seconds of the existing two-second completion hold, then
stays highlighted. This is a topology reveal, not a simulation of clock delay.
It adds no extra playback duration to filler.

The reveal uses the Replay display clock, including pause, speed and reverse
seek. Clicking a completion node shows the complete network immediately.
Process frames never show final clock results. Switching steps or invalidating
an attempt clears the overlay. Geometry is prepared once; paint only projects
cached branches. In 3D, metal/via endpoints use the native layer stack and the
same camera as the physical layout.

## Validation

- `cargo fmt --all -- --check`
- `cargo test --workspace -- --test-threads=1`
- `cargo build --release -p chip-viewer-native`
- From `ecos/gui`: `pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/chipViewerService.test.ts`
- Read-only real-workspace check: set `ECOS_REPLAY_TEST_CATALOG` to a catalog
  referencing actual attempt manifests, then run
  `cargo test -p chip-viewer-native real_clock_networks_resolve -- --ignored --nocapture`.

The ws_0008 GCD recording resolves 34 postFloorplan branches, 37 CTS branches and
37 filler branches, with zero missing branches. Routed strokes are checked for
orthogonal XY movement and same-XY layer transitions. Unit tests cover parallel
branch reveal, cycles, disconnected nodes, endpoint naming, layer projection,
and playback completion/pause/speed/reverse-seek behavior.
