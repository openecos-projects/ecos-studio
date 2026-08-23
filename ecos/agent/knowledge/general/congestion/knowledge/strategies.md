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

**Paper sources:** paper.routability.2021.

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

**ECOS analog:** increase `place.cell_padding_x`; decrease `place.target_density`; set true `place.routability_opt` (coarse analog)

**Paper sources:** paper.routability.2021, paper.simplr.2012.

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

**Anti-conditions:** only_local_whitespace_was_added.

**ECOS analog:** set true `place.routability_opt`; decrease `place.target_density` (coarse analog)

**Paper sources:** paper.routability.2021, paper.diffnet, paper.polar2.2014.

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

**ECOS analog:** set true `place.routability_opt`; increase `place.cell_padding_x` (coarse analog)

**Paper sources:** paper.routability.2021, paper.diffnet, paper.ntuplace4dr.2018, paper.simplr.2012.

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

**ECOS analog:** increase `place.cell_padding_x`; increase `legalization.cell_padding_x`; increase `floorplan.global_right_padding` (exact analog)

**Paper sources:** paper.routability.2021, paper.puffer.2023, doc.openroad.gpl, paper.ntuplace4h.2014, paper.diffnet.

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

**Paper sources:** paper.routability.2021.

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

**ECOS analog:** set true `place.routability_opt`; decrease `place.target_density` (coarse analog)

**Paper sources:** paper.routability.2021.

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

**ECOS analog:** increase `place.cell_padding_x`; increase `legalization.cell_padding_x`; increase `floorplan.global_right_padding` (exact analog)

**Paper sources:** paper.puffer.2023, doc.openroad.gpl, paper.ripple2.2016.

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

**ECOS analog:** increase `place.cell_padding_x`; increase `legalization.cell_padding_x`; increase `floorplan.global_right_padding` (exact analog)

**Paper sources:** paper.puffer.2023.

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

**ECOS analog:** decrease `place.cell_padding_x`; decrease `legalization.cell_padding_x` (coarse analog)

**Paper sources:** paper.puffer.2023, paper.diffnet, paper.ntuplace4dr.2018.

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

**Paper sources:** paper.puffer.2023, doc.openroad.gpl, paper.ripple2.2016.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.keep_padding_into_legalization.v1"></a>
## strategy.congestion.keep_padding_into_legalization.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place.

**Condition:** Global-placement padding improved a hotspot, but legalization packs the same cells back together.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** congestion decrease.

**Anti-conditions:** legalization_already_honors_the_same_spacing.

**ECOS analog:** increase `place.cell_padding_x`; increase `legalization.cell_padding_x`; increase `floorplan.global_right_padding` (exact analog)

**Paper sources:** paper.puffer.2023.

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

**ECOS analog:** set true `place.routability_opt` (exact analog)

**Paper sources:** doc.openroad.gpl, paper.polar2.2014, paper.replace.2019.

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

**Paper sources:** doc.openroad.gpl, paper.timingdriven.

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

**Paper sources:** doc.openroad.gpl, paper.puffer.2023, paper.simplr.2012, paper.polar2.2014.

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

**ECOS analog:** set true `place.routability_opt`; increase `place.cell_padding_x` (coarse analog)

**Paper sources:** paper.ripple2.2016, paper.ntuplace4h.2014.

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

**Paper sources:** paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.lower_packing_when_overflow_persists.v1"></a>
## strategy.congestion.lower_packing_when_overflow_persists.v1

**Topic:** congestion strategy.

**Metric:** congestion.

**Applies to steps:** place, floorplan.

**Condition:** Local padding or inflation has already been applied, but overflow remains and the design is packed tightly.

**Diagnosis:** local cell or pin density.

**Required evidence:** overflow_map, cell_density_map.

**Action intent:** decrease packing density (`decrease_packing_density`).

**Effects:** congestion decrease; wirelength may_increase.

**Anti-conditions:** utilization_already_has_slack, overflow_is_through_traffic_only.

**ECOS analog:** decrease `place.target_density`; decrease `floorplan.utilitization` (exact analog)

**Paper sources:** paper.simplr.2012, paper.replace.2019.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.wirelength.validate_route_after_proxy_gain.v1"></a>
## strategy.wirelength.validate_route_after_proxy_gain.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** Placement HPWL or FLUTE wirelength improves beyond local replay noise, but the candidate has not yet been validated through route.

**Diagnosis:** placement proxy terminal gap.

**Required evidence:** place_hpwl, place_flute_wirelength, route_wirelength, route_dr_total_wirelength, route_dr_total_violation_count, route_la_total_overflow, drc_count, sta_setup_wns, sta_setup_tns, sta_hold_wns, sta_hold_tns.

**Action intent:** validate routed wirelength after proxy gain (`validate_routed_wirelength_after_proxy_gain`).

