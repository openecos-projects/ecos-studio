<a id="failure.route.preconditions"></a>
## failure.route.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Routing timing initialization is conditional on the configuration, so timing data must not be assumed from route completion alone.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.route.engine"></a>
## failure.route.engine

**Failure mode:** Without an ECC module, routing and conditional STA initialization do not run.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.route.conditional_sta"></a>
## failure.route.conditional_sta

**Failure mode:** A completed route does not prove timing-aware routing. Verify that the route configuration enabled timing and that STA initialization/artifacts exist before making that claim.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.route.terminal_evidence"></a>
## failure.route.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
