<a id="strategy.wirelength.validate_route_after_proxy_gain.v1"></a>
## strategy.wirelength.validate_route_after_proxy_gain.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** Placement HPWL or FLUTE wirelength improves, but the candidate has not yet been validated through route.

**Diagnosis:** placement proxy terminal gap.

**Required evidence:** place_hpwl, place_flute_wirelength, route_wirelength, route_dr_total_wirelength, route_dr_total_violation_count, route_la_total_overflow, drc_count, sta_setup_wns, sta_setup_tns, sta_hold_wns, sta_hold_tns.

**Action intent:** validate routed wirelength after proxy gain (`validate_routed_wirelength_after_proxy_gain`).

**Effects:** route_wirelength unchanged.

**Anti-conditions:** route_execution_not_authorized, parent_terminal_reference_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.chipbench.2025, paper.wirelength.autodmp.2023.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

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

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.wot_the_l.2018, paper.wirelength.autodmp.2023.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.reduce_excessive_place_spreading.v1"></a>
## strategy.wirelength.reduce_excessive_place_spreading.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** Routed congestion and DRC counts are exactly zero, all four timing metrics are non-regressing against a hash-bound terminal reference, routed wirelength has increased, and place padding or routability optimization is configured. This is a trial to reduce configured relief, not evidence that its native consumer was effective.

**Diagnosis:** excessive place spreading after routability is clean.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count, drc_count, route_wirelength, delta.route_wirelength, routability_relief_configured, delta.sta_setup_wns, delta.sta_setup_tns, delta.sta_hold_wns, delta.sta_hold_tns.

**Action intent:** reduce excessive place spreading (`reduce_excessive_place_spreading`).

**Effects:** route_wirelength may_decrease; congestion may_increase.

**Anti-conditions:** negative_delta.sta_setup_wns, negative_delta.sta_setup_tns, negative_delta.sta_hold_wns, negative_delta.sta_hold_tns.

**ECOS analog:** increase `place.target_density`; decrease `place.cell_padding_x`; disable `place.routability_opt` (coarse analog)

**Binding limits:** Global place controls are the authorized analog for reducing excessive spreading after congestion, DRC, and timing guards pass.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.replace.2019, paper.wirelength.dreamplace3.2020, paper.wirelength.autodmp.2023.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.reject_guardrail_regression.v1"></a>
## strategy.wirelength.reject_guardrail_regression.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** A place-stage parameter candidate improves HPWL, FLUTE, or routed wirelength but worsens congestion, DRC, or timing against the parent terminal reference.

**Diagnosis:** wirelength gain violates non regression constraint.

**Required evidence:** parent_terminal_reference, route_wirelength, route_dr_total_violation_count, route_la_total_overflow, drc_count, sta_setup_wns, sta_setup_tns, sta_hold_wns, sta_hold_tns.

**Action intent:** reject wirelength guardrail regression (`reject_wirelength_guardrail_regression`).

**Effects:** congestion unchanged; timing unchanged.

**Anti-conditions:** parent_terminal_reference_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.chipbench.2025, paper.wirelength.dreamplace4.2022, paper.wirelength.replace.2019.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

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

**Anti-conditions:** parent_terminal_reference_unavailable, downstream_evidence_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.ropt.2013.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

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

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.chipbench.2025.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.trial_wide_core_shape.v1"></a>
## strategy.wirelength.trial_wide_core_shape.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. The configured core aspect ratio is above one in die-util mode. Explore decreasing floorplan.aspect_ratio at fixed core utilization. The current value above or below one motivates only the trial direction; the action contract does not prevent crossing one or guarantee less elongation. Squaring a fixed-area rectangle reduces its geometric perimeter, not necessarily net wirelength; macro channels and IO geometry may favor elongation.

**Diagnosis:** core shape wirelength tradeoff.

**Required evidence:** floorplan_die_util_mode, floorplan_aspect_ratio_offset.

**Action intent:** reduce wide core elongation trial (`reduce_wide_core_elongation_trial`).

**Effects:** route_wirelength may_decrease; congestion may_increase; timing may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `floorplan.aspect_ratio` (coarse analog)

**Binding limits:** Try a lower or higher configured aspect ratio according to the current side of one. This direction does not constrain a proposal from crossing one and does not guarantee less elongation. Site-grid alignment affects realized dimensions. Fixed macros, IO and routing anisotropy can invalidate a QoR benefit; terminal validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**

<a id="strategy.wirelength.trial_tall_core_shape.v1"></a>
## strategy.wirelength.trial_tall_core_shape.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. The configured core aspect ratio is below one in die-util mode. Explore increasing floorplan.aspect_ratio at fixed core utilization. The current value above or below one motivates only the trial direction; the action contract does not prevent crossing one or guarantee less elongation. Squaring a fixed-area rectangle reduces its geometric perimeter, not necessarily net wirelength; macro channels and IO geometry may favor elongation.

**Diagnosis:** core shape wirelength tradeoff.

**Required evidence:** floorplan_die_util_mode, floorplan_aspect_ratio_offset.

**Action intent:** reduce tall core elongation trial (`reduce_tall_core_elongation_trial`).

**Effects:** route_wirelength may_decrease; congestion may_increase; timing may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `floorplan.aspect_ratio` (coarse analog)

**Binding limits:** Try a lower or higher configured aspect ratio according to the current side of one. This direction does not constrain a proposal from crossing one and does not guarantee less elongation. Site-grid alignment affects realized dimensions. Fixed macros, IO and routing anisotropy can invalidate a QoR benefit; terminal validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**

<a id="strategy.wirelength.trial_weaker_initial_density_penalty.v1"></a>
## strategy.wirelength.trial_weaker_initial_density_penalty.v1

**Topic:** wirelength strategy.

**Metric:** wirelength.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. Routed congestion and DRC counts are exactly zero, all four timing metrics are non-regressing, and routed wirelength increased against the terminal reference. Explore a smaller initial density coefficient while keeping target density, overflow threshold and routability mode fixed.

**Diagnosis:** initial density wirelength tradeoff.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count, drc_count, delta.route_wirelength, place.density_weight, delta.sta_setup_wns, delta.sta_setup_tns, delta.sta_hold_wns, delta.sta_hold_tns.

**Action intent:** decrease initial density penalty trial (`decrease_initial_density_penalty_trial`).

**Effects:** route_wirelength may_decrease; congestion may_increase; placement_density_overflow may_increase.

**Anti-conditions:** negative.delta.sta_setup_wns, negative.delta.sta_setup_tns, negative.delta.sta_hold_wns, negative.delta.sta_hold_tns.

**ECOS analog:** decrease `place.density_weight` (coarse analog)

**Binding limits:** A smaller coefficient changes initial density-versus-wirelength balancing only; this is not proof that density weight caused the wirelength regression.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.density_weight_initialization.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.dreamplace.density_weight_initialization**
