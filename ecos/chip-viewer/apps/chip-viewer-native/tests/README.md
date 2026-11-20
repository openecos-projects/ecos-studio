# Native rendering checks

The November 16 missing-content investigation is recorded in
[`render-interaction-damage.md`](../../../docs/render-interaction-damage.md).
Zoom feedback now checks captured routing pixels against the completed target;
`cpu_scene_partial` alone cannot prove useful layout visibility. The historical
passes below predate this stronger content check. The first multilayer CPU
preview experiment failed on both minirv2 and TPU and is not accepted as a fix.

The current combined `initial-pool` revision passes the native 2D gates on
all-visible minirv2 with the certified llvmpipe driver. See
`../../../docs/render-acceptance-2026-11-13.md` for exact source identity,
commands and scope: zero changed static layout pixels, the complete strict
interaction journey, and 20 passing candidate journeys in the fixed-binary
20-pair zoom distribution. Every non-fit camera has 20 uncached samples per
group, with no complete-recovery p95 regression. All earlier failures below
remain historical evidence.

`../../../docs/render-white-texture.md` records the restricted scalar white
shader, rejected constant-color variants, coalesced retained copies and the
actual GL presentation statistics. Window reports include `stats_phases`;
historical before-paint samples are not silently described as after-paint
measurements. The complete strict interaction journey passes for the frozen
`actual-stats` revision. The completed `streamed-final` repeated zoom series
fails; its observations remain recorded. The earlier background-fill experiment
and its separate failed uncached journey are in
`../../../docs/render-canvas-background.md`. Its completed fixed-binary 20-pair
series also fails: 16 candidate journeys pass, with three frame-p95 failures,
one feedback failure and a per-camera full-recovery-p95 regression.
`../../../docs/render-label-measurement.md` records the next exact row-height
preflight and stronger test-device selection. Its completed 20-pair series has
17 passing candidate journeys, two frame-p95 failures, one feedback failure
and a per-camera full-recovery-p95 regression. Those intermediate revisions
did not meet the strict goal.

`../../../docs/render-initial-prefix.md` describes the bounded initial-packet
experiment and its independent GL oracle. `render_zoom_gate.py` keeps the
20-uncached-observation minimum and rejects environment diagnostics or a mixture
of `xwd` and `XGetImage` capture backends. Inner CPU timing loops are not window
acceptance observations.

## Selection and pan refresh, November 12

`../../../docs/render-interaction-refresh.md` documents selection-only geometry
reuse, post-drag viewport calculation and progressive pan composition.
`interaction_render_e2e.py --scenario selection` sends actual clicks and requires
multiple selected shapes, zero new geometry rasterizations and zero preview
substitutions. It also applies the normal latency and visibility checks. The
EGL `interaction_tests` cover exact framebuffer pixels and the scene coordinator.

## Camera presentation, November 12

`../../../docs/render-interaction-presentation.md` records the removal of the
old-camera zoom hold and retention of same-scale partial results during pan.
The upstream investigation is in
`../../../docs/klayout-interaction-rendering-research.md`: KLayout shifts
coverage on pan and invalidates it on zoom; it does not scale an old RGBA frame.
ECOS still uses temporary RGBA pan previews, not KLayout's coverage/damage path.

Run the new pixel regressions with EGL required, so unavailable graphics cannot
silently skip the interaction checks:

```bash
ECOS_REQUIRE_INTERACTION_EGL=1 cargo test -p chip-viewer-native interaction_tests -- --nocapture
```

These exercise the actual presentation framebuffer, current-camera adoption,
exact history restoration, consecutive partial-frame pans and late results.
Static fit/dense references remain byte-identical in layout pixels. The strict
real-design interaction/zoom latency gates still fail; removing the held image
exposes background while the first new-scale snapshot is prepared. This change
does not establish that the complete KLayout interaction/performance goal is met.

## Ordered coverage oracle and live feedback, November 12

`../../../docs/render-ordered-coverage-validation.md` records the new test-only
ordered scanline representation, independent byte/prefix/shift checks, required
llvmpipe profile and rejected SVGA3D arithmetic assumption. Seven focused tests
pass with EGL explicitly required. Workspace validation passes 507 tests
(402 native), plus 19 Python tests; ordinary workspace success alone does not
prove that a driver-specific check actually ran. Production does not enable this
experimental compositor, and no real-design speedup is claimed for the oracle.

`../../../docs/render-layer-query-scheduling.md` records stage-9 layer streaming,
immediate camera scheduling, rejected per-tile GL work, complete interaction/
zoom failures and the retained 378 ms cold-start outlier. Four interleaved,
isolated-display cold rechecks use an explicit 250 ms stall gate; the standalone
static harness otherwise inherits DISPLAY and defaults to a 1000 ms gate.
Old/translated camera, exact current partial geometry, completed geometry and
labels remain separate. Use `--max-proxy-run-ms 50` for the interaction harness;
low UI frame times do not establish live current-camera redraw. The full goals
remain unmet. Evidence is in `$HOME/.local/state/ecos-render-bench/stage9`.

The following sections describe historical increments, not current acceptance.

## Compact geometry and UI target ownership, November 11

`../../../docs/render-compact-presentation.md` describes producer-side compact
packets, the unchanged original egui shader, bounded UI target reuse, independent
pixel references and rejected serial/shared-upload experiments. Full workspace
validation passes 491 tests, including 386 native; the CPU-scene subset passes
61 tests with EGL available. Five Python readiness-classification tests also
pass. Release and Debug builds succeed; strict 50/250 ms goals remain unmet.

The strengthened EGL oracles cover compact/textured/callback alternation,
fractional clips at five DPRs, more than 65,535 vertices across separate meshes,
and a conservative original-painter fallback for index 65,535. Exact rectangle
oracles additionally compare compact RGBA against original painter output.
The UI pool tests cover full replacement (including alpha zero), one-spare
ownership, idle timing, camera reset, resize and teardown. No test accepts bbox
proxies or relabels old-camera previews as exact output.

Current evidence lives in `$HOME/.local/state/ecos-render-bench/stage7`, not
temporary storage. An external cleanup removed earlier `/tmp/chip-kernel-stage*`
directories. Surviving logs and executables are retained, but historical PNGs
and per-run reports are not claimed still available. New independent fit/dense
references use the saved stage-6 executable; see the document for its failed
cold-baseline latency run and the final executable/source hashes.

## Raw label candidate lifetime, November 11

`../../../docs/render-scene-retirement.md` records the current raw-candidate
ownership change, four rejected lifecycle experiments, exact validation
commands and complete results. Five actual-design pan pairs improve median
full recovery 377.81→350.60 ms; dense cold startup is effectively neutral and
its improvement gate fails. Final Release/Debug pass the existing interaction
gates, and both static references have zero changed pixels. Strict zoom still
fails 50/250 ms and active-frame p95 requirements. Successful label jobs now
release raw candidates before completion while resolved labels and unfinished
exact-camera resumption remain intact. No lower-detail rendering is introduced.

## Exact rectangle adapter, November 11

`../../../docs/render-exact-rectangles.md` describes the current exact-raster
adapter, worker-side geometry retirement, reference fallbacks and real-design
A/B results. Five pan pairs reduce median full recovery 614.22→352.57 ms, still
above the 250 ms target. Reference pixels remain unchanged. The new
`interaction_render_e2e.py --presentation-trace` separates upload/replacement/
blit phases and explicitly marks diagnostic reports.

## Raster diagnostics, November 11

`../../../docs/render-raster-diagnostics.md` records the new opt-in
`--raster-trace` flag for static/zoom checks, actual submission/queued-wait/
readback measurements, rejected experiments and remaining strict failures.
Trace reports explicitly mark diagnostic mode: its forced GL synchronization
must not be used to claim an acceptance speedup. All failed raster prototypes
are removed; the diagnostic-stage checkpoint preceded the exact-rectangle
adapter described above.

