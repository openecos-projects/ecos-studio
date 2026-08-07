<a id="artifact.synthesis.outputs"></a>
## artifact.synthesis.outputs

**Meaning:** The Synthesis output set contains saved DEF, Verilog, GDS, database, geometry snapshot, feature, QoR, and checklist artifacts when the shared persistence path succeeds.

**Calculation:** The shared `save_data` path serializes the current ECC database, writes the geometry snapshot for supported steps, and analysis then builds metrics, plots, and checklist records.

**Source evidence:** **yosys.runner**, **yosys.metrics**, **ecc.runner**, **ecc.runner**, **ecc.builder**
