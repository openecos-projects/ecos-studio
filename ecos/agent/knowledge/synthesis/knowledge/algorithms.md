<a id="algorithm.synthesis.execution"></a>
## algorithm.synthesis.execution

**Execution path:** The Yosys runner resolves the bundled or PATH runtime, validates that either RTL or a filelist exists, runs `yosys_synthesis.tcl`, and accepts the stage only when the configured output netlist exists. It then optionally runs supplemental netlist STA, publishes Yosys statistics, and runs its checklist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="algorithm.synthesis.frontend_lowering"></a>
## algorithm.synthesis.frontend_lowering

**Input and state:** The generated Tcl selects `read_slang` for a Slang-required file list or `read_verilog -sv` otherwise, then creates Yosys RTLIL modules and processes.

**Algorithm:** `synth -run :fine` elaborates the top module before `share -aggressive`, `onehot`, `muxpack`, `opt_demorgan`, and `opt_ffinv` simplify resource sharing, one-hot logic, multiplexers, De Morgan forms, and inverted flip-flop controls. A second `synth -run fine:` and `opt_clean -purge` remove dead logic before technology mapping.

**Boundary:** This is a finite pass schedule over the imported RTLIL graph; it is not a physical placement or timing signoff result.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="algorithm.synthesis.technology_mapping"></a>
## algorithm.synthesis.technology_mapping

**Input and state:** The generated global Tcl supplies Liberty cells, dont-use cells, clock period, ABC driver/load, and the selected delay-or-area strategy.

**Algorithm:** Yosys runs `clockgate`, `dfflibmap`, and ABC with `-D` set to the clock period. The ABC script alternates balancing, resubstitution, rewriting, refactoring, retiming, Boolean mapping, buffering, resizing, and static timing estimation; `hilomap` and `setundef -zero` then resolve constants and undefined values.

**Boundary:** Mapping optimizes the gate-level implementation against supplied library constraints. It does not establish that downstream CTS, routing, or extracted timing is clean.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**, **yosys.tech**

<a id="algorithm.synthesis.constraint_materialization"></a>
## algorithm.synthesis.constraint_materialization

**Input and state:** `generate_global_var_tcl()` materializes top-module, RTL/filelist, frequency, Liberty, dont-use, tie-cell, ABC driver/load, and output paths into `global_var.tcl`.

**Algorithm:** It converts frequency to `clk_period_ps = 1000000.0 / clk_freq_mhz`, selects either single RTL or a file list, and serializes mapping constraints consumed by the Tcl pass sequence. Missing top module, frequency, or source input prevents a valid invocation.

**Boundary:** This is deterministic configuration construction. It defines optimization inputs but does not itself transform the netlist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.builder**

<a id="algorithm.synthesis.mapped_netlist_gate"></a>
## algorithm.synthesis.mapped_netlist_gate

**Output and gate:** After mapping, the Tcl writes stat JSON, runs `check -mapped`, and writes the final Verilog. The ECOS runner accepts the stage only when `step.output.verilog` exists after the Yosys process returns.

**Failure boundary:** A successful process exit without that declared netlist is invalid synthesis; supplemental netlist STA is attempted only after this gate and does not retroactively prove or invalidate mapping.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**