## Independent text preparation, stage 3, November 11

Current architecture, full measurements, exact commands and remaining failures
are recorded in `../../../docs/render-label-pipeline.md`. Geometry and text now
have separate cancellable work domains; text measurement is parallel, while
placement/collision order remains deterministic and equal to the serial oracle.

At all-visible fullscreen 2048×1280 on the real minirv2 design with llvmpipe,
three dense-label startup A/B pairs reduce median label work
995.63→264.34 ms and process-to-full-ready time 2166.39→1366.15 ms. All six runs
have zero changed interior layout pixels. Raster-call time increases about
21%, and viewer peak RSS increases about 52.3 MiB; these are not hidden as wins.
Uncached pan A/B medians are mixed: the first three pairs regress 0.98%, and a
subsequent five-pair check improves 6.84%. This is not a p95 pan-speedup claim.

`render_label_ab.py` interleaves cold label startup checks, hashes its inputs,
compares pixels/routes/counts and records Linux `VmHWM` process peak RSS.
`render_latency.py` keeps current-camera partial feedback, exact geometry and
geometry-plus-label completion separate. The zoom check's optional
`--max-full-response-seconds .25` now enforces the latter; held/translated
previews do not qualify. Five pure classification tests run with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s apps/chip-viewer-native/tests -p test_render_latency.py -v
```

477 workspace tests and native Release/Debug builds pass. Release passes the
existing seven-scenario 1 s recovery check; Debug still fails left/middle drag
recovery and wheel-out frame p95. The strengthened strict zoom check retains
zero unknown colored-pixel mismatch but still fails latency: uncached zoom
2.61 takes 408 ms for geometry and 440 ms including labels, with 93 ms feedback
and 40.62 ms frame p95. Thus the 50/250 ms goal remains active. The stage-2
results below are historical, not the current executable's performance.

## Ordered 2D kernel pipeline, stage 2, November 11

Architecture, measurement semantics and rejected experiments are recorded in
`../../../docs/render-kernel-pipeline.md`. Geometry preparation now streams
bounded ordered packets into the Linux offscreen rasterizer. It still preserves
the original per-command AA, alpha, clipping, pattern origin and draw order;
there is no binary-union layer cache or large-block replacement.

`cpu_scene_pipeline_ms` measures preparation through final bitmap readback.
On this path `cpu_scene_build_ms` excludes raster-consumer calls and is not
worker CPU time. Do not claim a preparation speedup from comparing it to the
old sequential metric. Exact recovery including labels and current-camera
feedback remain separate acceptance checks.

Progressive requests publish after the first four bounded meshes or the 25 ms
wall timer, whichever triggers first. The queued-work EGL test proves that
asynchronous submissions cannot postpone that initial snapshot until a long
CPU wall timer. Every snapshot still matches the corresponding exact ordered
geometry prefix. Final-only requests do not publish partials.

Final workspace validation is **470 tests passed, including 365 native**.
Final evidence for this increment uses `/tmp/chip-kernel-stage2-publication-*`.
Earlier `pipeline-ab`, `final-*` and `verified-*` directories contain intermediate
experiments, including the rejected fixed-size packet zoom regression and the
timer-only publication version, not the final measured executable.

Final three-pair Release A/B medians, in alternating AB/BA/AB order:

| Metric | Before stage 2 | Current |
| --- | ---: | ---: |
| Complete uncached pan recovery, including labels | 683.77 ms | 548.58 ms |
| Preparation through bitmap readback | 469.11 ms, sequential phase sum | 429.30 ms, observed pipeline wall time |
| Raster submission/readback calls | 338.56 ms | 349.31 ms |
| Active-frame p95, median across runs | 14.33 ms | 16.32 ms |

Full recovery improves about **19.8%**, not enough for 250 ms. The current
three recoveries are 549/553/539 ms. UI-frame and raster medians are slightly
worse in this final comparison, although all six trials pass the unchanged
33.3 ms / 250 ms stall / 1 s recovery gates. There is no claim that the raster
algorithm itself is faster. Intermediate pipeline-only A/B recovery improves
825.60→768.23 ms; the shorter coalescing period accounts for part of the final
gain. An earlier final-candidate comparison improves 722.16→566.76 ms and is
retained under `verified-ab`. These are small diagnostic samples, not proof of
p95 tail latency or a guaranteed speedup on another driver.

Final strict zoom current-camera feedback / full geometry, in milliseconds:

| Zoom | First current-camera output | Full geometry |
| --- | ---: | ---: |
| 121.71 | 24 | 24 |
| 46.59 | 28 | 28 |
| 17.83 | 65 | 99 |
| 6.83 | 72 | 159 |
| 2.61 | 120 | 337 |
| 1.00, exact history hit | 27 | 27 |

All six steps and continuous high-to-low zoom have **zero unrecognized colored
pixel mismatch**. The strict check still fails 50 ms feedback at three steps
and 250 ms geometry response at zoom 2.61. Its frame p95 is 14.60–30.09 ms.
These response numbers do not include the additional label completion time;
full interaction recovery is measured separately.

Final seven-scenario interaction results:

| Scenario | Release active p95 | Release full recovery | Debug active p95 | Debug full recovery |
| --- | ---: | ---: | ---: | ---: |
| Left drag | 15.98 ms | 566 ms | 18.70 ms | 998 ms |
| Middle drag | 18.77 ms | 546 ms | 16.59 ms | 1006 ms |
| Right drag | 18.16 ms | 592 ms | 18.37 ms | 929 ms |
| Wheel in | 25.26 ms | 34 ms | 26.82 ms | 32 ms |
| Wheel out | 20.09 ms | 513 ms | 23.50 ms | 992 ms |
| Alternating zoom | 23.99 ms | 49 ms | 23.75 ms | 37 ms |
| Fit | 13.68 ms | 40 ms | 18.38 ms | 36 ms |

Release passes the existing 33.3 ms / 250 ms stall / 1 s recovery gates.
**Debug fails the 1 s recovery check for middle drag**, and its other uncached
drags/wheel-out have almost no margin. This does not establish smooth Debug
recovery, nor a controlled Debug speedup. Maximum native intervals are
49.38/62.43 ms for Release/Debug. Cached zoom/fit results are not uncached wins.
Initial ready time is 1.45/2.39 s; filesystem-cache state was uncontrolled, so
no startup speedup is inferred.

Final static fit and dense-grid/label comparisons both have zero changed
interior layout pixels against the earlier references. Warm frame p95 is
13.10/14.36 ms. The dense zoom's cold label preparation alone still takes
919.58 ms, separately from geometry rasterization: cached interaction results
must not hide this remaining bottleneck.

Exact final native build/test commands, from `ecos/chip-viewer`:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo build --release -p chip-viewer-native
cargo build -p chip-viewer-native
```

Build/test logs are `/tmp/chip-kernel-stage2-publication-{tests,release,debug}.log`.
All actual-window commands below run sequentially without concurrent builds or
other renderer tests, with the supplied minirv2 `drc_ecc` manifest, fullscreen
2048×1280 2D, every layer and drawing category, and the llvmpipe CPU route:

```sh
MANIFEST=/home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest
export PYTHONDONTWRITEBYTECODE=1
python3 apps/chip-viewer-native/tests/render_kernel_ab.py --before /tmp/chip-kernel-stage2-before --after target/release/chip-viewer-native --manifest "$MANIFEST" --output /tmp/chip-kernel-stage2-publication-ab
python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py --binary target/release/chip-viewer-native --manifest "$MANIFEST" --output /tmp/chip-kernel-stage2-publication-fidelity --max-response-seconds .25 --max-feedback-seconds .05
python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/release/chip-viewer-native --manifest "$MANIFEST" --output /tmp/chip-kernel-stage2-publication-release-interaction --max-p95-ms 33.3
python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/debug/chip-viewer-native --manifest "$MANIFEST" --output /tmp/chip-kernel-stage2-publication-debug-interaction --max-p95-ms 33.3
```

