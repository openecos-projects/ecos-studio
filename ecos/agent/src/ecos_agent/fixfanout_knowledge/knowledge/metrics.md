<a id="metric.fanout_max"></a>
## metric.fanout_max

**Meaning:** The maximum observed pin fanout after net optimization.

**Calculation:** ECC uses `Pins.max_fanout` from the feature database; only when it is absent does the metric builder use the workspace Max fanout parameter as a fallback.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.instance_count"></a>
## metric.instance_count

**Meaning:** The current number of design instances.

**Calculation:** ECC reads `Design Statis.num_instances` from the saved database feature summary after the stage has mutated the database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.net_count"></a>
## metric.net_count

**Meaning:** The current number of design nets.

**Calculation:** ECC reads `Design Statis.num_nets` from the saved database feature summary after the stage has mutated the database.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**