**Effects:** route_wirelength unchanged.

**Anti-conditions:** route_execution_not_authorized, baseline_noise_band_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Paper sources:** paper.wirelength.chipbench.2025, paper.wirelength.autodmp.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.wirelength.use_flute_when_hpwl_is_ambiguous.v1"></a>
## strategy.wirelength.use_flute_when_hpwl_is_ambiguous.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** HPWL alone cannot distinguish candidate topology, or HPWL and FLUTE rank placement candidates differently.

**Diagnosis:** hpwl topology blindness.

**Required evidence:** place_hpwl, place_flute_wirelength, net_pin_geometry.

**Action intent:** use flute as secondary wirelength proxy (`use_flute_as_secondary_wirelength_proxy`).

**Effects:** route_wirelength may_decrease.

**Anti-conditions:** place_flute_wirelength_unavailable, treating_flute_as_routed_wirelength, random_pointset_calibration_only.

**ECOS analog:** No authorized knob. Do not invent one.

**Paper sources:** paper.wirelength.wot_the_l.2018, paper.wirelength.autodmp.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.wirelength.reduce_excessive_place_spreading.v1"></a>
## strategy.wirelength.reduce_excessive_place_spreading.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** Congestion and DRC are clean within local tolerance, timing is not worse than the baseline, routed wirelength remains the decisive loss, and place-stage routability relief is still active.

**Diagnosis:** excessive place spreading after routability is clean.

**Required evidence:** current_place_knob_values, route_wirelength, route_dr_total_wirelength, route_dr_total_violation_count, route_la_total_overflow, drc_count, sta_setup_wns, sta_setup_tns, sta_hold_wns, sta_hold_tns.

**Action intent:** reduce excessive place spreading (`reduce_excessive_place_spreading`).

**Effects:** route_wirelength may_decrease; congestion may_increase.

**Anti-conditions:** congestion_not_clean, drc_not_clean, timing_not_within_tolerance, terminal_route_metrics_unavailable, no_routability_relief_is_active.

**ECOS analog:** increase `place.target_density`; decrease `place.cell_padding_x`; set false `place.routability_opt` (coarse analog)

**Paper sources:** paper.wirelength.replace.2019, paper.wirelength.dreamplace3.2020, paper.wirelength.autodmp.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.wirelength.reject_guardrail_regression.v1"></a>
## strategy.wirelength.reject_guardrail_regression.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** A place-stage parameter candidate improves HPWL, FLUTE, or routed wirelength but materially worsens congestion, DRC, or timing against the replayed baseline.

**Diagnosis:** wirelength gain violates non regression constraint.

**Required evidence:** baseline_replay_noise_bands, route_wirelength, route_dr_total_violation_count, route_la_total_overflow, drc_count, sta_setup_wns, sta_setup_tns, sta_hold_wns, sta_hold_tns.

**Action intent:** reject wirelength guardrail regression (`reject_wirelength_guardrail_regression`).

**Effects:** congestion unchanged; timing unchanged.

**Anti-conditions:** regression_within_replay_noise, baseline_guardrail_evidence_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Paper sources:** paper.wirelength.chipbench.2025, paper.wirelength.dreamplace4.2022, paper.wirelength.replace.2019.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.wirelength.reject_post_legalization_rebound.v1"></a>
## strategy.wirelength.reject_post_legalization_rebound.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** A candidate improves a placement proxy or global-routing result, but legalization or detailed route reverses the gain or loses feasibility.

**Diagnosis:** downstream legalization or route rebound.

**Required evidence:** pre_legalization_wirelength, post_legalization_wirelength, route_wirelength, route_dr_total_wirelength, route_dr_total_violation_count.

**Action intent:** reject post legalization rebound (`reject_post_legalization_rebound`).

**Effects:** route_wirelength unchanged.

**Anti-conditions:** rebound_within_replay_noise, downstream_evidence_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Paper sources:** paper.wirelength.ropt.2013.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.wirelength.reject_macro_hpwl_only_gain.v1"></a>
## strategy.wirelength.reject_macro_hpwl_only_gain.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** MacroHPWL improves while full-netlist HPWL, congestion, routed wirelength, or timing does not improve consistently.

**Diagnosis:** macro hpwl overfitting.

**Required evidence:** macro_hpwl, place_hpwl, route_wirelength, route_dr_total_violation_count, sta_setup_wns, sta_setup_tns, sta_hold_wns, sta_hold_tns.

**Action intent:** reject macro hpwl only gain (`reject_macro_hpwl_only_gain`).

**Effects:** congestion unchanged; timing unchanged.

**Anti-conditions:** full_netlist_hpwl_unavailable, route_metrics_unavailable, timing_metrics_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Paper sources:** paper.wirelength.chipbench.2025.

**Source evidence:** **general.statements**, **general.bindings**
