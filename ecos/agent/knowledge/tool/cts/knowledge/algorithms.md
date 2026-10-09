<a id="algorithm.cts.execution"></a>
## algorithm.cts.execution

**Execution path:** The ECC runner loads the design, invokes `run_cts` for clock-tree synthesis with the CTS configuration and step data directory, writes a CTS report and map, saves the design, persists clock-timing feature facts, and then runs analysis and checklist generation. The wrapper does not branch on the native `run_cts`, report, or map return values; timing-fact persistence and shared save-data results are the explicit gates it checks.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.cts.flow_pipeline"></a>
## algorithm.cts.flow_pipeline

**Input and state:** `CTSAPI::runCTS()` initializes a CTS data manager, design, clock layout, and QoR summary from the CTS configuration and work directory.

**Algorithm:** It executes the native pipeline `Synthesis -> Optimization -> Instantiation -> Evaluation` on shared clock-layout state. A not-initialized flow, an internal-stage failure, or an all-clock no-op produces an explicit native status.

**Output boundary:** Key results include buffer count/area, clock-path buffer range, wirelength, and clock-tree level; they are facts of the constructed clock implementation, not final post-route signoff.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.api**

<a id="algorithm.cts.clock_domain_synthesis"></a>
## algorithm.cts.clock_domain_synthesis

**Input and state:** `Synthesis::run()` iterates design clocks and separates each clock's hard-macro sinks from regular sinks into domain contexts with shared characterization data.

**Algorithm:** Every usable clock source, source net, and sink domain is prepared before `Topology::formClock()` commits a clock topology. Missing clock/source/net/sink/DBU data causes that clock to be skipped or failed; if all clocks are skipped, synthesis is a no-op.

**Output:** The CTS database records inserted buffers/nets, selected H-tree depth/levels, and per-domain status.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.synthesis**

<a id="algorithm.cts.htree_topology_search"></a>
## algorithm.cts.htree_topology_search

**Input and state:** H-tree synthesis receives root-net loads, buffer characterization, boundary constraints, fanout/cap/slew limits, and candidate level plans.

**Algorithm:** It generates a topology, characterizes it, builds level plans, enumerates allowable depths, and evaluates the candidate frontier. Per sink domain, a direct connection is used for fewer than two sinks; otherwise the selected tree is committed before a source-to-root trunk is built.

**Stop:** A feasible candidate is finalized; absent feasible characterization or a failed domain/trunk resets that clock topology rather than claiming a clock tree.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.topology**, **icts.htree**

<a id="algorithm.cts.rc_tree_sizing_optimization"></a>
## algorithm.cts.rc_tree_sizing_optimization

**Input and state:** The router constructs route trees and RC trees for clock DAG nets, then FastSTA supplies resizable-buffer and timing context.

**Algorithm:** Optimization chooses scalable or ordinary sizing solvers, evaluates batch trial master-cell edits, and accepts edits that improve the target objective over skew, capacitance/slew violations, area, and power.

**Stop and output:** No resizable buffer or no accepted candidate is a no-op. Accepted sizing edits are committed into the clock layout and design database.

**Source evidence:** **ecc.runner**, **ecc.module**, **icts.router**, **icts.optimization**
