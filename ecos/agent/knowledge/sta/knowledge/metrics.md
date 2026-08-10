<a id="metric.sta_setup_wns"></a>
## metric.sta_setup_wns

**Meaning:** The worst setup worst negative slack across parseable STA corners, in nanoseconds.

**Calculation:** ECC reads each corner `/summary/setup/wns`, selects the numerical minimum, and records the responsible corner in the signoff facts.

**Boundary:** Worst means the smallest number, not the greatest absolute magnitude. Missing or unparseable corners do not enter the aggregate and instead reduce coverage.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**

<a id="metric.sta_setup_tns"></a>
## metric.sta_setup_tns

**Meaning:** The worst setup total negative slack across parseable STA corners, in nanoseconds.

**Calculation:** ECC reads each corner `/summary/setup/tns` and publishes the numerical minimum over available summaries.

**Boundary:** Missing or unparseable corners do not contribute a zero TNS; their absence is captured only by STA coverage facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**

<a id="metric.sta_hold_wns"></a>
## metric.sta_hold_wns

**Meaning:** The worst hold worst negative slack across parseable STA corners, in nanoseconds.

**Calculation:** ECC reads each corner `/summary/hold/wns` and publishes the numerical minimum over available summaries.

**Boundary:** This is an aggregate of available corner reports, not a replacement for checking whether every configured Liberty/RCX corner completed.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**

<a id="metric.sta_hold_tns"></a>
## metric.sta_hold_tns

**Meaning:** The worst hold total negative slack across parseable STA corners, in nanoseconds.

**Calculation:** ECC reads each corner `/summary/hold/tns` and publishes the numerical minimum over available summaries.

**Boundary:** Missing or unparseable corners do not enter the minimum; they must be evaluated through the separate coverage and gate evidence.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**

<a id="metric.sta_frequency_mhz"></a>
## metric.sta_frequency_mhz

**Meaning:** The lowest valid analyzed setup frequency across parseable STA corners, in MHz.

**Calculation:** ECC reads `/summary/setup/frequency_mhz` from each available corner and publishes the numerical minimum after rejecting nonpositive values.

**Boundary:** It does not derive a clock frequency from WNS, and incomplete corner coverage remains a separate signoff limitation.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.sta_qor**
