<a id="metric.drc_count"></a>
## metric.drc_count

**Meaning:** The total number of reported DRC violations.

**Calculation:** ECC reads `drc.number` from the DRC step feature record; no record means the metric is unavailable, not zero.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
