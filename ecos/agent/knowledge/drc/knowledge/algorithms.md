<a id="algorithm.drc.execution"></a>
## algorithm.drc.execution

**Execution path:** The ECC runner loads the design, initializes the DRC engine in the step data directory, invokes `run_drc` with the configured report path, saves the design, persists DRC feature data, and then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.drc.shape_collection"></a>
## algorithm.drc.shape_collection

**Input and state:** DRC reads iDB layout, instances, pins, IO pins, blockages, regular nets, and special nets into environment and result `ids::Shape` collections.

**Algorithm:** Environment collection includes instance OBS/pins/vias, IO pins, and routing blockages; result collection converts routed segments, vias, and rectangles. Unplaced instances and nets without valid multi-terminal connectivity are skipped, while blockage polygons subtract pin shapes before max-rectangle decomposition.

**Stop and output:** Finite design-container traversal returns the shape vectors supplied to rule validation.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.interface**

<a id="algorithm.drc.cluster_partitioning"></a>
## algorithm.drc.cluster_partitioning

**Input and state:** `RuleValidator` receives environment/result shapes, enabled check types, and optional check regions in an `RVModel`.

**Algorithm:** It derives cluster and expansion sizes from the routing pitch, grids the effective bounding box, and inserts each expanded shape reference into overlapping `RVCluster` cells.

**Constraint and stop:** Negative result-net indices are errors. Partitioning ends after every shape is assigned to its covering clusters.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.validator**

<a id="algorithm.drc.geometric_rule_dispatch"></a>
## algorithm.drc.geometric_rule_dispatch

**Input and state:** Each cluster builds per-layer polygon sets, maximum rectangles, boundary data, and rectangle/boundary/cut R-trees.

**Algorithm:** Clusters run in parallel when they contain relevant result shapes. The validator dispatches only enabled and existing rule types, querying those indexes against rule-specific geometry.

**Boundary:** Spatial partitioning controls work locality; it does not omit violations outside a cluster because expanded shape coverage is included before checking.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.validator**

<a id="algorithm.drc.violation_generation_and_merge"></a>
## algorithm.drc.violation_generation_and_merge

**Algorithm:** Representative checks detect different-net routing-rectangle overlap for metal shorts, insufficient polygon span for minimum width, and nearby cuts using same-net/PRL/spacing rules. Each records a typed violation with required geometry.

**Stop and output:** Cluster post-processing keeps only violations overlapping the cluster region, then sorts and deduplicates. The global list is sorted/uniqued before it is exported as reports and feature facts; an absent feature file must not be interpreted as an empty violation list.

**Source evidence:** **ecc.runner**, **ecc.module**, **idrc.metal_short**, **idrc.minimum_width**, **idrc.cut_spacing**, **idrc.validator**
