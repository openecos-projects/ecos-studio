<a id="failure.filler.preconditions"></a>
## failure.filler.preconditions

**Failure mode:** The step cannot execute without an ECC database instance. Native filler initialization, row/master filtering, segment extraction, packing, or instance writeback can fail while the wrapper records progress; the standard GUI has no filler-specific comparison metric, so artifact and checklist evidence are required.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.engine"></a>
## failure.filler.engine

**Failure mode:** Without an ECC module, the runner does not invoke filler insertion.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.config"></a>
## failure.filler.config

**Failure mode:** The native filler model rejects a non-positive minimum filler width and filters out invalid row/master definitions before insertion.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.segments"></a>
## failure.filler.segments

**Failure mode:** Rows with unsupported orientation or no legal site segments produce no insertion candidates; this is not evidence that the design needed no fillers.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.writeback"></a>
## failure.filler.writeback

**Failure mode:** Missing design/master data or a failed unique-instance creation prevents selected filler cells from being written back to iDB.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.native_progress"></a>
## failure.filler.native_progress

**Failure mode:** The runner marks `run filler` successful without inspecting the native insertion return value, so saved database and geometry artifacts are the terminal evidence.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.evidence"></a>
## failure.filler.evidence

**Failure mode:** There is no dedicated filler metric in the GUI comparison set. Missing saved artifacts or checklist output leaves the filler result unverified.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="failure.filler.terminal_evidence"></a>
## failure.filler.terminal_evidence

**Failure mode:** A successful subflow checkpoint records progress, not a terminal claim. Verify the stage return state together with its declared artifacts, feature records, QoR payloads, and log before reporting completion.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**
