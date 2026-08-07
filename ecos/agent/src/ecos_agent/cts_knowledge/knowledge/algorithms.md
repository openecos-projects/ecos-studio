<a id="algorithm.cts.execution"></a>
## algorithm.cts.execution

**Execution path:** The ECC runner loads the design, invokes `run_cts` for clock-tree synthesis with the CTS configuration and step data directory, writes a CTS report and map, saves the design, persists clock-timing feature facts, and then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.cts.subflow"></a>
## algorithm.cts.subflow

**Subflow order:** `load data -> run CTS -> save data -> analysis`. Inside the CTS runner, `run_cts`, `report_cts`, and `feature_cts_map` execute before persistence; timing feature facts are saved after the database has been saved.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.cts.timing_quality"></a>
## algorithm.cts.timing_quality

**Clock-quality boundary:** Buffer and wirelength facts come from the `CTS` feature record. Skew, insertion latency and target-unmet counts are emitted only when `timing_quality.availability` is `available`; missing timing facts must not be represented as zero.

**Source evidence:** **ecc.runner**, **ecc.module**
