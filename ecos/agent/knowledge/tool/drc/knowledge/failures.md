<a id="failure.drc.preconditions"></a>
## failure.drc.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Shape collection, cluster partitioning, enabled-rule dispatch, or report/feature persistence can fail while the wrapper records subflow progress; a DRC run needs its feature/report artifacts to distinguish zero reported violations from missing analysis output.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.engine"></a>
## failure.drc.engine

**Failure mode:** Without an ECC module, DRC initialization and rule checking do not run.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.native_rules"></a>
## failure.drc.native_rules

**Failure mode:** Shape collection, cluster partitioning, enabled-rule dispatch, and geometric checks run natively while the wrapper ignores their return values; a report alone does not prove all enabled rules completed.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.invalid_shape"></a>
## failure.drc.invalid_shape

**Failure mode:** The wrapper converts result shapes and classifies special nets using `regular_net_num` before verification; malformed or missing result-shape mapping must be diagnosed rather than treated as zero violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.report"></a>
## failure.drc.report

**Failure mode:** The configured report path and saved feature file are independent evidence. Missing either leaves the DRC count unknown even when the wrapper subflow says success.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.feature"></a>
## failure.drc.feature

**Failure mode:** The DRC count comes from the saved feature record. If that record is absent or malformed, a missing number must not be reported as zero violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.terminal_evidence"></a>
## failure.drc.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**
