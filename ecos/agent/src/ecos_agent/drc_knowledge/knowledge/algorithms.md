<a id="algorithm.drc.execution"></a>
## algorithm.drc.execution

**Execution path:** The ECC runner loads the design, initializes the DRC engine in the step data directory, invokes `run_drc` with the configured report path, saves the design, persists DRC feature data, and then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**
