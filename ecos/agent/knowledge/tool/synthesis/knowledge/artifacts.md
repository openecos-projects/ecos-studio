<a id="artifact.synthesis.outputs"></a>
## artifact.synthesis.outputs

**Meaning:** The synthesis output set: mapped Verilog, Yosys stat JSON, log, optional netlist-STA artifacts, metrics, and checklist evidence.

**Calculation:** The runner invokes Yosys, accepts the run only after the output netlist exists, then publishes the stat-derived analysis and checklist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.synthesis.output_verilog"></a>
## artifact.synthesis.output_verilog

**Meaning:** The mapped gate-level Verilog netlist produced by Yosys.

**Calculation:** The runner uses existence of `step.output.verilog` as its synthesis completion gate.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.synthesis.stat"></a>
## artifact.synthesis.stat

**Meaning:** The Yosys statistical feature record containing design area, cell, wire, and port counts.

**Calculation:** Yosys metrics read this record after netlist acceptance.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.synthesis.post_synthesis_sta"></a>
## artifact.synthesis.post_synthesis_sta

**Meaning:** The optional netlist-level STA report and structured power artifacts produced after synthesis.

**Calculation:** Supplemental STA is attempted only after the netlist exists; its failure does not invalidate synthesis.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.synthesis.log"></a>
## artifact.synthesis.log

**Meaning:** The Yosys execution log for runtime, plugin, Tcl, and output-netlist diagnostics.

**Calculation:** The runner directs subprocess stdout and stderr to `step.log.file` when executing Yosys.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.runner**, **ecc.builder**, **ecc.metrics**
