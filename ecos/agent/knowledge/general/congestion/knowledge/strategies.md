<a id="strategy.congestion.local_vs_global.v1"></a>
## strategy.congestion.local_vs_global.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** A placement overflow hotspot is visible, but it is not yet known whether the demand is produced by cells inside the hotspot or by nets that only cross it.

**Diagnosis:** crude congestion model.

**Required evidence:** overflow_map, cell_density_map, net_density_map.

**Action intent:** recheck congestion model (`recheck_congestion_model`).

**Effects:** congestion unchanged.

**Anti-conditions:** same_relief_applied_to_every_hotspot.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. No authorized knob changes the congestion estimator.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.local_move_cells.v1"></a>
## strategy.congestion.local_move_cells.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Overflow is concentrated in a region whose cells or local nets also sit in that region.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map, net_density_map.

**Action intent:** spread local movable cells (`spread_local_movable_cells`).

**Effects:** congestion decrease; wirelength may_increase.

**Anti-conditions:** external_long_nets_dominate.

**ECOS analog:** increase `place.cell_padding_x`; decrease `place.target_density`; enable `place.routability_opt` (coarse analog)

**Binding limits:** ECOS cannot move a chosen hotspot; padding, lower packing, and routability area-adjust are the legal substitutes.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.simplr.2012.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.global_whitespace_insufficient.v1"></a>
## strategy.congestion.global_whitespace_insufficient.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** An overflow hotspot remains after local cells are thinned, and many nets cross the region without connecting cells inside it.

**Diagnosis:** global long net crossing.

**Required evidence:** overflow_map, net_density_map, cell_density_map.

**Action intent:** redistribute global routing demand (`redistribute_global_routing_demand`).

**Effects:** congestion decrease; wirelength may_increase.

**Anti-conditions:** through_traffic_diagnosis_not_confirmed.

**ECOS analog:** enable `place.routability_opt`; decrease `place.target_density` (coarse analog)

**Binding limits:** ECOS cannot move nets. Lower packing plus routability area-adjust is only a coarse analog.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.diffnet, paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.local_inflate_hotspot.v1"></a>
## strategy.congestion.local_inflate_hotspot.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Local overflow coincides with a high-occupancy bin, so more movable area must be reserved in that neighborhood.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** inflate cells in hotspot (`inflate_cells_in_hotspot`).

**Effects:** congestion decrease; cell_density decrease; wirelength may_increase.

**Anti-conditions:** external_long_nets_dominate, inflation_already_saturated.

**ECOS analog:** enable `place.routability_opt`; increase `place.cell_padding_x` (coarse analog)

**Binding limits:** ECOS has no per-cell inflation API; routability area-adjust plus padding is the legal analog.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.diffnet, paper.ntuplace4dr.2018, paper.simplr.2012.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.pin_density_with_overflow.v1"></a>
## strategy.congestion.pin_density_with_overflow.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** A hotspot has high pin density, not only high cell density or overflow.

**Diagnosis:** pin accessibility.

**Required evidence:** overflow_map, pin_density_map, cell_density_map.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** pin_density decrease; congestion decrease; wirelength may_increase.

**Anti-conditions:** pin_density_already_low.

**ECOS analog:** increase `place.cell_padding_x` (coarse analog)

**Binding limits:** Global place-stage padding is only a coarse analog of local padding. No controlled knob preserves separate legalization spacing or writes floorplan global_right_padding.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.puffer.2023, doc.openroad.gpl, paper.ntuplace4h.2014, paper.diffnet.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.distrust_coarse_congestion_map.v1"></a>
## strategy.congestion.distrust_coarse_congestion_map.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** A coarse or early congestion map is being used to decide aggressive local spreading or inflation.

**Diagnosis:** crude congestion model.

**Required evidence:** overflow_map, egr_or_rudy_map.

**Action intent:** recheck congestion model (`recheck_congestion_model`).

**Effects:** congestion unchanged.

**Anti-conditions:** map_already_refined_at_cell_level.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. No authorized knob changes the congestion estimator.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.do_not_equalize_all_wire_density.v1"></a>
## strategy.congestion.do_not_equalize_all_wire_density.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** A global-congestion fix tries to flatten wire density in every region, including chip boundaries that were not congested.

**Diagnosis:** global long net crossing.

**Required evidence:** overflow_map, net_density_map.

**Action intent:** redistribute global routing demand (`redistribute_global_routing_demand`).

**Effects:** congestion decrease; wirelength may_increase.

**Anti-conditions:** uncongested_regions_forced_to_absorb_wires.

**ECOS analog:** enable `place.routability_opt`; decrease `place.target_density` (coarse analog)

**Binding limits:** ECOS cannot move nets. Lower packing plus routability area-adjust is only a coarse analog.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.padding_spreads_hotspot_cells.v1"></a>
## strategy.congestion.padding_spreads_hotspot_cells.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Local overflow remains after ordinary density spreading, and movable cells in the hotspot can still accept extra site spacing.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** congestion decrease; cell_density decrease; wirelength may_increase.

