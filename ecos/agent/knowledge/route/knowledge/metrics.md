<a id="metric.route_dr_total_patch_count"></a>
## metric.route_dr_total_patch_count

**Meaning:** The total detailed-routing patch count for the selected final detailed-routing iteration.

**Calculation:** The detailed router counts every patch rectangle while collecting layer totals; the metric builder obtains `total_patch_num` from `_latest_route_iteration(route.DR)`.

**Boundary:** The builder does not blindly read the last array item: it prefers the greatest numeric `iter`, while a later nonnumeric item becomes the selected record. It is not a DRC-violation count.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **irt.detailed_router**, **ecc.feature.tools**

<a id="metric.route_dr_total_via_count"></a>
## metric.route_dr_total_via_count

**Meaning:** The total detailed-routing via crossings for the selected final iteration.

**Calculation:** For each cross-layer routed segment, the detailed router counts each adjacent-layer crossing and emits `total_via_num`; the metric builder reads it from the selected DR iteration.

**Boundary:** It is iteration-scoped and differs from the aggregate database `route_via_count`; DR iteration selection follows `_latest_route_iteration(route.DR)`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **irt.detailed_router**, **ecc.feature.tools**

<a id="metric.route_dr_total_violation_count"></a>
## metric.route_dr_total_violation_count

**Meaning:** The total detailed-routing violation count for the selected final iteration.

**Calculation:** The detailed router traverses its route-violation list, increments per-layer counts and `total_violation_num`, then the metric builder reads that field from the selected DR iteration.

**Boundary:** It is the router's iteration result, not an independent iDRC signoff count; DR iteration selection follows `_latest_route_iteration(route.DR)`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **irt.detailed_router**, **ecc.feature.tools**

<a id="metric.route_dr_total_wirelength"></a>
## metric.route_dr_total_wirelength

**Meaning:** The detailed-routing wirelength for the selected final iteration, in micrometres.

**Calculation:** For same-layer routed segments, the detailed router adds Manhattan distance divided by `micron_dbu` to `total_wire_length`; the metric builder reads it from the selected DR iteration.

**Boundary:** It excludes cross-layer segment length and is distinct from the aggregate database wirelength; DR iteration selection follows `_latest_route_iteration(route.DR)`.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **irt.detailed_router**, **ecc.feature.tools**

<a id="metric.route_la_total_demand"></a>
## metric.route_la_total_demand

**Meaning:** The total layer-assignment routing demand across routing-edge grids.

**Calculation:** The layer assigner sums `routing_edge.get_demand()` for horizontal and vertical edges of every routing layer into `route.LA.total_demand`; the metric builder publishes that aggregate.

**Boundary:** It is a layer-assignment grid demand quantity, not detailed-route wirelength, physical utilization, or a DRC count.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **irt.layer_assigner**, **ecc.feature.tools**

<a id="metric.route_la_total_overflow"></a>
## metric.route_la_total_overflow

**Meaning:** The total layer-assignment routing overflow across routing-edge grids.

**Calculation:** The layer assigner sums `routing_edge.get_overflow()` for each routing layer into `route.LA.total_overflow`; the metric builder publishes that aggregate.

**Boundary:** It is an early routing-capacity excess, not the detailed router's violation count or a final signoff DRC result.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **irt.layer_assigner**, **ecc.feature.tools**

<a id="metric.route_via_count"></a>
## metric.route_via_count

**Meaning:** The total via count represented by the saved ECC database.

**Calculation:** The route metric builder reads `Nets.num_via` from the route database feature summary and publishes the finite count.

**Boundary:** This database count is distinct from detailed-router per-iteration via totals and does not isolate vias introduced by a particular route pass.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.route_wirelength"></a>
## metric.route_wirelength

**Meaning:** The total routed-net wirelength represented by the saved ECC database.

**Calculation:** The route metric builder reads `Nets.wire_len` from the route database feature summary and publishes the finite value.

**Boundary:** This database summary is distinct from detailed-router iteration wirelength and does not identify the iteration or layer contributions.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**
