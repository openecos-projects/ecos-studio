<a id="artifact.harden.outputs"></a>
## artifact.harden.outputs

**Meaning:** The final Harden delivery package: abstract LEF, timing-model LIB, hardened GDS, and package-completeness metrics.

**Calculation:** The runner writes all three implementation artifacts from the selected signoff item before final analysis.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.harden.output_lef"></a>
## artifact.harden.output_lef

**Meaning:** The abstract LEF describing the hardened block for integration.

**Calculation:** `write_abstract_lef` serializes the abstract physical interface to `step.output.lef`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.harden.output_lib"></a>
## artifact.harden.output_lib

**Meaning:** The timing-model Liberty file for the hardened block.

**Calculation:** `write_timing_model` uses the selected signoff Liberty, SDC, and SPEF inputs to write `step.output.lib`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.harden.output_gds"></a>
## artifact.harden.output_gds

**Meaning:** The hardened GDS layout stream.

**Calculation:** The runner calls `gds_save(..., is_harden=True)` for `step.output.gds`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**

<a id="artifact.harden.package_metrics"></a>
## artifact.harden.package_metrics

**Meaning:** The package-completeness QoR record for the required GDS, LEF, and LIB outputs.

**Calculation:** The harden metric builder checks each declared path and sums absent artifacts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**, **ecc.metrics**
