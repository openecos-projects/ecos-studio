<a id="algorithm.legalization.execution"></a>
## algorithm.legalization.execution

**Execution path:** The DreamPlace runner loads ECC data, builds `DreamplaceModule`, forces legalization-only parameters, creates the placement engine, and runs it. In legalization-only mode global placement and fillers are disabled while `legalize_flag` is enabled; the runner then saves the design and runs analysis and checklist generation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**

<a id="algorithm.legalization.legalize_only_setup"></a>
## algorithm.legalization.legalize_only_setup

**Input and state:** The standalone legalization runner uses the current ECC-backed DEF/netlist state and forces DreamPlace global placement, fillers, and random-center initialization off while enabling `legalize_flag`.

**Algorithm:** `PlacementEngine.setup_rawdb()` imports the ECC database, builds placement tensors and operators, then invokes `NonLinearPlace` in legalize-only mode.

**Stop:** The engine returns its PPA dictionary; an infinite HPWL is the runner's failure signal, while a finite value is still only auditable with saved stage artifacts.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **dreamplace.placer**

<a id="algorithm.legalization.legalization_pipeline"></a>
## algorithm.legalization.legalization_pipeline

**Input and state:** The legalization operators consume the continuous `pos` tensor, node dimensions/weights, fixed objects, placement bounds, site/row geometry, and optional fence regions.

**Algorithm:** This is the site-legal cell-movement phase after continuous placement. For ordinary regions, `NonLinearPlace` composes `MacroLegalize -> GreedyLegalize -> AbacusLegalize`; it checks legality after greedy placement and after Abacus refinement. Fence-region designs use per-region operators before merging.

**Failure boundary:** A failed legality check returns the earlier candidate designated by the implementation; it does not silently mark an illegal result as legalized.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **dreamplace.basic_place**, **dreamplace.nonlinear**

<a id="algorithm.legalization.macro_legalization"></a>
## algorithm.legalization.macro_legalization

**Input and state:** Macro legalization builds `LegalizationDB` from movable and fixed macros, with dummy-fixed filtering and displacement statistics.

**Algorithm:** It first applies rough Hannan legalization to small-overlap clusters, then LP legalization. If legality remains unsatisfied it runs Hannan grid legalization followed by LP refinement, retaining the legal candidate with the best displacement measure.

**Stop:** With no movable macros it returns immediately; otherwise macro/fixed-macro overlap checks decide whether a candidate is accepted.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **dreamplace.macro_legalize**

<a id="algorithm.legalization.greedy_and_abacus_cells"></a>
## algorithm.legalization.greedy_and_abacus_cells

**Input and state:** Standard cells, fixed blockages, row-height bins, blank intervals, and initial positions form the cell-legalization model.

**Algorithm:** Greedy legalization runs left and right passes, assigns cells to bins, subtracts fixed cells into blank intervals, and merges bins while cells remain unplaced. Abacus then sorts cells by row/bin, creates and merges clusters, solves cluster positions from `q/e`, clamps to the bin, aligns to sites, and advances coordinates to prevent overlap.

**Stop and output:** Greedy stops when all cells are placed or no more bin rounds remain; Abacus returns refined movable coordinates after its finite row/bin traversal.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **dreamplace.greedy_legalize**, **dreamplace.abacus_legalize**
