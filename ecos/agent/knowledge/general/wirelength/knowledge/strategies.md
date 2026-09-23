<a id="strategy.wirelength.validate_route_after_proxy_gain.v1"></a>
## strategy.wirelength.validate_route_after_proxy_gain.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Placement proxies such as HPWL or FLUTE are intermediate evidence only. When route-level metrics are available, validate the candidate with routed wirelength and routing feasibility before treating a proxy gain as an optimization outcome.

**Diagnosis:** placement proxy requires route validation.

**Required evidence:** place_hpwl, route_wirelength, route_la_total_overflow, route_dr_total_violation_count.

**Action intent:** validate routed wirelength after proxy gain (`validate_routed_wirelength_after_proxy_gain`).

**Effects:** route_wirelength unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.chipbench.2025, paper.wirelength.autodmp.2023.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.reduce_excessive_place_spreading.v1"></a>
## strategy.wirelength.reduce_excessive_place_spreading.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Routed overflow, detailed-route violations, and DRC are clean, while routed wirelength is positive and the candidate is worse than its reference on routed wirelength. Reduce excessive place-stage spreading only through the bound legal knobs; timing deltas remain guardrails.

**Diagnosis:** routed wirelength spreading tradeoff.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count, drc_count, route_wirelength, delta.route_wirelength, routability_relief_configured.

