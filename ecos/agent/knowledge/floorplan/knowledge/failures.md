<a id="failure.floorplan.preconditions"></a>
## failure.floorplan.preconditions

**Failure mode:** The step cannot proceed without an ECC database instance. Its subflow status is progress evidence only; inspect saved artifacts and analysis records before claiming a successful floorplan.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.floorplan.engine"></a>
## failure.floorplan.engine

**Failure mode:** If `get_eda_instance` returns no ECC module, the floorplan runner does not enter `init_fp` or `run_fp` and returns false.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.floorplan.geometry"></a>
## failure.floorplan.geometry

**Failure mode:** For floorplan, shared persistence requires `geometry_snapshot_save` and an existing geometry manifest. Either failure causes `save_data` to return false.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="failure.floorplan.terminal_evidence"></a>
## failure.floorplan.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**
