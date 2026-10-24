<a id="parameter.legalization.replace_lower_pcof"></a>
## parameter.legalization.replace_lower_pcof

**Meaning:** The RePlAce lower coefficient.

**Role:** It participates in the RePlAce parameter-control range.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.replace_upper_pcof"></a>
## parameter.legalization.replace_upper_pcof

**Meaning:** The RePlAce upper coefficient.

**Role:** It participates in the RePlAce parameter-control range.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.replace_ref_hpwl"></a>
## parameter.legalization.replace_ref_hpwl

**Meaning:** The RePlAce reference HPWL.

**Role:** It calibrates RePlAce-style convergence or parameter updates.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.replace_skip_energy_flag"></a>
## parameter.legalization.replace_skip_energy_flag

**Meaning:** The RePlAce energy-skip flag.

**Role:** It controls whether the related energy calculation participates in RePlAce iterations.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.adjust_gpugr_area_flag"></a>
## parameter.legalization.adjust_gpugr_area_flag

**Meaning:** The GPUGR area-adjustment switch.

**Role:** It selects GPUGR global routing as the congestion-map source for routability-driven node-area adjustment and takes precedence over the NCTUgr and RUDY map sources.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.adjust_nctugr_area_flag"></a>
## parameter.legalization.adjust_nctugr_area_flag

**Meaning:** The legacy EGR area-adjustment switch.

**Role:** It selects the ECC/iRT EGR congestion map for node-area adjustment without invoking NCTUgr itself; the GPUGR switch takes precedence when both are set.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.adjust_pin_area_flag"></a>
## parameter.legalization.adjust_pin_area_flag

**Meaning:** The pin-density area-adjustment switch.

**Role:** It uses pin-density information to adjust node area.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.adjust_rudy_area_flag"></a>
## parameter.legalization.adjust_rudy_area_flag

**Meaning:** The RUDY area-adjustment switch.

**Role:** It uses RUDY congestion estimates to adjust node area.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.area_adjust_stop_ratio"></a>
## parameter.legalization.area_adjust_stop_ratio

**Meaning:** The area-adjustment stopping ratio.

**Role:** It stops the related adjustment when area changes converge to this ratio.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.auto_adjust_bins"></a>
## parameter.legalization.auto_adjust_bins

**Meaning:** Whether DreamPlace may adjust density bins automatically.

**Role:** The legalization runner forces it to `1` for its legalize-only setup.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.aux_input"></a>
## parameter.legalization.aux_input

**Meaning:** The Bookshelf AUX input descriptor.

**Role:** It supplies the design entry point for Bookshelf-format input.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.base_design_name"></a>
## parameter.legalization.base_design_name

**Meaning:** The base design name.

**Role:** It is used to name placement outputs and intermediate files.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.bndry_padding_x"></a>
## parameter.legalization.bndry_padding_x

**Meaning:** The placement-boundary padding along X.

**Role:** It shrinks the effective horizontal placement range of movable cells.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.bndry_padding_y"></a>
## parameter.legalization.bndry_padding_y

**Meaning:** The placement-boundary padding along Y.

**Role:** It shrinks the effective vertical placement range of movable cells.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_continuous_relaxed_optimization"></a>
## parameter.legalization.buffering_continuous_relaxed_optimization

**Meaning:** The continuous relaxed-buffer optimization switch.

**Role:** It enables relaxed repeater-count optimization in the joint buffering lane.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_continuous_steps"></a>
## parameter.legalization.buffering_continuous_steps

**Meaning:** The standalone buffering optimizer step count.

**Role:** It bounds continuous buffering optimization before discrete projection.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_discrete_count_proximal_lambda"></a>
## parameter.legalization.buffering_discrete_count_proximal_lambda

**Meaning:** The proximal penalty for discrete repeater-count changes.

**Role:** It stabilizes discrete net-gradient updates around the relaxed repeater count.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_fixed_bsu_index"></a>
## parameter.legalization.buffering_fixed_bsu_index

**Meaning:** An optional fixed legal buffer index.

**Role:** It pins Segment buffering to one buffer master resolved from the legal buffer table.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_fixed_buffer_master"></a>
## parameter.legalization.buffering_fixed_buffer_master

**Meaning:** The physical buffer master used for Segment buffering.

**Role:** It selects the library cell inserted by Segment buffering.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_max_repeaters_per_segment"></a>
## parameter.legalization.buffering_max_repeaters_per_segment

**Meaning:** The maximum accepted repeaters on one segment.

**Role:** It caps physical repeater insertion during discrete buffering.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_mode"></a>
## parameter.legalization.buffering_mode

**Meaning:** The buffering representation.

**Role:** It selects the `segment` or `candidate` buffering lane and its matching defaults.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_route_b_selection_fraction"></a>
## parameter.legalization.buffering_route_b_selection_fraction

**Meaning:** The fraction of segment candidates selected in one discrete buffering batch.

