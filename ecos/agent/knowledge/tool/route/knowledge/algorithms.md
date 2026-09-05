<a id="algorithm.route.execution"></a>
## algorithm.route.execution

**Execution path:** The ECC runner loads the design, initializes STA first only when routing timing is enabled by the route configuration, invokes the iRT pipeline, saves the resulting design and geometry snapshot, then runs analysis and checklist generation. The wrapper marks the routing subflow successful without inspecting the native routing return value.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.route.routing_pipeline"></a>
## algorithm.route.routing_pipeline

**Input and state:** `RTInterface::runRT()` runs on the shared RT database created by `init_rt`, containing routing graph, net list, technology rules, and configuration.

**Algorithm:** The native schedule is `PinAccessor -> SupplyAnalyzer -> PlanarRouter -> LayerAssigner -> TrackAssigner -> DetailedRouter -> ViolationReporter`. Each module consumes and updates shared global/detailed route maps before `destroy_rt` writes results and releases data.

**Boundary:** This sequence is the internal iRT router, not the ECOS runner's later persistence or GUI analysis.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.interface**

<a id="algorithm.route.planar_global_routing"></a>
## algorithm.route.planar_global_routing

**Input and state:** `PlanarRouter` builds `PRModel` nets, pins, planar routing-edge maps, and planar topologies from iRT data.

**Algorithm:** It initializes with L/Z patterns, runs congestion-aware L/Z and overflow all-pattern routing, then rip-up/reroutes overflow nets with A* for at most five iterations. Candidate cost combines wirelength, edge cost, and corner cost; edge penalties use supply/demand, overflow, saturation, and hotspot terms.

**Stop and output:** The router stops when no overflow nets remain or the iteration bound is exhausted, then writes `net_global_result_map` and rebuilds spatial indexes.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.planar_router**

<a id="algorithm.route.layer_assignment"></a>
## algorithm.route.layer_assignment

**Input and state:** `LayerAssigner` converts planar results into `LAModel` pillar trees with candidate routing layers, per-layer edge supply, and direction constraints.

**Algorithm:** It performs bottom-up dynamic programming over subtree layer candidates, then top-down assignment fixes child layers. The cost combines required via span and segment overflow; routing layers are limited by the configured bottom/top range and preferred direction.

**Stop and output:** Overflow segments trigger a planar-tree split and one rebuild. The result is a 3D routing tree and updated global-route map.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.layer_assigner**

<a id="algorithm.route.track_assignment"></a>
## algorithm.route.track_assignment

**Input and state:** `TrackAssigner` partitions `TAModel` into layer panels containing track axes, nodes, neighbors, tasks, and R-tree environment.

**Algorithm:** Scheduled panels are processed in parallel. Each task uses an open-queue search bounded by its task box; cost includes fixed/routed rectangles, violation penalty, and preferred-wire, via, and estimated-to-end terms.

**Stop and output:** A task stops when all end groups connect. Panel results update detailed-route and patch maps for detailed routing.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.track_assigner**

<a id="algorithm.route.detailed_routing_and_patch"></a>
## algorithm.route.detailed_routing_and_patch

**Input and state:** `DetailedRouter` uses `DRModel`, scheduled `DRBox` regions, `DRTask` routing groups, guide penalties, and route-violation state.

**Algorithm:** Nine detailed-routing iteration parameter sets repeatedly route dirty boxes in parallel, reroute net schedules, and use multi-source A* to connect task endpoint groups. Costs include preferred/non-preferred wire, bend, via, guide, fixed/routed-shape, and violation penalties. DRC-driven patch tasks search candidate patches and retain the best result.

**Stop and output:** `stopIteration()` or exhaustion selects the best result, then updates detailed segments, patches, and violations. A completed router is not equivalent to zero remaining DRC violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **irt.detailed_router**
