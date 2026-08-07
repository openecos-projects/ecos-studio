<a id="metric.legalization.database_summary"></a>
## metric.legalization.database_summary

**Meaning:** The saved ECC database summary used by downstream analysis.

**Calculation:** The shared analysis path reads the stage feature database after persistence; it provides structural context but no stage-specific GUI comparison metric.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.legalization.qor_availability"></a>
## metric.legalization.qor_availability

**Meaning:** The availability state of the stage QoR artifacts.

**Calculation:** Metrics, summary, and hotspot payloads are written only when the shared metric builder finds valid source facts; absent artifacts remain unavailable.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