**Role:** It controls how sparsely candidates are sampled during net-gradient buffering.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_count_timing_backend"></a>
## parameter.legalization.buffering_segment_count_timing_backend

**Meaning:** The timing implementation for Segment buffering.

**Role:** It selects the compiled segment-transfer backend used for repeater-count gradients.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_count_tns_gradient"></a>
## parameter.legalization.buffering_segment_count_tns_gradient

**Meaning:** The TNS-gradient switch for segment repeater counts.

**Role:** It adds total-negative-slack sensitivity to continuous count optimization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_count_z_init"></a>
## parameter.legalization.buffering_segment_count_z_init

**Meaning:** The initial relaxed repeater count on each segment.

**Role:** It seeds continuous segment-count optimization before projection.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_integer_projection_interval"></a>
## parameter.legalization.buffering_segment_integer_projection_interval

**Meaning:** The interval between periodic integer buffer projections.

**Role:** It schedules projection during global placement; zero disables periodic projection.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_integer_projection_project_bsu"></a>
## parameter.legalization.buffering_segment_integer_projection_project_bsu

**Meaning:** The buffer-master projection switch.

**Role:** It projects legal buffer master indices together with integer repeater counts.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_integer_projection_start_step"></a>
## parameter.legalization.buffering_segment_integer_projection_start_step

**Meaning:** The first step eligible for periodic buffer projection.

**Role:** It delays integer projection until the configured global-placement step.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_live_geometry"></a>
## parameter.legalization.buffering_segment_live_geometry

**Meaning:** The live-geometry timing switch.

**Role:** It refreshes buffered-segment timing from the current placement geometry.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_projection_min_z_to_insert"></a>
## parameter.legalization.buffering_segment_projection_min_z_to_insert

**Meaning:** The minimum relaxed count eligible for physical insertion.

**Role:** It gates which fractional repeater counts become physical buffers.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_strategy"></a>
## parameter.legalization.buffering_segment_strategy

**Meaning:** The segment-count optimization strategy.

**Role:** It selects continuous optimization or discrete net-gradient updates.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.buffering_segment_transfer_backend"></a>
## parameter.legalization.buffering_segment_transfer_backend

**Meaning:** The native segment timing-transfer implementation.

**Role:** It selects the backend used to propagate timing across buffered segments.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.cell_model_schema"></a>
## parameter.legalization.cell_model_schema

**Meaning:** The cell timing-model schema.

**Role:** It selects the piecewise-linear timing model; a null value inherits the flow default.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.cell_padding_x"></a>
## parameter.legalization.cell_padding_x

**Meaning:** The standard-cell padding along X, in sites.

**Role:** The legalization runner zeroes the configured padding, then resets it to the placement site width for the standalone legalization step.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.def_input"></a>
## parameter.legalization.def_input

**Meaning:** The input DEF path.

**Role:** It provides physical locations and constraints; ECOS replaces it with the current step input at runtime.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.density_weight"></a>
## parameter.legalization.density_weight

**Meaning:** The initial density-penalty coefficient.

**Role:** The actual value is the coefficient consumed by density-weight initialization, not the internal tensor that DREAMPlace updates during optimization or reinitializes after routability-driven area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.detailed_place_command"></a>
## parameter.legalization.detailed_place_command

**Meaning:** Additional command text for the external detailed placer.

**Role:** It is appended to the external detailed-placer invocation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.detailed_place_engine"></a>
## parameter.legalization.detailed_place_engine

**Meaning:** The external detailed-placer path.

**Role:** When the path exists, PlacementEngine invokes that tool after global placement.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.detailed_place_flag"></a>
## parameter.legalization.detailed_place_flag

**Meaning:** The detailed-placement enable flag.

**Role:** The legalization runner forces it to `0` for the standalone legalization step, so no detailed refinement follows legalization there.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.deterministic_flag"></a>
## parameter.legalization.deterministic_flag

**Meaning:** The deterministic-execution switch.

**Role:** It requests deterministic lower-level computation paths to reduce run-to-run variation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.diff_sizing_coefficients_cap"></a>
## parameter.legalization.diff_sizing_coefficients_cap

**Meaning:** The `diff_sizing_coefficients.cap` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.diff_sizing_coefficients_slew"></a>
## parameter.legalization.diff_sizing_coefficients_slew

**Meaning:** The `diff_sizing_coefficients.slew` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.diff_sizing_coefficients_tns"></a>
## parameter.legalization.diff_sizing_coefficients_tns

**Meaning:** The `diff_sizing_coefficients.tns` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.diff_sizing_coefficients_wns"></a>
## parameter.legalization.diff_sizing_coefficients_wns

**Meaning:** The `diff_sizing_coefficients.wns` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.diff_sizing_continuous_steps"></a>
## parameter.legalization.diff_sizing_continuous_steps

**Meaning:** The number of continuous differential-sizing steps.

**Role:** It bounds continuous sizing before discrete refinement; zero disables the continuous phase.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.diff_timing_driven_placement"></a>
## parameter.legalization.diff_timing_driven_placement

