<a id="failure.harden.preconditions"></a>
## failure.harden.preconditions

**Failure mode:** Without an ECC module, a configured STA signoff item, or a workspace STA config path the runner returns failure before delivery. LEF/LIB/GDS writer errors can still leave a successful subflow record, so final evidence requires all generated package artifacts and their completeness metric.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.engine"></a>
## failure.harden.engine

**Failure mode:** Without an ECC module, abstract LEF, timing-model LIB, and hardened GDS are not generated.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.signoff_config"></a>
## failure.harden.signoff_config

**Failure mode:** Harden returns before artifact generation when the STA signoff matrix is empty or the workspace STA config path is unavailable.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.lef"></a>
## failure.harden.lef

**Failure mode:** A native abstract-LEF writer failure can leave the subflow marked successful; the declared LEF path must be checked independently.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.lib"></a>
## failure.harden.lib

**Failure mode:** Timing-model extraction can fail or produce no unambiguous generated Liberty source; a missing output LIB makes the delivery package incomplete.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.gds"></a>
## failure.harden.gds

**Failure mode:** The hardened GDS writer may return failure while the wrapper continues to analysis; GDS existence is required for package completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.delivery"></a>
## failure.harden.delivery

**Failure mode:** The final missing-artifact metric counts absent GDS, LEF, or LIB. It is a package-completeness gate, not a substitute for checking their contents.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**

<a id="failure.harden.terminal_evidence"></a>
## failure.harden.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**, **idb.builder**, **ista.interface**, **ista.characterizer**
