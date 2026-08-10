<a id="metric.fanout_max"></a>
## metric.fanout_max

**Meaning:** The fanout threshold field exposed by the post-fixFanout feature database.

**Calculation:** The metric builder first reads `Pins.max_fanout`; only when it is absent does it fall back to the workspace `Max fanout` parameter. The native feature builder initializes this field to 32 and bins pin fanout as `0..32` and `>32`.

**Boundary:** Despite its name, this path does not rescan every final net to prove an observed maximum fanout; interpret it as the published threshold or fallback reference.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**, **gui.qor_trend**, **gui.qor_data**, **ecc.feature.summary**, **ecc.feature.builder**, **izh.fanout**

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