Static checks run inside `IsolatedDisplay` sequentially, using the same binary
and manifest, with these extra `static_render_e2e.py` arguments:

```sh
--output /tmp/chip-kernel-stage2-publication-static-fit --size 2048x1280 --zoom 1 --reference /tmp/chip-zoom-blocks-fullsize-static-release/screen.png
--output /tmp/chip-kernel-stage2-publication-static-labels --size 2048x1280 --zoom 2.612572 --reference /tmp/chip-zoom-blocks-fullsize-static-labels/screen.png
```

The strict baseline pan reproduction failed at 759 ms with
`--max-settle-seconds .25`, recorded in `/tmp/chip-kernel-stage2-strict-baseline`.
That target has not been relaxed. Python AST syntax checks and
`git diff --check` also pass. Not run: whole `make build`/AppImage or GUI/EDA
product E2E, since no launcher contract, resource staging or packaging inputs
change in this increment; focused native Release and Debug builds are used.
Hardware-GPU timing, macOS/Windows builds, 3D and active-heatmap performance are
not verified. Native source coverage is not a substitute for these checks.

## Dedicated 2D kernel, stage 1, November 11

Architecture and remaining stages are in
`../../../docs/render-kernel-migration.md`. The native CPU path now consumes
`chip_render::geometry2d` commands through a streaming mesh adapter, without a
per-chunk egui frame/painter list. It still uses epaint triangles and the
existing offscreen rasterizer. Coverage caches, exact pan damage redraw and a
direct coverage raster backend are **not implemented** by this extraction.

Final workspace tests: **463 passed, including 359 native**. Added regressions
exercise the UI-independent kernel, every fill pattern/camera/DPR/AA option,
transparent/opaque/translucent colors, exact indexed triangle order across
streaming batches, and cancellation after mesh construction. The independent
original painter is retained under `cfg(test)` as the differential oracle.

Final three-pair Release A/B medians are preparation **296.07→148.77 ms** and
complete uncached pan recovery **880.47→727.09 ms**. Raster/readback medians
are 367.68→364.22 ms, but individual after runs span 350.87–524.22 ms; there is
no reliable raster speedup. An earlier three-pair run measured 882.37→810.13 ms
recovery and a raster regression (373.47→412.50 ms); it remains recorded in
`/tmp/chip-kernel-stage1-ab/report.json`. Do not use presentation FPS or either
set of three medians to claim the 250 ms full-recovery goal is met.

Final Release all-seven interaction checks pass 33.3 ms p95, 250 ms stall and
1 s recovery. **Final Debug fails** full recovery for all three drags and
wheel-out; wheel-out also fails p95 at 39.78 ms. Detailed per-scenario results
are in `/tmp/chip-kernel-stage1-final-{release,debug}-interaction/report.json`.
No Debug A/B speedup is claimed.

Final zoom fidelity passes all six steps plus continuous high-to-low zoom,
with zero unrecognized colored-pixel mismatch. Final static fit and zoom
2.612572 label/grid comparisons each have zero changed interior layout pixels.
First-current-view feedback still exceeds 50 ms in some uncached zooms.

Exact final validation commands, from `ecos/chip-viewer`:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo build --release -p chip-viewer-native
cargo build -p chip-viewer-native
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/render_kernel_ab.py --before /tmp/chip-kernel-stage1-before --after target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-kernel-stage1-final-ab
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-kernel-stage1-final-release-interaction --max-p95-ms 33.3
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/debug/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-kernel-stage1-final-debug-interaction --max-p95-ms 33.3
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-kernel-stage1-final-release-fidelity
```

The A/B command requires a fresh output directory and the preserved before
executable. It records exact child commands and does not silently reuse old
reports. The original strict 250 ms recovery reproduction failed at 920 ms in
`/tmp/chip-kernel-stage1-baseline`; this goal was not relaxed to declare success.
All visible tests use the supplied large design, fullscreen 2048x1280, every
physical layer and drawing category, and the llvmpipe CPU route. Each viewer
runs in its own Xephyr display; no user viewer window is closed or replaced.

Static checks run sequentially inside `IsolatedDisplay` with these exact args
to `static_render_e2e.py`, plus the same manifest and Release binary:

```sh
--output /tmp/chip-kernel-stage1-final-static-fit --size 2048x1280 --zoom 1 --reference /tmp/chip-zoom-blocks-fullsize-static-release/screen.png
--output /tmp/chip-kernel-stage1-final-static-labels --size 2048x1280 --zoom 2.612572 --reference /tmp/chip-zoom-blocks-fullsize-static-labels/screen.png
```

The tests/builds above, Python AST syntax parsing of the changed A/B harness,
and `git diff --check` cover this iteration. Existing compiler warnings remain.
Not run: `make build`/AppImage or full GUI/EDA product E2E, because this stage
changes only the native kernel and local test harness, not launcher contracts,
resource staging or packaging; focused native builds were run instead.
Hardware-GPU timing, macOS/Windows builds, 3D, and active-heatmap performance
were not tested. These remain coverage limits, not reported passes.

## Earlier KLayout-informed application, November 11

The source investigation is in `../../../docs/klayout-rendering-research.md`,
pinned to official KLayout 0.30.9 sources. This iteration applies exact-view
bitmap history, explicit progressive publication, and stable wheel-camera
round trips. It does not implement binary layer coverage, repeated-cell masks,
or exact pan damage redraw.

`cpu_history.rs` limits historical mesh/bitmap payload to four entries / 192 MiB.
A completed raster with resolved labels contributes shared immutable RGBA and
label results instead of another retained copy of its large geometry. Other
scene/label metadata, active scenes, GL targets and the publication mailbox are
outside this payload count. The full Release interaction run's maximum reported
historical budget use is 108.15 MiB after reserving a possible mesh-fallback
copy before it is materialized. A GL-cache failure rebuilds mesh geometry for a
bitmap-only cached scene; this fallback has a regression test.

`wheel_camera.rs` accumulates wheel input relative to a fixed camera in f64,
restoring the original zoom and pan exactly after inverse steps. This fixes
cache misses caused by f32 drift, without accepting a nearby camera as exact.
The test repeats the round trip 100 times and covers cursor anchoring, external
pan changes and limits.

Linux offscreen rasterization can publish ordered geometry prefixes for cold,
content-changing and scale-changing views. The first timer is 25 ms, later timers
are 500 ms; preparation, readback, driver and presentation time are additional.
Same-scale pans retain the existing translated preview and avoid extra partial
readbacks. Published frames carry camera, generation and prefix sequence;
only the matching current generation can be presented. The progressive texture
is updated in place and can become the completed texture. Partial frames never
satisfy complete geometry, label or raster-count checks.

`cpu_scene_partial`, `cpu_scene_cache_hit`, and `cpu_history_bytes` distinguish
partial presentation, restored exact views, and history payload. The existing
`cpu_scene_pending` / `scene_pending` remain true for unfinished geometry or
labels. A partial image has the requested camera; it is not a magnified old
bitmap. `cpu_scene_preview` continues to identify translated complete previews.

The EGL regression compares every forced intermediate snapshot byte-for-byte
against a fresh rendering of that ordered mesh prefix. It also checks final
pixel equality, final-only publication and cancellation after a publication.
Mailbox tests reject stale generations/cameras. Exact-view history tests cover
count/byte eviction, resize/content invalidation, metadata keys, pointer reuse
and the bitmap-only fallback.

The actual-window zoom regression records raw producer snapshots under its
`progress/` directory via test-only `ECOS_RENDER_PROGRESS_EVIDENCE`. Each captured
transition must match the previous/new exact camera or an actual published
prefix at the new camera, under the unchanged 2.5% colored-pixel tolerance.
It does not exempt a frame merely because telemetry calls it partial. Both
first-current-view and complete-geometry latency are reported. Evidence writes
and screenshots can perturb timings; the interaction test runs without raw
evidence output and is the primary frame/recovery performance check.

Final runs use the supplied minirv2 `drc_ecc/output/geometry/geometry.manifest`,
all layers and drawing categories, fullscreen 2048×1280, and llvmpipe. No build,
other benchmark, or Rust test ran concurrently with these native measurements.
Release initial opening, including database loading, is 1.71 s in the final
budget-accounting rerun and 3.04 s in the preceding run. Debug is 3.34 s in the
final run. Filesystem cache state was not controlled.
These startup times must not be confused with warm view recovery.

| Scenario | Release p95 | Release full recovery | Debug p95 | Debug full recovery |
| --- | ---: | ---: | ---: | ---: |
| Left drag | 15.24 ms | 869 ms | 16.79 ms | 1433 ms |
| Middle drag | 14.46 ms | 819 ms | 17.57 ms | 1420 ms |
| Right drag | 14.90 ms | 787 ms | 16.78 ms | 1324 ms |
| Wheel in | 21.61 ms | 36 ms | 25.05 ms | 60 ms |
| Wheel out | 21.61 ms | 719 ms | 23.37 ms | 1248 ms |
| Alternating zoom | 21.18 ms | 39 ms | 27.02 ms | 64 ms |
| Home / fit | 11.85 ms | 44 ms | 17.11 ms | 36 ms |

Release passes all seven scenarios with the stricter 33.3 ms p95, 250 ms stall,
and 1 s recovery gates. Maximum full native intervals are 53.81 ms (Release)
and 52.26 ms (Debug). **Debug fails the unchanged 1 s recovery limit for all
three drags and wheel zoom-out.** Cache hit patterns vary with which intermediate views finish
before cancellation, so individual cached cases are not a cross-build speed
comparison.

Alternating Release recovery improves from the previous 683 ms run to 39 ms.
Uncached pan is not faster: three interleaved before/after left-drag pairs give
median recovery 847 ms before and 908 ms after (about 7% slower); all six still
pass. This measured cost is retained explicitly, not hidden by presentation fps.
Underlying uncached mesh/raster work remains a bottleneck. The software band and
coverage-packet prototypes were rejected because of slower big-design raster
times and residual GL pixel differences; no experimental renderer/driver flags
are shipped.

The final zoom fidelity run passes at all six scales and during continuous
zoom-out with zero unrecognized colored-pixel mismatch. At zoom 6.83 the first
new-view feedback is 105 ms and complete geometry is 175 ms; at zoom 2.61 these
are 158 and 364 ms. These are measured separately from previously held frames.
Completed static fit-view, dense grid/label view, and Debug fit-view each have
zero changed interior layout pixels against their existing references. Their
warm p95 intervals are 13.41, 14.67 and 16.32 ms respectively.

Exact verification commands, from `ecos/chip-viewer` unless specified:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo build --release -p chip-viewer-native
cargo build -p chip-viewer-native
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-klayout-final500-interaction --max-p95-ms 33.3
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-klayout-final500-fidelity
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/debug/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-klayout-final500-debug-interaction --max-p95-ms 33.3
```

