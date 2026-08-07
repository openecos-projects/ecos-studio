<a id="parameter.dreamplace.aux_input"></a>
## parameter.dreamplace.aux_input

**Meaning:** The Bookshelf AUX input descriptor.

**Role:** It supplies the design entry point for Bookshelf-format input.

<a id="parameter.dreamplace.lef_input"></a>
## parameter.dreamplace.lef_input

**Meaning:** The LEF file set.

**Role:** It provides technology layers, sites, and cell geometry to the placement database.

<a id="parameter.dreamplace.def_input"></a>
## parameter.dreamplace.def_input

**Meaning:** The input DEF path.

**Role:** It provides physical locations and constraints; ECOS replaces it with the current step input at runtime.

<a id="parameter.dreamplace.verilog_input"></a>
## parameter.dreamplace.verilog_input

**Meaning:** The input netlist path.

**Role:** It provides logical connectivity; ECOS replaces it with the current step input at runtime.

<a id="parameter.dreamplace.gpu"></a>
## parameter.dreamplace.gpu

**Meaning:** Whether to request GPU execution.

**Role:** It selects CPU or CUDA execution for tensors and compiled operators.

<a id="parameter.dreamplace.gpu_id"></a>
## parameter.dreamplace.gpu_id

**Meaning:** The CUDA device index.

**Role:** It selects the device that owns placement tensors and operators in GPU mode.

<a id="parameter.dreamplace.num_bins_x"></a>
## parameter.dreamplace.num_bins_x

**Meaning:** The number of density bins along X.

**Role:** It sets the spatial resolution for density, electric potential, and global-placement evaluation.

<a id="parameter.dreamplace.num_bins_y"></a>
## parameter.dreamplace.num_bins_y

**Meaning:** The number of density bins along Y.

**Role:** It sets the spatial resolution for density, electric potential, and global-placement evaluation.

<a id="parameter.dreamplace.global_place_stages"></a>
## parameter.dreamplace.global_place_stages

**Meaning:** The global-placement stage schedule.

**Role:** It defines bins, iterations, wirelength model, optimizer, and learning rate for each stage.

<a id="parameter.dreamplace.target_density"></a>
## parameter.dreamplace.target_density

**Meaning:** The target placement density of each density bin during global placement. It is not floorplan Core.Utilitization.

**Role:** It is the target of the density-overflow and electric-potential terms, balancing wirelength against placeable area.

<a id="parameter.dreamplace.density_weight"></a>
## parameter.dreamplace.density_weight

**Meaning:** The initial density-penalty weight.

**Role:** It controls the density penalty relative to smooth wirelength and participates in weight updates.

<a id="parameter.dreamplace.random_seed"></a>
## parameter.dreamplace.random_seed

**Meaning:** The random seed.

**Role:** It initializes Python, Torch, and CUDA random state for reproducible initial perturbations.

<a id="parameter.dreamplace.result_dir"></a>
## parameter.dreamplace.result_dir

**Meaning:** The placement result directory.

**Role:** It receives DreamPlace logs and intermediate outputs.

<a id="parameter.dreamplace.scale_factor"></a>
## parameter.dreamplace.scale_factor

**Meaning:** The coordinate and wirelength conversion scale.

**Role:** It keeps placement-database values consistent during evaluation and output.

<a id="parameter.dreamplace.ignore_net_weight"></a>
## parameter.dreamplace.ignore_net_weight

**Meaning:** The threshold for ignoring high-weight nets.

**Role:** It filters excessively weighted nets from weighted-HPWL evaluation.

<a id="parameter.dreamplace.shift_factor"></a>
## parameter.dreamplace.shift_factor

**Meaning:** The input-coordinate shift.

**Role:** It changes the coordinate origin while input data is loaded.

<a id="parameter.dreamplace.ignore_net_degree"></a>
## parameter.dreamplace.ignore_net_degree

**Meaning:** The net-degree ignore threshold.

**Role:** It masks high-fanout nets so they do not dominate wirelength and selected evaluation operators.

<a id="parameter.dreamplace.gp_noise_ratio"></a>
## parameter.dreamplace.gp_noise_ratio

**Meaning:** The global-placement initialization noise ratio.

**Role:** It sets the positional perturbation applied by random-center initialization.

<a id="parameter.dreamplace.auto_adjust_bins"></a>
## parameter.dreamplace.auto_adjust_bins

**Meaning:** The automatic density-bin adjustment switch.

