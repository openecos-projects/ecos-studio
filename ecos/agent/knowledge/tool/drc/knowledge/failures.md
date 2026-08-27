<a id="failure.drc.preconditions"></a>
## failure.drc.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. A DRC run needs its feature/report artifacts to distinguish zero reported violations from missing analysis output.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.drc.engine"></a>
## failure.drc.engine

**Failure mode:** Without an ECC module, DRC initialization and rule checking do not run.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.drc.feature"></a>
## failure.drc.feature

**Failure mode:** The DRC count comes from the saved feature record. If that record is absent or malformed, a missing number must not be reported as zero violations.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.drc.terminal_evidence"></a>
## failure.drc.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
