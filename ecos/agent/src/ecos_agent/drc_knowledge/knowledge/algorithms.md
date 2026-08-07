<a id="algorithm.drc.execution"></a>
## algorithm.drc.execution

**Execution path:** The ECC runner loads the design, initializes the DRC engine in the step data directory, invokes `run_drc` with the configured report path, saves the design, persists DRC feature data, and then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.drc.engine_lifecycle"></a>
## algorithm.drc.engine_lifecycle

**Engine lifecycle:** The runner initializes DRC in the step data directory, executes `run_drc` with the workspace configuration and step report path, then saves both the common design artifacts and DRC-specific feature data.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.drc.subflow"></a>
## algorithm.drc.subflow

**Subflow order:** `load data -> run DRC -> save data -> analysis`. A numerical `drc.number` is a count from the persisted feature record; it cannot distinguish an empty rule report from an analysis file that was never generated without the artifact evidence.

**Source evidence:** **ecc.runner**, **ecc.module**
