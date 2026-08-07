<a id="metric.die_area"></a>
## metric.die_area

**Meaning:** The physical die area in square micrometers.

**Calculation:** ECC reads `Design Layout.die_area` from the saved database feature summary and rounds the displayed value to three decimals.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.core_area"></a>
## metric.core_area

**Meaning:** The physical core area in square micrometers.

**Calculation:** ECC reads `Design Layout.core_area` from the saved database feature summary and rounds the displayed value to three decimals.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.metrics**, **gui.step_metrics**

<a id="metric.core_utilization"></a>
## metric.core_utilization

**Meaning:** The fraction of usable core area occupied by the design.

**Calculation:** ECC maps `Design Layout.core_usage` into the normalized core-utilization metric; availability follows the saved database feature summary.

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
