<a id="failure.cts.preconditions"></a>
## failure.cts.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. CTS metric availability depends on the persisted `CTS` feature facts; absent timing-quality facts must remain unavailable rather than be interpreted as zero skew.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.cts.engine"></a>
## failure.cts.engine

**Failure mode:** Without an ECC module, CTS, its report, map, and timing feature facts are not executed.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.cts.timing_facts"></a>
## failure.cts.timing_facts

**Failure mode:** If `feature_cts_timing` cannot be persisted after `save_data`, the CTS runner logs an error and returns false. Missing timing facts cannot be repaired by the visual map.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.cts.terminal_evidence"></a>
## failure.cts.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
