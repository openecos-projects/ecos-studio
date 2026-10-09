<a id="failure.sizer.preconditions"></a>
## failure.sizer.preconditions

**Failure mode:** Missing runtimes or scripts invalidate the stage. A nonzero Sizer exit, missing staging output, failed legalization, or failed persistence leaves the stage incomplete; failed publication also removes partial published outputs.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="failure.sizer.runtime"></a>
## failure.sizer.runtime

**Failure mode:** The runner returns `Invalid` before subprocess execution when ECC, Sizer, or DreamPlace is unavailable, or when the generated Sizer env/cmd script paths do not exist.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="failure.sizer.command"></a>
## failure.sizer.command

**Failure mode:** The current wrapper resolves an executable named `Sizer` from PATH; an environment-root binary override is not part of this source contract.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="failure.sizer.staging"></a>
## failure.sizer.staging

**Failure mode:** A nonzero Sizer exit or absence of either staging DEF or staging Verilog marks `run sizer` incomplete and prevents legalization.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="failure.sizer.legalization"></a>
## failure.sizer.legalization

**Failure mode:** A missing DreamPlace legalizer or a failed legalize-only run prevents creation of the live ECC object required for publication.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="failure.sizer.publication"></a>
## failure.sizer.publication

**Failure mode:** Legalization must return a live ECC object before persistence. If legalization or shared `save_data` fails, the wrapper removes partial published outputs and does not report stage success.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="failure.sizer.terminal_evidence"></a>
## failure.sizer.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**
