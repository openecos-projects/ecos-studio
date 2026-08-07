<a id="algorithm.rcx.execution"></a>
## algorithm.rcx.execution

**Execution path:** The ECC runner loads the design, initializes RCX with the workspace PDK, runs and destroys RCX, copies generated SPEF files to the declared output paths, saves the design, persists bounded SPEF feature facts, and runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.rcx.extraction_lifecycle"></a>
## algorithm.rcx.extraction_lifecycle

**Extraction lifecycle:** The runner initializes RCX with the workspace PDK, runs extraction, destroys the RCX engine, then copies SPEFs from the RCX writer directory to the declared step outputs. The copied outputs, rather than the transient writer files, are the downstream STA inputs.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.rcx.feature_facts"></a>
## algorithm.rcx.feature_facts

**Feature facts:** `save_rcx_spef_feature_facts` records expected SPEF corners, output existence, parse failures and per-corner electrical totals after copy. The stage returns false if that fact publication fails.

**Source evidence:** **ecc.runner**, **ecc.module**
