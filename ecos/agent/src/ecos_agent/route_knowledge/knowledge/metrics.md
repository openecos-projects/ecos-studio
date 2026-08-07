<a id="metric.route_dr_total_patch_count"></a>
## metric.route_dr_total_patch_count

**Meaning:** The total detailed-routing patch count.

**Calculation:** The QoR record is selected from the route step feature's detailed-routing `route.DR` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_dr_total_via_count"></a>
## metric.route_dr_total_via_count

**Meaning:** The total detailed-routing via count.

**Calculation:** The QoR record is selected from the route step feature's detailed-routing `route.DR` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_dr_total_violation_count"></a>
## metric.route_dr_total_violation_count

**Meaning:** The total detailed-routing violation count.

**Calculation:** The QoR record is selected from the route step feature's detailed-routing `route.DR` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_dr_total_wirelength"></a>
## metric.route_dr_total_wirelength

**Meaning:** The total detailed-routing wirelength.

**Calculation:** The QoR record is selected from the route step feature's detailed-routing `route.DR` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_la_total_demand"></a>
## metric.route_la_total_demand

**Meaning:** The total layer-assignment routing demand.

**Calculation:** The QoR record is selected from the route step feature's layer-assignment `route.LA` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_la_total_overflow"></a>
## metric.route_la_total_overflow

**Meaning:** The total layer-assignment routing overflow.

**Calculation:** The QoR record is selected from the route step feature's layer-assignment `route.LA` facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_via_count"></a>
## metric.route_via_count

**Meaning:** The total via count represented in the ECC database.

**Calculation:** ECC reads `Nets.num_via` from the saved database feature summary.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.route_wirelength"></a>
## metric.route_wirelength

**Meaning:** The total routed-net wirelength represented in the ECC database.

**Calculation:** ECC reads `Nets.wire_len` from the saved database feature summary.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
