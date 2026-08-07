<a id="metric.place_hpwl"></a>
## metric.place_hpwl

**Meaning:** The total half-perimeter wirelength of the placed netlist in micrometres; lower is better.

**Calculation:** For every net, the evaluator finds its pin-coordinate extrema and adds `(max_x - min_x) + (max_y - min_y)`; it sums that value over all nets, writes `/Wirelength/HPWL` to `place.map.json`, and ECOS reads that selector.

**Boundary:** This is a bounding-box estimate, not routed wire length or timing delay.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.wirelength**

<a id="metric.place_grwl"></a>
## metric.place_grwl

**Meaning:** The total global-routing guide wirelength in micrometres; lower is better.

**Calculation:** The wirelength evaluator parses the early router's `route.guide`, sums its EGR guide wirelength, stores it as `/Wirelength/GRWL`, and ECOS extracts that value from `place.map.json`.

**Boundary:** It reflects the early-routing guide, not detailed-routing geometry.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.wirelength**

<a id="metric.place_flute_wirelength"></a>
## metric.place_flute_wirelength

**Meaning:** The total FLUTE rectilinear Steiner-tree wirelength in micrometres; lower is better.

**Calculation:** For a two-pin net, the evaluator uses Manhattan distance. For a net with more than two pins, it invokes `flute(pin_count, x, y, 8)` and uses the returned tree length; it then sums all nets and publishes `/Wirelength/FLUTE`.

**Boundary:** It is a Steiner-tree estimate and does not include detailed-routing detours or vias.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.wirelength**

<a id="metric.place_congestion_egr_overflow_total"></a>
## metric.place_congestion_egr_overflow_total

**Meaning:** The total union-direction early-global-routing overflow count; lower is better.

**Calculation:** The congestion evaluator reads the selected `overflow_map_*` CSV values, selects all routing directions for `union`, and sums every bin value. The feature parser publishes that aggregate at `/Congestion/overflow/total/union`, which ECOS exposes as this metric.

**Boundary:** It is an early-routing capacity-demand excess, not a post-route DRC count.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place_congestion_egr_overflow_max"></a>
## metric.place_congestion_egr_overflow_max

**Meaning:** The largest union-direction early-global-routing overflow observed in one grid bin; lower is better.

**Calculation:** The congestion evaluator scans the union overflow CSV and retains the greatest bin value. The feature parser writes `/Congestion/overflow/max/union`, and ECOS extracts it as this metric.

**Boundary:** A small total can still coexist with a severe local peak, so this metric complements total overflow.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place_rudy_utilization_max"></a>
## metric.place_rudy_utilization_max

**Meaning:** The maximum union-direction RUDY routing-demand estimate over placement bins; lower is better.

**Calculation:** For each net, ECC forms the pin bounding box and accumulates `overlap_area / bbox_height / grid_area` horizontally and `overlap_area / bbox_width / grid_area` vertically in every overlapping bin; union adds both. A zero bbox dimension uses reciprocal `1.0`. The metric is the maximum union-bin value at `/Congestion/utilization/rudy/max/union`.

**Boundary:** This is a placement-time demand estimate, not detailed-routing overflow and not DreamPlace's internal Torch RUDY operator.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place_lutrudy_utilization_max"></a>
## metric.place_lutrudy_utilization_max

**Meaning:** The maximum union-direction LUT-RUDY routing-demand estimate over placement bins; lower is better.

**Calculation:** LUT-RUDY uses the same bounding-box overlap accumulation as RUDY, but multiplies each non-degenerate horizontal or vertical contribution by `getLUT(pin_count, aspect_ratio, l_ness)`. ECOS reports the largest union-bin value at `/Congestion/utilization/lutrudy/max/union`.

**Boundary:** The lookup factor is an estimator based on pin count, bbox aspect ratio, and L-ness; it is not a routed utilization measurement.

**Source evidence:** **gui.place_metrics**, **ecc.metrics**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.cell_density"></a>
## metric.place.map.cell_density

**Meaning:** A per-bin map of total movable-cell area fraction.

**Calculation:** For each cell and every overlapping bin, ECC adds `overlap_area / grid_area`; the all-cell variant includes both macros and standard cells.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.macro_density"></a>
## metric.place.map.macro_density

**Meaning:** A per-bin map of macro area fraction.

**Calculation:** ECC runs the same overlap-area accumulation as cell density but filters input cells to `macro` before adding `overlap_area / grid_area`.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.stdcell_density"></a>
## metric.place.map.stdcell_density

**Meaning:** A per-bin map of standard-cell area fraction.

**Calculation:** ECC runs the same overlap-area accumulation as cell density but filters input cells to `stdcell` before adding `overlap_area / grid_area`.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.pin_density"></a>
## metric.place.map.pin_density

**Meaning:** A per-bin map of placed-pin count.

**Calculation:** ECC assigns each selected pin to its containing bin and increments that bin. When the evaluator is invoked with neighbor mode, it replaces each bin with the sum of its 3-by-3 neighborhood; the published all-cell map includes macro and standard-cell pins.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.macro_pin_density"></a>
## metric.place.map.macro_pin_density

**Meaning:** A per-bin map of macro-pin count.