Static checks run on separate `IsolatedDisplay` instances using
`static_render_e2e.py --size 2048x1280 --reference <prior screen.png>`; output
directories are `/tmp/chip-klayout-final500-static-{fit,labels,debug}`. Fit and
dense references are `/tmp/chip-zoom-blocks-fullsize-static-release/screen.png`
and `/tmp/chip-zoom-blocks-fullsize-static-labels/screen.png`; the Debug reference
is `/tmp/chip-zoom-blocks-fullsize-static-debug/screen.png`. Dense zoom is
`--zoom 2.612572`; fit zoom is 1. The before/after pan measurements use the same
interaction command with `--scenario left-drag`, alternating
`/tmp/chip-viewer-klayout-stage-baseline` and `target/release/chip-viewer-native`.
Their summary is `/tmp/chip-klayout-pan-ab-report.json`.

After adding conservative fallback-copy accounting, the workspace suite and
both builds were rerun. The final Release and Debug interaction commands are
identical to those above with outputs
`/tmp/chip-klayout-final-budget-interaction` and
`/tmp/chip-klayout-final-budget-debug-interaction`; these supply the table.
This final change affects retention accounting only. Static and zoom-fidelity
artifacts above exercise the same publication, camera and pixel-generation code.

Workspace tests pass: **454 total, including 356 native tests**. The Electron
launch-contract check also passes **52 tests**, run from `ecos/gui` with
`pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/chipViewerService.test.ts`.
Linux Release and Debug binaries build successfully. Final Python syntax and
diff/format checks are recorded with this iteration.

Not run: root `make build` / AppImage packaging, full GUI checks/product EDA E2E,
hardware-GPU timing, macOS/Windows builds, 3D, and active-heatmap/fallback timing.
This iteration changes native in-process rendering/camera/cache behavior, with
no CLI, persisted geometry, launcher, dependency or resource-staging change.
Native release build and launch-contract tests cover the changed scope;
packaged-product integration and those other rendering paths remain unverified.
An already running viewer retains its old executable; builds do not hot-update
it, and automation closes only its own isolated viewers.

Run the Rust rendering regressions from `ecos/chip-viewer`:

```sh
cargo test -p chip-viewer-native cpu_scene
```

These compare complete tessellated meshes against the immediate shape renderer
for overlapping rectangles, patterns, line and point payloads, two DPI values,
and two zoom levels. They also check cancellation, stale-result rejection,
stationary-scene reuse, camera transforms, cache invalidation, return to an exact
cached camera, and complete parallel/serial mesh and label equivalence. Batched
meshes are checked against every original triangle vertex, including color/UV.
Background label placement is compared with the original font measurement and
selection priority at multiple DPI values and after font changes. Cached grid
meshes are compared with live overlays at different cameras and visibility.

`cargo test -p chip-viewer-native interaction_preserves` exercises all ten GPU
fill patterns in a real offscreen wgpu render, reads back the pixels, and checks
that entering interaction does not change any RGBA byte. The test reports an
unavailable adapter as skipped; a software adapter is sufficient for visual
correctness but does not measure hardware GPU performance.

Exact CPU scene preparation runs under one cancellable coordinator with ordered
chunks on at most half the available logical CPUs, capped at eight workers.
Same-scale pan changes are coalesced for 120 ms once an anchor scene exists;
scale changes start immediately. Cold loads also start immediately. Glow borrows the retained
mesh buffers instead of copying them during submission. On Linux, a separate
EGL context rasterizes the exact scene in the coordinator. Its `GL_RENDERER`
must match the window renderer; a mismatch or unavailable EGL device keeps the
bounded UI path. A renderer name is a driver identity check, not proof of the
same physical device on a system with identical GPUs. The background context
uses the same egui shader, native resolution, dithering, alpha blend and ordered
meshes. Completed current-generation bitmaps are read back and uploaded; cold
and scale-changing views can also publish explicitly partial ordered-prefix
snapshots. These partial frames never satisfy exact-completion checks.
Both paths retain ordered bounded meshes. A raster failure disables the
background backend and keeps those meshes for the UI fallback. That fallback
uses at most 12288 indices per batch and a 24 ms submission budget per frame.
An individual driver call is not preemptible; full native intervals remain the
authority for responsiveness.

Label fitting, text measurement and collision resolution use a private font
cache on the coordinator. Completed geometry is published before label fitting,
so a label-heavy camera does not delay its exact geometry. Labels publish through
a separate once-initialized result; returning to cached geometry with cancelled
labels resumes their resolution without rebuilding or rasterizing the scene.
The UI reads completed placements and paints only
accepted labels, without resolving thousands of candidates each frame. CPU
track grids and unrouted guides are appended in their original order to the
cached scene. Active heatmaps retain live overlays so their compositing order
stays unchanged. GPU geometry buffers keep the same key when interaction hides
labels, avoiding a duplicate geometry build/upload at every start and stop.

