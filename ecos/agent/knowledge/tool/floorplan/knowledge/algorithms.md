<a id="algorithm.floorplan.execution"></a>
## algorithm.floorplan.execution

**Execution path:** The ECC runner loads the design database, calls `init_fp` with the Floorplan configuration, runs the floorplanner, and records track creation, IO-pin placement, tap-cell insertion, and PDN as subflow steps. It destroys the floorplan engine, saves the updated database and geometry snapshot, then runs analysis and checklist generation.

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

**Input and state:** `IOPlacer` consumes eligible layers, pin width/depth, die/core bounds, preferred routing directions, manufacturing grid, and IO pins.

**Algorithm:** It selects horizontal and vertical layers, distributes pins across four edges using `ceil(num_pins / 4)`, interpolates each edge coordinate, and grid-aligns the generated port rectangle.

**Constraint and stop:** The placer reserves an edge track pitch and falls back to a core/range center when the legal interval is too small. It stops after the finite IO-pin list and writes pin, port, and net-pin coordinates.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.io_placer**

<a id="algorithm.floorplan.macro_halo_row_cutting"></a>
## algorithm.floorplan.macro_halo_row_cutting

**Input and state:** Placed macros, core bounds, placement/routing halos, rows, and site dimensions form the macro-placement state.

**Algorithm:** `MacroPlacer` expands macro halos; for each row it gathers intersecting placement-halo blockage intervals, aligns them to sites, sorts them, and emits the remaining legal row segments.

**Constraint and stop:** Only placed macros participate, and out-of-core macros are warnings rather than a relocation optimizer. The finite macro/row traversal replaces the row list with cut rows.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.macro_placer**

<a id="algorithm.floorplan.pdn_and_physical_cells"></a>
## algorithm.floorplan.pdn_and_physical_cells

**Input and state:** PDN global-connect, rails, stripes, layer pairs, macro routing halos, rows, and physical-cell masters are loaded from the Floorplan configuration.

**Algorithm:** The PDN generator builds power nets, rails and stripes, clips wires around macro halos, then adds vias at layer and macro-pin overlaps. `PhyPlacer` builds available regions and inserts side/edge endcaps, well taps, and boundary taps on the site grid.

**Output boundary:** `FPInterface::output()` writes die/core/rows/tracks, special-net wires/vias, IO pins, macros, and new instances back to iDB; all generation loops are finite configuration and geometry traversals.

**Source evidence:** **ecc.runner**, **ecc.module**, **ifp.pdn**, **ifp.phy_placer**, **ifp.interface**
