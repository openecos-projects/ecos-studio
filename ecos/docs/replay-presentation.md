# Change-driven Replay: current implementation

Updated 2026-11-16. This describes source behavior, not a claim that every item
in the broader design has met its acceptance criteria.

## Playback and results

One bottom timeline follows the actual workspace flow. Small circles seek exact
subflow states; large circles select authoritative completed results. The Play
button precedes the bar. Display duration comes from observable changes, not
execution time; original monotonic timestamps remain inspectable. Idle intervals
collapse; phases and metric events remain short nodes. Consecutive compatible
Place samples interpolate over 0.3–1.2 seconds each, with up to 64 movement trails.
Legalization, restoration and structural changes have distinct batch transitions.
Floorplan and routing geometry appear by type, numeric layer and spatial order.
These are presentation effects between recorded facts, not invented tool samples.

Added, moved, resized, reoriented and reconnected instances remain highlighted.
Deleted instances have red outlines/crosses. Completion uses the final committed
scene; interpolated coordinates never alter the recorded metrics or scene.
Place maps automatically follow completion and use a selectable right-side list.
Completed postFloorplan/CTS/filler snapshots embed Native's actual hierarchical
clock graph. Early snapshots default to level, CTS/post-route snapshots to delay
when present. Trees do not appear during physical replay. Tree and report-item
selection locate exact recorded instance/net/pin references; unresolved references
remain visible as missing, not guessed coordinates.

The bottom of the right sidebar contains the frozen checklist. Blocked is red;
other recorded states are green with their original labels. An empty/missing
checklist is identified rather than turned into an invented pass.

Result views include native violation geometry, timing paths, instance power,
net R/C summaries and per-corner SPEF node/resistor networks, solved EMIR node/edge data, Harden LEF pin/OBS overlays and LIB
port/arc metadata. Analysis is bound to the final scene and only shown after
completion. Report-only operations browse actual results without fake cell motion.

## Data lifecycle

ECC now produces `ecos.replay.v2`; Native and Electron also accept existing v1.
V2 declares JSON or gzip+JSON encoding, supports pure-translation deltas with
pin updates, and places checkpoints by byte/depth budget. Sparse checkpoints
explicitly declare `json+base` / `gzip+json+base` and reference the immutable
input checkpoint (index 0); older readers reject this encoding rather than
silently displaying an incomplete scene. Identity includes an
observed birth suffix after deletion/recreation. Large shape identities use a
SHA-256 key; geometry retains layer, net owner, segment width and native pin data.
History remains explicitly sampled; unobserved operations are not inferred.

Tool completion seals the package. Parent flow completion freezes QoR/checklist
and atomically publishes the current pointer with an attempt ID and checksum.
Late workers cannot overwrite a rerun. Disabled capture invalidates older results.
Fresh report checks use a filesystem clock anchor, avoiding client/NFS clock skew.
Frozen report sources, maps and clock-tree side files are inventoried with hashes.
Read-only check failures with valid fresh reports may publish diagnostic-only
results while retaining the failed flow state. Missing/corrupt final data does
not silently substitute an earlier successful recording.

Structural metric deltas are tied to the actual input DEF and matching selector/
unit. Electrical deltas require compatible explicit analysis context. They are
omitted when legacy timing/power reports lack that context.

## Rendering and load behavior

Reconstruction, spatial indexing, tree preparation and report resolution run on
a worker thread. Superseded seeks cannot replace newer requests. Map decoding is
also asynchronous and pauses the display clock while loading. The decoded-frame
cache has an ordinary delta budget (`ECOS_REPLAY_CACHE_MIB`, default 128 MiB,
cap 512 MiB) and at most two oversized full checkpoints. Their additional byte
budget is eight times the ordinary budget, capped at 1 GiB; zero disables both.
Scene/index memory and the input anchor are separate. Immutable object records
and their ordered tables, deletion records and highlight sets are shared across
scenes. A delta validates all translations before mutation, then detaches the
table and only the changed objects when another snapshot still references them.
Consecutive private translations reuse objects and pin attributes. This changes
in-memory ownership only; v1/v2 JSON and gzip captures remain compatible.
The loader pins one immutable input checkpoint and prefetches at most the next
compatible movement while the current animation plays. A new seek cancels old
work; it does not retain every historical scene. Spatial queries exclude unplaced/offscreen geometry.
The spatial tree sorts compact bounds/slots while object references and names
stay in a separate stable array. Tests exercise queries across tree partitions
and swept movement bounds. Highlight membership queries are limited to rendered
instances/macros; the captured touched set itself remains unchanged.