**Anti-conditions:** cells_already_left_the_hotspot, utilization_has_no_slack.

**ECOS analog:** increase `place.cell_padding_x` (coarse analog)

**Binding limits:** Global place-stage padding is only a coarse analog of local padding. No controlled knob preserves separate legalization spacing or writes floorplan global_right_padding.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023, doc.openroad.gpl, paper.ripple2.2016.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.use_neighborhood_and_pin_features.v1"></a>
## strategy.congestion.use_neighborhood_and_pin_features.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Cells in the same cluster share similar local overflow, so a cell-only hotspot score cannot tell which cells should be padded.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, pin_density_map, egr_or_rudy_map.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** congestion decrease.

**Anti-conditions:** only_cell_local_overflow_was_used.

**ECOS analog:** increase `place.cell_padding_x` (coarse analog)

**Binding limits:** Global place-stage padding is only a coarse analog of local padding. No controlled knob preserves separate legalization spacing or writes floorplan global_right_padding.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.recycle_padding_outside_hotspot.v1"></a>
## strategy.congestion.recycle_padding_outside_hotspot.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Cells that were padded for an old hotspot have already left the congested region, but the extra spacing remains.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** recycle padding outside hotspot (`recycle_padding_outside_hotspot`).

**Effects:** wirelength may_decrease; congestion unchanged.

**Anti-conditions:** cell_still_inside_hotspot.

**ECOS analog:** decrease `place.cell_padding_x` (coarse analog)

**Binding limits:** ECOS padding is global, not per-cell. Decreasing it requires verified hotspot clearance; no separate legalization padding knob is authorized.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023, paper.diffnet, paper.ntuplace4dr.2018.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.avoid_early_overpadding.v1"></a>
## strategy.congestion.avoid_early_overpadding.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Routability relief is applied in early placement iterations when the congestion map is still unstable.

**Diagnosis:** crude congestion model.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** cap inflation aggressiveness (`cap_inflation_aggressiveness`).

**Effects:** wirelength may_decrease; congestion may_increase.

**Anti-conditions:** late_stable_map_with_remaining_hotspots.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** ECOS has no max-inflation-ratio knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023, doc.openroad.gpl, paper.ripple2.2016.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.keep_padding_into_legalization.v1"></a>
## strategy.congestion.keep_padding_into_legalization.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Global-placement padding improved a hotspot, but legalization packs the same cells back together.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** preserve padding through legalization (`preserve_padding_through_legalization`).

**Effects:** congestion decrease.

**Anti-conditions:** legalization_already_honors_the_same_spacing.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. The seven controlled knobs do not expose a separate legalization spacing control; increasing place padding does not guarantee preservation into legalization.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.enable_congestion_guided_area_adjust.v1"></a>
## strategy.congestion.enable_congestion_guided_area_adjust.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** A routing-utilization or RUDY-style map shows congested tiles while ordinary density spreading has already finished.

**Diagnosis:** local cell or pin density.

**Required evidence:** egr_or_rudy_map, overflow_map.

**Action intent:** enable routability adjustment (`enable_routability_adjustment`).

**Effects:** congestion decrease; wirelength may_increase.

**Anti-conditions:** relief_not_reducing_routing_congestion.

**ECOS analog:** enable `place.routability_opt` (exact analog)

**Binding limits:** Subject to current stage, evidence, and legal action constraints.

**Review status:** source_grounded.

**Evidence sources:** doc.openroad.gpl, paper.polar2.2014, paper.replace.2019.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.timing_overflow_tradeoff.v1"></a>
## strategy.congestion.timing_overflow_tradeoff.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Overflow is being reduced, but the same region also contains timing-critical nets that would be hurt by further spreading.

**Diagnosis:** timing routability conflict.

**Required evidence:** overflow_map, timing_report.

**Action intent:** preserve timing on critical cells (`preserve_timing_on_critical_cells`).

**Effects:** timing unchanged; congestion may_increase.

**Anti-conditions:** no_negative_slack_in_the_hotspot.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized place-stage net-weight or slack knob. This intent can block other bindings, not write one.

**Review status:** source_grounded.

**Evidence sources:** doc.openroad.gpl, paper.timingdriven.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.crude_vs_accurate_demand_model.v1"></a>
## strategy.congestion.crude_vs_accurate_demand_model.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** A fast congestion estimate disagrees with a more topology-aware routing demand map, or the hotspot looks like an artifact of the estimator.

**Diagnosis:** crude congestion model.

**Required evidence:** egr_or_rudy_map, overflow_map.

**Action intent:** recheck congestion model (`recheck_congestion_model`).

**Effects:** congestion unchanged.

**Anti-conditions:** both_estimators_agree_on_the_same_hotspot.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. No authorized knob changes the congestion estimator.

**Review status:** source_grounded.

**Evidence sources:** doc.openroad.gpl, paper.puffer.2023, paper.simplr.2012, paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.macro_or_narrow_channel.v1"></a>
## strategy.congestion.macro_or_narrow_channel.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place, floorplan.

