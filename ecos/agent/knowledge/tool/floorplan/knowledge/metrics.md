<a id="metric.die_area"></a>
## metric.die_area

**Meaning:** The current physical die area in square micrometres.

**Calculation:** The feature parser writes `Design Layout.die_area`; the metric builder converts it to a finite number and publishes `round(value, 3)`.

**Boundary:** It is a database geometry fact at this step, not cell area and not evidence that utilization or DRC constraints pass.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.core_area"></a>
## metric.core_area

**Meaning:** The current usable core area in square micrometres.

**Calculation:** The feature parser writes `Design Layout.core_area`; the metric builder publishes the finite value rounded to three decimals.

**Boundary:** It describes the saved core rectangle, not the free placement area after macro halos, blockages, or routing reservations.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.core_utilization"></a>
## metric.core_utilization

**Meaning:** The feature database's current core-usage ratio.

**Calculation:** The parser publishes `Design Layout.core_usage`, and the metric builder normalizes its finite numeric value before publication.

**Boundary:** It is the tool's summary ratio, not a proof of legal placement, density closure, or available routing capacity.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.instance_count"></a>
## metric.instance_count

**Meaning:** The number of instances in the saved physical database.

**Calculation:** The parser writes `Design Statis.num_instances`; the stage metric builder publishes that finite count after the stage mutation is saved.

**Boundary:** This includes whatever the current database represents at that stage and is not limited to movable standard cells.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**

<a id="metric.net_count"></a>
## metric.net_count

**Meaning:** The number of nets in the saved physical database.

**Calculation:** The parser writes `Design Statis.num_nets`; the metric builder publishes that finite count after persistence.

**Boundary:** It is a database connectivity count, not a count of routed nets, timing paths, or DRC violations.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**