**Meaning:** The differentiable timing-driven placement switch.

**Role:** It adds timing gradients to the placement objective when enabled.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.differentiable_timing_obj"></a>
## parameter.legalization.differentiable_timing_obj

**Meaning:** The differentiable-timing-objective switch.

**Role:** The current ECOS execution boundary disables it, so it is not added to the placement objective.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.discrete_gradient_topk_shared_budget_percent"></a>
## parameter.legalization.discrete_gradient_topk_shared_budget_percent

**Meaning:** The percentage of sizeable cells sharing one size or VT action budget.

**Role:** It controls competition for a shared discrete optimization budget.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.discrete_gradient_topk_up_percent"></a>
## parameter.legalization.discrete_gradient_topk_up_percent

**Meaning:** The percentage of cells eligible for discrete upsizing.

**Role:** It limits the candidate set for discrete upsizing.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.discrete_gradient_topk_vt_percent"></a>
## parameter.legalization.discrete_gradient_topk_vt_percent

**Meaning:** The percentage of cells eligible for VT changes.

**Role:** It limits the candidate set for discrete threshold-voltage substitution.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.dtype"></a>
## parameter.legalization.dtype

**Meaning:** The placement-tensor data type.

**Role:** It affects numerical precision, memory use, and the type used by compiled operators.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.dump_global_place_solution_flag"></a>
## parameter.legalization.dump_global_place_solution_flag

**Meaning:** The global-placement solution dump switch.

**Role:** It controls whether the global-placement solution is saved before legalization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.dump_legalize_solution_flag"></a>
## parameter.legalization.dump_legalize_solution_flag

**Meaning:** The legalized-solution dump switch.

**Role:** It controls whether the legalizer result is saved.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.early_stop_restore_best"></a>
## parameter.legalization.early_stop_restore_best

**Meaning:** The early-stop best-state restore switch.

**Role:** It restores the best continuous sizing state instead of the final iterate.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.enable_fillers"></a>
## parameter.legalization.enable_fillers

**Meaning:** Whether filler nodes participate in the placement model.

**Role:** The legalization runner forces it to `0`, so it does not insert filler nodes.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.enable_net_weighting"></a>
## parameter.legalization.enable_net_weighting

**Meaning:** The net-weight-update switch.

**Role:** It controls whether timing or another strategy updates net weights in the placement objective.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.enhanced_inflation_flag"></a>
## parameter.legalization.enhanced_inflation_flag

**Meaning:** The enhanced inflation-controller switch.

**Role:** It enables the enhanced outer-loop inflation schedule.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.enhanced_inflation_replay_best_round_flag"></a>
## parameter.legalization.enhanced_inflation_replay_best_round_flag

**Meaning:** The enhanced-inflation best-round replay switch.

**Role:** It replays the best recorded round after inflated geometry is rolled back.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.evaluate_pl"></a>
## parameter.legalization.evaluate_pl

**Meaning:** The existing-placement evaluation-mode switch.

**Role:** When enabled, it disables the normal optimization path and evaluates the input placement.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.flow_kind"></a>
## parameter.legalization.flow_kind

**Meaning:** The optimization profile executed by the placement step.

**Role:** It selects placement, sizing, joint, buffering, or STA behavior and applies the matching defaults.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gamma"></a>
## parameter.legalization.gamma

**Meaning:** The wirelength smoothing parameter.

**Role:** It affects the curvature and gradient of the smooth wirelength approximation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.get_congestion_map"></a>
## parameter.legalization.get_congestion_map

**Meaning:** The congestion-map extraction switch.

**Role:** It computes a congestion map and aggregate congestion score after placement.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.global_place_flag"></a>
## parameter.legalization.global_place_flag

**Meaning:** Whether continuous global placement runs.

**Role:** The legalization runner forces it to `0`, so global placement is skipped regardless of the serialized default.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.global_place_stages"></a>
## parameter.legalization.global_place_stages

**Meaning:** The global-placement stage schedule.

**Role:** It defines bins, iterations, wirelength model, optimizer, and learning rate for each stage.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gp_noise_ratio"></a>
## parameter.legalization.gp_noise_ratio

**Meaning:** The global-placement initialization noise ratio.

**Role:** It sets the positional perturbation applied by random-center initialization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpu"></a>
## parameter.legalization.gpu

**Meaning:** Whether to request GPU execution.

**Role:** It selects CPU or CUDA execution for tensors and compiled operators.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpu_id"></a>
## parameter.legalization.gpu_id

**Meaning:** The CUDA device index.

**Role:** It selects the device that owns placement tensors and operators in GPU mode.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_area_adjust_congestion_mode"></a>
## parameter.legalization.gpugr_area_adjust_congestion_mode

**Meaning:** The GPUGR overflow aggregation mode for area adjustment.

**Role:** It selects the GPUGR overflow map converted into the routing-utilization map: `union` overflow or the per-direction maximum of raw (`max_hv`) or effective (`max_hv_effective`) overflow; other values are rejected during parameter normalization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_area_adjust_rrr_iters"></a>
## parameter.legalization.gpugr_area_adjust_rrr_iters

