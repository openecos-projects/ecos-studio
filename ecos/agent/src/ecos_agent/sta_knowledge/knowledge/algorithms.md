<a id="algorithm.sta.execution"></a>
## algorithm.sta.execution

**Execution path:** The ECC runner expands configured STA signoff items into Liberty and RCX-corner combinations. For each item it requires the SDC, SPEF, and Liberty files, runs timing into corner-specific report and feature directories, saves the design, and then builds multi-corner analysis and checklist evidence.

**Source evidence:** **ecc.runner**, **ecc.module**
