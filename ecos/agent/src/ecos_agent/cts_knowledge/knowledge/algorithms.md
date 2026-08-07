<a id="algorithm.cts.execution"></a>
## algorithm.cts.execution

**Execution path:** The ECC runner loads the design, invokes `run_cts` for clock-tree synthesis with the CTS configuration and step data directory, writes a CTS report and map, saves the design, persists clock-timing feature facts, and then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**
