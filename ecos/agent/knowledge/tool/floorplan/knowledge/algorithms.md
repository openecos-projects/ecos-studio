<a id="algorithm.floorplan.execution"></a>
## algorithm.floorplan.execution

**Execution path:** The floorplan phase runs as three flow steps sharing one Floorplan configuration. `preFloorplan` derives a `<stem>_simple` configuration copy with `macro_placer.mode` forced to `auto` and an empty `file_path`, then calls `init_fp` and `run_simple_fp`, which runs iFP `DieBuilder` and auto IO-pin placement and writes the floorplan and IO-pin-list outputs that feed macro placement. The `macroPlacement` step consumes those outputs: manual `macro.placements` parameters bypass DreamPlace entirely, otherwise DreamPlace runs macro-only placement and `tcl_save` writes the hard-macro placement commands to the workspace macro-location Tcl. `postFloorplan` rewrites the Floorplan configuration to `macro_placer.mode` `file` with that location file, calls `init_fp`, whose database wrapping applies the file's macro placements, runs `run_fp` in the native order `DieBuilder -> IOPlacer -> MacroPlacer -> PDNGenerator -> PhyPlacer`, then `destroy_fp`, shared persistence, and analysis. The runner marks each subflow item successful without branching on the native iFP return values.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.floorplan.pre_post_floorplan_split"></a>
## algorithm.floorplan.pre_post_floorplan_split

**Execution split:** The floorplan phase is two ECC runner steps around the macro-placement step. `run_pre_floorplan` reads the Floorplan configuration, writes a `<stem>_simple` copy with `macro_placer.mode` forced to `auto` and an empty `file_path`, and executes `init_fp -> run_simple_fp -> destroy_fp`. `run_post_floorplan` rewrites the original configuration to `macro_placer.mode` `file` with the workspace macro-location path and executes `init_fp -> run_fp -> destroy_fp`.

**Native order:** `runSimpleFP()` runs `DieBuilder -> IOPlacer.placeAuto()` and writes the floorplan and IO-pin-list outputs that feed macro placement. `runFP()` runs the full order `DieBuilder -> IOPlacer -> MacroPlacer -> PDNGenerator -> PhyPlacer`.

**Boundary:** Both steps persist with `feature_step=False` and require the geometry snapshot manifest; only `postFloorplan` runs metrics, plot, and checklist analysis. The subflow entries (`init floorplan`, `create tracks`, `place io pins`, `tap cell`, `PDN`, `set clock net`, `save data`) are recorded without inspecting native return values. After each save, the derived die/core size, area, bounding box, and aspect ratio are written back into the workspace parameters.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.binding**

<a id="algorithm.floorplan.database_wrapping"></a>
## algorithm.floorplan.database_wrapping

**Input and state:** `FPInterface::initFP()` parses the Floorplan JSON and wraps the live iDB design/layout into iFP `Config` and `Database` objects containing site, masters, routing layers, instances, nets, and IO pins.

**Algorithm:** The wrapper performs deterministic container conversion before any geometry is generated, so later iFP modules operate on an internal physical model rather than raw JSON. While wrapping the instance list, `inputMacroPlacement()` applies the configured macro-location file when `macro_placer.mode` is `file`, fixing those macros before net and IO-pin wrapping.

**Boundary:** The conversion ends after the finite iDB collections have been scanned; it does not synthesize a new logical netlist.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.interface**

<a id="algorithm.floorplan.die_core_rows_tracks"></a>
## algorithm.floorplan.die_core_rows_tracks

**Input and state:** `DieBuilder` receives die mode, cell area, aspect ratio/utilization or explicit size, margins, site, and routing-layer pitch/offset.

**Algorithm:** In utilization mode it derives die area and dimensions; in explicit-size mode it first validates finite positive die size and non-negative margins, die size exceeding the margins, site existence with positive dimensions, DBU representability, and at least one site remaining after alignment. It aligns the core to the placement site, enumerates rows at row height, and emits X/Y track grids for routing layers.

**Constraint and stop:** Site alignment, positive track pitch, and the explicit-size validation checks constrain construction; violations are logged as native errors and stop die construction. The finite row/layer loops finish with Die, Core, Row, and Track objects stored in the iFP database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.die_builder**

<a id="algorithm.floorplan.io_pin_placement"></a>
## algorithm.floorplan.io_pin_placement

**Input and state:** `IOPlacer` consumes the configured layer-name list, each layer's preferred direction, minimum width, preferred track offset/pitch, die/core bounds, and the IO-pin list. `placeAuto()` (used by `runSimpleFP`) always runs automatic placement on the layer list; `place()` (used by `runFP`) reads `io_placer.file_path` in `file` mode and otherwise falls back to the same automatic path.

