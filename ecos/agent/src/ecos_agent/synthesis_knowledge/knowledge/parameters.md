<a id="parameter.synthesis.input"></a>
## parameter.synthesis.input

**Meaning:** The RTL-or-filelist source boundary.

**Role:** The Yosys runner requires at least one existing source before invoking `yosys_synthesis.tcl`.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**

<a id="parameter.synthesis.runtime"></a>
## parameter.synthesis.runtime

**Meaning:** The bundled-or-PATH Yosys runtime selection.

**Role:** The runner resolves it before synthesis and records an invalid subflow when no executable is available.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**
