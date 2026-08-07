<a id="metric.harden_artifact_missing_count"></a>
## metric.harden_artifact_missing_count

**Meaning:** `harden_artifact_missing_count` is the normalized Harden metric shown by ECOS when its source fact is available.

**Calculation:** ECC checks hardened GDS, LEF, and LIB existence and publishes the count of missing required delivery artifacts. Missing source data remains unavailable; it is not converted to zero or a success claim.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