**Algorithm:** Automatic placement chooses the first valid horizontal and vertical layers, derives pin depths as four times the perpendicular track pitch, and enumerates track-aligned legal slots on all four die edges. Slots are first sampled at two-pitch spacing; if that cannot fit all pins, it retries at one-pitch spacing. It ranks slots by distance from the die center plus a perpendicular-span tie-breaker, keeps the best slots, then restores edge/coordinate order while assigning them to the original IO-pin order. File mode requires both a usable horizontal and vertical layer before reading locations.

**Constraint and stop:** Missing usable layers, non-positive width/pitch, an empty pin list, or insufficient minimum-pitch capacity returns without placement; capacity exhaustion emits a native error. Valid assignments create die-edge port rectangles and synchronize IO pin and net-pin coordinates.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.io_placer**

<a id="algorithm.floorplan.macro_placement_step"></a>
## algorithm.floorplan.macro_placement_step

**Input and state:** The `macroPlacement` flow step runs between the two floorplan phases and consumes the pre-floorplan DEF/netlist state.

**Algorithm:** The runner first checks manual `macro.placements` workspace parameters; when present, DreamPlace is skipped entirely and the generated macro-location Tcl is used as-is. Otherwise `DreamplaceModule` forces macro-only parameters (`macro_only=1`, `macro_place_flag=1`, `global_place_flag=1`, `legalize_flag=1`, `two_stage_flag=0`, macro halos of 2000, routability and congestion extras off) and runs the placement engine; on success `tcl_save` writes the hard-macro placement commands to the workspace macro-location Tcl. A run with no unplaced hard macros is treated as a successful skip.

**Boundary:** A failed engine run or a failed Tcl save marks the `macro placement` subflow incomplete and returns false before shared persistence; the step saves with `feature_step=False` and runs no stage analysis.

**Source evidence:** **ecc.runner**, **ecc.module**, **dreamplace.runner**, **dreamplace.module**, **ecc.macro_location**

<a id="algorithm.floorplan.macro_location_boundary"></a>
## algorithm.floorplan.macro_location_boundary

**Flow handoff:** The workspace `macro_location` Tcl (default `macro_location.tcl`, seeded from a template and refreshed from manual placements when `macro.placements` is set) is the fixed handoff from the macro-placement step into post-floorplan. The macro-placement step writes it from DreamPlace results via `tcl_save`; manual placements render into it directly and leave DreamPlace's own content untouched on refresh.

**Consumption:** `postFloorplan` forces `macro_placer.mode` to `file` with this path, and `FPInterface::inputMacroPlacement()` parses `placeInstance`-style lines during database wrapping, validating micron DBU, file readability, line syntax, known block-macro names, finite coordinates, and `placed` status ordering before fixing each macro's location. Auto mode with an empty path skips loading silently; file mode with an empty path is a native error.

**Boundary:** Unknown or non-block instance names, malformed lines, or failed placements are logged as native errors; an unreadable file leaves macros unplaced, which the later MacroPlacer containment and halo checks then surface.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.interface**, **ecc.workspace**, **ecc.macro_location**

<a id="algorithm.floorplan.macro_halo_row_cutting"></a>
## algorithm.floorplan.macro_halo_row_cutting

**Input and state:** Existing placed macro instances, core bounds, placement/routing halo values, rows, and site dimensions form the macro-placement state. In the split flow, macros are already fixed by the macro-location file applied during database wrapping.

**Algorithm:** Before cutting rows, `MacroPlacer` checks every macro for placement and core containment, expands placement and routing halos around placed macros, and gathers each row's site-aligned halo intersections. Sorted blockage intervals are subtracted from each row and the remaining legal segments replace the original row list.

**Constraint and stop:** iFP does not move or optimize macro locations. Unplaced or out-of-core macros are reported at native error severity, while the GUI checklist may expose the aggregate check as a warning; only placed macros contribute halo blockages.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.macro_placer**

<a id="algorithm.floorplan.pdn_and_physical_cells"></a>
## algorithm.floorplan.pdn_and_physical_cells

**Input and state:** PDN global-connect, rails, stripes, layer pairs, macro routing halos, rows, and physical-cell masters are loaded from the Floorplan configuration.

**Algorithm:** The PDN generator builds power nets, rails and stripes, clips wires around macro halos, then adds vias at layer and macro-pin overlaps. `PhyPlacer` builds available regions and inserts side/edge endcaps, well taps, and boundary taps on the site grid.

**Output boundary:** `FPInterface::output()` writes die/core/rows/tracks, special-net wires/vias, IO pins, macros, and new instances back to iDB; all generation loops are finite configuration and geometry traversals.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.pdn**, **ifp.phy_placer**, **ifp.interface**
