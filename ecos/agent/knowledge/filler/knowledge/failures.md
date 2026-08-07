<a id="failure.filler.preconditions"></a>
## failure.filler.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. The standard GUI has no filler-specific comparison metric, so artifact and checklist evidence are required to assess its result.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.filler.engine"></a>
## failure.filler.engine

**Failure mode:** Without an ECC module, the runner does not invoke filler insertion.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.filler.evidence"></a>
## failure.filler.evidence

**Failure mode:** There is no dedicated filler metric in the GUI comparison set. Missing saved artifacts or checklist output leaves the filler result unverified.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.filler.terminal_evidence"></a>
## failure.filler.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
