<a id="artifact.rcx.outputs"></a>
## artifact.rcx.outputs

**Meaning:** The RCX output set contains extracted SPEF files plus the shared saved design, geometry, feature, QoR, and checklist artifacts.

**Calculation:** After RCX finishes, the runner copies SPEFs from its writer directory to declared outputs, saves the ECC design, and persists SPEF feature facts before analysis.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.runner**, **ecc.builder**
