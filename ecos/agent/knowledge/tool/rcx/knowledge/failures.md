<a id="failure.rcx.preconditions"></a>
## failure.rcx.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Topology/environment construction, process-table extraction, SPEF writing, or output copying can fail before the checked persistence gates; missing SPEF outputs or unparseable corner files must remain visible through RCX feature and signoff metrics rather than being treated as successful extraction.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.engine"></a>
## failure.rcx.engine

**Failure mode:** Without an ECC module, RCX cannot initialize with the workspace PDK.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.config"></a>
## failure.rcx.config

**Failure mode:** RCX requires a readable extraction configuration and workspace PDK process data; absent conductor, via, or capacitance tables leave affected records skipped.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.topology"></a>
## failure.rcx.topology

**Failure mode:** A malformed routed topology or environment overlap model prevents reliable per-corner electrical extraction even if the native runner returns to the wrapper.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.spef_output"></a>
## failure.rcx.spef_output

**Failure mode:** Generated SPEF files must exist at each declared corner output before copying and parsing; transient writer state is not a published extraction result.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.native_progress"></a>
## failure.rcx.native_progress

**Failure mode:** The wrapper records `run rcx` successful without inspecting init/run/destroy return values; explicit save-data and SPEF-fact gates are the checked boundaries.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.spef_facts"></a>
## failure.rcx.spef_facts

**Failure mode:** If RCX SPEF fact persistence fails after extraction, the runner returns false. Do not use transient files in `spef_writer` as a substitute for declared SPEF outputs.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**

<a id="failure.rcx.terminal_evidence"></a>
## failure.rcx.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**, **ircx.env**, **ircx.var_processor**, **ircx.res_extractor**, **ircx.cap_extractor**, **ircx.spef_writer**
