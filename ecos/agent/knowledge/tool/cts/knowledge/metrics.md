<a id="metric.clock_path_max_buffer"></a>
## metric.clock_path_max_buffer

**Meaning:** The largest inserted-buffer count found on a reachable clock path.

**Calculation:** CTS evaluates clock-path depth statistics and writes `CTS.clock_path_max_buffer`, which the metric builder reads directly.

**Boundary:** When path statistics are unavailable the native summary currently retains zero, so zero is not independently validated proof of a buffer-free clock tree.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor**, **icts.qor_metrics**, **icts.api**, **ecc.feature.tools**

<a id="metric.clock_path_min_buffer"></a>
## metric.clock_path_min_buffer

**Meaning:** The smallest inserted-buffer count found on a reachable clock path.

**Calculation:** CTS writes the minimum path-depth statistic to `CTS.clock_path_min_buffer`, and the metric builder publishes it directly.

**Boundary:** It is a descriptive minimum rather than a closure target; an unavailable native path statistic can currently appear as zero.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor**, **icts.qor_metrics**, **icts.api**, **ecc.feature.tools**

<a id="metric.clock_wirelength"></a>
## metric.clock_wirelength

**Meaning:** The total wirelength of reachable clock nets reported by CTS.

**Calculation:** CTS sums clock-net wirelengths into `total_clock_network_wirelength_dbu`; the current feature bridge writes that DBU field as `CTS.total_clock_wirelength`, and the metric builder publishes it.

**Boundary:** The GUI metadata labels this metric `um`, but the current C++ bridge supplies a DBU field without conversion. Do not treat the displayed value as verified micrometres until that interface is reconciled.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor**, **icts.qor_metrics**, **icts.api**, **ecc.feature.tools**

<a id="metric.cts_buffer_area"></a>
## metric.cts_buffer_area

**Meaning:** The total area of unique buffers inserted into clock trees, in square micrometres when the layout query is available.

**Calculation:** CTS de-duplicates clock-buffer instances and sums `queryCellAreaUm2(master)` into `CTS.buffer_area`; the metric builder publishes the finite result.

**Boundary:** If the layout or a buffer-master area is unavailable the native value is null and this metric is omitted; omission is not zero inserted-buffer area.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor**, **icts.api**, **ecc.feature.tools**

<a id="metric.cts_buffer_count"></a>
## metric.cts_buffer_count

**Meaning:** The number of unique buffer instances counted across constructed clock trees.

**Calculation:** CTS inserts each clock-buffer instance into a set and increments `final_clock_buffer_count` only on first occurrence; it is emitted as `CTS.buffer_num`.

**Boundary:** It counts buffers identified by the CTS evaluator, not every buffer cell in the full design database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor**, **icts.api**, **ecc.feature.tools**

<a id="metric.cts_clock_tree_max_level"></a>
## metric.cts_clock_tree_max_level

**Meaning:** The maximum CTS clock-tree path level.

**Calculation:** The CTS bridge writes `pathBufferStats().max_buffer_count` into `CTS.max_level_of_clock_tree`, and the metric builder publishes it.

**Boundary:** In the current implementation this is the same path-buffer-depth statistic, not an independently computed topology-level metric.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor_metrics**, **icts.api**, **ecc.feature.tools**

<a id="metric.cts_clock_wirelength_max"></a>
## metric.cts_clock_wirelength_max

**Meaning:** The greatest wirelength of one reachable clock net reported by CTS.

**Calculation:** CTS finds the maximum clock-net wirelength in DBU and writes it as `CTS.max_clock_wirelength`; the metric builder reads that field.

**Boundary:** As with total clock wirelength, GUI metadata says `um` while the current C++ bridge writes DBU, so the published unit is not source-verified.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.qor**, **icts.qor_metrics**, **icts.api**, **ecc.feature.tools**

<a id="metric.cts_worst_optimized_skew_ns"></a>
## metric.cts_worst_optimized_skew_ns

**Meaning:** The largest optimized skew over clocks for which CTS timing facts are available, in nanoseconds.

**Calculation:** The native CTS timing bridge takes `max(clock.optimized_skew_ns)` and the metric builder publishes it only when `CTS.timing_quality.availability == 'available'`.

**Boundary:** This is CTS timing-feature coverage, not multi-corner post-route STA signoff; unavailable timing facts omit the metric rather than reporting zero skew.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.api**

<a id="metric.cts_worst_max_insertion_latency_ns"></a>
## metric.cts_worst_max_insertion_latency_ns

**Meaning:** The largest maximum insertion latency over available CTS clock timing facts, in nanoseconds.

**Calculation:** The native CTS timing bridge takes `max(clock.max_insertion_latency_ns)` and the metric builder requires `timing_quality.availability == 'available'` before publishing it.

**Boundary:** It is omitted when CTS timing facts are unavailable and must not be substituted by a default latency or an STA result.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.api**

<a id="metric.cts_skew_target_unmet_count"></a>
## metric.cts_skew_target_unmet_count

**Meaning:** The number of available CTS clocks whose skew target is not met.

**Calculation:** The native timing bridge sums `1` for each clock with `target_met == false`; publication is gated by `CTS.timing_quality.availability`.

**Boundary:** It only covers clocks returned by the CTS timing feature and is not a count of timing-path violations across all STA corners.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **icts.api**

<a id="metric.instance_count"></a>
## metric.instance_count

**Meaning:** The number of instances in the saved physical database.

**Calculation:** The parser writes `Design Statis.num_instances`; the stage metric builder publishes that finite count after the stage mutation is saved.

**Boundary:** This includes whatever the current database represents at that stage and is not limited to movable standard cells.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.io_pin_count"></a>
## metric.io_pin_count

**Meaning:** The number of IO pins in the saved physical database.

**Calculation:** The parser writes `Design Statis.num_iopins`, which the metric builder publishes as a finite count.

**Boundary:** It is a physical IO-pin count at the saved step state, not Yosys port-bit count or a measure of IO-placement legality.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.net_count"></a>
## metric.net_count

**Meaning:** The number of nets in the saved physical database.

**Calculation:** The parser writes `Design Statis.num_nets`; the metric builder publishes that finite count after persistence.

**Boundary:** It is a database connectivity count, not a count of routed nets, timing paths, or DRC violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**
