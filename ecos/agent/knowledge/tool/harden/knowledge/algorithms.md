<a id="algorithm.harden.execution"></a>
## algorithm.harden.execution

**Execution path:** The ECC runner loads the database, requires at least one configured STA signoff item, writes an abstract LEF, writes a timing-model LIB from the selected signoff inputs, exports hardened GDS, and then runs final package analysis. Native writer return values are not wrapper gates; the runner marks the harden subflow successful and relies on package analysis to expose missing outputs.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.harden.delivery_input_selection"></a>
## algorithm.harden.delivery_input_selection

**Input and state:** Harden resolves the STA signoff matrix and deliberately selects its first item, which supplies Liberty, SDC, and SPEF inputs for the timing-model extraction.

**Algorithm:** It emits abstract LEF, timing-model LIB, and hardened GDS in that order. An empty signoff matrix terminates before any package artifact is generated.

**Boundary:** This is a deterministic packaging choice, not multi-corner model merging; the selected first item must remain visible in provenance.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.harden.abstract_lef_generation"></a>
## algorithm.harden.abstract_lef_generation

**Input and state:** The current in-memory iDB design and declared LEF output path are passed through the Python binding to native `saveLef()`.

**Algorithm:** The native database writer serializes the block's LEF macro abstraction from the current physical database. There is no placement or routing optimization in this export.

**Stop and output:** Native writer success yields the abstract LEF; package completion still requires the separate LIB and GDS artifacts.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.python**

<a id="algorithm.harden.timing_model_characterization"></a>
## algorithm.harden.timing_model_characterization

**Input and state:** The selected Liberty, SDC, SPEF, STA configuration, design name, and output directory initialize native STA for timing-model extraction.

**Algorithm:** `extractLib()` builds and propagates the timing graph, analyzes timing, then `TimingCharacterizer::characterize()` writes the derived model. The wrapper locates the generated analysis-mode LIB and copies it to the Harden output.

**Failure boundary:** Missing or ambiguous generated source LIB raises an error; an empty generated model receives only the implementation's minimal fallback library shell.

**Source evidence:** **ecc.runner**, **ecc.module**, **ista.interface**, **ista.characterizer**

<a id="algorithm.harden.hardened_gds_export"></a>
## algorithm.harden.hardened_gds_export

**Input and state:** The current DEF/iDB layout and declared GDS path are passed to `gds_save(..., is_harden=True)`.

**Algorithm:** The native builder initializes the DEF writer, constructs `Def2GdsWrite`, and selects `writeHardenedDb()` rather than the ordinary `writeDb()` path.

**Stop and output:** Writer initialization failure returns false; successful GDS export alone is insufficient because delivery completion also checks the LEF and LIB package members.

**Source evidence:** **ecc.runner**, **ecc.module**, **idb.builder**
