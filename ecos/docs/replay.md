# Layout Replay: ECC Flow

Layout Replay connects the workspace wizard, ECC CLI, native EDA capture and
the native Chip Viewer. It is an offline viewer of completed step executions.
It preserves all steps and their order from the workspace's `home/flow.json`.

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

Replay uses a **change-driven presentation timeline**. Execution timestamps stay
in the capture and are shown separately; a slow tool operation no longer creates
a long wait on an unchanged layout. See [presentation design](replay-presentation.md).

- The viewer prepares compact clips on a worker thread, comparing the actual
  geometry diffs. Identical checkpoints and idle intervals consume no display
  time; metric changes and phase/subflow boundaries remain brief events.
- One bottom timeline has Play/Pause before it and speed after it. Step widths
  reflect display duration, including final result and map inspection. Hovering
  completion nodes shows display duration and actual execution time.
- Small circles inspect exact captured subflow states. Large circles inspect
  exact final results. Overlapping nodes remain individually reachable through
  the bar's context menu. Dragging samples the same animated state as playback.
- Compatible consecutive optimizer samples interpolate instance positions.
  Dense continuous movement runs share a 12-second display budget while keeping
  all captured samples in the mapping. The viewer may cross several tiny clips
  per draw, but restores their deltas in order. Phase boundaries, legalization,
  rollback, replacement and committed results are not invented motion paths.
- Generation transitions reveal die/core boundaries, rows, IO, physical cells,
  PDN and routed geometry by object type, numeric layer and spatial order.
  Each batch receives 0.6–6 seconds of display time. Deleted/replaced geometry
  briefly fades at its previous position. Changed instances stay highlighted.
- The final captured delta animates before completion. Final results receive
  two seconds, followed by two seconds for each captured Place heatmap. The
  corresponding clock-tree view appears on the right only after its step completes.
  It reuses Native's hierarchical graph: postFloorplan defaults to level; CTS and
  post-route filler default to delay when timing is available. Missing timing
  falls back to level. Each step uses its own snapshot.
- Place maps appear as a right-side list, with the displayed map highlighted.
  Choosing a map pauses playback for inspection. The current step checklist is
  pinned below the results, with blocked entries red and all others green; the
  original checklist state remains visible.
- Pause retains the current interpolated position. Resume continues there.
  Playback speed applies equally to movement, generation, results and maps.
  **Play from step start** replays the selected step. Disabling animation shows
  exact samples but keeps the same display timeline.
- Numeric result deltas compare matching IDs/units with the nearest earlier
  step providing that metric; the comparison step is named. Result data and
  manual heatmap selection remain available when paused at completion.
- Synthesis and LEC show recorded report progress and metrics without invented
  physical geometry. Uncaptured steps remain visible as brief unavailable steps.
  Corrupt or stale recordings report an error rather than silently continuing.
- Interpolation and staged batch order are display effects, not extra algorithm
  samples or claims about per-object execution order. Existing captures work
  without rerunning ECC. The viewer never writes presentation timing into them.

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
instances/macros, halos, PDN, signal wires and vias, with positional heatmaps.
It is not a full cell-pin/polygon renderer. Geometry changes are semantic JSON
diffs with periodic checkpoints; rendering currently draws the visible scene
through egui. Chunked GPU updates, large-chip LOD/prefetch, and a retention policy
remain future work and have not been scale-tested.

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
