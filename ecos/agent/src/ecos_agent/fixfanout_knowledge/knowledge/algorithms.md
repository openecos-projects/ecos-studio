<a id="algorithm.fixfanout.execution"></a>
## algorithm.fixfanout.execution

**Execution path:** The ECC runner loads the current database, marks the configured clock net when present, invokes `run_net_opt`, saves the resulting design and geometry snapshot, and then produces metrics and checklist evidence.

**Source evidence:** **ecc.runner**, **ecc.module**
