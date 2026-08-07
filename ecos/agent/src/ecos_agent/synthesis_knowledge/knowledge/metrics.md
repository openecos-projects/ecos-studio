<a id="metric.synthesis_cell_area"></a>
## metric.synthesis_cell_area

**Meaning:** The total mapped cell area after Yosys synthesis.

**Calculation:** Yosys reads `design.area` from its stat JSON and rounds it to two decimal places before publishing the normalized record.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.synthesis_cell_count"></a>
## metric.synthesis_cell_count

**Meaning:** The number of mapped cells in the synthesized design.

**Calculation:** Yosys reads `design.num_cells` from the stat JSON; it is a post-synthesis structural count.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.synthesis_port_count"></a>
## metric.synthesis_port_count

**Meaning:** The number of synthesized port bits.

**Calculation:** Yosys reads `design.num_port_bits` from the stat JSON.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.synthesis_wire_count"></a>
## metric.synthesis_wire_count

**Meaning:** The number of synthesized wires.

**Calculation:** Yosys reads `design.num_wires` from the stat JSON.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.metrics**, **gui.step_metrics**
