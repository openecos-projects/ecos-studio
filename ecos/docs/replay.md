# Layout Replay: Floorplan and Place

Layout Replay connects the workspace wizard, ECC CLI, native EDA capture and
the native Chip Viewer. It is an offline viewer of completed step executions.
The first implementation covers Floorplan and Place, preserving all steps and
their order from the workspace's `home/flow.json`.

## Use

1. In workspace creation, open **Flow Setup** and enable **Capture Replay data**.
   It is off by default. Creation passes `replay.enabled` through ECC CLI.
2. Run the existing flow or the desired steps. Enabling the switch does not
   create recordings for results that already exist.
3. In the opened workspace, click **Replay** to the right of **Run Flow**.
   This button is hidden when capture is disabled. It launches a separate native
   Chip Viewer; no web server is required.

Existing workspaces can enable capture with:

```sh
ecc param set replay.enabled true --project /path/to/project --workspace ws_0001 --plain
```

Use the updated ECC runtime and rebuilt ECC-Tools/ECC-DreamPlace. In a source
Studio launch, `ECOS_ECC_BIN_DIR=/absolute/path/to/ecc/.venv/bin` selects that
runtime. Build the viewer with `cargo build --release -p chip-viewer-native`
from `ecos/chip-viewer`, then build/start the desktop using the GUI scripts.

## Playback

- One bottom timeline, with the Play/Pause button before it and playback speed
  after it. Step widths reflect captured execution duration; uncaptured steps
  use the flow's precise observed duration, falling back to its runtime string.
- Small circles locate captured subflow boundaries. Larger circles select each
  step's final result. Dragging seeks through recorded frames. Right-clicking
  the bar also lists exact nodes where very short or zero-duration steps overlap.
- Playback pauses briefly on completion, then cycles available Place maps over
  the layout before proceeding to the next flow step. Manual map selection is
  also available only at completion.
- **Play from step start** replays the selected captured step from its beginning,
  including very short Floorplan steps whose timeline nodes overlap.
- Floorplan enables **Animate generation**: die/core outlines draw progressively,
  rows and IO appear in batches, physical cells are grouped by master and revealed
  left to right, and PDN grows in ascending layer order. The current group is
  named beside the control. Each captured batch gets viewing time before the
  next sample. This is a presentation order within a batch, not a claim about
  individual objects' actual tool execution timestamps. Final native writeback
  remains an exact result, without replaying all geometry as new objects.
- Changed/new instances retain pink outlines, painted above PDN and heatmaps.
  Reverse seek restores both the geometry and touched set of the selected frame.
- Playback defaults to 1×, with 0.25×/0.5× available. Place enables **Smooth
  movement** by default: adjacent optimizer samples with unchanged instance
  identity, master, orientation and dimensions use a 300 ms eased translation.
  The layout and its highlight move together. The UI identifies interpolated
  movement; these display positions are not additional EDA samples.
  Playback holds its recorded cursor during the transition instead of skipping
  ahead. Timeline proportions and recorded durations remain unchanged, so
  viewing can take longer than execution time divided by the selected speed.
  Pausing, seeking, disabling smoothing or reaching a completion node restores
  exact sampled geometry. Legalization, rollback, phase boundaries, insertion,
  deletion, resizing and master/orientation changes are not interpolated.
- Completion shows the final committed layout and captured QoR metrics. Numeric
  deltas compare matching metric IDs/units with the nearest earlier step that
  provides the metric; the comparison step is named.
- A step without capture remains in the timeline and explains the missing data.
  There are no simulated frames in this production pipeline.

## Integration contract

Renderer → typed preload → Electron main reads the current workspace setting.
The settings IPC accepts no path and does not mutate files. Existing workspace
creation/parameter APIs remain responsible for CLI configuration.

`electron/services/replayService.ts` validates workspace-contained paths,
checks flow execution state and current capture attempt pointers, then publishes
`home/replay-view.json` (`ecos.replay.catalog.v1`). The catalog is a derived
launch document, not the flow definition. The native launch uses:

```sh
chip-viewer-native --manifest /path/to/ws/home/replay-view.json --mode replay
```

The native viewer checks schema, frame ordering/revisions, path containment and
attempt identity. Rerunning/invalidation stops stale playback. The existing
ordinary layout View/Edit modes keep their current launch and data contracts.
The complete producer contract is in [ECC Replay](../../ecc/docs/replay.md).

## Current scope

The native renderer shows recorded physical bounds for die/core, rows, IO,
instances/macros, halos and PDN, with positional heatmaps. It is not a full
cell-pin/polygon or routed-wire recording. Geometry changes are semantic JSON
diffs with periodic checkpoints; rendering currently draws the visible scene
through egui. Chunked GPU updates, large-chip LOD/prefetch, and a retention policy
remain future work and have not been scale-tested.

This phase does not add CTS/clock-tree, routing or signoff process capture.
GCD exercised no-op macro placement, not a real macro optimization trajectory.
The earlier browser mockup remains design evidence; it is not the native runtime.

## Checks and evidence

From `ecos/gui`:

```sh
pnpm run check
pnpm run desktop:build
ELECTRON_DISABLE_SANDBOX=1 ECOS_ELECTRON_DISABLE_GPU=1 xvfb-run --auto-servernum pnpm run desktop:smoke
```

From `ecos/chip-viewer`:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo build --release -p chip-viewer-native
```

Integration validation used an isolated GCD workspace with real EDA execution,
production catalog generation, the actual Electron workspace and native viewer.
Local screenshots and run details are recorded in `.claude/replay-evidence/`
and `.claude/replay.md` at the repository root (local design/evidence files).
Exact commands, counts and skips are in `.claude/replay-evidence/validation.md`.
The three full RTL-to-GDS desktop CI journeys and `make build` release packaging
have not been run for this local first-phase validation; they require the pinned
ECC CI toolchain/PDK/artifact set and remain gates before publication.
