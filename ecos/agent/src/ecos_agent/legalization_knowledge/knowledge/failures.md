<a id="failure.legalization.preconditions"></a>
## failure.legalization.preconditions

**Failure mode:** A missing ECC instance prevents execution. DreamPlace reports failure when its PPA result has infinite HPWL, so subflow progress alone is not terminal legalization evidence.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**

<a id="failure.legalization.engine"></a>
## failure.legalization.engine

**Failure mode:** Without an ECC module, DreamPlace legalization is not constructed and no legal placement is produced.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**

<a id="failure.legalization.infinite_hpwl"></a>
## failure.legalization.infinite_hpwl

**Failure mode:** `DreamplaceModule` returns false when `PlacementEngine.run()` reports infinite HPWL. The DreamPlace runner's progress record must not override that terminal tool result.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**

<a id="failure.legalization.terminal_evidence"></a>
## failure.legalization.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**
