<a id="strategy.congestion.local_vs_global.v1"></a>
## strategy.congestion.local_vs_global.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is positive, but scalar metrics cannot establish whether the cause is local cell demand or through-traffic demand. Do not claim a spatial diagnosis.

**Diagnosis:** unresolved scalar congestion diagnosis.

**Required evidence:** route_la_total_overflow.

**Action intent:** recheck congestion model (`recheck_congestion_model`).

**Effects:** route_la_total_overflow unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. No authorized knob changes the congestion estimator.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.local_move_cells.v1"></a>
## strategy.congestion.local_move_cells.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and routed wirelength are both positive. Use the coarse legal spreading analog only as a bounded trial; scalar evidence does not identify a particular local cell cluster.

**Diagnosis:** coarse placement spreading under route overflow.

**Required evidence:** route_la_total_overflow, route_wirelength.

**Action intent:** spread local movable cells (`spread_local_movable_cells`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.cell_padding_x`; decrease `place.target_density`; enable `place.routability_opt` (coarse analog)

**Binding limits:** ECOS cannot move a chosen hotspot; padding, lower packing, and routability area-adjust are the legal substitutes.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.simplr.2012.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.global_whitespace_insufficient.v1"></a>
## strategy.congestion.global_whitespace_insufficient.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow remains positive and its delta versus the reference is positive after a prior candidate, indicating scalar persistence. Use broader whitespace/routability actions as a coarse alternative; the agent cannot prove through-traffic spatially. The source example describes many nets cross the region without connecting cells inside it; this spatial interpretation is not directly exposed to the agent.

**Diagnosis:** persistent route overflow after prior trial.

**Required evidence:** route_la_total_overflow, delta.route_la_total_overflow.

**Action intent:** redistribute global routing demand (`redistribute_global_routing_demand`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** enable `place.routability_opt`; decrease `place.target_density` (coarse analog)

**Binding limits:** ECOS cannot move nets. Lower packing plus routability area-adjust is only a coarse analog.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.diffnet, paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.local_inflate_hotspot.v1"></a>
## strategy.congestion.local_inflate_hotspot.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and detailed-route violations are positive while place.routability_opt is false. Enable the legal area-adjust/padding analog as a bounded trial; scalar evidence does not identify a local hotspot.

**Diagnosis:** coarse area adjust under route overflow.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count.

**Action intent:** inflate cells in hotspot (`inflate_cells_in_hotspot`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** enable `place.routability_opt`; increase `place.cell_padding_x` (coarse analog)

**Binding limits:** ECOS has no per-cell inflation API; routability area-adjust plus padding is the legal analog.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.diffnet, paper.ntuplace4dr.2018, paper.simplr.2012.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.pin_density_with_overflow.v1"></a>
## strategy.congestion.pin_density_with_overflow.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and detailed-route violations are positive. Treat this as aggregate routability pressure and use padding only as a bounded trial; do not infer a spatial cause.

**Diagnosis:** aggregate routability pressure.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.cell_padding_x` (coarse analog)

**Binding limits:** Global place-stage padding is only a coarse analog of local padding. No controlled knob preserves separate legalization spacing or writes floorplan global_right_padding.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021, paper.puffer.2023, doc.openroad.gpl, paper.ntuplace4h.2014, paper.diffnet.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.distrust_coarse_congestion_map.v1"></a>
## strategy.congestion.distrust_coarse_congestion_map.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Scalar placement and routed overflow disagree in severity or remain positive together. Map-file presence is evidence availability only; it is not a spatial diagnosis.

**Diagnosis:** map presence without consumable bins.

**Required evidence:** route_la_total_overflow, place_hpwl.

**Action intent:** recheck congestion model (`recheck_congestion_model`).

**Effects:** route_la_total_overflow unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. No authorized knob changes the congestion estimator.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.do_not_equalize_all_wire_density.v1"></a>
## strategy.congestion.do_not_equalize_all_wire_density.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is positive and a candidate has increased routed wirelength relative to its reference. Prefer targeted/coarse relief trials; do not treat a global wirelength change as proof that all regions should be equalized.

**Diagnosis:** global relief wirelength tradeoff.

**Required evidence:** route_la_total_overflow, route_wirelength, delta.route_wirelength.

**Action intent:** redistribute global routing demand (`redistribute_global_routing_demand`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** enable `place.routability_opt`; decrease `place.target_density` (coarse analog)

**Binding limits:** ECOS cannot move nets. Lower packing plus routability area-adjust is only a coarse analog.

**Review status:** source_grounded.

**Evidence sources:** paper.routability.2021.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.padding_spreads_hotspot_cells.v1"></a>
## strategy.congestion.padding_spreads_hotspot_cells.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is positive and a legal global padding value is configured. Increasing place.cell_padding_x is only a coarse spreading analog.

**Diagnosis:** global padding as congestion relief.

**Required evidence:** route_la_total_overflow, place.cell_padding_x.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.cell_padding_x` (coarse analog)

**Binding limits:** Global place-stage padding is only a coarse analog of local padding. No controlled knob preserves separate legalization spacing or writes floorplan global_right_padding.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023, doc.openroad.gpl, paper.ripple2.2016.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.use_neighborhood_and_pin_features.v1"></a>
## strategy.congestion.use_neighborhood_and_pin_features.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and detailed-route violations are positive. Use the available aggregate scalar evidence to constrain a padding trial; do not claim that unavailable spatial features selected a hotspot.

**Diagnosis:** aggregate features for padding trial.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count.

**Action intent:** increase cell padding (`increase_cell_padding`).

**Effects:** route_la_total_overflow decrease.

**Anti-conditions:** .

**ECOS analog:** increase `place.cell_padding_x` (coarse analog)

**Binding limits:** Global place-stage padding is only a coarse analog of local padding. No controlled knob preserves separate legalization spacing or writes floorplan global_right_padding.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.recycle_padding_outside_hotspot.v1"></a>
## strategy.congestion.recycle_padding_outside_hotspot.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is clean while positive global padding remains configured. Reduce padding only as a controlled wirelength trial; no spatial claim is available.

**Diagnosis:** padding reduction after clean route.

**Required evidence:** route_la_total_overflow, place.cell_padding_x.

**Action intent:** recycle padding outside hotspot (`recycle_padding_outside_hotspot`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow unchanged.

**Anti-conditions:** .

**ECOS analog:** decrease `place.cell_padding_x` (coarse analog)

**Binding limits:** ECOS padding is global, not per-cell. Decreasing it requires verified hotspot clearance; no separate legalization padding knob is authorized.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023, paper.diffnet, paper.ntuplace4dr.2018.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.avoid_early_overpadding.v1"></a>
## strategy.congestion.avoid_early_overpadding.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is clean while padding is configured. Keep this no-action guard to prevent escalating over-padding without terminal route evidence of a need for more relief.

**Diagnosis:** coarse relief without routed overflow.

**Required evidence:** route_la_total_overflow, place.cell_padding_x.

**Action intent:** cap inflation aggressiveness (`cap_inflation_aggressiveness`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** ECOS has no max-inflation-ratio knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023, doc.openroad.gpl, paper.ripple2.2016.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.keep_padding_into_legalization.v1"></a>
## strategy.congestion.keep_padding_into_legalization.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and detailed-route violations are positive while padding is configured. Treat legalization preservation as an evidence requirement, not as a capability claim, because no per-cell legalization-padding metric is exposed.

**Diagnosis:** relief not yet terminally validated.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count, place.cell_padding_x.

**Action intent:** preserve padding through legalization (`preserve_padding_through_legalization`).

**Effects:** route_la_total_overflow decrease.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. The seven controlled knobs do not expose a separate legalization spacing control; increasing place padding does not guarantee preservation into legalization.

**Review status:** source_grounded.

**Evidence sources:** paper.puffer.2023.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.enable_congestion_guided_area_adjust.v1"></a>
## strategy.congestion.enable_congestion_guided_area_adjust.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is positive while place.routability_opt is false. Enable congestion-guided area adjustment as a bounded legal trial and validate route-level overflow afterward.

**Diagnosis:** routability area adjust under route overflow.

**Required evidence:** route_la_total_overflow, place.routability_opt.

**Action intent:** enable routability adjustment (`enable_routability_adjustment`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** enable `place.routability_opt` (exact analog)

**Binding limits:** Subject to current stage, evidence, and legal action constraints.

**Review status:** source_grounded.

**Evidence sources:** doc.openroad.gpl, paper.polar2.2014, paper.replace.2019.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.timing_overflow_tradeoff.v1"></a>
## strategy.congestion.timing_overflow_tradeoff.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is positive and setup WNS is negative. Further spreading may trade routability for timing; preserve timing as a terminal guardrail rather than inferring a local timing hotspot.

**Diagnosis:** route overflow timing tradeoff.

**Required evidence:** route_la_total_overflow, sta_setup_wns.

**Action intent:** preserve timing on critical cells (`preserve_timing_on_critical_cells`).

**Effects:** route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized place-stage net-weight or slack knob. This intent can block other bindings, not write one.

**Review status:** source_grounded.

**Evidence sources:** doc.openroad.gpl, paper.timingdriven.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.crude_vs_accurate_demand_model.v1"></a>
## strategy.congestion.crude_vs_accurate_demand_model.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and routed wirelength are positive. Compare terminal scalar outcomes instead of claiming unobserved spatial demand models.

**Diagnosis:** placement proxy vs route scalar gap.

**Required evidence:** route_la_total_overflow, route_wirelength.

**Action intent:** recheck congestion model (`recheck_congestion_model`).

**Effects:** route_la_total_overflow unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Diagnosis only. No authorized knob changes the congestion estimator.

**Review status:** source_grounded.

**Evidence sources:** doc.openroad.gpl, paper.puffer.2023, paper.simplr.2012, paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.macro_or_narrow_channel.v1"></a>
## strategy.congestion.macro_or_narrow_channel.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place, floorplan.

**Condition:** Routed overflow and detailed-route violations are positive. Use area/padding relief only as a coarse trial; scalar metrics do not localize the cause.

**Diagnosis:** aggregate area pressure without spatial localization.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count.

**Action intent:** inflate cells in hotspot (`inflate_cells_in_hotspot`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** enable `place.routability_opt`; increase `place.cell_padding_x` (coarse analog)

**Binding limits:** ECOS has no per-cell inflation API; routability area-adjust plus padding is the legal analog.

**Review status:** source_grounded.

**Evidence sources:** paper.ripple2.2016, paper.ntuplace4h.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.keep_wirelength_seed.v1"></a>
## strategy.congestion.keep_wirelength_seed.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow and routed wirelength are both available. Preserve the incumbent route-level wirelength as a guardrail while testing congestion relief; placement proxies cannot certify a good routed seed.

**Diagnosis:** route wirelength guardrail during relief.

**Required evidence:** route_la_total_overflow, route_wirelength.

**Action intent:** keep good wirelength seed (`keep_good_wirelength_seed`).

**Effects:** route_wirelength unchanged; route_la_total_overflow may_decrease.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** Constraint on other relief, not a writable knob.

**Review status:** source_grounded.

**Evidence sources:** paper.polar2.2014.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.lower_packing_when_overflow_persists.v1"></a>
## strategy.congestion.lower_packing_when_overflow_persists.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow is positive while a legal target density is configured. Decrease target density as a coarse packing-relief trial and validate route-level overflow.

**Diagnosis:** lower packing under route overflow.

**Required evidence:** route_la_total_overflow, place.target_density.

**Action intent:** decrease packing density (`decrease_packing_density`).

**Effects:** route_la_total_overflow decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `place.target_density` (coarse analog)

**Binding limits:** This place-only binding lowers target density. Legacy floorplan.utilitization is represented by the separate floorplan.core_util source-derived exploration, not an exact mapping of this paper claim.

**Review status:** source_grounded.

**Evidence sources:** paper.simplr.2012, paper.replace.2019.

**Source evidence:** **general.statements**, **general.bindings**

<a id="strategy.congestion.trial_tighter_density_convergence.v1"></a>
## strategy.congestion.trial_tighter_density_convergence.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. The only metric trigger is positive routed overflow; decreasing place.target_overflow tightens one placement convergence threshold and is not a route-overflow guarantee. Retain terminal routing, timing, DRC and budget guards. It is not native placement density overflow.

**Diagnosis:** placement convergence threshold exploration.

**Required evidence:** route_la_total_overflow, place.target_overflow.

**Action intent:** tighten density overflow trial (`tighten_density_overflow_trial`).

**Effects:** route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `place.target_overflow` (coarse analog)

**Binding limits:** Tighten only within the continuous legal (0,1) domain. The native predicate also tests HPWL and max density. A lower threshold does not guarantee more iterations or better routed QoR.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.overflow_stopping.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.overflow_stopping**

<a id="strategy.congestion.trial_stronger_initial_density_penalty.v1"></a>
## strategy.congestion.trial_stronger_initial_density_penalty.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Positive routed overflow motivates a trial of the initial density penalty; place.density_weight is not a fixed multiplier on final density or routing congestion. It is not native placement density overflow. Retain terminal routing, timing, DRC and budget guards.

**Diagnosis:** initial density penalty exploration.

**Required evidence:** route_la_total_overflow, place.density_weight.

**Action intent:** increase initial density penalty trial (`increase_initial_density_penalty_trial`).

**Effects:** route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.density_weight` (coarse analog)

**Binding limits:** The configured coefficient initializes a gradient-balanced penalty; adaptive updates and routability reinitialization can dominate later behavior. Hold target_overflow and routability_opt fixed during the trial.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.density_weight_initialization.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.density_weight_initialization**

<a id="strategy.congestion.trial_core_whitespace.v1"></a>
## strategy.congestion.trial_core_whitespace.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. In die-util mode, positive routed overflow motivates decreasing floorplan.core_util to explore more whitespace. The source proves the area mechanism, not a QoR outcome. Retain terminal routing, timing, DRC and budget guards.

**Diagnosis:** core whitespace exploration under route overflow.

**Required evidence:** route_la_total_overflow, floorplan_die_util_mode, floorplan.core_util.

**Action intent:** increase core whitespace trial (`increase_core_whitespace_trial`).

**Effects:** route_la_total_overflow may_decrease; core_area may_increase; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `floorplan.core_util` (coarse analog)

**Binding limits:** Canonical controlled identity for legacy floorplan.utilitization. Active only in die-util mode, not explicit die-size mode. Core area is cell area divided by utilization before alignment; larger area may hurt wirelength and area constraints.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.statements**, **general.bindings**, **source.ifp.core_geometry**

<a id="strategy.congestion.trial_tighter_target_density.v1"></a>
## strategy.congestion.trial_tighter_target_density.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Routed overflow and DRC are clean while target density and routed wirelength are available; increasing place.target_density is a wirelength trial, not proof that placement density or routed overflow will improve. Retain timing and route guardrails.

**Diagnosis:** target density wirelength exploration.

**Required evidence:** route_la_total_overflow, drc_count, route_wirelength, place.target_density.

**Action intent:** tighten target density trial (`tighten_target_density_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.target_density` (coarse analog)

**Binding limits:** The configured target density bounds the placement density objective; hold target_overflow and routability_opt fixed during the trial and keep terminal DRC and timing guards.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.density_weight_initialization.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.density_weight_initialization**

<a id="strategy.congestion.trial_reduce_placement_padding.v1"></a>
## strategy.congestion.trial_reduce_placement_padding.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Routed overflow and DRC are clean while positive global padding remains configured; decreasing place.cell_padding_x is a wirelength trial that may re-introduce routed overflow. Retain terminal routing, timing, DRC and budget guards.

**Diagnosis:** placement padding wirelength exploration.

**Required evidence:** route_la_total_overflow, drc_count, route_wirelength, place.cell_padding_x.

**Action intent:** reduce placement padding trial (`reduce_placement_padding_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `place.cell_padding_x` (coarse analog)

**Binding limits:** Global placement padding only pads movable cells during global placement; terminal routing, DRC, and timing validation remains required after the trial.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.basic_place.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.basic_place**

<a id="strategy.congestion.trial_disable_routability_relief.v1"></a>
## strategy.congestion.trial_disable_routability_relief.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Routability relief is configured while routed overflow and DRC are clean; disabling place.routability_opt is a wirelength trial that may re-introduce routed overflow. Retain terminal routing, timing, DRC and budget guards.

**Diagnosis:** routability relief wirelength exploration.

**Required evidence:** route_la_total_overflow, drc_count, route_wirelength, place.routability_opt.

**Action intent:** disable routability relief trial (`disable_routability_relief_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** disable `place.routability_opt` (coarse analog)

**Binding limits:** Routability relief reinitializes placement with inflated node sizes; disabling it removes that inflation for later placements and terminal congestion validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.basic_place.

**Source evidence:** **general.statements**, **general.bindings**, **source.dreamplace.basic_place**

<a id="strategy.congestion.trial_core_whitespace_variable_geometry.v1"></a>
## strategy.congestion.trial_core_whitespace_variable_geometry.v1

**Topic:** congestion strategy.

**Objective metric:** route_la_total_overflow.

**Proxy scope:** congestion corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan, place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Positive routed overflow and positive core area motivate decreasing floorplan.core_util in variable-geometry mode; this is not a die-size or QoR guarantee. Retain terminal routing, timing, DRC and budget guards.

**Diagnosis:** variable geometry core whitespace exploration.

**Required evidence:** route_la_total_overflow, core_area, floorplan.core_util.

**Action intent:** increase core whitespace trial (`increase_core_whitespace_trial`).

**Effects:** route_la_total_overflow may_decrease; route_wirelength may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `floorplan.core_util` (coarse analog)

**Binding limits:** Canonical controlled identity for legacy floorplan.utilitization. Active only in die-util mode, not explicit die-size mode. Core area is cell area divided by utilization before alignment; larger area may hurt wirelength and area constraints.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.statements**, **general.bindings**, **source.ifp.core_geometry**
