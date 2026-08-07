<a id="algorithm.floorplan.execution"></a>
## algorithm.floorplan.execution

**Execution path:** The ECC runner loads the design database, calls `init_fp` with the Floorplan configuration, runs the floorplanner, and records track creation, IO-pin placement, tap-cell insertion, and PDN as subflow steps. It destroys the floorplan engine, saves the updated database and geometry snapshot, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**