**Meaning:** The rip-up-and-reroute iteration count for GPUGR area-adjustment runs.

**Role:** `0` evaluates congestion from a single GPUGR routing pass; positive values request rip-up-and-reroute rounds and are rejected by the CPU backends.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_backend"></a>
## parameter.legalization.gpugr_backend

**Meaning:** The GPUGR backend selection.

**Role:** `auto` resolves to `cuda` when CUDA is available and the GPUGR extension has CUDA support, otherwise to `cpu_pr_mt`; an explicit `cuda` request without CUDA support fails, and the CPU backends reject positive RRR iteration counts.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_bottom_routing_layer"></a>
## parameter.legalization.gpugr_bottom_routing_layer

**Meaning:** The inclusive bottom routing layer passed to GPUGR.

**Role:** It sets the lower bound of the congestion-evaluation layer range; empty uses the first LEF routing layer.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_final_eval_flag"></a>
## parameter.legalization.gpugr_final_eval_flag

**Meaning:** The final GPUGR evaluation switch.

**Role:** It runs a routability evaluation after placement completes.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_final_eval_rrr_iters"></a>
## parameter.legalization.gpugr_final_eval_rrr_iters

**Meaning:** The RRR iteration count for the final GPUGR evaluation.

**Role:** It controls the effort of the post-placement routing evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.gpugr_top_routing_layer"></a>
## parameter.legalization.gpugr_top_routing_layer

**Meaning:** The inclusive top routing layer passed to GPUGR.

**Role:** It sets the upper bound of the congestion-evaluation layer range; empty uses the last LEF routing layer.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.ignore_net_degree"></a>
## parameter.legalization.ignore_net_degree

**Meaning:** The net-degree ignore threshold.

**Role:** It masks high-fanout nets so they do not dominate wirelength and selected evaluation operators.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.ignore_net_weight"></a>
## parameter.legalization.ignore_net_weight

**Meaning:** The threshold for ignoring high-weight nets.

**Role:** It filters excessively weighted nets from weighted-HPWL evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.inflation_min_interval"></a>
## parameter.legalization.inflation_min_interval

**Meaning:** The minimum interval between applied inflation rounds.

**Role:** It prevents another inflation update before the configured number of global-placement steps; zero disables the guard.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.init_loc_perc_x"></a>
## parameter.legalization.init_loc_perc_x

**Meaning:** The X percentage of the initial location.

**Role:** It defines the X coordinate of random-center initialization relative to the layout boundary.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.init_loc_perc_y"></a>
## parameter.legalization.init_loc_perc_y

**Meaning:** The Y percentage of the initial location.

**Role:** It defines the Y coordinate of random-center initialization relative to the layout boundary.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.joint_buffer_commit_period"></a>
## parameter.legalization.joint_buffer_commit_period

**Meaning:** The optimizer interval between joint physical-buffer commits.

**Role:** It controls how often joint optimization applies buffering changes to native geometry.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.joint_buffer_outer_iterations"></a>
## parameter.legalization.joint_buffer_outer_iterations

**Meaning:** The maximum number of refresh-separated joint optimizer windows.

**Role:** It bounds outer joint-optimization iterations.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.joint_quality_profile"></a>
## parameter.legalization.joint_quality_profile

**Meaning:** The optional canonical joint-optimization profile.

**Role:** It selects a predefined joint schedule and validates its required parameter combination.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.joint_segment_virtual_density_enabled"></a>
## parameter.legalization.joint_segment_virtual_density_enabled

**Meaning:** The virtual-buffer density switch.

**Role:** It includes persistent virtual buffer footprints in placement density.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_direction_use_gpugr"></a>
## parameter.legalization.l_direction_use_gpugr

**Meaning:** The L-direction GPUGR source switch.

**Role:** It resolves L-shaped routing directions from GPUGR entries instead of iRT EGR guides.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_capacity_al_enable"></a>
## parameter.legalization.l_shape_capacity_al_enable

**Meaning:** The L-shape capacity-memory switch.

**Role:** It uses per-routing-bin AL multiplier memory as the hard-GGR capacity-pressure source.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_grad_target_ratio"></a>
## parameter.legalization.l_shape_grad_target_ratio

**Meaning:** The target L-shape routing-gradient ratio.

**Role:** It balances the weighted routability gradient against the base wirelength and density gradient.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_grad_target_ratio_max"></a>
## parameter.legalization.l_shape_grad_target_ratio_max

**Meaning:** The maximum adaptive L-shape gradient ratio.

**Role:** It caps the routability gradient target during optimization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_gradient_mode"></a>
## parameter.legalization.l_shape_gradient_mode

**Meaning:** The L-shape routing-gradient mode.

**Role:** It selects fixed-field translation guidance or full differentiation through positions and segment dimensions.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_overflow_threshold"></a>
## parameter.legalization.l_shape_overflow_threshold

