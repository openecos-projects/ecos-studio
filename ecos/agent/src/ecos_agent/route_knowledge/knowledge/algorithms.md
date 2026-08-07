<a id="algorithm.route.execution"></a>
## algorithm.route.execution

**Execution path:** The ECC runner loads the design, initializes STA first only when routing timing is enabled by the route configuration, invokes `run_routing`, saves the resulting design and geometry snapshot, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.route.timing_setup"></a>
## algorithm.route.timing_setup

**Conditional timing setup:** Before routing, the runner calls `is_rt_timing_enable(config)`. Only a true result releases any prior STA state and initializes STA with the workspace top module, Liberty files and SDC; otherwise routing proceeds without that timing initialization.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.route.subflow"></a>
## algorithm.route.subflow

**Subflow order:** `load data -> run routing -> save data -> analysis`. Route analysis publishes database wirelength/via facts and detailed-routing or layer-assignment feature facts only when their source records are available.

**Source evidence:** **ecc.runner**, **ecc.module**
