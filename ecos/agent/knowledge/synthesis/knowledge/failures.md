<a id="failure.synthesis.preconditions"></a>
## failure.synthesis.preconditions

**Failure mode:** A missing Yosys runtime, no valid RTL or filelist, an unavailable required Slang plugin, or a missing output netlist marks the `run yosys` subflow invalid. A failed supplemental post-synthesis STA does not invalidate an otherwise generated netlist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="failure.synthesis.runtime"></a>
## failure.synthesis.runtime

**Failure mode:** The runner marks `run yosys` invalid when neither the bundled runtime nor PATH provides Yosys. It writes the error to the step log when possible and does not invoke Tcl.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="failure.synthesis.output_netlist"></a>
## failure.synthesis.output_netlist

**Failure mode:** After the subprocess returns, the runner requires the configured output netlist to exist. A zero process exit without that file is reported as invalid synthesis.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="failure.synthesis.terminal_evidence"></a>
## failure.synthesis.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**
