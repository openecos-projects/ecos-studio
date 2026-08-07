<a id="failure.legalization.preconditions"></a>
## failure.legalization.preconditions

**Failure mode:** A missing ECC instance prevents execution. DreamPlace reports failure when its PPA result has infinite HPWL, so subflow progress alone is not terminal legalization evidence.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**
