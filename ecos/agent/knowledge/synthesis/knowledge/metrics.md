<a id="metric.synthesis_cell_area"></a>
## metric.synthesis_cell_area

**Meaning:** The total mapped standard-cell area reported by Yosys after technology mapping.

**Calculation:** `yosys/metrics.py` reads `/design/area` from the Yosys stat JSON and publishes `round(area, 2)`.

**Boundary:** It is a library-area estimate of the synthesized netlist, not placed area, utilization, or post-route area.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**

<a id="metric.synthesis_cell_count"></a>
## metric.synthesis_cell_count

**Meaning:** The number of mapped cells in the synthesized netlist.

**Calculation:** Yosys reads `/design/num_cells` from the stat JSON and publishes that structural count.

**Boundary:** It counts the current mapped netlist only; it does not include later CTS, filler, or routing edits.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**

<a id="metric.synthesis_port_count"></a>
## metric.synthesis_port_count

**Meaning:** The number of synthesized port bits.

**Calculation:** Yosys reads `/design/num_port_bits` from the stat JSON without a cross-stage aggregation.

**Boundary:** This is a bit count, not a count of logical port declarations and not a physical IO-pin count.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**

<a id="metric.synthesis_wire_count"></a>
## metric.synthesis_wire_count

**Meaning:** The number of wires in the synthesized Yosys netlist.

**Calculation:** Yosys reads `/design/num_wires` from the stat JSON and publishes the resulting structural count.

**Boundary:** A Yosys wire is a netlist representation; it is not routed wirelength or a count of physical nets after implementation.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**
