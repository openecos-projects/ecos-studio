<a id="algorithm.fixfanout.execution"></a>
## algorithm.fixfanout.execution

**Execution path:** The ECC runner loads the current database, marks the configured clock net when present, invokes `run_net_opt`, saves the resulting design and geometry snapshot, and then produces metrics and checklist evidence.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.fixfanout.subflow"></a>
## algorithm.fixfanout.subflow

**Subflow order:** `load data -> set clock net -> run net optimization -> save data -> analysis`. Clock tagging is conditional on the workspace Clock parameter being non-empty; it is not inferred from a net name.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.fixfanout.fanout_source"></a>
## algorithm.fixfanout.fanout_source

**Result boundary:** Net optimization mutates the ECC database through `run_net_opt`. The reported maximum fanout is read from `Pins.max_fanout` in the saved feature database, falling back to the workspace parameter only when that fact is absent.

**Source evidence:** **ecc.runner**, **ecc.module**
