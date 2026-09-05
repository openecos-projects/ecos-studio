<a id="algorithm.floorplan.execution"></a>
## algorithm.floorplan.execution

**Execution path:** The ECC runner loads the design database, calls `init_fp` with the Floorplan configuration, runs iFP in the native order `DieBuilder -> IOPlacer -> MacroPlacer -> PDNGenerator -> PhyPlacer`, destroys the floorplan engine, saves the updated database and geometry snapshot, then runs analysis and checklist generation. The runner marks each subflow item successful without branching on the native iFP return values.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.floorplan.database_wrapping"></a>
## algorithm.floorplan.database_wrapping

**Input and state:** `FPInterface::initFP()` parses the Floorplan JSON and wraps the live iDB design/layout into iFP `Config` and `Database` objects containing site, masters, routing layers, instances, nets, and IO pins.

**Algorithm:** The wrapper performs deterministic container conversion before any geometry is generated, so later iFP modules operate on an internal physical model rather than raw JSON.

**Boundary:** The conversion ends after the finite iDB collections have been scanned; it does not synthesize a new logical netlist.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.interface**

<a id="algorithm.floorplan.die_core_rows_tracks"></a>
## algorithm.floorplan.die_core_rows_tracks

**Input and state:** `DieBuilder` receives die mode, cell area, aspect ratio/utilization or explicit size, margins, site, and routing-layer pitch/offset.

**Algorithm:** In utilization mode it derives die area and dimensions; otherwise it uses the configured size. It aligns the core to the placement site, enumerates rows at row height, and emits X/Y track grids for routing layers.

**Constraint and stop:** Site alignment and positive track pitch constrain construction. The finite row/layer loops finish with Die, Core, Row, and Track objects stored in the iFP database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.die_builder**

<a id="algorithm.floorplan.io_pin_placement"></a>
## algorithm.floorplan.io_pin_placement

**Input and state:** `IOPlacer` consumes the configured layer-name list, each layer's preferred direction, minimum width, preferred track offset/pitch, die/core bounds, and the IO-pin list.

**Algorithm:** It chooses the first valid horizontal and vertical layers, derives pin depths as four times the perpendicular track pitch, and enumerates track-aligned legal slots on all four die edges. Slots are first sampled at two-pitch spacing; if that cannot fit all pins, it retries at one-pitch spacing. It ranks slots by distance from the die center plus a perpendicular-span tie-breaker, keeps the best slots, then restores edge/coordinate order while assigning them to the original IO-pin order.

**Constraint and stop:** Missing usable layers, non-positive width/pitch, an empty pin list, or insufficient minimum-pitch capacity returns without placement; capacity exhaustion emits a native error. Valid assignments create die-edge port rectangles and synchronize IO pin and net-pin coordinates.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.io_placer**

<a id="algorithm.floorplan.macro_halo_row_cutting"></a>
## algorithm.floorplan.macro_halo_row_cutting

**Input and state:** Existing placed macro instances, core bounds, placement/routing halo values, rows, and site dimensions form the macro-placement state.

**Algorithm:** Before cutting rows, `MacroPlacer` checks every macro for placement and core containment, expands placement and routing halos around placed macros, and gathers each row's site-aligned halo intersections. Sorted blockage intervals are subtracted from each row and the remaining legal segments replace the original row list.

**Constraint and stop:** iFP does not move or optimize macro locations. Unplaced or out-of-core macros are reported at native error severity, while the GUI checklist may expose the aggregate check as a warning; only placed macros contribute halo blockages.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.macro_placer**

<a id="algorithm.floorplan.macro_location_boundary"></a>
## algorithm.floorplan.macro_location_boundary

**Flow boundary:** The `macro_location_path` key remains in the default workspace JSON for compatibility, but `FPInterface::wrapConfig()` reads only macro halos and `runFP()` never calls `debugInputMacro()`. The workspace helper normalizes the path and creates an empty file when needed; it is not a main floorplan input.

**Debug-only path:** The separate `debug_input_macro` Tcl command passes `-path` to `debugInputMacro()`, which reads `instance x y orient` lines, places fixed block macros, and logs malformed, unknown, non-block, or failed placements as warnings.

**Boundary:** Debug-file placement must complete before the normal iFP macro checks; an empty or unused compatibility file does not place macros.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.interface**, **ecc.workspace**

<a id="algorithm.floorplan.pdn_and_physical_cells"></a>
## algorithm.floorplan.pdn_and_physical_cells

**Input and state:** PDN global-connect, rails, stripes, layer pairs, macro routing halos, rows, and physical-cell masters are loaded from the Floorplan configuration.

**Algorithm:** The PDN generator builds power nets, rails and stripes, clips wires around macro halos, then adds vias at layer and macro-pin overlaps. `PhyPlacer` builds available regions and inserts side/edge endcaps, well taps, and boundary taps on the site grid.

**Output boundary:** `FPInterface::output()` writes die/core/rows/tracks, special-net wires/vias, IO pins, macros, and new instances back to iDB; all generation loops are finite configuration and geometry traversals.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.pdn**, **ifp.phy_placer**, **ifp.interface**