**Role:** It allows the placer to adapt density-grid settings to design data.

<a id="parameter.dreamplace.enable_fillers"></a>
## parameter.dreamplace.enable_fillers

**Meaning:** Whether filler nodes are inserted.

**Role:** Filler nodes participate in the density model so continuous optimization represents available area.

<a id="parameter.dreamplace.global_place_flag"></a>
## parameter.dreamplace.global_place_flag

**Meaning:** Whether global placement runs.

**Role:** It controls entry into the NonLinearPlace continuous optimization loop.

<a id="parameter.dreamplace.legalize_flag"></a>
## parameter.dreamplace.legalize_flag

**Meaning:** Whether internal legalization runs.

**Role:** It controls whether the legalizer removes overlaps and aligns cells to sites after global placement.

<a id="parameter.dreamplace.detailed_place_flag"></a>
## parameter.dreamplace.detailed_place_flag

**Meaning:** The detailed-placement enable flag.

**Role:** It marks detailed placement; the current ECOS default flow does not execute that stage.

<a id="parameter.dreamplace.stop_overflow"></a>
## parameter.dreamplace.stop_overflow

**Meaning:** The acceptable global-placement overflow threshold.

**Role:** It controls convergence and whether legalization may proceed.

<a id="parameter.dreamplace.dtype"></a>
## parameter.dreamplace.dtype

**Meaning:** The placement-tensor data type.

**Role:** It affects numerical precision, memory use, and the type used by compiled operators.

<a id="parameter.dreamplace.detailed_place_engine"></a>
## parameter.dreamplace.detailed_place_engine

**Meaning:** The external detailed-placer path.

**Role:** When the path exists, PlacementEngine invokes that tool after global placement.

<a id="parameter.dreamplace.detailed_place_command"></a>
## parameter.dreamplace.detailed_place_command

**Meaning:** Additional command text for the external detailed placer.

**Role:** It is appended to the external detailed-placer invocation.

<a id="parameter.dreamplace.plot_flag"></a>
## parameter.dreamplace.plot_flag

**Meaning:** The plotting switch.

**Role:** It controls whether placement iterations produce graphical outputs.

<a id="parameter.dreamplace.RePlAce_ref_hpwl"></a>
## parameter.dreamplace.RePlAce_ref_hpwl

**Meaning:** The RePlAce reference HPWL.

**Role:** It calibrates RePlAce-style convergence or parameter updates.

<a id="parameter.dreamplace.RePlAce_LOWER_PCOF"></a>
## parameter.dreamplace.RePlAce_LOWER_PCOF

**Meaning:** The RePlAce lower coefficient.

**Role:** It participates in the RePlAce parameter-control range.

<a id="parameter.dreamplace.RePlAce_UPPER_PCOF"></a>
## parameter.dreamplace.RePlAce_UPPER_PCOF

**Meaning:** The RePlAce upper coefficient.

**Role:** It participates in the RePlAce parameter-control range.

<a id="parameter.dreamplace.gamma"></a>
## parameter.dreamplace.gamma

**Meaning:** The wirelength smoothing parameter.

**Role:** It affects the curvature and gradient of the smooth wirelength approximation.

<a id="parameter.dreamplace.RePlAce_skip_energy_flag"></a>
## parameter.dreamplace.RePlAce_skip_energy_flag

**Meaning:** The RePlAce energy-skip flag.

**Role:** It controls whether the related energy calculation participates in RePlAce iterations.

<a id="parameter.dreamplace.random_center_init_flag"></a>
## parameter.dreamplace.random_center_init_flag

**Meaning:** The random-center initialization switch.

**Role:** It spreads movable cells from around the chip center to form the global-placement initial state.

<a id="parameter.dreamplace.init_loc_perc_x"></a>
## parameter.dreamplace.init_loc_perc_x

**Meaning:** The X percentage of the initial location.

**Role:** It defines the X coordinate of random-center initialization relative to the layout boundary.

<a id="parameter.dreamplace.init_loc_perc_y"></a>
## parameter.dreamplace.init_loc_perc_y

**Meaning:** The Y percentage of the initial location.

**Role:** It defines the Y coordinate of random-center initialization relative to the layout boundary.

<a id="parameter.dreamplace.sort_nets_by_degree"></a>
## parameter.dreamplace.sort_nets_by_degree

**Meaning:** The net-degree sorting switch.

**Role:** It changes net processing order during placement-data preparation.

<a id="parameter.dreamplace.num_threads"></a>
## parameter.dreamplace.num_threads

