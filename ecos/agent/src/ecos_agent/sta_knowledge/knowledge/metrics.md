<a id="metric.sta_setup_wns"></a>
## metric.sta_setup_wns

**Meaning:** The worst setup slack across loaded STA corners.

**Calculation:** ECC selects the minimum `setup_wns` from all available corner QoR summaries and records the responsible corner.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.sta_setup_tns"></a>
## metric.sta_setup_tns

**Meaning:** The worst setup total negative slack across loaded STA corners.

**Calculation:** ECC selects the minimum `setup_tns` from all available corner QoR summaries and records the responsible corner.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.sta_hold_wns"></a>
## metric.sta_hold_wns

**Meaning:** The worst hold slack across loaded STA corners.

**Calculation:** ECC selects the minimum `hold_wns` from all available corner QoR summaries and records the responsible corner.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.sta_hold_tns"></a>
## metric.sta_hold_tns

**Meaning:** The worst hold total negative slack across loaded STA corners.

**Calculation:** ECC selects the minimum `hold_tns` from all available corner QoR summaries and records the responsible corner.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.sta_frequency_mhz"></a>
## metric.sta_frequency_mhz

**Meaning:** The lowest analyzed operating frequency across loaded STA corners.

**Calculation:** ECC selects the minimum corner `frequency_mhz`; missing configured corners remain recorded in STA coverage facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
