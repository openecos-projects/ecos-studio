<a id="artifact.route.outputs"></a>
## artifact.route.outputs

**Meaning:** The route output set: current DEF, Verilog, GDS, database checkpoint, geometry snapshot, feature/QoR records, and analysis evidence.

**Calculation:** The runner updates the ECC database, calls shared persistence, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.output_def"></a>
## artifact.route.output_def

**Meaning:** The current physical DEF exported from the ECC database after this stage.

**Calculation:** `save_data` calls `def_save` after the stage tool has updated the in-memory database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.output_verilog"></a>
## artifact.route.output_verilog

**Meaning:** The current gate-level logical-netlist export from the ECC database.

**Calculation:** `save_data` calls `verilog_save`; it represents connectivity rather than placement or routing geometry.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.output_gds"></a>
## artifact.route.output_gds

**Meaning:** The current GDS physical-layout export from the ECC database.

**Calculation:** `save_data` calls `gds_save` after the stage tool updates the current physical state.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.output_db"></a>
## artifact.route.output_db

**Meaning:** The ECC database checkpoint used as an input to a following stage.

**Calculation:** `save_data` calls `save_data(path=step.output.db)` to serialize the reconstructible design state.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.geometry"></a>
## artifact.route.geometry

**Meaning:** The GUI geometry snapshot and manifest for the current stage state.

**Calculation:** For supported steps, shared persistence writes the geometry snapshot and requires its manifest to exist before returning success.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.feature_db"></a>
## artifact.route.feature_db

**Meaning:** The source-derived ECC design summary used by metric builders.

**Calculation:** Shared persistence calls `feature_sammry` to write the database feature JSON.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.feature_step"></a>
## artifact.route.feature_step

**Meaning:** The stage-specific ECC feature summary when the runner enables it.

**Calculation:** The shared persistence path invokes `feature_step(step=...)` and serializes the stage-specific feature summary.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.qor_metrics"></a>
## artifact.route.qor_metrics

**Meaning:** The structured per-metric QoR payload for the stage.

**Calculation:** Analysis calls the stage metric builder, normalizes valid source facts, and writes the QoR metric records.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.qor_summary"></a>
## artifact.route.qor_summary

**Meaning:** The stage quality-status summary and gate results.

**Calculation:** The QoR builder groups metric records, evaluates availability and quality gates, then writes the summary payload.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.route.qor_hotspots"></a>
## artifact.route.qor_hotspots

**Meaning:** The actionable QoR-hotspot subset for the stage.

**Calculation:** The QoR builder retains only recognized stage symptoms with source evidence and writes them as hotspot records.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**
