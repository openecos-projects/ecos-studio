<a id="algorithm.floorplan.execution"></a>
## algorithm.floorplan.execution

**Execution path:** The ECC runner loads the design database, calls `init_fp` with the Floorplan configuration, runs the floorplanner, and records track creation, IO-pin placement, tap-cell insertion, and PDN as subflow steps. It destroys the floorplan engine, saves the updated database and geometry snapshot, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.floorplan.subflow"></a>
## algorithm.floorplan.subflow

**Subflow order:** `load data -> init floorplan -> create tracks -> place IO pins -> tap cell -> PDN -> set clock net -> save data -> analysis`. These are recorded progress checkpoints around one `init_fp`/`run_fp` invocation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.floorplan.physical_setup"></a>
## algorithm.floorplan.physical_setup

**Physical setup:** The Floorplan configuration drives die/core construction, routing tracks, IO placement, well taps and endcaps, then PDN global-connect, rail, stripe and layer-connect generation. The saved result is the baseline physical database for downstream stages.

**Source evidence:** **ecc.runner**, **ecc.module**