The Glow fallback keeps the first completed framebuffer, the latest completed
framebuffer, a separate in-progress framebuffer, and an optional progressive
target (at most four UI targets; the background context has its own target).
During same-scale pan, a compatible completed image is translated as a temporary
preview. During zoom or a scale-changing resize, the latest compatible completed
image stays at its original camera until a matching partial or complete image
is ready. It is never magnified or shrunk into colored blocks. This can hold the
previous view briefly; it is not exact completion of the requested camera. A small
refinement notice distinguishes pending work. Content/visibility changes invalidate
the retained image. Exact frames
retain native resolution and are copied without resampling. Geometry labels
wait for exact completion; selection and other overlays remain live. Returning
to a cached exact camera reuses it without preparation or rasterization. There
is no overview substitution or geometry simplification. Unsupported OpenGL
configurations fall back to the same exact meshes without the framebuffer cache.

## Idle full-design benchmark

`static_render_e2e.py` launches the actual native executable in fullscreen 2D,
enables all physical layers and drawing categories, and sends no pointer or
keyboard input. It requires an X11 display, `xwininfo`, `xprop`, `xwd`, and Python
with Pillow. The snapshot is read-only. The harness only closes its own viewer.

```sh
cargo build --release -p chip-viewer-native
python3 apps/chip-viewer-native/tests/static_render_e2e.py \
  --binary target/release/chip-viewer-native \
  --manifest /path/to/output/geometry/geometry.manifest \
  --output /tmp/chip-viewer-static
```

Repeat with a known-good screenshot using `--reference /path/to/screen.png`.
When using a nested display without a window manager, pass `--size 2048x1280`
to explicitly resize and verify the viewer. A fullscreen request alone can leave
the window at 1280x860; such a run cannot be compared with a fullscreen reference.
Screenshots must use the same display size, DPI, theme, and sidebar layout. The
harness checks unchanged draw/primitive counts when a reference `report.json`
exists, and compares interior layout pixels without the status line or rulers.
The Rust tests additionally compare the complete geometry, including edges.

Outputs include `stats.jsonl`, `viewer.log`, `report.json`, `screen.xwd`, and
`screen.png`. A reference run also emits `layout-diff.png`.

The default guardrails are under 100 ms in the canvas update, under 1000 ms
between complete native frames including startup, and under 50 ms for warm
completed-frame p95. Override them with `--max-frame-ms`,
`--max-frame-interval-ms` and `--max-warm-p95-ms` for the target machine.
Use `--zoom 2.612572` to cover dense grids and labels as well as the fit view.
Software rasterization can
remain presentation-bound even when canvas preparation is fast. The batch budget
does not bound an individual driver call, so the full-frame interval is checked
as well as canvas update time.

`first_geometry_ready_seconds` measures wall time until the first complete
geometry sample; it does not include waiting for that frame's presentation.
`scene_pending` covers CPU rasterization and missing GPU geometry tiles;
`geometry_drawn_shapes` excludes grid/guide/analysis overlays so an overlay-only
frame cannot be counted as completed geometry. `cpu_scene_pending` distinguishes loading/refining from a complete exact scene,
including framebuffer rasterization. `cpu_scene_visible` reports whether a
compatible completed image is available. `cpu_scene_preview` identifies translated
same-scale refinement frames. `cpu_scene_held` identifies the previous camera held
during zoom. Neither is exact completion of the requested camera.
`cpu_labels_pending` records independently pending placements; `scene_pending`
continues to include labels so geometry-only publication cannot fake complete
recovery. `cpu_rasterizations` counts completed UI scene installations, including
uploads of restored bitmap views. It is not a background-recomputation counter;
`cpu_scene_cache_hit` distinguishes reuse. The harness checks that a stationary
completed scene does not install again. `cpu_scene_build_ms`, `query_time_ms`, and
`filter_time_ms` describe cached
background preparation, not work repeated on the UI thread. Parallel
`filter_time_ms` reports the longest chunk, not the sum of all worker time.
`frame_time_ms`
and `paint_time_ms` describe the current canvas update; `frame_interval_ms`
also includes tessellation, rendering, presentation, and scheduling. The
`previous_native_cpu_ms` measurement comes from eframe and excludes swap/vsync;
`previous_ui_update_ms` measures the entire application update, excluding egui's
subsequent tessellation/painting. These describe the **previous** native frame
and application update, respectively (egui may run multiple update passes per
frame). They must not be interpreted as the current canvas time. Measure these
separately
so a fast loading placeholder cannot disguise slow completion or presentation.
`cpu_scene_raster_ms` and `cpu_label_resolve_ms` measure completed background
work. `label_resolve_time_ms` measures the current UI placement phase;
`previous_raster_present_ms` measures the previous exact-cache GL callback,
excluding later driver execution and swap. None substitutes for full intervals.

## Zoom transition fidelity

The interaction timing gate and its one midpoint screenshot did not detect
cross-scale enlargement of the fit-view bitmap. `zoom_fidelity_e2e.py` reproduces
that defect through the actual fullscreen window with all layers/categories on:
first complete the fit view, zoom to about 318, then step down through about 122,
47, 18, 6.8 and 2.6 before explicitly fitting the design again. The wheel's
fixed ratio skips over fit zoom, so the last transition uses the Fit shortcut.
It captures transition frames until each camera completes, then repeats the
descent with continuous wheel input and the same final Fit action.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py \
  --binary target/release/chip-viewer-native \
  --manifest /path/to/output/geometry/geometry.manifest \
  --output /tmp/chip-viewer-zoom-fidelity
```

Every captured transition must match the preceding completed camera, the
requested completed camera, or an actually published ordered-prefix snapshot
at that requested camera within 2.5% of interior colored pixels. Reference
frames include the same camera with labels hidden by a short out-and-back middle
drag, so delayed label publication does not masquerade as changed geometry. This
does not allow arbitrary blurry or magnified bitmap previews. The harness also
requires a changed final view, a new-geometry response under 1 s, and native-frame
p95 under 33.3 ms. It records previous-camera holding separately from completion.
XWD capture occurs during input; PNG encoding is deferred until the camera has
completed to avoid competing with the software renderer during the measurement.

Outputs include every transition XWD/PNG, `comparison.png`, `stats.jsonl`,
`viewer.log` and `report.json`. These are sampled visual regressions, not proof
about every display refresh or every backend. The full timing interaction harness
remains necessary, and the settled static reference remains the exact pixel gate.

For an isolated uncached high-zoom-to-fit timing without writing progressive RGBA
evidence, use `--fit-recovery-only`. It records exact-geometry and full-label
readiness separately and requires that the fit source, rather than scene history,
serves the return camera.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py \
  --binary target/release/chip-viewer-native \
  --manifest /path/to/output/geometry/geometry.manifest \
  --output /tmp/chip-viewer-fit-recovery \
  --fit-recovery-only
```

## Explicit uncached zoom sampling

Add `--uncached-steps --max-feedback-seconds 0.05 --max-full-response-seconds 0.25`
to `zoom_fidelity_e2e.py` to prepare a distinct high-camera pan before stepping
down through the five non-fit cameras. The harness asserts a new rasterization
for preparation and rejects any restored-history completion in those five
steps. Home restores the original fit anchor; continuous zoom uses the same
camera offset. Renderer route, visibility, dimensions and fidelity gates remain
unchanged. The aggregate `render_zoom_gate.py` still requires 20 uncached
observations per non-fit camera for both baseline and candidate.

Implementation, exact-value oracles, failed experiments and window evidence:
[label measurement](../../../docs/render-label-measurement.md) and
[sparse residual coverage](../../../docs/render-sparse-coverage.md).

