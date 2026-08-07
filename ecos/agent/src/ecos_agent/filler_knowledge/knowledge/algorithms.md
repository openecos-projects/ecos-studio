<a id="algorithm.filler.execution"></a>
## algorithm.filler.execution

**Execution path:** The ECC runner loads the design, invokes `run_filler` with the workspace Filler configuration, saves the updated design and geometry snapshot, then runs analysis and checklist generation.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="algorithm.filler.filler_model_initialization"></a>
## algorithm.filler.filler_model_initialization

**Input and state:** The native filler insertion path builds an `FIModel` from iDB rows, cell masters, `-filler` configuration, and `-min_filler_width`.

**Algorithm:** It filters invalid or non-horizontal rows and accepts only core-filler masters whose widths are site-width multiples, then sorts masters by descending width.

**Constraint and stop:** A non-positive minimum width is invalid. Initialization ends with rows, sorted master choices, and insertion counters; it does not yet modify the design.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="algorithm.filler.available_segment_extraction"></a>
## algorithm.filler.available_segment_extraction

**Input and state:** Each `FIRow` begins with a site-availability bitmap. Placed instance boxes and placement-blockage rectangles are clipped to intersecting rows.

**Algorithm:** Blockages are converted to clamped site-index ranges and marked unavailable, then the bitmap is scanned into contiguous `FISegment` gaps.

**Stop and output:** The finite blockage and row scans produce the legal segments in which filler cells may be inserted.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="algorithm.filler.greedy_segment_packing"></a>
## algorithm.filler.greedy_segment_packing

**Input and state:** A legal segment, descending-width filler masters, and the minimum filler-site count form one packing problem.

**Algorithm:** Starting at the segment's left site, the inserter picks the first master that fits while leaving either zero remainder or a remainder at least as large as the minimum filler width.

**Stop and output:** Packing stops when no master can be added or the remaining sites are too few. This largest-first greedy policy avoids an unfillable sub-minimum gap but does not solve a global optimal packing problem.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**

<a id="algorithm.filler.instance_writeback"></a>
## algorithm.filler.instance_writeback

**Algorithm:** For each selected master, `addFillerInstance()` computes `origin_x + begin_site_idx * site_width`, keeps the row orientation, creates a unique instance name, and writes a placed filler instance to iDB.

**Constraint and stop:** Missing design/master data prevents insertion; name collisions are handled by unique-name generation and error-on-existing creation. Counters advance for each created instance, then ECOS serializes the resulting database.

**Source evidence:** **ecc.runner**, **ecc.module**, **izh.filler**
