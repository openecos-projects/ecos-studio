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

**Paper sources:** paper.wirelength.wot_the_l.2018, paper.wirelength.autodmp.2023.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

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

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**

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

**Anti-conditions:** rebound_within_replay_noise, downstream_evidence_unavailable.

**ECOS analog:** No authorized knob. Do not invent one.

**Paper sources:** paper.wirelength.ropt.2013.

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

**Paper sources:** paper.wirelength.chipbench.2025.

**Source evidence:** **general.wirelength.statements**, **general.wirelength.bindings**
