<a id="algorithm.synthesis.execution"></a>
## algorithm.synthesis.execution

**Execution path:** The Yosys runner resolves the bundled or PATH runtime, validates that either RTL or a filelist exists, runs `yosys_synthesis.tcl`, and accepts the stage only when the configured output netlist exists. It then optionally runs supplemental netlist STA, publishes Yosys statistics, and runs its checklist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="algorithm.synthesis.input_gate"></a>
## algorithm.synthesis.input_gate

**Input gate:** The runner accepts either an existing RTL file or an existing filelist. It obtains the Yosys runtime before invoking the Tcl script and, when required by the step data, verifies the Slang plugin before synthesis starts.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="algorithm.synthesis.completion"></a>
## algorithm.synthesis.completion

**Completion gate:** Yosys process exit alone is insufficient. The runner accepts synthesis only after `step.output.verilog` exists, then records `run yosys` success and publishes statistics and checklist evidence.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**