**Meaning:** The CPU thread count.

**Role:** It sets OpenMP and Torch parallel thread counts.

<a id="parameter.dreamplace.dump_global_place_solution_flag"></a>
## parameter.dreamplace.dump_global_place_solution_flag

**Meaning:** The global-placement solution dump switch.

**Role:** It controls whether the global-placement solution is saved before legalization.

<a id="parameter.dreamplace.dump_legalize_solution_flag"></a>
## parameter.dreamplace.dump_legalize_solution_flag

**Meaning:** The legalized-solution dump switch.

**Role:** It controls whether the legalizer result is saved.

<a id="parameter.dreamplace.routability_opt_flag"></a>
## parameter.dreamplace.routability_opt_flag

**Meaning:** The routability-optimization switch.

**Role:** When enabled, it allows NonLinearPlace to enter routability-driven paths such as area adjustment.

<a id="parameter.dreamplace.macro_place_flag"></a>
## parameter.dreamplace.macro_place_flag

**Meaning:** The macro-placement switch.

**Role:** It enables macro preprocessing and macro-legalization paths.

<a id="parameter.dreamplace.use_bb"></a>
## parameter.dreamplace.use_bb

**Meaning:** The bounding-box approximation switch.

**Role:** It affects the bounding-box form used by wirelength or congestion modeling.

<a id="parameter.dreamplace.route_num_bins_x"></a>
## parameter.dreamplace.route_num_bins_x

**Meaning:** The routing-evaluation grid count along X.

**Role:** It sets the X resolution for routability and congestion estimation.

<a id="parameter.dreamplace.route_num_bins_y"></a>
## parameter.dreamplace.route_num_bins_y

**Meaning:** The routing-evaluation grid count along Y.

**Role:** It sets the Y resolution for routability and congestion estimation.

<a id="parameter.dreamplace.node_area_adjust_overflow"></a>
## parameter.dreamplace.node_area_adjust_overflow

**Meaning:** The overflow threshold for node-area adjustment.

**Role:** It determines when congestion-driven placement begins area adjustment.

<a id="parameter.dreamplace.two_stage_density_scaler"></a>
## parameter.dreamplace.two_stage_density_scaler

**Meaning:** The two-stage density scale factor.

**Role:** It scales the density model across placement stages.

<a id="parameter.dreamplace.max_num_area_adjust"></a>
## parameter.dreamplace.max_num_area_adjust

**Meaning:** The maximum number of area adjustments.

**Role:** It limits repeated node-area adjustment during routability optimization.

<a id="parameter.dreamplace.adjust_nctugr_area_flag"></a>
## parameter.dreamplace.adjust_nctugr_area_flag

**Meaning:** The EGR area-adjustment switch.

**Role:** It uses EGR congestion information to adjust node area.

<a id="parameter.dreamplace.adjust_rudy_area_flag"></a>
## parameter.dreamplace.adjust_rudy_area_flag

**Meaning:** The RUDY area-adjustment switch.

**Role:** It uses RUDY congestion estimates to adjust node area.

<a id="parameter.dreamplace.adjust_pin_area_flag"></a>
## parameter.dreamplace.adjust_pin_area_flag

**Meaning:** The pin-density area-adjustment switch.

**Role:** It uses pin-density information to adjust node area.

<a id="parameter.dreamplace.area_adjust_stop_ratio"></a>
## parameter.dreamplace.area_adjust_stop_ratio

**Meaning:** The area-adjustment stopping ratio.

**Role:** It stops the related adjustment when area changes converge to this ratio.

<a id="parameter.dreamplace.route_area_adjust_stop_ratio"></a>
## parameter.dreamplace.route_area_adjust_stop_ratio

**Meaning:** The routing-area-adjustment stopping ratio.

**Role:** It controls convergence of routing-congestion-driven area adjustment.

<a id="parameter.dreamplace.pin_area_adjust_stop_ratio"></a>
## parameter.dreamplace.pin_area_adjust_stop_ratio

**Meaning:** The pin-area-adjustment stopping ratio.

**Role:** It controls convergence of pin-density-driven area adjustment.

<a id="parameter.dreamplace.unit_horizontal_capacity"></a>
## parameter.dreamplace.unit_horizontal_capacity

**Meaning:** The unit horizontal routing capacity.

**Role:** It normalizes horizontal routing demand into utilization.

