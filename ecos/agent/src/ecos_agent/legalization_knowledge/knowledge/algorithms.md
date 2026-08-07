<a id="algorithm.legalization.execution"></a>
## algorithm.legalization.execution

**Execution path:** The DreamPlace runner loads ECC data, builds `DreamplaceModule`, forces legalization-only parameters, creates the placement engine, and runs it. In legalization-only mode global placement and fillers are disabled while `legalize_flag` is enabled; the runner then saves the design and runs analysis and checklist generation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**

<a id="algorithm.legalization.parameter_overrides"></a>
## algorithm.legalization.parameter_overrides

**Forced mode:** `DreamplaceModule._build_params()` overrides global placement, filler insertion and random-center initialization to off; it forces `legalize_flag=1` and enables automatic bin adjustment. These runtime assignments take precedence over the serialized DreamPlace defaults.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**

<a id="algorithm.legalization.subflow"></a>
## algorithm.legalization.subflow

**Subflow order:** `load data -> run legalization -> save data -> analysis`. `PlacementEngine.run()` is the tool boundary. A finite PPA HPWL is required from `DreamplaceModule` before it returns success, but the runner must still save valid terminal artifacts for the stage claim to be auditable.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**
