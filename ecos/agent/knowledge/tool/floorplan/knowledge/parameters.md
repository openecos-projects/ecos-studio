<a id="parameter.floorplan.die_builder_die_size_height_micron"></a>
## parameter.floorplan.die_builder_die_size_height_micron

**Meaning:** The explicit die height in micrometers.

**Role:** It is used when the die-construction mode selects explicit dimensions.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_die_size_width_micron"></a>
## parameter.floorplan.die_builder_die_size_width_micron

**Meaning:** The explicit die width in micrometers.

**Role:** It is used when the die-construction mode selects explicit dimensions.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_die_util_aspect_ratio"></a>
## parameter.floorplan.die_builder_die_util_aspect_ratio

**Meaning:** The target die aspect ratio in utilization mode.

**Role:** It shapes the die dimensions while the target utilization determines area.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_die_util_utilization"></a>
## parameter.floorplan.die_builder_die_util_utilization

**Meaning:** The target die utilization in utilization mode.

**Role:** It determines the die area required for the current design content.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_margin_bottom_micron"></a>
## parameter.floorplan.die_builder_margin_bottom_micron

**Meaning:** The bottom die-to-core margin in micrometers.

**Role:** It offsets the core boundary from the corresponding die edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_margin_left_micron"></a>
## parameter.floorplan.die_builder_margin_left_micron

**Meaning:** The left die-to-core margin in micrometers.

**Role:** It offsets the core boundary from the corresponding die edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_margin_right_micron"></a>
## parameter.floorplan.die_builder_margin_right_micron

**Meaning:** The right die-to-core margin in micrometers.

**Role:** It offsets the core boundary from the corresponding die edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_margin_top_micron"></a>
## parameter.floorplan.die_builder_margin_top_micron

**Meaning:** The top die-to-core margin in micrometers.

**Role:** It offsets the core boundary from the corresponding die edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_mode"></a>
## parameter.floorplan.die_builder_mode

**Meaning:** The die-construction mode.

**Role:** It selects whether die geometry is derived from utilization or an explicit size.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.die_builder_site_name"></a>
## parameter.floorplan.die_builder_site_name

**Meaning:** The core placement-site name.

**Role:** It selects the technology site used to build core rows.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.ifp_temp_directory_path"></a>
## parameter.floorplan.ifp_temp_directory_path

**Meaning:** The floorplan temporary-directory path.

**Role:** It selects the scratch location used by the floorplan engine.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.ifp_thread_number"></a>
## parameter.floorplan.ifp_thread_number

**Meaning:** The floorplan worker-thread count.

**Role:** It bounds parallel work performed by the floorplan engine.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.io_placer_io_layer_list"></a>
## parameter.floorplan.io_placer_io_layer_list

**Meaning:** The routing layers eligible for IO-pin placement.

**Role:** It constrains where the floorplan can place IO pins.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.macro_placer_macro_location_path"></a>
## parameter.floorplan.macro_placer_macro_location_path

**Meaning:** The macro-location input path.

**Role:** It supplies fixed or guided macro positions to the macro placer.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.macro_placer_macro_placement_halo"></a>
## parameter.floorplan.macro_placer_macro_placement_halo

**Meaning:** The halo reserved around placed macros.

**Role:** It keeps standard-cell and routing resources away from macro boundaries during macro placement.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.macro_placer_macro_routing_halo"></a>
## parameter.floorplan.macro_placer_macro_routing_halo

**Meaning:** The routing halo reserved around macros.

**Role:** It reserves routing clearance around macro boundaries.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.pdn_generator_connect_layers"></a>
## parameter.floorplan.pdn_generator_connect_layers

**Meaning:** The PDN layer-connection definitions.

**Role:** It specifies routing-layer pairs to connect through the power network.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.pdn_generator_global_connect"></a>
## parameter.floorplan.pdn_generator_global_connect

**Meaning:** The global power/ground connection rules.

**Role:** It maps instance pins to named power and ground nets before PDN construction.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.pdn_generator_rail"></a>
## parameter.floorplan.pdn_generator_rail

**Meaning:** The follow-pin PDN rail definitions.

**Role:** It creates local power rails on declared routing layers.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.pdn_generator_stripe"></a>
## parameter.floorplan.pdn_generator_stripe

**Meaning:** The PDN stripe definitions.

**Role:** It creates wider periodic power stripes with declared width, pitch, and offset.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_boundary_tap_bottom_cell_name_list"></a>
## parameter.floorplan.phy_placer_boundary_tap_bottom_cell_name_list

**Meaning:** The boundary-tap setting.

**Role:** It selects boundary tap cells and their placement rule along the core edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_boundary_tap_rule_micron"></a>
## parameter.floorplan.phy_placer_boundary_tap_rule_micron

**Meaning:** The boundary-tap setting.

**Role:** It selects boundary tap cells and their placement rule along the core edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_boundary_tap_top_cell_name_list"></a>
## parameter.floorplan.phy_placer_boundary_tap_top_cell_name_list

**Meaning:** The boundary-tap setting.

**Role:** It selects boundary tap cells and their placement rule along the core edge.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_edge_endcap_bottom_cell_name_list"></a>
## parameter.floorplan.phy_placer_edge_endcap_bottom_cell_name_list

**Meaning:** The boundary endcap-cell setting.

**Role:** It selects cells that protect rows and block edges during physical-cell insertion.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_edge_endcap_top_cell_name_list"></a>
## parameter.floorplan.phy_placer_edge_endcap_top_cell_name_list

**Meaning:** The boundary endcap-cell setting.

**Role:** It selects cells that protect rows and block edges during physical-cell insertion.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_side_endcap_left_cell_name"></a>
## parameter.floorplan.phy_placer_side_endcap_left_cell_name

**Meaning:** The boundary endcap-cell setting.

**Role:** It selects cells that protect rows and block edges during physical-cell insertion.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_side_endcap_right_cell_name"></a>
## parameter.floorplan.phy_placer_side_endcap_right_cell_name

**Meaning:** The boundary endcap-cell setting.

**Role:** It selects cells that protect rows and block edges during physical-cell insertion.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_well_tap_cell_name"></a>
## parameter.floorplan.phy_placer_well_tap_cell_name

**Meaning:** The well-tap insertion setting.

**Role:** It selects the tap cell and maximum spacing used to maintain well connectivity.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**

<a id="parameter.floorplan.phy_placer_well_tap_distance_micron"></a>
## parameter.floorplan.phy_placer_well_tap_distance_micron

**Meaning:** The well-tap insertion setting.

**Role:** It selects the tap cell and maximum spacing used to maintain well connectivity.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.floorplan**
