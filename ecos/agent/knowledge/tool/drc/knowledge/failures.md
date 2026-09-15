<a id="failure.drc.preconditions"></a>
## failure.drc.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Shape collection, cluster partitioning, enabled-rule dispatch, or report/feature persistence can fail while the wrapper records subflow progress; a DRC run needs its feature/report artifacts to distinguish zero reported violations from missing analysis output.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.engine"></a>
## failure.drc.engine

**Failure mode:** Without an ECC module, the native `init_drc -> run_drc -> destroy_drc` lifecycle and rule checking do not run.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.native_rules"></a>
## failure.drc.native_rules

**Failure mode:** Shape collection, cluster partitioning, enabled-rule dispatch, and geometric checks run natively while the wrapper ignores their return values; a report alone does not prove all enabled rules completed.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.violation_map"></a>
## failure.drc.violation_map

**Failure mode:** The feature translation requires the native `violation_map.json` in the step data directory; an absent file or a non-list payload makes `save_drc_feature` return false and leaves the DRC count unknown even when the wrapper subflow says success.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.invalid_shape"></a>
## failure.drc.invalid_shape

**Failure mode:** Each violation entry must carry a non-empty string `type` and a list-shaped `shape` with a usable layer name at index 4; any malformed entry aborts feature translation rather than being counted as zero violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.feature"></a>
## failure.drc.feature

**Failure mode:** The DRC count comes from the translated feature record (`drc.number` plus per-type/layer distribution). If that record is absent or malformed, a missing number must not be reported as zero violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**

<a id="failure.drc.terminal_evidence"></a>
## failure.drc.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**, **idrc.validator**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**