**Action intent:** reduce excessive place spreading (`reduce_excessive_place_spreading`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `place.target_density`; decrease `place.cell_padding_x`; disable `place.routability_opt` (coarse analog)

**Binding limits:** Global place controls are the authorized analog for reducing excessive spreading after congestion, DRC, and timing guards pass.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.replace.2019, paper.wirelength.dreamplace3.2020, paper.wirelength.autodmp.2023.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.reject_guardrail_regression.v1"></a>
## strategy.wirelength.reject_guardrail_regression.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** A candidate reduces routed wirelength relative to its reference but worsens setup WNS and has route-level evidence. Reject or abstain when the terminal guardrail regresses; routed wirelength gain alone is insufficient. Reject the wirelength candidate when WNS/TNS timing guardrails regress.

**Diagnosis:** routed wirelength guardrail regression.

**Required evidence:** delta.route_wirelength, delta.sta_setup_wns, route_wirelength, route_la_total_overflow.

**Action intent:** reject wirelength guardrail regression (`reject_wirelength_guardrail_regression`).

**Effects:** route_la_total_overflow unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.chipbench.2025, paper.wirelength.dreamplace4.2022, paper.wirelength.replace.2019.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.reject_post_legalization_rebound.v1"></a>
## strategy.wirelength.reject_post_legalization_rebound.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** The candidate has positive routed wirelength and a positive routed-wirelength delta after downstream evidence is available. Treat the terminal route result as authoritative; do not promote an earlier placement or global-routing proxy gain.

**Diagnosis:** terminal routed wirelength rebound.

**Required evidence:** route_wirelength, delta.route_wirelength, route_la_total_overflow.

**Action intent:** reject post legalization rebound (`reject_post_legalization_rebound`).

**Effects:** route_wirelength unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.ropt.2013.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.reject_macro_hpwl_only_gain.v1"></a>
## strategy.wirelength.reject_macro_hpwl_only_gain.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Placement HPWL improves relative to the reference while routed wirelength, routed overflow, and setup WNS worsen. Reject the proxy-only gain; route-level metrics and timing guardrails decide. MacroHPWL improves but congestion, routed wirelength, WNS, and TNS degrade.

**Diagnosis:** proxy gain without routed gain.

**Required evidence:** delta.place_hpwl, delta.route_wirelength, delta.route_la_total_overflow, delta.sta_setup_wns.

**Action intent:** reject macro hpwl only gain (`reject_macro_hpwl_only_gain`).

**Effects:** route_la_total_overflow unchanged.

**Anti-conditions:** .

**ECOS analog:** No authorized knob. Do not invent one.

**Binding limits:** No authorized knob. Do not invent one.

**Review status:** source_grounded.

**Evidence sources:** paper.wirelength.chipbench.2025.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

<a id="strategy.wirelength.trial_wide_core_shape.v1"></a>
## strategy.wirelength.trial_wide_core_shape.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. The configured core aspect ratio is above one in die-util mode. Explore decreasing floorplan.aspect_ratio at fixed core utilization. The current value above or below one motivates only the trial direction; the action contract does not prevent crossing one or guarantee less elongation. Squaring a fixed-area rectangle reduces its geometric perimeter, not necessarily net wirelength; macro channels and IO geometry may favor elongation.

**Diagnosis:** wide core shape wirelength exploration.

**Required evidence:** route_wirelength, core_area, floorplan_die_util_mode, floorplan_aspect_ratio_offset.

**Action intent:** reduce wide core elongation trial (`reduce_wide_core_elongation_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `floorplan.aspect_ratio` (coarse analog)

**Binding limits:** Try a lower or higher configured aspect ratio according to the current side of one. This direction does not constrain a proposal from crossing one and does not guarantee less elongation. Site-grid alignment affects realized dimensions. Fixed macros, IO and routing anisotropy can invalidate a QoR benefit; terminal validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**

<a id="strategy.wirelength.trial_tall_core_shape.v1"></a>
## strategy.wirelength.trial_tall_core_shape.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. The configured core aspect ratio is below one in die-util mode. Explore increasing floorplan.aspect_ratio at fixed core utilization. The current value above or below one motivates only the trial direction; the action contract does not prevent crossing one or guarantee less elongation. Squaring a fixed-area rectangle reduces its geometric perimeter, not necessarily net wirelength; macro channels and IO geometry may favor elongation.

**Diagnosis:** tall core shape wirelength exploration.

**Required evidence:** route_wirelength, core_area, floorplan_die_util_mode, floorplan_aspect_ratio_offset.

**Action intent:** reduce tall core elongation trial (`reduce_tall_core_elongation_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `floorplan.aspect_ratio` (coarse analog)

**Binding limits:** Try a lower or higher configured aspect ratio according to the current side of one. This direction does not constrain a proposal from crossing one and does not guarantee less elongation. Site-grid alignment affects realized dimensions. Fixed macros, IO and routing anisotropy can invalidate a QoR benefit; terminal validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**

<a id="strategy.wirelength.trial_weaker_initial_density_penalty.v1"></a>
## strategy.wirelength.trial_weaker_initial_density_penalty.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. Routed congestion and DRC counts are exactly zero, all four timing metrics are non-regressing, and routed wirelength increased against the terminal reference. Explore a smaller initial density coefficient while keeping target density, overflow threshold and routability mode fixed.

**Diagnosis:** initial density penalty wirelength exploration.

**Required evidence:** route_la_total_overflow, route_dr_total_violation_count, drc_count, delta.route_wirelength, place.density_weight.

**Action intent:** decrease initial density penalty trial (`decrease_initial_density_penalty_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `place.density_weight` (coarse analog)

**Binding limits:** A smaller coefficient changes initial density-versus-wirelength balancing only; this is not proof that density weight caused the wirelength regression.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.dreamplace.density_weight_initialization.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.dreamplace.density_weight_initialization**

<a id="strategy.wirelength.trial_tighter_core_area.v1"></a>
## strategy.wirelength.trial_tighter_core_area.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. In die-util mode, increase positive floorplan.core_util within the legal (0,1] domain to shrink the core area that cells must span at fixed aspect ratio. The source proves the area mechanism, not that a tighter core improves routed wirelength; denser packing can raise congestion and erosion of timing margin, and site-grid alignment changes realized dimensions.

**Diagnosis:** core area wirelength exploration.

**Required evidence:** route_wirelength, core_area, floorplan_die_util_mode, floorplan.core_util.

**Action intent:** reduce core area wirelength trial (`reduce_core_area_wirelength_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `floorplan.core_util` (coarse analog)

**Binding limits:** Canonical controlled identity for legacy floorplan.utilitization. Active only in die-util mode, not explicit die-size mode. Core area is cell area divided by utilization before alignment; a tighter core shortens the geometric span but raises local density, and macro placement plus site-grid alignment can offset the wirelength benefit.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**

<a id="strategy.wirelength.trial_tall_core_shape_variable_geometry.v1"></a>
## strategy.wirelength.trial_tall_core_shape_variable_geometry.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan, place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. The measured aspect-ratio offset is negative while the configured aspect ratio is positive, so the core is taller than the configured shape; increasing floorplan.aspect_ratio moves the re-derived core shape back toward square in variable-geometry mode. This is a wirelength reshape trial from a stage where the geometry stays re-derivable, not a guaranteed gain.

**Diagnosis:** variable geometry tall shape exploration.

**Required evidence:** route_wirelength, core_area, floorplan.aspect_ratio, floorplan_aspect_ratio_offset.

**Action intent:** reduce tall core elongation trial (`reduce_tall_core_elongation_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** increase `floorplan.aspect_ratio` (coarse analog)

**Binding limits:** Try a lower or higher configured aspect ratio according to the current side of one. This direction does not constrain a proposal from crossing one and does not guarantee less elongation. Site-grid alignment affects realized dimensions. Fixed macros, IO and routing anisotropy can invalidate a QoR benefit; terminal validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**

<a id="strategy.wirelength.trial_wide_core_shape_variable_geometry.v1"></a>
## strategy.wirelength.trial_wide_core_shape_variable_geometry.v1

**Topic:** wirelength strategy.

**Objective metric:** route_wirelength.

**Proxy scope:** wirelength corpus labels are not substitutes for the route-level objective.

**Applies to steps:** floorplan, place.

**Condition:** Source-derived bounded exploratory hypothesis, not paper-validated efficacy. Change one legal parameter at a time; retain terminal routing, timing, DRC and budget guards. The measured aspect-ratio offset is positive while the configured aspect ratio is positive, so the core is wider than the configured shape; decreasing floorplan.aspect_ratio moves the re-derived core shape back toward square in variable-geometry mode. This is a wirelength reshape trial from a stage where the geometry stays re-derivable, not a guaranteed gain.

**Diagnosis:** variable geometry wide shape exploration.

**Required evidence:** route_wirelength, core_area, floorplan.aspect_ratio, floorplan_aspect_ratio_offset.

**Action intent:** reduce wide core elongation trial (`reduce_wide_core_elongation_trial`).

**Effects:** route_wirelength may_decrease; route_la_total_overflow may_increase.

**Anti-conditions:** .

**ECOS analog:** decrease `floorplan.aspect_ratio` (coarse analog)

**Binding limits:** Try a lower or higher configured aspect ratio according to the current side of one. This direction does not constrain a proposal from crossing one and does not guarantee less elongation. Site-grid alignment affects realized dimensions. Fixed macros, IO and routing anisotropy can invalidate a QoR benefit; terminal validation remains required.

**Review status:** source_derived_hypothesis.

**Evidence sources:** source.ifp.core_geometry.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**, **source.ifp.core_geometry**
