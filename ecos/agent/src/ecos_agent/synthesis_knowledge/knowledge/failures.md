<a id="failure.synthesis.preconditions"></a>
## failure.synthesis.preconditions

**Failure mode:** A missing Yosys runtime, no valid RTL or filelist, an unavailable required Slang plugin, or a missing output netlist marks the `run yosys` subflow invalid. A failed supplemental post-synthesis STA does not invalidate an otherwise generated netlist.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**