## Measured static regression

The `minirv2/ws_0001/drc_ecc` design was checked at fullscreen 2D with every
physical layer and drawing category enabled, using the local llvmpipe software
renderer. No drag, zoom, or other input was sent. These are local measurements,
not hardware-independent targets or interaction/3D benchmarks.

| Metric | Before | Release after | Debug after |
| --- | ---: | ---: | ---: |
| Maximum canvas update | 8243.8 ms | 4.7 ms | 10.9 ms |
| Maximum native frame interval | 9876.7 ms | 66.0 ms | 103.6 ms |
| Warm frame interval p95 | not recorded | 17.7 ms | 26.0 ms |
| First complete geometry sample | not recorded | 3.14 s | 3.55 s |
| Completed scene rasterizations | not recorded | 1 | 1 |

Both final runs retained 341651 drawn shapes and 491712 estimated primitives,
with zero changed pixels in the compared interior layout region against an
immediate exact-render reference. All 437948 dataset shapes were enabled; the
existing viewport and zoom visibility policy still determines the drawn count.

## Interactive full-design benchmark

`interaction_render_e2e.py` sends XTest input through the native window system,
not directly into the renderer. It runs its own Xephyr display so the host
pointer, keyboard, and existing viewer processes are not manipulated. In addition
to the static harness requirements, install Xephyr and the X11/XTest libraries.
Without a window manager in the nested display, the harness explicitly sizes its
own viewer to the display dimensions; the default is 2048x1280.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py \
  --binary target/release/chip-viewer-native \
  --manifest /path/to/output/geometry/geometry.manifest \
  --output /tmp/chip-viewer-interaction-release