<a id="parameter.dreamplace.unit_vertical_capacity"></a>
## parameter.dreamplace.unit_vertical_capacity

**Meaning:** The unit vertical routing capacity.

**Role:** It normalizes vertical routing demand into utilization.

<a id="parameter.dreamplace.unit_pin_capacity"></a>
## parameter.dreamplace.unit_pin_capacity

**Meaning:** The unit pin capacity.

**Role:** It is used by pin-density routability estimation.

<a id="parameter.dreamplace.max_route_opt_adjust_rate"></a>
## parameter.dreamplace.max_route_opt_adjust_rate

**Meaning:** The maximum routing area-adjustment rate.

**Role:** It limits node-area expansion in one routability-optimization round.

<a id="parameter.dreamplace.route_opt_adjust_exponent"></a>
## parameter.dreamplace.route_opt_adjust_exponent

**Meaning:** The routing-adjustment exponent.

**Role:** It shapes the nonlinear mapping from congestion to area-adjustment rate.

<a id="parameter.dreamplace.pin_stretch_ratio"></a>
## parameter.dreamplace.pin_stretch_ratio

**Meaning:** The pin-stretch ratio.

**Role:** It expands the effective pin influence region in pin-density estimation.

<a id="parameter.dreamplace.max_pin_opt_adjust_rate"></a>
## parameter.dreamplace.max_pin_opt_adjust_rate

**Meaning:** The maximum pin-area-adjustment rate.

**Role:** It limits one round of pin-density-driven area adjustment.

<a id="parameter.dreamplace.deterministic_flag"></a>
## parameter.dreamplace.deterministic_flag

**Meaning:** The deterministic-execution switch.

**Role:** It requests deterministic lower-level computation paths to reduce run-to-run variation.

<a id="parameter.dreamplace.get_congestion_map"></a>
## parameter.dreamplace.get_congestion_map

**Meaning:** The congestion-map extraction switch.

**Role:** It computes a congestion map and aggregate congestion score after placement.

<a id="parameter.dreamplace.macro_halo_x"></a>
## parameter.dreamplace.macro_halo_x

**Meaning:** The macro halo along X.

**Role:** It expands the effective horizontal occupancy of movable macros in placement and density modeling.

<a id="parameter.dreamplace.macro_halo_y"></a>
## parameter.dreamplace.macro_halo_y

**Meaning:** The macro halo along Y.

**Role:** It expands the effective vertical occupancy of movable macros in placement and density modeling.

<a id="parameter.dreamplace.macro_overlap_flag"></a>
## parameter.dreamplace.macro_overlap_flag

**Meaning:** The macro-overlap penalty switch.

**Role:** It controls whether the objective includes a macro-overlap penalty.

<a id="parameter.dreamplace.macro_overlap_weight"></a>
## parameter.dreamplace.macro_overlap_weight

**Meaning:** The macro-overlap penalty weight.

**Role:** It sets the macro-overlap term's influence in the global-placement objective.

<a id="parameter.dreamplace.macro_overlap_mult_weight"></a>
## parameter.dreamplace.macro_overlap_mult_weight

**Meaning:** The macro-overlap penalty multiplier.

**Role:** It scales the update strength of the macro-overlap penalty.

<a id="parameter.dreamplace.cell_padding_x"></a>
## parameter.dreamplace.cell_padding_x

**Meaning:** The standard-cell padding along X.

**Role:** It expands effective cell width in the placement model to reserve horizontal spacing for legalization.

<a id="parameter.dreamplace.bndry_padding_x"></a>
## parameter.dreamplace.bndry_padding_x

**Meaning:** The placement-boundary padding along X.

**Role:** It shrinks the effective horizontal placement range of movable cells.

<a id="parameter.dreamplace.bndry_padding_y"></a>
## parameter.dreamplace.bndry_padding_y

**Meaning:** The placement-boundary padding along Y.

**Role:** It shrinks the effective vertical placement range of movable cells.

<a id="parameter.dreamplace.pin_density"></a>
## parameter.dreamplace.pin_density

**Meaning:** The pin-density target or threshold.

**Role:** It participates in pin-density congestion estimation and area adjustment.

<a id="parameter.dreamplace.route_info_input"></a>
## parameter.dreamplace.route_info_input

**Meaning:** The routing-information input selection.

**Role:** It selects the routing-capacity or congestion information used by the placer.

<a id="parameter.dreamplace.evaluate_pl"></a>
## parameter.dreamplace.evaluate_pl

**Meaning:** The existing-placement evaluation-mode switch.

