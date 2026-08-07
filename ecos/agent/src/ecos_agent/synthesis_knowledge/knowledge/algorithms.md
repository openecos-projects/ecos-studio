<a id="algorithm.synthesis.execution"></a>
## algorithm.synthesis.execution

**Execution path:** The Yosys runner resolves the bundled or PATH runtime, validates that either RTL or a filelist exists, runs `yosys_synthesis.tcl`, and accepts the stage only when the configured output netlist exists. It then optionally runs supplemental netlist STA, publishes Yosys statistics, and runs its checklist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**