The 2D canvas retains static meshes and updates dynamic objects in compact
batches. Full-chip static subpixel vias use pixel coverage; exact geometry is
retained for zoom/focus and inspection. Dense track grids are hidden at the
full-chip scale. Cache invalidation follows scene, animation, viewport and focus
changes. This is separate from the ordinary layout renderer.

### Snapshot ownership contract

`Scene::apply(&mut self, delta: Delta) -> Result<(), &'static str>` preserves
all existing snapshots. `Scene.objects` and `Delta.upsert` use
`Arc<BTreeMap<String, Arc<Object>>>`; touched/restored sets and deletion tables
also use `Arc`. Serde reads/writes the underlying collections, without adding
JSON wrappers or changing capture schemas, paths, timestamps or cache budgets.
Referenced checkpoints detach the anchor table before merging their overrides.

Translation validation finishes for the entire batch before any mutation:

| Input | Result |
| --- | --- |
| Existing instance/macro with valid coordinates and pins | Move bbox and all pin positions; preserve other attributes |
| Shared table/object | Detach before mutation; cached input and previous scenes stay unchanged |
| Private object in consecutive translations | Reuse its allocation and attributes |
| Absent/non-instance target, upsert/remove conflict, coordinate overflow or invalid pin | Return an error; preserve the complete previous scene |
| Translation in a checkpoint, unresolved base or non-checkpoint revision gap | Reject before changing geometry or highlights |

Do not move objects while validating successive IDs: a later invalid pin must
not leave earlier objects moved. Validate all IDs first, then use
`Arc::make_mut` on the table and changed objects. A full checkpoint shares its
validated table directly. Metric-only deltas leave the object table shared.

Regression assertions cover snapshot bbox/pins, reuse across private moves,
late invalid/overflowing pins and complete scene equality after rejection.
Real-data validation compares sequential and 100 random reconstructions,
including deleted/restored/touched sets. Tiny-via aggregation tests compare the
complete mesh: hash accumulation retains pixel coverage and emits sorted pixel
coordinates for deterministic drawing.

## Reproducible verification

- ECC: `.venv/bin/ruff check chipcompiler test`,
  `.venv/bin/ruff format --check chipcompiler test`,
  `.venv/bin/pytest -q test`: 4469 passed, 6 skipped, 1 deselected, 4 xfailed.
- Native: `cargo fmt --all -- --check`, `cargo test --workspace`,
  `cargo build --release -p chip-viewer-native` (rerun after rendering changes).
- GUI: `pnpm run check`: Electron 1569 passed, 2 skipped; renderer/shared/infra
  checks also passed. Optional real-workspace catalog tests use
  `ECOS_REPLAY_TEST_WORKSPACE`.
- Kepler: `ctest --test-dir build-replay -R '^(ReplayTests|KeplerFormalCliTests)\.'
  --output-on-failure`: 234 passed. New Sizer and ECC-Tools builds succeeded.
- Real isolated GCD: full flow and terminal-Place flow; real AES: 22 stages
  through Harden, including diff_opt/diff_sizing and five DR iterations.
  GCD Harden rerun produced six export boundary events and 11 result views.
- Product GUI/terminal/concurrency E2E journeys passed. The broader accidentally
  selected suite initially failed two dashboard layout assertions. The test
  coordinate origin omitted stable scrollbar gutters; correcting that origin
  (without relaxing the threshold) passed the focused six-case rerun. EMIR's product E2E process fixture is synthetic and is
  not signoff validation.

Opt-in native tests:

```sh
ECOS_REPLAY_TEST_CATALOG=/path/to/ws/home/replay-view.json \
  cargo test --release -p chip-viewer-native \
  real_workspace_random_seek_and_frozen_artifacts -- --ignored --nocapture
ECOS_REPLAY_TEST_CATALOG=/path/to/ws/home/replay-view.json \
  cargo test --release -p chip-viewer-native \
  real_layout_animation_cpu_frame_time -- --ignored --nocapture
```

