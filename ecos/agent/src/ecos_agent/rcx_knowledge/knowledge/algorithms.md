<a id="algorithm.rcx.execution"></a>
## algorithm.rcx.execution

**Execution path:** The ECC runner loads the design, initializes RCX with the workspace PDK, runs and destroys RCX, copies generated SPEF files to the declared output paths, saves the design, persists bounded SPEF feature facts, and runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.rcx.topology_construction"></a>
## algorithm.rcx.topology_construction

**Input and state:** RCX converts regular-net segments/vias and special-net segments/patches into `TopoPool` nodes and edges.

**Algorithm:** Each regular net builds local `TBTopo` nodes from segment/via endpoints and edges from the corresponding geometry, then normalizes local indexes into the global pool. Pin membership is tested against pin-layer shapes; unmatched points receive a small fallback shape, while special nets contribute special edges.

**Stop and output:** Parallel finite net traversal produces the regular node/edge pools and special-edge list used by extraction.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.topo**

<a id="algorithm.rcx.environment_overlap_model"></a>
## algorithm.rcx.environment_overlap_model

**Input and state:** `EnvBuilder` combines the topology pool with routing tracks and die geometry into track and pixel indexes.

**Algorithm:** For each non-via edge it queries adjacent-track overlap, merges intervals, then queries cross-layer pixel overlap and clips it to those intervals. Via edges retain placeholders to preserve index correspondence.

**Boundary:** The resulting `NetEnv` records local conductor surroundings; it is not yet a resistance or capacitance value.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.env**

<a id="algorithm.rcx.corner_effective_geometry"></a>
## algorithm.rcx.corner_effective_geometry

**Input and state:** Process-conductor tables, `NetEnv`, and topology edges are expanded into per-corner `NetEtchProfile` records.

**Algorithm:** For every corner/net/edge, RCX queries lower and upper adjacent spacing against etch tables and adjusts edge center and width over each interval. Via edges and missing process conductors are skipped.

**Stop and output:** The finite corner/net/edge traversal leaves effective geometry for electrical extraction rather than modifying routed geometry.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.var_processor**

<a id="algorithm.rcx.resistance_extraction"></a>
## algorithm.rcx.resistance_extraction

**Input and state:** Topology edges, corner process conductors/vias, and etch profiles feed per-corner `RCData` resistance lists.

**Algorithm:** Wire-edge overlap lengths are accumulated using resistivity or sheet resistance and a temperature factor; via resistance is obtained from via-shape area and process-via data. Invalid width/thickness or absent process records are skipped.

**Stop and output:** The extractor completes after all corner/net/edge records are handled and leaves per-corner resistance facts for SPEF writing.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.res_extractor**

<a id="algorithm.rcx.capacitance_and_spef"></a>
## algorithm.rcx.capacitance_and_spef

**Input and state:** Edge environment intervals, etch profiles, capacitance tables, coupling references, and topology nodes/edges form the capacitance model.

**Algorithm:** RCX splits cross-layer spans, selects above/below capacitance tables, interpolates by spacing, and emits ground or coupling capacitance. The SPEF writer assigns edge capacitance to nodes and writes `*CONN`, `*CAP`, and `*RES`, merging coupling entries.

**Boundary:** Via edges do not receive capacitance; missing conductor/table data is skipped. Completion means declared per-corner SPEFs have been written, not that every expected corner exists.

**Source evidence:** **ecc.runner**, **ecc.module**, **ircx.cap_extractor**, **ircx.spef_writer**
