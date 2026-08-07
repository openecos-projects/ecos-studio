<a id="algorithm.sta.execution"></a>
## algorithm.sta.execution

**Execution path:** The ECC runner expands configured STA signoff items into Liberty and RCX-corner combinations. For each item it requires the SDC, SPEF, and Liberty files, runs timing into corner-specific report and feature directories, saves the design, and then builds multi-corner analysis and checklist evidence.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.sta.signoff_matrix"></a>
## algorithm.sta.signoff_matrix

**Signoff matrix:** `collect_sta_signoff_items` expands each configured Liberty corner and its listed RCX corners into one timing run. STA iterates that complete matrix; it does not select a single worst corner before analysis.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.sta.aggregate"></a>
## algorithm.sta.aggregate

**Aggregation:** The metric builder reads available corner QoR summaries, selects the minimum setup/hold WNS and TNS and minimum frequency, sums setup/hold violation counts, and retains loaded/missing-corner coverage in the structured STA facts.

**Source evidence:** **ecc.runner**, **ecc.module**