The first compares sequential reconstruction with 100 random seeks per step,
including highlights/deletions/revision, validates frozen assets, and measures
seek+spatial-index CPU latency. It is not a request-to-visible UI benchmark.
The second measures 120 animation frames at a 1000×800 viewport, including egui
CPU tessellation but excluding GPU submission. First-frame preparation is separate.

A derived-format test on 66 real AES Place frames reduced frame bytes from
2,518,204,395 to 49,055,622 (98.05%). This was a repack of captured data, not an
EDA capture rerun. Legacy-key AES random seek still exceeded the 1 s target;
increasing cache to 512 MiB did not fix it. Rendering initially measured 242.7 ms
P95; retained batches reduced it to 40.4 ms before the subpixel-via optimization.
Fresh producer and final rendering measurements are recorded in the completion
ledger; these preliminary figures do not prove the full performance target.

The current producer was rerun on AES Place: 66 frames, 107,942 objects,
100 random seeks with exact sequential-state comparisons, seek+index P95
923.9 ms and reconstruction P95 844.5 ms. The CPU animation benchmark after
subpixel-via aggregation measured P95 27.5 ms, excluding GPU submission.
These measurements do not establish request-to-visible UI/GPU latency.

Sizer now records bounded CELL accepted/reverted batches separately from committed
OpenDB geometry. Process evidence is expandable in the right sidebar. Legalizers
record actual Greedy/Abacus/retry/restoration/M2 boundaries; packed hybrid vectors
are captured only after restoring the physical node order. Kepler records CEC
solver/output and SEC proof boundaries, available counterexample input traces and
engine-generated logical cone evidence, without guessing physical coordinates.

After successful publication, cleanup retains the current and one previous
completed attempt. Unfinished attempts and symlink targets are never deleted;
cleanup failure cannot invalidate a successful recording.

Outstanding acceptance includes broader macro algorithms/orientations, repeated
capture-on/off overhead comparison, large routing seek latency, and measured GPU/UI
frame time. The installed GCD pair produced identical DEF/non-runtime QoR (8.79%
wall-time increase in one pair).
Capability remains sampled: candidate summaries do not imply a complete database
transaction journal, and private ICS55 RCX internals expose only wrapper boundaries.

Latest installation validation rebuilt the native release and `make build`
(AppImage/deb), then passed `DISPLAY=:189 pnpm run desktop:smoke`. The native
production code is installed at `~/.local/bin/chip-viewer-native`; ECC's local
wrapper selects the rebuilt Replay runtime. A packaged Studio uses its configured
runtime: select the external runtime with `ECOS_ECC_BIN_DIR=~/.local/bin` when
testing these local changes rather than the registry-pinned release.

An additional real macro case passed Synthesis through postFloorplan with two
Harden GCD macros at R0/R180, fixed and placed at the configured coordinates.
Native sequential/random reconstruction agreed for all 18 postFloorplan frames
(17,059 objects; seek+index P95 8 ms). This does not validate every macro algorithm.
Installed Kepler also produced the actual SEC counterexample at cycle 1, two
input frames, output mismatch and golden/revised logical cones.

Fresh installed AES single-route capture: 18 frames, 480,821 objects; 100 random
seeks matched sequential state. Seek+index P95 1525.9 ms (reconstruction 1250.8 ms)
exceeds the target and remains an acceptance gap. A real 200 MHz AES Sizer run
captured four Attack decision batches: 21 accepted and 8 reverted. Other CELL
algorithm branches still require their own real execution evidence.

A 45-second AES Place recording using an RTX 4090 Vulkan backend is available in
`.claude/replay-evidence/completion-20261116/aes-place-gpu.mp4`. Its 30 fps screen
capture is visual evidence, not a GPU frame-time benchmark.


Latest native reader optimization keeps the JSON/gzip persisted format unchanged,
uses pure Rust zlib decoding, directly decodes extensible objects, and bounds
large checkpoint reuse by both count and estimated bytes. The same fresh AES
route sample passed all 100 reconstruction/hash comparisons: seek+index P95
887.2 ms, reconstruction P95 570.0 ms (previously 1525.9/1250.8 ms). The timed Cargo
command, including compilation and the test process, peaked at 2,031,060 KiB RSS.
These are backend measurements, not request-to-visible latency.

