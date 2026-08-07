<a id="artifact.filler.outputs"></a>
## artifact.filler.outputs

**Meaning:** The filler output set contains saved DEF, Verilog, GDS, database, geometry snapshot, feature, QoR, and checklist artifacts when the shared persistence path succeeds.

**Calculation:** The shared `save_data` path serializes the current ECC database, writes the geometry snapshot for supported steps, and analysis then builds metrics, plots, and checklist records.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**
