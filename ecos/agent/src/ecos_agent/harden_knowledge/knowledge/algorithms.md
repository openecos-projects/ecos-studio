<a id="algorithm.harden.execution"></a>
## algorithm.harden.execution

**Execution path:** The ECC runner loads the database, requires at least one configured STA signoff item, writes an abstract LEF, writes a timing-model LIB from the selected signoff inputs, exports hardened GDS, and then runs final package analysis.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.harden.package_generation"></a>
## algorithm.harden.package_generation

**Package generation:** Harden takes the first resolved STA signoff item, writes an abstract LEF, derives a timing-model LIB from that item's Liberty/SDC/SPEF inputs, and exports GDS with `is_harden=True`. It does not call the common `save_data` path.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.harden.completion"></a>
## algorithm.harden.completion

**Completion gate:** Final analysis checks the existence of the generated GDS, LEF and LIB and publishes their missing-count. A completed harden subflow without this three-artifact package is not delivery completion.

**Source evidence:** **ecc.runner**, **ecc.module**
