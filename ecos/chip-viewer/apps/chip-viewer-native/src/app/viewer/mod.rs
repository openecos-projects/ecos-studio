use super::*;

impl LoadedViewer {
    pub(super) fn new(
        color_theme: chip_display::ColorTheme,
        db: impl Into<PreparedViewer>,
        edit_enabled: bool,
        initial_session_dirty: bool,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
        macro_staging_path: Option<PathBuf>,
        mut analysis_paths: analysis_loader::AnalysisPaths,
        target_format: wgpu::TextureFormat,
        render_mode: crate::RenderMode,
    ) -> Self {
        let PreparedViewer {
            db,
            stats,
            grid_bounds,
            drawing_category_counts,
            snapshot_signature,
            layer_catalog,
        } = db.into();
        let gpu_tile_worker = GpuTileWorker::new(std::sync::Arc::clone(&db));
        let all_visible = env_flag_requested(std::env::var(PERF_ALL_VISIBLE_ENV).ok().as_deref());
        let initial_zoom = std::env::var(PERF_INITIAL_ZOOM_ENV)
            .ok()
            .and_then(|value| value.parse::<f32>().ok())
            .filter(|zoom| zoom.is_finite() && *zoom > 0.0)
            .unwrap_or(1.0)
            .clamp(0.05, 50_000.0);
        let mut layers =
            layer_ui_states_from_summaries(layer_catalog, &BTreeMap::new(), color_theme);
        let mut object_visibility = ObjectVisibility::default();
        // A read-only view opens on the full layout. Edit mode keeps its
        // placement-focused filters; later sidebar changes remain user-owned.
        if !edit_enabled || all_visible {
            set_layer_visibility(&mut layers, true);
            object_visibility.set_all_visible(true);
        }
        analysis_paths.drc_data = db
            .snapshot()
            .manifest()
            .drc
            .clone()
            .or(analysis_paths.drc_data);
        let (analysis_loader, analysis_load_error) =
            match analysis_loader::AnalysisLoader::start(analysis_paths) {
                Ok(loader) => (loader, None),
                Err(err) => (
                    None,
                    Some(format!("Failed to start analysis data loader: {err}")),
                ),
            };
        let clock_tree = crate::clock_tree::ClockTreePanel::new(std::sync::Arc::clone(&db));
        let analysis_tab = if clock_tree.is_some() {
            AnalysisTab::ClockTree
        } else {
            AnalysisTab::Map
        };
        let macro_staging = macro_staging_path.as_deref().and_then(|path| {
            MacroStagingState::load(path, &db).or_else(|| {
                log::warn!(
                    "macro staging manifest could not be loaded: {}",
                    path.display()
                );
                None
            })
        });
        let gpu_canvas = match render_mode {
            crate::RenderMode::Gpu => Some(crate::canvas_gpu::GpuCanvasState::new_with_wgpu(
                true,
                target_format,
            )),
            crate::RenderMode::Software | crate::RenderMode::EguiOnly => {
                log::info!(
                    "CPU/egui safe mode active, completely bypassing GPU canvas state creation"
                );
                None
            }
        };
        let drawing_category_counts = {
            let counts = Arc::new(OnceLock::new());
            if !drawing_category_counts.is_empty() {
                let _ = counts.set(drawing_category_counts);
            }
            counts
        };
        let unrouted_net_guides = Arc::new(OnceLock::new());
        let index_db = Arc::clone(&db);
        thread::spawn(move || index_db.prewarm_render_indexes());
        start_drawing_category_data(
            Arc::clone(&db),
            Arc::clone(&drawing_category_counts),
            Arc::clone(&unrouted_net_guides),
        );
        Self {
            color_theme,
            start_time: Instant::now(),
            db,
            stats,
            grid_bounds,
            drawing_category_counts,
            unrouted_net_guides,
            spatial_index_prewarm_started: false,
            layers,
            edit_enabled,
            edit_command_dir,
            edit_result_dir,
            macro_staging,
            macro_toolbox_preferences:
                crate::macro_toolbar::MacroToolboxPreferences::load_persisted(),
            query_input_mode: QueryInputMode::Search,
            search_text: String::new(),
            search_mode: SearchMode::All,
            search_highlighted: BTreeSet::new(),
            search_worker: search_worker::SearchWorker::new(),
            search_truncated: false,
            focus_search_results: false,
            shape_id_text: String::new(),
            last_query_status: None,
            highlighted: BTreeSet::new(),
            clock_tree_overlay: clock_tree::ClockTreeOverlay::default(),
            selected: None,
            pending_focus: None,
            macro_interaction: None,
            draft: None,
            pending_edit: None,
            pending_session_action: None,
            pending_reload: None,
            session_action_progress: None,
            last_edit_result: None,
            session_dirty: initial_session_dirty,
            close_confirmation_visible: false,
            close_after_session_action: false,
            close_without_session_action: false,
            snapshot_signature,
            next_snapshot_refresh_check: Instant::now() + SNAPSHOT_REFRESH_CHECK_INTERVAL,
            render_cache: RenderPlanCache::default(),
            cpu_scene_cache: cpu_scene::CpuSceneCache::default(),
            pattern_textures: OnceLock::new(),
            glow_rendering: false,
            glow_renderer: None,
            previous_native_cpu_ms: 0.0,
            previous_ui_update_ms: 0.0,
            view_tile_cache: ViewTilePlaneCache::default(),
            view_tiles_latch: gpu_overview::ViewTileOverviewLatch::default(),
            next_command_counter: 1,
            drc_overlay: None,
            selected_drc: None,
            antenna_overlay: None,
            selected_antenna: None,
            lvs_analysis: None,
            selected_lvs_group: None,
            show_all_lvs: false,
            timing: None,
            clock_tree,
            map_catalog: None,
            map_catalog_error: None,
            analysis_tab,
            expanded_map_categories: BTreeSet::new(),
            selected_map_item: None,
            previous_map_item: None,
            active_heatmap: None,
            heatmap_composition: Default::default(),
            analysis_loader,
            analysis_load_error,
            analysis_tab_user_selected: false,
            map_item_error: None,
            selected_map_bbox: None,
            focus_animation: None,
            zoom: initial_zoom,
            pan: egui::Vec2::ZERO,
            pan_drag: PanDragState::default(),
            wheel_camera: wheel_camera::WheelCamera::default(),
            ruler_tool: OrthogonalRuler::default(),
            object_visibility,
            coordinate_unit: CoordinateUnit::Dbu,
            view_mode: ViewMode::TwoD,
            camera_ctrl_3d: crate::nav3d::CameraController3d::default(),
            show_3d_grid: true,
            shading_style_3d: crate::canvas_gpu3d::ShadingStyle::Normal,
            lighting_preset_3d: chip_display::LightingPreset::Studio,
            z_cut_ratio_3d: 0.0,
            layer_stack: LayerStack::default(),
            view3d_fitted: false,
            view3d_bootstrapped: false,
            sidebar_info_panel: None,
            geometry_epoch: 1,
            visibility_rules_cache: VisibilityRulesCache::default(),
            gpu_canvas,
            gpu_tile_instances: std::collections::HashMap::new(),
            gpu_tile_worker,
            gpu_3d_instances_cache: None,
            perf_3d: Perf3dState::default(),
            gpu_frame_counter: 0,
            label_collector: ShapeLabelCollector::default(),
            status_line_buffer: String::with_capacity(128),
            shortcuts_overlay_visible: false,
            loading_3d_start: None,
        }
    }

    pub(super) fn sidebar(&mut self, ui: &mut egui::Ui) {
        self.sidebar_contents(ui);
    }

    pub(super) fn has_analysis_panel(&self) -> bool {
        self.drc_overlay.is_some()
            || self.antenna_overlay.is_some()
            || self.lvs_analysis.is_some()
            || self.map_catalog.is_some()
            || self.map_catalog_error.is_some()
            || self.analysis_loader.is_some()
            || self.analysis_load_error.is_some()
            || self.clock_tree.is_some()
            || self.timing.is_some()
    }

