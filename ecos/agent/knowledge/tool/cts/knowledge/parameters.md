<a id="parameter.cts.buffer_type"></a>
## parameter.cts.buffer_type

**Meaning:** The buffer cell types eligible for CTS insertion.

**Role:** It limits the implementation choices available to the clock-tree builder.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.cap_steps"></a>
## parameter.cts.cap_steps

**Meaning:** The number of capacitance optimization steps.

**Role:** It bounds CTS effort applied to capacitance repair.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.max_buf_tran"></a>
## parameter.cts.max_buf_tran

**Meaning:** The maximum transition allowed at clock-buffer outputs.

**Role:** It constrains inserted-buffer electrical behavior during CTS.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.max_cap"></a>
## parameter.cts.max_cap

**Meaning:** The maximum allowed clock-net capacitance.

**Role:** It bounds clock-tree loading during buffering and routing.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.max_fanout"></a>
## parameter.cts.max_fanout

**Meaning:** The maximum allowed clock-buffer fanout.

**Role:** It limits how many sinks an inserted buffer may drive.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.max_length"></a>
## parameter.cts.max_length

**Meaning:** The maximum permitted clock-wire segment length.

**Role:** It encourages buffering or topology changes for long clock connections.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.max_sink_tran"></a>
## parameter.cts.max_sink_tran

**Meaning:** The maximum transition allowed at clock sinks.

**Role:** It constrains the delivered clock waveform at sink pins.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.net_list"></a>
## parameter.cts.net_list

**Meaning:** The explicit clock-net list.

**Role:** It identifies the nets that CTS should synthesize when explicit selection is enabled.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.root_input_slew"></a>
## parameter.cts.root_input_slew

**Meaning:** The transition assumed at a clock-tree root.

**Role:** It seeds CTS timing propagation from the source clock pin.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.routing_layer"></a>
## parameter.cts.routing_layer

**Meaning:** The routing layers available to CTS.

**Role:** It constrains clock-tree routing to the selected layer set.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.skew_bound"></a>
## parameter.cts.skew_bound

**Meaning:** The target upper bound for clock skew.

**Role:** It directs CTS optimization and is compared against derived clock-quality facts.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.slew_steps"></a>
## parameter.cts.slew_steps

**Meaning:** The number of transition optimization steps.

**Role:** It bounds CTS effort applied to transition repair.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.use_netlist"></a>
## parameter.cts.use_netlist

**Meaning:** The switch selecting a supplied clock-net list.

**Role:** When enabled, CTS uses `net_list` rather than discovering clock nets from the database.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**

<a id="parameter.cts.wirelength_iterations"></a>
## parameter.cts.wirelength_iterations

**Meaning:** The number of clock-wirelength optimization iterations.

**Role:** It bounds repeated CTS wirelength improvement passes.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.cts**
