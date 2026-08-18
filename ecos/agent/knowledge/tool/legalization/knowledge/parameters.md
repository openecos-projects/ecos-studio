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

<a id="parameter.legalization.adjust_nctugr_area_flag"></a>
## parameter.legalization.adjust_nctugr_area_flag

**Meaning:** The EGR area-adjustment switch.

**Role:** It uses EGR congestion information to adjust node area.

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

<a id="parameter.legalization.cell_padding_x"></a>
## parameter.legalization.cell_padding_x

**Meaning:** The standard-cell padding along X.

**Role:** It expands effective cell width in the placement model to reserve horizontal spacing for legalization.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.def_input"></a>
## parameter.legalization.def_input

**Meaning:** The input DEF path.

**Role:** It provides physical locations and constraints; ECOS replaces it with the current step input at runtime.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.density_weight"></a>
## parameter.legalization.density_weight

**Meaning:** The initial density-penalty weight.

**Role:** It controls the density penalty relative to smooth wirelength and participates in weight updates.

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

**Role:** It marks detailed placement; the current ECOS default flow does not execute that stage.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.deterministic_flag"></a>
## parameter.legalization.deterministic_flag

**Meaning:** The deterministic-execution switch.

**Role:** It requests deterministic lower-level computation paths to reduce run-to-run variation.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.differentiable_timing_obj"></a>
## parameter.legalization.differentiable_timing_obj

**Meaning:** The differentiable-timing-objective switch.

**Role:** The current ECOS execution boundary disables it, so it is not added to the placement objective.

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

<a id="parameter.legalization.evaluate_pl"></a>
## parameter.legalization.evaluate_pl

**Meaning:** The existing-placement evaluation-mode switch.

**Role:** When enabled, it disables the normal optimization path and evaluates the input placement.

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

<a id="parameter.legalization.lef_input"></a>
## parameter.legalization.lef_input

**Meaning:** The LEF file set.

**Role:** It provides technology layers, sites, and cell geometry to the placement database.

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

**Role:** It initializes Python, Torch, and CUDA random state for reproducible initial perturbations.

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

**Role:** When enabled, it allows NonLinearPlace to enter routability-driven paths such as area adjustment.

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

**Role:** It controls convergence and whether legalization may proceed.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.target_density"></a>
## parameter.legalization.target_density

**Meaning:** The target placement density of each density bin during global placement. It is not floorplan Core.Utilitization.

**Role:** It is the target of the density-overflow and electric-potential terms, balancing wirelength against placeable area.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_eval_flag"></a>
## parameter.legalization.timing_eval_flag

**Meaning:** The timing-evaluation switch.

**Role:** The current ECOS execution boundary disables it, so it does not participate in the placement algorithm.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**, **ecc.runner**, **ecc.module**, **config.legalization**

<a id="parameter.legalization.timing_opt_flag"></a>
## parameter.legalization.timing_opt_flag

**Meaning:** The timing-optimization switch.

**Role:** The current ECOS execution boundary disables it, so it does not participate in the placement algorithm.

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
