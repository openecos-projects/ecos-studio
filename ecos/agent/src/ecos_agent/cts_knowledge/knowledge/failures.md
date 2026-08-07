<a id="failure.cts.preconditions"></a>
## failure.cts.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. CTS metric availability depends on the persisted `CTS` feature facts; absent timing-quality facts must remain unavailable rather than be interpreted as zero skew.

**Source evidence:** **ecc.runner**, **ecc.module**
