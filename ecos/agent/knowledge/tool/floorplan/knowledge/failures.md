<a id="failure.floorplan.preconditions"></a>
## failure.floorplan.preconditions

**Failure mode:** The step cannot proceed without an ECC database instance. iFP can log configuration, layer/capacity, macro-placement, or geometry errors while the wrapper still records subflow progress; inspect native logs, saved artifacts, and analysis records before claiming a successful floorplan.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.engine"></a>
## failure.floorplan.engine

**Failure mode:** If `get_eda_instance` returns no ECC module, the floorplan runner does not enter `init_fp` or `run_fp` and returns false.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.config"></a>
## failure.floorplan.config

**Failure mode:** iFP reads the configured JSON during `wrapConfig`; an unreadable or structurally invalid file prevents reliable initialization. The runner does not convert a failed native initialization into a valid floorplan.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.io_layers"></a>
## failure.floorplan.io_layers

**Failure mode:** IO placement returns without changing pins when no configured layer resolves to one usable horizontal and one usable vertical routing layer, or when a selected layer has non-positive width or track pitch.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.io_capacity"></a>
## failure.floorplan.io_capacity

**Failure mode:** When legal edge slots at one-pitch spacing cannot hold every IO pin, IOPlacer emits a native error and leaves the pin assignment incomplete.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.macro_placement"></a>
## failure.floorplan.macro_placement

**Failure mode:** MacroPlacer logs an error for every unplaced block macro and does not relocate it; only already placed macros receive halos and participate in row cutting.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.macro_core"></a>
## failure.floorplan.macro_core

**Failure mode:** MacroPlacer logs an error when a placed macro bounding box is not fully contained by the core. The check is diagnostic; it is not a relocation or repair algorithm.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.native_progress"></a>
## failure.floorplan.native_progress

**Failure mode:** `run_floorplan` marks init, tracks, IO pins, taps, PDN, and clock-net subflow entries successful without inspecting iFP native returns. Native logs and output artifacts are required to determine the actual result.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.geometry"></a>
## failure.floorplan.geometry

**Failure mode:** For floorplan, shared persistence requires `geometry_snapshot_save` and an existing geometry manifest. Either failure causes `save_data` to return false.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**

<a id="failure.floorplan.terminal_evidence"></a>
## failure.floorplan.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **ecc.workspace**, **ifp.interface**, **ifp.io_placer**, **ifp.macro_placer**