    pub(super) fn analysis_sidebar(&mut self, ui: &mut egui::Ui) {
        if let Some(error) = &self.analysis_load_error {
            ui.colored_label(ecos_warning(), error);
            ui.separator();
        }
        if self.analysis_loader.is_some() {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label("Loading analysis data");
            });
            ui.separator();
        }
        let has_drc = self.drc_overlay.is_some();
        let has_antenna = self.antenna_overlay.is_some();
        let has_lvs = self.lvs_analysis.is_some();
        let has_maps = self.map_catalog.is_some() || self.map_catalog_error.is_some();
        let has_clock_tree = self.clock_tree.is_some();
        let has_timing = self.timing.is_some();
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 2.0;
            if has_timing
                && analysis_tab_button(ui, "TIMING", self.analysis_tab == AnalysisTab::Timing)
            {
                self.analysis_tab = AnalysisTab::Timing;
                self.analysis_tab_user_selected = true;
            }
            if has_drc && analysis_tab_button(ui, "DRC", self.analysis_tab == AnalysisTab::Drc) {
                self.analysis_tab = AnalysisTab::Drc;
                self.analysis_tab_user_selected = true;
            }
            if has_antenna
                && analysis_tab_button(ui, "ANTENNA", self.analysis_tab == AnalysisTab::Antenna)
            {
                self.analysis_tab = AnalysisTab::Antenna;
                self.analysis_tab_user_selected = true;
            }
            if has_lvs && analysis_tab_button(ui, "LVS", self.analysis_tab == AnalysisTab::Lvs) {
                self.analysis_tab = AnalysisTab::Lvs;
                self.analysis_tab_user_selected = true;
            }
            if has_maps && analysis_tab_button(ui, "MAP", self.analysis_tab == AnalysisTab::Map) {
                self.analysis_tab = AnalysisTab::Map;
                self.analysis_tab_user_selected = true;
            }
            if has_clock_tree
                && analysis_tab_button(
                    ui,
                    "CLOCK TREE",
                    self.analysis_tab == AnalysisTab::ClockTree,
                )
            {
                self.analysis_tab = AnalysisTab::ClockTree;
                self.analysis_tab_user_selected = true;
            }
        });
        ui.add_space(4.0);
        ui.separator();

        let show_drc = self.analysis_tab == AnalysisTab::Drc && has_drc;
        let show_antenna = self.analysis_tab == AnalysisTab::Antenna && has_antenna;
        let show_lvs = self.analysis_tab == AnalysisTab::Lvs && has_lvs;
        let show_map = self.analysis_tab == AnalysisTab::Map && has_maps;
        let show_clock_tree = self.analysis_tab == AnalysisTab::ClockTree && has_clock_tree;
        let show_timing = self.analysis_tab == AnalysisTab::Timing && has_timing;

        if show_timing {
            self.timing_sidebar(ui);
        } else if show_drc {
            self.drc_sidebar(ui);
        } else if show_antenna {
            self.antenna_sidebar(ui);
        } else if show_lvs {
            self.lvs_sidebar(ui);
        } else if show_map {
            self.map_sidebar(ui);
        } else if show_clock_tree {
            self.clock_tree_controls(ui);
        } else if has_drc {
            self.drc_sidebar(ui);
        } else if has_antenna {
            self.antenna_sidebar(ui);
        } else if has_lvs {
            self.lvs_sidebar(ui);
        } else if has_maps {
            self.map_sidebar(ui);
        } else if has_clock_tree {
            self.clock_tree_controls(ui);
        } else if has_timing {
            self.timing_sidebar(ui);
        }
    }

    fn drc_sidebar(&mut self, ui: &mut egui::Ui) {
        let visible_count = self.visible_drc_violation_count(None);
        let Some(overlay) = &mut self.drc_overlay else {
            return;
        };

        ui.horizontal(|ui| {
            section_heading(ui, "VIOLATIONS");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{visible_count}/{}", overlay.total_count()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            });
        });
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                overlay.set_all_visible(true);
            }
            if ui.small_button("None").clicked() {
                overlay.set_all_visible(false);
                self.selected_drc = None;
            }
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} types",
                    overlay.selected_type_count(),
                    overlay.type_states.len()
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });

        if let Some(err) = &overlay.load_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
        }

        ui.add_space(6.0);
        if overlay.type_states.is_empty() {
            if overlay.load_error.is_none() {
                ui.label(
                    egui::RichText::new("No DRC violations")
                        .color(ecos_text_secondary())
                        .size(13.0),
                );
            }
            if let Some(path) = overlay.data_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            if let Some(path) = overlay.statis_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            return;
        }

        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_drc_type_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for state in &mut overlay.type_states {
                    drc_type_card(ui, state);
                    ui.add_space(8.0);
                }
            });
    }

    fn antenna_sidebar(&mut self, ui: &mut egui::Ui) {
        let visible_count = self.visible_antenna_violation_count(None);
        let Some(overlay) = &mut self.antenna_overlay else {
            return;
        };

        ui.horizontal(|ui| {
            section_heading(ui, "VIOLATIONS");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{visible_count}/{}", overlay.total_count()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            });
        });
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                overlay.set_all_visible(true);
            }
            if ui.small_button("None").clicked() {
                overlay.set_all_visible(false);
                self.selected_antenna = None;
            }
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} types",
                    overlay.selected_type_count(),
                    overlay.type_states.len()
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });

        if let Some(err) = &overlay.load_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
        }

        ui.add_space(6.0);
        if overlay.type_states.is_empty() {
            if overlay.load_error.is_none() {
                ui.label(
                    egui::RichText::new("No Antenna violations")
                        .color(ecos_text_secondary())
                        .size(13.0),
                );
            }
            if let Some(path) = overlay.data_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            if let Some(path) = overlay.statis_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            return;
        }

        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_antenna_type_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for state in &mut overlay.type_states {
                    antenna_type_card(ui, state);
                    ui.add_space(8.0);
                }
            });
    }

    fn map_sidebar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            section_heading(ui, "MAP DATA");
            if let Some(catalog) = &self.map_catalog {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(format!(
                            "{} maps / {} groups",
                            catalog.item_count(),
                            catalog.categories.len()
                        ))
                        .small()
                        .color(ecos_text_secondary()),
                    );
                });
            }
        });

        if let Some(err) = &self.map_catalog_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
            return;
        }
        if let Some(err) = &self.map_item_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
        }

        let Some(catalog) = self.map_catalog.as_ref() else {
            ui.add_space(6.0);
            ui.label(
                egui::RichText::new("No map data")
                    .size(13.0)
                    .color(ecos_text_secondary()),
            );
            return;
        };
        let categories = catalog.categories.clone();
        let warnings = catalog.warnings.clone();
        for warning in warnings {
            ui.colored_label(ecos_warning(), warning);
        }

        if let Some(heatmap) = self.active_heatmap.as_mut() {
            ui.add_space(4.0);
            ui.group(|ui| {
                ui.label(
                    egui::RichText::new("HEATMAP OVERLAY")
                        .small()
                        .strong()
                        .color(ecos_accent()),
                );
                if heatmap.data.is_ir_drop() {
                    ui.small("Static IR · maximum sample per cell · mV");
                    ui.small("Empty cells have no samples");
                }
                ui.horizontal_wrapped(|ui| {
                    ui.label("Colormap:");
                    let mut current_mode = heatmap.colormap_mode;
                    for mode in [
                        ColormapMode::Turbo,
                        ColormapMode::Viridis,
                        ColormapMode::Plasma,
                        ColormapMode::Inferno,
                    ] {
                        if ui
                            .selectable_label(current_mode == mode, mode.label())
                            .clicked()
                        {
                            current_mode = mode;
                        }
                    }
                    heatmap.set_colormap_mode(current_mode);
                });
                ui.horizontal(|ui| {
                    ui.label("Opacity:");
                    ui.add(egui::Slider::new(&mut heatmap.opacity, 0.05..=1.0).show_value(true));
                });
            });
        }

        ui.add_space(4.0);
        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_map_catalog_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for category in categories {
                    let default_open = self.expanded_map_categories.contains(&category.id);
                    egui::CollapsingHeader::new(format!(
                        "{}  {}",
                        category.label,
                        category.items.len()
                    ))
                    .id_salt(("chip_viewer_map_category", &category.id))
                    .default_open(default_open)
                    .show(ui, |ui| {
                        for item in &category.items {
                            let available = category.layout_path.is_some()
                                || matches!(item.source, crate::map_source::MapSource::Ir { .. });
                            let selected =
                                self.selected_map_item.as_ref() == Some(&item.source.key());
                            ui.horizontal(|ui| {
                                let button_width = ui.available_width().max(80.0);
                                let response = ui.add_enabled(
                                    available,
                                    egui::Button::new(
                                        egui::RichText::new(&item.label)
                                            .size(12.5)
                                            .color(ecos_text_primary()),
                                    )
                                    .selected(selected)
                                    .truncate()
                                    .min_size(egui::vec2(button_width, 40.0)),
                                );
                                let response = if available {
                                    response
                                        .on_hover_text(format!("Open {}", item.source.path().display()))
                                } else {
                                    response.on_disabled_hover_text("layout.csv is missing")
                                };
                                if response.clicked() {
                                    self.activate_map_item(item, category.layout_path.as_deref());
                                }
                            });
                            ui.add_space(4.0);
                        }
                    });
                    ui.add_space(4.0);
                }
            });
    }

    pub(super) fn activate_map_item(&mut self, item: &MapItem, layout_path: Option<&Path>) {
        if let Some(current_key) = &self.selected_map_item {
            if current_key != &item.source.key() {
                if let Some(catalog) = &self.map_catalog {
                    if let Some((curr_item, curr_layout)) = catalog.find_item(current_key) {
                        self.previous_map_item =
                            Some((curr_item.clone(), curr_layout.map(|p| p.to_path_buf())));
                    }
                }
            }
        }
        self.selected_map_item = Some(item.source.key());
        self.active_heatmap = None;
        self.map_item_error = None;
        self.selected_map_bbox = None;

        match item.source.load(layout_path) {
            Ok(data) => {
                self.active_heatmap = Some(ActiveHeatmap::new(item.label.clone(), data));
            }
            Err(err) => self.map_item_error = Some(err),
        }
    }

    fn toggle_previous_map_item(&mut self) {
        let Some((prev_item, prev_layout)) = self.previous_map_item.take() else {
            return;
        };
        self.activate_map_item(&prev_item, prev_layout.as_deref());
    }

    fn sidebar_contents(&mut self, ui: &mut egui::Ui) {
        egui::ScrollArea::vertical()
            .id_salt("viewer_sidebar")
            .auto_shrink([false, false])
            .show(ui, |ui| self.sidebar_sections(ui));
    }

    fn sidebar_sections(&mut self, ui: &mut egui::Ui) {
        let section_heights = sidebar_section_heights(ui.available_height());
        let available_width = ui.available_width();

        ui.add_space(4.0);
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.view),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_view_section(ui),
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.physical_layers),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_physical_layers_section(ui, section_heights.physical_layers),
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.drawing_data),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_drawing_data_section(ui, section_heights.drawing_data),
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.interaction),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_interaction_section(ui, section_heights.interaction),
        );
    }

    fn sidebar_view_section(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            section_heading(ui, "VIEW");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if self.edit_enabled {
                    let action_pending = self.pending_session_action.is_some();
                    let can_manage_session =
                        self.pending_edit.is_none() && self.draft.is_none() && !action_pending;
                    if ui
                        .add_enabled(
                            can_manage_session && self.session_dirty,
                            egui::Button::new(egui::RichText::new("💾").size(16.0))
                                .min_size(egui::vec2(28.0, 26.0))
                                .selected(self.session_dirty),
                        )
                        .on_hover_text("Save uncommitted layout edits")
                        .clicked()
                    {
                        self.request_session_action(SessionActionKind::Save, false);
                    }
                    if ui
                        .add_enabled(
                            can_manage_session && self.session_dirty,
                            egui::Button::new(egui::RichText::new("↶").size(18.0))
                                .min_size(egui::vec2(28.0, 26.0)),
                        )
                        .on_hover_text("Discard uncommitted layout edits")
                        .clicked()
                    {
                        self.request_session_action(SessionActionKind::Discard, false);
                    }
                    ui.separator();
                }
                for panel in [SidebarInfoPanel::Diagnostics, SidebarInfoPanel::Selection] {
                    let active = self.sidebar_info_panel == Some(panel);
                    if ui
                        .add_sized(
                            egui::vec2(28.0, 26.0),
                            egui::Button::new(egui::RichText::new(panel.icon()).size(17.0))
                                .selected(active),
                        )
                        .on_hover_text(panel.label())
                        .clicked()
                    {
                        self.sidebar_info_panel = if active { None } else { Some(panel) };
                    }
                }
            });
        });
        ui.horizontal(|ui| {
            for (mode, label) in [(ViewMode::TwoD, "2D"), (ViewMode::ThreeD, "3D")] {
                let enabled = mode == ViewMode::TwoD || self.is_gpu_active();
                ui.add_enabled_ui(enabled, |ui| {
                    if ui
                        .selectable_label(self.view_mode == mode, label)
                        .on_hover_text(if !enabled && mode == ViewMode::ThreeD {
                            "3D view requires hardware acceleration (running in CPU fallback)"
                        } else if mode == ViewMode::ThreeD {
                            "Orbit the extruded metal stack"
                        } else {
                            "Plan-view layout canvas"
                        })
                        .clicked()
                    {
                        if self.view_mode != mode {
                            if mode == ViewMode::ThreeD {
                                self.switch_to_3d_mode();
                            } else {
                                self.switch_to_2d_mode();
                            }
                        }
                    }
                });
            }
            ui.separator();
            if ui.button("⛶").on_hover_text("Fit layout to view").clicked() {
                self.focus_animation = None;
                self.pan_drag.reset();
                if self.view_mode == ViewMode::ThreeD {
                    self.view3d_fitted = false;
                } else {
                    self.zoom = 1.0;
                    self.pan = egui::Vec2::ZERO;
                }
            }
            let can_reload = self.pending_edit.is_none()
                && self.draft.is_none()
                && self.pending_reload.is_none();
            if ui
                .add_enabled(can_reload, egui::Button::new("↻"))
                .on_hover_text("Reload geometry snapshot")
                .clicked()
            {
                match self.reload_snapshot(ReloadCompletion::notify(
                    "geometry snapshot reloaded",
                    "failed to reload geometry",
                )) {
                    Ok(()) => {
                        self.last_edit_result = Some("reloading geometry snapshot...".to_string());
                    }
                    Err(err) => {
                        self.last_edit_result = Some(format!("failed to reload geometry: {err}"));
                    }
                }
            }
            let ruler_response = ui
                .add_sized(
                    egui::vec2(30.0, 26.0),
                    egui::Button::new("").selected(self.ruler_tool.enabled),
                )
                .on_hover_text("Measure");
            paint_ruler_tool_icon(ui.painter(), ruler_response.rect, ecos_text_primary());
            if ruler_response.clicked() {
                self.ruler_tool.toggle();
                self.pan_drag.reset();
            }
            ui.separator();
            let dbu_per_micron = self.db.snapshot().manifest().dbu_per_micron;
            for unit in [CoordinateUnit::Dbu, CoordinateUnit::Micron] {
                ui.add_enabled_ui(unit.is_available(dbu_per_micron), |ui| {
                    ui.selectable_value(&mut self.coordinate_unit, unit, unit.label());
                });
            }
            ui.separator();
            if ui
                .add_sized(
                    egui::vec2(28.0, 26.0),
                    egui::Button::new(
                        egui::RichText::new("?")
                            .strong()
                            .size(13.0)
                            .color(ecos_accent()),
                    )
                    .selected(self.shortcuts_overlay_visible),
                )
                .on_hover_text("Keyboard Shortcuts (?)")
                .clicked()
            {
                self.shortcuts_overlay_visible = !self.shortcuts_overlay_visible;
            }
        });

        if self.view_mode == ViewMode::ThreeD {
            ui.add_space(3.0);
            ui.horizontal(|ui| {
                if ui
                    .small_button("Iso")
                    .on_hover_text("Isometric camera (Key: 2 / I)")
                    .clicked()
                {
                    self.camera_ctrl_3d.set_iso();
                }
                if ui
                    .small_button("Top")
                    .on_hover_text("Look down from +Z (Key: 1 / T)")
                    .clicked()
                {
                    self.camera_ctrl_3d.set_top();
                }
                if ui
                    .small_button("Front")
                    .on_hover_text("Look across the stack (Key: 3)")
                    .clicked()
                {
                    self.camera_ctrl_3d.set_front();
                }
                ui.separator();
                if ui
                    .selectable_label(self.show_3d_grid, "Grid")
                    .on_hover_text("Toggle floor grid (Key: G)")
                    .clicked()
                {
                    self.show_3d_grid = !self.show_3d_grid;
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("Shading:")
                        .small()
                        .color(ecos_text_secondary()),
                );
                let mut shading = self.shading_style_3d;
                egui::ComboBox::from_id_salt("shading_style_combo")
                    .selected_text(shading.label())
                    .show_ui(ui, |ui| {
                        for s in crate::canvas_gpu3d::ShadingStyle::ALL {
                            ui.selectable_value(&mut shading, *s, s.label());
                        }
                    });
                if shading != self.shading_style_3d {
                    self.shading_style_3d = shading;
                    ui.ctx().request_repaint();
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("Lighting:")
                        .small()
                        .color(ecos_text_secondary()),
                );
                let mut lighting = self.lighting_preset_3d;
                egui::ComboBox::from_id_salt("lighting_preset_combo")
                    .selected_text(lighting.label())
                    .show_ui(ui, |ui| {
                        for l in chip_display::LightingPreset::ALL {
                            ui.selectable_value(&mut lighting, *l, l.label());
                        }
                    });
                if lighting != self.lighting_preset_3d {
                    self.lighting_preset_3d = lighting;
                    ui.ctx().request_repaint();
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("Theme:")
                        .small()
                        .color(ecos_text_secondary()),
                );
                let mut theme = self.color_theme;
                egui::ComboBox::from_id_salt("single_app_color_theme")
                    .selected_text(theme.label())
                    .show_ui(ui, |ui| {
                        for t in [
                            chip_display::ColorTheme::Foundry,
                            chip_display::ColorTheme::Classic,
                            chip_display::ColorTheme::Vivid,
                            chip_display::ColorTheme::DieShot,
                            chip_display::ColorTheme::Playful,
                            chip_display::ColorTheme::Cyber,
                        ] {
                            ui.selectable_value(&mut theme, t, t.label());
                        }
                    });
                if theme != self.color_theme {
                    self.color_theme = theme;
                    let visibility = self
                        .layers
                        .iter()
                        .map(|l| (l.layer_id, l.visible))
                        .collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                }
            });

            ui.add_space(2.0);
            ui.horizontal_wrapped(|ui| {
                ui.label(egui::RichText::new("Presets:").small().color(ecos_text_secondary()));
                if ui.small_button("Engineering").on_hover_text("Foundry Palette + PBR Normal + Studio Lighting").clicked() {
                    self.color_theme = chip_display::ColorTheme::Foundry;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Normal;
                    self.lighting_preset_3d = chip_display::LightingPreset::Studio;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("EDA Classic").on_hover_text("Classic Rainbow + PBR Normal + Laboratory Neutral Light").clicked() {
                    self.color_theme = chip_display::ColorTheme::Classic;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Normal;
                    self.lighting_preset_3d = chip_display::LightingPreset::Laboratory;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("Die Shot").on_hover_text("DieShot Realistic Metals + Optical Thin-Film Iridescence + Studio Lighting").clicked() {
                    self.color_theme = chip_display::ColorTheme::DieShot;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Iridescent;
                    self.lighting_preset_3d = chip_display::LightingPreset::Studio;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("Diorama").on_hover_text("Playful Palette + Cartoon Cel-Shading + Softbox Lighting").clicked() {
                    self.color_theme = chip_display::ColorTheme::Playful;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Cartoon;
                    self.lighting_preset_3d = chip_display::LightingPreset::Softbox;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("Cyber").on_hover_text("Cyber Palette + Tech Wireframe + Blueprint Light").clicked() {
                    self.color_theme = chip_display::ColorTheme::Cyber;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Tech;
                    self.lighting_preset_3d = chip_display::LightingPreset::Blueprint;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.add(
                    egui::Slider::new(&mut self.camera_ctrl_3d.target.z_scale, 0.05..=6.0)
                        .logarithmic(true)
                        .text("Z-scale"),
                )
                .on_hover_text("Vertical elevation scale (0.05 = flat, 1.0 = standard 3D depth, 6.0 = exaggerated)");
            });
            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.add(
                    egui::Slider::new(&mut self.z_cut_ratio_3d, 0.0..=1.0)
                        .custom_formatter(|n, _| format!("{:.0}%", n * 100.0))
                        .text("Z-Cut"),
                )
                .on_hover_text("Top-down cross-section cut (0% = Full Stack, 30-50% = Slice top power roof to see routing, 100% = Base only)");
            });
        }
    }

    fn sidebar_physical_layers_section(&mut self, ui: &mut egui::Ui, max_height: f32) {
        section_heading(ui, "PHYSICAL LAYERS");
        if self.layers.is_empty() {
            ui.label(
                egui::RichText::new("IDB layer metadata is unavailable for this snapshot.")
                    .small()
                    .color(ecos_text_secondary()),
            );
            return;
        }
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                set_layer_visibility(&mut self.layers, true);
                self.apply_object_visibility();
            }
            if ui.small_button("None").clicked() {
                set_layer_visibility(&mut self.layers, false);
                self.apply_object_visibility();
            }
            if ui.small_button("Invert").clicked() {
                invert_layer_visibility(&mut self.layers);
                self.apply_object_visibility();
            }
            ui.label(
                egui::RichText::new(format!(
                    "{}/{}",
                    visible_layer_count(&self.layers),
                    self.layers.len()
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });
        let via_shape_count = self.drawing_category_shape_count(DrawingCategory::Vias);
        if via_shape_count > 0 && !self.has_via_physical_layer() {
            ui.label(
                egui::RichText::new(format!(
                    "Vias {via_shape_count} are controlled above; this snapshot has no VIA cut layer."
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        }
        let mut layer_visibility_changed = false;
        let scroll_height = (max_height - 54.0).max(72.0);
        egui::ScrollArea::vertical()
            .max_height(scroll_height)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for layer in &mut self.layers {
                    ui.horizontal(|ui| {
                        layer_visibility_changed |= ui.checkbox(&mut layer.visible, "").changed();
                        let swatch = color32(layer.style.rgba);
                        let (rect, _) =
                            ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
                        ui.painter().rect_filled(rect, 2.0, swatch);
                        ui.label(&layer.name).on_hover_text(layer_hover_text(layer));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(
                                egui::RichText::new(layer.shape_count.to_string())
                                    .small()
                                    .color(ecos_text_secondary()),
                            );
                        });
                    });
                }
            });
        if layer_visibility_changed {
            self.apply_object_visibility();
        }
    }

    fn sidebar_drawing_data_section(&mut self, ui: &mut egui::Ui, max_height: f32) {
        section_heading(ui, "DRAWING DATA");
        let mut object_visibility_changed = false;
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                self.object_visibility.set_all_visible(true);
                object_visibility_changed = true;
            }
            if ui.small_button("None").clicked() {
                self.object_visibility.set_all_visible(false);
                object_visibility_changed = true;
            }
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} shapes",
                    self.visible_object_shape_count(),
                    self.stats.shape_count
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });
        let scroll_height = (max_height - 48.0).max(72.0);
        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_drawing_data_scroll")
            .max_height(scroll_height)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                object_visibility_changed |= self.sidebar_instances_tree(ui);
                object_visibility_changed |= self.sidebar_nets_tree(ui);
                object_visibility_changed |= self.sidebar_pdn_tree(ui);
                for category in DrawingCategory::SIDEBAR_FLAT {
                    let shape_count = self.drawing_category_shape_count(category);
                    let mut visible = self.object_visibility.is_category_visible(category);
                    ui.horizontal(|ui| {
                        ui.checkbox(&mut visible, category.label())
                            .on_hover_text(category.tooltip());
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(
                                egui::RichText::new(shape_count.to_string())
                                    .small()
                                    .color(ecos_text_secondary()),
                            );
                        });
                    });
                    if visible != self.object_visibility.is_category_visible(category) {
                        self.object_visibility
                            .set_category_visible(category, visible);
                        object_visibility_changed = true;
                    }
                }
            });
        if object_visibility_changed {
            self.apply_object_visibility();
        }
    }

    /// Tri-state "Instances" node with macro / standard-cell / filler
    /// children; single click toggles every class, double click expands or
    /// collapses the children. Returns true when any visibility flag changed.
    fn sidebar_instances_tree(&mut self, ui: &mut egui::Ui) -> bool {
        use crate::instance_visibility::{InstanceClass, SidebarGroupAction, SidebarGroupChild};

        let mut changed = false;
        let children = [
            (
                "Macro",
                InstanceClass::Macro.tooltip(),
                self.drawing_category_shape_count(DrawingCategory::InstanceMacro),
                self.object_visibility.instances.macro_,
            ),
            (
                "Halo",
                DrawingCategory::Halo.tooltip(),
                self.drawing_category_shape_count(DrawingCategory::Halo),
                self.object_visibility.halo,
            ),
            (
                "StdCell",
                InstanceClass::StdCell.tooltip(),
                self.drawing_category_shape_count(DrawingCategory::InstanceStdCell),
                self.object_visibility.instances.stdcell,
            ),
            (
                "Filler",
                InstanceClass::Filler.tooltip(),
                self.drawing_category_shape_count(DrawingCategory::InstanceFiller),
                self.object_visibility.instances.filler,
            ),
        ]
        .into_iter()
        .map(|(label, tooltip, count, visible)| SidebarGroupChild {
            label,
            tooltip,
            count,
            visible,
        })
        .collect::<Vec<_>>();
        if let Some(action) = crate::instance_visibility::sidebar_tristate_tree(
            ui,
            "drawing_data_instances_tree",
            "Instances",
            "Toggle all instance classes in the layout canvas. Double-click to expand or collapse the classes.",
            &children,
        ) {
            match action {
                SidebarGroupAction::SetAll(visible) => {
                    self.object_visibility.instances.set_all(visible);
                    self.object_visibility.halo = visible;
                }
                SidebarGroupAction::SetChild { index, visible } => match index {
                    0 => self.object_visibility.instances.set_visible(InstanceClass::Macro, visible),
                    1 => self.object_visibility.halo = visible,
                    2 => self
                        .object_visibility
                        .instances
                        .set_visible(InstanceClass::StdCell, visible),
                    _ => self
                        .object_visibility
                        .instances
                        .set_visible(InstanceClass::Filler, visible),
                },
            }
            changed = true;
        }
        changed
    }

    /// Tri-state "Nets" node with signal / clock / other children; single
    /// click toggles every kind, double click expands or collapses the
    /// children. Returns true when any visibility flag changed.
    fn sidebar_nets_tree(&mut self, ui: &mut egui::Ui) -> bool {
        use crate::instance_visibility::{SidebarGroupAction, SidebarGroupChild};

        let mut changed = false;
        let children = [
            (
                DrawingCategory::NetSignal,
                "Signal",
                self.object_visibility.net_signal,
            ),
            (
                DrawingCategory::NetClock,
                "Clock",
                self.object_visibility.net_clock,
            ),
            (
                DrawingCategory::NetOther,
                "Other",
                self.object_visibility.net_other,
            ),
        ]
        .into_iter()
        .map(|(category, label, visible)| SidebarGroupChild {
            label,
            tooltip: category.tooltip(),
            count: self.drawing_category_shape_count(category),
            visible,
        })
        .collect::<Vec<_>>();
        match crate::instance_visibility::sidebar_tristate_tree(
            ui,
            "drawing_data_nets_tree",
            "Nets",
            "Toggle all net kinds in the layout canvas. Double-click to expand or collapse the kinds.",
            &children,
        ) {
            Some(SidebarGroupAction::SetAll(visible)) => {
                self.object_visibility.net_signal = visible;
                self.object_visibility.net_clock = visible;
                self.object_visibility.net_other = visible;
                changed = true;
            }
            Some(SidebarGroupAction::SetChild { index, visible }) => {
                match index {
                    0 => self.object_visibility.net_signal = visible,
                    1 => self.object_visibility.net_clock = visible,
                    _ => self.object_visibility.net_other = visible,
                }
                changed = true;
            }
            None => {}
        }
        changed
    }

    /// Tri-state "PDN" node with power / ground children; single click
    /// toggles both, double click expands or collapses the children.
    /// Returns true when any visibility flag changed.
    fn sidebar_pdn_tree(&mut self, ui: &mut egui::Ui) -> bool {
        use crate::instance_visibility::{SidebarGroupAction, SidebarGroupChild};

        let mut changed = false;
        let children = [
            (
                DrawingCategory::PdnPower,
                "Power",
                self.object_visibility.pdn_power,
            ),
            (
                DrawingCategory::PdnGround,
                "Ground",
                self.object_visibility.pdn_ground,
            ),
        ]
        .into_iter()
        .map(|(category, label, visible)| SidebarGroupChild {
            label,
            tooltip: category.tooltip(),
            count: self.drawing_category_shape_count(category),
            visible,
        })
        .collect::<Vec<_>>();
        match crate::instance_visibility::sidebar_tristate_tree(
            ui,
            "drawing_data_pdn_tree",
            "PDN",
            "Toggle power and ground special nets in the layout canvas. Double-click to expand or collapse the classes.",
            &children,
        ) {
            Some(SidebarGroupAction::SetAll(visible)) => {
                self.object_visibility.pdn_power = visible;
                self.object_visibility.pdn_ground = visible;
                changed = true;
            }
            Some(SidebarGroupAction::SetChild { index, visible }) => {
                if index == 0 {
                    self.object_visibility.pdn_power = visible;
                } else {
                    self.object_visibility.pdn_ground = visible;
                }
                changed = true;
            }
            None => {}
        }
        changed
    }

    fn sidebar_interaction_section(&mut self, ui: &mut egui::Ui, max_height: f32) {
        section_heading(ui, "QUERY");
        self.query_input_ui(ui, (max_height - 22.0).max(112.0));
        if self.edit_enabled {
            if self.edit_command_dir.is_none() || self.edit_result_dir.is_none() {
                ui.colored_label(ecos_warning(), "edit channel is not configured");
            } else if let Some(pending) = &self.pending_session_action {
                ui.label(
                    egui::RichText::new(format!("{} pending", pending.action.label()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            } else if let Some(result) = &self.last_edit_result {
                ui.label(
                    egui::RichText::new(result)
                        .small()
                        .color(ecos_text_secondary()),
                );
            } else if self.session_dirty {
                ui.label(
                    egui::RichText::new("Unsaved changes")
                        .small()
                        .color(ecos_warning()),
                );
            }
        }
    }

    fn query_input_ui(&mut self, ui: &mut egui::Ui, height: f32) {
        const QUERY_FRAME_VERTICAL_MARGIN: f32 = 24.0;
        let content_height = (height - QUERY_FRAME_VERTICAL_MARGIN).max(88.0);
        egui::Frame::NONE
            .fill(ecos_canvas())
            .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
            .corner_radius(14)
            .inner_margin(egui::Margin::same(12))
            .show(ui, |ui| {
                ui.set_min_height(content_height);
                ui.set_max_height(content_height);
                ui.vertical(|ui| {
                    let input_height = (content_height - 46.0).max(42.0);
                    match self.query_input_mode {
                        QueryInputMode::Search => self.search_input_ui(ui, input_height),
                        QueryInputMode::ShapeId => self.shape_id_input_ui(ui, input_height),
                    }
                    ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
                        ui.horizontal(|ui| {
                            if self.query_input_mode == QueryInputMode::Search {
                                if let Some(status) = &self.last_query_status {
                                    ui.label(
                                        egui::RichText::new(status).small().color(ecos_warning()),
                                    );
                                } else if self.search_worker.is_pending() {
                                    ui.label(
                                        egui::RichText::new("Searching…")
                                            .small()
                                            .color(ecos_text_secondary()),
                                    );
                                } else if !self.search_text.trim().is_empty() {
                                    let count = self.search_highlighted.len();
                                    let (label, color) = if self.search_truncated {
                                        (format!("{count}+ matches"), ecos_warning())
                                    } else {
                                        (format!("{count} matches"), ecos_text_secondary())
                                    };
                                    ui.label(egui::RichText::new(label).small().color(color));
                                    if ui.small_button("Locate").clicked() {
                                        self.focus_search_highlights();
                                    }
                                }
                                if !self.search_text.is_empty()
                                    && ui.small_button("Clear").clicked()
                                {
                                    self.search_text.clear();
                                    self.schedule_search();
                                }
                            }
                            self.query_mode_picker(ui);
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if self.query_send_button(ui).clicked() {
                                        self.submit_query();
                                    }
                                },
                            );
                        });
                    });
                });
            });
    }

    fn query_mode_picker(&mut self, ui: &mut egui::Ui) {
        egui::ComboBox::from_id_salt("chip_viewer_query_input_mode")
            .selected_text(match self.query_input_mode {
                QueryInputMode::Search => format!("Search: {}", self.search_mode.label()),
                QueryInputMode::ShapeId => "# Shape ID".to_string(),
            })
            .width(98.0)
            .show_ui(ui, |ui| {
                if ui
                    .selectable_value(
                        &mut self.query_input_mode,
                        QueryInputMode::ShapeId,
                        "# Shape ID",
                    )
                    .changed()
                {
                    self.cancel_search();
                }
                ui.separator();
                ui.label(
                    egui::RichText::new("Search")
                        .small()
                        .color(ecos_text_secondary()),
                );
                for mode in SearchMode::ALL {
                    let changed = ui
                        .selectable_label(
                            self.query_input_mode == QueryInputMode::Search
                                && self.search_mode == mode,
                            mode.label(),
                        )
                        .clicked();
                    if changed {
                        self.query_input_mode = QueryInputMode::Search;
                        self.search_mode = mode;
                        self.schedule_search();
                    }
                }
            });
    }

    fn query_send_button(&self, ui: &mut egui::Ui) -> egui::Response {
        let label = match self.query_input_mode {
            QueryInputMode::Search => "Search",
            QueryInputMode::ShapeId => "Select",
        };
        ui.add(egui::Button::new(egui::RichText::new(label).strong()))
            .on_hover_text(match self.query_input_mode {
                QueryInputMode::Search => "Search and locate",
                QueryInputMode::ShapeId => "Select shape id",
            })
    }

    fn submit_query(&mut self) {
        match self.query_input_mode {
            QueryInputMode::Search => self.run_search_now(true),
            QueryInputMode::ShapeId => self.select_shape_id_from_input(),
        }
    }

    fn search_input_ui(&mut self, ui: &mut egui::Ui, input_height: f32) {
        let response = ui.add_sized(
            egui::vec2(ui.available_width(), input_height),
            egui::TextEdit::multiline(&mut self.search_text)
                .hint_text("Regex: name, net, instance, pin, bus, group")
                .desired_rows(2)
                .frame(false),
        );
        if response.changed() {
            self.search_text = single_line_query_text(&self.search_text);
            self.schedule_search();
        }
        let submit = response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
        if submit {
            self.submit_query();
        }
    }

    fn shape_id_input_ui(&mut self, ui: &mut egui::Ui, input_height: f32) {
        let response = ui.add_sized(
            egui::vec2(ui.available_width(), input_height),
            egui::TextEdit::multiline(&mut self.shape_id_text)
                .hint_text("Input shape id")
                .desired_rows(2)
                .frame(false),
        );
        if response.changed() {
            self.shape_id_text = single_line_query_text(&self.shape_id_text);
        }
        let submit = response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
        if submit {
            self.submit_query();
        }
        if let Some(status) = &self.last_query_status {
            ui.label(
                egui::RichText::new(status)
                    .small()
                    .color(ecos_text_secondary()),
            );
        }
    }

    fn selection_panel(&mut self, ui: &mut egui::Ui) {
        section_heading(ui, "SELECTION");
        let Some(shape_id) = self.selected else {
            info_panel_label(ui, "No shape selected");
            return;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            info_panel_label(ui, "Selected shape is no longer available");
            return;
        };
        let owner = self.db.owner_for_shape(shape);
        let owner_name = owner.and_then(|owner| self.db.owner_name(owner));
        let owner_local_name = owner.and_then(|owner| self.db.owner_local_name(owner));
        for line in selection_detail_lines(shape, owner, owner_name, owner_local_name) {
            info_panel_label(ui, line);
        }
        for line in edit_capability_lines(shape, owner, self.edit_enabled) {
            info_panel_label(ui, line);
        }
        let endpoints = selection_connectivity_endpoints(&self.db, owner, owner_name);
        for line in selection_connectivity_lines(&endpoints) {
            info_panel_label(ui, line);
        }
    }

    fn diagnostics_panel(&mut self, ui: &mut egui::Ui) {
        section_heading(ui, "DIAGNOSTICS");
        for line in design_metadata_lines(self.db.snapshot().manifest()) {
            info_panel_label(ui, line);
        }
        for line in semantic_metadata_lines(
            self.db.site_metadata().len(),
            self.db.master_metadata().len(),
            self.db.via_metadata().len(),
            self.db.grid_metadata().len(),
            self.db.connectivity_metadata().len(),
            self.db.net_metadata().len(),
            self.db.bus_metadata().len(),
            self.db.group_metadata().len(),
        ) {
            info_panel_label(ui, line);
        }
        for line in diagnostics_lines(
            &self.db.memory_stats(),
            &self.db.delta_stats(),
            self.db.view_tile_count(),
            self.render_cache.stats(),
            self.view_tile_cache.stats(),
        ) {
            info_panel_label(ui, line);
        }
    }

    fn ruler_edge_snap(
        &self,
        pointer: Point32,
        world: Rect32,
        canvas: egui::Rect,
        layer_ids: &[LayerId],
        use_view_tiles: bool,
    ) -> Option<Point32> {
        if !self.ruler_tool.active {
            return None;
        }
        let anchor = self.ruler_tool.points.last().copied()?;
        let radius = ruler_edge_snap_radius_dbu(world, canvas, self.zoom);
        let mut rects = Vec::new();
        if !use_view_tiles {
            for shape_id in self.db.query_layers_near_point(layer_ids, pointer, radius) {
                let Some(shape) = self.db.find_shape(shape_id) else {
                    continue;
                };
                if !is_renderable_shape(shape)
                    || !self.shape_is_visible(shape)
                    || !self.shape_is_drawn_at_current_zoom(shape)
                {
                    continue;
                }
                if let ShapeGeometry::Rect(rect) = self.db.shape_geometry(shape) {
                    rects.push(rect);
                }
            }
        }
        if let Some(rect) = self.selected_map_bbox {
            rects.push(rect);
        }
        nearest_orthogonal_edge_snap(anchor, pointer, &rects, radius)
    }

    fn paint_heatmap_overlay(&self, painter: &egui::Painter, canvas: egui::Rect, world: Rect32) {
        if self.analysis_tab != AnalysisTab::Map {
            return;
        }
        let Some(heatmap) = self.active_heatmap.as_ref() else {
            return;
        };
        if !self.is_gpu_active() {
            heatmap.paint_world_grid(painter, world, canvas, self.zoom, self.pan);
            return;
        }

        let instances = heatmap.instances();
        if instances.is_empty() {
            return;
        }
        let scale = world_to_screen_scale(world, canvas, self.zoom);
        let uniform = crate::canvas_gpu::CanvasUniform {
            world_center_dbu: [
                (world.lx + world.hx) as f32 * 0.5,
                (world.ly + world.hy) as f32 * 0.5,
            ],
            canvas_center_px: [
                canvas.width() * 0.5 + self.pan.x,
                canvas.height() * 0.5 + self.pan.y,
            ],
            scale_px_per_dbu: scale,
            pixels_per_point: painter.ctx().pixels_per_point(),
            pattern_min_size_px: crate::canvas_gpu::PATTERN_MIN_SIZE_PX,
            min_shape_screen_size: crate::canvas_gpu::MIN_SHAPE_SCREEN_SIZE,
            screen_size_px: [canvas.width(), canvas.height()],
            is_interacting: 0.0,
            global_alpha: heatmap.opacity,
            visibility_mask: u32::MAX,
            show_context: 1,
            pattern_frame_fade_size_px: crate::canvas_gpu::PATTERN_FRAME_FADE_SIZE_PX,
            reserved: 0,
        };

        let target_format = self
            .gpu_canvas
            .as_ref()
            .map(|g| g.target_format)
            .unwrap_or(wgpu::TextureFormat::Bgra8UnormSrgb);

        let callback = crate::canvas_gpu::HeatmapGpuCallback {
            uniform,
            instances: std::sync::Arc::clone(instances),
            target_format,
        };

        painter.add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
    }

    pub(super) fn canvas(&mut self, ui: &mut egui::Ui) {
        let canvas_start = Instant::now();
        let mut query_duration = Duration::ZERO;
        let mut filter_duration = Duration::ZERO;
        let mut paint_duration = Duration::ZERO;
        let mut estimated_primitives = 0usize;
        let mut visible_drc_count = 0usize;
        let mut visible_antenna_count = 0usize;
        let mut cpu_scene = None;
        let mut cpu_scene_pending = false;
        let mut cpu_scene_visible = false;
        let mut composition = None;
        let mut gpu_scene_pending = false;
        let available = ui.available_size();
        let (response, frame_painter) =
            ui.allocate_painter(available, egui::Sense::click_and_drag());
        let frame = response.rect;
        let bg_rgba = self.color_theme.background_rgba();
        let bg_color = egui::Color32::from_rgba_premultiplied(
            (bg_rgba[0] * 255.0).round() as u8,
            (bg_rgba[1] * 255.0).round() as u8,
            (bg_rgba[2] * 255.0).round() as u8,
            255,
        );
        if !self.glow_rendering
            || !self
                .cpu_scene_cache
                .paint_background(&frame_painter, frame, bg_color)
        {
            frame_painter.rect_filled(frame, 0.0, bg_color);
        }
        let canvas = layout_canvas_rect(frame);
        let ruler_painter = frame_painter.clone();
        let painter = frame_painter.with_clip_rect(canvas);
        let heatmap_popup_rect = self.map_heatmap_popup_rect(canvas);
        let pointer_over_heatmap = heatmap_popup_rect.is_some_and(|rect| {
            ui.ctx()
                .input(|input| input.pointer.hover_pos())
                .is_some_and(|pos| rect.contains(pos))
        });
        let pointer_in_canvas = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .is_some_and(|pos| canvas.contains(pos));
        let pointer_over_layout = pointer_in_canvas && !pointer_over_heatmap;
        let drag_started_in_canvas = ui
            .ctx()
            .input(|input| input.pointer.press_origin())
            .is_some_and(|pos| canvas.contains(pos));

        let Some(world) = self.stats.bbox else {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "empty geometry",
                egui::FontId::proportional(14.0),
                ecos_text_secondary(),
            );
            return;
        };
        // The macro staging row lives left of the die origin; widen the
        // world rect so pan/zoom/fit can reach it.
        let world = self
            .macro_staging
            .as_ref()
            .map(|staging| staging.expanded_world(world))
            .unwrap_or(world);

        self.handle_canvas_keyboard_shortcuts(ui, world, canvas);

        if self.view_mode == ViewMode::ThreeD {
            self.canvas_3d(
                ui,
                &response,
                canvas,
                &painter,
                pointer_over_layout,
                pointer_over_heatmap,
                drag_started_in_canvas,
                world,
            );
            return;
        }

        if response.hovered() && !pointer_over_heatmap {
            let raw_scroll_delta_y = ui.ctx().input(|input| input.raw_scroll_delta.y);
            let zoom_delta = ui.ctx().input(|input| input.zoom_delta());
            let zoom_factor = if raw_scroll_delta_y.abs() > 0.0 {
                scroll_zoom_factor(raw_scroll_delta_y)
            } else {
                zoom_delta
            };
            if (zoom_factor - 1.0).abs() > f32::EPSILON {
                self.focus_animation = None;
                let cursor = ui
                    .ctx()
                    .input(|input| input.pointer.hover_pos())
                    .unwrap_or(canvas.center());
                let logarithm = if raw_scroll_delta_y.abs() > 0.0 {
                    wheel_camera::scroll_logarithm(raw_scroll_delta_y)
                } else {
                    f64::from(zoom_factor).ln()
                };
                (self.zoom, self.pan) = self
                    .wheel_camera
                    .update(canvas, self.zoom, self.pan, cursor, logarithm);
                self.pan_drag.reset();
                ui.ctx().request_repaint();
            }
        }

        self.focus_pending_shape(ui.ctx(), world, canvas);

        self.gpu_frame_counter = self.gpu_frame_counter.wrapping_add(1);

        let collect_stats = env_flag_requested(std::env::var(RENDER_STATS_ENV).ok().as_deref())
            || std::env::var_os(RENDER_STATS_LOG_ENV).is_some();

        let visible_layers: BTreeMap<LayerId, LayerStyle> = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .map(|layer| (layer.layer_id, layer.style))
            .collect();
        let query_layer_ids = render_query_layer_ids(&self.layers, self.object_visibility);
        if response.drag_started() && drag_started_in_canvas && !pointer_over_heatmap {
            self.focus_animation = None;
            self.pan_drag.reset();
            let mode = if response.drag_started_by(egui::PointerButton::Middle)
                || (!self.ruler_tool.enabled
                    && response.drag_started_by(egui::PointerButton::Secondary))
            {
                Some(CanvasDragMode::Pan)
            } else if response.drag_started_by(egui::PointerButton::Primary) {
                if self.ruler_tool.enabled {
                    None
                } else {
                    let edit_start_pos = ui
                        .ctx()
                        .input(|input| input.pointer.press_origin())
                        .or_else(|| response.interact_pointer_pos());
                    let modifiers = ui.ctx().input(|input| input.modifiers);
                    let macro_mode = edit_start_pos.and_then(|pos| {
                        let point = screen_to_world_point(pos, world, canvas, self.zoom, self.pan);
                        self.begin_macro_canvas_interaction(
                            point,
                            modifiers.shift,
                            modifiers.command || modifiers.ctrl,
                            edit_pick_tolerance_dbu(world, canvas, self.zoom),
                        )
                    });
                    macro_mode.or_else(|| {
                        let edit_started = self.edit_enabled
                            && edit_start_pos.is_some_and(|pos| {
                                self.begin_edit_drag_at_pointer(pos, world, canvas)
                            });
                        Some(if edit_started {
                            CanvasDragMode::Edit
                        } else {
                            CanvasDragMode::Pan
                        })
                    })
                }
            } else {
                None
            };
            if let Some(mode) = mode {
                self.pan_drag.start(mode);
            }
        }
        if response.dragged() && !pointer_over_heatmap && self.pan_drag.mode().is_some() {
            let frame_delta = response.drag_delta();
            match self.pan_drag.mode() {
                Some(CanvasDragMode::Edit) if self.draft.is_some() => {
                    let total_delta = self.pan_drag.accumulate(frame_delta);
                    self.update_edit_drag(total_delta, world, canvas);
                    ui.ctx().request_repaint();
                }
                Some(CanvasDragMode::Pan) => {
                    self.pan = self.pan_drag.apply_pan_frame(self.pan, frame_delta);
                    ui.ctx().request_repaint();
                }
                Some(CanvasDragMode::MacroMove) => {
                    let total_delta = self.pan_drag.accumulate(frame_delta);
                    let (dx, dy) = screen_to_world_delta(total_delta, world, canvas, self.zoom);
                    self.update_macro_group_drag(dx, dy);
                    ui.ctx().request_repaint();
                }
                Some(CanvasDragMode::MacroMarquee) => {
                    if let Some(pos) = response.interact_pointer_pos() {
                        let point = screen_to_world_point(pos, world, canvas, self.zoom, self.pan);
                        self.update_macro_marquee(point);
                    }
                    ui.ctx().request_repaint();
                }
                _ => {}
            }
        }
        if response.drag_stopped() {
            match self.pan_drag.mode() {
                Some(CanvasDragMode::Edit) if self.draft.is_some() => self.commit_draft(),
                Some(CanvasDragMode::MacroMove) => self.commit_macro_group_drag(),
                Some(CanvasDragMode::MacroMarquee) => self.commit_macro_marquee(),
                _ => {}
            }
            self.pan_drag.reset();
        }

        let is_interacting = (response.dragged()
            || response.drag_started()
            || (ui.ctx().input(|i| i.zoom_delta()) - 1.0).abs() > 1e-5
            || (response.hovered()
                && ui
                    .ctx()
                    .input(|i| i.raw_scroll_delta.y.abs() > f32::EPSILON))
            || self.focus_animation.is_some())
            && !pointer_over_heatmap;
        let is_pan_interacting = self.pan_drag.mode() == Some(CanvasDragMode::Pan)
            && (response.dragged() || response.drag_started())
            && !pointer_over_heatmap;
        let camera_activity = if is_interacting {
            gpu_overview::CameraActivity::Interacting
        } else {
            gpu_overview::CameraActivity::Settled
        };
        let viewport = screen_to_world_rect(canvas, world, canvas, self.zoom, self.pan);
        let pixels_per_point = ui.ctx().pixels_per_point();
        let use_view_tiles =
            self.should_use_view_tiles(viewport, world, canvas, pixels_per_point, camera_activity);
        // This also participates in SceneKey compatibility, so it must not
        // change when the camera switches between overview and exact paths.
        let cache_cpu_overlays = !self.is_gpu_active()
            && (self.analysis_tab != AnalysisTab::Map || self.active_heatmap.is_none());
        let hover_world_point = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .filter(|_| pointer_over_layout)
            .map(|pos| screen_to_world_point(pos, world, canvas, self.zoom, self.pan));
        let interaction_point = response
            .interact_pointer_pos()
            .filter(|pos| canvas.contains(*pos) && !pointer_over_heatmap)
            .map(|pos| screen_to_world_point(pos, world, canvas, self.zoom, self.pan));
        let ruler_pointer = interaction_point.or(hover_world_point);
        let ruler_snap = ruler_pointer.and_then(|pointer| {
            self.ruler_edge_snap(pointer, world, canvas, &query_layer_ids, use_view_tiles)
        });
        let ruler_start_requested = ui.ctx().input(|input| {
            ruler_start_requested(input, self.ruler_tool.enabled, pointer_over_layout)
        });
        if ruler_start_requested {
            if self.ruler_tool.active {
                self.ruler_tool.finish();
            } else if let Some(point) = interaction_point {
                self.ruler_tool.start(point);
            }
        }
        let analysis_double_clicked =
            !self.ruler_tool.enabled && response.double_clicked_by(egui::PointerButton::Primary);
        if analysis_double_clicked && pointer_over_layout {
            if self.analysis_tab == AnalysisTab::Antenna {
                self.selected_antenna = response
                    .interact_pointer_pos()
                    .and_then(|pos| self.pick_antenna_violation_at(pos, world, canvas, viewport));
                self.selected_drc = None;
            } else if self.analysis_tab == AnalysisTab::Drc {
                self.selected_drc = response
                    .interact_pointer_pos()
                    .and_then(|pos| self.pick_drc_violation_at(pos, world, canvas, viewport));
                self.selected_antenna = None;
            }
        }
        if response.clicked_by(egui::PointerButton::Primary)
            && !analysis_double_clicked
            && pointer_over_layout
        {
            if self.ruler_tool.enabled {
                if let Some(point) = ruler_snap.or(interaction_point) {
                    self.ruler_tool.commit(point);
                }
            } else if self.macro_staging.is_some() {
                let modifiers = ui.ctx().input(|input| input.modifiers);
                let mode =
                    SelectionMode::for_click(modifiers.shift, modifiers.command || modifiers.ctrl);
                let handled = interaction_point.is_some_and(|point| {
                    self.select_macro_at(
                        point,
                        mode,
                        edit_pick_tolerance_dbu(world, canvas, self.zoom),
                    )
                });
                if !handled {
                    self.selected = response
                        .interact_pointer_pos()
                        .and_then(|pos| self.pick_shape_at(pos, world, canvas, &query_layer_ids));
                }
            } else {
                self.selected = response
                    .interact_pointer_pos()
                    .and_then(|pos| self.pick_shape_at(pos, world, canvas, &query_layer_ids));
            }
        }
        if self.pan_drag.mode() == Some(CanvasDragMode::MacroMarquee) {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
        } else if self.pan_drag.mode() == Some(CanvasDragMode::MacroMove) {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
        } else if self.ruler_tool.enabled && pointer_over_layout {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
        } else {
            if let Some(cursor_icon) = canvas_cursor_icon(
                pointer_over_layout,
                self.pan_drag.mode() == Some(CanvasDragMode::Pan)
                    && (response.drag_started() || response.dragged()),
            ) {
                ui.ctx().set_cursor_icon(cursor_icon);
            }
        }
        let mut drawn = 0usize;
        let pixels_per_point = ui.ctx().pixels_per_point();
        let use_view_tiles =
            self.should_use_view_tiles(viewport, world, canvas, pixels_per_point, camera_activity);
        let view_lod = self.view_lod_level(world, canvas, pixels_per_point);
        let hover_nearest = if use_view_tiles {
            None
        } else {
            hover_world_point.and_then(|point| {
                let radius = hover_nearest_radius_dbu(world, canvas, self.zoom);
                self.db
                    .nearest_shape(&query_layer_ids, point, Some(radius))
                    .filter(|nearest| {
                        self.db.find_shape(nearest.shape_id).is_some_and(|shape| {
                            self.shape_is_visible(shape)
                                && self.shape_is_drawn_at_current_zoom(shape)
                        })
                    })
            })
        };
        let overlay_shape_ids = overlay_shape_ids(self.selected, &self.highlighted);
        self.label_collector.clear();

        let mut overview_visible = use_view_tiles;

        let visibility_hash = layers_visibility_hash(&self.layers);
        if self.visibility_rules_cache.epoch != self.geometry_epoch
            || self.visibility_rules_cache.layer_visibility_hash != visibility_hash
        {
            self.visibility_rules_cache = VisibilityRulesCache {
                epoch: self.geometry_epoch,
                layer_visibility_hash: visibility_hash,
                layer_index: LayerRenderIndex::new(&self.layers),
                zoom_rules: ZoomVisibilityRules::new(&self.db),
            };
        }

        if use_view_tiles {
            self.gpu_tile_worker.clear_active_tiles();
            if self.is_gpu_active() {
                drawn += self.paint_gpu_2d_overview(ui, canvas, world, view_lod, &visible_layers);
            } else {
                let request = self.cpu_scene_request(
                    ui.ctx(),
                    world,
                    viewport,
                    canvas,
                    query_layer_ids.clone(),
                    bg_color,
                    cache_cpu_overlays,
                );
                cpu_scene = self.cpu_scene_cache.get_or_request(request);
                let geometry_pending = cpu_scene.as_ref().is_none_or(|scene| {
                    self.glow_rendering && !self.cpu_scene_cache.raster_ready(scene)
                });
                let labels_pending = cpu_scene
                    .as_ref()
                    .is_none_or(|scene| !self.cpu_scene_cache.labels_ready(scene));
                cpu_scene_pending = geometry_pending || labels_pending;
                if geometry_pending {
                    if self.glow_rendering {
                        self.cpu_scene_cache.paint_glow(
                            cpu_scene.as_ref(),
                            &painter,
                            bg_color,
                            None,
                        );
                    }
                    cpu_scene_visible =
                        self.glow_rendering && self.cpu_scene_cache.raster_visible();
                    if cpu_scene_visible {
                        overview_visible = false;
                    } else {
                        drawn += self.paint_cpu_2d_overview(
                            &painter,
                            viewport,
                            world,
                            canvas,
                            view_lod,
                            &visible_layers,
                        );
                    }
                } else if let Some(scene) = &cpu_scene {
                    overview_visible = false;
                    if self.glow_rendering {
                        composition = self.paint_glow_scene(
                            cpu_scene.as_ref(),
                            &painter,
                            bg_color,
                            camera_activity,
                        );
                        cpu_scene_visible = self.cpu_scene_cache.raster_visible();
                    } else {
                        scene.paint(&painter);
                        cpu_scene_visible = true;
                    }
                    drawn = scene.drawn;
                    estimated_primitives = scene.primitives;
                }
                if cpu_scene_pending {
                    ui.ctx().request_repaint_after(Duration::from_millis(16));
                }
                if let Some(scene) = &cpu_scene {
                    query_duration = scene.query_duration;
                    filter_duration = scene.filter_duration;
                }
            }
        } else {
            if self.is_gpu_active() {
                let layer_index = &self.visibility_rules_cache.layer_index;
                let gpu_start = Instant::now();

                self.gpu_tile_worker.set_view_state(
                    self.geometry_epoch,
                    self.visibility_rules_cache.layer_visibility_hash,
                );
                for (key, data) in self.gpu_tile_worker.poll() {
                    if key.geometry_epoch == self.geometry_epoch
                        && key.layer_visibility_hash
                            == self.visibility_rules_cache.layer_visibility_hash
                    {
                        self.gpu_tile_instances.insert(key, data);
                    }
                }

                self.gpu_tile_instances.retain(|key, _| {
                    key.geometry_epoch == self.geometry_epoch
                        && key.layer_visibility_hash
                            == self.visibility_rules_cache.layer_visibility_hash
                });

                let _gpu_canvas_center = canvas.center() + self.pan;

                let uniform = self.gpu_canvas_uniform(
                    world,
                    canvas,
                    ui.ctx().pixels_per_point(),
                    is_interacting,
                );

                let mut tiles = crate::canvas_gpu::tile_coords_for_bbox(
                    viewport,
                    crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                );
                let vx = (viewport.lx as i64 + viewport.hx as i64) / 2;
                let vy = (viewport.ly as i64 + viewport.hy as i64) / 2;
                let ts = crate::canvas_gpu::GPU_TILE_SIZE_DBU as i64;
                // The request channel is deliberately small. Build the most
                // useful tile at the viewport center first, then expand
                // outward instead of following raw coordinate order.
                tiles.sort_by_key(|(tx, ty)| {
                    let center_x = *tx as i64 * ts + ts / 2;
                    let center_y = *ty as i64 * ts + ts / 2;
                    let dx = center_x - vx;
                    let dy = center_y - vy;
                    dx * dx + dy * dy
                });
                let visible_tiles: std::collections::HashSet<_> = tiles.iter().copied().collect();
                // Labels are only painted on non-interacting frames, so the
                // worker skips owner-name/label allocations while interacting.
                // The tier keeps label-less and label-carrying buffers from
                // sharing a cache key; the 16ms repaint catch-up rebuilds
                // labels when a pan or zoom ends.
                let build_labels = !is_interacting;
                let tiles: Vec<_> = tiles
                    .into_iter()
                    .map(|(tx, ty)| crate::canvas_gpu::GpuBufferKey {
                        geometry_epoch: self.geometry_epoch,
                        tile_x: tx,
                        tile_y: ty,
                        zoom_tier: u8::from(build_labels),
                        layer_visibility_hash: self.visibility_rules_cache.layer_visibility_hash,
                        object_visibility_bits: 0,
                    })
                    .collect();
                let active_tile_keys = tiles.iter().copied().collect();
                self.gpu_tile_worker.set_active_tiles(active_tile_keys);

                let cached_bytes = self
                    .gpu_tile_instances
                    .values()
                    .map(|tile| tile.estimated_bytes())
                    .sum::<usize>();
                if self.gpu_tile_instances.len() > crate::canvas_gpu::MAX_CACHED_TILE_BUFFERS
                    || cached_bytes > crate::canvas_gpu::MAX_CACHED_TILE_BYTES
                {
                    let mut cached_keys: Vec<_> = self.gpu_tile_instances.keys().copied().collect();
                    cached_keys.sort_by_key(|k| {
                        let tx = k.tile_x as i64 * ts + ts / 2;
                        let ty = k.tile_y as i64 * ts + ts / 2;
                        let dx = tx - vx;
                        let dy = ty - vy;
                        (
                            !visible_tiles.contains(&(k.tile_x, k.tile_y)),
                            dx * dx + dy * dy,
                        )
                    });

                    let mut retained_bytes = 0;
                    for (index, key) in cached_keys.iter().enumerate() {
                        let size = self.gpu_tile_instances[key].estimated_bytes();
                        if visible_tiles.contains(&(key.tile_x, key.tile_y)) {
                            retained_bytes += size;
                        } else if index >= crate::canvas_gpu::MAX_CACHED_TILE_BUFFERS * 3 / 4
                            || (index > 0
                                && retained_bytes + size
                                    > crate::canvas_gpu::MAX_CACHED_TILE_BYTES * 3 / 4)
                        {
                            self.gpu_tile_instances.remove(key);
                        } else {
                            retained_bytes += size;
                        }
                    }
                }

                for buffer_key in tiles {
                    let (tx, ty) = (buffer_key.tile_x, buffer_key.tile_y);
                    let tile_bbox = Rect32 {
                        lx: tx * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                        ly: ty * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                        hx: (tx + 1) * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                        hy: (ty + 1) * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                    };
                    let Some(tile_instances) = self.gpu_tile_instances.get(&buffer_key) else {
                        gpu_scene_pending = true;
                        if let Err(err) = self.gpu_tile_worker.request(
                            buffer_key,
                            tile_bbox,
                            &query_layer_ids,
                            layer_index,
                        ) {
                            log::error!("{err}");
                            if let Some(gpu_canvas) = self.gpu_canvas.as_mut() {
                                gpu_canvas.failed = true;
                            }
                        }
                        ui.ctx().request_repaint_after(Duration::from_millis(16));
                        continue;
                    };

                    if !is_interacting {
                        for label in &tile_instances.labels {
                            if (label.category < crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY
                                && uniform.visibility_mask & (1 << label.category) == 0)
                                || (label.context_only && uniform.show_context == 0)
                            {
                                continue;
                            }
                            let screen_rect =
                                shape_screen_rect(label.rect, world, canvas, self.zoom, self.pan);
                            let visible_rect = screen_rect.intersect(canvas);
                            if screen_rect.is_positive() && visible_rect.is_positive() {
                                self.label_collector.insert(ShapeLabelCandidate {
                                    key: label.key.clone(),
                                    anchor_rect: screen_rect,
                                    text: label.text.clone(),
                                    kind: label.kind,
                                    rank_area: visible_rect.area(),
                                    selected: self.selected == Some(label.shape_id),
                                    highlighted: self.highlighted.contains(&label.shape_id),
                                });
                            }
                        }
                    }

                    drawn += tile_instances
                        .visible_count(uniform.visibility_mask, uniform.show_context != 0);

                    let target_format = self
                        .gpu_canvas
                        .as_ref()
                        .map(|g| g.target_format)
                        .unwrap_or(wgpu::TextureFormat::Bgra8UnormSrgb);

                    let callback = crate::canvas_gpu::CanvasGpuCallback {
                        uniform,
                        instances: std::sync::Arc::clone(&tile_instances.instances),
                        buffer_key,
                        frame_counter: self.gpu_frame_counter,
                        target_format,
                    };

                    ui.painter()
                        .add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
                }

                paint_duration += gpu_start.elapsed();
            } else {
                let paint_started = Instant::now();
                let request = self.cpu_scene_request(
                    ui.ctx(),
                    world,
                    viewport,
                    canvas,
                    query_layer_ids.clone(),
                    bg_color,
                    cache_cpu_overlays,
                );
                let defer_camera_request = is_pan_interacting
                    && self.glow_rendering
                    && !self.cpu_scene_cache.raster_failed();
                if defer_camera_request {
                    self.cpu_scene_cache
                        .defer_camera_request(&request, Instant::now());
                    if self
                        .cpu_scene_cache
                        .paint_glow_preview(&request, &painter, bg_color)
                    {
                        cpu_scene_pending = true;
                        ui.ctx().request_repaint_after(Duration::from_millis(16));
                    } else {
                        cpu_scene = self.cpu_scene_cache.get_or_request(request);
                        if let Some(scene) = &cpu_scene {
                            self.cpu_scene_cache.paint_glow(
                                cpu_scene.as_ref(),
                                &painter,
                                bg_color,
                                None,
                            );
                            cpu_scene_visible = self.cpu_scene_cache.raster_visible();
                            cpu_scene_pending = !self.cpu_scene_cache.raster_ready(scene)
                                || !self.cpu_scene_cache.labels_ready(scene);
                            drawn = scene.drawn + scene.overlay_drawn;
                            estimated_primitives = scene.primitives;
                        } else {
                            cpu_scene_pending = true;
                        }
                    }
                } else {
                    cpu_scene = self.cpu_scene_cache.get_or_request(request);
                    if self.glow_rendering {
                        composition = self.paint_glow_scene(
                            cpu_scene.as_ref(),
                            &painter,
                            bg_color,
                            camera_activity,
                        );
                        cpu_scene_visible = self.cpu_scene_cache.raster_visible();
                    }
                    if let Some(scene) = &cpu_scene {
                        if self.glow_rendering {
                            cpu_scene_pending = !self.cpu_scene_cache.raster_ready(scene);
                        } else {
                            scene.paint(&painter);
                            cpu_scene_visible = true;
                        }
                        if !cpu_scene_pending {
                            drawn = scene.drawn + scene.overlay_drawn;
                            estimated_primitives = scene.primitives;
                        }
                        cpu_scene_pending |= !self.cpu_scene_cache.labels_ready(scene);
                        query_duration = scene.query_duration;
                        filter_duration = scene.filter_duration;
                    } else {
                        cpu_scene_pending = true;
                    }
                    if cpu_scene_pending {
                        ui.ctx().request_repaint_after(Duration::from_millis(16));
                    }
                }
                paint_duration += paint_started.elapsed();
            }
        }
        let geometry_drawn_shapes =
            drawn.saturating_sub(cpu_scene.as_ref().map_or(0, |scene| scene.overlay_drawn));
        if !self.spatial_index_prewarm_started && !cpu_scene_pending && drawn > 0 {
            self.spatial_index_prewarm_started = true;
            let db = Arc::clone(&self.db);
            thread::spawn(move || db.prewarm_spatial_indexes());
        }
        if !is_interacting {
            self.queue_selected_pin_label(world, canvas);
        }
        // The heatmap is an overlay: paint it after the geometry (and after
        // the view-tile overview branch) so rows / obstructions / instances
        // stacked over the whole die do not hide the density map. Skipping it
        // in the overview branch used to make the EGR maps do nothing at the
        // fit-to-die zoom where they matter most.
        let guides = self.unrouted_net_guides.get();
        let paint_overlays = |painter: &egui::Painter| {
            self.paint_heatmap_overlay(painter, canvas, world);
            if cache_cpu_overlays && !overview_visible {
                return 0;
            }
            let grid_count = paint_parameterized_grid_overlay(
                painter,
                self.db.grid_metadata(),
                &self.layers,
                self.object_visibility,
                viewport,
                self.grid_bounds.unwrap_or(world),
                world,
                canvas,
                self.zoom,
                self.pan,
            );
            grid_count
                + guides.map_or(0, |guides| {
                    paint_unrouted_net_guides(
                        painter,
                        guides,
                        self.object_visibility,
                        viewport,
                        world,
                        canvas,
                        self.zoom,
                        self.pan,
                    )
                })
        };
        if let Some(heatmap_composition::Composition::Reused(overlay_count)) = composition {
            drawn += overlay_count;
        } else {
            let pan_preview = self.active_heatmap.as_ref().and_then(|heatmap| {
                if composition.is_some()
                    || self.analysis_tab != AnalysisTab::Map
                    || !self.glow_rendering
                    || !(is_pan_interacting || (cpu_scene_pending && cpu_scene_visible))
                {
                    return None;
                }
                self.heatmap_composition.paint_pan(
                    &painter,
                    self.cpu_scene_cache.raster_key()?,
                    heatmap,
                    guides.is_some(),
                )
            });
            if let Some(preview) = pan_preview {
                for strip in preview.exposed.into_iter().filter(egui::Rect::is_positive) {
                    paint_overlays(&painter.with_clip_rect(strip));
                }
                drawn += preview.overlay_count;
            } else {
                let overlay_count = paint_overlays(&painter);
                if let Some(heatmap_composition::Composition::Capture(key)) = composition {
                    self.heatmap_composition
                        .capture(&painter, key, overlay_count);
                }
                drawn += overlay_count;
            }
        }

        let label_resolve_started = collect_stats.then(Instant::now);
        let resolved_labels = if is_interacting || (cpu_scene_pending && cpu_scene.is_none()) {
            Arc::new(ResolvedLabels::default())
        } else {
            let ctx = ui.ctx().clone();
            let measure = move |text: &str, size| {
                ctx.fonts(|fonts| {
                    fonts
                        .layout_no_wrap(
                            text.to_owned(),
                            egui::FontId::proportional(size),
                            egui::Color32::WHITE,
                        )
                        .size()
                })
            };
            if let Some(scene) = &cpu_scene {
                scene.resolved_labels()
            } else {
                Arc::new(self.label_collector.resolve(canvas, measure))
            }
        };
        let label_resolve_duration =
            label_resolve_started.map_or(Duration::ZERO, |start| start.elapsed());
        let mut label_paint_duration = Duration::ZERO;
        if !is_interacting {
            let label_paint_start = collect_stats.then(Instant::now);
            for overlay in resolved_labels
                .labels
                .iter()
                .filter(|label| !label.selected)
            {
                paint_shape_label_overlay(&painter, overlay, canvas);
            }
            if let Some(start) = label_paint_start {
                label_paint_duration = start.elapsed();
            }
        }

        let hidden_drc_layer_names: std::collections::HashSet<String> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.to_ascii_lowercase())
            .collect();

        let visible_drc_types: std::collections::HashSet<&str> = self
            .drc_overlay
            .as_ref()
            .map(|o| {
                o.type_states
                    .iter()
                    .filter(|s| s.visible)
                    .map(|s| s.name.as_str())
                    .collect()
            })
            .unwrap_or_default();

        let visible_antenna_types: std::collections::HashSet<&str> = self
            .antenna_overlay
            .as_ref()
            .map(|o| {
                o.type_states
                    .iter()
                    .filter(|s| s.visible)
                    .map(|s| s.name.as_str())
                    .collect()
            })
            .unwrap_or_default();

        let viewport_aabb =
            rstar::AABB::from_corners([viewport.lx, viewport.ly], [viewport.hx, viewport.hy]);

        if let Some(overlay) = &self.drc_overlay {
            for node in overlay.rtree.locate_in_envelope_intersecting(viewport_aabb) {
                let violation = &overlay.violations[node.index];
                if !hidden_drc_layer_names.contains(&violation.layer)
                    && visible_drc_types.contains(violation.drc_type.as_str())
                {
                    visible_drc_count += 1;
                    if paint_drc_violation_overlay(
                        &painter,
                        violation,
                        world,
                        canvas,
                        self.zoom,
                        self.pan,
                        self.selected_drc == Some(violation.id),
                    ) {
                        drawn += 1;
                    }
                }
            }
        }

        if let Some(overlay) = &self.antenna_overlay {
            for node in overlay.rtree.locate_in_envelope_intersecting(viewport_aabb) {
                let violation = &overlay.violations[node.index];
                if antenna_layer_is_visible(&self.layers, &violation.layer)
                    && visible_antenna_types.contains(violation.antenna_type.as_str())
                {
                    visible_antenna_count += 1;
                    if paint_antenna_violation_overlay(
                        &painter,
                        violation,
                        world,
                        canvas,
                        self.zoom,
                        self.pan,
                        self.selected_antenna == Some(violation.id),
                    ) {
                        drawn += 1;
                    }
                }
            }
        }

        if self.analysis_tab == AnalysisTab::Lvs {
            if let Some(analysis) = &self.lvs_analysis {
                if self.show_all_lvs {
                    for rect in analysis.all_shape_rects() {
                        if paint_lvs_anomaly_overlay(
                            &painter, *rect, world, canvas, self.zoom, self.pan,
                        ) {
                            drawn += 1;
                        }
                    }
                } else if let Some(rects) = analysis.selected_shape_rects(self.selected_lvs_group) {
                    for rect in rects {
                        if paint_lvs_anomaly_overlay(
                            &painter, *rect, world, canvas, self.zoom, self.pan,
                        ) {
                            drawn += 1;
                        }
                    }
                }
            }
        }

        if self.analysis_tab == AnalysisTab::Timing {
            if let Some(timing) = &self.timing {
                drawn += timing.paint(
                    &self.db, &painter, world, viewport, canvas, self.zoom, self.pan,
                );
            }
        }

        if self.analysis_tab == AnalysisTab::Map {
            if let Some(bbox) = self.selected_map_bbox {
                paint_map_selection_overlay(&painter, bbox, world, canvas, self.zoom, self.pan);
            }
        }

        for shape_id in &overlay_shape_ids {
            let Some(shape) = self.db.find_shape(*shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) {
                continue;
            }
            if !self.highlighted.contains(shape_id) && !self.shape_is_visible(shape) {
                continue;
            }
            if !self.highlighted.contains(shape_id) && !self.shape_is_drawn_at_current_zoom(shape) {
                continue;
            }
            let geometry = self.db.shape_geometry(shape);
            if let Some(role) = self
                .clock_tree_overlay
                .highlight()
                .and_then(|highlight| highlight.role_for(*shape_id))
            {
                paint_clock_tree_highlight_overlay(
                    &painter, geometry, world, canvas, self.zoom, self.pan, role,
                );
            } else if self.highlighted.contains(shape_id) {
                paint_search_highlight_overlay(
                    &painter, geometry, world, canvas, self.zoom, self.pan,
                );
            }
            if self.selected == Some(*shape_id) {
                paint_shape_overlay(
                    &painter,
                    geometry,
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                    egui::Stroke::new(2.0_f32, ecos_accent()),
                );
            }
        }

        if !is_interacting {
            if let Some(selected_label) = resolved_labels.labels.iter().find(|label| label.selected)
            {
                let selected_paint_start = collect_stats.then(Instant::now);
                paint_shape_label_overlay(&painter, selected_label, canvas);
                if let Some(start) = selected_paint_start {
                    label_paint_duration += start.elapsed();
                }
            }
        }

        if let Some(highlight) = self.clock_tree_overlay.highlight() {
            paint_clock_tree_node_markers(
                &painter,
                &highlight.markers,
                world,
                canvas,
                self.zoom,
                self.pan,
            );
        }

        if let Some(draft) = &self.draft {
            let screen =
                world_to_screen_rect(draft.requested_bbox, world, canvas, self.zoom, self.pan);
            let stroke_color = if self.macro_draft_collider().is_some() {
                egui::Color32::from_rgb(248, 113, 113)
            } else {
                ecos_accent()
            };
            painter.rect_stroke(
                screen.expand(2.0),
                0.0,
                egui::Stroke::new(2.0_f32, stroke_color),
                egui::StrokeKind::Inside,
            );
        }
        self.paint_macro_staging(&painter, world, canvas);
        self.paint_macro_interaction(&painter, world, canvas);

        paint_scale_ruler(
            &painter,
            world,
            canvas,
            self.zoom,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        );

        let ruler_preview = ruler_snap
            .or(hover_world_point)
            .and_then(|point| self.ruler_tool.preview(point));
        paint_orthogonal_ruler(
            &painter,
            &self.ruler_tool.points,
            ruler_preview,
            ruler_snap,
            world,
            canvas,
            self.zoom,
            self.pan,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        );

        self.status_line_buffer.clear();
        canvas_status_line_into(
            &mut self.status_line_buffer,
            drawn,
            overlay_shape_ids.len(),
            overview_visible,
            view_lod,
            self.zoom,
            viewport,
        );
        painter.text(
            canvas.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            self.status_line_buffer.as_str(),
            egui::FontId::proportional(13.0),
            ecos_text_secondary(),
        );
        if cpu_scene_pending && self.glow_rendering && self.cpu_scene_cache.raster_partial() {
            painter.text(
                canvas.right_top() + egui::vec2(-10.0, 10.0),
                egui::Align2::RIGHT_TOP,
                "Partial preview - building exact layout",
                egui::FontId::proportional(12.0),
                ecos_text_secondary(),
            );
        }
        self.paint_reload_indicator(ui, &painter, canvas);

        if collect_stats {
            let (cpu_retained_valid_pixels, cpu_retained_validation_ms) =
                self.cpu_scene_cache.retained_stats();
            let stats = CanvasRenderStats {
                frame_time_ms: canvas_start.elapsed().as_secs_f32() * 1000.0,
                frame_interval_ms: 0.0,
                previous_native_cpu_ms: self.previous_native_cpu_ms,
                previous_ui_update_ms: self.previous_ui_update_ms,
                query_time_ms: query_duration.as_secs_f32() * 1000.0,
                filter_time_ms: filter_duration.as_secs_f32() * 1000.0,
                paint_time_ms: paint_duration.as_secs_f32() * 1000.0,
                label_paint_time_ms: label_paint_duration.as_secs_f32() * 1000.0,
                label_resolve_time_ms: label_resolve_duration.as_secs_f32() * 1000.0,
                drawn_shapes: drawn,
                estimated_primitives,
                label_count: resolved_labels.labels.len(),
                selected_shape_id: self.selected,
                use_view_tiles: overview_visible,
                zoom: self.zoom,
                lod: view_lod,
                visible_drc_count,
                visible_antenna_count,
                is_gpu: self.is_gpu_active(),
                cpu_scene_pending,
                cpu_scene_visible,
                cpu_stats_after_paint: false,
                cpu_scene_preview: self.glow_rendering && self.cpu_scene_cache.raster_preview(),
                cpu_scene_held: false,
                cpu_scene_partial: self.cpu_scene_cache.raster_partial(),
                cpu_retained_valid_pixels,
                cpu_retained_validation_ms,
                cpu_history_bytes: self.cpu_scene_cache.history_bytes(),
                cpu_scene_cache_hit: self.cpu_scene_cache.restored(),
                cpu_labels_pending: cpu_scene
                    .as_ref()
                    .is_some_and(|scene| !self.cpu_scene_cache.labels_ready(scene)),
                cpu_scene_build_ms: cpu_scene
                    .as_ref()
                    .map_or(0.0, |scene| scene.build_duration.as_secs_f32() * 1000.0),
                cpu_scene_pipeline_ms: cpu_scene
                    .as_ref()
                    .map_or(0.0, |scene| scene.pipeline_duration.as_secs_f32() * 1000.0),
                cpu_rasterizations: self.cpu_scene_cache.rasterizations(),
                scene_pending: cpu_scene_pending || gpu_scene_pending,
                geometry_drawn_shapes,
                cpu_scene_raster_ms: cpu_scene
                    .as_ref()
                    .map_or(0.0, |scene| scene.raster_duration.as_secs_f32() * 1000.0),
                cpu_label_resolve_ms: cpu_scene
                    .as_ref()
                    .map_or(0.0, |scene| scene.label_duration().as_secs_f32() * 1000.0),
                previous_raster_present_ms: self.cpu_scene_cache.paint_ms(),
            };
            if !(self.glow_rendering
                && !stats.is_gpu
                && self.cpu_scene_cache.record_glow_stats(&painter, &stats))
            {
                record_render_stats(&stats);
            }
            if env_flag_requested(std::env::var(RENDER_STATS_ENV).ok().as_deref()) {
                paint_render_stats_overlay(&painter, canvas, &stats);
            }
        }

        if let Some(point) = hover_world_point {
            self.status_line_buffer.clear();
            hover_status_line_into(
                &mut self.status_line_buffer,
                point,
                self.coordinate_unit,
                self.db.snapshot().manifest().dbu_per_micron,
                hover_nearest,
            );
            if self.analysis_tab == AnalysisTab::Map {
                if let Some(heatmap) = &self.active_heatmap {
                    if let Some((row, col)) = heatmap.data.cell_at_world_point(point) {
                        if let Some(val) = heatmap.data.value(row, col) {
                            let _ = std::fmt::Write::write_fmt(
                                &mut self.status_line_buffer,
                                format_args!(
                                    " | Heatmap: {} (Row {row}, Col {col})",
                                    format_map_value(val)
                                ),
                            );
                        }
                    }
                }
            }
            painter.text(
                canvas.left_top() + egui::vec2(10.0, 28.0),
                egui::Align2::LEFT_TOP,
                self.status_line_buffer.as_str(),
                egui::FontId::monospace(12.0),
                ecos_text_secondary(),
            );
        }
        if let Some(status) = ruler_status_line(
            &self.ruler_tool.points,
            ruler_preview,
            self.ruler_tool.active,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        ) {
            painter.text(
                canvas.left_top() + egui::vec2(10.0, 46.0),
                egui::Align2::LEFT_TOP,
                status,
                egui::FontId::monospace(12.0),
                ecos_info_text(),
            );
        }
        paint_coordinate_rulers(
            &ruler_painter,
            frame,
            canvas,
            world,
            self.zoom,
            self.pan,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        );
        self.canvas_info_overlay(ui, canvas);
        self.drc_detail_overlay(ui, canvas);
        self.antenna_detail_overlay(ui, canvas);
        self.map_heatmap_overlay(ui, canvas);
    }

    fn map_heatmap_popup_rect(&self, canvas: egui::Rect) -> Option<egui::Rect> {
        if self.analysis_tab != AnalysisTab::Map {
            return None;
        }
        let heatmap = self.active_heatmap.as_ref()?;
        if heatmap.data.is_instance_power() {
            return Some(crate::power_map::legend_rect(canvas));
        }
        let (popup_size, _) =
            map_heatmap_layout(canvas, heatmap.data.rows(), heatmap.data.columns());
        let min = egui::pos2(
            (canvas.right() - popup_size.x - 12.0).max(canvas.left() + 12.0),
            (canvas.bottom() - popup_size.y - 12.0).max(canvas.top() + 12.0),
        );
        Some(egui::Rect::from_min_size(min, popup_size))
    }

    fn map_heatmap_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(popup_rect) = self.map_heatmap_popup_rect(canvas) else {
            return;
        };
        let Some(heatmap) = self.active_heatmap.as_ref() else {
            return;
        };
        if heatmap.data.is_instance_power() {
            if crate::power_map::legend(
                ui.ctx(),
                canvas,
                &heatmap.title,
                &heatmap.data,
                heatmap.colormap_mode,
            ) {
                self.active_heatmap = None;
                self.selected_map_item = None;
            }
            return;
        }
        let title = heatmap.title.clone();
        let rows = heatmap.data.rows();
        let columns = heatmap.data.columns();
        let selected_cell = heatmap.selected_cell;
        let (_, grid_size) = map_heatmap_layout(canvas, rows, columns);
        let mut close_requested = false;
        let mut focus_peak_requested = false;
        let mut clicked_cell = None;
        let mut updated_threshold = None;
        let mut updated_invert = None;
        let ctx = ui.ctx().clone();

        egui::Area::new(egui::Id::new("chip_viewer_map_heatmap_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_rect.min)
            .show(&ctx, |ui| {
                ui.set_width(popup_rect.width());
                egui::Frame::NONE
                    .fill(egui::Color32::from_rgb(29, 30, 34))
                    .stroke(egui::Stroke::new(1.0_f32, ecos_accent()))
                    .corner_radius(8)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(popup_rect.size() - egui::vec2(20.0, 20.0));
                        ui.horizontal(|ui| {
                            ui.add(
                                egui::Label::new(
                                    egui::RichText::new(&title)
                                        .strong()
                                        .size(13.0)
                                        .color(ecos_text_primary()),
                                )
                                .truncate(),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui
                                        .small_button("×")
                                        .on_hover_text("Close heatmap")
                                        .clicked()
                                    {
                                        close_requested = true;
                                    }
                                },
                            );
                        });
                        ui.label(
                            egui::RichText::new(format!("{rows} rows × {columns} columns"))
                                .small()
                                .color(ecos_text_secondary()),
                        );
                        ui.add_space(2.0);

                        ui.horizontal(|ui| {
                            let side_padding =
                                ((ui.available_width() - grid_size.x) * 0.5).max(0.0);
                            ui.add_space(side_padding);
                            let (grid_rect, response) =
                                ui.allocate_exact_size(grid_size, egui::Sense::click());
                            let painter = ui.painter_at(grid_rect);
                            paint_heatmap_grid(&painter, grid_rect, heatmap);
                            let hovered_cell = response.hover_pos().and_then(|pos| {
                                interactive_heatmap_cell_at(pos, grid_rect, &heatmap.data)
                            });
                            if let Some((row, column)) = hovered_cell {
                                paint_heatmap_cell_outline(
                                    &painter,
                                    grid_rect,
                                    rows,
                                    columns,
                                    row,
                                    column,
                                    egui::Stroke::new(1.5_f32, egui::Color32::WHITE),
                                );
                                if let Some(value) = heatmap.data.value(row, column) {
                                    response.clone().on_hover_text(format!(
                                        "row {row}, column {column}\nvalue {}",
                                        format_map_value(value)
                                    ));
                                }
                            }
                            if response.clicked() {
                                clicked_cell = hovered_cell;
                            }
                        });

                        if let Some((row, column)) = selected_cell {
                            let detail = heatmap.data.value(row, column).map_or_else(
                                || format!("row {row} · column {column}"),
                                |value| {
                                    format!(
                                        "row {row} · column {column} · {}",
                                        format_map_value(value)
                                    )
                                },
                            );
                            ui.label(
                                egui::RichText::new(detail)
                                    .monospace()
                                    .size(11.0)
                                    .color(ecos_info_text()),
                            );
                        } else {
                            ui.label(
                                egui::RichText::new("Select a cell to focus the layout")
                                    .size(11.0)
                                    .color(ecos_text_secondary()),
                            );
                        }
                        let mut new_threshold = heatmap.threshold;
                        let mut new_invert = heatmap.invert_threshold;
                        let (thresh_chg, inv_chg, peak_req) = paint_heatmap_legend(
                            ui,
                            heatmap.data.min(),
                            heatmap.data.max(),
                            heatmap.colormap_mode,
                            &mut new_threshold,
                            &mut new_invert,
                        );
                        if thresh_chg {
                            updated_threshold = Some(new_threshold);
                        }
                        if inv_chg {
                            updated_invert = Some(new_invert);
                        }
                        if peak_req {
                            focus_peak_requested = true;
                        }
                    });
            });

        if let Some(threshold) = updated_threshold {
            if let Some(heatmap) = self.active_heatmap.as_mut() {
                heatmap.set_threshold(threshold);
            }
        }
        if let Some(invert) = updated_invert {
            if let Some(heatmap) = self.active_heatmap.as_mut() {
                heatmap.set_invert_threshold(invert);
            }
        }
        if focus_peak_requested {
            if let Some(heatmap) = self.active_heatmap.as_ref() {
                clicked_cell = heatmap
                    .data
                    .next_peak_cell(heatmap.selected_cell, heatmap.invert_threshold);
            }
        }

        if close_requested {
            self.active_heatmap = None;
            self.selected_map_bbox = None;
            return;
        }
        let Some((row, column)) = clicked_cell else {
            return;
        };
        let bbox = self
            .active_heatmap
            .as_ref()
            .and_then(|heatmap| heatmap.data.bbox(row, column));
        if let Some(heatmap) = self.active_heatmap.as_mut() {
            heatmap.selected_cell = Some((row, column));
        }
        if let Some(bbox) = bbox {
            self.selected_map_bbox = Some(bbox);
            self.pending_focus = Some(PendingFocus {
                bbox: contextual_map_focus_bbox(bbox),
                select_shape_id: None,
                transition: FocusTransition::Animated,
            });
            self.selected = None;
            self.pan_drag.reset();
            ui.ctx().request_repaint();
        } else {
            self.map_item_error = Some(format!(
                "layout.csv has no coordinate mapping for row {row}, column {column}"
            ));
        }
    }

    fn canvas_info_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(panel) = self.sidebar_info_panel else {
            return;
        };

        let ctx = ui.ctx().clone();
        let popup_width = (canvas.width() * 0.32)
            .clamp(320.0, 430.0)
            .min((canvas.width() - 24.0).max(180.0));
        let popup_height = (canvas.height() * 0.34)
            .clamp(220.0, 310.0)
            .min((canvas.height() - 24.0).max(160.0));
        let popup_y = if self.analysis_tab == AnalysisTab::Map && self.active_heatmap.is_some() {
            canvas.top() + 12.0
        } else {
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0)
        };
        let popup_pos = egui::pos2(
            (canvas.right() - popup_width - 12.0).max(canvas.left() + 12.0),
            popup_y,
        );

        egui::Area::new(egui::Id::new("chip_viewer_canvas_info_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
                    .corner_radius(12)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(egui::vec2(popup_width - 20.0, popup_height - 20.0));
                        ui.horizontal(|ui| {
                            section_heading(ui, panel.label());
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui.small_button("×").on_hover_text("Hide panel").clicked() {
                                        self.sidebar_info_panel = None;
                                    }
                                },
                            );
                        });
                        egui::ScrollArea::vertical()
                            .id_salt("chip_viewer_canvas_info_popup_scroll")
                            .max_height(popup_height - 56.0)
                            .auto_shrink([false, false])
                            .show(ui, |ui| match panel {
                                SidebarInfoPanel::Selection => self.selection_panel(ui),
                                SidebarInfoPanel::Diagnostics => self.diagnostics_panel(ui),
                            });
                    });
            });
    }

    fn canvas_3d(
        &mut self,
        ui: &mut egui::Ui,
        response: &egui::Response,
        canvas: egui::Rect,
        painter: &egui::Painter,
        pointer_over_layout: bool,
        pointer_over_heatmap: bool,
        drag_started_in_canvas: bool,
        world: Rect32,
    ) {
        if !self.is_gpu_active() {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "3D acceleration unavailable in this environment.\n2D layout rendering remains available.",
                egui::FontId::proportional(14.0),
                ecos_text_secondary(),
            );
            return;
        }

        self.ensure_3d_view(world, canvas);

        let dt = ui.input(|i| i.stable_dt);
        let animating_3d = self.camera_ctrl_3d.update(dt);
        if animating_3d {
            ui.ctx().request_repaint();
        }

        let current_camera = self.camera_ctrl_3d.current;

        if let Some(focus) = self.pending_focus.take() {
            let span = ((focus.bbox.hx - focus.bbox.lx).max(focus.bbox.hy - focus.bbox.ly) as f32)
                .max(1.0);
            self.camera_ctrl_3d.focus_xy(
                (focus.bbox.lx + focus.bbox.hx) as f32 * 0.5,
                (focus.bbox.ly + focus.bbox.hy) as f32 * 0.5,
                span,
                self.layer_stack.height(),
            );
            self.selected = focus.select_shape_id;
            self.pan_drag.reset();
        }

        let pointer_over_zoom_target = !pointer_over_heatmap
            && ui.ctx().input(|input| {
                input
                    .pointer
                    .hover_pos()
                    .is_some_and(|pos| canvas.contains(pos) || response.rect.contains(pos))
            });
        if pointer_over_zoom_target {
            let (scroll_y, pinch_zoom) = ui.ctx().input(|input| {
                let scroll_y = if input.raw_scroll_delta.y.abs() > f32::EPSILON {
                    input.raw_scroll_delta.y
                } else {
                    input.smooth_scroll_delta.y
                };
                (scroll_y, input.zoom_delta())
            });
            if scroll_y.abs() > f32::EPSILON || (pinch_zoom - 1.0).abs() > f32::EPSILON {
                let pivot = ui
                    .ctx()
                    .input(|input| input.pointer.hover_pos())
                    .and_then(|pos| {
                        current_camera.cursor_pivot(
                            [pos.x, pos.y],
                            [canvas.left(), canvas.top()],
                            [canvas.width(), canvas.height()],
                            world,
                            self.layer_stack.height(),
                        )
                    });
                let steps = if scroll_y.abs() > f32::EPSILON {
                    scroll_y / 50.0
                } else {
                    (pinch_zoom - 1.0) * 10.0
                };
                let fine = ui.input(|i| i.modifiers.ctrl || i.modifiers.command);
                self.camera_ctrl_3d.dolly_steps(steps, pivot, fine);
                ui.ctx().input_mut(|input| {
                    input.raw_scroll_delta.y = 0.0;
                    input.smooth_scroll_delta.y = 0.0;
                });
                self.pan_drag.reset();
                ui.ctx().request_repaint();
            }
        }

        let modifier_scale = if ui.input(|i| i.modifiers.shift) {
            0.25
        } else if ui.input(|i| i.modifiers.ctrl || i.modifiers.command) {
            4.0
        } else {
            1.0
        };

        if response.drag_started() && drag_started_in_canvas && !pointer_over_heatmap {
            let mode = if response.drag_started_by(egui::PointerButton::Middle)
                || response.drag_started_by(egui::PointerButton::Secondary)
            {
                Some(CanvasDragMode::Pan)
            } else if response.drag_started_by(egui::PointerButton::Primary) {
                Some(CanvasDragMode::Edit)
            } else {
                None
            };
            if let Some(mode) = mode {
                self.camera_ctrl_3d.start_drag();
                self.pan_drag.start(mode);
            }
        }
        if response.dragged() && !pointer_over_heatmap {
            let delta = response.drag_delta();
            match self.pan_drag.mode() {
                Some(CanvasDragMode::Edit) => {
                    self.camera_ctrl_3d.orbit(delta.x, delta.y, modifier_scale);
                    ui.ctx().request_repaint();
                }
                Some(CanvasDragMode::Pan) => {
                    self.camera_ctrl_3d.pan(delta.x, delta.y, modifier_scale);
                    ui.ctx().request_repaint();
                }
                _ => {}
            }
        }
        if response.drag_stopped() {
            self.camera_ctrl_3d.stop_drag();
            self.pan_drag.reset();
        }

        if response.double_clicked_by(egui::PointerButton::Primary) && pointer_over_layout {
            if let Some(pos) = response.interact_pointer_pos() {
                if let Some(point) = self.hover_world_point_3d(pos, canvas) {
                    let span = (current_camera.distance * 0.35).max(100.0);
                    self.camera_ctrl_3d.focus_xy(
                        point.x as f32,
                        point.y as f32,
                        span,
                        self.layer_stack.height(),
                    );
                    ui.ctx().request_repaint();
                }
            }
        }

        let query_layer_ids = render_query_layer_ids(&self.layers, self.object_visibility);
        if response.clicked_by(egui::PointerButton::Primary) && pointer_over_layout {
            self.selected = response
                .interact_pointer_pos()
                .and_then(|pos| self.pick_shape_at_3d(pos, canvas, world, &query_layer_ids));
        }

        if pointer_over_layout {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
        }

        let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
        let die_diag = crate::canvas_gpu3d::die_diagonal(world);
        let is_zoomed_out = current_camera.distance >= die_diag * 0.7;
        let ground_viewport =
            current_camera.visible_ground_rect(aspect, self.layer_stack.height(), world);
        let covers_majority = (ground_viewport.hx - ground_viewport.lx)
            >= (world.hx - world.lx) * 2 / 3
            || (ground_viewport.hy - ground_viewport.ly) >= (world.hy - world.ly) * 2 / 3;
        let stable_viewport = if is_zoomed_out || covers_majority {
            world
        } else {
            ground_viewport
        };

        let visibility_hash = layers_visibility_hash(&self.layers);
        // Overview slabs replace per-shape instances once the camera is far
        // enough out that shapes are meaningless; the lod rides in the
        // cache key so a lod switch rebuilds the buffer.
        let using_overview_tiles = self.is_gpu_active()
            && self.db.view_tile_count() > 0
            && crate::canvas_gpu3d::use_overview_slabs(current_camera, world);
        let overview_lod = if using_overview_tiles {
            crate::canvas_gpu3d::overview_lod_level(current_camera, world)
        } else {
            0
        };
        let pixels_per_point = ui.ctx().pixels_per_point();

        // Base key for cached 3D instance buffer (state that invalidates the whole cache)
        let base_key = {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            self.geometry_epoch.hash(&mut hasher);
            visibility_hash.hash(&mut hasher);
            self.color_theme.hash(&mut hasher);
            self.layer_stack.height().to_bits().hash(&mut hasher);
            self.object_visibility.bits().hash(&mut hasher);
            using_overview_tiles.hash(&mut hasher);
            overview_lod.hash(&mut hasher);
            self.selected.hash(&mut hasher);
            self.highlighted.len().hash(&mut hasher);
            for id in &self.highlighted {
                id.hash(&mut hasher);
            }
            if let Some(highlight) = self.clock_tree_overlay.highlight() {
                for id in &highlight.parent_shapes {
                    1u8.hash(&mut hasher);
                    id.hash(&mut hasher);
                }
                for id in &highlight.child_shapes {
                    2u8.hash(&mut hasher);
                    id.hash(&mut hasher);
                }
            }
            hasher.finish()
        };

        let is_dragging = self.pan_drag.mode().is_some() || animating_3d;

        let instances = if let Some((cached_key, cached_envelope, cached_instances)) =
            &self.gpu_3d_instances_cache
        {
            let is_contained = using_overview_tiles
                || (cached_envelope.lx == world.lx
                    && cached_envelope.ly == world.ly
                    && cached_envelope.hx == world.hx
                    && cached_envelope.hy == world.hy
                    && (is_zoomed_out || covers_majority))
                || (cached_envelope.lx <= stable_viewport.lx
                    && cached_envelope.ly <= stable_viewport.ly
                    && cached_envelope.hx >= stable_viewport.hx
                    && cached_envelope.hy >= stable_viewport.hy);

            let needs_expansion = (is_zoomed_out || covers_majority) && *cached_envelope != world;
            if *cached_key == base_key && is_contained && (!needs_expansion || is_dragging) {
                cached_instances.clone()
            } else {
                let vp_w = (stable_viewport.hx - stable_viewport.lx).max(1);
                let vp_h = (stable_viewport.hy - stable_viewport.ly).max(1);
                let pad_x = (vp_w as f32 * 0.80) as i32;
                let pad_y = (vp_h as f32 * 0.80) as i32;
                let envelope = if using_overview_tiles || is_zoomed_out || covers_majority {
                    world
                } else {
                    Rect32 {
                        lx: (stable_viewport.lx - pad_x).max(world.lx),
                        ly: (stable_viewport.ly - pad_y).max(world.ly),
                        hx: (stable_viewport.hx + pad_x).min(world.hx),
                        hy: (stable_viewport.hy + pad_y).min(world.hy),
                    }
                };

                let new_instances = std::sync::Arc::new(self.build_3d_instances(
                    world,
                    envelope,
                    &query_layer_ids,
                    using_overview_tiles,
                ));
                self.gpu_3d_instances_cache = Some((base_key, envelope, new_instances.clone()));
                new_instances
            }
        } else {
            let vp_w = (stable_viewport.hx - stable_viewport.lx).max(1);
            let vp_h = (stable_viewport.hy - stable_viewport.ly).max(1);
            let pad_x = (vp_w as f32 * 0.80) as i32;
            let pad_y = (vp_h as f32 * 0.80) as i32;
            let envelope = if using_overview_tiles || is_zoomed_out || covers_majority {
                world
            } else {
                Rect32 {
                    lx: (stable_viewport.lx - pad_x).max(world.lx),
                    ly: (stable_viewport.ly - pad_y).max(world.ly),
                    hx: (stable_viewport.hx + pad_x).min(world.hx),
                    hy: (stable_viewport.hy + pad_y).min(world.hy),
                }
            };

            let new_instances = std::sync::Arc::new(self.build_3d_instances(
                world,
                envelope,
                &query_layer_ids,
                using_overview_tiles,
            ));
            self.gpu_3d_instances_cache = Some((base_key, envelope, new_instances.clone()));
            new_instances
        };
        let drawn = instances.len();

        // Moving vs settled state tracking
        let is_camera_moving = animating_3d
            || self.pan_drag.mode().is_some()
            || self.perf_3d.last_camera.is_some_and(|last| {
                (last.yaw - current_camera.yaw).abs() > 1e-4
                    || (last.pitch - current_camera.pitch).abs() > 1e-4
                    || (last.distance - current_camera.distance).abs() > 1e-2
                    || (last.target.x - current_camera.target.x).abs() > 1e-2
                    || (last.target.y - current_camera.target.y).abs() > 1e-2
            });
        self.perf_3d.last_camera = Some(current_camera);

        if is_camera_moving {
            ui.ctx().request_repaint();
        }

        if !self.is_gpu_active() {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "3D view requires hardware acceleration or GPU canvas (running in CPU fallback mode)",
                egui::FontId::proportional(14.0),
                ecos_text_secondary(),
            );
        } else {
            let target_w = ((canvas.width() * pixels_per_point).round() as u32).max(1);
            let target_h = ((canvas.height() * pixels_per_point).round() as u32).max(1);
            let bg = self.color_theme.background_rgba();
            let z_cut_dbu = if self.z_cut_ratio_3d > 0.001 {
                (self.layer_stack.height() * (1.0 - self.z_cut_ratio_3d)).max(1.0)
            } else {
                1.0e9
            };
            let elapsed_time = self.start_time.elapsed().as_secs_f32();
            if is_camera_moving {
                ui.ctx().request_repaint();
            }
            let instances_key = {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                base_key.hash(&mut hasher);
                (instances.as_ptr() as usize).hash(&mut hasher);
                instances.len().hash(&mut hasher);
                hasher.finish()
            };
            let target_format = self
                .gpu_canvas
                .as_ref()
                .map(|g| g.target_format)
                .unwrap_or(wgpu::TextureFormat::Bgra8UnormSrgb);
            let callback = crate::canvas_gpu3d::CanvasGpu3dCallback::<false> {
                uniform: crate::canvas_gpu3d::CanvasUniform3d::from_camera(
                    current_camera,
                    aspect,
                    bg,
                    self.show_3d_grid,
                    true,
                    z_cut_dbu,
                    self.shading_style_3d,
                    self.lighting_preset_3d,
                    elapsed_time,
                ),
                instances,
                instances_key,
                target_pixels: [target_w, target_h],
                target_format,
            };
            ui.painter()
                .add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
        }

        self.status_line_buffer.clear();
        use std::fmt::Write as _;
        let _ = write!(
            self.status_line_buffer,
            "3D  {}/{} {}  yaw {:.0}°  pitch {:.0}°  z×{:.1}",
            drawn,
            crate::canvas_gpu3d::MAX_3D_INSTANCES,
            if using_overview_tiles {
                "tiles"
            } else {
                "shapes"
            },
            current_camera.yaw.to_degrees(),
            current_camera.pitch.to_degrees(),
            current_camera.z_scale
        );
        painter.text(
            canvas.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            self.status_line_buffer.as_str(),
            egui::FontId::proportional(13.0),
            ecos_text_secondary(),
        );
        self.paint_reload_indicator(ui, painter, canvas);

        if let Some(pos) = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .filter(|_| pointer_over_layout)
        {
            if let Some(point) = self.hover_world_point_3d(pos, canvas) {
                self.status_line_buffer.clear();
                hover_status_line_into(
                    &mut self.status_line_buffer,
                    point,
                    self.coordinate_unit,
                    self.db.snapshot().manifest().dbu_per_micron,
                    None,
                );
                painter.text(
                    canvas.left_top() + egui::vec2(10.0, 28.0),
                    egui::Align2::LEFT_TOP,
                    self.status_line_buffer.as_str(),
                    egui::FontId::monospace(12.0),
                    ecos_text_secondary(),
                );
            }
        }

        if let Some(start) = self.loading_3d_start {
            let elapsed = start.elapsed().as_secs_f32();
            const ANIM_DURATION: f32 = 0.70;
            if elapsed < ANIM_DURATION {
                ui.ctx().request_repaint();
                let alpha = if elapsed < 0.12 {
                    elapsed / 0.12
                } else if elapsed > 0.48 {
                    ((ANIM_DURATION - elapsed) / 0.22).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let pill_w = 236.0;
                let pill_h = 36.0;
                let center = egui::pos2(canvas.center().x, canvas.top() + 38.0);
                let pill_rect = egui::Rect::from_center_size(center, egui::vec2(pill_w, pill_h));

                let bg_color =
                    egui::Color32::from_rgba_unmultiplied(18, 22, 28, (235.0 * alpha) as u8);
                let stroke_color =
                    egui::Color32::from_rgba_unmultiplied(0, 180, 255, (220.0 * alpha) as u8);
                painter.rect_filled(pill_rect, 18.0_f32, bg_color);
                painter.rect_stroke(
                    pill_rect,
                    18.0_f32,
                    egui::Stroke::new(1.5_f32, stroke_color),
                    egui::StrokeKind::Inside,
                );

                let spinner_center = egui::pos2(pill_rect.left() + 22.0, pill_rect.center().y);
                let spin_angle = elapsed * 9.0;
                let radius = 7.5;
                let num_segments = 16;
                let points: Vec<egui::Pos2> = (0..=num_segments)
                    .map(|i| {
                        let a = spin_angle
                            + (i as f32 / num_segments as f32) * std::f32::consts::PI * 1.5;
                        egui::pos2(
                            spinner_center.x + radius * a.cos(),
                            spinner_center.y + radius * a.sin(),
                        )
                    })
                    .collect();
                painter.add(egui::Shape::line(
                    points,
                    egui::Stroke::new(
                        2.0_f32,
                        egui::Color32::from_rgba_unmultiplied(0, 220, 255, (255.0 * alpha) as u8),
                    ),
                ));

                let text_color =
                    egui::Color32::from_rgba_unmultiplied(240, 245, 255, (240.0 * alpha) as u8);
                painter.text(
                    egui::pos2(pill_rect.left() + 38.0, pill_rect.center().y),
                    egui::Align2::LEFT_CENTER,
                    "Pre-rendering Full 3D Stack...",
                    egui::FontId::proportional(13.0),
                    text_color,
                );
            } else {
                self.loading_3d_start = None;
            }
        }

        self.canvas_info_overlay(ui, canvas);
        self.drc_detail_overlay(ui, canvas);
        self.antenna_detail_overlay(ui, canvas);
        self.map_heatmap_overlay(ui, canvas);
        self.direction_cube_3d_overlay(ui, canvas, painter);
    }

    fn direction_cube_3d_overlay(
        &mut self,
        ui: &mut egui::Ui,
        canvas: egui::Rect,
        painter: &egui::Painter,
    ) {
        let center = egui::pos2(canvas.right() - 56.0, canvas.top() + 56.0);
        let radius = 22.0_f32;

        let yaw = self.camera_ctrl_3d.current.yaw;
        let pitch = self.camera_ctrl_3d.current.pitch;
        let cos_y = yaw.cos();
        let sin_y = yaw.sin();
        let cos_p = pitch.cos();
        let sin_p = pitch.sin();

        // Camera basis vectors
        let forward = [-cos_p * cos_y, -cos_p * sin_y, -sin_p];
        let right = [-sin_y, cos_y, 0.0];
        let up = [-sin_p * cos_y, -sin_p * sin_y, cos_p];

        let project = |v: [f32; 3]| -> (egui::Pos2, f32) {
            let dot_r = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
            let dot_u = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
            let dot_f = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2];
            (
                egui::pos2(center.x + radius * dot_r, center.y - radius * dot_u),
                -dot_f,
            )
        };

        // Draw backdrop circle
        painter.circle_filled(
            center,
            radius * 1.75,
            egui::Color32::from_rgba_unmultiplied(16, 20, 26, 180),
        );
        painter.circle_stroke(
            center,
            radius * 1.75,
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(60, 80, 110, 140)),
        );

        struct CubeFaceDef {
            normal: [f32; 3],
            label: &'static str,
            accent: egui::Color32,
            target_yaw: f32,
            target_pitch: f32,
            verts: [[f32; 3]; 4],
        }

        let faces = [
            CubeFaceDef {
                normal: [0.0, 0.0, 1.0],
                label: "TOP",
                accent: egui::Color32::from_rgb(0, 220, 255),
                target_yaw: -std::f32::consts::FRAC_PI_2,
                target_pitch: std::f32::consts::FRAC_PI_2 * 0.98,
                verts: [
                    [-1.0, -1.0, 1.0],
                    [1.0, -1.0, 1.0],
                    [1.0, 1.0, 1.0],
                    [-1.0, 1.0, 1.0],
                ],
            },
            CubeFaceDef {
                normal: [0.0, -1.0, 0.0],
                label: "FRONT",
                accent: egui::Color32::from_rgb(80, 220, 140),
                target_yaw: -std::f32::consts::FRAC_PI_2,
                target_pitch: 0.08,
                verts: [
                    [-1.0, -1.0, -1.0],
                    [1.0, -1.0, -1.0],
                    [1.0, -1.0, 1.0],
                    [-1.0, -1.0, 1.0],
                ],
            },
            CubeFaceDef {
                normal: [1.0, 0.0, 0.0],
                label: "RIGHT",
                accent: egui::Color32::from_rgb(255, 180, 60),
                target_yaw: std::f32::consts::PI,
                target_pitch: 0.08,
                verts: [
                    [1.0, -1.0, -1.0],
                    [1.0, 1.0, -1.0],
                    [1.0, 1.0, 1.0],
                    [1.0, -1.0, 1.0],
                ],
            },
            CubeFaceDef {
                normal: [0.0, 1.0, 0.0],
                label: "BACK",
                accent: egui::Color32::from_rgb(170, 130, 240),
                target_yaw: std::f32::consts::FRAC_PI_2,
                target_pitch: 0.08,
                verts: [
                    [-1.0, 1.0, -1.0],
                    [-1.0, 1.0, 1.0],
                    [1.0, 1.0, 1.0],
                    [1.0, 1.0, -1.0],
                ],
            },
            CubeFaceDef {
                normal: [-1.0, 0.0, 0.0],
                label: "LEFT",
                accent: egui::Color32::from_rgb(255, 100, 140),
                target_yaw: 0.0,
                target_pitch: 0.08,
                verts: [
                    [-1.0, -1.0, -1.0],
                    [-1.0, -1.0, 1.0],
                    [-1.0, 1.0, 1.0],
                    [-1.0, 1.0, -1.0],
                ],
            },
            CubeFaceDef {
                normal: [0.0, 0.0, -1.0],
                label: "BOT",
                accent: egui::Color32::from_rgb(120, 140, 160),
                target_yaw: -std::f32::consts::FRAC_PI_2,
                target_pitch: 0.08,
                verts: [
                    [-1.0, -1.0, -1.0],
                    [-1.0, 1.0, -1.0],
                    [1.0, 1.0, -1.0],
                    [1.0, -1.0, -1.0],
                ],
            },
        ];

        let pointer_pos = ui.ctx().input(|input| input.pointer.hover_pos());
        let pointer_clicked = ui.ctx().input(|input| input.pointer.primary_clicked());

        let point_in_quad = |p: egui::Pos2, quad: &[egui::Pos2; 4]| -> bool {
            let mut signs = [false, false];
            for i in 0..4 {
                let p1 = quad[i];
                let p2 = quad[(i + 1) % 4];
                let cross = (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
                if cross.abs() > 1e-4 {
                    if cross > 0.0 {
                        signs[0] = true;
                    } else {
                        signs[1] = true;
                    }
                }
            }
            !(signs[0] && signs[1])
        };

        // Gather and sort visible faces
        let mut visible_faces = Vec::new();
        for face in &faces {
            let n_dot_v = -(face.normal[0] * forward[0]
                + face.normal[1] * forward[1]
                + face.normal[2] * forward[2]);
            if n_dot_v > 0.01 {
                let pts: [egui::Pos2; 4] = [
                    project(face.verts[0]).0,
                    project(face.verts[1]).0,
                    project(face.verts[2]).0,
                    project(face.verts[3]).0,
                ];
                let depths = [
                    project(face.verts[0]).1,
                    project(face.verts[1]).1,
                    project(face.verts[2]).1,
                    project(face.verts[3]).1,
                ];
                let avg_depth = (depths[0] + depths[1] + depths[2] + depths[3]) * 0.25;
                visible_faces.push((avg_depth, face, pts));
            }
        }
        visible_faces.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        let mut face_action_taken = false;
        // Check hover / click on the closest front-most faces first
        for (_, face, pts) in visible_faces.iter().rev() {
            if !face_action_taken && pointer_pos.is_some_and(|pos| point_in_quad(pos, pts)) {
                if pointer_clicked {
                    self.camera_ctrl_3d.target.yaw = face.target_yaw;
                    self.camera_ctrl_3d.target.pitch = face.target_pitch;
                    self.camera_ctrl_3d.cancel_inertia();
                    face_action_taken = true;
                }
            }
        }

        // Draw visible faces back to front
        for (_, face, pts) in &visible_faces {
            let is_hovered = pointer_pos.is_some_and(|pos| point_in_quad(pos, pts));
            let fill_color = if is_hovered {
                egui::Color32::from_rgba_unmultiplied(35, 65, 95, 245)
            } else {
                egui::Color32::from_rgba_unmultiplied(22, 28, 38, 230)
            };
            let stroke_color = if is_hovered {
                face.accent
            } else {
                egui::Color32::from_rgba_unmultiplied(85, 115, 150, 200)
            };
            painter.add(egui::Shape::convex_polygon(
                pts.to_vec(),
                fill_color,
                egui::Stroke::new(if is_hovered { 1.6 } else { 1.1 }, stroke_color),
            ));

            let face_center = egui::pos2(
                (pts[0].x + pts[1].x + pts[2].x + pts[3].x) * 0.25,
                (pts[0].y + pts[1].y + pts[2].y + pts[3].y) * 0.25,
            );
            painter.text(
                face_center,
                egui::Align2::CENTER_CENTER,
                face.label,
                egui::FontId::proportional(9.0),
                if is_hovered {
                    egui::Color32::WHITE
                } else {
                    egui::Color32::from_rgb(210, 225, 245)
                },
            );
        }

        // Draw XYZ coordinate axis indicators
        let axis_len = 1.45_f32;
        let axes = [
            (
                [axis_len, 0.0, 0.0],
                "X",
                egui::Color32::from_rgb(255, 80, 80),
            ),
            (
                [0.0, axis_len, 0.0],
                "Y",
                egui::Color32::from_rgb(80, 230, 110),
            ),
            (
                [0.0, 0.0, axis_len],
                "Z",
                egui::Color32::from_rgb(0, 210, 255),
            ),
        ];
        for (axis_pos, label, color) in axes {
            let (screen_pos, depth) = project(axis_pos);
            if depth > -0.2 {
                painter.line_segment(
                    [center, screen_pos],
                    egui::Stroke::new(1.3, color.gamma_multiply(0.85)),
                );
                painter.circle_filled(screen_pos, 4.5, color);
                painter.text(
                    screen_pos,
                    egui::Align2::CENTER_CENTER,
                    label,
                    egui::FontId::proportional(7.5),
                    egui::Color32::BLACK,
                );
            }
        }
    }

    fn handle_macro_placement_keyboard_shortcuts(&mut self, ui: &egui::Ui) {
        let Some(staging) = self.macro_staging.as_ref() else {
            return;
        };
        if staging.queue.is_busy() || staging.selection.is_empty() {
            return;
        }
        let multiple = staging.selected_placed_count() >= 2;
        let dbu_per_micron = self
            .db
            .snapshot()
            .manifest()
            .dbu_per_micron
            .unwrap_or(1000)
            .max(1);
        let preferences = self.macro_toolbox_preferences.clone();
        let shift_held = ui.input(|input| input.modifiers.shift);
        let command = egui::Modifiers::COMMAND;
        let command_shift = command | egui::Modifiers::SHIFT;

        // Check the more specific Cmd/Ctrl+Shift shortcuts before plain
        // Cmd/Ctrl+Arrow, because egui matches shortcuts logically and would
        // otherwise let the nudge mapping consume the alignment chord.
        if shift_held && multiple {
            for (key, axis, edge) in [
                (egui::Key::ArrowLeft, AlignAxis::X, AlignEdge::Min),
                (egui::Key::ArrowRight, AlignAxis::X, AlignEdge::Max),
                (egui::Key::ArrowUp, AlignAxis::Y, AlignEdge::Max),
                (egui::Key::ArrowDown, AlignAxis::Y, AlignEdge::Min),
            ] {
                if ui.input_mut(|input| input.consume_key(command_shift, key)) {
                    self.run_macro_op(&MacroOp::Align {
                        axis,
                        edge,
                        reference: preferences.align_reference,
                    });
                }
            }
            if ui.input_mut(|input| input.consume_key(command_shift, egui::Key::C)) {
                self.run_macro_op(&MacroOp::Align {
                    axis: AlignAxis::X,
                    edge: AlignEdge::Center,
                    reference: preferences.align_reference,
                });
            }
            if ui.input_mut(|input| input.consume_key(command_shift, egui::Key::M)) {
                self.run_macro_op(&MacroOp::Align {
                    axis: AlignAxis::Y,
                    edge: AlignEdge::Center,
                    reference: preferences.align_reference,
                });
            }
        }

        if shift_held {
            return;
        }

        let distance = crate::macro_toolbar::microns_to_dbu(preferences.shift_um, dbu_per_micron);
        for (key, direction) in [
            (egui::Key::ArrowLeft, ShiftDirection::Left),
            (egui::Key::ArrowRight, ShiftDirection::Right),
            (egui::Key::ArrowUp, ShiftDirection::Up),
            (egui::Key::ArrowDown, ShiftDirection::Down),
        ] {
            if ui.input_mut(|input| input.consume_key(command, key)) {
                self.run_macro_op(&MacroOp::Shift {
                    direction,
                    distance_dbu: distance,
                    per_item: preferences.one_by_one,
                });
            }
        }
        if ui.input_mut(|input| input.consume_key(command, egui::Key::OpenBracket)) {
            self.run_macro_op(&MacroOp::Transform {
                transform: MacroTransform::RotateCounterClockwise,
                keep_relative: preferences.keep_relative,
            });
        }
        if ui.input_mut(|input| input.consume_key(command, egui::Key::CloseBracket)) {
            self.run_macro_op(&MacroOp::Transform {
                transform: MacroTransform::RotateClockwise,
                keep_relative: preferences.keep_relative,
            });
        }
    }

    fn handle_canvas_keyboard_shortcuts(
        &mut self,
        ui: &mut egui::Ui,
        world: Rect32,
        canvas: egui::Rect,
    ) {
        if !ui.ctx().wants_keyboard_input() {
            self.handle_macro_placement_keyboard_shortcuts(ui);
            if ui.input(|input| input.key_pressed(egui::Key::Escape)) {
                if self.shortcuts_overlay_visible {
                    self.shortcuts_overlay_visible = false;
                } else if self.ruler_tool.enabled {
                    self.ruler_tool.clear();
                } else if self.selected.is_some()
                    || !self.highlighted.is_empty()
                    || self.search_worker.is_pending()
                    || self
                        .macro_staging
                        .as_ref()
                        .is_some_and(|staging| !staging.selection.is_empty())
                    || self.selected_drc.is_some()
                    || self.selected_antenna.is_some()
                    || self.selected_lvs_group.is_some()
                    || self.show_all_lvs
                    || self.selected_map_bbox.is_some()
                {
                    self.selected = None;
                    self.search_highlighted.clear();
                    self.search_worker.cancel();
                    self.search_truncated = false;
                    self.focus_search_results = false;
                    self.last_query_status = None;
                    self.highlighted.clear();
                    self.clock_tree_overlay.clear();
                    self.selected_drc = None;
                    self.selected_antenna = None;
                    self.selected_lvs_group = None;
                    self.show_all_lvs = false;
                    self.selected_map_bbox = None;
                    if let Some(staging) = self.macro_staging.as_mut() {
                        staging.selection.clear();
                    }
                }
                self.macro_interaction = None;
                self.pan_drag.reset();
            }
            if ui.input(|input| input.key_pressed(egui::Key::Q)) {
                if self.view_mode == ViewMode::TwoD {
                    self.switch_to_3d_mode();
                } else {
                    self.switch_to_2d_mode();
                }
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::F) || input.key_pressed(egui::Key::Home)
            }) {
                self.focus_animation = None;
                if self.view_mode == ViewMode::ThreeD {
                    let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
                    self.camera_ctrl_3d.fit_world_with_aspect(
                        crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
                        crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
                        self.layer_stack.height(),
                        aspect,
                    );
                    self.camera_ctrl_3d.snap_to_target();
                    self.view3d_fitted = true;
                } else {
                    self.zoom = 1.0;
                    self.pan = egui::Vec2::ZERO;
                }
                self.pan_drag.reset();
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Num1) || input.key_pressed(egui::Key::T)
            }) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.set_top();
                }
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Num2) || input.key_pressed(egui::Key::I)
            }) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.set_iso();
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::Num3)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.set_front();
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::G)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.show_3d_grid = !self.show_3d_grid;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::H)) {
                if self.active_heatmap.is_some() {
                    self.active_heatmap = None;
                    self.selected_map_bbox = None;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::N)) {
                let shift = ui.input(|input| input.modifiers.shift);
                if let Some(heatmap) = self.active_heatmap.as_ref() {
                    let clicked_cell = if shift {
                        let peaks = heatmap.data.top_peaks(heatmap.invert_threshold);
                        if !peaks.is_empty() {
                            let curr = heatmap.selected_cell.unwrap_or(peaks[0]);
                            if let Some(idx) = peaks.iter().position(|&p| p == curr) {
                                let prev_idx = if idx == 0 { peaks.len() - 1 } else { idx - 1 };
                                Some(peaks[prev_idx])
                            } else {
                                Some(peaks[0])
                            }
                        } else {
                            None
                        }
                    } else {
                        heatmap
                            .data
                            .next_peak_cell(heatmap.selected_cell, heatmap.invert_threshold)
                    };
                    if let Some((row, column)) = clicked_cell {
                        let bbox = heatmap.data.bbox(row, column);
                        if let Some(heatmap) = self.active_heatmap.as_mut() {
                            heatmap.selected_cell = Some((row, column));
                        }
                        if let Some(bbox) = bbox {
                            let contextual = contextual_map_focus_bbox(bbox);
                            self.selected_map_bbox = Some(bbox);
                            if self.view_mode == ViewMode::ThreeD {
                                let span =
                                    ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                                self.camera_ctrl_3d.focus_xy(
                                    (bbox.lx + bbox.hx) as f32 * 0.5,
                                    (bbox.ly + bbox.hy) as f32 * 0.5,
                                    span,
                                    self.layer_stack.height(),
                                );
                            } else {
                                self.pending_focus = Some(PendingFocus {
                                    bbox: contextual,
                                    select_shape_id: None,
                                    transition: FocusTransition::Animated,
                                });
                            }
                        }
                    }
                }
            }
            let command_held = ui.input(|input| input.modifiers.command);
            if !command_held && ui.input(|input| input.key_pressed(egui::Key::OpenBracket)) {
                if let Some(heatmap) = self.active_heatmap.as_mut() {
                    heatmap.opacity = (heatmap.opacity - 0.05).max(0.05);
                }
            }
            if !command_held && ui.input(|input| input.key_pressed(egui::Key::CloseBracket)) {
                if let Some(heatmap) = self.active_heatmap.as_mut() {
                    heatmap.opacity = (heatmap.opacity + 0.05).min(1.0);
                }
            }
            if !command_held && ui.input(|input| input.key_pressed(egui::Key::ArrowLeft)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(-1.0, 0.0);
                } else {
                    self.pan.x += canvas.width() * 0.10;
                }
            }
            if !command_held && ui.input(|input| input.key_pressed(egui::Key::ArrowRight)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(1.0, 0.0);
                } else {
                    self.pan.x -= canvas.width() * 0.10;
                }
            }
            if !command_held && ui.input(|input| input.key_pressed(egui::Key::ArrowUp)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(0.0, 1.0);
                } else {
                    self.pan.y += canvas.height() * 0.10;
                }
            }
            if !command_held && ui.input(|input| input.key_pressed(egui::Key::ArrowDown)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(0.0, -1.0);
                } else {
                    self.pan.y -= canvas.height() * 0.10;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::Z)) {
                if let Some(shape_id) = self.selected {
                    if let Some(shape) = self.db.find_shape(shape_id) {
                        if self.view_mode == ViewMode::ThreeD {
                            let bbox = shape.bbox;
                            let span = ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                            self.camera_ctrl_3d.focus_xy(
                                (bbox.lx + bbox.hx) as f32 * 0.5,
                                (bbox.ly + bbox.hy) as f32 * 0.5,
                                span * 3.0,
                                self.layer_stack.height(),
                            );
                        } else {
                            self.pending_focus = Some(PendingFocus {
                                bbox: shape.bbox,
                                select_shape_id: Some(shape_id),
                                transition: FocusTransition::Animated,
                            });
                        }
                    }
                } else if let Some(bbox) = self.selected_map_bbox {
                    if self.view_mode == ViewMode::ThreeD {
                        let span = ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                        self.camera_ctrl_3d.focus_xy(
                            (bbox.lx + bbox.hx) as f32 * 0.5,
                            (bbox.ly + bbox.hy) as f32 * 0.5,
                            span * 2.0,
                            self.layer_stack.height(),
                        );
                    } else {
                        self.pending_focus = Some(PendingFocus {
                            bbox: contextual_map_focus_bbox(bbox),
                            select_shape_id: None,
                            transition: FocusTransition::Animated,
                        });
                    }
                } else if let Some(drc_id) = self.selected_drc {
                    if let Some(overlay) = &self.drc_overlay {
                        if let Some(v) = overlay.violations.iter().find(|v| v.id == drc_id) {
                            if self.view_mode == ViewMode::ThreeD {
                                let bbox = v.bbox;
                                let span =
                                    ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                                self.camera_ctrl_3d.focus_xy(
                                    (bbox.lx + bbox.hx) as f32 * 0.5,
                                    (bbox.ly + bbox.hy) as f32 * 0.5,
                                    span * 3.0,
                                    self.layer_stack.height(),
                                );
                            } else {
                                self.pending_focus = Some(PendingFocus {
                                    bbox: contextual_map_focus_bbox(v.bbox),
                                    select_shape_id: None,
                                    transition: FocusTransition::Animated,
                                });
                            }
                        }
                    }
                } else if !self.highlighted.is_empty() {
                    self.focus_highlighted_shapes();
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::K) || input.key_pressed(egui::Key::R))
            {
                self.ruler_tool.toggle();
                self.pan_drag.reset();
            }
            if ui.input(|input| input.key_pressed(egui::Key::Space)) {
                if self.analysis_tab == AnalysisTab::Map || self.active_heatmap.is_some() {
                    self.toggle_previous_map_item();
                }
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Questionmark) || input.key_pressed(egui::Key::F1)
            }) {
                self.shortcuts_overlay_visible = !self.shortcuts_overlay_visible;
            }
            if ui.input(|input| {
                (input.modifiers.command || input.modifiers.ctrl) && input.key_pressed(egui::Key::F)
            }) || ui.input(|input| input.key_pressed(egui::Key::Slash))
            {
                self.sidebar_info_panel = None;
                self.query_input_mode = QueryInputMode::Search;
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Plus) || input.key_pressed(egui::Key::Equals)
            }) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.dolly_steps(1.0, None, false);
                } else {
                    let center = canvas.center();
                    let (new_zoom, new_pan) =
                        zoom_at_screen_pos(world, canvas, self.zoom, self.pan, 1.25, center);
                    self.zoom = new_zoom;
                    self.pan = new_pan;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::Minus)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.dolly_steps(-1.0, None, false);
                } else {
                    let center = canvas.center();
                    let (new_zoom, new_pan) =
                        zoom_at_screen_pos(world, canvas, self.zoom, self.pan, 0.8, center);
                    self.zoom = new_zoom;
                    self.pan = new_pan;
                }
            }
        }
    }

    fn switch_to_3d_mode(&mut self) {
        if self.view_mode != ViewMode::ThreeD {
            self.view_mode = ViewMode::ThreeD;
            self.pan_drag.reset();
            self.focus_animation = None;
            self.view3d_fitted = false;
            self.object_visibility.set_all_visible(true);
            self.apply_object_visibility();
            set_layer_visibility(&mut self.layers, true);
            self.gpu_3d_instances_cache = None;
            self.loading_3d_start = Some(std::time::Instant::now());
        }
    }

    fn switch_to_2d_mode(&mut self) {
        if self.view_mode != ViewMode::TwoD {
            self.view_mode = ViewMode::TwoD;
            self.pan_drag.reset();
            self.focus_animation = None;
            self.loading_3d_start = None;
        }
    }

    fn ensure_3d_view(&mut self, world: Rect32, canvas: egui::Rect) {
        self.rebuild_layer_stack();
        if !self.view3d_bootstrapped {
            self.view3d_bootstrapped = true;
            if visible_layer_count(&self.layers) == 0 {
                set_layer_visibility(&mut self.layers, true);
            }
            self.object_visibility.set_all_visible(true);
            self.apply_object_visibility();
        }
        if !self.view3d_fitted {
            let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
            self.camera_ctrl_3d.fit_world_with_aspect(
                crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
                crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
                self.layer_stack.height(),
                aspect,
            );
            self.camera_ctrl_3d.snap_to_target();
            self.view3d_fitted = true;
        }
    }

    pub(super) fn rebuild_layer_stack(&mut self) {
        let mut entries: Vec<(LayerId, LayerRole, u32)> = self
            .layers
            .iter()
            .map(|layer| {
                (
                    layer.layer_id,
                    LayerRole::from_metadata(&layer.name, &layer.layer_type),
                    layer.order,
                )
            })
            .collect();
        if !entries
            .iter()
            .any(|(layer_id, _, _)| *layer_id == LAYOUT_GEOMETRY_LAYER)
        {
            entries.push((LAYOUT_GEOMETRY_LAYER, LayerRole::Overlap, 0));
        }
        self.layer_stack = chip_display::heuristic_layer_stack(entries);
    }

    pub(super) fn build_3d_instances(
        &self,
        world: Rect32,
        viewport: Rect32,
        query_layer_ids: &[LayerId],
        using_overview_tiles: bool,
    ) -> Vec<crate::canvas_gpu3d::GpuShapeInstance3d> {
        if using_overview_tiles && self.db.view_tile_count() > 0 {
            let overview = self.build_3d_overview_instances(world, viewport);
            if !overview.is_empty() {
                return overview;
            }
        }

        let visibility_hash = layers_visibility_hash(&self.layers);
        let layer_index = if self.visibility_rules_cache.epoch == self.geometry_epoch
            && self.visibility_rules_cache.layer_visibility_hash == visibility_hash
        {
            Some(&self.visibility_rules_cache.layer_index)
        } else {
            None
        };
        let fallback_index = layer_index
            .is_none()
            .then(|| LayerRenderIndex::new(&self.layers));
        let layer_index = layer_index.unwrap_or_else(|| fallback_index.as_ref().unwrap());
        let total_budget = crate::canvas_gpu3d::MAX_3D_INSTANCES.saturating_sub(100);
        let mut prepared = Vec::new();

        for shape_id in overlay_shape_ids(self.selected, &self.highlighted) {
            let Some(shape) = self.db.find_shape(shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) {
                continue;
            }
            let owner = self.db.owner_for_shape(shape);
            let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            if matches!(
                owner_type,
                Some(
                    OwnerType::TrackGrid
                        | OwnerType::GCellGrid
                        | OwnerType::Die
                        | OwnerType::Core
                        | OwnerType::Row
                        | OwnerType::InstanceHalo
                        | OwnerType::Region
                        | OwnerType::Slot
                )
            ) {
                continue;
            }
            let owner_category =
                owner.and_then(|owner| drawing_category_for_owner(&self.db, owner));
            if !shape_is_visible_fast(
                shape,
                owner_type,
                owner_category,
                layer_index,
                &self.object_visibility,
            ) {
                continue;
            }
            let Some(mut style) =
                visible_style_for_shape_fast(shape, owner, owner_type, layer_index)
            else {
                continue;
            };
            let mut extra_flags = 0u32;
            if self.selected == Some(shape_id) {
                style.rgba = [76, 196, 255, 230];
                style.fill_alpha = 230;
                extra_flags |= crate::canvas_gpu3d::FLAG_SELECTED;
            } else if let Some(role) = self
                .clock_tree_overlay
                .highlight()
                .and_then(|highlight| highlight.role_for(shape_id))
            {
                style.rgba = match role {
                    clock_tree::ClockTreeHighlightRole::Parent => [74, 222, 128, 220],
                    clock_tree::ClockTreeHighlightRole::Child => [255, 166, 64, 220],
                };
                style.fill_alpha = 220;
                extra_flags |= match role {
                    clock_tree::ClockTreeHighlightRole::Parent => {
                        crate::canvas_gpu3d::FLAG_CLOCK_TREE_PARENT
                    }
                    clock_tree::ClockTreeHighlightRole::Child => {
                        crate::canvas_gpu3d::FLAG_CLOCK_TREE_CHILD
                    }
                };
            } else if self.highlighted.contains(&shape_id) {
                style.rgba = [255, 214, 90, 210];
                style.fill_alpha = 210;
                extra_flags |= crate::canvas_gpu3d::FLAG_HIGHLIGHTED;
            }
            let band =
                self.layer_stack
                    .band(shape.layer_id)
                    .unwrap_or(chip_display::LayerStackBand {
                        layer_id: shape.layer_id,
                        z0: 0.0,
                        z1: 400.0,
                    });
            let layer_info = self.layers.iter().find(|l| l.layer_id == shape.layer_id);
            let role = layer_info
                .map(|l| chip_display::LayerRole::from_metadata(&l.name, &l.layer_type))
                .unwrap_or(chip_display::LayerRole::Metal { level: 1 });
            let material = chip_display::MaterialKind::from_role(role);
            prepared.push((
                self.db.shape_geometry(shape),
                style,
                role,
                material,
                band.z0,
                band.z1,
                extra_flags,
            ));
        }

        let mut layers_with_bands: Vec<(LayerId, f32, f32)> = query_layer_ids
            .iter()
            .copied()
            .map(|layer_id| {
                let band =
                    self.layer_stack
                        .band(layer_id)
                        .unwrap_or(chip_display::LayerStackBand {
                            layer_id,
                            z0: 0.0,
                            z1: 400.0,
                        });
                (layer_id, band.z0, band.z1)
            })
            .collect();
        layers_with_bands.sort_by(|a, b| a.1.total_cmp(&b.1));

        let mut layer_queries: Vec<(LayerId, f32, f32, Vec<ShapeId>)> =
            Vec::with_capacity(layers_with_bands.len());
        let mut total_query_shapes = 0usize;
        for &(layer_id, z0, z1) in &layers_with_bands {
            let shape_ids = self.db.query_layer_intersect(layer_id, viewport);
            total_query_shapes += shape_ids.len();
            layer_queries.push((layer_id, z0, z1, shape_ids));
        }

        let remaining_budget = total_budget.saturating_sub(prepared.len());
        let global_stride_needed = total_query_shapes > remaining_budget;

        for (layer_id, z0, z1, shape_ids) in layer_queries {
            if prepared.len() >= total_budget || shape_ids.is_empty() {
                continue;
            }

            let stride = if global_stride_needed {
                ((total_query_shapes + remaining_budget - 1) / remaining_budget).max(1)
            } else {
                1
            };

            let layer_info = self.layers.iter().find(|l| l.layer_id == layer_id);
            let role = layer_info
                .map(|l| chip_display::LayerRole::from_metadata(&l.name, &l.layer_type))
                .unwrap_or(chip_display::LayerRole::Metal { level: 1 });
            let material = chip_display::MaterialKind::from_role(role);

            for &shape_id in shape_ids.iter().step_by(stride) {
                if prepared.len() >= total_budget {
                    break;
                }
                let Some(shape) = self.db.find_shape(shape_id) else {
                    continue;
                };
                if !is_renderable_shape(shape) {
                    continue;
                }
                let owner = self.db.owner_for_shape(shape);
                let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
                if matches!(
                    owner_type,
                    Some(
                        OwnerType::TrackGrid
                            | OwnerType::GCellGrid
                            | OwnerType::Die
                            | OwnerType::Core
                            | OwnerType::Row
                            | OwnerType::InstanceHalo
                            | OwnerType::Region
                            | OwnerType::Slot
                    )
                ) {
                    continue;
                }
                let owner_category =
                    owner.and_then(|owner| drawing_category_for_owner(&self.db, owner));
                if !shape_is_visible_fast(
                    shape,
                    owner_type,
                    owner_category,
                    layer_index,
                    &self.object_visibility,
                ) {
                    continue;
                }
                let Some(style) =
                    visible_style_for_shape_fast(shape, owner, owner_type, layer_index)
                else {
                    continue;
                };

                prepared.push((
                    self.db.shape_geometry(shape),
                    style,
                    role,
                    material,
                    z0,
                    z1,
                    0,
                ));
            }
        }

        let mut instances =
            crate::canvas_gpu3d::build_gpu_instances_3d_with_flags(prepared.into_iter());
        instances.push(crate::canvas_gpu3d::ground_grid_instance(world));
        instances
    }

    fn build_3d_overview_instances(
        &self,
        world: Rect32,
        viewport: Rect32,
    ) -> Vec<crate::canvas_gpu3d::GpuShapeInstance3d> {
        let mut layers: Vec<(&LayerUiState, chip_display::LayerStackBand)> = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .filter_map(|layer| {
                self.layer_stack
                    .band(layer.layer_id)
                    .map(|band| (layer, band))
            })
            .collect();
        layers.sort_by(|lhs, rhs| lhs.1.z0.total_cmp(&rhs.1.z0));
        let layer_ids: Vec<LayerId> = layers.iter().map(|(layer, _)| layer.layer_id).collect();
        let preferred_lod = select_overview_lod(&self.db, &layer_ids, viewport, world)
            .unwrap_or_else(|| {
                crate::canvas_gpu3d::overview_lod_level(self.camera_ctrl_3d.current, world)
            });

        let mut instances = Vec::new();
        instances.push(crate::canvas_gpu3d::ground_grid_instance(world));
        for layer in layers {
            let role = chip_display::LayerRole::from_metadata(&layer.0.name, &layer.0.layer_type);
            for tile in
                overview_tiles_for_layer(&self.db, preferred_lod, layer.0.layer_id, viewport, world)
            {
                crate::canvas_gpu3d::push_overview_tile_instance(
                    &mut instances,
                    tile.bbox,
                    tile.shape_count,
                    layer.1.z0,
                    layer.1.z1,
                    &layer.0.style,
                    role,
                );
                if instances.len() >= crate::canvas_gpu3d::MAX_3D_INSTANCES {
                    return instances;
                }
            }
        }
        instances
    }

    fn hover_world_point_3d(&self, pos: egui::Pos2, canvas: egui::Rect) -> Option<Point32> {
        let ray = self.camera_ctrl_3d.current.ray_from_screen(
            [pos.x, pos.y],
            [canvas.left(), canvas.top()],
            [canvas.width(), canvas.height()],
        )?;
        let hit = ray.intersect_z_plane(0.0)?;
        Some(Point32 {
            x: hit.x.round() as i32,
            y: hit.y.round() as i32,
        })
    }

    fn pick_shape_at_3d(
        &self,
        pos: egui::Pos2,
        canvas: egui::Rect,
        world: Rect32,
        query_layer_ids: &[LayerId],
    ) -> Option<ShapeId> {
        let ray = self.camera_ctrl_3d.current.ray_from_screen(
            [pos.x, pos.y],
            [canvas.left(), canvas.top()],
            [canvas.width(), canvas.height()],
        )?;
        let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
        let viewport =
            crate::canvas_gpu3d::query_rect_for_camera(self.camera_ctrl_3d.current, world, aspect);
        let mut best: Option<(f32, ShapeId)> = None;
        for shape_id in self.db.query_layers_intersect(query_layer_ids, viewport) {
            let Some(shape) = self.db.find_shape(shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) || !self.shape_is_visible(shape) {
                continue;
            }
            let Some(rect) = shape_xy_rect(self.db.shape_geometry(shape)) else {
                continue;
            };
            let band =
                self.layer_stack
                    .band(shape.layer_id)
                    .unwrap_or(chip_display::LayerStackBand {
                        layer_id: shape.layer_id,
                        z0: 0.0,
                        z1: 400.0,
                    });
            let min = crate::camera3d::Vec3::new(
                rect.lx as f32,
                rect.ly as f32,
                band.z0 * self.camera_ctrl_3d.current.z_scale,
            );
            let max = crate::camera3d::Vec3::new(
                rect.hx as f32,
                rect.hy as f32,
                band.z1 * self.camera_ctrl_3d.current.z_scale,
            );
            if let Some(t) = ray.intersect_aabb(min, max) {
                if best.is_none_or(|(best_t, _)| t < best_t) {
                    best = Some((t, shape_id));
                }
            }
        }
        best.map(|(_, shape_id)| shape_id)
    }

    fn should_use_view_tiles(
        &mut self,
        viewport: Rect32,
        world: Rect32,
        canvas: egui::Rect,
        pixels_per_point: f32,
        camera_activity: gpu_overview::CameraActivity,
    ) -> bool {
        if !self.object_visibility.is_all_visible() {
            self.view_tiles_latch.reset();
            return false;
        }
        self.view_tiles_latch.update(
            self.db.view_tile_count(),
            self.draft.is_some(),
            self.edit_enabled,
            self.zoom,
            self.stats.shape_count,
            viewport,
            world,
            canvas,
            pixels_per_point,
            camera_activity,
        )
    }

    fn view_lod_level(&self, world: Rect32, canvas: egui::Rect, pixels_per_point: f32) -> u8 {
        gpu_overview::pixel_overview_lod(self.zoom, world, canvas, pixels_per_point)
    }

    fn focus_pending_shape(&mut self, ctx: &egui::Context, world: Rect32, canvas: egui::Rect) {
        let now = ctx.input(|input| input.time);
        if let Some(focus) = self.pending_focus.take() {
            let (zoom, pan) = focus_view_on_bbox(world, focus.bbox, canvas);
            self.pan_drag.reset();
            self.selected = focus.select_shape_id;

            if focus.transition == FocusTransition::Animated && focus_animation_enabled(ctx) {
                self.focus_animation =
                    Some(FocusAnimation::new(now, self.zoom, self.pan, zoom, pan));
            } else {
                self.focus_animation = None;
                self.zoom = zoom;
                self.pan = pan;
            }
        }

        let Some(animation) = self.focus_animation else {
            return;
        };
        let frame = animation.sample(now);
        self.zoom = frame.zoom;
        self.pan = frame.pan;
        if frame.complete {
            self.focus_animation = None;
        } else {
            ctx.request_repaint();
        }
    }

    fn begin_edit_drag(&mut self, pos: egui::Pos2, world: Rect32, canvas: egui::Rect) -> bool {
        if !can_start_edit_command(
            self.draft.is_some(),
            self.pending_edit.is_some(),
            self.pending_session_action.is_some(),
        ) || self.macro_queue_busy()
        {
            self.last_edit_result = Some("wait for the current edit to finish".to_string());
            return false;
        }
        let Some(shape_id) = self.selected else {
            return false;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            return false;
        };
        if shape.state != ShapeState::Alive as u8
            || shape.kind != ShapeKind::Rect as u8
            || !self.shape_is_visible(shape)
        {
            return false;
        }
        let Some(owner) = self.db.owner_for_shape(shape) else {
            return false;
        };
        if !instance_move_is_allowed(owner.owner_type) {
            self.last_edit_result = Some(format!(
                "instance move is not supported for {}",
                ChipViewDb::owner_type_label(owner.owner_type)
            ));
            return false;
        }
        let screen = world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
        if !screen.contains(pos) {
            return false;
        }

        let expected_version = shape.version;
        let original_bbox = shape.bbox;
        let instance_name = matches!(
            OwnerType::from_raw(owner.owner_type),
            Some(OwnerType::InstanceBBox)
        )
        .then(|| self.db.owner_name(owner).map(str::to_owned))
        .flatten();
        // Macro placements always carry an explicit orientation and fixed
        // status so that already-fixed macros stay editable.
        let (orient, placement_status) = instance_name
            .as_deref()
            .filter(|name| {
                self.macro_staging
                    .as_ref()
                    .is_some_and(|staging| staging.is_macro_instance(&self.db, name))
            })
            .map(|name| {
                let staging = self.macro_staging.as_ref().unwrap();
                (
                    Some(staging.orient_of(name)),
                    Some(staging.status_of(name).as_str().to_string()),
                )
            })
            .unwrap_or((None, None));
        self.draft = Some(EditDraft {
            command_id: self.allocate_command_id(),
            shape_id,
            expected_version,
            instance_name,
            original_bbox,
            requested_bbox: original_bbox,
            orient,
            placement_status,
        });
        true
    }

    fn begin_edit_drag_at_pointer(
        &mut self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
    ) -> bool {
        let point = screen_to_world_point(pos, world, canvas, self.zoom, self.pan);
        let tolerance = edit_pick_tolerance_dbu(world, canvas, self.zoom);
        if let Some(draft) = self.begin_macro_staged_drag(point, tolerance) {
            self.draft = Some(draft);
            return true;
        }
        if let Some(shape_id) = self.pick_editable_instance_bbox_at(point, tolerance) {
            self.selected = Some(shape_id);
        }
        self.begin_edit_drag(pos, world, canvas)
    }

    fn update_edit_drag(&mut self, screen_delta: egui::Vec2, world: Rect32, canvas: egui::Rect) {
        let snap = self.macro_grid_snap();
        let core = self
            .macro_staging
            .as_ref()
            .and_then(|staging| staging.core_rect);
        let Some(draft) = self.draft.as_mut() else {
            return;
        };
        let (dx, dy) = screen_to_world_delta(screen_delta, world, canvas, self.zoom);
        let mut requested = translate_rect(draft.original_bbox, dx, dy);
        if draft.instance_name.is_some() {
            if let Some(snap) = snap {
                requested = snap.snap_rect(requested);
            }
        }
        // Macro placements are confined to the core area once the draft
        // enters it; the staging row itself stays unconstrained.
        if let Some(core) = core {
            if requested.intersects(core) {
                requested = clamp_rect_into(requested, core);
            }
        }
        draft.requested_bbox = requested;
    }

    fn commit_draft(&mut self) {
        let Some(draft) = self.draft.take() else {
            return;
        };
        let Some(command_dir) = self.edit_command_dir.clone() else {
            self.last_edit_result = Some("edit command directory is missing".to_string());
            return;
        };
        let Some(result_dir) = self.edit_result_dir.clone() else {
            self.last_edit_result = Some("edit result directory is missing".to_string());
            return;
        };

        if !self.validate_macro_draft(&draft) {
            return;
        }

        let command = GeometryEditCommand {
            command_id: draft.command_id,
            shape_id: draft.shape_id,
            expected_version: draft.expected_version,
            op: GeometryEditOp::MoveShape,
            requested_bbox: draft.requested_bbox,
        };
        let command_path = command_dir.join(format!("command-{}.json", command.command_id));
        let result_path = result_dir.join(format!("result-{}.json", command.command_id));

        match write_edit_command(
            &command_path,
            &command,
            draft.instance_name.as_deref(),
            draft.orient.map(|orient| orient.as_str()),
            draft.placement_status.as_deref(),
        ) {
            Ok(()) => {
                let staged_macro = if draft.shape_id == 0 {
                    draft
                        .instance_name
                        .clone()
                        .zip(draft.orient)
                        .map(|(name, orient)| StagedMacroCommit {
                            name,
                            orient,
                            placement_status: draft.placement_status.clone(),
                        })
                } else {
                    None
                };
                self.pending_edit = Some(PendingEdit {
                    result_path,
                    staged_macro,
                });
                self.last_edit_result = Some(format!("command {} pending", command.command_id));
            }
            Err(err) => {
                self.last_edit_result = Some(format!("failed to write edit command: {err}"));
            }
        }
    }

    fn macro_queue_busy(&self) -> bool {
        self.macro_staging
            .as_ref()
            .is_some_and(|staging| staging.queue.is_busy())
    }

    /// Starts dragging an unplaced macro from its staging slot. The draft
    /// uses `shape_id 0` because the instance has no snapshot shape until
    /// the placement command is accepted.
    fn begin_macro_staged_drag(&mut self, point: Point32, tolerance_dbu: i32) -> Option<EditDraft> {
        if !can_start_edit_command(
            self.draft.is_some(),
            self.pending_edit.is_some(),
            self.pending_session_action.is_some(),
        ) || self.macro_queue_busy()
        {
            self.last_edit_result = Some("wait for the current edit to finish".to_string());
            return None;
        }
        if !self.edit_enabled {
            return None;
        }
        let (name, rect, orient, placement_status) = {
            let staging = self.macro_staging.as_ref()?;
            let index = staging.staged_index_at(point, tolerance_dbu)?;
            let staged = &staging.staged[index];
            let status = staging.status_of(&staged.name);
            (
                staged.name.clone(),
                staged.rect,
                staged.orient,
                if status == PlacementStatus::Unplaced {
                    PlacementStatus::Placed
                } else {
                    status
                },
            )
        };
        Some(EditDraft {
            command_id: self.allocate_command_id(),
            shape_id: 0,
            expected_version: 0,
            instance_name: Some(name),
            original_bbox: rect,
            requested_bbox: rect,
            orient: Some(orient),
            placement_status: Some(placement_status.as_str().to_string()),
        })
    }

    /// Enforces the macro placement constraints for a committed draft:
    /// releases inside the staging row cancel the move, and positions
    /// that overlap another placed instance are refused. Returns false when
    /// the draft must not become an edit command.
    fn validate_macro_draft(&mut self, draft: &EditDraft) -> bool {
        let Some(staging) = self.macro_staging.as_ref() else {
            return true;
        };
        let Some(name) = draft.instance_name.as_deref() else {
            return true;
        };
        if draft.shape_id != 0 && !staging.is_macro_instance(&self.db, name) {
            return true;
        }
        let Some(core) = staging.core_rect else {
            self.last_edit_result = Some("macro move rejected: core area is unknown".to_string());
            return false;
        };
        if !draft.requested_bbox.intersects(core) {
            self.last_edit_result =
                Some("macro move cancelled: released outside the core".to_string());
            return false;
        }
        let colliders = instance_names_intersecting(&self.db, draft.requested_bbox, name);
        if let Some(first) = colliders.first() {
            self.last_edit_result = Some(format!("macro move rejected: overlaps {first}"));
            return false;
        }
        true
    }

    /// First instance name overlapping the current macro draft, if any; used
    /// to paint the draft outline red while the move would be refused.
    fn macro_draft_collider(&self) -> Option<String> {
        let staging = self.macro_staging.as_ref()?;
        let draft = self.draft.as_ref()?;
        let name = draft.instance_name.as_deref()?;
        if draft.shape_id != 0 && !staging.is_macro_instance(&self.db, name) {
            return None;
        }
        let core = staging.core_rect?;
        if !draft.requested_bbox.intersects(core) {
            return None;
        }
        instance_names_intersecting(&self.db, draft.requested_bbox, name)
            .into_iter()
            .next()
    }

    fn placed_shape_is_macro(&self, shape_id: ShapeId) -> bool {
        let Some(staging) = self.macro_staging.as_ref() else {
            return false;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            return false;
        };
        let Some(name) = crate::macro_staging::shape_instance_name(&self.db, shape) else {
            return false;
        };
        staging.is_macro_instance(&self.db, name)
    }

    fn macro_hit_at(
        &self,
        point: Point32,
        tolerance_dbu: i32,
    ) -> Option<(MacroTarget, Option<ShapeId>)> {
        if let Some(target) = self
            .macro_staging
            .as_ref()
            .and_then(|staging| staging.staged_target_at(point, tolerance_dbu))
        {
            return Some((target, None));
        }
        let shape_id = self
            .pick_editable_instance_bbox_at(point, tolerance_dbu)
            .filter(|shape_id| self.placed_shape_is_macro(*shape_id))?;
        let shape = self.db.find_shape(shape_id)?;
        let name = crate::macro_staging::shape_instance_name(&self.db, shape)?;
        Some((MacroTarget::Placed(name.to_owned()), Some(shape_id)))
    }

    /// Handles a primary click in macro placement mode. A replace click on
    /// empty space clears the macro selection before ordinary shape picking
    /// continues.
    fn select_macro_at(&mut self, point: Point32, mode: SelectionMode, tolerance_dbu: i32) -> bool {
        let hit = self.macro_hit_at(point, tolerance_dbu);
        let target = hit.as_ref().map(|(target, _)| target.clone());
        let preferred_shape = hit.as_ref().and_then(|(_, shape_id)| *shape_id);
        let Some(staging) = self.macro_staging.as_mut() else {
            return false;
        };
        if let Some(target) = target.clone() {
            apply_selection(&mut staging.selection, [target], mode);
        } else if mode == SelectionMode::Replace {
            staging.selection.clear();
        }
        self.sync_primary_macro_selection(preferred_shape);
        target.is_some()
    }

    fn sync_primary_macro_selection(&mut self, preferred: Option<ShapeId>) {
        let Some(staging) = self.macro_staging.as_ref() else {
            return;
        };
        let preferred_is_selected = preferred.is_some_and(|shape_id| {
            self.db
                .find_shape(shape_id)
                .and_then(|shape| crate::macro_staging::shape_instance_name(&self.db, shape))
                .is_some_and(|name| {
                    staging
                        .selection
                        .contains(&MacroTarget::Placed(name.to_owned()))
                })
        });
        self.selected = if preferred_is_selected {
            preferred
        } else {
            staging.selection.iter().find_map(|target| match target {
                MacroTarget::Placed(name) => {
                    crate::macro_staging::instance_shape(&self.db, name).map(|shape| shape.id)
                }
                MacroTarget::Staged(_) => None,
            })
        };
    }

    fn begin_macro_canvas_interaction(
        &mut self,
        point: Point32,
        shift: bool,
        command_or_ctrl: bool,
        tolerance_dbu: i32,
    ) -> Option<CanvasDragMode> {
        self.macro_staging.as_ref()?;
        if let Some((target, preferred_shape)) = self.macro_hit_at(point, tolerance_dbu) {
            let already_selected = self
                .macro_staging
                .as_ref()
                .is_some_and(|staging| staging.selection.contains(&target));
            if !already_selected {
                let mode = SelectionMode::for_click(shift, command_or_ctrl);
                if let Some(staging) = self.macro_staging.as_mut() {
                    apply_selection(&mut staging.selection, [target], mode);
                }
            }
            self.sync_primary_macro_selection(preferred_shape);
            if !self.edit_enabled
                || !can_start_edit_command(
                    self.draft.is_some(),
                    self.pending_edit.is_some(),
                    self.pending_session_action.is_some(),
                )
                || self.macro_queue_busy()
            {
                self.last_edit_result = Some("wait for the current edit to finish".to_string());
                return Some(CanvasDragMode::Pan);
            }
            let views = self
                .macro_staging
                .as_ref()
                .map(|staging| staging.selected_placement_views(&self.db))
                .unwrap_or_default();
            if views.is_empty() {
                return Some(CanvasDragMode::Pan);
            }
            self.macro_interaction = Some(MacroCanvasInteraction::GroupDrag(MacroGroupDrag::new(
                views,
            )));
            return Some(CanvasDragMode::MacroMove);
        }

        let mode = SelectionMode::for_marquee(shift, command_or_ctrl);
        self.macro_interaction = Some(MacroCanvasInteraction::Marquee(MacroMarquee::new(
            point, mode,
        )));
        Some(CanvasDragMode::MacroMarquee)
    }

    fn update_macro_group_drag(&mut self, dx: i32, dy: i32) {
        let core = self
            .macro_staging
            .as_ref()
            .and_then(|staging| staging.core_rect);
        let snap = self.macro_grid_snap();
        if let Some(MacroCanvasInteraction::GroupDrag(drag)) = self.macro_interaction.as_mut() {
            drag.update_with_snap(dx, dy, core, snap);
        }
    }

    fn update_macro_marquee(&mut self, point: Point32) {
        if let Some(MacroCanvasInteraction::Marquee(marquee)) = self.macro_interaction.as_mut() {
            marquee.update(point);
        }
    }

    fn commit_macro_marquee(&mut self) {
        let Some(MacroCanvasInteraction::Marquee(marquee)) = self.macro_interaction.take() else {
            return;
        };
        let Some(staging) = self.macro_staging.as_mut() else {
            return;
        };
        let hits = staging.targets_intersecting(&self.db, marquee.rect());
        apply_selection(&mut staging.selection, hits, marquee.mode);
        self.sync_primary_macro_selection(None);
    }

    fn commit_macro_group_drag(&mut self) {
        let Some(MacroCanvasInteraction::GroupDrag(drag)) = self.macro_interaction.take() else {
            return;
        };
        if !drag.valid() {
            if let Some(staging) = self.macro_staging.as_mut() {
                staging.message = drag.error().map(str::to_owned);
            }
            return;
        }
        self.apply_macro_moves(drag.planned_moves(), None);
    }

    fn macro_grid_snap(&self) -> Option<GridSnap> {
        let preferences = &self.macro_toolbox_preferences;
        if !preferences.snap_enabled {
            return None;
        }
        let dbu_per_micron = self
            .db
            .snapshot()
            .manifest()
            .dbu_per_micron
            .unwrap_or(1)
            .max(1);
        let origin = self
            .macro_staging
            .as_ref()
            .and_then(|staging| staging.core_rect)
            .map_or((0, 0), |core| (core.lx, core.ly));
        Some(GridSnap {
            origin_x: origin.0,
            origin_y: origin.1,
            step_x: crate::macro_toolbar::microns_to_dbu(preferences.snap_x_um, dbu_per_micron),
            step_y: crate::macro_toolbar::microns_to_dbu(preferences.snap_y_um, dbu_per_micron),
        })
    }

    pub(super) fn macro_toolbar(&mut self, ui: &mut egui::Ui) {
        let Some(staging) = self.macro_staging.as_ref() else {
            return;
        };
        let views = staging.selected_placement_views(&self.db);
        let feedback = staging
            .message
            .clone()
            .or_else(|| self.last_edit_result.clone());
        let feedback_warning = feedback.as_deref().is_some_and(macro_feedback_is_warning)
            || staging.queue.failure.is_some();
        let state = crate::macro_toolbar::MacroToolbarState {
            unplaced_count: staging.unplaced_staged_count(),
            selected_count: views.len(),
            placed_selected_count: staging.selected_placed_count(),
            unplaced_stdcell_count: staging.stdcell_blob.as_ref().map_or(0, |blob| blob.count),
            first_selected_name: staging
                .selection
                .first()
                .map(|target| target.name().to_owned()),
            common_selected_status: staging.common_selected_status(),
            die_available: staging.die_rect.is_some(),
            die_target_available: staging.die_rect.is_some()
                && staging.die_rect == staging.core_rect,
            core_available: staging.core_rect.is_some(),
            dbu_per_micron: self
                .db
                .snapshot()
                .manifest()
                .dbu_per_micron
                .unwrap_or(1)
                .max(1),
            queue_busy: staging.queue.is_busy(),
            queue_status: staging.queue.status(),
            feedback,
            feedback_warning,
        };
        let mut requested: Vec<MacroOp> = Vec::new();
        let preferences_before = self.macro_toolbox_preferences.clone();
        crate::macro_toolbar::show_macro_toolbar(
            ui,
            &state,
            &mut self.macro_toolbox_preferences,
            |op| requested.push(op),
        );
        if self.macro_toolbox_preferences != preferences_before {
            if let Err(error) = self.macro_toolbox_preferences.persist() {
                self.last_edit_result = Some(error);
            }
        }
        for op in &requested {
            self.run_macro_op(op);
        }
    }

    fn run_macro_op(&mut self, op: &MacroOp) {
        let bounds = self
            .macro_staging
            .as_ref()
            .map(|staging| MacroOpBounds {
                core: staging.core_rect,
                die: staging.die_rect,
            })
            .unwrap_or_default();
        let snap = self.macro_grid_snap();
        let Some(staging) = self.macro_staging.as_mut() else {
            return;
        };
        if staging.queue.is_busy() {
            return;
        }
        let views = staging.selected_placement_views(&self.db);
        let plan = plan_macro_op_with_snap(op, &views, bounds, snap);
        let skipped_summary = plan
            .skipped
            .iter()
            .map(|(name, reason)| format!("{name}: {reason}"))
            .collect::<Vec<_>>()
            .join("; ");
        if plan.moves.is_empty() {
            staging.message = Some(if skipped_summary.is_empty() {
                format!("{} is unavailable for the current selection", op.label())
            } else {
                skipped_summary
            });
            return;
        }
        let message = if skipped_summary.is_empty() {
            Some(format!("queued {}", op.label()))
        } else {
            Some(format!("queued {}; {skipped_summary}", op.label()))
        };
        self.apply_macro_moves(plan.moves, message);
    }

    pub(super) fn apply_macro_moves(
        &mut self,
        moves: Vec<PlannedMacroMove>,
        message: Option<String>,
    ) {
        if let Some(reason) = self.macro_moves_validation_error(&moves) {
            if let Some(staging) = self.macro_staging.as_mut() {
                staging.message = Some(reason);
            }
            return;
        }
        let total = moves.len();
        let Some(staging) = self.macro_staging.as_mut() else {
            return;
        };
        staging.message = message;
        let committed = staging.apply_staged_moves(moves);
        if committed.is_empty() {
            staging.queue.record_completed(total);
            return;
        }
        staging.queue.enqueue(committed);
        self.pump_macro_queue();
    }

    fn macro_moves_validation_error(&self, moves: &[PlannedMacroMove]) -> Option<String> {
        if let Some((first, second)) = planned_move_overlap(moves) {
            return Some(format!(
                "operation rejected: {} overlaps {} at the final positions",
                first.name, second.name
            ));
        }
        let core = self
            .macro_staging
            .as_ref()
            .and_then(|staging| staging.core_rect);
        let moving_names = moves
            .iter()
            .map(|item| item.name.clone())
            .collect::<BTreeSet<_>>();
        for item in moves.iter().filter(|item| !item.staged) {
            // A status-only operation does not move the instance and must not
            // be rejected merely because a staged macro is still in its row.
            if item.placement_status.is_some() {
                continue;
            }
            let Some(core) = core else {
                return Some("operation rejected: core area is unknown".to_string());
            };
            if !rect_fits_inside(item.rect, core) {
                return Some(format!(
                    "operation rejected: {} would leave the core area",
                    item.name
                ));
            }
            if let Some(collider) =
                instance_names_intersecting_except(&self.db, item.rect, &moving_names).first()
            {
                return Some(format!(
                    "operation rejected: {} overlaps {collider}",
                    item.name
                ));
            }
            if let Some(collider) = self.macro_staging.as_ref().and_then(|staging| {
                staging
                    .staged_names_intersecting_except(item.rect, &moving_names)
                    .first()
                    .cloned()
            }) {
                return Some(format!(
                    "operation rejected: {} overlaps staged macro {collider}",
                    item.name
                ));
            }
        }
        None
    }

    /// Emits the next queued macro placement command when the edit bridge is
    /// idle. Versions are resolved fresh from the reloaded snapshot for
    /// every command.
    fn pump_macro_queue(&mut self) {
        if self.draft.is_some()
            || self.pending_edit.is_some()
            || self.pending_session_action.is_some()
            || self.edit_command_dir.is_none()
            || self.edit_result_dir.is_none()
        {
            return;
        }
        let (head, moving_names): (PlannedMacroMove, BTreeSet<String>) = {
            let Some(staging) = self.macro_staging.as_ref() else {
                return;
            };
            if staging.queue.active.is_some() {
                return;
            }
            match staging.queue.pending.front() {
                Some(head) => (head.clone(), staging.queue.moving_names.clone()),
                None => return,
            }
        };
        let (shape_id, expected_version) =
            match crate::macro_staging::instance_shape(&self.db, &head.name) {
                Some(shape) => (shape.id, shape.version),
                None => (0, 0),
            };
        let (current_status, inside_core) = self
            .macro_staging
            .as_ref()
            .map(|staging| {
                (
                    staging.status_of(&head.name),
                    staging
                        .core_rect
                        .is_some_and(|core| rect_fits_inside(head.rect, core)),
                )
            })
            .unwrap_or((PlacementStatus::Fixed, false));
        let placement_status = head.placement_status.unwrap_or_else(|| {
            if current_status == PlacementStatus::Unplaced && inside_core {
                PlacementStatus::Placed
            } else {
                current_status
            }
        });
        let staged_macro = (shape_id == 0).then(|| StagedMacroCommit {
            name: head.name.clone(),
            orient: head.orient,
            placement_status: Some(placement_status.as_str().to_string()),
        });
        let Some(staging) = self.macro_staging.as_mut() else {
            return;
        };
        let status_only = head.placement_status.is_some();
        if !status_only {
            if let Some(core) = staging.core_rect {
                if !rect_fits_inside(head.rect, core) {
                    let reason = format!("{} would leave the core area", head.name);
                    staging.queue.abort(reason.clone());
                    staging.message = Some(reason);
                    return;
                }
            }
            let colliders = instance_names_intersecting_except(&self.db, head.rect, &moving_names);
            if let Some(first) = colliders.first() {
                let reason = format!("{} overlaps {first}", head.name);
                staging.queue.abort(reason.clone());
                staging.message = Some(reason);
                return;
            }
            if let Some(first) = staging
                .staged_names_intersecting_except(head.rect, &moving_names)
                .first()
            {
                let reason = format!("{} overlaps staged macro {first}", head.name);
                staging.queue.abort(reason.clone());
                staging.message = Some(reason);
                return;
            }
        }
        staging.queue.pending.pop_front();
        let command_id = self.allocate_command_id();
        let command = GeometryEditCommand {
            command_id,
            shape_id,
            expected_version,
            op: GeometryEditOp::MoveShape,
            requested_bbox: head.rect,
        };
        let command_path = self
            .edit_command_dir
            .as_ref()
            .expect("checked above")
            .join(format!("command-{command_id}.json"));
        let result_path = self
            .edit_result_dir
            .as_ref()
            .expect("checked above")
            .join(format!("result-{command_id}.json"));
        match write_edit_command(
            &command_path,
            &command,
            Some(head.name.as_str()),
            Some(head.orient.as_str()),
            Some(placement_status.as_str()),
        ) {
            Ok(()) => {
                if let Some(staging) = self.macro_staging.as_mut() {
                    staging.message = None;
                    staging.queue.active = Some(crate::macro_ops::ActiveMacroCommand {
                        command_id,
                        name: head.name.clone(),
                        orient: head.orient,
                        placement_status: Some(placement_status),
                    });
                }
                self.pending_edit = Some(PendingEdit {
                    result_path,
                    staged_macro,
                });
                self.last_edit_result = Some(format!("command {command_id} pending"));
            }
            Err(err) => {
                let message = format!("failed to write edit command: {err}");
                if let Some(staging) = self.macro_staging.as_mut() {
                    staging.queue.abort(message.clone());
                    staging.message = Some(message.clone());
                }
                self.last_edit_result = Some(message);
            }
        }
    }

    /// Reconciles macro staging after a snapshot reload and advances the
    /// macro operation queue. Called from the edit result poller.
    pub(super) fn finish_macro_edit_result(&mut self, result: &GeometryEditResult) {
        let accepted = matches!(
            result.status,
            GeometryEditStatus::Accepted | GeometryEditStatus::AdjustedAccepted
        );
        let staged_macro = self
            .pending_edit
            .as_ref()
            .and_then(|pending| pending.staged_macro.clone());
        let Some(staging) = self.macro_staging.as_mut() else {
            return;
        };
        if let Some(active) = staging.queue.active.take() {
            if active.command_id == result.command_id {
                if accepted {
                    if let Some(status) = active.placement_status {
                        staging.set_status(&active.name, status);
                    }
                    staging.orient_by_name.insert(active.name, active.orient);
                } else {
                    staging.queue.abort(format!(
                        "placement of {} was rejected by the layout edit session",
                        active.name
                    ));
                }
            } else {
                staging.queue.active = Some(active);
            }
        }
        if accepted {
            if let Some(staged_macro) = staged_macro {
                staging.commit_staged_move(
                    &staged_macro.name,
                    staged_macro.orient,
                    result.committed_bbox,
                );
                if let Some(status) = staged_macro
                    .placement_status
                    .as_deref()
                    .and_then(PlacementStatus::parse)
                {
                    staging.set_status(&staged_macro.name, status);
                }
            }
        }
        staging.reconcile(&self.db);
        staging.queue.finish_if_idle();
    }

    fn abort_macro_queue(&mut self, reason: impl Into<String>) {
        if let Some(staging) = self.macro_staging.as_mut() {
            if staging.queue.is_busy() {
                staging.queue.abort(reason);
            }
        }
    }

    fn paint_macro_staging(&self, painter: &egui::Painter, world: Rect32, canvas: egui::Rect) {
        let Some(staging) = self.macro_staging.as_ref() else {
            return;
        };
        let staged_fill = egui::Color32::from_rgba_unmultiplied(96, 140, 210, 70);
        let staged_selected_fill = egui::Color32::from_rgba_unmultiplied(96, 160, 230, 120);
        if let Some(blob) = &staging.stdcell_blob {
            let stdcell_visible = self
                .object_visibility
                .instances
                .is_visible(crate::instance_visibility::InstanceClass::StdCell);
            let screen = world_to_screen_rect(blob.rect, world, canvas, self.zoom, self.pan);
            if stdcell_visible && screen.is_positive() && screen.intersects(canvas) {
                crate::macro_staging::paint_stdcell_blob(painter, blob, screen);
            }
        }
        if !self
            .object_visibility
            .instances
            .is_visible(crate::instance_visibility::InstanceClass::Macro)
        {
            return;
        }
        for staged in &staging.staged {
            let screen = world_to_screen_rect(staged.rect, world, canvas, self.zoom, self.pan);
            if !screen.is_positive() || !screen.intersects(canvas) {
                continue;
            }
            let selected = staging
                .selection
                .contains(&MacroTarget::Staged(staged.name.clone()));
            painter.rect_filled(
                screen,
                0.0,
                if selected {
                    staged_selected_fill
                } else {
                    staged_fill
                },
            );
            painter.rect_stroke(
                screen.expand(1.0),
                0.0,
                egui::Stroke::new(
                    1.5_f32,
                    if selected {
                        ecos_accent()
                    } else {
                        ecos_text_secondary()
                    },
                ),
                egui::StrokeKind::Inside,
            );
            if screen.width() > 40.0 {
                painter.text(
                    screen.left_top() + egui::vec2(4.0, 2.0),
                    egui::Align2::LEFT_TOP,
                    staged.name.as_str(),
                    egui::FontId::proportional(11.0),
                    ecos_text_secondary(),
                );
            }
        }
        for target in &staging.selection {
            let MacroTarget::Placed(name) = target else {
                continue;
            };
            let Some(shape) = crate::macro_staging::instance_shape(&self.db, name) else {
                continue;
            };
            let screen = world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
            painter.rect_stroke(
                screen.expand(2.0),
                0.0,
                egui::Stroke::new(2.0_f32, ecos_accent()),
                egui::StrokeKind::Inside,
            );
        }
    }

    fn paint_macro_interaction(&self, painter: &egui::Painter, world: Rect32, canvas: egui::Rect) {
        match self.macro_interaction.as_ref() {
            Some(MacroCanvasInteraction::Marquee(marquee)) => {
                let screen =
                    world_to_screen_rect(marquee.rect(), world, canvas, self.zoom, self.pan);
                painter.rect_filled(
                    screen,
                    0.0,
                    egui::Color32::from_rgba_unmultiplied(82, 168, 255, 30),
                );
                painter.rect_stroke(
                    screen,
                    0.0,
                    egui::Stroke::new(1.5, ecos_accent()),
                    egui::StrokeKind::Inside,
                );
            }
            Some(MacroCanvasInteraction::GroupDrag(drag)) => {
                let invalid =
                    !drag.valid() || self.macro_moves_validation_error(drag.preview()).is_some();
                let stroke = egui::Stroke::new(
                    2.0,
                    if invalid {
                        egui::Color32::from_rgb(248, 113, 113)
                    } else {
                        ecos_accent()
                    },
                );
                for item in drag.preview() {
                    let screen =
                        world_to_screen_rect(item.rect, world, canvas, self.zoom, self.pan);
                    painter.rect_stroke(screen.expand(2.0), 0.0, stroke, egui::StrokeKind::Inside);
                }
            }
            None => {}
        }
    }

    pub(super) fn poll_edit_result(&mut self) {
        if self.pending_edit.is_none() && self.macro_queue_busy() {
            self.pump_macro_queue();
        }
        if self.pending_reload.is_some() {
            // An earlier edit result is still reloading its snapshot; wait for
            // it instead of re-reading the same result file every frame.
            return;
        }
        let Some(pending) = &self.pending_edit else {
            return;
        };
        if !pending.result_path.exists() {
            return;
        }

        let result = match fs::read_to_string(&pending.result_path)
            .ok()
            .and_then(|content| serde_json::from_str::<GeometryEditResult>(&content).ok())
        {
            Some(result) => result,
            None => {
                let message = "failed to read edit result".to_string();
                self.last_edit_result = Some(message.clone());
                self.pending_edit = None;
                self.abort_macro_queue(message);
                return;
            }
        };

        if let Some(active) = self
            .macro_staging
            .as_ref()
            .and_then(|staging| staging.queue.active.as_ref())
        {
            if active.command_id != result.command_id {
                let message = format!(
                    "macro edit result command {} does not match active command {}",
                    result.command_id, active.command_id
                );
                self.last_edit_result = Some(message.clone());
                self.pending_edit = None;
                self.abort_macro_queue(message);
                return;
            }
        }

        let action = edit_result_action(&result);
        // Shape id 0 is the placeholder used for staged macro placements;
        // it never identifies a real snapshot shape.
        self.selected = action.selected_shape_id.filter(|shape_id| *shape_id != 0);
        if action.reload_snapshot {
            let completion = ReloadCompletion::EditResult {
                result: result.clone(),
                message: action.message,
            };
            match self.reload_snapshot_at(result.geometry_manifest_path.as_deref(), completion) {
                Ok(()) => return,
                Err(err) => {
                    let message = format!("failed to reload geometry: {err}");
                    self.last_edit_result = Some(message.clone());
                    self.pending_edit = None;
                    self.abort_macro_queue(message);
                    return;
                }
            }
        }
        self.finish_macro_edit_result(&result);

        if matches!(
            result.status,
            GeometryEditStatus::Accepted | GeometryEditStatus::AdjustedAccepted
        ) {
            self.session_dirty = true;
        }

        self.last_edit_result = Some(action.message);
        self.pending_edit = None;
    }

    pub(super) fn request_session_action(&mut self, action: SessionActionKind, close_after: bool) {
        if !self.session_dirty {
            self.last_edit_result = Some("there are no uncommitted layout edits".to_string());
            return;
        }
        if matches!(action, SessionActionKind::Save) {
            if let Some(blocker) = macro_save_blocker(self.macro_staging.as_ref()) {
                self.last_edit_result = Some(blocker);
                return;
            }
        }
        if self.pending_edit.is_some()
            || self.draft.is_some()
            || self.pending_session_action.is_some()
            || self.macro_queue_busy()
        {
            self.last_edit_result = Some("wait for the current edit to finish".to_string());
            return;
        }
        let Some(command_dir) = self.edit_command_dir.clone() else {
            self.last_edit_result = Some("edit command directory is missing".to_string());
            return;
        };
        let Some(result_dir) = self.edit_result_dir.clone() else {
            self.last_edit_result = Some("edit result directory is missing".to_string());
            return;
        };

        let command = SessionActionCommand {
            command_id: self.allocate_command_id(),
            action,
        };
        let command_path = command_dir.join(format!(
            "control-{}-{}.json",
            action.label(),
            command.command_id
        ));
        let result_path = result_dir.join(format!(
            "control-result-{}-{}.json",
            action.label(),
            command.command_id
        ));
        let progress_path = result_dir.join(format!(
            "control-progress-{}-{}.json",
            action.label(),
            command.command_id
        ));

        match write_session_action_command(&command_path, &command) {
            Ok(()) => {
                self.pending_session_action = Some(PendingSessionAction {
                    action,
                    command_id: command.command_id,
                    queued_at: Instant::now(),
                    progress_path,
                    result_path,
                });
                self.session_action_progress = Some(SessionActionProgress::new(
                    action,
                    command.command_id,
                    SessionActionProgressPhase::Queued,
                    0,
                    format!(
                        "Waiting for ECOS Studio to accept the {} request",
                        action.label()
                    ),
                ));
                self.close_after_session_action = close_after;
                self.last_edit_result = Some(format!("{} pending", action.label()));
            }
            Err(err) => {
                let message = format!("failed to request {}: {err}", action.label());
                self.session_action_progress = Some(SessionActionProgress::new(
                    action,
                    command.command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message.clone(),
                ));
                self.last_edit_result = Some(message);
            }
        }
    }

    pub(super) fn poll_session_action_progress(&mut self) {
        let Some(pending) = self.pending_session_action.as_ref() else {
            return;
        };
        let expected_action = pending.action;
        let expected_command_id = pending.command_id;
        let poll = read_session_action_progress(
            expected_action,
            expected_command_id,
            &pending.progress_path,
            pending.queued_at.elapsed(),
        );
        match poll {
            SessionActionProgressPoll::Waiting => {}
            SessionActionProgressPoll::Updated(progress) => {
                self.session_action_progress = Some(progress);
            }
            SessionActionProgressPoll::TimedOut => {
                let message = format!(
                    "Timed out waiting for ECOS Studio to accept the {} request. Keep ECOS Studio running and reopen layout editing before retrying. If ECOS Studio is closed, close this window without saving.",
                    expected_action.label()
                );
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                self.pending_session_action = None;
                self.close_after_session_action = false;
            }
        }
    }

    /// Returns true when a successful Save or Discard was requested by the
    /// close confirmation and the native window may now exit.
    pub(super) fn poll_session_action_result(&mut self) -> bool {
        if self.pending_reload.is_some() {
            // A reload started by an earlier result is still in flight.
            return false;
        }
        let Some(pending) = &self.pending_session_action else {
            return false;
        };
        if !pending.result_path.exists() {
            return false;
        }

        let expected_action = pending.action;
        let expected_command_id = pending.command_id;
        let result = match fs::read_to_string(&pending.result_path)
            .ok()
            .and_then(|content| serde_json::from_str::<SessionActionResult>(&content).ok())
        {
            Some(result)
                if result.action == expected_action && result.command_id == expected_command_id =>
            {
                result
            }
            Some(_) => {
                let message = "received a mismatched session action result".to_string();
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                self.pending_session_action = None;
                self.close_after_session_action = false;
                return false;
            }
            None => {
                let message = "failed to read session action result".to_string();
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                self.pending_session_action = None;
                self.close_after_session_action = false;
                return false;
            }
        };

        let close_after = self.close_after_session_action;
        self.close_after_session_action = false;
        self.pending_session_action = None;
        if !result.accepted {
            let message = session_action_result_message(&result);
            self.last_edit_result = Some(message.clone());
            self.session_action_progress = Some(SessionActionProgress::new(
                expected_action,
                expected_command_id,
                SessionActionProgressPhase::Failed,
                100,
                message,
            ));
            return false;
        }

        self.session_action_progress = Some(SessionActionProgress::new(
            expected_action,
            expected_command_id,
            SessionActionProgressPhase::ReloadingGeometry,
            95,
            "Reloading published geometry",
        ));
        let completion = ReloadCompletion::SessionAction {
            result: result.clone(),
            expected_action,
            expected_command_id,
            close_after,
        };
        match self.reload_snapshot_at(result.geometry_manifest_path.as_deref(), completion) {
            Ok(()) => false,
            Err(err) => {
                let message = format!(
                    "{} completed but geometry reload failed: {err}",
                    result.action.label()
                );
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                false
            }
        }
    }

    pub(super) fn show_shortcuts_overlay(&mut self, ctx: &egui::Context) {
        if !self.shortcuts_overlay_visible {
            return;
        }
        let mut open = true;
        egui::Window::new("Keyboard Shortcuts")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(420.0);
                ui.add_space(2.0);

                let render_shortcut_row = |ui: &mut egui::Ui, key: &str, desc: &str| {
                    ui.horizontal(|ui| {
                        ui.set_min_height(22.0);
                        egui::Frame::NONE
                            .fill(egui::Color32::from_rgb(38, 40, 48))
                            .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
                            .corner_radius(4)
                            .inner_margin(egui::Margin::symmetric(6, 2))
                            .show(ui, |ui| {
                                ui.label(
                                    egui::RichText::new(key)
                                        .monospace()
                                        .size(11.0)
                                        .strong()
                                        .color(ecos_accent()),
                                );
                            });
                        ui.add_space(8.0);
                        ui.label(
                            egui::RichText::new(desc)
                                .size(12.0)
                                .color(ecos_text_primary()),
                        );
                    });
                };

                ui.label(
                    egui::RichText::new("2D / 3D NAVIGATION")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(ui, "Q", "Toggle 2D / 3D Layer Stack View");
                render_shortcut_row(ui, "F  or  Home", "Fit entire design to viewport");
                render_shortcut_row(ui, "Z", "Zoom / focus to selected object");
                render_shortcut_row(ui, "+  /  -", "Zoom in / Zoom out (Dolly in 3D)");
                render_shortcut_row(ui, "Scroll Wheel", "Distance-proportional Zoom / Dolly");
                render_shortcut_row(ui, "Shift + Drag", "Fine speed control (0.25×)");
                render_shortcut_row(ui, "Ctrl + Drag", "Fast speed boost (4.0×)");
                render_shortcut_row(ui, "Middle / Right Drag", "Pan viewport (2D & 3D)");
                render_shortcut_row(ui, "Left Drag (3D)", "Orbit / Turntable rotate in 3D");
                render_shortcut_row(ui, "Arrow Keys", "Pan 10% (2D) / Shift Pivot (3D)");

                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("3D VIEW PRESETS")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(ui, "1  or  T", "Top View (+Z look-down)");
                render_shortcut_row(ui, "2  or  I", "Isometric View");
                render_shortcut_row(ui, "3", "Front View (stack cross-section)");
                render_shortcut_row(ui, "G", "Toggle Ground Grid floor plane");

                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("TOOLS & INSPECTION")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(ui, "K  or  R", "Toggle Ruler / Measurement tool");
                render_shortcut_row(ui, "Esc", "Clear ruler, selection, or close popup");
                render_shortcut_row(ui, "Ctrl + F  or  /", "Focus search query");
                render_shortcut_row(ui, "?  or  F1", "Toggle Keyboard Shortcuts overlay");
                if self.macro_staging.is_some() {
                    render_shortcut_row(
                        ui,
                        "Shift/Ctrl/Cmd + Click",
                        "Add or remove a macro from the selection",
                    );
                    render_shortcut_row(ui, "Drag Empty Area", "Select macros with a marquee");
                    render_shortcut_row(ui, "Drag Selected Macro", "Move the selected macro group");
                }

                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("HEATMAP & MAP ANALYSIS")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(
                    ui,
                    "Space",
                    "A/B Map Quick-Toggle (switch with previous map)",
                );
                render_shortcut_row(ui, "N  /  Shift + N", "Focus Next / Prev Peak hotspot");
                render_shortcut_row(ui, "H", "Toggle active heatmap visibility");
                render_shortcut_row(ui, "[  /  ]", "Decrease / Increase heatmap opacity");
                render_shortcut_row(ui, "Drag on Legend", "Slide threshold cutoff in minimap");
                ui.add_space(4.0);
            });
        if !open {
            self.shortcuts_overlay_visible = false;
        }
    }

    pub(super) fn poll_external_snapshot_refresh(&mut self) {
        if self.pending_edit.is_some()
            || self.pending_session_action.is_some()
            || self.pending_reload.is_some()
            || self.draft.is_some()
        {
            return;
        }

        let now = Instant::now();
        if now < self.next_snapshot_refresh_check {
            return;
        }
        self.next_snapshot_refresh_check = now + SNAPSHOT_REFRESH_CHECK_INTERVAL;

        let current_signature = snapshot_signature_for_db(&self.db);
        if !snapshot_file_signature_changed(&self.snapshot_signature, &current_signature) {
            return;
        }

        match self.reload_snapshot(ReloadCompletion::notify(
            "geometry snapshot refreshed",
            "failed to refresh geometry",
        )) {
            Ok(()) => {}
            Err(err) => {
                self.last_edit_result = Some(format!("failed to refresh geometry: {err}"));
            }
        }
    }

    pub(super) fn reload_snapshot(&mut self, completion: ReloadCompletion) -> Result<(), String> {
        let manifest_path = self.db.snapshot().manifest().path.clone();
        self.reload_snapshot_from(&manifest_path, completion)
    }

    fn reload_snapshot_at(
        &mut self,
        manifest_path: Option<&str>,
        completion: ReloadCompletion,
    ) -> Result<(), String> {
        let manifest_path = manifest_path
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.db.snapshot().manifest().path.clone());
        self.reload_snapshot_from(&manifest_path, completion)
    }

    fn reload_snapshot_from(
        &mut self,
        manifest_path: &Path,
        completion: ReloadCompletion,
    ) -> Result<(), String> {
        if self.pending_reload.is_some() {
            return Err("geometry reload already in progress".to_string());
        }
        self.pending_reload = Some(PendingReload::start(
            manifest_path.to_path_buf(),
            completion,
        ));
        Ok(())
    }

    pub(super) fn replace_db(&mut self, prepared: PreparedViewer) {
        let PreparedViewer {
            db,
            stats,
            grid_bounds,
            drawing_category_counts: _,
            snapshot_signature,
            layer_catalog,
        } = prepared;
        let visibility: BTreeMap<LayerId, bool> = self
            .layers
            .iter()
            .map(|layer| (layer.layer_id, layer.visible))
            .collect();
        self.grid_bounds = grid_bounds;
        self.stats = stats;
        let counts = Arc::new(OnceLock::new());
        let guides = Arc::new(OnceLock::new());
        self.drawing_category_counts = Arc::clone(&counts);
        self.unrouted_net_guides = Arc::clone(&guides);
        self.spatial_index_prewarm_started = false;
        let index_db = Arc::clone(&db);
        thread::spawn(move || index_db.prewarm_render_indexes());
        start_drawing_category_data(Arc::clone(&db), Arc::clone(&counts), Arc::clone(&guides));
        self.layers = layer_ui_states_from_summaries(layer_catalog, &visibility, self.color_theme);
        self.db = db;
        self.gpu_tile_worker = GpuTileWorker::new(std::sync::Arc::clone(&self.db));
        let guide_db = std::sync::Arc::clone(&self.db);
        if let Err(err) = thread::Builder::new()
            .name("chip-viewer-net-guides".to_string())
            .spawn(move || guide_db.prewarm_unrouted_net_guides())
        {
            log::warn!("could not start unrouted-net guide prewarm: {err}");
        }
        if let Some(staging) = self.macro_staging.as_mut() {
            staging.reconcile(&self.db);
        }
        self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
        self.render_cache.clear();
        self.view_tile_cache.clear();
        self.clock_tree_overlay.clear();
        if self.query_input_mode == QueryInputMode::Search {
            self.run_search_now(false);
        } else {
            self.cancel_search();
        }
        let db = &self.db;
        self.selected =
            retain_existing_shape_id(self.selected, |shape_id| db.find_shape(shape_id).is_some());
        self.rebuild_layer_stack();
        self.view3d_fitted = false;
        self.snapshot_signature = snapshot_signature;
    }

    fn allocate_command_id(&mut self) -> u64 {
        next_native_command_id(&mut self.next_command_counter)
    }

    fn run_search_now(&mut self, focus_results: bool) {
        self.schedule_search();
        self.focus_search_results = focus_results && self.search_worker.is_pending();
        self.search_worker.start_now(&self.db);
    }

    fn schedule_search(&mut self) {
        self.clear_search_results();
        self.search_worker
            .schedule(self.search_text.trim().to_owned(), self.search_mode);
    }

    fn cancel_search(&mut self) {
        self.search_worker.cancel();
        self.clear_search_results();
    }

    fn clear_search_results(&mut self) {
        self.search_highlighted.clear();
        self.search_truncated = false;
        self.last_query_status = None;
        self.focus_search_results = false;
        self.rebuild_highlights();
    }

    pub(super) fn poll_search(&mut self, ctx: &egui::Context) {
        if self.query_input_mode != QueryInputMode::Search {
            return;
        }
        self.search_worker.poll_start(&self.db);
        match self.search_worker.try_take() {
            Ok(Some(result)) => {
                self.search_highlighted = result.shape_ids;
                self.rebuild_highlights();
                self.search_truncated = result.truncated;
                self.last_query_status = result.error;
                if self.focus_search_results {
                    self.focus_search_results = false;
                    self.focus_search_highlights();
                }
            }
            Ok(None) if self.search_worker.is_pending() => {
                ctx.request_repaint_after(Duration::from_millis(20));
            }
            Err(error) => {
                self.focus_search_results = false;
                self.last_query_status = Some(error);
            }
            Ok(None) => {}
        }
    }

    pub(super) fn rebuild_highlights(&mut self) {
        self.highlighted = self
            .search_highlighted
            .union(self.clock_tree_overlay.shape_ids())
            .copied()
            .collect();
    }

    fn focus_search_highlights(&mut self) {
        if !self.search_highlighted.is_empty() {
            self.pending_focus = focus_target_for_shape_ids(&self.search_highlighted, |id| {
                self.db.find_shape(id).map(|shape| shape.bbox)
            });
        }
    }

    fn focus_highlighted_shapes(&mut self) {
        if self.highlighted.is_empty() {
            return;
        }
        self.pending_focus = focus_target_for_shape_ids(&self.highlighted, |shape_id| {
            self.db.find_shape(shape_id).map(|shape| shape.bbox)
        });
    }

    fn select_shape_id_from_input(&mut self) {
        let action = shape_id_lookup_action(&self.shape_id_text, |shape_id| {
            self.db
                .find_shape(shape_id)
                .filter(|shape| is_renderable_shape(shape) && self.shape_is_visible(shape))
                .map(|shape| shape.bbox)
        });
        self.pending_focus = action.pending_focus;
        self.last_query_status = Some(action.message);
    }

    fn drawing_category_shape_count(&self, category: DrawingCategory) -> usize {
        self.drawing_category_counts
            .get()
            .and_then(|counts| counts.get(&category))
            .copied()
            .unwrap_or(0)
    }

    fn visible_object_shape_count(&self) -> usize {
        DrawingCategory::ALL
            .into_iter()
            .filter(|category| self.object_visibility.is_category_visible(*category))
            .map(|category| self.drawing_category_shape_count(category))
            .sum()
    }

    fn has_via_physical_layer(&self) -> bool {
        self.layers
            .iter()
            .any(|layer| layer.name.trim().to_ascii_uppercase().starts_with("VIA"))
    }

    fn queue_selected_pin_label(&mut self, world: Rect32, canvas: egui::Rect) {
        if let Some(candidate) = self.selected_pin_label(world, canvas) {
            self.label_collector.insert(candidate);
        }
    }

    pub(super) fn selected_pin_label(
        &self,
        world: Rect32,
        canvas: egui::Rect,
    ) -> Option<ShapeLabelCandidate> {
        let shape_id = self.selected?;
        let shape = self.db.find_shape(shape_id)?;
        if !self.shape_is_visible(shape) || !self.shape_is_drawn_at_current_zoom(shape) {
            return None;
        }
        let owner = self.db.owner_for_shape(shape)?;
        let owner_type = OwnerType::from_raw(owner.owner_type)?;
        if !matches!(
            owner_type,
            OwnerType::PinPortShape | OwnerType::InstancePinPortShape | OwnerType::IoPinPortShape
        ) {
            return None;
        }
        shape_label_candidate(
            self.db.shape_geometry(shape),
            Some(owner),
            self.db.owner_name(owner),
            true,
            self.highlighted.contains(&shape_id),
            world,
            canvas,
            self.zoom,
            self.pan,
        )
    }

    fn shape_is_visible(&self, shape: &ShapeRecord) -> bool {
        let owner_type = self
            .db
            .owner_for_shape(shape)
            .and_then(|owner| OwnerType::from_raw(owner.owner_type));
        let layer_visible = if shape_uses_layer_visibility(shape, owner_type) {
            self.layers
                .iter()
                .find(|layer| layer.layer_id == shape.layer_id)
                .is_some_and(|layer| layer.visible)
        } else {
            true
        };
        let owner_visible = self
            .db
            .owner_for_shape(shape)
            .and_then(|owner| drawing_category_for_owner(&self.db, owner))
            .is_none_or(|category| self.object_visibility.is_category_visible(category));
        layer_visible && owner_visible
    }

    fn visible_drc_violation_count(&self, viewport: Option<Rect32>) -> usize {
        let Some(overlay) = &self.drc_overlay else {
            return 0;
        };
        let hidden_layers: std::collections::HashSet<&str> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.as_str())
            .collect();
        let visible_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|s| s.visible)
            .map(|s| s.name.as_str())
            .collect();

        let is_visible = |v: &DrcViolation| {
            !hidden_layers.contains(v.layer.as_str()) && visible_types.contains(v.drc_type.as_str())
        };

        if let Some(vp) = viewport {
            let vp_aabb = rstar::AABB::from_corners([vp.lx, vp.ly], [vp.hx, vp.hy]);
            overlay
                .rtree
                .locate_in_envelope_intersecting(vp_aabb)
                .filter(|node| is_visible(&overlay.violations[node.index]))
                .count()
        } else {
            overlay.violations.iter().filter(|v| is_visible(v)).count()
        }
    }

    fn visible_antenna_violation_count(&self, viewport: Option<Rect32>) -> usize {
        let Some(overlay) = &self.antenna_overlay else {
            return 0;
        };
        let visible_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|s| s.visible)
            .map(|s| s.name.as_str())
            .collect();

        let is_visible = |v: &AntennaViolation| {
            antenna_layer_is_visible(&self.layers, &v.layer)
                && visible_types.contains(v.antenna_type.as_str())
        };

        if let Some(vp) = viewport {
            let vp_aabb = rstar::AABB::from_corners([vp.lx, vp.ly], [vp.hx, vp.hy]);
            overlay
                .rtree
                .locate_in_envelope_intersecting(vp_aabb)
                .filter(|node| is_visible(&overlay.violations[node.index]))
                .count()
        } else {
            overlay.violations.iter().filter(|v| is_visible(v)).count()
        }
    }

    // drc_violation_is_visible and antenna_violation_is_visible were removed for performance reasons.

    fn shape_is_drawn_at_current_zoom(&self, shape: &ShapeRecord) -> bool {
        let owner_type = self.db.owner_for_shape(shape).and_then(|owner| {
            let owner_type = OwnerType::from_raw(owner.owner_type)?;
            Some(owner_type)
        });
        if owner_type.is_some_and(|owner_type| {
            matches!(owner_type, OwnerType::TrackGrid | OwnerType::GCellGrid)
                && self.has_parameterized_grid_metadata(owner_type)
        }) {
            return false;
        }
        self.zoom > 1.25
            || owner_type
                .map(|owner_type| !is_context_owner_type(owner_type as u8))
                .unwrap_or(true)
    }

    fn has_parameterized_grid_metadata(&self, owner_type: OwnerType) -> bool {
        self.db
            .grid_metadata()
            .iter()
            .any(|grid| grid_owner_type(grid) == Some(owner_type))
    }

    fn apply_object_visibility(&mut self) {
        self.selected = retain_existing_shape_id(self.selected, |shape_id| {
            self.db
                .find_shape(shape_id)
                .is_some_and(|shape| self.shape_is_visible(shape))
        });
    }

    fn pick_shape_at(
        &self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        query_layer_ids: &[LayerId],
    ) -> Option<ShapeId> {
        let hit = screen_to_world_rect(
            egui::Rect::from_min_max(pos, pos),
            world,
            canvas,
            self.zoom,
            self.pan,
        );
        let point = chipgeom_format::Point32 {
            x: hit.lx,
            y: hit.ly,
        };
        if self.edit_enabled {
            let tolerance = edit_pick_tolerance_dbu(world, canvas, self.zoom);
            if let Some(shape_id) = self.pick_editable_instance_bbox_at(point, tolerance) {
                return Some(shape_id);
            }
        }
        self.db
            .pick_top_shape(query_layer_ids, point)
            .filter(|shape_id| {
                self.db.find_shape(*shape_id).is_some_and(|shape| {
                    self.shape_is_visible(shape) && self.shape_is_drawn_at_current_zoom(shape)
                })
            })
    }

    fn pick_editable_instance_bbox_at(
        &self,
        point: Point32,
        tolerance_dbu: i32,
    ) -> Option<ShapeId> {
        let point_bbox = Rect32 {
            lx: point.x.saturating_sub(tolerance_dbu),
            ly: point.y.saturating_sub(tolerance_dbu),
            hx: point.x.saturating_add(tolerance_dbu),
            hy: point.y.saturating_add(tolerance_dbu),
        };
        pick_top_editable_instance_bbox(
            self.db
                .query_layer_intersect_records(LAYOUT_GEOMETRY_LAYER, point_bbox)
                .into_iter()
                .filter_map(|shape| {
                    let owner = self.db.owner_for_shape(shape)?;
                    (self.shape_is_visible(shape) && self.shape_is_drawn_at_current_zoom(shape))
                        .then_some((shape, owner))
                }),
            point,
            tolerance_dbu,
        )
    }

    fn pick_drc_violation_at(
        &self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        viewport: Rect32,
    ) -> Option<usize> {
        let overlay = self.drc_overlay.as_ref()?;

        let hidden_drc_layer_names: std::collections::HashSet<&str> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.as_str())
            .collect();

        let visible_drc_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|s| s.visible)
            .map(|s| s.name.as_str())
            .collect();

        let vp_aabb =
            rstar::AABB::from_corners([viewport.lx, viewport.ly], [viewport.hx, viewport.hy]);

        let mut best_match: Option<usize> = None;
        for node in overlay.rtree.locate_in_envelope_intersecting(vp_aabb) {
            let violation = &overlay.violations[node.index];
            if !hidden_drc_layer_names.contains(violation.layer.as_str())
                && visible_drc_types.contains(violation.drc_type.as_str())
            {
                let screen =
                    drc_violation_screen_rect(violation, world, canvas, self.zoom, self.pan);
                if screen.expand(5.0).contains(pos) {
                    if let Some(current_best) = best_match {
                        if violation.id > current_best {
                            best_match = Some(violation.id);
                        }
                    } else {
                        best_match = Some(violation.id);
                    }
                }
            }
        }
        best_match
    }

    fn pick_antenna_violation_at(
        &self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        viewport: Rect32,
    ) -> Option<usize> {
        let overlay = self.antenna_overlay.as_ref()?;

        let visible_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|state| state.visible)
            .map(|state| state.name.as_str())
            .collect();
        let viewport_aabb =
            rstar::AABB::from_corners([viewport.lx, viewport.ly], [viewport.hx, viewport.hy]);

        let mut best_match = None;
        for node in overlay.rtree.locate_in_envelope_intersecting(viewport_aabb) {
            let violation = &overlay.violations[node.index];
            if !antenna_layer_is_visible(&self.layers, &violation.layer)
                || !visible_types.contains(violation.antenna_type.as_str())
            {
                continue;
            }
            let screen =
                antenna_violation_screen_rect(violation, world, canvas, self.zoom, self.pan);
            if screen.expand(5.0).contains(pos)
                && best_match.is_none_or(|current| violation.id > current)
            {
                best_match = Some(violation.id);
            }
        }
        best_match
    }

    fn drc_detail_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(selected_id) = self.selected_drc else {
            return;
        };
        let Some(violation) = self.drc_overlay.as_ref().and_then(|overlay| {
            overlay
                .violations
                .iter()
                .find(|item| item.id == selected_id)
        }) else {
            self.selected_drc = None;
            return;
        };
        let title = format!("{} / {}", violation.drc_type, violation.layer);
        let lines = drc_detail_lines(violation);

        let ctx = ui.ctx().clone();
        let popup_width = (canvas.width() * 0.34)
            .clamp(340.0, 480.0)
            .min((canvas.width() - 24.0).max(220.0));
        let popup_height = (canvas.height() * 0.3)
            .clamp(190.0, 280.0)
            .min((canvas.height() - 24.0).max(150.0));
        let popup_pos = egui::pos2(
            canvas.left() + 12.0,
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0),
        );

        egui::Area::new(egui::Id::new("chip_viewer_drc_detail_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0_f32, drc_overlay_primary_color()))
                    .corner_radius(12)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(egui::vec2(popup_width - 20.0, popup_height - 20.0));
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new(title)
                                    .strong()
                                    .size(14.0)
                                    .color(ecos_text_primary()),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui
                                        .small_button("×")
                                        .on_hover_text("Hide DRC detail")
                                        .clicked()
                                    {
                                        self.selected_drc = None;
                                    }
                                },
                            );
                        });
                        egui::ScrollArea::vertical()
                            .id_salt("chip_viewer_drc_detail_scroll")
                            .max_height(popup_height - 52.0)
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                for line in lines {
                                    info_panel_label(ui, line);
                                }
                            });
                    });
            });
    }

    fn antenna_detail_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(selected_id) = self.selected_antenna else {
            return;
        };
        let Some(violation) = self.antenna_overlay.as_ref().and_then(|overlay| {
            overlay
                .violations
                .iter()
                .find(|item| item.id == selected_id)
        }) else {
            self.selected_antenna = None;
            return;
        };
        let title = format!("{} / {}", violation.antenna_type, violation.layer);
        let lines = antenna_detail_lines(violation);

        let ctx = ui.ctx().clone();
        let popup_width = (canvas.width() * 0.34)
            .clamp(340.0, 480.0)
            .min((canvas.width() - 24.0).max(220.0));
        let popup_height = (canvas.height() * 0.3)
            .clamp(190.0, 280.0)
            .min((canvas.height() - 24.0).max(150.0));
        let popup_pos = egui::pos2(
            canvas.left() + 12.0,
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0),
        );

        egui::Area::new(egui::Id::new("chip_viewer_antenna_detail_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0_f32, antenna_overlay_primary_color()))
                    .corner_radius(12)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(egui::vec2(popup_width - 20.0, popup_height - 20.0));
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new(title)
                                    .strong()
                                    .size(14.0)
                                    .color(ecos_text_primary()),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui
                                        .small_button("×")
                                        .on_hover_text("Hide Antenna detail")
                                        .clicked()
                                    {
                                        self.selected_antenna = None;
                                    }
                                },
                            );
                        });
                        egui::ScrollArea::vertical()
                            .id_salt("chip_viewer_antenna_detail_scroll")
                            .max_height(popup_height - 52.0)
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                for line in lines {
                                    info_panel_label(ui, line);
                                }
                            });
                    });
            });
    }
}
