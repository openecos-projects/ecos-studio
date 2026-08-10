<a id="failure.harden.preconditions"></a>
## failure.harden.preconditions

**Failure mode:** Without signoff STA items the runner returns failure before artifact generation. Final delivery evidence requires the generated GDS, LEF, and LIB package artifacts, not merely a completed subflow record.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.harden.engine"></a>
## failure.harden.engine

**Failure mode:** Without an ECC module, abstract LEF, timing-model LIB, and hardened GDS are not generated.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.harden.delivery"></a>
## failure.harden.delivery

**Failure mode:** The final missing-artifact metric counts absent GDS, LEF, or LIB. It is a package-completeness gate, not a substitute for checking their contents.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.harden.terminal_evidence"></a>
## failure.harden.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
