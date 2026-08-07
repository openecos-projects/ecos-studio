<a id="artifact.harden.outputs"></a>
## artifact.harden.outputs

**Meaning:** The Harden output package contains an abstract LEF, timing-model LIB, and hardened GDS.

**Calculation:** The runner writes the LEF and LIB from the selected signoff inputs and exports GDS with the harden flag before final analysis checks package completeness.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**
