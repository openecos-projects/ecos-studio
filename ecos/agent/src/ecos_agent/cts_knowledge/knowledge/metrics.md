<a id="metric.clock_path_max_buffer"></a>
## metric.clock_path_max_buffer

**Meaning:** The largest buffer count on a clock path.

**Calculation:** ECC reads `CTS.clock_path_max_buffer` from the CTS step feature record.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.clock_path_min_buffer"></a>
## metric.clock_path_min_buffer

**Meaning:** The smallest buffer count on a clock path.

**Calculation:** ECC reads `CTS.clock_path_min_buffer` from the CTS step feature record.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.clock_wirelength"></a>
## metric.clock_wirelength

**Meaning:** The total clock-network wirelength.

**Calculation:** ECC reads `CTS.total_clock_wirelength` and publishes it through the normalized clock-wirelength metric.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_buffer_area"></a>
## metric.cts_buffer_area

**Meaning:** The total area of buffers inserted by CTS.

**Calculation:** ECC reads `CTS.buffer_area` from the CTS step feature record.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_buffer_count"></a>
## metric.cts_buffer_count

**Meaning:** The number of buffers inserted by CTS.

**Calculation:** ECC reads `CTS.buffer_num` from the CTS step feature record.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_clock_tree_max_level"></a>
## metric.cts_clock_tree_max_level

**Meaning:** The maximum hierarchy level of a clock tree.

**Calculation:** ECC reads `CTS.max_level_of_clock_tree` from the CTS step feature record.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_clock_wirelength_max"></a>
## metric.cts_clock_wirelength_max

**Meaning:** The maximum wirelength of an individual clock tree.

**Calculation:** ECC reads `CTS.max_clock_wirelength` from the CTS step feature record.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_worst_optimized_skew_ns"></a>
## metric.cts_worst_optimized_skew_ns

**Meaning:** The worst optimized clock skew in nanoseconds.

**Calculation:** When `CTS.timing_quality.availability` is `available`, ECC reads `worst_optimized_skew_ns`; otherwise the metric is omitted.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_worst_max_insertion_latency_ns"></a>
## metric.cts_worst_max_insertion_latency_ns

**Meaning:** The largest clock insertion latency in nanoseconds.

**Calculation:** When CTS timing quality is available, ECC reads `timing_quality.worst_max_insertion_latency_ns`; otherwise the metric is omitted.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.cts_skew_target_unmet_count"></a>
## metric.cts_skew_target_unmet_count

**Meaning:** The number of clocks whose skew target remains unmet.

**Calculation:** When CTS timing quality is available, ECC reads `timing_quality.target_unmet_count`; otherwise the metric is omitted.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.instance_count"></a>
## metric.instance_count

**Meaning:** The current number of design instances.

**Calculation:** ECC reads `Design Statis.num_instances` from the saved database feature summary after the stage has mutated the database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.io_pin_count"></a>
## metric.io_pin_count

**Meaning:** The current number of IO pins.

**Calculation:** ECC reads `Design Statis.num_iopins` from the saved database feature summary.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.net_count"></a>
## metric.net_count

**Meaning:** The current number of design nets.

**Calculation:** ECC reads `Design Statis.num_nets` from the saved database feature summary after the stage has mutated the database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
