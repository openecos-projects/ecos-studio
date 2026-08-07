<a id="metric.drc_count"></a>
## metric.drc_count

**Meaning:** `drc_count` is the normalized drc metric shown by ECOS when its source fact is available.

**Calculation:** ECC reads the `drc.number` feature fact to publish the DRC count used by the GUI. Missing source data remains unavailable; it is not converted to zero or a success claim.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