**Meaning:** The overflow threshold for L-shape routability activation.

**Role:** It allows disabled L-shape force to start or re-enable below the configured placement overflow.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_routability_flag"></a>
## parameter.legalization.l_shape_routability_flag

**Meaning:** The L-shape routability-objective switch.

**Role:** Together with `routability_opt_flag` it arms the L-shape routability density objective, which activates once density overflow falls below its threshold and adds GGR-topology L-direction supply/demand terms to the placement objective; enabling it fills conservative L-shape defaults for unset keys.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_update_interval"></a>
## parameter.legalization.l_shape_update_interval

**Meaning:** The L-shape topology refresh interval in optimizer iterations.

**Role:** While the L-shape objective is active, Steiner topologies, L-directions, and supply/demand targets are rebuilt every this many iterations; the value must normalize to a positive integer.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.l_shape_use_ggr_topology"></a>
## parameter.legalization.l_shape_use_ggr_topology

**Meaning:** The L-shape GGR-topology switch.

**Role:** It uses a GGR-exported topology pack instead of refreshing diff-side FLUTE topology.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.lef_input"></a>
## parameter.legalization.lef_input

**Meaning:** The LEF file set.

**Role:** It provides technology layers, sites, and cell geometry to the placement database.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.legalize_before_each_inflation_flag"></a>
## parameter.legalization.legalize_before_each_inflation_flag

**Meaning:** The pre-inflation legalization switch.

**Role:** It waits for the overflow target, legalizes geometry, evaluates congestion, and reapplies cumulative inflation before area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.legalize_flag"></a>
## parameter.legalization.legalize_flag

**Meaning:** Whether DreamPlace legalization runs.

**Role:** The legalization runner forces it to `1`, enabling the legalizer.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_halo_x"></a>
## parameter.legalization.macro_halo_x

**Meaning:** The macro halo along X.

**Role:** It expands the effective horizontal occupancy of movable macros in placement and density modeling.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_halo_y"></a>
## parameter.legalization.macro_halo_y

**Meaning:** The macro halo along Y.

**Role:** It expands the effective vertical occupancy of movable macros in placement and density modeling.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_only"></a>
## parameter.legalization.macro_only

**Meaning:** The macro-only placement switch.

**Role:** The macro-placement runner forces it to `1` so DreamPlace places only hard macros between the two floorplan phases; the serialized `0` default applies to normal placement runs.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_overlap_flag"></a>
## parameter.legalization.macro_overlap_flag

**Meaning:** The macro-overlap penalty switch.

**Role:** It controls whether the objective includes a macro-overlap penalty.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_overlap_mult_weight"></a>
## parameter.legalization.macro_overlap_mult_weight

**Meaning:** The macro-overlap penalty multiplier.

**Role:** It scales the update strength of the macro-overlap penalty.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_overlap_weight"></a>
## parameter.legalization.macro_overlap_weight

**Meaning:** The macro-overlap penalty weight.

**Role:** It sets the macro-overlap term's influence in the global-placement objective.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_pin_halo_x"></a>
## parameter.legalization.macro_pin_halo_x

**Meaning:** The macro-pin halo along X.

**Role:** It expands the horizontal macro-pin influence region for density or congestion modeling.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_pin_halo_y"></a>
## parameter.legalization.macro_pin_halo_y

**Meaning:** The macro-pin halo along Y.

**Role:** It expands the vertical macro-pin influence region for density or congestion modeling.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.macro_place_flag"></a>
## parameter.legalization.macro_place_flag

**Meaning:** The macro-placement switch.

**Role:** It enables macro preprocessing and macro-legalization paths.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.max_net_weight"></a>
## parameter.legalization.max_net_weight

**Meaning:** The net-weight upper bound.

**Role:** It prevents a small number of nets from dominating the placement objective.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.max_num_area_adjust"></a>
## parameter.legalization.max_num_area_adjust

**Meaning:** The maximum number of area adjustments.

**Role:** It limits repeated node-area adjustment during routability optimization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.max_pin_opt_adjust_rate"></a>
## parameter.legalization.max_pin_opt_adjust_rate

**Meaning:** The maximum pin-area-adjustment rate.

**Role:** It limits one round of pin-density-driven area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.max_route_opt_adjust_rate"></a>
## parameter.legalization.max_route_opt_adjust_rate

**Meaning:** The maximum routing area-adjustment rate.

**Role:** It limits node-area expansion in one routability-optimization round.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.momentum_decay_factor"></a>
## parameter.legalization.momentum_decay_factor

**Meaning:** The weight-update momentum decay.

**Role:** It smooths weight changes across iterations.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.net_weighting_scheme"></a>
## parameter.legalization.net_weighting_scheme

**Meaning:** The net-weighting scheme name.

**Role:** It selects the net-weight calculation or update strategy.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.node_area_adjust_overflow"></a>
## parameter.legalization.node_area_adjust_overflow

**Meaning:** The overflow threshold for node-area adjustment.

