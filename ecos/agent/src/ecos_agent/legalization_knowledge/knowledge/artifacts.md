<a id="artifact.legalization.outputs"></a>
## artifact.legalization.outputs

**Meaning:** The legalization output set contains saved DEF, Verilog, GDS, database, geometry snapshot, feature, QoR, and checklist artifacts when the shared persistence path succeeds.

**Calculation:** The shared `save_data` path serializes the current ECC database, writes the geometry snapshot for supported steps, and analysis then builds metrics, plots, and checklist records.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**
