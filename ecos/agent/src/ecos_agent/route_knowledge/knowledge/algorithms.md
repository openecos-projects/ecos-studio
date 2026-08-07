<a id="algorithm.route.execution"></a>
## algorithm.route.execution

**Execution path:** The ECC runner loads the design, initializes STA first only when routing timing is enabled by the route configuration, invokes `run_routing`, saves the resulting design and geometry snapshot, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**