**Role:** It determines when congestion-driven placement begins area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.num_bins_x"></a>
## parameter.legalization.num_bins_x

**Meaning:** The number of density bins along X.

**Role:** It sets the spatial resolution for density, electric potential, and global-placement evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.num_bins_y"></a>
## parameter.legalization.num_bins_y

**Meaning:** The number of density bins along Y.

**Role:** It sets the spatial resolution for density, electric potential, and global-placement evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.num_threads"></a>
## parameter.legalization.num_threads

**Meaning:** The CPU thread count.

**Role:** It sets OpenMP and Torch parallel thread counts.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.openroad_vt_suffixes"></a>
## parameter.legalization.openroad_vt_suffixes

**Meaning:** The OpenROAD VT suffixes used to classify equivalent Liberty cells.

**Role:** It groups equivalent threshold-voltage cells for discrete substitution.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.overflow_reference_mode"></a>
## parameter.legalization.overflow_reference_mode

**Meaning:** The overflow-normalization reference mode.

**Role:** It selects whether the initial global-placement area or the current published movable area normalizes density overflow.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.piecewise_gradient_mode"></a>
## parameter.legalization.piecewise_gradient_mode

**Meaning:** The piecewise cell-gradient implementation.

**Role:** It selects the `linear6_ste` or `native_piecewise` gradient path.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin2pin_accumulate_weight"></a>
## parameter.legalization.pin2pin_accumulate_weight

**Meaning:** The pin-to-pin accumulated weight.

**Role:** It controls accumulation across pin-to-pin weight-update rounds.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin2pin_max_weight"></a>
## parameter.legalization.pin2pin_max_weight

**Meaning:** The maximum pin-to-pin weight.

**Role:** It limits the upper bound of pin-to-pin timing or connectivity weighting.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin2pin_min_weight"></a>
## parameter.legalization.pin2pin_min_weight

**Meaning:** The minimum pin-to-pin weight.

**Role:** It limits the lower bound of pin-to-pin timing or connectivity weighting.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin2pin_net_weighting"></a>
## parameter.legalization.pin2pin_net_weighting

**Meaning:** The pin-to-pin net-weighting switch.

**Role:** It controls whether pin-to-pin information feeds back into net weights.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin2pin_weight"></a>
## parameter.legalization.pin2pin_weight

**Meaning:** The base pin-to-pin weight.

**Role:** It supplies the initial scale for pin-to-pin weighting.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin_area_adjust_stop_ratio"></a>
## parameter.legalization.pin_area_adjust_stop_ratio

**Meaning:** The pin-area-adjustment stopping ratio.

**Role:** It controls convergence of pin-density-driven area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin_density"></a>
## parameter.legalization.pin_density

**Meaning:** The pin-density target or threshold.

**Role:** It participates in pin-density congestion estimation and area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.pin_stretch_ratio"></a>
## parameter.legalization.pin_stretch_ratio

**Meaning:** The pin-stretch ratio.

**Role:** It expands the effective pin influence region in pin-density estimation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.place_io_engine"></a>
## parameter.legalization.place_io_engine

**Meaning:** The physical database backend used by DREAMPlace.

**Role:** It selects the ECC-backed placement database.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.placement_initial_learning_rate_max"></a>
## parameter.legalization.placement_initial_learning_rate_max

**Meaning:** The optional cap on the estimated initial placement learning rate.

**Role:** It limits the first global-placement step size when present.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.placement_sizing_mode"></a>
## parameter.legalization.placement_sizing_mode

**Meaning:** The placement optimization lane.

**Role:** It selects placement-only, sizing-only, or joint placement and sizing.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.plot_flag"></a>
## parameter.legalization.plot_flag

**Meaning:** The plotting switch.

**Role:** It controls whether placement iterations produce graphical outputs.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.random_center_init_flag"></a>
## parameter.legalization.random_center_init_flag

**Meaning:** Whether random-center initialization runs.

**Role:** The legalization runner forces it to `0`, preserving the incoming placed state for legalization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.random_seed"></a>
## parameter.legalization.random_seed

**Meaning:** The random seed.

**Role:** It initializes Python, Torch, and CUDA random state for reproducible initial perturbations. Under a fixed seed the placement chain is bitwise-deterministic, producing identical signoff QoR across replays, so a seed change is a real QoR variable rather than measurement noise; ECOS pins candidate reruns to the workspace baseline seed so cross-candidate comparisons stay seed-matched.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.rc_tcl"></a>
## parameter.legalization.rc_tcl

**Meaning:** The OpenROAD RC setup Tcl script.

**Role:** It supplies parasitics setup, resolved relative to the PDK root when the path is relative.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.real_size_execution_mode"></a>
## parameter.legalization.real_size_execution_mode

**Meaning:** The real-size execution mode.

**Role:** It selects continuous-only sizing or a warmup-to-discrete transition.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.real_size_warmup_steps"></a>
## parameter.legalization.real_size_warmup_steps

