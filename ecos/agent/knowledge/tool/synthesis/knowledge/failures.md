<a id="failure.synthesis.preconditions"></a>
## failure.synthesis.preconditions

**Failure mode:** A missing Yosys runtime, no valid RTL or filelist, an unavailable required Slang plugin, or a missing output netlist marks the `run yosys` subflow invalid. A failed supplemental post-synthesis STA does not invalidate an otherwise generated netlist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="failure.synthesis.input"></a>
## failure.synthesis.input

**Failure mode:** The runner refuses to invoke Yosys when neither a readable RTL source nor a file list is available; this is an input failure, not a synthesis-quality result.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="failure.synthesis.runtime"></a>
## failure.synthesis.runtime

**Failure mode:** The runner marks `run yosys` invalid when neither the bundled runtime nor PATH provides Yosys. It writes the error to the step log when possible and does not invoke Tcl.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="failure.synthesis.process"></a>
## failure.synthesis.process

**Failure mode:** A nonzero Yosys process result or an exception while launching the generated Tcl flow leaves synthesis incomplete; no downstream metric can promote that run to success.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="failure.synthesis.plugin"></a>
## failure.synthesis.plugin

**Failure mode:** A file list that requires Slang cannot be elaborated when the required plugin/runtime is unavailable; the generated pass schedule is not entered.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="failure.synthesis.output_netlist"></a>
## failure.synthesis.output_netlist

**Failure mode:** After the subprocess returns, the runner requires the configured output netlist to exist. A zero process exit without that file is reported as invalid synthesis.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**

<a id="failure.synthesis.terminal_evidence"></a>
## failure.synthesis.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **yosys.script**
