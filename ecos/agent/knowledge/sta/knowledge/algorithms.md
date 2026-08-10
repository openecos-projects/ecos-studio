<a id="algorithm.sta.execution"></a>
## algorithm.sta.execution

**Execution path:** The ECC runner expands configured STA signoff items into Liberty and RCX-corner combinations. For each item it requires the SDC, SPEF, and Liberty files, runs timing into corner-specific report and feature directories, saves the design, and then builds multi-corner analysis and checklist evidence.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.sta.signoff_matrix_expansion"></a>
## algorithm.sta.signoff_matrix_expansion

**Input and state:** `collect_sta_signoff_items()` expands the STA configuration's Liberty corners and their listed RCX corners into records containing corner name, temperature, Liberty files, and SPEF path.

**Algorithm:** It constructs the complete Cartesian-like configured signoff list before timing runs. Every requested Liberty corner must resolve; missing configuration is an incomplete-analysis condition rather than a silently dropped corner.

**Output:** The matrix preserves the intended multi-corner coverage used by later aggregation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.sta.native_setup_and_graph_build"></a>
## algorithm.sta.native_setup_and_graph_build

**Input and state:** For each item, the wrapper validates report/feature destinations, clears old outputs, loads Liberty/SDC/SPEF, and initializes native STA with the requested corner and path limit.

**Algorithm:** `GraphBuilder` builds timing points, cell arcs, net driver/load relations, net arcs, start/end points, and a topological timing order. Native execution then proceeds through clock, timing, and power propagation before reporting.

**Failure boundary:** Required SDC, SPEF, Liberty, or output directories are validated before a corner is considered analyzed.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.graph_builder**

<a id="algorithm.sta.timing_propagation"></a>
## algorithm.sta.timing_propagation

**Input and state:** The graph's topological timing order, arcs, cell delays, net parasitics, and clock state define propagation.

**Algorithm:** `TimingPropagator` traverses timing order, propagating slew, delay, arrival, and path state while skipping disabled arcs and sequential clock sinks. Clock propagation establishes timing references before data propagation.

**Stop and output:** The finite graph order determines completion; propagated state becomes the input to required-time and violation analysis.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.propagator**

<a id="algorithm.sta.required_time_and_qor_analysis"></a>
## algorithm.sta.required_time_and_qor_analysis

**Algorithm:** `TimingAnalyzer` works from endpoints backward to derive required timing, groups timing paths, and updates WNS, TNS, and violation counts. ECOS then selects the minimum setup/hold WNS/TNS and minimum frequency across available corners while retaining coverage facts.

**Boundary:** A worst-corner aggregate is derived only from loaded results. It must preserve missing configured corners instead of treating them as zero slack or successful signoff.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.analyzer**