**Role:** When enabled, it disables the normal optimization path and evaluates the input placement.

<a id="parameter.dreamplace.risa_weights"></a>
## parameter.dreamplace.risa_weights

**Meaning:** The RISA weighting switch.

**Role:** It controls whether the related weighting strategy participates in the objective or evaluation.

<a id="parameter.dreamplace.macro_pin_halo_x"></a>
## parameter.dreamplace.macro_pin_halo_x

**Meaning:** The macro-pin halo along X.

**Role:** It expands the horizontal macro-pin influence region for density or congestion modeling.

<a id="parameter.dreamplace.macro_pin_halo_y"></a>
## parameter.dreamplace.macro_pin_halo_y

**Meaning:** The macro-pin halo along Y.

**Role:** It expands the vertical macro-pin influence region for density or congestion modeling.

<a id="parameter.dreamplace.timing_opt_flag"></a>
## parameter.dreamplace.timing_opt_flag

**Meaning:** The timing-optimization switch.

**Role:** The current ECOS execution boundary disables it, so it does not participate in the placement algorithm.

<a id="parameter.dreamplace.timing_eval_flag"></a>
## parameter.dreamplace.timing_eval_flag

**Meaning:** The timing-evaluation switch.

**Role:** The current ECOS execution boundary disables it, so it does not participate in the placement algorithm.

<a id="parameter.dreamplace.enable_net_weighting"></a>
## parameter.dreamplace.enable_net_weighting

**Meaning:** The net-weight-update switch.

**Role:** It controls whether timing or another strategy updates net weights in the placement objective.

<a id="parameter.dreamplace.with_sta"></a>
## parameter.dreamplace.with_sta

**Meaning:** The STA integration switch.

**Role:** The current ECOS execution boundary disables it, so the STA path is not initialized.

<a id="parameter.dreamplace.differentiable_timing_obj"></a>
## parameter.dreamplace.differentiable_timing_obj

**Meaning:** The differentiable-timing-objective switch.

**Role:** The current ECOS execution boundary disables it, so it is not added to the placement objective.

<a id="parameter.dreamplace.pin2pin_max_weight"></a>
## parameter.dreamplace.pin2pin_max_weight

**Meaning:** The maximum pin-to-pin weight.

**Role:** It limits the upper bound of pin-to-pin timing or connectivity weighting.

<a id="parameter.dreamplace.pin2pin_min_weight"></a>
## parameter.dreamplace.pin2pin_min_weight

**Meaning:** The minimum pin-to-pin weight.

**Role:** It limits the lower bound of pin-to-pin timing or connectivity weighting.

<a id="parameter.dreamplace.pin2pin_accumulate_weight"></a>
## parameter.dreamplace.pin2pin_accumulate_weight

**Meaning:** The pin-to-pin accumulated weight.

**Role:** It controls accumulation across pin-to-pin weight-update rounds.

<a id="parameter.dreamplace.pin2pin_weight"></a>
## parameter.dreamplace.pin2pin_weight

**Meaning:** The base pin-to-pin weight.

**Role:** It supplies the initial scale for pin-to-pin weighting.

<a id="parameter.dreamplace.pin2pin_net_weighting"></a>
## parameter.dreamplace.pin2pin_net_weighting

**Meaning:** The pin-to-pin net-weighting switch.

**Role:** It controls whether pin-to-pin information feeds back into net weights.

<a id="parameter.dreamplace.net_weighting_scheme"></a>
## parameter.dreamplace.net_weighting_scheme

**Meaning:** The net-weighting scheme name.

**Role:** It selects the net-weight calculation or update strategy.

<a id="parameter.dreamplace.momentum_decay_factor"></a>
## parameter.dreamplace.momentum_decay_factor

**Meaning:** The weight-update momentum decay.

**Role:** It smooths weight changes across iterations.

<a id="parameter.dreamplace.start_iter"></a>
## parameter.dreamplace.start_iter

**Meaning:** The weight-update or optimization start iteration.

**Role:** It delays activation of the related update path.

<a id="parameter.dreamplace.max_net_weight"></a>
## parameter.dreamplace.max_net_weight

**Meaning:** The net-weight upper bound.

**Role:** It prevents a small number of nets from dominating the placement objective.

<a id="parameter.dreamplace.base_design_name"></a>
## parameter.dreamplace.base_design_name

**Meaning:** The base design name.

**Role:** It is used to name placement outputs and intermediate files.