`cargo test --workspace -- --test-threads=1` passed 472 tests, with 3 opt-in
benchmarks ignored, after these production changes. A preceding default parallel
run hung inside existing 3D GPU test threads and was terminated; the serial run
executes those GPU tests too. The opt-in real-window benchmark additionally uses
`DISPLAY` and a real catalog, samples 30 seconds of playback and 100 exact seeks,
and reports eframe CPU+render time, active frame intervals, and GPU screenshot
readback latency. Readback includes extra transfer cost and is not a claim about
physical monitor presentation time:

```sh
DISPLAY=:189 ECOS_REPLAY_TEST_CATALOG=/path/to/home/replay-view.json \
  cargo test --release -p chip-viewer-native \
  real_window_gpu_playback_and_seek_readback -- --ignored --nocapture --test-threads=1
```


The GPU path now retains six current mesh slots (base, ghosts, deleted marks,
static highlights, animated geometry, animated highlights). It compiles each
transition once and updates a progress uniform for smooth movement/reveal;
software rendering remains available, as does fallback when vertex storage
exceeds the device limit. Scene/viewport changes replace the buffers. GPU pixel
readback tests check interpolated position, opacity, 2x scale, and both linear
and sRGB render targets. Exact subflow selection now submits one load request,
avoiding an immediately canceled speculative animation.

During optimization the real AES route UI baseline measured P95 213.0 ms active
frame interval, 203.6 ms CPU+render, and 2053.6 ms request-to-readback. Static GPU
retention reduced interval to 34.0 ms; uniform-driven animation measured 7.0 ms
interval and 2.9 ms CPU+render. The six-step AES catalog (playback begins at Synthesis, random seeks cross
steps) measured 3.1 ms interval and 2.3 ms CPU+render; these are not Place-only
measurements. Set ECOS_REPLAY_TEST_STEP=place to measure that stage specifically. These are Xvfb/RTX 4090 Vulkan results at
1280x860 and exclude deliberate loading waits from active-frame samples. Initial
preparation is separate. Seek/readback remained 1550.2 ms (route) / 2072.1 ms
(six-step catalog) before the exact-node duplicate-request fix; final numbers follow below.


Final scope-specific AES Place measurement (`ECOS_REPLAY_TEST_STEP=place`):
30 seconds of playback, active-frame interval P95 3.2–4.6 ms, CPU+render P95
0.8 ms, 100 exact-node requests to GPU readback P95 1.40–1.68 s. Cross-step
six-stage requests measured 2.0–2.26 s. Host compilation/tests shared the machine;
these are not isolated repeated certification runs. Playback improved strongly;
the 200 ms cached / 1 s cross-checkpoint request-to-visible targets remain open.

Final ECC suite: 4469 passed / 6 skipped / 1 deselected / 4 xfailed. Final Rust
workspace: 475 passed / 4 ignored opt-in tests, run serially to avoid the host's
parallel 3D GPU test hang. Exact-node regression also exercises a click on the
currently animating frame. The source GUI native wrapper now uses release builds;
`bash -n ecos/scripts/chip-viewer-native-wrapper.sh` and the repository version
consistency check passed.


Final native installation and product packaging passed: `cargo fmt --all --
--check`, `cargo test --workspace -- --test-threads=1`, `cargo install --path
apps/chip-viewer-native --locked --force --root ~/.local`, owner `make build`, and
`DISPLAY=:189 pnpm run desktop:smoke`. Installed/target/packaged native SHA256 all
match `3f9c50c6fcdfa58832a517945ad85b1ec6c10fdf8765902e241fadb8cc3c70e3`.
Updated visual evidence: `.claude/replay-evidence/completion-20261116/aes-place-gpu-final.mp4`
and its PNG, using a temporary Place-only launch catalog over real captured data;
no flow or capture files were modified. The screenshot was visually reviewed.

GUI checks/E2E and tool-specific suites retain the earlier passing results after
their last relevant changes; they were not repeated for the final native-only
optimization. Linux release packaging was run; macOS/Windows builds were not run
on this host. No toolchain pins or gitlinks were updated.


