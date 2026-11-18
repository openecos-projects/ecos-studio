# Chip Viewer Rendering Performance Research

## Scope

This review covers parent checkout `79f1641026b38b7f117f789d527ff25506d70c0f` and KLayout upstream `master` at `53911acd6dfaa113c188d11d20b2ae290aa60a6b`, dated 2026-11-15. It compares rendering strategies and proposes measurements. It does not claim new performance results for the current checkout.

## KLayout Findings

KLayout reuses the current image during compatible pans. It checks transform, scale, dimensions, and viewport overlap, shifts existing pixels, then redraws only newly exposed regions. A zoom or incompatible transform invalidates that coverage and schedules a full redraw. [RedrawThread::start](https://github.com/KLayout/klayout/blob/53911acd6dfaa113c188d11d20b2ae290aa60a6b/src/laybasic/laybasic/layRedrawThread.cc#L135)

The canvas keeps separate bitmap planes and can invalidate selected layers without discarding all drawing work. Worker threads publish intermediate snapshots periodically, while cancellation stops work for obsolete requests. [RedrawThreadCanvas](https://github.com/KLayout/klayout/blob/53911acd6dfaa113c188d11d20b2ae290aa60a6b/src/laybasic/laybasic/layRedrawThreadCanvas.cc#L172) [RedrawThreadWorker](https://github.com/KLayout/klayout/blob/53911acd6dfaa113c188d11d20b2ae290aa60a6b/src/laybasic/laybasic/layRedrawThreadWorker.cc#L749)

KLayout bounds hierarchical shape traversal to redraw regions. It also caches repeated cells only when cell bounds and transform eligibility make reuse valid. These mechanisms depend on KLayout's hierarchical database and cannot be transplanted directly into ECOS's flattened geometry snapshot. [Recursive shape iterator](https://github.com/KLayout/klayout/blob/53911acd6dfaa113c188d11d20b2ae290aa60a6b/src/db/db/dbRecursiveShapeIterator.cc#L647) [Cell cache](https://github.com/KLayout/klayout/blob/53911acd6dfaa113c188d11d20b2ae290aa60a6b/src/laybasic/laybasic/layRedrawThreadWorker.cc#L2182)

## ECOS Findings

ECOS already has retained pan presentation and sparse regional repair. The current pan path requires exact compatibility and pixel correctness, so benchmark it against full uncached recovery before adding another damage mechanism. [Retained pan presentation](../chip-viewer/apps/chip-viewer-native/src/app/cpu/cpu_pan_presentation.rs) [Sparse repair](../chip-viewer/apps/chip-viewer-native/src/app/cpu/cpu_sparse_repairs.rs)

The CPU scene scheduler performs concurrent layer queries and geometry builds, then consumes results in layer and chunk order to preserve source-over blending. It bounds lookahead and reserves workers for the visible frontier. This makes ordering and frontier wait time important profiling dimensions. [Layer scheduler](../chip-viewer/apps/chip-viewer-native/src/app/cpu/cpu_layer_schedule.rs)

The sparse rectangle raster path is enabled only for Release builds on one certified llvmpipe renderer and Mesa version. Other profiles use the existing streaming renderer. Benchmark those routes independently before generalizing the sparse path. [Sparse profile gate](../chip-viewer/apps/chip-viewer-native/src/app/cpu/cpu_sparse_rects.rs) [Raster route selection](../chip-viewer/apps/chip-viewer-native/src/app/cpu/cpu_raster_stream.rs)

Label geometry and placement complete asynchronously, but full-scene readiness includes label completion. Historical tests report cold dense label preparation near 920 ms. That is older evidence, not a measurement of this checkout. [Label preparation](../chip-viewer/apps/chip-viewer-native/src/app/labels/label_preparation.rs) [Historical rendering measurements](../chip-viewer/apps/chip-viewer-native/tests/README.md#independent-text-preparation-stage-3-november-11)

The GPU tile cache allows 512 MiB, CPU scene history 192 MiB, sparse CPU state 96 MiB, retained regions 64 MiB, and 3D geometry up to 2.5 million instances. These are separate limits rather than one process-wide memory budget. Hardware GPU, 3D, and active heatmap performance are not covered by the cited local llvmpipe acceptance. [GPU cache](../chip-viewer/apps/chip-viewer-native/src/render/canvas_gpu.rs) [CPU history](../chip-viewer/apps/chip-viewer-native/src/app/cpu/cpu_history.rs) [3D instance limit](../chip-viewer/apps/chip-viewer-native/src/render/canvas_gpu3d.rs) [Validation scope](../chip-viewer/apps/chip-viewer-native/tests/README.md#ordered-2d-kernel-pipeline-stage-2-november-11)

STA timing data is still loaded synchronously when the geometry snapshot becomes ready. Measure whether this blocks first interaction on workspaces with large timing exports. [Timing initialization](../chip-viewer/apps/chip-viewer-native/src/app.rs#L242) [Timing loader](../chip-viewer/apps/chip-viewer-native/src/timing.rs#L98)

## Optimization Order

1. Re-establish the current HEAD baseline with the same design, 2048x1280 viewport, all layers and drawing categories visible, and sequential benchmark runs. Capture Release and Debug separately.
2. Record first useful current-camera output, exact geometry completion, geometry-plus-label completion, active-frame p95, maximum frame interval, recovery after input, and process peak RSS. Keep cached and uncached results separate.
3. Profile each slow journey by query, geometry projection and packet creation, rasterization or GPU instance upload, label layout, and presentation. Optimize the largest measured stage rather than the easiest isolated microbenchmark.
4. For pan, compare recovered work against exposed viewport area. For zoom, measure uncached intermediate scales and label completion separately. Preserve exact-pixel comparisons and stale-request cancellation.
5. Benchmark hardware GPU, 3D, heatmap, and software fallback as separate routes. Measure 3D query allocations and instance construction before changing its sampling policy.
6. Consider a shared memory budget only after measuring peak RSS with CPU history, retained regions, GPU tile data, and labels populated concurrently.

The existing zoom gate requires 20 uncached samples per non-fit camera and tracks feedback, geometry, and full completion separately. The interaction harness checks pan, wheel zoom, fit, selection, and exact recovery. Use these as acceptance tests rather than treating a fast frame or cache hit as proof of a faster uncached journey. [Zoom gate](../chip-viewer/apps/chip-viewer-native/tests/render_zoom_gate.py) [Interaction harness](../chip-viewer/apps/chip-viewer-native/tests/interaction_render_e2e.py)

## Benchmark Blocker

The interaction harness could not connect Xephyr to host `DISPLAY=:0` because the execution environment lacks the desktop X11 authorization. I unpacked Xvfb under `/tmp` and ran isolated X11 tests on `:99`; no system package was installed and no host display was used.

All measurements below use Release HEAD `79f1641026b38b7f117f789d527ff25506d70c0f`, the TPU geometry manifest (`shape_count=3,823,125`), 2048x1280, software fallback on llvmpipe, and the harness's `ECOS_PERF_ALL_VISIBLE=1`. The Viewer startup path sets every physical layer and drawing-data category visible for this flag. The manifest and test outputs are under `/tmp/ecos-tpu-perf/`.

| Initial zoom | Drawn shapes | Query | Filter | Scene build | Raster | Labels | First exact scene | Warm frame p95 | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.00 | 3,160,918 | 67.6 ms | included in build | 112.8 ms | 993.7 ms | 0.1 ms | 2.01 s | 9.6 ms | 1.58 GiB |
| 2.6126 | 524,611 | 46.8-60.5 ms | 3.2-4.0 ms | 34.3-38.4 ms | 258.1-270.8 ms | 4.4-7.1 ms | 1.43-1.45 s | 9.6-9.7 ms | 1.58 GiB |
| 6.8256 | 75,968 | 5.3-6.6 ms | 0.4-2.7 ms | 12.0-12.6 ms | 134.9-144.6 ms | 25.6-27.6 ms | 1.22-1.33 s | 11.6-11.7 ms | 1.60 GiB |

The first exact scene is much slower than the warm frame cadence. At zoom 2.6126, raster accounts for about 85% of the reported scene pipeline, while query and label work are small. At zoom 6.8256, raster is still the largest stage, with labels becoming a measurable secondary cost. The full-fit scene draws over 3.1 million shapes and takes about one second in raster work. All three static runs reached exact geometry, remained pixel-valid, and rasterized the stationary scene once.

The interaction run retained visible old-camera pixels throughout all three drag gestures. Active frame p95 was 11.3-12.4 ms and exact recovery after release was 0.76-0.78 s. Only 0.75-1.12% of active samples contained exact current-camera geometry, with a longest old-camera/empty run of 2.34-2.39 s. Zoom-in/out settle was 42-97 ms. The practical bottleneck is current-camera progress during continuous pan, rather than warm frame rendering or post-release recovery.

The static harness's `max_canvas_ms` of about 600-634 ms came from an initial partial-seed frame with zero exact geometry and a pending scene. Do not interpret it as a completed scene or warm UI frame. The full-scene first-ready time and scene-stage metrics above measure different events.

## Raster Path Comparison

At zoom 2.6126 the default sparse-rectangle route processed 742,543 operations, spent 183-198 ms painting those rectangles on CPU, prepared damage repair in 15-17 ms, and submitted 121 repair meshes (2.86 MiB). Its normal non-traced raster time was 258-261 ms. A same-source `ECOS_DISABLE_SPARSE_RECTS=1` control used ordered GL meshes, submitted 523 meshes (about 47 MiB), and rasterized in 271-271 ms. The control screenshot differed by zero layout pixels. Sparse raster is modestly faster in these runs, but its CPU rectangle work consumes most of the budget and it does not approach the 250 ms exact-geometry target.

The diagnostic traces add synchronization and must not be used as acceptance timing. In the ordered-GL trace, mesh submission accumulated about 163 ms and the diagnostic `gl.finish()` wait about 125 ms. In the sparse trace, CPU rectangle painting accumulated about 183 ms. These traces identify where work lands, while the untraced static runs provide the comparable total.

At zoom 6.8256 the sparse route processed about 106,906 operations, spent about 98 ms in CPU rectangle painting and 5 ms preparing repairs, then submitted 408 repair meshes (1.42 MiB). The raster wall was about 147 ms. Cost falls with the smaller viewport, but exact readiness remains over one second because scene/query startup, label completion, and presentation contribute beyond the isolated raster duration.

The zoom-1 raster diagnostic shows the same approach is expensive at full fit: about 4.65 million software operations, 230 ms command append, 184 ms rectangle paint, 181 ms repair preparation, 2,171 repair tiles, and 1,322 repair meshes totaling about 63 MiB. Diagnostic submit time was about 176 ms, and raster trace wall time was about 1.09 s. The untraced static run reported about 994 ms raster. A separate trace-disabled sparse run and an `ECOS_DISABLE_SPARSE_RECTS=1` GL control at zoom 2.6126 produced identical layout pixels. The sparse run rasterized in about 258-261 ms, while the GL control took about 271 ms. Thus sparse repair is slightly faster on that specific zoom but does not remove the latency bottleneck.

## Incomplete Zoom Journeys

The existing zoom-fidelity harness did not finish a full TPU zoom sequence. Its reference setup timed out while constructing a hidden-label high-camera reference. The `fit-recovery-only` mode also timed out while manufacturing an uncached camera with a small pan before the Fit action. These failures are not valid timings for the subsequent zoom or Fit operation. The independent static and interaction harness measurements above remain valid for the scenarios they completed.

## TPU Hotspot Summary

1. Reduce sparse repair cost, especially full-fit operation append, per-operation contributor indexing, and region replay. Separate rectangle coverage/overdraw from the number of damage regions, then test scanline or row-span batching against exact pixels. Compare with ordered GL using untraced totals because diagnostic `gl.finish()` synchronizes the driver.
2. Improve exact current-camera progress during continuous pan. The Viewer often spends multiple seconds presenting translated old-camera pixels while the target camera scene is pending, despite low frame p95. Measure query/frontier readiness, seed generation, raster progress publication, and cancellation/restart counts separately.
3. Reduce fit-view work at 3.16 million drawn shapes. Sparse command append, software rectangle paint, and repair preparation together exceed 590 ms in the trace before mesh submit and framebuffer completion. Peak process RSS was about 1.79 GiB during diagnostic tracing, compared with about 1.58 GiB without tracing.
4. Keep labels as a secondary hotspot for medium/high zoom. At 6.8256, label resolution is about 26 ms against about 145 ms raster.

These are measured hypotheses for the local llvmpipe software path. The VM reports no hardware GPU, so this run says nothing about the native wgpu hardware route or 3D.

## Pan Feedback Optimization

The first implementation keeps full-scene worker cancellation during a drag, but refreshes a bounded current-camera seed at most every 50 ms. When a compatible completed framebuffer exists, the presentation path keeps its overlap and fills exposed regions from the current seed, followed by any newer ordered progress frame. Exact scene submission still happens immediately after the drag ends.

On the same TPU manifest, 2048x1280, all physical layers and drawing categories visible, and Release llvmpipe, the full interaction journey passed all eight scenarios. After preserving a compatible seed across intermediate pan keys, the three drag scenarios reached 95.1-98.0% current-camera samples, with 0.8-1.9% preview samples and maximum old-view runs of 35-56 ms. Drag active-frame p95 was 17.0-17.8 ms, and exact recovery after release was 0.69-0.92 s. Zoom, fit-to-view, selection, visibility, and pixel checks also passed.

The intermediate-pan seed fix is required for visual stability. One bounded seed is created at the beginning of a drag and remains stable while the pointer changes the pan key every frame. The presentation path reprojects that seed to the current pan until the drag ends. Replacing the seed during the drag made the exposed region alternate between different shape subsets and caused visible flicker.

The bounded seed preparation cost is camera-dependent. On the TPU data it measured about 18.8 ms at fit, 54.3 ms at zoom 2.6126, 72.9 ms at zoom 6.8256, and 75.0-76.0 ms at higher sampled zooms. The 50 ms interval is therefore a feedback bound, not a guarantee that every seed is ready within one interval. The remaining exact recovery cost is still dominated by full scene rasterization and completion.

## Source and Licensing

KLayout's reviewed repository is licensed under GPL-3.0. The transferable material here is the behavior and algorithmic design. Copying upstream implementation code into ECOS requires a separate license review. [KLayout repository](https://github.com/KLayout/klayout) [KLayout license](https://github.com/KLayout/klayout/blob/53911acd6dfaa113c188d11d20b2ae290aa60a6b/LICENSE)
