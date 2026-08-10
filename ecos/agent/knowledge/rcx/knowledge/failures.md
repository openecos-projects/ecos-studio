<a id="failure.rcx.preconditions"></a>
## failure.rcx.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Missing SPEF outputs or unparseable corner files must remain visible through RCX feature and signoff metrics rather than being treated as a successful extraction.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.rcx.engine"></a>
## failure.rcx.engine

**Failure mode:** Without an ECC module, RCX cannot initialize with the workspace PDK.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.rcx.spef_facts"></a>
## failure.rcx.spef_facts

**Failure mode:** If RCX SPEF fact persistence fails after extraction, the runner returns false. Do not use transient files in `spef_writer` as a substitute for declared SPEF outputs.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.rcx.terminal_evidence"></a>
## failure.rcx.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
