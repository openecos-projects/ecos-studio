# Replay loading feedback and AES startup profile

## Behavior

Clicking Replay immediately opens one Studio loading dialog and disables duplicate
launches. It stays mounted through catalog creation, native startup, planning and
first-layout loading. The native window opens when those preparations finish; a
ready report after its initial paint dismisses the Studio dialog. Standalone CLI
launches still show progress inside Native Replay.

Both dialogs reserve their content rows, truncate long labels and keep fixed
dimensions. Step, inspected-frame and elapsed counters change without recentering
the dialog. Studio uses tabular digits and keeps aggregate progress monotonic when
moving from frame inspection to result preparation. Replay's initial Z-scale is 1.
Progress measures work, not a duration estimate; AES planning itself is unchanged.

## Startup contract

- Electron creates a unique, private temporary directory for each launched process
  and passes its progress.json through --replay-progress-file. This file contains
  no geometry and is removed when the process exits or launch fails.
- Native writes a small JSON snapshot via temporary-file rename every 200 ms during
  planning and every 100 ms during first-layout preparation. It reports state
  (loading/ready), phase, name, step/steps and frame/frames. Steps are one-based;
  zero counts mean unavailable. There is no per-frame filesystem write on workers.
- ChipViewerService.isOpen returns the optional replayLoading snapshot using the
  existing preload/IPC channel. The reader limits input to 8 KiB and validates
  finite nonnegative integer counts, ranges, states and bounded strings. Invalid
  snapshots retain the previous valid status. Renderer never receives file paths.
- Renderer polls after process startup, with one in-flight request at a time.
  Elapsed time begins at the click. Ready closes the prompt; launch/IPC failures
  or premature native exit show an error and restore the button. Workspace change
  or component unmount stops polling and discards stale replies.
- The native process does not create a window during externally reported loading,
  avoiding maximize/focus changes behind the dialog. Direct CLI use needs no IPC.

The development wrapper now directly executes the release binary and respects
CARGO_TARGET_DIR. Missing binaries produce an actionable build command. Developers
must explicitly rebuild after Rust changes; launching never waits for compilation.

## Release profile on 2026-11-18

Workspace: /nfs/home/huangzengrong/projects/benchmark/aes/ws_0007

| Preparation | Seconds |
| --- | ---: |
| Route, 69 frames | 17.768 |
| Place, 67 frames | 4.835 |
| Filler, 169 source frames collapsed to 6 clips | 3.104 |
| All 22 steps | 48.539 |

This is sequential native planning time, not click-to-first-pixel latency.
Measurements are one optimized run with filesystem cache state uncontrolled.
The probe called actual Recording, ReplayMaps, StepPlan and analysis-duration
code; temporary instrumentation was removed.

StepPlan currently decodes and applies every delta to classify visible changes,
then discards the reconstructed scenes. All steps must finish before the player
timeline becomes usable. Route repeatedly processes many wire/via objects.
Collapsing filler playback does not avoid decoding its 169 frames. Later analysis
steps also reconstruct unchanged geometry.

Later AES steps reference 200–260 MiB of shared geometry each.
final_geometry_path verifies all referenced bytes on each call. Map discovery,
analysis duration, 3D metadata, clock results and playback may call it separately.
This adds I/O and hashing; it does not create duplicate files.

The earlier gcd/ws_0011 log additionally recorded 69 seconds compiling through
cargo run before opening its window, versus 1.132 seconds of native planning.
Removing implicit compilation addresses that separate delay. This change does
not eliminate AES's 48.5-second planning cost.

## Recommended performance work

1. Cache a compact presentation plan by attempt, manifest fingerprints and planner
   version. Reopening unchanged data should not reconstruct every frame. Reruns
   and planner changes invalidate it; do not duplicate geometry.
2. Prepare the selected step first, then background stages. Define a provisional
   timeline policy so node identity remains stable and dragging never jumps.
3. Derive analysis duration from small catalogs/counts. Defer unrelated geometry
   and result verification until needed. Reuse validated immutable handles within
   a load while preserving checksums, path validation and rerun/file-replacement
   detection.
4. Capture small replay-only change summaries for new recordings, reducing the
   need to reconstruct layouts merely to classify clips.

## Validation and limits

From ecos/chip-viewer:

    cargo fmt --all -- --check
    cargo test --workspace -- --test-threads=1
    cargo build --release -p chip-viewer-native

From ecos/gui:

    pnpm run check
    pnpm run build
    xvfb-run --auto-servernum pnpm run desktop:smoke

Launcher missing-binary error and exact argument forwarding (including spaces)
were checked with an isolated temporary target. The original native AES window on
Xvfb/Vulkan showed Route step 12/22, 18/69 frames and a live elapsed counter.
Regression tests now also exercise fixed native dialog bounds across phases/long
names, first-layout preparation before ready, renderer dialog identity through
all loading phases, monotonic progress, process failures, IPC forwarding, polling
cleanup and isolated temporary-file lifetime/validation.

Evidence: /tmp/replay-aes-loading.png, /tmp/replay-aes-loading-route.png.
Profiling log: /tmp/replay-startup-aes-ws0007.log.
Validation logs: /tmp/replay-loading-workspace.log,
/tmp/replay-loading-gui-check.log, /tmp/replay-loading-build.log,
/tmp/replay-loading-desktop-build.log.

Unified-dialog check: an isolated Electron window mounted the real ReplayControl
and PrimeVue theme, using the actual ChipViewerService, release native binary and
AES ws_0007 data. Across 198 samples over 50.7 seconds, the dialog stayed at
440 × 270.75 pixels at the same position throughout loading. Only the normal
single entrance/exit animation changed its bounds. Frame counts, result-preparation
phases, elapsed time and final ready handoff were observed. The native screenshot
shows Z-scale 1.00. This was a loading integration check, not a full physical flow.

Evidence: /tmp/replay-unified-visual-E14fAT/{frames.png,native-ready.png,samples.json}.
Validation: /tmp/replay-unified-{gui-check,gui-build,smoke,workspace,native-build}.log.
GUI checks passed (7 infrastructure, 224 shared, 1715 renderer and 1591 Electron
tests; two Electron tests skipped), Rust workspace tests passed (562 tests;
19 opt-in tests ignored), and the Electron smoke test passed. A final focused
startup regression additionally verifies clean exit if the progress file is lost.

Full make build, physical-flow desktop E2E and macOS/Windows builds were not run:
validation targeted Linux source/development startup with existing completed data,
not release packaging or a new RTL-to-GDS run.
This changes loading UI and the development launcher; ECC capture and design
data are unchanged. AppImage packaging remains unverified.
