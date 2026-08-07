<a id="metric.rcx_missing_corner_count"></a>
## metric.rcx_missing_corner_count

**Meaning:** The number of declared RCX corners without a published SPEF output.

**Calculation:** RCX metrics compare expected SPEF corner paths with published files and write the missing count into the persisted RCX coverage facts.

**Boundary:** It measures output coverage, not electrical correctness of SPEFs that do exist and not timing coverage until STA consumes them.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ircx.spef_writer**, **ecc.sta_qor**

<a id="metric.rcx_spef_parse_failure_count"></a>
## metric.rcx_spef_parse_failure_count

**Meaning:** The number of published SPEF files that cannot be parsed into an electrical summary.

**Calculation:** ECC parses each published SPEF, records unsuccessful parses, and publishes the aggregate `parse_failure_count` from `rcx.electrical_summary`.

**Boundary:** A parseable SPEF is not proof that extraction is physically accurate; missing outputs are tracked separately by the corner-coverage metric.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**

<a id="metric.rcx_worst_total_capacitance_ff"></a>
## metric.rcx_worst_total_capacitance_ff

**Meaning:** The largest parsed total capacitance across RCX corners, in femtofarads.

**Calculation:** For each parseable SPEF, ECC converts ground and coupling capacitance to fF, sums them as total capacitance, then publishes the maximum corner value.

**Boundary:** Only parseable published corners participate; a missing or unparseable declared corner affects coverage and must not be silently treated as zero capacitance.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**

<a id="metric.rcx_worst_total_resistance_ohm"></a>
## metric.rcx_worst_total_resistance_ohm

**Meaning:** The largest parsed total resistance across RCX corners, in ohms.

**Calculation:** ECC converts per-corner SPEF resistance totals to ohms and publishes the maximum over parseable published corners.

**Boundary:** It is a corner summary, not a path delay or signoff timing result; incomplete SPEF coverage remains separately visible.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**
