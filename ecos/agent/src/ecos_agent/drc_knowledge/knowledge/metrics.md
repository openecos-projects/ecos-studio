<a id="metric.drc_count"></a>
## metric.drc_count

**Meaning:** The total DRC violations reported by the saved DRC feature record.

**Calculation:** The metric builder reads `drc.number` from the DRC step feature and publishes the finite count; the DRC clean gate requires it to equal zero.

**Boundary:** A missing or malformed feature is unavailable, not zero violations, and this number does not describe which rules or shapes caused the violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **idrc.interface**, **ecc.feature.tools**
