<a id="algorithm.filler.execution"></a>
## algorithm.filler.execution

**Execution path:** The ECC runner loads the design, invokes `run_filler` with the workspace Filler configuration, saves the updated design and geometry snapshot, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.filler.subflow"></a>
## algorithm.filler.subflow

**Subflow order:** `load data -> run filler -> save data -> analysis`. Filler insertion is delegated to `ECCToolsModule.run_filler` with the workspace Filler configuration, then the changed ECC database is serialized for downstream signoff stages.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.filler.result_boundary"></a>
## algorithm.filler.result_boundary

**Result boundary:** This flow version does not publish a filler-specific GUI comparison metric. A filler-success claim therefore requires the saved post-filler database/geometry and the step checklist, not an assumed change in instance count.

**Source evidence:** **ecc.runner**, **ecc.module**
