<a id="failure.sta.preconditions"></a>
## failure.sta.preconditions

**Failure mode:** No signoff items, a missing SDC, SPEF, Liberty file, or report/feature directory terminates STA as incomplete. The stage does not synthesize missing corners, and its aggregate results must preserve that coverage state.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.signoff"></a>
## failure.sta.signoff

**Failure mode:** STA returns incomplete when no Liberty/RCX signoff item resolves or the workspace STA configuration path is unavailable.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.missing_sdc"></a>
## failure.sta.missing_sdc

**Failure mode:** STA marks its subflow incomplete and returns false when the workspace SDC path does not exist.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.missing_corner_input"></a>
## failure.sta.missing_corner_input

**Failure mode:** For every signoff item, a missing SPEF or any missing Liberty file marks STA incomplete before timing is run. The aggregate must preserve that incomplete coverage.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.artifact_dirs"></a>
## failure.sta.artifact_dirs

**Failure mode:** A signoff item is incomplete when its report or structured-feature destination cannot be resolved; no corner result should be synthesized from absent output directories.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.timing_run"></a>
## failure.sta.timing_run

**Failure mode:** Exceptions from native timing setup, graph construction, propagation, or reporting terminate the STA run; they must not be converted to zero WNS/TNS.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.coverage"></a>
## failure.sta.coverage

**Failure mode:** The worst-corner aggregate must preserve missing or failed configured corners and cannot claim signoff from only a subset of the requested matrix.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**

<a id="failure.sta.terminal_evidence"></a>
## failure.sta.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**, **ista.propagator**, **ista.analyzer**