```

Repeat with `target/debug/chip-viewer-native` to cover the desktop development
launch path. Do not run timing benchmarks concurrently. Use `--scenario
middle-drag` for the minimized drag regression.

The scripted sequence covers left-, middle-, and right-button drags with a
direction reversal, continuous wheel zoom in and out, alternating wheel zoom,
and Home/fit-to-view. It enables every physical layer and drawing category in
read-only view mode. The harness saves per-scenario screenshots, frame samples,
viewer/server logs, and a JSON report, including failing verdicts.

Default guardrails check active frame p95 below 50 ms, no frame above 250 ms
including recovery, geometry visible in at least 95% of active samples, and a
complete exact scene within one second of release. These are configurable local
anti-stall targets, not a claim of 60 FPS. The visibility check deliberately
rejects smooth blank loading frames. Pending CPU scenes are not counted as
visible just because grid or guide overlays increment the total drawn count.
Temporary camera previews report visibility separately from exact-scene
completion rather than treating a preview as ready. Drag screenshots also check
for substantial colored layout content, so a black preview cannot pass solely
through telemetry. `--skip-during-screenshots` is a diagnostic A/B option that
disables only the mid-input captures and their visual assertions; it does not
relax the timing or exact-completion thresholds. Default validation retains all
visual checks.

Recovery waits for two new complete samples after the last input so stale
pre-input frames cannot pass the check. Wheel zoom must actually change scale
and return to its original scale. Fit-to-view must restore the initial exact
layout pixels in the same interior region used by the static harness. A reversed
drag is not required to return to identical pixels: the native drag threshold
can legitimately consume the first few motion pixels.

### Interactive baseline before retaining camera previews

On the same minirv2 design and local llvmpipe software renderer, the isolated
2048x1280 sequence produces the following measurements. Both Release and Debug
exit with a failing performance verdict; the static-render result does not imply
interactive readiness.

| Scenario | Release active frame p95 | Release geometry visible | Release recovery | Debug recovery |
| --- | ---: | ---: | ---: | ---: |
| Left drag | 18.0 ms | 1.3% | 2.09 s | 4.01 s |
| Middle drag | 20.6 ms | 0.8% | 1.75 s | 3.94 s |
| Right drag | 17.5 ms | 0.6% | 1.95 s | 4.01 s |
| Wheel zoom in | 62.2 ms | 62.1% | 0.03 s | 0.06 s |
| Wheel zoom out | 84.5 ms | 42.1% | 1.83 s | 3.86 s |
| Alternating zoom | 90.2 ms | 1.4% | 1.75 s | 3.95 s |
| Fit to view | 24.8 ms | 25.0% | 1.81 s | 3.84 s |

The largest full-frame interval, including recovery, was 125.7 ms in Release
and 131.2 ms in Debug. Nevertheless, screenshots show the layout disappearing
during drag. A fast frame containing only the loading message is not smooth
layout interaction. Fit-to-view restored the initial interior layout pixels
exactly in both builds after recovery.

The baseline retained scene key included viewport, zoom, and pan. Every camera
change invalidated `CpuSceneCache::ready`; the canvas then displayed loading
instead of geometry while a background build is requested. Continuous input
cancelled those builds before completion. These failing checks preceded the
camera-preview and ordered parallel-preparation changes described above.

### November 10 verdict before background rasterization and overlay caching

Final runs on November 10, 2026 use the same design, all visibility switches,
2048x1280, llvmpipe, and the default mid-input screenshot assertions. No build,
Rust test, or second benchmark ran concurrently. The initial exact scene took
2.41 s in Release and 4.17 s in Debug on the isolated display. Static results
above use the host display and should not be conflated with this startup time.

| Scenario | Release frame p95 | Debug frame p95 | Visible samples | Release exact recovery | Debug exact recovery |
| --- | ---: | ---: | ---: | ---: | ---: |
| Left drag | 15.9 ms | 19.6 ms | 100% | 1.16 s | 2.40 s |
| Middle drag | 15.9 ms | 19.9 ms | 100% | 1.04 s | 2.28 s |
| Right drag | 16.2 ms | 18.8 ms | 100% | 1.06 s | 2.32 s |
| Wheel zoom in | 51.5 ms | 85.6 ms | 100% | 0.10 s | 0.18 s |
| Wheel zoom out | 62.1 ms | 111.9 ms | 100% | 1.03 s | 2.02 s |
| Alternating zoom | 84.1 ms | 87.0 ms | 100% | 1.11 s | 2.38 s |
| Fit to view | 16.3 ms | 26.5 ms | 100% | 0.03 s | 0.03 s |

Both builds preserve substantial colored geometry in the actual drag captures;
the visibility result is not just a telemetry flag. Fit-to-view returns with
zero changed interior layout pixels in both builds, as does each static run
against the immediate exact reference. Maximum native frame intervals over the
entire interaction runs are 115.3 ms (Release) and 121.4 ms (Debug), below the
250 ms stall guardrail. Warm stationary scenes still rasterize only once.

The geometry-disappearance regression is fixed, and all three drag p95 checks
pass. **Neither complete interaction run passes:** wheel p95 and several exact
recovery times still exceed the unchanged 50 ms / 1 s limits. Preview visibility
must not be reported as exact recovery or as evidence that these failures have
passed. Small batches reduce individual rasterization stalls but do not make
llvmpipe's total rasterization work disappear.

Additional minimized profiles place the remaining zoom stalls outside the
canvas/UI preparation: preceding updates are usually under 1 ms while native
frame intervals can exceed 70 ms. Native CPU timing excludes swap/vsync, so the
unaccounted time includes presentation and scheduling, not necessarily CPU
geometry construction. Removing mid-input screenshots, replacing scaled blits
with a textured quad, and disabling vsync did not eliminate the slow frames.
The experimental quad and vsync changes were removed; no driver environment
overrides are required or shipped.

### November 10 validation scope

- `cargo fmt --all -- --check`: passed.
- `cargo test --workspace`: 425 tests passed, including 327 native tests.
- `cargo build --release -p chip-viewer-native`: passed.
- `cargo build -p chip-viewer-native`: passed.
- `pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/chipViewerService.test.ts` from `ecos/gui`: 52 tests passed.
- Both real-design static/reference harness runs: passed, zero changed layout pixels.
- Both full interaction harness runs: exited 1 for the timing failures above;
  visual continuity, exact return, and the stall guardrail passed.
- `git diff --check`: passed.

No full `make build`/AppImage or complete desktop E2E was run: this change builds
the native renderer rather than packaging or re-running the EDA product flow.
Hardware GPU, 3D, other desktop platforms, and unsupported-GL mesh-fallback
performance remain unvalidated. Existing unrelated antenna/Electron and ECC
working-tree changes were retained rather than reset.

## November 11 KLayout-informed iteration

Source findings are pinned to the installed KLayout 0.30.9 tag in
`../../../docs/klayout-rendering-research.md`. ECOS independently implements
background exact rasterization and retained completed results; it does not copy
KLayout's GPL renderer or replace ECOS's alpha blending with binary masks.

The original interaction shader replaced patterned fills with solid coverage.
The new GPU readback regression first failed with 16028 differing pixels, then
passed with zero differences after removing that override. Both images use the
same camera; the test isolates the interaction flag from camera resampling.

Profiling also identified a 523 ms first label-resolution call on the UI
thread. Independent worker fonts and retained placements remove it from the UI.
At zoom 2.612572, about 6091 grid/guide lines had bypassed the scene cache and
were re-tessellated and rasterized each frame, including during refinement.
Retaining them is necessary as well as retaining the base shapes: otherwise a
sub-millisecond canvas update can still have an 80–110 ms native interval.

The final target is the same read-only `minirv2/ws_0001/drc_ecc` manifest, all
physical layers and drawing categories, 2048x1280 fullscreen 2D, llvmpipe. Each
performance run is sequential and has no competing build or test process.
The user's existing viewer and KLayout windows are left running. Results are
local to this machine and are not a hardware-GPU or cross-platform claim.

| Scenario | Release frame p95 | Debug frame p95 | Visible samples | Release exact recovery | Debug exact recovery |
| --- | ---: | ---: | ---: | ---: | ---: |
| Left drag | 14.80 ms | 20.50 ms | 100% | 0.899 s | 1.645 s |
| Middle drag | 14.75 ms | 17.09 ms | 100% | 0.819 s | 1.434 s |
| Right drag | 13.13 ms | 18.50 ms | 100% | 0.763 s | 1.357 s |
| Wheel zoom in | 15.10 ms | 18.24 ms | 100% | 0.110 s | 0.160 s |
| Wheel zoom out | 13.85 ms | 16.67 ms | 100% | 0.775 s | 1.355 s |
| Alternating zoom | 12.83 ms | 17.11 ms | 100% | 0.770 s | 1.354 s |
| Fit to view | 12.72 ms | 19.90 ms | 100% | 0.040 s | 0.035 s |

**Release passes the entire interaction gate in three consecutive runs.** Its
maximum interval including recovery was 64.12 ms in the final full sequence
(45.35 ms and 52.78 ms in the preceding runs). Debug passes every active frame, visibility,
visual-return and stall check but still fails five exact-recovery checks against
the unchanged 1 s threshold. Do not describe Debug as passing the full gate.

Static full-view first completion was 1.72 s in Release and 3.54 s in Debug;
warm p95 was 12.77 ms and 15.45 ms. Both have zero changed interior layout
pixels against the original immediate-renderer reference and rasterize the
stationary scene only once. At zoom 2.612572, the final Release output also has
zero changed pixels against the pre-worker label/grid reference; warm p95 is
14.67 ms, versus 87.16 ms in that reference and 114.36 ms before grid caching.
The first label fitting still costs about one second in this static zoomed view,
but runs on the worker; UI label resolution stays below 0.1 ms. It is not
counted as completed until both labels and exact geometry are ready.

Evidence directories:

- `/tmp/chip-viewer-overlay-interaction3` — first passing Release sequence.
- `/tmp/chip-viewer-klayout-verified-interaction-release` and `-debug` — final sequences in the table.
- `/tmp/chip-viewer-klayout-verified-static-release` and `-debug` — final fit-view references.
- `/tmp/chip-viewer-klayout-verified-label-static` — final zoomed label/grid reference comparison.
- `/tmp/chip-viewer-wgpu-cache-interaction` — explicitly forced software-wgpu experiment.

The forced software-wgpu run preserves geometry and exact fit-return pixels but
fails every timing scenario (drag p95 about 350 ms). Automatic backend selection
continues to reject this software adapter for the hardware-GPU path. This is
neither a hardware GPU benchmark nor evidence that the GPU path is fast enough.

Custom GL presentation shaders, CPU preview resampling, and reduced llvmpipe
thread counts did not pass the zoom gate and were removed. Skipping bounded
mesh preparation reduced part of Debug preparation but increased raster time;
it did not improve total recovery and was also removed. No driver environment
overrides or relaxed thresholds are shipped.

Validation after the final changes:

- `cargo fmt --all -- --check`: passed.
- `cargo test --workspace`: 429 passed, including 331 native tests.
- `cargo build --release -p chip-viewer-native` and `cargo build -p chip-viewer-native`: passed.
- Electron launch test command from the previous section: 52 passed.
- Real-design static fit/zoom pixel comparisons: zero changed layout pixels.
- Real-design full Release interaction: passes; Debug recovery remains as above.
- `git diff --check` and Python AST parsing of both harnesses: passed.

No `make build`/AppImage was run because this iteration validates the native
executable without staging or packaging product resources. Full product EDA E2E,
hardware GPU, 3D, macOS/Windows, active heatmap performance, and unsupported-EGL
fallback performance have not been benchmarked. CPU grid meshes and label
placement correctness are covered by regression tests, including DPI,
selection, visibility, cancellation and cache invalidation.

## Zoom-block regression follow-up

The final reproduction uses the same manifest, fullscreen 2048x1280, all layers
and drawing categories, and the default local software renderer. The old binary
fails the final fidelity harness at five intermediate zooms and during continuous
zoom-out. Up to 96.38% of interior colored pixels differ from every applicable
completed reference. The cause is coverage-first selection of a fit-view bitmap
followed by nearest-neighbor enlargement, even when a detailed frame exists.

Scale changes now hold the latest completed camera at native resolution and
dispatch new exact work immediately. Geometry publishes before label placement.
Same-scale pan retains translated previews. Four added Rust regressions cover
scale preservation, pan translation, immediate zoom dispatch, and resuming labels
on cached geometry after cancellation.

The final Release fidelity run passes: 35 captured transition frames across
stepped and continuous zoom-out, new exact-geometry samples in 69, 72, 103, 192,
408 and 835 ms at successive zooms. Maximum stepped colored mismatch is 29 pixels;
continuous mismatch is 0.2074%, below the unchanged 2.5% fidelity threshold. Label
appearance and disappearance are compared with actual same-camera references.
The Debug run passes the visual checks but fails the 1 s geometry-response gate
on return to fit view at 1.479 s. Do not describe it as passing the full gate.

| Final full interaction | Release p95 | Debug p95 | Release exact recovery | Debug exact recovery |
| --- | ---: | ---: | ---: | ---: |
| Left drag | 16.45 ms | 17.65 ms | 0.843 s | 1.656 s |
| Middle drag | 14.80 ms | 18.30 ms | 0.765 s | 1.416 s |
| Right drag | 15.70 ms | 18.40 ms | 0.741 s | 1.477 s |
| Zoom in | 28.38 ms | 28.42 ms | 0.031 s | 0.059 s |
| Zoom out | 24.63 ms | 30.77 ms | 0.652 s | 1.278 s |
| Alternating zoom | 27.17 ms | 23.47 ms | 0.683 s | 1.240 s |
| Fit to view | 14.85 ms | 17.05 ms | 0.035 s | 0.033 s |

Release passes every full interaction check, with a maximum native interval of
71.27 ms including recovery. Debug passes active-frame, visibility, stall and
fit-return pixel checks, but still fails five recovery checks. Holding an old
clear view is explicitly distinct from completing the requested camera; neither
the visible-image fraction nor frame p95 alone proves responsive exact recovery.

All three correctly sized static comparisons pass with **zero changed interior
pixels**: Release fit view, Release zoom 2.612572 including grids/labels, and
Debug fit view. Warm p95 is 13.04, 15.21 and 19.07 ms respectively. The initial
static attempts at 1280x860 were rejected, not counted as valid pixel comparisons.

Final evidence:

- `/tmp/chip-zoom-fidelity-raw-original`: old binary fails the visual regression.
- `/tmp/chip-zoom-fidelity-raw-release`: final Release fidelity pass.
- `/tmp/chip-zoom-fidelity-final-debug`: Debug fidelity checks pass; response gate fails.
- `/tmp/chip-zoom-blocks-final-interaction-release` and `-debug`: final timing gates.
- `/tmp/chip-zoom-blocks-fullsize-static-release`, `-labels`, `-debug`: exact pixel comparisons.
- `/tmp/chip-zoom-blocks-before-after.png`: representative before/after transition captures.

Exact validation commands, from `ecos/chip-viewer` unless otherwise stated:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo build --release -p chip-viewer-native
cargo build -p chip-viewer-native
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-zoom-fidelity-raw-release
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/zoom_fidelity_e2e.py --binary target/debug/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-zoom-fidelity-final-debug
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-zoom-blocks-final-interaction-release
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/interaction_render_e2e.py --binary target/debug/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --output /tmp/chip-zoom-blocks-final-interaction-debug
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/static_render_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --size 2048x1280 --reference /tmp/chip-viewer-static-direct-reference/screen.png --output /tmp/chip-zoom-blocks-fullsize-static-release
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/static_render_e2e.py --binary target/release/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --size 2048x1280 --zoom 2.612572 --reference /tmp/chip-viewer-klayout-label-reference/screen.png --output /tmp/chip-zoom-blocks-fullsize-static-labels
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/static_render_e2e.py --binary target/debug/chip-viewer-native --manifest /home/ekko/Desktop/ECOS/template/minirv2/ws_0001/drc_ecc/output/geometry/geometry.manifest --size 2048x1280 --reference /tmp/chip-viewer-static-direct-reference/screen.png --output /tmp/chip-zoom-blocks-fullsize-static-debug
```

