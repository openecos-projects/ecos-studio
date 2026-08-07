<a id="metric.harden_artifact_missing_count"></a>
## metric.harden_artifact_missing_count

**Meaning:** The number of required final delivery artifacts that are absent.

**Calculation:** ECC checks the hardened GDS, abstract LEF, and timing-model LIB paths and sums the missing checks.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
