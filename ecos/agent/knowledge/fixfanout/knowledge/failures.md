<a id="failure.fixfanout.preconditions"></a>
## failure.fixfanout.preconditions

**Failure mode:** The step cannot execute when ECC input loading fails. The reported maximum fanout is evidence from the saved feature database or workspace parameter, not proof that every timing or electrical constraint is closed.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.fixfanout.engine"></a>
## failure.fixfanout.engine

**Failure mode:** If ECC input loading fails, the runner never calls `run_net_opt`; no subflow success state is evidence of a fanout fix.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.fixfanout.metric_fallback"></a>
## failure.fixfanout.metric_fallback

**Failure mode:** When `Pins.max_fanout` is absent, the metric builder falls back to the workspace parameter. Treat that fallback as a configured limit reference, not measured post-optimization fanout evidence.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.fixfanout.terminal_evidence"></a>
## failure.fixfanout.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
