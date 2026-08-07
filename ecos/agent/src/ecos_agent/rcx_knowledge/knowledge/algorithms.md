<a id="algorithm.rcx.execution"></a>
## algorithm.rcx.execution

**Execution path:** The ECC runner loads the design, initializes RCX with the workspace PDK, runs and destroys RCX, copies generated SPEF files to the declared output paths, saves the design, persists bounded SPEF feature facts, and runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**
