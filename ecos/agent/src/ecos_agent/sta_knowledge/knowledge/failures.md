<a id="failure.sta.preconditions"></a>
## failure.sta.preconditions

**Failure mode:** No signoff items, a missing SDC, SPEF, Liberty file, or report/feature directory terminates STA as incomplete. The stage does not synthesize missing corners, and its aggregate results must preserve that coverage state.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.sta.missing_sdc"></a>
## failure.sta.missing_sdc

**Failure mode:** STA marks its subflow incomplete and returns false when the workspace SDC path does not exist.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.sta.missing_corner_input"></a>
## failure.sta.missing_corner_input

**Failure mode:** For every signoff item, a missing SPEF or any missing Liberty file marks STA incomplete before timing is run. The aggregate must preserve that incomplete coverage.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.sta.terminal_evidence"></a>
## failure.sta.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