**Condition:** Overflow sits on macro edges or in a narrow channel between fixed macros, not in an open standard-cell sea.

**Diagnosis:** macro or narrow channel.

**Required evidence:** overflow_map, macro_density_map, cell_density_map.

**Action intent:** inflate cells in hotspot (`inflate_cells_in_hotspot`).

**Effects:** congestion decrease; cell_density decrease; wirelength may_increase.

**Anti-conditions:** hotspot_is_open_stdcell_sea, only_local_cell_density_was_inspected.

**ECOS analog:** enable `place.routability_opt`; increase `place.cell_padding_x` (coarse analog)

**Binding limits:** ECOS has no per-cell inflation API; routability area-adjust plus padding is the legal analog.

**Review status:** source_grounded.

**Evidence sources:** paper.ripple2.2016, paper.ntuplace4h.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.keep_wirelength_seed.v1"></a>
## strategy.congestion.keep_wirelength_seed.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Routability relief is about to destroy a still-reasonable wirelength-driven seed in order to flatten congestion.

**Diagnosis:** global long net crossing.

**Required evidence:** overflow_map, net_density_map.

**Action intent:** keep good wirelength seed (`keep_good_wirelength_seed`).

**Effects:** wirelength unchanged; congestion may_decrease.

**Anti-conditions:** seed_already_unroutable_from_local_packing.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Constraint on other relief, not a writable knob.

**Review status:** source_grounded.

**Evidence sources:** paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.lower_packing_when_overflow_persists.v1"></a>
## strategy.congestion.lower_packing_when_overflow_persists.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Local padding or inflation has already been applied, but overflow remains and the design is packed tightly.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** decrease packing density (`decrease_packing_density`).

**Effects:** congestion decrease; wirelength may_increase.

**Anti-conditions:** utilization_already_has_slack, overflow_is_through_traffic_only.

**ECOS analog:** decrease `place.target_density` (coarse analog)

**Binding limits:** This place-only binding lowers target density. Legacy floorplan.utilitization is represented by the separate floorplan.core_util source-derived exploration, not an exact mapping of this paper claim.

**Review status:** source_grounded.

**Evidence sources:** paper.simplr.2012, paper.replace.2019.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.trial_tighter_density_convergence.v1"></a>
## strategy.congestion.trial_tighter_density_convergence.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. Measured EGR routing overflow is positive; it is not native placement density overflow and does not prove a density-convergence failure. Decreasing place.target_overflow tightens one DREAMPlace convergence predicate, but other stopping predicates can still terminate placement; density overflow is not routing overflow.

**Diagnosis:** routing pressure parameter exploration.

**Required evidence:** place_congestion_egr_overflow_total, place.target_overflow.

**Action intent:** tighten density overflow trial (`tighten_density_overflow_trial`).

**Effects:** placement_density_overflow may_decrease; placement_runtime may_increase; wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `place.target_overflow` (coarse analog)

**Binding limits:** Tighten only within the continuous legal (0,1) domain. The native predicate also tests HPWL and max density. A lower threshold does not guarantee more iterations or better routed QoR.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.overflow_stopping.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.overflow_stopping**

<a id="strategy.congestion.trial_stronger_initial_density_penalty.v1"></a>
## strategy.congestion.trial_stronger_initial_density_penalty.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. Measured EGR routing overflow is positive; it is not native placement density overflow and does not prove a density-convergence failure. Increasing place.density_weight changes the initial gradient-balanced density penalty and is a trial of stronger initial spreading, not a fixed multiplier on final density or routing congestion.

**Diagnosis:** routing pressure parameter exploration.

**Required evidence:** place_congestion_egr_overflow_total, place.density_weight.

**Action intent:** increase initial density penalty trial (`increase_initial_density_penalty_trial`).

**Effects:** placement_density_overflow may_decrease; wirelength may_increase; placement_runtime may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.density_weight` (coarse analog)

**Binding limits:** The configured coefficient initializes a gradient-balanced penalty; adaptive updates and routability reinitialization can dominate later behavior. Hold target_overflow and routability_opt fixed during the trial.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.density_weight_initialization.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.density_weight_initialization**

<a id="strategy.congestion.trial_core_whitespace.v1"></a>
## strategy.congestion.trial_core_whitespace.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. In die-util mode, decrease positive floorplan.core_util to explore more core area and whitespace at fixed aspect ratio. The source proves the area mechanism, not that congestion is currently local or that extra whitespace improves QoR.

**Diagnosis:** core area whitespace tradeoff.

**Required evidence:** floorplan_die_util_mode, floorplan.core_util.

**Action intent:** increase core whitespace trial (`increase_core_whitespace_trial`).

**Effects:** congestion may_decrease; core_area may_increase; wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `floorplan.core_util` (coarse analog)

**Binding limits:** Canonical controlled identity for legacy floorplan.utilitization. Active only in die-util mode, not explicit die-size mode. Core area is cell area divided by utilization before alignment; larger area may hurt wirelength and area constraints.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.statements**, **general.bindings**, **source.ifp.core_geometry**
