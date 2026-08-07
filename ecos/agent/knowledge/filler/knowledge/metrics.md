<a id="metric.filler.database_summary"></a>
## metric.filler.database_summary

**Meaning:** The saved ECC database summary available to shared QoR analysis.

**Calculation:** After stage persistence, the shared metric builder may read `Design Layout` and `Design Statis` facts from the feature database to publish generic structural records.

**Boundary:** Legalization and filler currently publish no stage-specific numeric comparison metric; shared database facts are context, not a movement, legality, or filler-coverage result.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**

<a id="metric.filler.qor_availability"></a>
## metric.filler.qor_availability

**Meaning:** Whether this stage has publishable structured QoR records for the GUI.

**Calculation:** ECC writes `qor_metrics.json` only from finite numeric records with valid `feature/` sources, and the GUI accepts schema-v3 records with valid source metadata.

**Boundary:** An available QoR artifact proves only that its records passed the publication contract. Missing artifacts or filtered records must not be interpreted as zero-valued metrics or stage success.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**
