<a id="failure.route.preconditions"></a>
## failure.route.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. iRT initialization, pin access, planar/layer/track/detailed routing, or violation reporting can fail while the wrapper still records progress; routing timing initialization is conditional, so timing data must not be assumed from route completion alone.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**

<a id="failure.route.engine"></a>
## failure.route.engine

**Failure mode:** Without an ECC module, routing and conditional STA initialization do not run.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**

<a id="failure.route.native_pipeline"></a>
## failure.route.native_pipeline

**Failure mode:** The wrapper invokes iRT initialization, pin access, supply analysis, planar routing, layer assignment, track assignment, detailed routing, and violation reporting without checking the native return value; inspect route features and logs for module failures.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**

<a id="failure.route.layer_range"></a>
## failure.route.layer_range

**Failure mode:** An invalid or empty configured bottom/top routing-layer range prevents a meaningful 3D route even if the wrapper records the run subflow.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**

<a id="failure.route.conditional_sta"></a>
## failure.route.conditional_sta

**Failure mode:** A completed route does not prove timing-aware routing. Verify that the route configuration enabled timing and that STA initialization/artifacts exist before making that claim.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**

<a id="failure.route.geometry"></a>
## failure.route.geometry

**Failure mode:** Shared persistence can fail while native route work completed; geometry manifest, database, and exported layout artifacts are required for a terminal route result.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**

<a id="failure.route.terminal_evidence"></a>
## failure.route.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**, **irt.planar_router**, **irt.layer_assigner**, **irt.track_assigner**, **irt.detailed_router**
