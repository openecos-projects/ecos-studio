<a id="algorithm.sizer.execution"></a>
## algorithm.sizer.execution

**Execution path:** The Sizer runner resets the three-step subflow, checks the ECC, Sizer, and DreamPlace runtimes plus generated script paths, runs Sizer, and requires both staging DEF and Verilog outputs. It then invokes DreamPlace legalization on those staging files and calls shared ECC persistence only after legalization succeeds. The verified wrapper order is `run sizer` -> `run legalization` -> `save data`.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="algorithm.sizer.runtime_and_script_preconditions"></a>
## algorithm.sizer.runtime_and_script_preconditions

**Input and state:** The wrapper starts from a reset three-step subflow and removes prior published outputs.

**Gate:** It requires ECC, Sizer, and DreamPlace availability plus existing generated env and command files. A failed check marks the corresponding subflow step invalid before Sizer runs.

**Boundary:** These checks establish executable prerequisites only; they do not describe or validate a native Sizer optimization algorithm.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="algorithm.sizer.command_and_staging_gate"></a>
## algorithm.sizer.command_and_staging_gate

**Input and state:** The wrapper constructs the fixed Sizer invocation from the configured executable, env file, and command file, then runs it in the step work directory.

**Gate:** `run sizer` succeeds only when the process returns zero and both sizer staging DEF and Verilog exist. Otherwise the step is incomplete and legalization is not entered.

**Boundary:** ECOS observes only the subprocess result and declared staging files; it does not inspect or claim the native Sizer algorithm.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="algorithm.sizer.legalization_handoff"></a>
## algorithm.sizer.legalization_handoff

**Input and state:** After the staging gate, the wrapper passes the staging DEF and Verilog to `legalize_layout`.

**Gate:** `run legalization` succeeds only when DreamPlace returns a live ECC object representing the legalized state. A missing object stops the stage before publication.

**Boundary:** This handoff verifies wrapper sequencing and legalization acceptance, not timing improvement or the internals of Sizer.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="algorithm.sizer.publication_and_cleanup"></a>
## algorithm.sizer.publication_and_cleanup

**Input and state:** The legalized ECC object is passed to shared `save_data` with stage-feature emission disabled.

**Gate and output:** `save data` is successful only when persistence returns true. On failure, the wrapper removes partial published outputs; it always closes the ECC object.

**Boundary:** Published artifacts establish completion of the wrapper pipeline, not QoR improvement or native-algorithm activation.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**
