<a id="algorithm.fixfanout.execution"></a>
## algorithm.fixfanout.execution

**Execution path:** The ECC runner loads the current database, marks the configured clock net when present, invokes `run_net_opt`, saves the resulting design and geometry snapshot, and then produces metrics and checklist evidence.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.fixfanout.model_initialization"></a>
## algorithm.fixfanout.model_initialization

**Input and state:** The JSON adapter maps `insert_buffer` and `max_fanout` into iZH configuration, then `FanoutFixer::initFFModel()` creates an `FFModel` with buffer master, fanout limit, and insertion counters.

**Constraint:** A non-positive maximum fanout is rejected before repair. The model is a structural netlist-editing state, not a placement legalization model.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.config**, **izh.fanout**

<a id="algorithm.fixfanout.violating_net_scan"></a>
## algorithm.fixfanout.violating_net_scan

**Input and state:** The live iDB design net list and the `FFModel.max_fanout` limit are scanned each repair round.

**Algorithm:** `FanoutFixer::fix()` skips clock nets and collects every non-clock net whose load-pin count exceeds the limit. This is a full net-list scan per round rather than a timing-driven priority queue.

**Stop:** The repair loop terminates when the candidate set is empty.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.fanout**

<a id="algorithm.fixfanout.buffer_tree_construction"></a>
## algorithm.fixfanout.buffer_tree_construction

**Input and state:** For each violating net, its load pins are detached and partitioned into chunks of at most `max_fanout`.

**Algorithm:** Each chunk receives a `zh_fanout_net_*` and `zh_fanout_buf_*`: the buffer input reconnects to the original net, its output drives the new net, and the chunk's load pins move to that new net. Power and ground pins are skipped.

**Boundary:** New buffers begin unplaced at `(0, 0)`, so this repair changes connectivity and requires a later physical implementation stage for legal placement.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.fanout**

<a id="algorithm.fixfanout.hierarchical_convergence"></a>
## algorithm.fixfanout.hierarchical_convergence

**Algorithm:** If the original net still drives too many inserted buffer inputs after one grouping round, it is selected again. Repeated partitioning therefore constructs a multi-level buffer tree.

**Stop and output:** Convergence means every non-clock net has at most the configured number of load pins. The model records fixed-net, inserted-net, and inserted-buffer counts; ECOS persistence then exports the modified logical and physical database state.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.fanout**