The static commands ran sequentially in isolated Xephyr displays. Workspace tests
pass 433 cases, including 335 native cases. From `ecos/gui`, the launch contract
also passes all 52 cases:

```sh
pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/chipViewerService.test.ts
```

Python AST parsing and `git diff --check` pass. No `make build`/AppImage or full
product EDA E2E was run: this change validates local native rendering without
staging or packaging resources or changing the RTL-to-GDS flow. Full GUI checks,
hardware GPU, 3D, other operating systems, active heatmaps and unsupported-EGL
fallback performance were not rerun. The user's existing viewer and KLayout
processes remain untouched; an already running binary does not hot-reload a build.
## Repeated strict zoom evidence

`docs/render-retained-validity.md` records the restricted integer-pan validity
path, its pixel oracles, bounded retained inputs, failed presentation prototype,
and the remaining zoom/whole-product failures. A validated region frame is
partial; it cannot satisfy complete geometry/label recovery. The additional
`cpu_retained_valid_pixels` and `cpu_retained_validation_ms` fields expose the
amount and cost of reuse without changing this harness's timing thresholds.

`render_zoom_gate.py` aggregates multiple `zoom_fidelity_e2e.py` reports without
mixing cached and uncached completion. It requires 20 uncached samples per
non-fit camera by default, checks feedback/geometry/labels separately, rejects
diagnostic or incomplete evidence, and returns nonzero on strict timing,
fidelity or uncached full-recovery regressions. This is a zoom gate, not proof
that the entire renderer is performant; cold static load and all drag/input
journeys remain separate checks.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s apps/chip-viewer-native/tests -p 'test_render_*.py'
PYTHONDONTWRITEBYTECODE=1 python3 apps/chip-viewer-native/tests/render_zoom_gate.py --baseline /path/to/before-1/report.json /path/to/before-2/report.json --candidate /path/to/after-1/report.json /path/to/after-2/report.json --output /path/to/zoom-gate.json
```

Two reports in the example are intentionally insufficient for default
acceptance; supply enough genuinely uncached observations. See
`docs/render-direct-packet-investigation.md` for the rejected stage-8 trials,
persistent evidence paths and the remaining strict failures.

### Ordered sparse rectangle kernel (stage 10)

`docs/render-sparse-rectangles.md` describes the Release-only certified-profile
CPU rectangle / original-GL repair path, disjoint repair scissors, exact ordered
grid-overlay tail, fallback budgets and rejected experiments. It records the
final fullscreen all-visible pixel checks, interleaved drag measurements and
the still-failing live-feedback / full-zoom gates. Drag `settle_seconds` waits
for two non-pending samples; the current native `scene_pending` includes label
completion. Use the separate geometry and label timestamps in the zoom harness
to distinguish those phases. The default 20-uncached-sample zoom
gate remains required; the small investigative A/B does not satisfy it.

Force the certified oracle rather than accidentally testing another EGL device:

```sh
ECOS_REQUIRE_COVERAGE_EGL=1 ECOS_COVERAGE_GL_RENDERER='llvmpipe (LLVM 20.1.2, 256 bits)' cargo test -p chip-viewer-native pixel_rect_tests -- --nocapture
```

`ECOS_DISABLE_SPARSE_RECTS=1` retains the original production GL stream for
diagnosis. Debug builds and unknown renderer/version/DPR/options already retain
that path automatically. Do not use Debug scalar timings to promise Release
performance or describe held old-camera images as current geometry.

### Deferred font atlas upload

`docs/render-interaction-first-snapshot.md` records the 1×1 white texture path,
the full-atlas fallback for any non-white default UV (including prepared discs),
actual EGL prefix comparisons, and the remaining strict latency failures.
This preserves the existing shader and does not cache atlas content by size.

```sh
ECOS_REQUIRE_INTERACTION_EGL=1 cargo test -p chip-viewer-native raster_font_tests -- --nocapture
```

`interaction_render_e2e.py --raster-trace` now enables the same raster diagnostic
as the static and zoom harnesses. It explicitly marks the report diagnostic;
its extra `gl.finish()` calls make it unsuitable for acceptance timing. The
untraced harness keeps all existing feedback, recovery, and stall limits.

### Rectangle composition diagnostics

`docs/render-byte-blend.md` records a rejected SSE2 trial: byte-identical static
pixels and faster row composition did not prevent real zoom-recovery regressions.
Production retains the original raster kernel. A small regression locks down
alpha operand order at integer-rounding boundaries; it requires no EGL context.

```sh
cargo test -p chip-viewer-native sparse_alpha_preserves_operand_order
cargo run --release -p chip-view-db --example layer_query_bench -- /path/to/geometry.manifest 30
ECOS_REQUIRE_COVERAGE_EGL=1 ECOS_COVERAGE_GL_RENDERER='llvmpipe (LLVM 20.1.2, 256 bits)' ECOS_COVERAGE_MANIFEST=/path/to/geometry.manifest ECOS_COVERAGE_SPARSE_CHECK=1 ECOS_RECT_BLEND_BENCH_ITERATIONS=30 cargo test --release -p chip-viewer-native coverage_real_design_command_domain_profile -- --ignored --nocapture
```

The query example checks complete ordered results against the single-layer API;
the optional rectangle diagnostic times the actual prepared operation stream
outside background initialization. Neither replaces the unchanged full-window
interaction, static-pixel, fidelity or repeated uncached-zoom gates.
