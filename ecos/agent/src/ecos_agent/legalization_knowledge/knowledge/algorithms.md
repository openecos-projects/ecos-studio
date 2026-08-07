<a id="algorithm.legalization.execution"></a>
## algorithm.legalization.execution

**Execution path:** The DreamPlace runner loads ECC data, builds `DreamplaceModule`, forces legalization-only parameters, creates the placement engine, and runs it. In legalization-only mode global placement and fillers are disabled while `legalize_flag` is enabled; the runner then saves the design and runs analysis and checklist generation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**