**Meaning:** The number of real-size Adam steps before discrete transition.

**Role:** It sets the warmup duration for warmup-to-discrete execution.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.relaxed_buffer_timing_integration_mode"></a>
## parameter.legalization.relaxed_buffer_timing_integration_mode

**Meaning:** The virtual-buffer timing-integration provider.

**Role:** It selects how relaxed buffering participates in timing propagation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.result_dir"></a>
## parameter.legalization.result_dir

**Meaning:** The placement result directory.

**Role:** It receives DreamPlace logs and intermediate outputs.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.risa_weights"></a>
## parameter.legalization.risa_weights

**Meaning:** The RISA weighting switch.

**Role:** It controls whether the related weighting strategy participates in the objective or evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.routability_opt_flag"></a>
## parameter.legalization.routability_opt_flag

**Meaning:** The routability-optimization switch.

**Role:** A false request is effective when the algorithm is confirmed disabled. A true request requires an executed routability round to be effective; enabling the flag without executing a round is inactive after placement completes.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.route_area_adjust_stop_ratio"></a>
## parameter.legalization.route_area_adjust_stop_ratio

**Meaning:** The routing-area-adjustment stopping ratio.

**Role:** It controls convergence of routing-congestion-driven area adjustment.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.route_info_input"></a>
## parameter.legalization.route_info_input

**Meaning:** The routing-information input selection.

**Role:** It selects the routing-capacity or congestion information used by the placer.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.route_num_bins_x"></a>
## parameter.legalization.route_num_bins_x

**Meaning:** The routing-evaluation grid count along X.

**Role:** It sets the X resolution for routability and congestion estimation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.route_num_bins_y"></a>
## parameter.legalization.route_num_bins_y

**Meaning:** The routing-evaluation grid count along Y.

**Role:** It sets the Y resolution for routability and congestion estimation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.route_opt_adjust_exponent"></a>
## parameter.legalization.route_opt_adjust_exponent

**Meaning:** The routing-adjustment exponent.

**Role:** It shapes the nonlinear mapping from congestion to area-adjustment rate.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.scale_factor"></a>
## parameter.legalization.scale_factor

**Meaning:** The coordinate and wirelength conversion scale.

**Role:** It keeps placement-database values consistent during evaluation and output.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.shift_factor"></a>
## parameter.legalization.shift_factor

**Meaning:** The input-coordinate shift.

**Role:** It changes the coordinate origin while input data is loaded.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.sizing_parameterization"></a>
## parameter.legalization.sizing_parameterization

**Meaning:** The continuous sizing coordinate representation.

**Role:** It selects logits or real-size coordinates for sizing optimization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.sort_nets_by_degree"></a>
## parameter.legalization.sort_nets_by_degree

**Meaning:** The net-degree sorting switch.

**Role:** It changes net processing order during placement-data preparation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.start_iter"></a>
## parameter.legalization.start_iter

**Meaning:** The weight-update or optimization start iteration.

**Role:** It delays activation of the related update path.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.stop_overflow"></a>
## parameter.legalization.stop_overflow

**Meaning:** The acceptable global-placement overflow threshold.

**Role:** The parameter is effective when the final global-placement overflow is strictly below the actual threshold. A known final overflow at or above the threshold is inactive; missing or negative sentinel overflow is unknown. No stopping-cause trace is required.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.target_density"></a>
## parameter.legalization.target_density

**Meaning:** The target placement density of each density bin during global placement. It is not floorplan Core.Utilitization.

**Role:** DREAMPlace raises infeasible low requests to a utilization-derived floor, loads the effective value into the density tensor, and uses it in density-overflow and stopping computations. A runtime consumer observation is required to prove use.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_aggregation_mode"></a>
## parameter.legalization.timing_aggregation_mode

**Meaning:** The AAT and RAT aggregation mode.

**Role:** It selects hard maximum and minimum reductions or smooth log-sum-exp aggregation while retaining hard endpoint WNS and TNS.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_aggregation_tau_ps"></a>
## parameter.legalization.timing_aggregation_tau_ps

**Meaning:** The temperature for smooth AAT and RAT aggregation.

**Role:** It controls how closely smooth aggregation approaches hard maxima and minima.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_coeff_growth_factor"></a>
## parameter.legalization.timing_coeff_growth_factor

**Meaning:** The WNS and TNS coefficient growth multiplier.

**Role:** It scales timing coefficients at each density-weight update; one disables growth.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_eval_flag"></a>
## parameter.legalization.timing_eval_flag

**Meaning:** The timing-evaluation switch.

**Role:** The current ECOS execution boundary disables it, so it does not participate in the placement algorithm.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_grad_balance_target_ratio"></a>
## parameter.legalization.timing_grad_balance_target_ratio

**Meaning:** The target timing-to-wirelength gradient balance.

**Role:** It balances weighted timing and wirelength gradient norms; zero disables automatic balancing.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_obj_profile"></a>
## parameter.legalization.timing_obj_profile

