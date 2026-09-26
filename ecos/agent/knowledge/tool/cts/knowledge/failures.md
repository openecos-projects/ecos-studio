<a id="failure.cts.preconditions"></a>
## failure.cts.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Native CTS may return not-initialized, no-op, synthesis, optimization, instantiation, evaluation, or report errors that are not reflected by the wrapper's subflow updates; CTS metric availability also depends on persisted `CTS` feature facts and must not be interpreted as zero skew.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**

<a id="failure.cts.engine"></a>
## failure.cts.engine

**Failure mode:** Without an ECC module, CTS, its report, map, and timing feature facts are not executed.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**

<a id="failure.cts.native_flow"></a>
## failure.cts.native_flow

**Failure mode:** The native API distinguishes not-initialized, no-op, synthesis, optimization, instantiation, evaluation, and report errors, but the ECC runner does not branch on those return statuses before updating its subflow.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**

<a id="failure.cts.no_op"></a>
## failure.cts.no_op

**Failure mode:** A native no-op can mean that no usable clock domain was synthesized. It is not evidence that a clock tree was built or that skew targets were met.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**

<a id="failure.cts.report"></a>
## failure.cts.report

**Failure mode:** Report or map emission can fail independently of native CTS construction; the wrapper still proceeds, so the declared report/map paths must be checked.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**

<a id="failure.cts.timing_facts"></a>
## failure.cts.timing_facts

**Failure mode:** If `feature_cts_timing` cannot be persisted after `save_data`, the CTS runner logs an error and returns false. Missing timing facts cannot be repaired by the visual map.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**

<a id="failure.cts.terminal_evidence"></a>
## failure.cts.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**, **icts.synthesis**, **icts.topology**, **icts.htree**, **icts.router**, **icts.optimization**