## Development branch snapshot (2026-11-16)

The current source checkpoint is published on `yell/replay` in the repositories
below. Source integration tests use these revisions; the packaged ECC runtime
provenance lock has not been refreshed from a new successful ECC CI run, so this
Studio checkpoint intentionally does not advance the parent ECC gitlink.

| Repository | Source commit |
| --- | --- |
| ECC | `5cdb3db201761e3becf81db202c529655caa6614` |
| ECC-Tools | `603e6387107d616a500f043d4eb30df7b4bfcbe6` |
| ECC-DreamPlace | `7ca9a885` |
| ECC-Sizer | `8d4c32c` |
| OpenROAD Replay fork | `53d1f1224c` |
| Kepler Formal | `73cc835` |

OpenROAD's original remote rejected writes by the current account. The commit
is published at [Yell-walkalone/OpenROAD](https://github.com/Yell-walkalone/OpenROAD/tree/yell/replay);
Sizer's branch-specific `.gitmodules` URL points there so a recursive checkout
can retrieve it. Other repositories retain their original remotes.

For source testing, fetch/check out ECC's `yell/replay` in the existing ECC
submodule and initialize its pinned submodules; build the matching Sizer and
Kepler branches when testing their new native capture hooks. Existing system
installations on the development host already contain these tool builds.
Published runtime artifacts and a refreshed `.github/ecc-ci-toolchain.json` are
required before advancing the product's packaged toolchain pin.

Real installed AES Place capture with GPU animation and instance highlighting:

![AES Place Replay on the GPU](asset/replay-place-gpu.png)

## Shared-table and compact-index verification (2026-11-16)

The real-window probe now starts its seek timer immediately before the UI
selection. Reading the manifest solely to choose a test timestamp happens before
that timer; the application's own validation/reconstruction remains measured.
Test-only timings separate reconstruction, index building, result assets,
snapshot handoff and the update that builds the first mesh. These clocks and
diagnostic fields are absent from production builds.

Final serial GPU probes used an AMD EPYC 9654 host, RTX 4090/Vulkan (driver
580.82.07), X11 display `:189`, 30 seconds of playback and 100 exact-node seeks:

| Real capture | Frames / final objects | Active interval P95 | CPU+render P95 | Request → GPU readback P95 |
| --- | --- | --- | --- | --- |
| AES Place | 66 / 107,942 | 3.6 ms | 0.8 ms | 810.8 ms |
| AES Route | 18 / 480,821 | 10.6 ms | 5.5 ms | 857.8 ms |

Place was explicitly scoped with `ECOS_REPLAY_TEST_STEP=place`; its catalog also
contains the preceding five flow steps. Route used its genuine one-step flow.
No flow or captured data was changed. With corrected timing, the initial Place
probe measured 1199.8 ms. Before shared tables/compact index work, the Route
probe with object reuse measured 1178.1 ms. Final worker reconstruction/index
P95 was 609.1/64.1 ms for Place and 372.8/239.5 ms for Route; snapshot handoff
rounded to 0.0 ms. First-mesh update P95 remains 146.6/435.6 ms respectively.
Phase percentiles are independent and must not be added as a total.

These two runs satisfy the ordinary 1 s seek and active-playback 33 ms targets
for these captures. The 200 ms cached-seek target, new cross-step timing,
repeated isolated certification and a new peak-memory measurement remain open.
GPU readback includes screenshot transfer; it is not monitor presentation time.
The earlier 512 MiB Place cache trial did not improve latency, so the default
128 MiB budget was retained.

Both captures also passed 100 random full-state comparisons against sequential
reconstruction, including revision, object attributes/pins, highlights and
deleted/restored records; frozen assets were verified. Final Rust workspace
validation passed 479 tests, with 4 opt-in tests ignored by the ordinary run:

```sh
cargo fmt --all -- --check
cargo test --workspace -- --test-threads=1
cargo install --path apps/chip-viewer-native --locked --force --root ~/.local
```

The opt-in commands above were additionally run for both real captures. Use
`ECOS_REPLAY_TEST_STEP=place` or `route` to scope real-window measurements without
changing the workspace flow. Full-state comparison used a temporary Place-only
launch catalog and the Route catalog. Linux serial testing retains the earlier
host workaround for parallel 3D GPU tests and still runs those tests.

The Linux owner build and Electron smoke test passed:

```sh
CHIPCOMPILER_ECC_SIZER_ROOT=~/.local/share/ecc/tools/ecc-sizer/replay-complete-20261116 make build
cd ecos/gui
DISPLAY=:189 pnpm run desktop:smoke
```

Installed, release-target and packaged Native Viewer SHA256 all match
`1f7061773529a91e4eb2c68013103e64553efecacbfb71c88c87de4bcbb6e230`.
The version consistency check passed. GUI check/E2E, ECC and native tool suites
were not repeated for this native-only follow-up; their earlier passing results
remain recorded above. macOS/Windows builds were not run on this Linux host.
No persisted data, dependency lock, ECC gitlink or packaged runtime provenance
pin changed in this follow-up. Existing captures need no EDA rerun.


## Route internal phases (2026-11-16)

The active router is PA → GR → TARouter → DetailedRouter → ViolationReporter.
Replay preserves the workspace flow and the existing `run routing` subflow.
Milestone nodes share the flow timeline; wave/box frames animate between nodes.
Catalog nodes optionally carry `sequence`. Native prefers that exact frame over
the timestamp, including when several observations share an elapsed time.
Legacy catalogs with time-only nodes continue to work.

PA now records initial candidates (a disclosed 100,000-point preview limit),
selected access points, access wires/vias/patches, actual violations and best
restore. GR records layer/GCell edge capacity, demand and overflow, each reroute
accept/restore decision, and the committed guide boundary. TA records initial
selected tracks and each conflict reroute iteration. Its `conflicting_nets_before`
is the existing scan result, not a new scan or an after-routing measurement;
the initial observation omits this metric because it has not been measured yet.

DR captures each joined routing wave, normalization, minimum-area patch waves
and checks, repair boxes, accept/restore, best restore and final routing. Wave
observations union the model's retained geometry with every box's owned geometry;
borrowed environment is excluded. This produces a complete read-only observation
without prematurely moving box results back into the algorithm's model. VR
captures the router's actual final violations, explicitly not signoff DRC.

The first routing observation uses `scope=routing`; subsequent observations are
compacted in the native producer to `scope=patch` with explicit `remove` IDs.
The producer resets its comparison state on attempt changes or non-routing
samples. This avoids writing repeated full geometry at every wave. ECC still
publishes reversible diffs and bounded-depth checkpoints under each subflow's
`geometry/replay/.../frames` directory. Shape multiplicity, via-master metadata,
unchanged instances, PDN and unrelated nets remain represented.

Process `route_congestion` and `route_violation` records deliberately use the
same revisioned geometry stream rather than a separate overlay file clock.
Their attributes and deletions are covered by the existing hashes/checkpoints.
The worker prepares layer controls from the current reconstructed scene, and the
canvas draws only the chosen process layer. Capacity-zero cells are distinct
from ordinary zero demand; outside-grid edges are not emitted. Violation layers
include cut layers. Unevaluated DR wave/repair geometry omits stale violation
markers and labels evaluation as pending. Final Place maps, clock trees and
checklists retain their completion-only behavior.

All new observers enter `replay::guarded` before geometry reads, copies, JSON
construction or serialization. Phase arguments use `string_view`, so disabled
calls do not allocate temporary strings. No observer calls the mutating TA
`scanOverflow`, reroutes nets, modifies cost weights or runs additional DRC.
The transport's retained comparison state is created only inside enabled capture.
Old recordings remain readable; collecting the added phases requires rerunning
Route with Replay enabled using the updated ECC runtime.


### Partition presentation and validation

The grid follow-up adds actual PABox partitions, valid GR GCell edges, DRBox
partitions with the current scheduled batch highlighted, and minimum-area/repair
regions. The partition records (`route_region`) are frame-local and travel in
the same transport patches. GR starts with capacity when there is no demand,
then chooses demand/overflow from the observation; a manually selected metric
is preserved. During process overlays the static layout context is dimmed while
new geometry continues its retained GPU reveal. Turning off the overlay restores
the context. Seeking keeps the previous frame's overlay with its geometry until
the new frame is prepared; completion reports still wait for completion.

Real AES validation used isolated derived workspaces, leaving user workspaces
untouched. The old capture contained 18 frames, detailed capture 64, and the
partition follow-up 65. The last contains 900 PA boxes, 30,624 GR edge samples,
64 DR boxes with 16 scheduled in the first wave, five TA reroute iterations,
20 DR waves and five minimum-area patch waves. Installed-runtime GCD generated
31 frames with 36 PA boxes, 1,224 GR edges and four DR boxes.

Replay disabled, full routing observations, compact native transport, and the
grid follow-up produced byte-identical decompressed AES DEF, SHA256:
`536128268c44e764695cc55eab56400851ee7cb372a1d93dbbff18b2ba5c6e13`.
The runs overlapped other build/tests and do not establish an isolated runtime
overhead percentage. Native transport compaction removes repeated raw snapshots;
final published AES geometry remains about 529 MB. Its capture duration is not
the animation duration. This case did not trigger GR reject/restore or DR repair
accept/revert, so those branches are implemented but not claimed as real-case
coverage. No macOS/Windows build was run on this Linux host.

The 64-frame capture passed 100 random full-state seeks and frozen-file checks.
Real-window playback/readback on RTX 4090 recorded active CPU+render P95 3.8 ms,
active frame interval P95 7.2 ms, and request-to-GPU-readback P95 3480.6 ms.
The larger capture currently misses the 1 s random-seek target; active rendering
and seek latency are separate measurements. Do not interpret active intervals
as a guarantee that no frame ever waits for reconstruction.

Validation commands for this change:

```sh
# ECC (repository root ecc/)
.venv/bin/pytest -q test/
.venv/bin/pytest -q test/tools/test_replay_route.py test/tools/test_replay.py
.venv/bin/ruff check chipcompiler/tools/replay_publish.py test/tools/test_replay_route.py
# ECC-Tools
cmake --build build --target ecc_bin ecc_py replay_capture_gate_test -j 8
ctest --test-dir build -R '^replay_capture_gate_test$' --output-on-failure
# Native
cargo fmt --all -- --check
cargo test --workspace -- --test-threads=1
cargo install --path apps/chip-viewer-native --locked --force --root ~/.local
# Desktop
pnpm run check
ECOS_REPLAY_TEST_WORKSPACE=/tmp/ecos-replay-validation-20261115/aes/route_grid pnpm --filter @ecos-studio/desktop-electron exec vitest run electron/services/replayService.test.ts
DISPLAY=:189 pnpm run desktop:smoke
```

ECC's full suite passed 4495 tests (6 skipped, 1 deselected, 4 expected failures);
the focused transport suite passed 20. The native workspace passed 482 tests,
with four opt-in tests excluded by the default suite. The real 64-frame seek and
GPU probes above were run separately. A parallel rerun stalled in existing GPU
initialization tests on this host; serial workspace testing uses the documented
host workaround. GUI check passed, including 1708 renderer and 1579 Electron
tests. Linux `make build` produced the AppImage/deb and desktop smoke passed.

The complete ECC-Tools build was attempted twice with
`cmake --build build -j 8`. It remains blocked by
`FastSTAInputFactsTest.cc:385` referring to missing `icts::SdcClockReader`.
The modified runtime targets and Replay gate test build/pass; the unrelated CTS
test source was not edited to mask this validation limitation.

The system wrapper points to
`~/.local/share/ecc/v0.1.0-alpha.12-replay-route-grid-20261116/ecc`.
Its bundled ECC-Tools extension matches the installed validation extension
(SHA256 `b94bc20f16a6b960d1010d70206148ddbe9f2cb5d533cba604eb0b12d75764ae`).
Native is installed at `~/.local/bin/chip-viewer-native`. The Sizer runtime did
not change in this routing refinement. Reopen Studio using the rebuilt product
and rerun Route with Replay enabled to collect the grid/phase data. Existing
captures still open but cannot acquire missing observations retroactively.
Local screenshots/video are under `.claude/replay-evidence/route-20261116/`.


Final desktop end-to-end validation passed all three journeys: GUI rtl2gds,
terminal-started rtl2gds, and concurrent/cancelled workspace flows (3 files,
9 tests passed, 1 optional signoff-lit test skipped because no lit suite was
configured). The command was `pnpm --filter @ecos-studio/desktop-electron exec
vitest run --config vitest.e2e.config.ts rtl2gds cli-flow flow-concurrency`, under
`xvfb-run -a`, with `ECOS_E2E_ECC_BIN_DIR=~/.local/bin`, the installed ICS55 PDK,
OSS CAD Suite 20260827, Sizer and Kepler replay-complete-20261116 roots. Evidence:
`/tmp/replay-route-product-e2e`. This verifies the local Replay runtime, not a
replacement CI provenance pin. Parent ECC gitlink/provenance were not advanced.

Final installed, release-target and packaged Native hashes match:
`eb1c8828c448156ca165592fe1f5d6cc440c04575db2ba55bbaa8c6d78dda5fd`.
The final serial Rust workspace run and `cargo fmt --all -- --check` passed.
Screenshots cover actual PA partition, GR overflow/GCell view and the first DR
wave. `routing-waves.mp4` records 15 seconds of real playback; every one-second
layout crop differs, verifying the recording contains geometry transitions.

### Filler presentation batching (2026-11-16)

Consecutive `filler_row` frames within the same subflow now share a single
reveal, capped at 1.5 display seconds at 1×. The loader reconstructs the scene
before the first row and the scene after the last row once. All changed filler
masters share a row-ordered sweep (Y, then X), avoiding a separate animation and
mesh rebuild for every row and cell master. This is presentation timing, not
recorded algorithm timing. Source timestamps, deltas and flow ordering remain
unchanged, and every delta is still validated while planning.

A source-frame marker inside a batch maps proportionally into that batch's
display interval; selecting it still reconstructs its exact recorded frame
without animation. Resuming playback uses the full batch baseline. Normal
result holds, final cumulative instance highlights and non-filler animations
retain their existing behavior. Existing recordings work without rerunning ECC.

The regression fixture covers 41 rows, mixed filler masters, partial reveal,
reverse/exact frame seeking, cumulative highlights, and final-scene equality.

Read-only validation against `/nfs/home/huangzengrong/projects/benchmark/gcd/ws_0004`:
46 source frames, 41 filler-row batches, 17,316 final objects and 885 touched
objects. The same recorded data's timeline dropped from 244.7 s to approximately
4.8 s, including the unchanged 2 s result hold. X11 screenshots and an 8 s
playback recording show a partial sweep and the completed highlighted layout:
`.claude/replay-evidence/filler-20261116/`. No source workspace files were changed.

Validation commands (Rust commands run in `ecos/chip-viewer`):

- `cargo fmt --all -- --check` passed.
- `cargo test --workspace -- --test-threads=1` passed: 483 passed, 4 opt-in tests
  ignored. Serial execution avoids this host's concurrent GPU initialization issue.
- `ECOS_REPLAY_TEST_CATALOG=/tmp/replay-filler-catalog.json cargo test -p
  chip-viewer-native real_workspace_random_seek_and_frozen_artifacts -- --ignored
  --nocapture --test-threads=1` passed: 100 random seeks matched complete scene
  fingerprints and frozen assets. Debug-build seek+index P95 was 47.6 ms.
- `cargo install --path apps/chip-viewer-native --locked --force --root
  /nfs/home/huangzengrong/.local` installed the updated Native.

Installed, release-target and staged Native SHA256:
`a9783f6921c17df262a485c3eea492d44c797811d6053da7ea83479c5a37247b`.
The 30 s GPU stress benchmark, full RTL-to-GDS desktop journeys, and macOS/Windows
builds were not repeated for this focused presentation change; the real Filler
playback recording exercises the changed rendering path. No ECC/Sizer code,
capture format or installation changed in this optimization. Larger designs can
still incur scene preparation time in addition to the bounded animation duration.

Linux product delivery also passed:
`CHIPCOMPILER_ECC_SIZER_ROOT=/nfs/home/huangzengrong/.local/share/ecc/tools/ecc-sizer/replay-complete-20261116 make build`
from the repository root, and `DISPLAY=:189 pnpm run desktop:smoke` from
`ecos/gui`. AppImage and deb were regenerated. The unpacked product's Native
binary matches the installed/staged SHA256 above. Restart the rebuilt Studio
and open Replay against existing workspace data to test the faster sweep.