**Meaning:** The timing-objective profiling switch.

**Role:** It enables performance counters for timing-objective evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_obj_profile_interval"></a>
## parameter.legalization.timing_obj_profile_interval

**Meaning:** The timing-objective profile interval.

**Role:** It sets how many global-placement steps separate performance summaries.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_objective_lane"></a>
## parameter.legalization.timing_objective_lane

**Meaning:** The timing-objective term selection.

**Role:** It selects timing-only terms or timing with slew and capacitance terms.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_buffering_enabled"></a>
## parameter.legalization.timing_opt_buffering_enabled

**Meaning:** The timing-window buffering switch.

**Role:** It enables Segment buffering inside electrical timing-optimization windows.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_coefficients_cap"></a>
## parameter.legalization.timing_opt_coefficients_cap

**Meaning:** The `timing_opt_coefficients.cap` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_coefficients_mode"></a>
## parameter.legalization.timing_opt_coefficients_mode

**Meaning:** The `timing_opt_coefficients.mode` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_coefficients_slew"></a>
## parameter.legalization.timing_opt_coefficients_slew

**Meaning:** The `timing_opt_coefficients.slew` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_coefficients_tns"></a>
## parameter.legalization.timing_opt_coefficients_tns

**Meaning:** The `timing_opt_coefficients.tns` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_coefficients_wns"></a>
## parameter.legalization.timing_opt_coefficients_wns

**Meaning:** The `timing_opt_coefficients.wns` configuration field for legalization.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_enabled"></a>
## parameter.legalization.timing_opt_enabled

**Meaning:** The electrical timing-optimization switch.

**Role:** It enables timing-optimization windows during placement.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_flag"></a>
## parameter.legalization.timing_opt_flag

**Meaning:** The timing-optimization switch.

**Role:** The current ECOS execution boundary disables it, so it does not participate in the placement algorithm.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_max_windows"></a>
## parameter.legalization.timing_opt_max_windows

**Meaning:** The maximum number of timing-optimization windows.

**Role:** It caps electrical timing-optimization passes in one placement run.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_overflow_milestones"></a>
## parameter.legalization.timing_opt_overflow_milestones

**Meaning:** The overflow milestones that trigger timing-optimization windows.

**Role:** It defines descending one-shot thresholds; an empty list uses inflation-triggered windows.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_sizing_rounds"></a>
## parameter.legalization.timing_opt_sizing_rounds

**Meaning:** The maximum discrete size and VT rounds per timing window.

**Role:** It caps discrete refinement inside each electrical timing-optimization window.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_placement_carrier"></a>
## parameter.legalization.timing_placement_carrier

**Meaning:** The coordinate timing method.

**Role:** It selects direct-loss or pin-to-pin timing controls while preserving mutually exclusive global-placement paths.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_rc_mode"></a>
## parameter.legalization.timing_rc_mode

**Meaning:** The timing-parasitics source.

**Role:** It selects placement estimates or global-route parasitics, which require native ECC CPU sizing or STA.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_surrogate_mode"></a>
## parameter.legalization.timing_surrogate_mode

**Meaning:** The cell timing-evaluation mode.

**Role:** It selects automatic, mixed, LUT-only, or surrogate-only timing evaluation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_topology_enable_overflow_threshold"></a>
## parameter.legalization.timing_topology_enable_overflow_threshold

**Meaning:** The overflow threshold for timing-topology updates.

**Role:** It activates topology updates when density overflow falls below the configured value.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_topology_refresh_interval"></a>
## parameter.legalization.timing_topology_refresh_interval

**Meaning:** The timing-topology refresh interval.

**Role:** It sets the number of global-placement steps between full topology refreshes.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.two_stage_density_scaler"></a>
## parameter.legalization.two_stage_density_scaler

**Meaning:** The two-stage density scale factor.

**Role:** It scales the density model across placement stages.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.unit_horizontal_capacity"></a>
## parameter.legalization.unit_horizontal_capacity

**Meaning:** The unit horizontal routing capacity.

**Role:** It normalizes horizontal routing demand into utilization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.unit_pin_capacity"></a>
## parameter.legalization.unit_pin_capacity

**Meaning:** The unit pin capacity.

**Role:** It is used by pin-density routability estimation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.unit_vertical_capacity"></a>
## parameter.legalization.unit_vertical_capacity

**Meaning:** The unit vertical routing capacity.

**Role:** It normalizes vertical routing demand into utilization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.use_bb"></a>
## parameter.legalization.use_bb

**Meaning:** The bounding-box approximation switch.

**Role:** It affects the bounding-box form used by wirelength or congestion modeling.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.verilog_input"></a>
## parameter.legalization.verilog_input

**Meaning:** The input netlist path.

**Role:** It provides logical connectivity; ECOS replaces it with the current step input at runtime.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.with_sta"></a>
## parameter.legalization.with_sta

**Meaning:** The STA integration switch.

**Role:** The current ECOS execution boundary disables it, so the STA path is not initialized.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**
