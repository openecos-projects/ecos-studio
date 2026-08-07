<a id="metric.rcx_missing_corner_count"></a>
## metric.rcx_missing_corner_count

**Meaning:** The number of expected RCX corners without a published SPEF.

**Calculation:** ECC counts missing expected corners in the persisted `rcx.signoff_metrics` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.rcx_spef_parse_failure_count"></a>
## metric.rcx_spef_parse_failure_count

**Meaning:** The number of SPEF files that could not be parsed for electrical aggregation.

**Calculation:** ECC reads `rcx.electrical_summary.parse_failure_count` after parsing the published SPEFs.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.rcx_worst_total_capacitance_ff"></a>
## metric.rcx_worst_total_capacitance_ff

**Meaning:** The largest total capacitance across parsed RCX corners in femtofarads.

**Calculation:** ECC takes the worst parsed per-corner total capacitance in `rcx.electrical_summary`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.rcx_worst_total_resistance_ohm"></a>
## metric.rcx_worst_total_resistance_ohm

**Meaning:** The largest total resistance across parsed RCX corners in ohms.

**Calculation:** ECC takes the worst parsed per-corner total resistance in `rcx.electrical_summary`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
