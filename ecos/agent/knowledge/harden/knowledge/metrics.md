<a id="metric.harden_artifact_missing_count"></a>
## metric.harden_artifact_missing_count

**Meaning:** The number of required Harden package artifacts that are absent.

**Calculation:** ECC tests for GDS, LEF, and LIB existence, stores each boolean fact, and sums the zero-valued checks into a count from 0 through 3.

**Boundary:** This is package-path completeness only: it does not validate GDS/LEF/LIB contents, multi-corner timing correctness, or final QoR closure.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**