**Calculation:** ECC assigns only pins belonging to macros to their containing bins and increments the corresponding bin; neighbor mode, when requested, replaces each bin with its 3-by-3 neighborhood sum.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.stdcell_pin_density"></a>
## metric.place.map.stdcell_pin_density

**Meaning:** A per-bin map of standard-cell-pin count.

**Calculation:** ECC assigns only pins belonging to standard cells to their containing bins and increments the corresponding bin; neighbor mode, when requested, replaces each bin with its 3-by-3 neighborhood sum.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.net_density"></a>
## metric.place.map.net_density

**Meaning:** A per-bin map of all net coverage counts.

**Calculation:** ECC classifies a net as local when its bounding box fits one bin and increments that bin; otherwise it increments every bin crossed by the bounding box. The all-net map combines both cases.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.global_net_density"></a>
## metric.place.map.global_net_density

**Meaning:** A per-bin map of multi-bin net coverage counts.

**Calculation:** ECC selects nets whose bounding boxes span more than one bin and increments every bin covered by each selected bounding box.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.local_net_density"></a>
## metric.place.map.local_net_density

**Meaning:** A per-bin map of single-bin net counts.

**Calculation:** ECC selects nets whose bounding boxes remain inside one bin and increments only that bin.

**Boundary:** The desktop map gallery displays only PNG files present in `feature/density_map`; the feature map records the source paths, so a declared map is not proof that its image exists in a workspace.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.density**

<a id="metric.place.map.egr_horizontal"></a>
## metric.place.map.egr_horizontal

**Meaning:** An early-global-routing overflow map summed over horizontal-preferred routing layers.

**Calculation:** ECC reads `overflow_map_*` CSV files from the early router, selects horizontal-preferred routing layers, and sums matching matrices cell by cell. The resulting path is stored under `/Congestion/map/egr/horizontal`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.rudy_horizontal"></a>
## metric.place.map.rudy_horizontal

**Meaning:** A horizontal-direction RUDY routing-demand map.

**Calculation:** For each net bounding box and overlapping bin, ECC accumulates `overlap_area / grid_area` times the reciprocal bbox height for horizontal demand, the reciprocal bbox width for vertical demand, or their sum for union. A zero dimension uses reciprocal `1.0`; the path is `/Congestion/map/rudy/horizontal`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.lutrudy_horizontal"></a>
## metric.place.map.lutrudy_horizontal

**Meaning:** A horizontal-direction LUT-RUDY routing-demand map.

**Calculation:** ECC applies the RUDY overlap accumulation, then scales each non-degenerate directional reciprocal by `getLUT(pin_count, aspect_ratio, l_ness)` before writing `/Congestion/map/lutrudy/horizontal`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.egr_vertical"></a>
## metric.place.map.egr_vertical

**Meaning:** An early-global-routing overflow map summed over vertical-preferred routing layers.

**Calculation:** ECC reads `overflow_map_*` CSV files from the early router, selects vertical-preferred routing layers, and sums matching matrices cell by cell. The resulting path is stored under `/Congestion/map/egr/vertical`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.rudy_vertical"></a>
## metric.place.map.rudy_vertical

**Meaning:** A vertical-direction RUDY routing-demand map.

**Calculation:** For each net bounding box and overlapping bin, ECC accumulates `overlap_area / grid_area` times the reciprocal bbox height for horizontal demand, the reciprocal bbox width for vertical demand, or their sum for union. A zero dimension uses reciprocal `1.0`; the path is `/Congestion/map/rudy/vertical`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.lutrudy_vertical"></a>
## metric.place.map.lutrudy_vertical

**Meaning:** A vertical-direction LUT-RUDY routing-demand map.

**Calculation:** ECC applies the RUDY overlap accumulation, then scales each non-degenerate directional reciprocal by `getLUT(pin_count, aspect_ratio, l_ness)` before writing `/Congestion/map/lutrudy/vertical`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.egr_union"></a>
## metric.place.map.egr_union

**Meaning:** An early-global-routing overflow map summed over all routing layers.

**Calculation:** ECC reads `overflow_map_*` CSV files from the early router, selects all routing layers, and sums matching matrices cell by cell. The resulting path is stored under `/Congestion/map/egr/union`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.rudy_union"></a>
## metric.place.map.rudy_union

**Meaning:** A union-direction RUDY routing-demand map.

**Calculation:** For each net bounding box and overlapping bin, ECC accumulates `overlap_area / grid_area` times the reciprocal bbox height for horizontal demand, the reciprocal bbox width for vertical demand, or their sum for union. A zero dimension uses reciprocal `1.0`; the path is `/Congestion/map/rudy/union`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**

<a id="metric.place.map.lutrudy_union"></a>
## metric.place.map.lutrudy_union

**Meaning:** A union-direction LUT-RUDY routing-demand map.

**Calculation:** ECC applies the RUDY overlap accumulation, then scales each non-degenerate directional reciprocal by `getLUT(pin_count, aspect_ratio, l_ness)` before writing `/Congestion/map/lutrudy/union`.

**Boundary:** The map is a placement-time estimator. It is visible only when its PNG is emitted for the workspace; it does not establish detailed-routing success.

**Source evidence:** **gui.map_gallery**, **ecc.service**, **ecc.feature_union**, **ecc.feature_parser**, **ecc.congestion**
