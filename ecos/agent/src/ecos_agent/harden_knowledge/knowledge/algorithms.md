<a id="algorithm.harden.execution"></a>
## algorithm.harden.execution

**Execution path:** The ECC runner loads the database, requires at least one configured STA signoff item, writes an abstract LEF, writes a timing-model LIB from the selected signoff inputs, exports hardened GDS, and then runs final package analysis.

**Source evidence:** **ecc.runner**, **ecc.module**
