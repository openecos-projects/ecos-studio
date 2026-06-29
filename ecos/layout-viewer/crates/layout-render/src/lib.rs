use std::collections::{HashMap, HashSet};

use layout_display::{
    Color, CompositionMode, DisplayModel, LayerStyle, LineStyle, ObjectVisibility, Pattern,
    ResolvedDisplayLayer, SourceSelector,
};
use layoutdb::{
    CellId, CellViewInstanceQuery, CellViewInstanceRecord, CellViewShapeQuery, CellViewShapeRecord,
    CellViewState, HierarchyInstanceRecord, HierarchyPolicy, InstancePath, LayoutDb, ObjectPath,
    OverviewDensityBin, Rect, ShapeKind, ShapeRecord, SHAPE_FLAG_TOP_LEVEL_CONTEXT,
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    pub world: Rect,
    pub screen_width: f32,
    pub screen_height: f32,
}

impl Viewport {
    pub fn new(world: Rect, screen_width: f32, screen_height: f32) -> Self {
        Self {
            world,
            screen_width,
            screen_height,
        }
    }

    pub fn units_per_pixel_x(self) -> f32 {
        self.world.width().max(1) as f32 / self.screen_width.max(1.0)
    }

    pub fn units_per_pixel_y(self) -> f32 {
        self.world.height().max(1) as f32 / self.screen_height.max(1.0)
    }

    pub fn projected_size_px(self, rect: Rect) -> (f32, f32) {
        (
            rect.width().max(1) as f32 / self.units_per_pixel_x(),
            rect.height().max(1) as f32 / self.units_per_pixel_y(),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderSettings {
    pub small_shape_px: f32,
    pub frame_only_px: f32,
    pub fill_px: f32,
    pub fill_units_per_pixel: f32,
    pub long_shape_px: f32,
    pub occupancy_bin_px: f32,
    pub max_low_priority_quads_per_bin: usize,
    pub max_frames_per_bin: usize,
    pub max_markers_per_bin: usize,
    pub hierarchy_bbox_units_per_pixel: f32,
    pub hierarchy_coarse_units_per_pixel: f32,
    pub idle_detail_units_per_pixel: f32,
    pub array_bbox_units_per_pixel: f32,
    pub array_grid_units_per_pixel: f32,
    pub hierarchy_expand_depth: usize,
    pub force_interaction_coarse: bool,
    pub max_render_items: usize,
    pub enable_cell_template_cache: bool,
}

impl Default for RenderSettings {
    fn default() -> Self {
        Self {
            small_shape_px: 2.0,
            frame_only_px: 8.0,
            fill_px: 32.0,
            fill_units_per_pixel: 32.0,
            long_shape_px: 16.0,
            occupancy_bin_px: 8.0,
            max_low_priority_quads_per_bin: 32,
            max_frames_per_bin: 24,
            max_markers_per_bin: 3,
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            idle_detail_units_per_pixel: 96.0,
            array_bbox_units_per_pixel: 160.0,
            array_grid_units_per_pixel: 32.0,
            hierarchy_expand_depth: usize::MAX,
            force_interaction_coarse: false,
            max_render_items: 80_000,
            enable_cell_template_cache: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderPlane {
    Hierarchy,
    Fill,
    Frame,
    Marker,
    Text,
    Overlay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LodLevel {
    Far,
    Mid,
    Near,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LodHysteresisState {
    previous: Option<LodLevel>,
}

impl LodHysteresisState {
    pub fn previous(self) -> Option<LodLevel> {
        self.previous
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RenderPlanSource {
    #[default]
    FlatDetail,
    HierarchyFar,
    HierarchyMid,
    HierarchyNear,
    OverviewDensity,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DrawRect {
    pub world: Rect,
    pub color: Color,
    pub source_id: u32,
    pub layer_id: u16,
    pub composition: CompositionMode,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DrawMarker {
    pub world: Rect,
    pub color: Color,
    pub source_id: u32,
    pub layer_id: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DrawLine {
    pub from: (i32, i32),
    pub to: (i32, i32),
    pub color: Color,
    pub source_id: u32,
    pub layer_id: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DrawItem {
    Rect(DrawRect),
    Marker(DrawMarker),
    Line(DrawLine),
}

#[derive(Debug, Clone, PartialEq)]
pub struct DrawBatch {
    pub plane: RenderPlane,
    pub display_layer_id: String,
    pub style: LayerStyle,
    pub items: Vec<DrawItem>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RenderPlan {
    pub batches: Vec<DrawBatch>,
    pub query_stats: RenderQueryStats,
    pub lod_stats: LodStats,
    pub cache_key: RenderCacheKey,
    pub truncated: bool,
    pub source: RenderPlanSource,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RenderQueryStats {
    pub viewport_queries: usize,
    pub candidates_checked: usize,
    pub total_shapes_in_cell: usize,
    pub hierarchy_instance_candidates_checked: usize,
    pub total_hierarchy_instances: usize,
    pub display_cache_hits: usize,
    pub display_cache_misses: usize,
    pub cached_template_items: usize,
    pub proxy_density_bins: usize,
    pub proxy_representative_shapes: usize,
    pub proxy_child_summaries: usize,
    pub compact_array_elements_checked: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LodStats {
    pub exact: usize,
    pub frame_only: usize,
    pub marker: usize,
    pub hierarchy_bbox: usize,
    pub array_bbox: usize,
    pub array_grid: usize,
    pub coarse: usize,
    pub suppress: usize,
}

impl LodStats {
    fn record(&mut self, decision: LodDecision) {
        match decision {
            LodDecision::Exact => self.exact += 1,
            LodDecision::FrameOnly => self.frame_only += 1,
            LodDecision::Marker => self.marker += 1,
            LodDecision::HierarchyBBox => self.hierarchy_bbox += 1,
            LodDecision::ArrayBBox => self.array_bbox += 1,
            LodDecision::ArrayGrid => self.array_grid += 1,
            LodDecision::Coarse => self.coarse += 1,
            LodDecision::Suppress => self.suppress += 1,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct RenderCacheKey(u64);

impl RenderCacheKey {
    pub fn value(self) -> u64 {
        self.0
    }
}

pub fn classify_lod(
    units_per_pixel: f32,
    settings: RenderSettings,
    state: &mut LodHysteresisState,
) -> LodLevel {
    let upp = if units_per_pixel.is_finite() {
        units_per_pixel.max(0.0)
    } else {
        0.0
    };
    let far_enter = settings.hierarchy_bbox_units_per_pixel.max(0.0);
    let far_exit = far_enter * 0.8;
    let mid_enter = settings.hierarchy_coarse_units_per_pixel.max(0.0);
    let mid_exit = mid_enter * 0.8;

    let level = match state.previous {
        Some(LodLevel::Far) if upp >= far_exit => LodLevel::Far,
        Some(LodLevel::Mid) if upp >= mid_exit && upp < far_enter => LodLevel::Mid,
        _ if upp >= far_enter => LodLevel::Far,
        _ if upp >= mid_enter => LodLevel::Mid,
        _ => LodLevel::Near,
    };
    state.previous = Some(level);
    level
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickRequest {
    pub x: i32,
    pub y: i32,
    pub tolerance: i32,
}

impl PickRequest {
    pub fn new(x: i32, y: i32, tolerance: i32) -> Self {
        Self { x, y, tolerance }
    }

    fn rect(&self) -> Rect {
        Rect::new(
            self.x - self.tolerance,
            self.y - self.tolerance,
            self.x + self.tolerance + 1,
            self.y + self.tolerance + 1,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickHit {
    pub display_layer_id: String,
    pub source_id: u32,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub bbox: Rect,
    pub cell: CellId,
    pub depth: usize,
    pub instance_path: InstancePath,
    pub object_path: ObjectPath,
    pub target: PickHitTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PickHitTarget {
    Shape,
    Instance {
        parent_cell: CellId,
        child_cell: CellId,
        instance_id: u32,
        array_column: u32,
        array_row: u32,
    },
}

#[derive(Debug, Clone)]
pub struct RenderPlanner {
    settings: RenderSettings,
}

impl RenderPlanner {
    pub fn new(settings: RenderSettings) -> Self {
        Self { settings }
    }

    /// Returns the legacy flat-detail cache key for this model, viewport, and settings.
    ///
    /// Hierarchy LOD output depends on the effective [`RenderPlanSource`], which can require
    /// database hierarchy and hysteresis state to determine. Source-aware callers should compare
    /// against [`RenderPlan::cache_key`] after planning, or call [`Self::cache_key_with_source`]
    /// with the expected source.
    pub fn cache_key(&self, model: &DisplayModel, viewport: Viewport) -> RenderCacheKey {
        render_cache_key_with_source(
            viewport,
            &model.resolved_layers(),
            self.settings,
            RenderPlanSource::FlatDetail,
        )
    }

    pub fn cache_key_with_source(
        &self,
        model: &DisplayModel,
        viewport: Viewport,
        source: RenderPlanSource,
    ) -> RenderCacheKey {
        render_cache_key_with_source(viewport, &model.resolved_layers(), self.settings, source)
    }

    pub fn cache_key_for_cell_view(
        &self,
        model: &DisplayModel,
        viewport: Viewport,
        source: RenderPlanSource,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
    ) -> RenderCacheKey {
        render_cache_key_for_cell_view(
            viewport,
            &model.resolved_layers(),
            self.settings,
            source,
            cell_view,
            policy,
        )
    }

    pub fn plan(&self, db: &LayoutDb, model: &DisplayModel, viewport: Viewport) -> RenderPlan {
        let mut state = LodHysteresisState::default();
        self.plan_with_hysteresis_state(db, model, viewport, &mut state)
    }

    pub fn plan_with_hysteresis_state(
        &self,
        db: &LayoutDb,
        model: &DisplayModel,
        viewport: Viewport,
        hysteresis_state: &mut LodHysteresisState,
    ) -> RenderPlan {
        let cell_view = CellViewState::top(db);
        let policy = HierarchyPolicy::default();
        self.plan_for_cell_view_internal(
            db,
            model,
            viewport,
            &cell_view,
            &policy,
            hysteresis_state,
            CacheKeyMode::LegacySource,
        )
    }

    pub fn plan_for_cell_view(
        &self,
        db: &LayoutDb,
        model: &DisplayModel,
        viewport: Viewport,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        hysteresis_state: &mut LodHysteresisState,
    ) -> RenderPlan {
        self.plan_for_cell_view_internal(
            db,
            model,
            viewport,
            cell_view,
            policy,
            hysteresis_state,
            CacheKeyMode::CellViewAware,
        )
    }

    fn plan_for_cell_view_internal(
        &self,
        db: &LayoutDb,
        model: &DisplayModel,
        viewport: Viewport,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        hysteresis_state: &mut LodHysteresisState,
        cache_key_mode: CacheKeyMode,
    ) -> RenderPlan {
        let layers = model.resolved_layers();
        let object_visibility = model.object_visibility();
        let mut plan = RenderPlan {
            cache_key: self.render_cache_key_for_mode(
                viewport,
                &layers,
                RenderPlanSource::FlatDetail,
                cell_view,
                policy,
                cache_key_mode,
            ),
            ..Default::default()
        };
        if layers.is_empty() {
            plan.cache_key = self.render_cache_key_for_mode(
                viewport,
                &layers,
                plan.source,
                cell_view,
                policy,
                cache_key_mode,
            );
            return plan;
        }

        let hierarchy_exists = cell_has_instances(db, cell_view.target_cell());
        if !hierarchy_exists
            && is_top_cell_view(db, cell_view)
            && self.has_overview_density(db, viewport)
        {
            let overview_lod = self.classify_viewport_lod(viewport, hysteresis_state);
            if Self::lod_can_use_overview_density(overview_lod)
                && self.try_push_overview_density(db, &layers, &mut plan, viewport)
            {
                plan.source = RenderPlanSource::OverviewDensity;
                plan.cache_key = self.render_cache_key_for_mode(
                    viewport,
                    &layers,
                    plan.source,
                    cell_view,
                    policy,
                    cache_key_mode,
                );
                return plan;
            }
        }

        let mut occupancy = ScreenOccupancy::new(viewport, self.settings);
        match self.hierarchy_lod_mode_for_cell_view(db, cell_view, viewport, hysteresis_state) {
            HierarchyLodMode::FarBBox => {
                plan.source = RenderPlanSource::HierarchyFar;
                self.push_hierarchy_bboxes(
                    db,
                    &mut plan,
                    viewport,
                    cell_view,
                    policy,
                    max_depth_for_query(self.settings, policy),
                    object_visibility,
                );
                self.push_top_level_context(
                    db,
                    &layers,
                    &mut plan,
                    viewport,
                    &mut occupancy,
                    cell_view,
                    policy,
                    false,
                    TopLevelContextMode::StableContextOnly,
                );
            }
            HierarchyLodMode::MidCoarse => {
                plan.source = RenderPlanSource::HierarchyMid;
                self.push_coarse_hierarchy(
                    db,
                    &mut plan,
                    viewport,
                    cell_view,
                    policy,
                    object_visibility,
                );
                self.push_top_level_context(
                    db,
                    &layers,
                    &mut plan,
                    viewport,
                    &mut occupancy,
                    cell_view,
                    policy,
                    false,
                    TopLevelContextMode::StableContextOnly,
                );
            }
            HierarchyLodMode::NearExpand => {
                if cell_has_instances(db, cell_view.target_cell()) {
                    plan.source = RenderPlanSource::HierarchyNear;
                }
                self.push_expanded_hierarchy_shapes(
                    db,
                    &layers,
                    &mut plan,
                    viewport,
                    &mut occupancy,
                    cell_view,
                    policy,
                    if is_top_cell_view(db, cell_view) {
                        1
                    } else {
                        0
                    },
                );
                self.push_top_level_context(
                    db,
                    &layers,
                    &mut plan,
                    viewport,
                    &mut occupancy,
                    cell_view,
                    policy,
                    false,
                    TopLevelContextMode::AllVisibleShapes,
                );
            }
        }
        plan.cache_key = self.render_cache_key_for_mode(
            viewport,
            &layers,
            plan.source,
            cell_view,
            policy,
            cache_key_mode,
        );
        plan
    }

    fn push_top_level_context(
        &self,
        db: &LayoutDb,
        layers: &[ResolvedDisplayLayer],
        plan: &mut RenderPlan,
        viewport: Viewport,
        occupancy: &mut ScreenOccupancy,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        prefer_overview: bool,
        mode: TopLevelContextMode,
    ) {
        if !is_top_cell_view(db, cell_view)
            || policy.hidden_cells.contains(&db.top_cell())
            || policy.min_depth > 0
        {
            return;
        }
        if prefer_overview {
            if self.has_overview_density(db, viewport) {
                let mut overview_plan = RenderPlan::default();
                if self.push_overview_density(db, layers, &mut overview_plan, viewport)
                    && !overview_plan.truncated
                {
                    append_plan(plan, overview_plan, self.settings.max_render_items);
                }
            }
            return;
        }
        let query = db.query_shapes_indexed(db.top_cell(), None, viewport.world);
        if mode == TopLevelContextMode::AllVisibleShapes {
            plan.query_stats.viewport_queries = 1;
            plan.query_stats.candidates_checked = query.candidates_checked;
            plan.query_stats.total_shapes_in_cell = query.total_shapes_in_cell;
        }
        for shape in query.shapes {
            match mode {
                TopLevelContextMode::AllVisibleShapes => {
                    self.push_shape_lod(layers, plan, viewport, occupancy, shape);
                }
                TopLevelContextMode::StableContextOnly => {
                    if !is_stable_far_context_shape(shape) {
                        continue;
                    }
                    self.push_stable_context_shape(layers, plan, shape);
                }
            }
        }
    }

    fn push_stable_context_shape(
        &self,
        layers: &[ResolvedDisplayLayer],
        plan: &mut RenderPlan,
        shape: &ShapeRecord,
    ) {
        for layer in layers
            .iter()
            .filter(|layer| layer_matches_shape(layer, shape))
        {
            if plan.truncated {
                break;
            }
            let item = DrawItem::Rect(DrawRect {
                world: shape.bbox,
                color: layer.style.frame_color,
                source_id: shape.source_id,
                layer_id: shape.layer_id,
                composition: CompositionMode::MaskPattern,
            });
            push_item(
                plan,
                RenderPlane::Hierarchy,
                layer,
                item,
                self.settings.max_render_items,
            );
            plan.lod_stats.record(LodDecision::Coarse);
        }
    }

    fn render_cache_key_for_mode(
        &self,
        viewport: Viewport,
        layers: &[ResolvedDisplayLayer],
        source: RenderPlanSource,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        mode: CacheKeyMode,
    ) -> RenderCacheKey {
        match mode {
            CacheKeyMode::LegacySource => {
                render_cache_key_with_source(viewport, layers, self.settings, source)
            }
            CacheKeyMode::CellViewAware => render_cache_key_for_cell_view(
                viewport,
                layers,
                self.settings,
                source,
                cell_view,
                policy,
            ),
        }
    }

    fn lod_can_use_overview_density(level: LodLevel) -> bool {
        matches!(level, LodLevel::Far | LodLevel::Mid)
    }

    fn has_overview_density(&self, db: &LayoutDb, viewport: Viewport) -> bool {
        viewport
            .units_per_pixel_x()
            .max(viewport.units_per_pixel_y())
            >= self.settings.hierarchy_coarse_units_per_pixel
            && db.overview_bins(viewport.world).next().is_some()
    }

    fn try_push_overview_density(
        &self,
        db: &LayoutDb,
        layers: &[ResolvedDisplayLayer],
        plan: &mut RenderPlan,
        viewport: Viewport,
    ) -> bool {
        let mut overview_plan = RenderPlan::default();
        if !self.push_overview_density(db, layers, &mut overview_plan, viewport)
            || overview_plan.truncated
        {
            return false;
        }
        *plan = overview_plan;
        true
    }

    fn classify_viewport_lod(
        &self,
        viewport: Viewport,
        hysteresis_state: &mut LodHysteresisState,
    ) -> LodLevel {
        let units_per_pixel = viewport
            .units_per_pixel_x()
            .max(viewport.units_per_pixel_y());
        classify_lod(units_per_pixel, self.settings, hysteresis_state)
    }

    fn push_overview_density(
        &self,
        db: &LayoutDb,
        layers: &[ResolvedDisplayLayer],
        plan: &mut RenderPlan,
        viewport: Viewport,
    ) -> bool {
        let visible = VisibleShapeSources::from_layers(layers);
        let mut emitted = false;
        for bin in db.overview_bins(viewport.world) {
            if plan.truncated {
                break;
            }
            if !visible.matches(bin.layer_id, bin.kind) {
                continue;
            }
            for layer in layers
                .iter()
                .filter(|layer| layer_matches_overview_bin(layer, bin))
            {
                if plan.truncated {
                    break;
                }
                let item = DrawItem::Rect(DrawRect {
                    world: bin.bbox,
                    color: layer.style.fill_color,
                    source_id: 0,
                    layer_id: bin.layer_id,
                    composition: CompositionMode::MaskPattern,
                });
                push_item(
                    plan,
                    RenderPlane::Fill,
                    layer,
                    item,
                    self.settings.max_render_items,
                );
                plan.lod_stats.record(LodDecision::Coarse);
                emitted = true;
            }
        }
        emitted
    }

    fn hierarchy_lod_mode_for_cell_view(
        &self,
        db: &LayoutDb,
        cell_view: &CellViewState,
        viewport: Viewport,
        hysteresis_state: &mut LodHysteresisState,
    ) -> HierarchyLodMode {
        if !cell_has_instances(db, cell_view.target_cell()) {
            return HierarchyLodMode::NearExpand;
        }
        let level = self.classify_viewport_lod(viewport, hysteresis_state);
        let units_per_pixel = viewport
            .units_per_pixel_x()
            .max(viewport.units_per_pixel_y());
        if matches!(level, LodLevel::Mid)
            && !self.settings.force_interaction_coarse
            && units_per_pixel <= self.settings.idle_detail_units_per_pixel
        {
            return HierarchyLodMode::NearExpand;
        }
        if self.settings.force_interaction_coarse && matches!(level, LodLevel::Near) {
            return HierarchyLodMode::MidCoarse;
        }
        match level {
            LodLevel::Far => HierarchyLodMode::FarBBox,
            LodLevel::Mid => HierarchyLodMode::MidCoarse,
            LodLevel::Near => HierarchyLodMode::NearExpand,
        }
    }

    fn push_hierarchy_bboxes(
        &self,
        db: &LayoutDb,
        plan: &mut RenderPlan,
        viewport: Viewport,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        depth: usize,
        object_visibility: ObjectVisibility,
    ) {
        if !object_visibility.instances {
            return;
        }
        let query = db.query_cell_view_instances(CellViewInstanceQuery {
            cell_view: cell_view.clone(),
            viewport: viewport.world,
            min_depth: min_depth_for_query(policy).max(1),
            max_depth: depth.min(max_depth_for_query(self.settings, policy)),
            expand_arrays: false,
            policy: policy.clone(),
        });
        plan.query_stats.hierarchy_instance_candidates_checked = query.candidates_checked;
        plan.query_stats.total_hierarchy_instances = query.total_instances;
        plan.query_stats.compact_array_elements_checked = query.compact_array_elements_checked;
        let mut rendered_arrays = HashSet::new();
        let entries = far_hierarchy_entries(query.instances, viewport, &mut rendered_arrays, self);
        let item_budget = far_hierarchy_coalesce_budget(viewport, self.settings);
        if entries.len() > item_budget {
            self.push_thinned_hierarchy_bboxes(
                plan,
                viewport,
                entries,
                item_budget,
                object_visibility,
            );
            return;
        }
        for entry in entries {
            if plan.truncated {
                break;
            }
            self.push_far_hierarchy_entry(plan, entry, object_visibility);
        }
    }

    fn push_thinned_hierarchy_bboxes(
        &self,
        plan: &mut RenderPlan,
        viewport: Viewport,
        entries: Vec<FarHierarchyEntry>,
        item_budget: usize,
        object_visibility: ObjectVisibility,
    ) {
        let original_len = entries.len();
        let emitted_before =
            plan.lod_stats.hierarchy_bbox + plan.lod_stats.array_bbox + plan.lod_stats.array_grid;
        let thinned = thin_hierarchy_entries(viewport, self.settings, item_budget, entries);
        for entry in thinned {
            self.push_far_hierarchy_entry(plan, entry, object_visibility);
        }
        let emitted_after =
            plan.lod_stats.hierarchy_bbox + plan.lod_stats.array_bbox + plan.lod_stats.array_grid;
        let emitted = emitted_after.saturating_sub(emitted_before);
        plan.query_stats.proxy_child_summaries += emitted;
        plan.lod_stats.suppress += original_len.saturating_sub(emitted);
    }

    fn push_far_hierarchy_entry(
        &self,
        plan: &mut RenderPlan,
        entry: FarHierarchyEntry,
        object_visibility: ObjectVisibility,
    ) {
        let layer = hierarchy_display_layer(object_visibility);
        let (width_px, height_px) = entry.projected_size_px;
        if width_px.max(height_px) < self.settings.frame_only_px {
            push_item(
                plan,
                RenderPlane::Hierarchy,
                &layer,
                DrawItem::Marker(DrawMarker {
                    world: entry.bbox,
                    color: Color::rgb(198, 224, 242),
                    source_id: entry.source_id,
                    layer_id: 0,
                }),
                self.settings.max_render_items,
            );
            plan.lod_stats.record(match entry.decision {
                ArrayLodDecision::BBox => LodDecision::ArrayBBox,
                ArrayLodDecision::Grid => LodDecision::ArrayGrid,
                ArrayLodDecision::ViewportElements => LodDecision::HierarchyBBox,
            });
            return;
        }
        let item = DrawItem::Rect(DrawRect {
            world: entry.bbox,
            color: Color::rgb(168, 190, 210),
            source_id: entry.source_id,
            layer_id: 0,
            composition: CompositionMode::MaskPattern,
        });
        push_item(
            plan,
            RenderPlane::Hierarchy,
            &layer,
            item,
            self.settings.max_render_items,
        );
        plan.lod_stats.record(match entry.decision {
            ArrayLodDecision::BBox => LodDecision::ArrayBBox,
            ArrayLodDecision::Grid => LodDecision::ArrayGrid,
            ArrayLodDecision::ViewportElements => LodDecision::HierarchyBBox,
        });
    }

    fn push_coarse_hierarchy(
        &self,
        db: &LayoutDb,
        plan: &mut RenderPlan,
        viewport: Viewport,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        object_visibility: ObjectVisibility,
    ) {
        if !object_visibility.instances {
            return;
        }
        let query = db.query_cell_view_instances(CellViewInstanceQuery {
            cell_view: cell_view.clone(),
            viewport: viewport.world,
            min_depth: min_depth_for_query(policy).max(1),
            max_depth: max_depth_for_query(self.settings, policy),
            expand_arrays: false,
            policy: policy.clone(),
        });
        plan.query_stats.hierarchy_instance_candidates_checked = query.candidates_checked;
        plan.query_stats.total_hierarchy_instances = query.total_instances;
        plan.query_stats.compact_array_elements_checked = query.compact_array_elements_checked;
        let mut cell_cache = CellDisplayProxyCache::default();
        let mut rendered_arrays = HashSet::new();
        for instance in query.instances {
            if plan.truncated {
                break;
            }
            let instance_ref = HierarchyInstanceRef::from(&instance);
            let decision = self.array_lod_decision(instance_ref, viewport);
            if is_array_instance(instance_ref)
                && !rendered_arrays.insert((instance.source_id, instance.instance_id))
            {
                continue;
            }
            match decision {
                ArrayLodDecision::BBox => {
                    push_hierarchy_rect(
                        plan,
                        instance_ref,
                        hierarchy_bbox_for_decision(instance_ref, decision),
                        self.settings.max_render_items,
                        object_visibility,
                    );
                    plan.lod_stats.record(LodDecision::ArrayBBox);
                }
                ArrayLodDecision::Grid => {
                    self.push_array_grid(plan, instance_ref, object_visibility);
                    plan.lod_stats.record(LodDecision::ArrayGrid);
                }
                ArrayLodDecision::ViewportElements => {
                    let mut display_proxy = None;
                    if self.settings.enable_cell_template_cache {
                        let (proxy, hit) = cell_cache.proxy_for(db, instance.child_cell);
                        if hit {
                            plan.query_stats.display_cache_hits += 1;
                        } else {
                            plan.query_stats.display_cache_misses += 1;
                        }
                        plan.query_stats.cached_template_items += proxy.representative_shapes.len();
                        plan.query_stats.proxy_density_bins += proxy.layer_density_bins.len();
                        plan.query_stats.proxy_representative_shapes +=
                            proxy.representative_shapes.len();
                        plan.query_stats.proxy_child_summaries +=
                            proxy.child_instance_summaries.len();
                        display_proxy = Some(proxy);
                    }
                    push_hierarchy_rect(
                        plan,
                        instance_ref,
                        instance.bbox,
                        self.settings.max_render_items,
                        object_visibility,
                    );
                    if let Some(proxy) = display_proxy {
                        self.push_cell_display_proxy(
                            plan,
                            viewport,
                            &instance,
                            proxy,
                            object_visibility,
                        );
                    }
                    plan.lod_stats.record(LodDecision::Coarse);
                }
            }
        }
    }

    fn push_cell_display_proxy(
        &self,
        plan: &mut RenderPlan,
        viewport: Viewport,
        instance: &CellViewInstanceRecord,
        proxy: &CellDisplayProxy,
        object_visibility: ObjectVisibility,
    ) {
        let layer = hierarchy_display_layer(object_visibility);
        for density in &proxy.layer_density_bins {
            if plan.truncated {
                break;
            }
            let proxy_bbox = map_template_rect_to_instance(density.bbox, proxy.bbox, instance.bbox);
            push_item(
                plan,
                RenderPlane::Hierarchy,
                &layer,
                DrawItem::Rect(DrawRect {
                    world: proxy_bbox,
                    color: density_color(density.layer_id, density.shape_count),
                    source_id: 0,
                    layer_id: density.layer_id,
                    composition: CompositionMode::MaskPattern,
                }),
                self.settings.max_render_items,
            );
        }
        for shape in &proxy.representative_shapes {
            self.push_proxy_shape(plan, viewport, &layer, instance, proxy.bbox, shape);
        }
        for child in &proxy.child_instance_summaries {
            if plan.truncated {
                break;
            }
            let proxy_bbox = map_template_rect_to_instance(child.bbox, proxy.bbox, instance.bbox);
            push_item(
                plan,
                RenderPlane::Hierarchy,
                &layer,
                DrawItem::Rect(DrawRect {
                    world: proxy_bbox,
                    color: Color::rgb(154, 188, 214),
                    source_id: child.source_id,
                    layer_id: 0,
                    composition: CompositionMode::MaskPattern,
                }),
                self.settings.max_render_items,
            );
        }
        if let Some(array) = proxy.array_summary {
            let proxy_bbox = map_template_rect_to_instance(array.bbox, proxy.bbox, instance.bbox);
            push_item(
                plan,
                RenderPlane::Hierarchy,
                &layer,
                DrawItem::Rect(DrawRect {
                    world: proxy_bbox,
                    color: Color::rgb(118, 148, 176),
                    source_id: 0,
                    layer_id: 0,
                    composition: CompositionMode::MaskPattern,
                }),
                self.settings.max_render_items,
            );
        }
    }

    fn push_proxy_shape(
        &self,
        plan: &mut RenderPlan,
        viewport: Viewport,
        layer: &ResolvedDisplayLayer,
        instance: &CellViewInstanceRecord,
        proxy_bbox: Rect,
        shape: &RepresentativeShape,
    ) {
        if plan.truncated {
            return;
        }
        let mapped_bbox = map_template_rect_to_instance(shape.bbox, proxy_bbox, instance.bbox);
        let (width_px, height_px) = viewport.projected_size_px(mapped_bbox);
        if width_px.max(height_px) < self.settings.small_shape_px {
            push_item(
                plan,
                RenderPlane::Hierarchy,
                layer,
                DrawItem::Marker(DrawMarker {
                    world: mapped_bbox,
                    color: Color::rgb(188, 216, 236),
                    source_id: shape.source_id,
                    layer_id: shape.layer_id,
                }),
                self.settings.max_render_items,
            );
        } else {
            push_item(
                plan,
                RenderPlane::Hierarchy,
                layer,
                DrawItem::Rect(DrawRect {
                    world: mapped_bbox,
                    color: Color::rgb(136, 170, 198),
                    source_id: shape.source_id,
                    layer_id: shape.layer_id,
                    composition: CompositionMode::MaskPattern,
                }),
                self.settings.max_render_items,
            );
        }
    }

    fn push_expanded_hierarchy_shapes(
        &self,
        db: &LayoutDb,
        layers: &[ResolvedDisplayLayer],
        plan: &mut RenderPlan,
        viewport: Viewport,
        occupancy: &mut ScreenOccupancy,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
        min_depth: usize,
    ) {
        let visible = VisibleShapeSources::from_layers(layers);
        if visible.is_empty() {
            return;
        }
        let hierarchy_query = db.query_cell_view_shapes(CellViewShapeQuery {
            cell_view: cell_view.clone(),
            viewport: viewport.world,
            min_depth,
            max_depth: max_depth_for_query(self.settings, policy),
            layer_ids: Vec::new(),
            include_kinds: Vec::new(),
            policy: policy.clone(),
        });
        plan.query_stats.hierarchy_instance_candidates_checked =
            hierarchy_query.instance_candidates_checked;
        plan.query_stats.total_hierarchy_instances = hierarchy_query.total_instances;
        for record in hierarchy_query.shapes {
            if plan.truncated {
                break;
            }
            if !visible.matches(record.layer_id, record.kind) {
                continue;
            }
            let shape =
                ShapeRecord::new(record.bbox, record.layer_id, record.kind, record.source_id);
            self.push_shape_lod(layers, plan, viewport, occupancy, &shape);
        }
    }

    fn push_array_grid(
        &self,
        plan: &mut RenderPlan,
        instance: HierarchyInstanceRef<'_>,
        object_visibility: ObjectVisibility,
    ) {
        let bbox = hierarchy_bbox_for_decision(instance, ArrayLodDecision::Grid);
        push_hierarchy_rect(
            plan,
            instance,
            bbox,
            self.settings.max_render_items,
            object_visibility,
        );
        let layer = hierarchy_display_layer(object_visibility);
        let color = Color::rgb(118, 148, 176);
        let x_mid = bbox.x1 + bbox.width() / 2;
        let y_mid = bbox.y1 + bbox.height() / 2;
        push_item(
            plan,
            RenderPlane::Hierarchy,
            &layer,
            DrawItem::Line(DrawLine {
                from: (x_mid, bbox.y1),
                to: (x_mid, bbox.y2),
                color,
                source_id: instance.source_id(),
                layer_id: 0,
            }),
            self.settings.max_render_items,
        );
        push_item(
            plan,
            RenderPlane::Hierarchy,
            &layer,
            DrawItem::Line(DrawLine {
                from: (bbox.x1, y_mid),
                to: (bbox.x2, y_mid),
                color,
                source_id: instance.source_id(),
                layer_id: 0,
            }),
            self.settings.max_render_items,
        );
    }

    fn array_lod_decision(
        &self,
        instance: HierarchyInstanceRef<'_>,
        viewport: Viewport,
    ) -> ArrayLodDecision {
        if !is_array_instance(instance) {
            return ArrayLodDecision::ViewportElements;
        }
        let units_per_pixel = viewport
            .units_per_pixel_x()
            .max(viewport.units_per_pixel_y());
        if units_per_pixel >= self.settings.array_bbox_units_per_pixel {
            ArrayLodDecision::BBox
        } else if units_per_pixel >= self.settings.array_grid_units_per_pixel {
            ArrayLodDecision::Grid
        } else {
            ArrayLodDecision::ViewportElements
        }
    }

    fn push_shape_lod(
        &self,
        layers: &[ResolvedDisplayLayer],
        plan: &mut RenderPlan,
        viewport: Viewport,
        occupancy: &mut ScreenOccupancy,
        shape: &ShapeRecord,
    ) {
        if plan.truncated {
            return;
        }
        for layer in layers
            .iter()
            .filter(|layer| layer_matches_shape(layer, shape))
        {
            if plan.truncated {
                break;
            }
            let decision = self.lod_decision(viewport, shape, occupancy, layer);
            plan.lod_stats.record(decision);
            match decision {
                LodDecision::Exact => {
                    push_rect_batch(
                        plan,
                        RenderPlane::Fill,
                        layer,
                        shape,
                        self.settings.max_render_items,
                    );
                    push_rect_batch(
                        plan,
                        RenderPlane::Frame,
                        layer,
                        shape,
                        self.settings.max_render_items,
                    );
                }
                LodDecision::FrameOnly => {
                    push_rect_batch(
                        plan,
                        RenderPlane::Frame,
                        layer,
                        shape,
                        self.settings.max_render_items,
                    );
                }
                LodDecision::Marker => {
                    push_marker_batch(plan, layer, shape, self.settings.max_render_items);
                }
                LodDecision::HierarchyBBox => {}
                LodDecision::ArrayBBox => {}
                LodDecision::ArrayGrid => {}
                LodDecision::Coarse => {}
                LodDecision::Suppress => {}
            }
        }
    }

    fn lod_decision(
        &self,
        viewport: Viewport,
        shape: &ShapeRecord,
        occupancy: &mut ScreenOccupancy,
        layer: &ResolvedDisplayLayer,
    ) -> LodDecision {
        let (width_px, height_px) = viewport.projected_size_px(shape.bbox);
        let min_px = width_px.min(height_px);
        let max_px = width_px.max(height_px);
        if viewport
            .units_per_pixel_x()
            .max(viewport.units_per_pixel_y())
            <= self.settings.fill_units_per_pixel
            && min_px >= self.settings.fill_px
        {
            LodDecision::Exact
        } else if min_px >= self.settings.frame_only_px
            || max_px >= self.settings.long_shape_px
            || (is_wire_shape(shape.kind) && max_px >= wire_frame_threshold_px(self.settings))
        {
            if occupancy.reserve_frame(layer, shape) {
                LodDecision::FrameOnly
            } else {
                LodDecision::Suppress
            }
        } else if min_px >= self.settings.small_shape_px && occupancy.reserve_marker(layer, shape) {
            LodDecision::Marker
        } else if occupancy.reserve_marker(layer, shape) {
            LodDecision::Marker
        } else {
            LodDecision::Suppress
        }
    }

    pub fn pick(
        &self,
        db: &LayoutDb,
        model: &DisplayModel,
        request: PickRequest,
    ) -> Option<PickHit> {
        self.pick_for_cell_view(
            db,
            model,
            request,
            &CellViewState::top(db),
            &HierarchyPolicy::default(),
        )
    }

    pub fn pick_for_cell_view(
        &self,
        db: &LayoutDb,
        model: &DisplayModel,
        request: PickRequest,
        cell_view: &CellViewState,
        policy: &HierarchyPolicy,
    ) -> Option<PickHit> {
        let query = request.rect();
        let mut best: Option<PickHit> = None;
        for layer in model.resolved_layers() {
            if !layer.pickable {
                continue;
            }
            for shape in matching_shape_records_for_cell_view(db, &layer, query, cell_view, policy)
            {
                if !shape.kind.is_queryable() {
                    continue;
                }
                let candidate = pick_hit_for_shape(&layer.id, &shape);
                maybe_replace_pick_hit(&mut best, candidate, request.x, request.y);
            }
        }
        if model.object_visibility().instances {
            for instance in
                matching_instances_for_cell_view(db, query, cell_view, policy, self.settings)
            {
                let candidate = pick_hit_for_instance(instance);
                maybe_replace_pick_hit(&mut best, candidate, request.x, request.y);
            }
        }
        best
    }
}

fn far_hierarchy_coalesce_budget(viewport: Viewport, settings: RenderSettings) -> usize {
    if settings.max_render_items == 0 {
        return 0;
    }
    let bin_px = (settings.occupancy_bin_px * 2.0).max(settings.frame_only_px.max(1.0));
    let cols = (viewport.screen_width.max(1.0) / bin_px).ceil().max(1.0) as usize;
    let rows = (viewport.screen_height.max(1.0) / bin_px).ceil().max(1.0) as usize;
    let per_bin = settings.max_markers_per_bin.max(1);
    cols.saturating_mul(rows)
        .saturating_mul(per_bin)
        .max(1)
        .min(settings.max_render_items)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LodDecision {
    Exact,
    FrameOnly,
    Marker,
    HierarchyBBox,
    ArrayBBox,
    ArrayGrid,
    Coarse,
    Suppress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HierarchyLodMode {
    FarBBox,
    MidCoarse,
    NearExpand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TopLevelContextMode {
    AllVisibleShapes,
    StableContextOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CacheKeyMode {
    LegacySource,
    CellViewAware,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrayLodDecision {
    BBox,
    Grid,
    ViewportElements,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct FarHierarchyEntry {
    bbox: Rect,
    source_id: u32,
    depth: usize,
    projected_size_px: (f32, f32),
    decision: ArrayLodDecision,
}

#[derive(Default)]
struct CellDisplayProxyCache {
    proxies: HashMap<CellId, CellDisplayProxy>,
}

#[derive(Debug, Clone)]
struct CellDisplayProxy {
    bbox: Rect,
    layer_density_bins: Vec<LayerDensityBin>,
    representative_shapes: Vec<RepresentativeShape>,
    child_instance_summaries: Vec<ChildInstanceSummary>,
    array_summary: Option<ArraySummary>,
}

#[derive(Debug, Clone, Copy)]
struct LayerDensityBin {
    layer_id: u16,
    bbox: Rect,
    shape_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct RepresentativeShape {
    bbox: Rect,
    source_id: u32,
    layer_id: u16,
}

#[derive(Debug, Clone, Copy)]
struct ChildInstanceSummary {
    bbox: Rect,
    source_id: u32,
}

#[derive(Debug, Clone, Copy)]
struct ArraySummary {
    bbox: Rect,
    columns: u32,
    rows: u32,
}

impl CellDisplayProxy {
    fn empty() -> Self {
        Self {
            bbox: Rect::new(0, 0, 0, 0),
            layer_density_bins: Vec::new(),
            representative_shapes: Vec::new(),
            child_instance_summaries: Vec::new(),
            array_summary: None,
        }
    }
}

impl CellDisplayProxyCache {
    fn proxy_for(&mut self, db: &LayoutDb, cell: CellId) -> (&CellDisplayProxy, bool) {
        let hit = self.proxies.contains_key(&cell);
        if !hit {
            let proxy = build_cell_display_proxy(db, cell);
            self.proxies.insert(cell, proxy);
        }
        (self.proxies.get(&cell).expect("proxy inserted"), hit)
    }
}

fn build_cell_display_proxy(db: &LayoutDb, cell_id: CellId) -> CellDisplayProxy {
    let Some(cell) = db.cell(cell_id) else {
        return CellDisplayProxy::empty();
    };
    let bbox = cell.bbox();
    let mut density_by_layer: HashMap<u16, LayerDensityBin> = HashMap::new();
    for shape in cell.shapes() {
        density_by_layer
            .entry(shape.layer_id)
            .and_modify(|bin| {
                bin.bbox = union_rect(bin.bbox, shape.bbox);
                bin.shape_count += 1;
            })
            .or_insert(LayerDensityBin {
                layer_id: shape.layer_id,
                bbox: shape.bbox,
                shape_count: 1,
            });
    }
    let mut layer_density_bins = density_by_layer.into_values().collect::<Vec<_>>();
    layer_density_bins.sort_by_key(|bin| (bin.layer_id, bin.bbox.y1, bin.bbox.x1));

    let representative_shapes =
        select_representative_shapes(cell.shapes(), layer_density_bins.len().max(1) * 4);

    let mut child_instance_summaries = cell
        .instances()
        .iter()
        .map(|instance| ChildInstanceSummary {
            bbox: instance.bbox,
            source_id: instance.source_id,
        })
        .collect::<Vec<_>>();
    child_instance_summaries.sort_by_key(|summary| {
        (
            summary.bbox.y1,
            summary.bbox.x1,
            summary.bbox.height(),
            summary.bbox.width(),
            summary.source_id,
        )
    });

    let array_summary = summarize_arrays(cell.instances());

    CellDisplayProxy {
        bbox,
        layer_density_bins,
        representative_shapes,
        child_instance_summaries,
        array_summary,
    }
}

fn union_rect(a: Rect, b: Rect) -> Rect {
    Rect::new(
        a.x1.min(b.x1),
        a.y1.min(b.y1),
        a.x2.max(b.x2),
        a.y2.max(b.y2),
    )
}

fn density_color(layer_id: u16, shape_count: usize) -> Color {
    let base = match layer_id % 4 {
        0 => Color::rgb(116, 154, 255),
        1 => Color::rgb(84, 211, 154),
        2 => Color::rgb(255, 132, 92),
        _ => Color::rgb(255, 228, 138),
    };
    let boost = (shape_count as f32).ln_1p().min(4.0) / 12.0;
    base.shift_brightness(boost)
}

fn select_representative_shapes(
    shapes: &[ShapeRecord],
    max_shapes: usize,
) -> Vec<RepresentativeShape> {
    if max_shapes == 0 || shapes.is_empty() {
        return Vec::new();
    }
    let mut ranked = shapes
        .iter()
        .map(|shape| {
            (
                representative_shape_rank(shape),
                RepresentativeShape {
                    bbox: shape.bbox,
                    source_id: shape.source_id,
                    layer_id: shape.layer_id,
                },
            )
        })
        .collect::<Vec<_>>();
    ranked.sort_by_key(|(rank, _)| *rank);
    ranked
        .into_iter()
        .take(max_shapes)
        .map(|(_, shape)| shape)
        .collect()
}

fn representative_shape_rank(shape: &ShapeRecord) -> (u16, i64, i32, i32, u32) {
    (
        shape.layer_id,
        -hierarchy_entry_area(shape.bbox),
        shape.bbox.y1,
        shape.bbox.x1,
        shape.source_id,
    )
}

fn summarize_arrays(instances: &[layoutdb::CellInstance]) -> Option<ArraySummary> {
    let mut summary: Option<ArraySummary> = None;
    for instance in instances {
        let columns = instance.array.columns.max(1);
        let rows = instance.array.rows.max(1);
        if columns == 1 && rows == 1 {
            continue;
        }
        summary = Some(match summary {
            Some(existing) => ArraySummary {
                bbox: union_rect(existing.bbox, instance.bbox),
                columns: existing.columns.saturating_add(columns),
                rows: existing.rows.max(rows),
            },
            None => ArraySummary {
                bbox: instance.bbox,
                columns,
                rows,
            },
        });
    }
    summary
}

fn cell_has_instances(db: &LayoutDb, cell: CellId) -> bool {
    db.cell(cell)
        .map(|cell| !cell.instances().is_empty())
        .unwrap_or(false)
}

fn is_top_cell_view(db: &LayoutDb, cell_view: &CellViewState) -> bool {
    cell_view.context_cell() == db.top_cell()
        && cell_view.target_cell() == db.top_cell()
        && cell_view.specific_path().is_empty()
}

fn max_depth_for_query(settings: RenderSettings, policy: &HierarchyPolicy) -> usize {
    settings.hierarchy_expand_depth.min(policy.max_depth)
}

fn min_depth_for_query(policy: &HierarchyPolicy) -> usize {
    policy.min_depth
}

#[derive(Debug, Clone, Copy)]
enum HierarchyInstanceRef<'a> {
    Legacy(&'a HierarchyInstanceRecord),
    CellView(&'a CellViewInstanceRecord),
}

impl HierarchyInstanceRef<'_> {
    fn bbox(self) -> Rect {
        match self {
            Self::Legacy(instance) => instance.bbox,
            Self::CellView(instance) => instance.bbox,
        }
    }

    fn array_bbox(self) -> Rect {
        match self {
            Self::Legacy(instance) => instance.array_bbox,
            Self::CellView(instance) => instance.array_bbox,
        }
    }

    fn source_id(self) -> u32 {
        match self {
            Self::Legacy(instance) => instance.source_id,
            Self::CellView(instance) => instance.source_id,
        }
    }

    fn instance_id(self) -> u32 {
        match self {
            Self::Legacy(instance) => instance.instance_id,
            Self::CellView(instance) => instance.instance_id,
        }
    }

    fn array_columns(self) -> u32 {
        match self {
            Self::Legacy(instance) => instance.array_columns,
            Self::CellView(instance) => instance.array_columns,
        }
    }

    fn array_rows(self) -> u32 {
        match self {
            Self::Legacy(instance) => instance.array_rows,
            Self::CellView(instance) => instance.array_rows,
        }
    }
}

impl<'a> From<&'a HierarchyInstanceRecord> for HierarchyInstanceRef<'a> {
    fn from(instance: &'a HierarchyInstanceRecord) -> Self {
        Self::Legacy(instance)
    }
}

impl<'a> From<&'a CellViewInstanceRecord> for HierarchyInstanceRef<'a> {
    fn from(instance: &'a CellViewInstanceRecord) -> Self {
        Self::CellView(instance)
    }
}

fn is_array_instance<'a>(instance: impl Into<HierarchyInstanceRef<'a>>) -> bool {
    let instance = instance.into();
    instance.array_columns() > 1 || instance.array_rows() > 1
}

fn far_hierarchy_entries(
    instances: Vec<CellViewInstanceRecord>,
    viewport: Viewport,
    rendered_arrays: &mut HashSet<(u32, u32)>,
    planner: &RenderPlanner,
) -> Vec<FarHierarchyEntry> {
    instances
        .into_iter()
        .filter_map(|instance| {
            let instance_ref = HierarchyInstanceRef::from(&instance);
            let decision = planner.array_lod_decision(instance_ref, viewport);
            if is_array_instance(instance_ref)
                && !rendered_arrays.insert((instance_ref.source_id(), instance_ref.instance_id()))
            {
                return None;
            }
            Some(FarHierarchyEntry {
                bbox: hierarchy_bbox_for_decision(instance_ref, decision),
                source_id: instance_ref.source_id(),
                depth: instance.depth,
                projected_size_px: viewport
                    .projected_size_px(hierarchy_bbox_for_decision(instance_ref, decision)),
                decision,
            })
        })
        .collect()
}

fn thin_hierarchy_entries(
    viewport: Viewport,
    settings: RenderSettings,
    max_items: usize,
    entries: Vec<FarHierarchyEntry>,
) -> Vec<FarHierarchyEntry> {
    if max_items == 0 || entries.is_empty() {
        return Vec::new();
    }
    if entries.len() <= max_items {
        return entries;
    }
    let mut bin_units = proxy_bin_units(viewport, settings);
    loop {
        let thinned =
            thin_hierarchy_entries_once(bin_units, settings.max_markers_per_bin.max(1), &entries);
        if thinned.len() <= max_items {
            return thinned;
        }
        if bin_units > viewport.world.width().max(viewport.world.height()).max(1) * 2 {
            return sample_hierarchy_entries(&entries, max_items);
        }
        bin_units = bin_units.saturating_mul(2).max(bin_units + 1);
    }
}

fn thin_hierarchy_entries_once(
    bin_units: i32,
    per_bin: usize,
    entries: &[FarHierarchyEntry],
) -> Vec<FarHierarchyEntry> {
    let mut bins: HashMap<(usize, i32, i32), Vec<FarHierarchyEntry>> = HashMap::new();
    for entry in entries.iter().copied() {
        let key = hierarchy_world_bin_key(bin_units, entry);
        let bucket = bins.entry(key).or_default();
        bucket.push(entry);
        bucket.sort_by_key(hierarchy_entry_priority_key);
        bucket.truncate(per_bin);
    }
    let mut values = bins.into_values().flatten().collect::<Vec<_>>();
    values.sort_by_key(hierarchy_entry_sort_key);
    values
}

fn proxy_bin_units(viewport: Viewport, settings: RenderSettings) -> i32 {
    let units = viewport
        .units_per_pixel_x()
        .max(viewport.units_per_pixel_y())
        * settings.occupancy_bin_px.max(1.0);
    units.round().max(1.0) as i32
}

fn hierarchy_world_bin_key(bin_units: i32, entry: FarHierarchyEntry) -> (usize, i32, i32) {
    let bin_units = bin_units.max(1);
    let bbox = entry.bbox;
    let cx = (bbox.x1 as f32 + bbox.x2 as f32) * 0.5;
    let cy = (bbox.y1 as f32 + bbox.y2 as f32) * 0.5;
    (
        entry.depth,
        (cx as i32).div_euclid(bin_units),
        (cy as i32).div_euclid(bin_units),
    )
}

fn sample_hierarchy_entries(
    entries: &[FarHierarchyEntry],
    max_items: usize,
) -> Vec<FarHierarchyEntry> {
    if max_items == 0 || entries.is_empty() {
        return Vec::new();
    }
    if entries.len() <= max_items {
        return entries.to_vec();
    }
    let step = entries.len() as f64 / max_items as f64;
    let mut sampled = Vec::with_capacity(max_items);
    for index in 0..max_items {
        let source_index = (index as f64 * step).floor() as usize;
        sampled.push(entries[source_index.min(entries.len() - 1)]);
    }
    sampled
}

fn hierarchy_entry_area(bbox: Rect) -> i64 {
    i64::from(bbox.width().max(1)) * i64::from(bbox.height().max(1))
}

fn hierarchy_entry_priority_key(entry: &FarHierarchyEntry) -> (usize, i64, i32, i32, u32) {
    (
        usize::MAX - entry.depth,
        hierarchy_entry_area(entry.bbox),
        entry.bbox.y1,
        entry.bbox.x1,
        entry.source_id,
    )
}

fn hierarchy_entry_sort_key(entry: &FarHierarchyEntry) -> (usize, i32, i32, u32) {
    (entry.depth, entry.bbox.y1, entry.bbox.x1, entry.source_id)
}

fn hierarchy_bbox_for_decision(
    instance: HierarchyInstanceRef<'_>,
    decision: ArrayLodDecision,
) -> Rect {
    match decision {
        ArrayLodDecision::BBox | ArrayLodDecision::Grid => instance.array_bbox(),
        ArrayLodDecision::ViewportElements => instance.bbox(),
    }
}

fn map_template_rect_to_instance(rect: Rect, template_bbox: Rect, instance_bbox: Rect) -> Rect {
    let template_width = i64::from(template_bbox.width().max(1));
    let template_height = i64::from(template_bbox.height().max(1));
    let instance_width = i64::from(instance_bbox.width().max(1));
    let instance_height = i64::from(instance_bbox.height().max(1));
    let map_x = |x: i32| {
        let local = i64::from(x - template_bbox.x1);
        (i64::from(instance_bbox.x1) + local * instance_width / template_width)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
    };
    let map_y = |y: i32| {
        let local = i64::from(y - template_bbox.y1);
        (i64::from(instance_bbox.y1) + local * instance_height / template_height)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
    };
    Rect::new(
        map_x(rect.x1),
        map_y(rect.y1),
        map_x(rect.x2),
        map_y(rect.y2),
    )
}

fn push_hierarchy_rect(
    plan: &mut RenderPlan,
    instance: HierarchyInstanceRef<'_>,
    bbox: Rect,
    max_items: usize,
    object_visibility: ObjectVisibility,
) {
    let layer = hierarchy_display_layer(object_visibility);
    push_item(
        plan,
        RenderPlane::Hierarchy,
        &layer,
        DrawItem::Rect(DrawRect {
            world: bbox,
            color: Color::rgb(168, 190, 210),
            source_id: instance.source_id(),
            layer_id: 0,
            composition: CompositionMode::MaskPattern,
        }),
        max_items,
    );
}

fn layer_matches_shape(layer: &ResolvedDisplayLayer, shape: &ShapeRecord) -> bool {
    if !layer.object_visibility.includes_shape_kind(shape.kind) {
        return false;
    }
    match layer.source {
        SourceSelector::PhysicalLayer(layer_id) => {
            shape.layer_id == layer_id && !is_context_shape(shape.kind)
        }
        SourceSelector::ShapeKind(kind) => shape.kind == kind,
        SourceSelector::CellFrame | SourceSelector::SelectionOverlay => false,
    }
}

fn layer_matches_overview_bin(layer: &ResolvedDisplayLayer, bin: &OverviewDensityBin) -> bool {
    if !layer.object_visibility.includes_shape_kind(bin.kind) {
        return false;
    }
    match layer.source {
        SourceSelector::PhysicalLayer(layer_id) => {
            bin.layer_id == layer_id && overview_kind_matches_physical_layer(bin.kind)
        }
        SourceSelector::ShapeKind(kind) => bin.kind == kind,
        SourceSelector::CellFrame | SourceSelector::SelectionOverlay => false,
    }
}

fn overview_kind_matches_physical_layer(kind: ShapeKind) -> bool {
    matches!(
        kind,
        ShapeKind::RegularWire
            | ShapeKind::SpecialWire
            | ShapeKind::Via
            | ShapeKind::IoPin
            | ShapeKind::Blockage
            | ShapeKind::Fill
    )
}

#[derive(Default)]
struct VisibleShapeSources {
    physical_layers: HashSet<u16>,
    shape_kinds: HashSet<ShapeKind>,
    object_visibility: ObjectVisibility,
}

impl VisibleShapeSources {
    fn from_layers(layers: &[ResolvedDisplayLayer]) -> Self {
        let mut visible = Self::default();
        if let Some(layer) = layers.first() {
            visible.object_visibility = layer.object_visibility;
        }
        for layer in layers {
            match layer.source {
                SourceSelector::PhysicalLayer(layer_id) => {
                    visible.physical_layers.insert(layer_id);
                }
                SourceSelector::ShapeKind(kind) => {
                    visible.shape_kinds.insert(kind);
                }
                SourceSelector::CellFrame | SourceSelector::SelectionOverlay => {}
            }
        }
        visible
    }

    fn matches(&self, layer_id: u16, kind: ShapeKind) -> bool {
        self.object_visibility.includes_shape_kind(kind)
            && ((self.physical_layers.contains(&layer_id)
                && overview_kind_matches_physical_layer(kind))
                || self.shape_kinds.contains(&kind))
    }

    fn is_empty(&self) -> bool {
        self.physical_layers.is_empty() && self.shape_kinds.is_empty()
    }
}

fn matching_shape_records_for_cell_view(
    db: &LayoutDb,
    layer: &ResolvedDisplayLayer,
    viewport: Rect,
    cell_view: &CellViewState,
    policy: &HierarchyPolicy,
) -> Vec<CellViewShapeRecord> {
    db.query_cell_view_shapes(CellViewShapeQuery {
        cell_view: cell_view.clone(),
        viewport,
        min_depth: policy.min_depth,
        max_depth: policy.max_depth,
        layer_ids: Vec::new(),
        include_kinds: Vec::new(),
        policy: policy.clone(),
    })
    .shapes
    .into_iter()
    .filter(|shape| {
        layer_matches_shape(
            layer,
            &ShapeRecord::new(shape.bbox, shape.layer_id, shape.kind, shape.source_id),
        )
    })
    .collect()
}

fn matching_instances_for_cell_view(
    db: &LayoutDb,
    viewport: Rect,
    cell_view: &CellViewState,
    policy: &HierarchyPolicy,
    settings: RenderSettings,
) -> Vec<CellViewInstanceRecord> {
    db.query_cell_view_instances(CellViewInstanceQuery {
        cell_view: cell_view.clone(),
        viewport,
        min_depth: min_depth_for_query(policy).max(1),
        max_depth: max_depth_for_query(settings, policy),
        expand_arrays: policy.expand_arrays,
        policy: policy.clone(),
    })
    .instances
}

fn pick_hit_for_shape(display_layer_id: &str, shape: &CellViewShapeRecord) -> PickHit {
    PickHit {
        display_layer_id: display_layer_id.to_string(),
        source_id: shape.source_id,
        layer_id: shape.layer_id,
        kind: shape.kind,
        bbox: shape.bbox,
        cell: shape.cell,
        depth: shape.depth,
        instance_path: shape.instance_path.clone(),
        object_path: shape.object_path.clone(),
        target: PickHitTarget::Shape,
    }
}

fn pick_hit_for_instance(instance: CellViewInstanceRecord) -> PickHit {
    PickHit {
        display_layer_id: "hierarchy:cell_bbox".to_string(),
        source_id: instance.source_id,
        layer_id: 0,
        kind: ShapeKind::Instance,
        bbox: instance.bbox,
        cell: instance.cell,
        depth: instance.depth,
        instance_path: instance.instance_path,
        object_path: instance.object_path,
        target: PickHitTarget::Instance {
            parent_cell: instance.cell,
            child_cell: instance.child_cell,
            instance_id: instance.instance_id,
            array_column: instance.array_column,
            array_row: instance.array_row,
        },
    }
}

fn maybe_replace_pick_hit(best: &mut Option<PickHit>, candidate: PickHit, x: i32, y: i32) {
    let replace = best
        .as_ref()
        .map(|current| pick_rank(&candidate, x, y) < pick_rank(current, x, y))
        .unwrap_or(true);
    if replace {
        *best = Some(candidate);
    }
}

fn push_rect_batch(
    plan: &mut RenderPlan,
    plane: RenderPlane,
    layer: &ResolvedDisplayLayer,
    shape: &ShapeRecord,
    max_items: usize,
) {
    let color = match plane {
        RenderPlane::Fill => layer.style.fill_color,
        RenderPlane::Frame => layer.style.frame_color,
        _ => layer.style.marker_color,
    };
    let item = DrawItem::Rect(DrawRect {
        world: shape.bbox,
        color,
        source_id: shape.source_id,
        layer_id: shape.layer_id,
        composition: layer.style.composition_mode,
    });
    push_item(plan, plane, layer, item, max_items);
}

fn push_marker_batch(
    plan: &mut RenderPlan,
    layer: &ResolvedDisplayLayer,
    shape: &ShapeRecord,
    max_items: usize,
) {
    let item = DrawItem::Marker(DrawMarker {
        world: shape.bbox,
        color: layer.style.marker_color,
        source_id: shape.source_id,
        layer_id: shape.layer_id,
    });
    push_item(plan, RenderPlane::Marker, layer, item, max_items);
}

fn hierarchy_display_layer(object_visibility: ObjectVisibility) -> ResolvedDisplayLayer {
    let mut style = LayerStyle::new(Color::rgb(80, 96, 112), Color::rgb(168, 190, 210));
    style.fill_alpha = 0;
    style.frame_alpha = 190;
    style.marker_alpha = 190;
    style.fill_pattern = Pattern::Hollow;
    style.composition_mode = CompositionMode::MaskPattern;
    ResolvedDisplayLayer {
        id: "hierarchy:cell_bbox".to_string(),
        name: "Cell BBox".to_string(),
        source: SourceSelector::CellFrame,
        object_visibility,
        draw_order: -10_000,
        style,
        pickable: false,
    }
}

fn push_item(
    plan: &mut RenderPlan,
    plane: RenderPlane,
    layer: &ResolvedDisplayLayer,
    item: DrawItem,
    max_items: usize,
) {
    if plan_item_count(plan) >= max_items {
        plan.truncated = true;
        return;
    }
    if let Some(batch) = plan
        .batches
        .iter_mut()
        .find(|batch| batch.plane == plane && batch.display_layer_id == layer.id)
    {
        batch.items.push(item);
        return;
    }
    plan.batches.push(DrawBatch {
        plane,
        display_layer_id: layer.id.clone(),
        style: layer.style.clone(),
        items: vec![item],
    });
}

fn plan_item_count(plan: &RenderPlan) -> usize {
    plan.batches.iter().map(|batch| batch.items.len()).sum()
}

fn append_plan(plan: &mut RenderPlan, other: RenderPlan, max_items: usize) {
    plan.query_stats.viewport_queries += other.query_stats.viewport_queries;
    plan.query_stats.candidates_checked += other.query_stats.candidates_checked;
    plan.query_stats.total_shapes_in_cell += other.query_stats.total_shapes_in_cell;
    plan.query_stats.hierarchy_instance_candidates_checked +=
        other.query_stats.hierarchy_instance_candidates_checked;
    plan.query_stats.total_hierarchy_instances += other.query_stats.total_hierarchy_instances;
    plan.query_stats.display_cache_hits += other.query_stats.display_cache_hits;
    plan.query_stats.display_cache_misses += other.query_stats.display_cache_misses;
    plan.query_stats.cached_template_items += other.query_stats.cached_template_items;
    plan.query_stats.proxy_density_bins += other.query_stats.proxy_density_bins;
    plan.query_stats.proxy_representative_shapes += other.query_stats.proxy_representative_shapes;
    plan.query_stats.proxy_child_summaries += other.query_stats.proxy_child_summaries;
    plan.query_stats.compact_array_elements_checked +=
        other.query_stats.compact_array_elements_checked;
    plan.lod_stats.exact += other.lod_stats.exact;
    plan.lod_stats.frame_only += other.lod_stats.frame_only;
    plan.lod_stats.marker += other.lod_stats.marker;
    plan.lod_stats.hierarchy_bbox += other.lod_stats.hierarchy_bbox;
    plan.lod_stats.array_bbox += other.lod_stats.array_bbox;
    plan.lod_stats.array_grid += other.lod_stats.array_grid;
    plan.lod_stats.coarse += other.lod_stats.coarse;
    plan.lod_stats.suppress += other.lod_stats.suppress;
    plan.truncated |= other.truncated;
    for batch in other.batches {
        let layer = ResolvedDisplayLayer {
            id: batch.display_layer_id.clone(),
            name: batch.display_layer_id.clone(),
            source: SourceSelector::SelectionOverlay,
            object_visibility: ObjectVisibility::default(),
            draw_order: 0,
            style: batch.style.clone(),
            pickable: false,
        };
        for item in batch.items {
            push_item(plan, batch.plane, &layer, item, max_items);
        }
    }
}

fn pick_rank(hit: &PickHit, x: i32, y: i32) -> (i64, i64, i64) {
    let width = hit.bbox.width().max(1) as i64;
    let height = hit.bbox.height().max(1) as i64;
    let area = width * height;
    let cx2 = hit.bbox.x1 as i64 + hit.bbox.x2 as i64;
    let cy2 = hit.bbox.y1 as i64 + hit.bbox.y2 as i64;
    let dx2 = cx2 - x as i64 * 2;
    let dy2 = cy2 - y as i64 * 2;
    let instance_penalty = if matches!(hit.target, PickHitTarget::Instance { .. }) {
        1
    } else {
        0
    };
    (
        dx2 * dx2 + dy2 * dy2 + instance_penalty,
        area,
        hit.depth as i64,
    )
}

fn render_cache_key(
    viewport: Viewport,
    layers: &[ResolvedDisplayLayer],
    settings: RenderSettings,
) -> RenderCacheKey {
    let mut hash = Fnv64::new();
    hash.write_i32(viewport.world.x1);
    hash.write_i32(viewport.world.y1);
    hash.write_i32(viewport.world.x2);
    hash.write_i32(viewport.world.y2);
    hash.write_u32(viewport.screen_width.round().max(0.0) as u32);
    hash.write_u32(viewport.screen_height.round().max(0.0) as u32);
    hash.write_u32(settings.small_shape_px.to_bits());
    hash.write_u32(settings.frame_only_px.to_bits());
    hash.write_u32(settings.fill_px.to_bits());
    hash.write_u32(settings.fill_units_per_pixel.to_bits());
    hash.write_u32(settings.long_shape_px.to_bits());
    hash.write_u32(settings.occupancy_bin_px.to_bits());
    hash.write_usize(settings.max_low_priority_quads_per_bin);
    hash.write_usize(settings.max_frames_per_bin);
    hash.write_usize(settings.max_markers_per_bin);
    hash.write_u32(settings.hierarchy_bbox_units_per_pixel.to_bits());
    hash.write_u32(settings.hierarchy_coarse_units_per_pixel.to_bits());
    hash.write_u32(settings.idle_detail_units_per_pixel.to_bits());
    hash.write_u32(settings.array_bbox_units_per_pixel.to_bits());
    hash.write_u32(settings.array_grid_units_per_pixel.to_bits());
    hash.write_usize(settings.hierarchy_expand_depth);
    hash.write_u8(u8::from(settings.force_interaction_coarse));
    hash.write_usize(settings.max_render_items);
    hash.write_u8(u8::from(settings.enable_cell_template_cache));
    hash.write_usize(layers.len());
    for layer in layers {
        hash.write_str(&layer.id);
        hash.write_i32(layer.draw_order);
        match layer.source {
            SourceSelector::PhysicalLayer(layer_id) => {
                hash.write_u8(1);
                hash.write_u16(layer_id);
            }
            SourceSelector::ShapeKind(kind) => {
                hash.write_u8(2);
                hash.write_u8(shape_kind_code(kind));
            }
            SourceSelector::CellFrame => hash.write_u8(3),
            SourceSelector::SelectionOverlay => hash.write_u8(4),
        }
        hash.write_u8(u8::from(layer.object_visibility.instances));
        hash.write_u8(u8::from(layer.object_visibility.pdn));
        hash.write_u8(u8::from(layer.object_visibility.net));
        hash.write_u8(layer.style.fill_color.r);
        hash.write_u8(layer.style.fill_color.g);
        hash.write_u8(layer.style.fill_color.b);
        hash.write_u8(layer.style.frame_color.r);
        hash.write_u8(layer.style.frame_color.g);
        hash.write_u8(layer.style.frame_color.b);
        hash.write_u8(layer.style.marker_color.r);
        hash.write_u8(layer.style.marker_color.g);
        hash.write_u8(layer.style.marker_color.b);
        hash.write_u8(layer.style.text_color.r);
        hash.write_u8(layer.style.text_color.g);
        hash.write_u8(layer.style.text_color.b);
        hash.write_u8(layer.style.fill_alpha);
        hash.write_u8(layer.style.frame_alpha);
        hash.write_u8(layer.style.marker_alpha);
        hash.write_u8(pattern_code(layer.style.fill_pattern));
        hash.write_u8(line_style_code(layer.style.line_style));
        hash.write_u8(layer.style.line_width_px);
        hash.write_u8(composition_code(layer.style.composition_mode));
        hash.write_u8(layer.style.brightness_shift_steps as u8);
        hash.write_u8(u8::from(layer.style.marked));
    }
    RenderCacheKey(hash.finish())
}

fn render_cache_key_with_source(
    viewport: Viewport,
    layers: &[ResolvedDisplayLayer],
    settings: RenderSettings,
    source: RenderPlanSource,
) -> RenderCacheKey {
    let mut hash = Fnv64(render_cache_key(viewport, layers, settings).value());
    hash.write_u8(render_plan_source_code(source));
    RenderCacheKey(hash.finish())
}

fn render_cache_key_for_cell_view(
    viewport: Viewport,
    layers: &[ResolvedDisplayLayer],
    settings: RenderSettings,
    source: RenderPlanSource,
    cell_view: &CellViewState,
    policy: &HierarchyPolicy,
) -> RenderCacheKey {
    let mut hash = Fnv64(render_cache_key_with_source(viewport, layers, settings, source).value());
    hash.write_usize(cell_view.context_cell().raw());
    hash.write_usize(cell_view.target_cell().raw());
    hash.write_usize(cell_view.specific_path().elements().len());
    for element in cell_view.specific_path().elements() {
        hash.write_usize(element.parent_cell.raw());
        hash.write_u32(element.instance_id);
        hash.write_u32(element.source_id);
        hash.write_usize(element.child_cell.raw());
        hash.write_u32(element.array_column);
        hash.write_u32(element.array_row);
        hash.write_i32(element.bbox.x1);
        hash.write_i32(element.bbox.y1);
        hash.write_i32(element.bbox.x2);
        hash.write_i32(element.bbox.y2);
    }
    hash.write_usize(policy.min_depth);
    hash.write_usize(policy.max_depth);
    hash.write_u8(u8::from(policy.expand_arrays));
    hash_cell_set(&mut hash, &policy.hidden_cells);
    hash_cell_set(&mut hash, &policy.selected_cells);
    hash_cell_set(&mut hash, &policy.ghost_cells);
    RenderCacheKey(hash.finish())
}

fn hash_cell_set(hash: &mut Fnv64, cells: &HashSet<CellId>) {
    let mut raw_ids = cells.iter().map(|cell| cell.raw()).collect::<Vec<_>>();
    raw_ids.sort_unstable();
    hash.write_usize(raw_ids.len());
    for raw in raw_ids {
        hash.write_usize(raw);
    }
}

fn render_plan_source_code(source: RenderPlanSource) -> u8 {
    match source {
        RenderPlanSource::FlatDetail => 1,
        RenderPlanSource::HierarchyFar => 2,
        RenderPlanSource::HierarchyMid => 3,
        RenderPlanSource::HierarchyNear => 4,
        RenderPlanSource::OverviewDensity => 5,
    }
}

fn pattern_code(pattern: Pattern) -> u8 {
    match pattern {
        Pattern::Solid => 1,
        Pattern::Hollow => 2,
        Pattern::SparseDots => 3,
        Pattern::DiagonalHatch => 4,
        Pattern::CrossHatch => 5,
    }
}

fn line_style_code(style: LineStyle) -> u8 {
    match style {
        LineStyle::Solid => 1,
        LineStyle::Dashed => 2,
        LineStyle::Dotted => 3,
    }
}

fn composition_code(mode: CompositionMode) -> u8 {
    match mode {
        CompositionMode::Copy => 1,
        CompositionMode::AdditiveOr => 2,
        CompositionMode::SubtractiveAnd => 3,
        CompositionMode::Alpha => 4,
        CompositionMode::MaskPattern => 5,
    }
}

#[derive(Debug)]
struct ScreenOccupancy {
    viewport: Viewport,
    settings: RenderSettings,
    low_priority_bins: HashMap<(i32, i32), usize>,
    frame_bins: HashMap<(String, i32, i32), usize>,
    marker_bins: HashMap<(String, i32, i32), usize>,
}

impl ScreenOccupancy {
    fn new(viewport: Viewport, settings: RenderSettings) -> Self {
        Self {
            viewport,
            settings,
            low_priority_bins: HashMap::new(),
            frame_bins: HashMap::new(),
            marker_bins: HashMap::new(),
        }
    }

    fn reserve_frame(&mut self, layer: &ResolvedDisplayLayer, shape: &ShapeRecord) -> bool {
        if is_context_shape(shape.kind) {
            return true;
        }
        let key = self.bin_key(layer, shape);
        if self.low_priority_quad_count(shape) >= self.settings.max_low_priority_quads_per_bin {
            return false;
        }
        if self.frame_count(&key) >= self.settings.max_frames_per_bin {
            return false;
        }
        self.reserve_low_priority_quad(shape);
        *self.frame_bins.entry(key).or_insert(0) += 1;
        true
    }

    fn reserve_marker(&mut self, layer: &ResolvedDisplayLayer, shape: &ShapeRecord) -> bool {
        if is_context_shape(shape.kind) {
            return true;
        }
        let key = self.bin_key(layer, shape);
        if self.low_priority_quad_count(shape) >= self.settings.max_low_priority_quads_per_bin {
            return false;
        }
        if self.marker_count(&key) >= self.settings.max_markers_per_bin {
            return false;
        }
        self.reserve_low_priority_quad(shape);
        *self.marker_bins.entry(key).or_insert(0) += 1;
        true
    }

    fn reserve_low_priority_quad(&mut self, shape: &ShapeRecord) {
        let (_, x, y) = self.bin_key_parts(shape);
        let count = self.low_priority_bins.entry((x, y)).or_insert(0);
        *count += 1;
    }

    fn low_priority_quad_count(&self, shape: &ShapeRecord) -> usize {
        let (_, x, y) = self.bin_key_parts(shape);
        self.low_priority_bins.get(&(x, y)).copied().unwrap_or(0)
    }

    fn frame_count(&self, key: &(String, i32, i32)) -> usize {
        self.frame_bins.get(key).copied().unwrap_or(0)
    }

    fn marker_count(&self, key: &(String, i32, i32)) -> usize {
        self.marker_bins.get(key).copied().unwrap_or(0)
    }

    fn bin_key(&self, layer: &ResolvedDisplayLayer, shape: &ShapeRecord) -> (String, i32, i32) {
        let (_, x, y) = self.bin_key_parts(shape);
        (layer.id.clone(), x, y)
    }

    fn bin_key_parts(&self, shape: &ShapeRecord) -> ((), i32, i32) {
        let cx = (shape.bbox.x1 as f32 + shape.bbox.x2 as f32) * 0.5;
        let cy = (shape.bbox.y1 as f32 + shape.bbox.y2 as f32) * 0.5;
        let sx = (cx - self.viewport.world.x1 as f32) / self.viewport.units_per_pixel_x();
        let sy = (cy - self.viewport.world.y1 as f32) / self.viewport.units_per_pixel_y();
        let bin_px = self.settings.occupancy_bin_px.max(1.0);
        (
            (),
            (sx / bin_px).floor() as i32,
            (sy / bin_px).floor() as i32,
        )
    }
}

fn is_context_shape(kind: ShapeKind) -> bool {
    matches!(
        kind,
        ShapeKind::Die | ShapeKind::Core | ShapeKind::Instance | ShapeKind::Region
    )
}

fn is_stable_far_context_shape(shape: &ShapeRecord) -> bool {
    matches!(shape.kind, ShapeKind::Die | ShapeKind::Core)
        || (shape.flags & SHAPE_FLAG_TOP_LEVEL_CONTEXT != 0
            && matches!(
                shape.kind,
                ShapeKind::RegularWire | ShapeKind::SpecialWire | ShapeKind::Via
            ))
}

fn is_wire_shape(kind: ShapeKind) -> bool {
    matches!(kind, ShapeKind::RegularWire | ShapeKind::SpecialWire)
}

fn wire_frame_threshold_px(settings: RenderSettings) -> f32 {
    settings
        .frame_only_px
        .min(settings.long_shape_px)
        .max(settings.small_shape_px)
}

fn shape_kind_code(kind: ShapeKind) -> u8 {
    match kind {
        ShapeKind::Die => 1,
        ShapeKind::Core => 2,
        ShapeKind::Instance => 3,
        ShapeKind::RegularWire => 4,
        ShapeKind::SpecialWire => 5,
        ShapeKind::Via => 6,
        ShapeKind::IoPin => 7,
        ShapeKind::Blockage => 8,
        ShapeKind::Fill => 9,
        ShapeKind::Region => 10,
        ShapeKind::Row => 11,
        ShapeKind::Track => 12,
        ShapeKind::GCellGrid => 13,
    }
}

struct Fnv64(u64);

impl Fnv64 {
    fn new() -> Self {
        Self(0xcbf29ce484222325)
    }

    fn finish(self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }

    fn write_str(&mut self, value: &str) {
        self.write_usize(value.len());
        self.write(value.as_bytes());
    }

    fn write_i32(&mut self, value: i32) {
        self.write(&value.to_le_bytes());
    }

    fn write_u32(&mut self, value: u32) {
        self.write(&value.to_le_bytes());
    }

    fn write_u16(&mut self, value: u16) {
        self.write(&value.to_le_bytes());
    }

    fn write_u8(&mut self, value: u8) {
        self.write(&[value]);
    }

    fn write_usize(&mut self, value: usize) {
        self.write(&value.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use layout_display::{DisplayLayer, DisplayModel, LayerStyle, Pattern};
    use layoutdb::{
        CellInstance, CellViewState, HierarchyPolicy, InstancePath, InstancePathElement, LayerInfo,
        LayoutDb, ObjectPathTarget, OverviewDensityBin, Rect, ShapeKind, ShapeRecord,
        SHAPE_FLAG_TOP_LEVEL_CONTEXT,
    };
    use layoutpkg_format::{CellArray, Orientation, Transform};

    use crate::{
        classify_lod, plan_item_count, DrawItem, LodHysteresisState, LodLevel, PickHitTarget,
        PickRequest, RenderPlanSource, RenderPlane, RenderPlanner, RenderSettings, Viewport,
    };

    fn one_shape_db(shape: Rect) -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(top, ShapeRecord::new(shape, 1, ShapeKind::RegularWire, 42));
        db
    }

    fn one_shape_db_with_kind(shape: Rect, kind: ShapeKind) -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(top, ShapeRecord::new(shape, 1, kind, 42));
        db
    }

    fn one_layer_display_model() -> DisplayModel {
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));
        model
    }

    fn overview_density_db(layer_id: u16) -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(layer_id, format!("M{layer_id}")));
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(1_000, 1_000, 2_000, 2_000),
            layer_id,
            kind: ShapeKind::RegularWire,
            count: 2_500,
            coverage_area: 500_000,
        }]);
        db
    }

    fn many_layer_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        db.add_layer(LayerInfo::new(2, "M2"));
        let top = db.top_cell();
        for i in 0..200 {
            let x = i * 20;
            db.add_shape(
                top,
                ShapeRecord::new(
                    Rect::new(x, x, x + 8, x + 8),
                    if i % 2 == 0 { 1 } else { 2 },
                    ShapeKind::RegularWire,
                    i as u32,
                ),
            );
        }
        db
    }

    fn hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(0, 0, 10_000, 10_000),
                1,
                ShapeKind::RegularWire,
                42,
            ),
        );
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 80));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::IoPin, 9),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 77,
                name: "u0".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1000,
                    dy: 2000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(1000, 2000, 1100, 2080),
                source_id: 77,
            },
        );
        db
    }

    fn hierarchy_db_with_context_shapes() -> LayoutDb {
        let mut db = hierarchy_db();
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(0, 0, 10_000, 10_000), 0, ShapeKind::Die, 10),
        );
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(1_000, 1_000, 9_000, 9_000),
                0,
                ShapeKind::Core,
                11,
            ),
        );
        db
    }

    fn nested_hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200, 200));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(2, 3, 8, 9), 1, ShapeKind::IoPin, 9),
        );
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "leaf0".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10, 20, 110, 120),
                source_id: 23,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_string(),
                child_cell: mid,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 200, 300, 400),
                source_id: 17,
            },
        );
        db
    }

    fn array_hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 100_000, 2_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 9),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 77,
                name: "array0".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 100,
                    rows: 1,
                    step_x: 100,
                    step_y: 0,
                },
                bbox: Rect::new(0, 0, 10_000, 20),
                source_id: 77,
            },
        );
        db
    }

    fn large_array_hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 9),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_big_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );
        db
    }

    fn repeated_cell_hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 9),
        );
        for i in 0..3 {
            let x = i * 200;
            db.add_instance(
                db.top_cell(),
                CellInstance {
                    id: i as u32,
                    name: format!("u{i}"),
                    child_cell: child,
                    transform: Transform {
                        dx: x,
                        dy: 0,
                        orient: Orientation::R0,
                    },
                    array: CellArray::default(),
                    bbox: Rect::new(x, 0, x + 100, 100),
                    source_id: i as u32,
                },
            );
        }
        db
    }

    fn proxy_rich_hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        db.add_layer(LayerInfo::new(2, "M2"));
        let child = db.add_cell("macro", Rect::new(0, 0, 200, 160));
        for i in 0..10 {
            db.add_shape(
                child,
                ShapeRecord::new(
                    Rect::new(10 + i * 12, 10, 18 + i * 12, 50),
                    1,
                    ShapeKind::RegularWire,
                    100 + i as u32,
                ),
            );
        }
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(20, 90, 180, 110), 2, ShapeKind::RegularWire, 220),
        );
        let grandchild = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            grandchild,
            ShapeRecord::new(Rect::new(2, 2, 8, 8), 1, ShapeKind::IoPin, 301),
        );
        db.add_instance(
            child,
            CellInstance {
                id: 33,
                name: "leaf0".to_string(),
                child_cell: grandchild,
                transform: Transform {
                    dx: 150,
                    dy: 120,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(150, 120, 170, 140),
                source_id: 330,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 77,
                name: "macro0".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1_000,
                    dy: 2_000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(1_000, 2_000, 1_200, 2_160),
                source_id: 77,
            },
        );
        db
    }

    fn empty_instance_hierarchy_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("empty_leaf", Rect::new(0, 0, 100, 80));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 88,
                name: "u_empty".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1200,
                    dy: 2400,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(1200, 2400, 1300, 2480),
                source_id: 88,
            },
        );
        db
    }

    fn overlapping_shape_and_instance_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1_000, 1_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(100, 100, 200, 200), 1, ShapeKind::RegularWire, 42),
        );
        let child = db.add_cell("empty_leaf", Rect::new(0, 0, 100, 100));
        db.add_instance(
            top,
            CellInstance {
                id: 99,
                name: "u_overlap".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 100,
                    dy: 100,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 100, 200, 200),
                source_id: 99,
            },
        );
        db
    }

    fn many_repeated_cell_hierarchy_db(count: usize) -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1_000_000, 1_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 100, 100), 1, ShapeKind::RegularWire, 9),
        );
        for i in 0..count {
            let x = i as i32 * 120;
            db.add_instance(
                db.top_cell(),
                CellInstance {
                    id: i as u32,
                    name: format!("u{i}"),
                    child_cell: child,
                    transform: Transform {
                        dx: x,
                        dy: 0,
                        orient: Orientation::R0,
                    },
                    array: CellArray::default(),
                    bbox: Rect::new(x, 0, x + 100, 100),
                    source_id: i as u32,
                },
            );
        }
        db
    }

    fn repeated_cell_grid_hierarchy_db(columns: usize, rows: usize) -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1_200_000, 900_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 100, 100), 1, ShapeKind::RegularWire, 9),
        );
        let mut id = 0_u32;
        for row in 0..rows {
            for column in 0..columns {
                let x = column as i32 * 12_000;
                let y = row as i32 * 12_000;
                db.add_instance(
                    db.top_cell(),
                    CellInstance {
                        id,
                        name: format!("u{row}_{column}"),
                        child_cell: child,
                        transform: Transform {
                            dx: x,
                            dy: y,
                            orient: Orientation::R0,
                        },
                        array: CellArray::default(),
                        bbox: Rect::new(x, y, x + 100, y + 100),
                        source_id: id,
                    },
                );
                id += 1;
            }
        }
        db
    }

    fn hierarchy_item_bboxes(plan: &crate::RenderPlan) -> Vec<(Rect, u32)> {
        plan.batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Hierarchy)
            .flat_map(|batch| batch.items.iter())
            .filter_map(|item| match item {
                DrawItem::Rect(rect) => Some((rect.world, rect.source_id)),
                DrawItem::Marker(marker) => Some((marker.world, marker.source_id)),
                DrawItem::Line(_) => None,
            })
            .collect()
    }

    fn hierarchy_item_bboxes_with_layers(plan: &crate::RenderPlan) -> Vec<(Rect, u32, u16)> {
        plan.batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Hierarchy)
            .flat_map(|batch| batch.items.iter())
            .filter_map(|item| match item {
                DrawItem::Rect(rect) => Some((rect.world, rect.source_id, rect.layer_id)),
                DrawItem::Marker(marker) => Some((marker.world, marker.source_id, marker.layer_id)),
                DrawItem::Line(_) => None,
            })
            .collect()
    }

    fn frame_rect_source_ids(plan: &crate::RenderPlan) -> std::collections::HashSet<u32> {
        plan.batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Frame)
            .flat_map(|batch| batch.items.iter())
            .filter_map(|item| match item {
                DrawItem::Rect(rect) => Some(rect.source_id),
                _ => None,
            })
            .collect()
    }

    fn plan_contains_source_id(plan: &crate::RenderPlan, source_id: u32) -> bool {
        plan.batches
            .iter()
            .flat_map(|batch| batch.items.iter())
            .any(|item| match item {
                DrawItem::Rect(rect) => rect.source_id == source_id,
                DrawItem::Marker(marker) => marker.source_id == source_id,
                DrawItem::Line(line) => line.source_id == source_id,
            })
    }

    fn plan_source_ids_except_hierarchy(
        plan: &crate::RenderPlan,
    ) -> std::collections::BTreeSet<u32> {
        plan.batches
            .iter()
            .filter(|batch| batch.plane != RenderPlane::Hierarchy)
            .flat_map(|batch| batch.items.iter())
            .map(|item| match item {
                DrawItem::Rect(rect) => rect.source_id,
                DrawItem::Marker(marker) => marker.source_id,
                DrawItem::Line(line) => line.source_id,
            })
            .collect()
    }

    #[test]
    fn lod_classifier_uses_hysteresis_to_prevent_threshold_flicker() {
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };
        let mut state = LodHysteresisState::default();

        assert_eq!(classify_lod(170.0, settings, &mut state), LodLevel::Far);
        assert_eq!(classify_lod(155.0, settings, &mut state), LodLevel::Far);
        assert_eq!(classify_lod(120.0, settings, &mut state), LodLevel::Mid);
    }

    #[test]
    fn plan_with_external_hysteresis_state_preserves_far_until_exit_threshold() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        });
        let mut state = LodHysteresisState::default();

        let far = planner.plan_with_hysteresis_state(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 17_000, 17_000), 100.0, 100.0),
            &mut state,
        );
        let held_far = planner.plan_with_hysteresis_state(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 15_500, 15_500), 100.0, 100.0),
            &mut state,
        );
        let mid = planner.plan_with_hysteresis_state(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 12_000, 12_000), 100.0, 100.0),
            &mut state,
        );

        assert_eq!(far.source, RenderPlanSource::HierarchyFar);
        assert_eq!(held_far.source, RenderPlanSource::HierarchyFar);
        assert_eq!(mid.source, RenderPlanSource::HierarchyMid);
    }

    #[test]
    fn planner_outputs_separate_fill_and_frame_batches_for_visible_shape() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
        );

        assert!(plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Fill));
        assert!(plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Frame));
    }

    #[test]
    fn far_view_outputs_hierarchy_bbox_for_top_instances() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.lod_stats.hierarchy_bbox, 1);
        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(hierarchy_item_bboxes(&plan)
            .iter()
            .any(|(_, source_id)| *source_id == 77));
        assert!(!plan.batches.iter().any(|batch| {
            matches!(
                batch.plane,
                RenderPlane::Fill | RenderPlane::Frame | RenderPlane::Marker
            ) && batch
                .items
                .iter()
                .any(|item| matches!(item, DrawItem::Rect(rect) if rect.source_id == 42))
        }));
    }

    #[test]
    fn object_visibility_can_hide_hierarchy_instance_bboxes() {
        let db = hierarchy_db();
        let mut model = one_layer_display_model();
        model.object_visibility_mut().instances = false;

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!hierarchy_item_bboxes(&plan)
            .iter()
            .any(|(_, source_id)| *source_id == 77));
    }

    #[test]
    fn far_top_view_does_not_render_die_and_core_frames() {
        let db = hierarchy_db_with_context_shapes();
        let model = DisplayModel::from_layout_layers(db.layers());

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let frame_source_ids = frame_rect_source_ids(&plan);

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!frame_source_ids.contains(&10));
        assert!(!frame_source_ids.contains(&11));
        assert!(!frame_source_ids.contains(&42));
    }

    #[test]
    fn far_view_ignores_locally_loaded_detail_context_geometry() {
        let mut db = hierarchy_db_with_context_shapes();
        let model = DisplayModel::from_layout_layers(db.layers());
        let viewport = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        };
        let planner = RenderPlanner::new(settings);

        let before = planner.plan(&db, &model, viewport);
        db.add_shape(
            db.top_cell(),
            ShapeRecord::new(
                Rect::new(5_000, 5_000, 7_000, 7_000),
                0,
                ShapeKind::Instance,
                302,
            ),
        );
        db.add_shape(
            db.top_cell(),
            ShapeRecord::new(
                Rect::new(7_000, 5_000, 8_000, 7_000),
                0,
                ShapeKind::Region,
                303,
            ),
        );
        let after = planner.plan(&db, &model, viewport);

        assert_eq!(before.source, RenderPlanSource::HierarchyFar);
        assert_eq!(after.source, RenderPlanSource::HierarchyFar);
        assert!(!plan_contains_source_id(&after, 302));
        assert!(!plan_contains_source_id(&after, 303));
        assert_eq!(
            plan_source_ids_except_hierarchy(&before),
            plan_source_ids_except_hierarchy(&after)
        );
    }

    #[test]
    fn far_view_uses_deep_hierarchy_bbox_cloud_when_depth_allows_it() {
        let db = nested_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_expand_depth: 64,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let hierarchy_rects = hierarchy_item_bboxes(&plan)
            .into_iter()
            .map(|(bbox, _)| bbox)
            .collect::<Vec<_>>();

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(hierarchy_rects.contains(&Rect::new(100, 200, 300, 400)));
        assert!(hierarchy_rects.contains(&Rect::new(110, 220, 210, 320)));
        assert!(plan
            .batches
            .iter()
            .all(|batch| batch.plane == RenderPlane::Hierarchy));
    }

    #[test]
    fn far_lod_never_outputs_detail_planes_when_hierarchy_exists() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.batches.is_empty());
        assert!(plan
            .batches
            .iter()
            .all(|batch| batch.plane == RenderPlane::Hierarchy));
    }

    #[test]
    fn far_hierarchy_plan_does_not_report_flat_detail_query_stats() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert_eq!(plan.query_stats.viewport_queries, 0);
        assert_eq!(plan.query_stats.candidates_checked, 0);
        assert_eq!(plan.query_stats.total_shapes_in_cell, 0);
    }

    #[test]
    fn mid_view_draws_cell_proxy_without_detail_layer_expansion() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 5.0,
            idle_detail_units_per_pixel: 1.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(900, 1900, 1200, 2200), 30.0, 30.0),
        );

        assert!(plan.lod_stats.coarse >= 1);
        assert!(hierarchy_item_bboxes(&plan)
            .iter()
            .any(|(_, source_id)| *source_id == 9));
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane != RenderPlane::Hierarchy && batch.display_layer_id == "layer:1"
        }));
    }

    #[test]
    fn interaction_mid_view_does_not_render_die_and_core_frames() {
        let db = hierarchy_db_with_context_shapes();
        let model = DisplayModel::from_layout_layers(db.layers());

        let plan = RenderPlanner::new(RenderSettings {
            force_interaction_coarse: true,
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            idle_detail_units_per_pixel: 96.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 7_100, 7_100), 100.0, 100.0),
        );

        let frame_source_ids = frame_rect_source_ids(&plan);

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert!(!frame_source_ids.contains(&10));
        assert!(!frame_source_ids.contains(&11));
        assert!(!frame_source_ids.contains(&42));
    }

    #[test]
    fn far_view_draws_array_bbox_instead_of_array_elements() {
        let db = array_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            array_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 100_000, 2_000), 100.0, 20.0),
        );

        assert!(plan.lod_stats.array_bbox > 0);
        let hierarchy_rects = plan
            .batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Hierarchy)
            .flat_map(|batch| batch.items.iter())
            .filter_map(|item| match item {
                DrawItem::Rect(rect) => Some(rect.world),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(hierarchy_rects, vec![Rect::new(0, 0, 10_000, 20)]);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
    }

    #[test]
    fn mid_view_draws_array_grid_instead_of_expanded_shapes() {
        let db = array_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            array_bbox_units_per_pixel: 1_000.0,
            array_grid_units_per_pixel: 10.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 200), 100.0, 20.0),
        );

        assert!(plan.lod_stats.array_grid > 0);
        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Hierarchy
                && batch
                    .items
                    .iter()
                    .any(|item| matches!(item, DrawItem::Line(_)))
        }));
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
    }

    #[test]
    fn near_view_expands_only_visible_array_elements() {
        let db = array_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            array_bbox_units_per_pixel: 1_000.0,
            array_grid_units_per_pixel: 10.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(500, 0, 620, 80), 400.0, 200.0),
        );

        assert_eq!(plan.lod_stats.array_bbox + plan.lod_stats.array_grid, 0);
        assert!(plan.batches.iter().any(|batch| {
            batch.display_layer_id == "layer:1"
                && batch
                    .items
                    .iter()
                    .any(|item| matches!(item, DrawItem::Rect(rect) if rect.world == Rect::new(500, 0, 510, 10)))
        }));
        assert!(plan.query_stats.hierarchy_instance_candidates_checked < 5);
    }

    #[test]
    fn mid_lod_uses_aggregate_instance_query_for_large_arrays() {
        let db = large_array_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 10_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            array_bbox_units_per_pixel: 10_000.0,
            array_grid_units_per_pixel: 10.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 100_000, 100_000), 1_000.0, 1_000.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert_eq!(plan.query_stats.compact_array_elements_checked, 0);
        assert_eq!(plan.query_stats.hierarchy_instance_candidates_checked, 1);
        assert!(plan.lod_stats.array_grid > 0);
        assert!(plan_item_count(&plan) <= 3);
    }

    #[test]
    fn mid_hierarchy_plan_does_not_report_flat_detail_query_stats() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            idle_detail_units_per_pixel: 1.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(900, 1900, 1200, 2200), 30.0, 30.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert_eq!(plan.query_stats.viewport_queries, 0);
        assert_eq!(plan.query_stats.candidates_checked, 0);
        assert_eq!(plan.query_stats.total_shapes_in_cell, 0);
    }

    #[test]
    fn mid_lod_can_render_overview_density_without_detail_shapes() {
        let db = overview_density_db(1);
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });
        let viewport = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);

        let plan = planner.plan(&db, &model, viewport);

        assert_eq!(plan.source, RenderPlanSource::OverviewDensity);
        assert_eq!(plan.query_stats.viewport_queries, 0);
        assert_eq!(plan.query_stats.candidates_checked, 0);
        assert_eq!(plan.query_stats.total_shapes_in_cell, 0);
        assert!(plan.lod_stats.coarse > 0);
        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Fill
                && batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.world == Rect::new(1_000, 1_000, 2_000, 2_000)
                            && rect.layer_id == 1)
                })
        }));
    }

    #[test]
    fn overview_density_uses_fill_plane_instead_of_frame_grid() {
        let db = overview_density_db(1);
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });

        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Fill
                && batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.world == Rect::new(1_000, 1_000, 2_000, 2_000)
                            && rect.layer_id == 1)
                })
        }));
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Frame
                && batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.world == Rect::new(1_000, 1_000, 2_000, 2_000)
                            && rect.layer_id == 1)
                })
        }));
    }

    #[test]
    fn hierarchy_far_does_not_use_overview_density_as_top_level_context_when_instances_exist() {
        let mut db = hierarchy_db();
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });

        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(hierarchy_item_bboxes(&plan)
            .iter()
            .any(|(_, source_id)| *source_id == 77));
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Fill
                && batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.world == Rect::new(0, 0, 10_000, 10_000)
                            && rect.layer_id == 1)
                })
        }));
    }

    #[test]
    fn hierarchy_far_preserves_visible_top_level_net_and_pdn_context() {
        let mut db = hierarchy_db();
        db.add_layer(LayerInfo::new(2, "M2"));
        let top = db.top_cell();
        let mut net = ShapeRecord::new(
            Rect::new(500, 500, 8_000, 520),
            1,
            ShapeKind::RegularWire,
            101,
        );
        net.flags |= SHAPE_FLAG_TOP_LEVEL_CONTEXT;
        let mut pdn = ShapeRecord::new(
            Rect::new(500, 800, 8_000, 840),
            2,
            ShapeKind::SpecialWire,
            202,
        );
        pdn.flags |= SHAPE_FLAG_TOP_LEVEL_CONTEXT;
        db.add_shape(top, net);
        db.add_shape(top, pdn);
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(1),
        ));
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });

        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Hierarchy
                && batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| match item {
                    DrawItem::Rect(rect) => rect.source_id == 101,
                    DrawItem::Marker(marker) => marker.source_id == 101,
                    DrawItem::Line(line) => line.source_id == 101,
                })
        }));
        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Hierarchy
                && batch.display_layer_id == "layer:2"
                && batch.items.iter().any(|item| match item {
                    DrawItem::Rect(rect) => rect.source_id == 202,
                    DrawItem::Marker(marker) => marker.source_id == 202,
                    DrawItem::Line(line) => line.source_id == 202,
                })
        }));
    }

    #[test]
    fn hierarchy_far_ignores_unmarked_top_level_detail_wires_as_stable_context() {
        let mut db = hierarchy_db();
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(500, 500, 8_000, 520),
                1,
                ShapeKind::RegularWire,
                101,
            ),
        );
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });

        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Hierarchy
                && batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| match item {
                    DrawItem::Rect(rect) => rect.source_id == 101,
                    DrawItem::Marker(marker) => marker.source_id == 101,
                    DrawItem::Line(line) => line.source_id == 101,
                })
        }));
    }

    #[test]
    fn physical_layers_do_not_match_semantic_overview_bins_by_layer_id() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(0, "OVERLAP"));
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 0,
            kind: ShapeKind::Instance,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            0,
            "OVERLAP",
            LayerStyle::default_for_index(0),
        ));
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });

        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_ne!(plan.source, RenderPlanSource::OverviewDensity);
        assert_eq!(plan_item_count(&plan), 0);
    }

    #[test]
    fn oversized_overview_density_falls_back_to_hierarchy_far_without_truncation() {
        let mut db = many_repeated_cell_hierarchy_db(20);
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(0, 0, 100, 100), 1, ShapeKind::RegularWire, 42),
        );
        db.set_overview_bins(
            (0..12)
                .map(|i| OverviewDensityBin {
                    bbox: Rect::new(i * 100, 0, i * 100 + 80, 80),
                    layer_id: 1,
                    kind: ShapeKind::RegularWire,
                    count: 1,
                    coverage_area: 6_400,
                })
                .collect(),
        );
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            max_render_items: 10,
            occupancy_bin_px: 8.0,
            ..Default::default()
        });
        let viewport = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);

        let plan = planner.plan(&db, &model, viewport);

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.truncated);
        assert!(plan_item_count(&plan) <= 10);
        assert!(plan
            .batches
            .iter()
            .all(|batch| batch.plane == RenderPlane::Hierarchy));
        assert!(plan.lod_stats.hierarchy_bbox > 0 || plan.lod_stats.coarse > 0);
    }

    #[test]
    fn overview_density_updates_hysteresis_before_fallback_can_reclassify() {
        let mut db = overview_density_db(1);
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let visible_model = one_layer_display_model();
        let mut unmatched_model = DisplayModel::new();
        unmatched_model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(1),
        ));
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });
        let mut state = LodHysteresisState::default();

        let overview = planner.plan_with_hysteresis_state(
            &db,
            &visible_model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
            &mut state,
        );
        let fallback = planner.plan_with_hysteresis_state(
            &db,
            &unmatched_model,
            Viewport::new(Rect::new(0, 0, 9_000, 9_000), 100.0, 100.0),
            &mut state,
        );

        assert_eq!(overview.source, RenderPlanSource::OverviewDensity);
        assert_eq!(fallback.source, RenderPlanSource::FlatDetail);
        assert_eq!(
            fallback.cache_key,
            planner.cache_key_with_source(
                &unmatched_model,
                Viewport::new(Rect::new(0, 0, 9_000, 9_000), 100.0, 100.0),
                RenderPlanSource::FlatDetail
            )
        );
    }

    #[test]
    fn overview_density_respects_display_layer_visibility_and_falls_back_when_unmatched() {
        let mut db = overview_density_db(2);
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 110, 110), 1, ShapeKind::RegularWire, 42),
        );
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });

        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::FlatDetail);
        assert_eq!(plan.query_stats.viewport_queries, 1);
        assert_eq!(plan.lod_stats.coarse, 0);
        assert!(!plan
            .batches
            .iter()
            .any(|batch| batch.display_layer_id == "layer:2"));
    }

    #[test]
    fn overview_density_plan_uses_source_aware_cache_key() {
        let db = overview_density_db(1);
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            ..Default::default()
        });
        let viewport = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);

        let plan = planner.plan(&db, &model, viewport);

        assert_eq!(plan.source, RenderPlanSource::OverviewDensity);
        assert_eq!(
            plan.cache_key,
            planner.cache_key_with_source(&model, viewport, RenderPlanSource::OverviewDensity)
        );
    }

    #[test]
    fn mid_view_reuses_per_cell_display_cache_for_repeated_instances() {
        let db = repeated_cell_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            idle_detail_units_per_pixel: 1.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_000, 200), 100.0, 20.0),
        );

        assert_eq!(plan.query_stats.display_cache_misses, 1);
        assert_eq!(plan.query_stats.display_cache_hits, 2);
    }

    #[test]
    fn repeated_cell_templates_are_built_once_and_reused() {
        let db = repeated_cell_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            idle_detail_units_per_pixel: 1.0,
            enable_cell_template_cache: true,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_000, 200), 100.0, 20.0),
        );

        assert_eq!(plan.query_stats.display_cache_misses, 1);
        assert_eq!(plan.query_stats.display_cache_hits, 2);
        assert_eq!(plan.query_stats.cached_template_items, 3);
    }

    #[test]
    fn repeated_cell_display_proxies_include_density_shapes_and_child_summaries() {
        let db = proxy_rich_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            idle_detail_units_per_pixel: 1.0,
            enable_cell_template_cache: true,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(900, 1_900, 1_300, 2_300), 20.0, 20.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert_eq!(plan.query_stats.display_cache_misses, 2);
        assert!(plan.query_stats.proxy_density_bins >= 2);
        assert!(plan.query_stats.proxy_representative_shapes > 0);
        assert_eq!(plan.query_stats.proxy_child_summaries, 1);
    }

    #[test]
    fn mid_view_renders_layer_density_and_representative_shapes_from_cell_proxy() {
        let db = proxy_rich_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            idle_detail_units_per_pixel: 1.0,
            max_frames_per_bin: 4,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(900, 1_900, 1_300, 2_300), 20.0, 20.0),
        );

        let hierarchy_items = hierarchy_item_bboxes_with_layers(&plan);

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert!(hierarchy_items
            .iter()
            .any(|(bbox, _, layer_id)| *layer_id == 1
                && *bbox == Rect::new(1_010, 2_010, 1_126, 2_050)));
        assert!(hierarchy_items
            .iter()
            .any(|(bbox, _, layer_id)| *layer_id == 2
                && *bbox == Rect::new(1_020, 2_090, 1_180, 2_110)));
        assert!(hierarchy_items
            .iter()
            .any(|(bbox, source_id, layer_id)| *source_id == 330
                && *layer_id == 0
                && *bbox == Rect::new(1_150, 2_120, 1_170, 2_140)));
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane != RenderPlane::Hierarchy && batch.display_layer_id == "layer:1"
        }));
    }

    #[test]
    fn far_proxy_thinning_reports_stable_world_tile_proxy_suppression() {
        let db = many_repeated_cell_hierarchy_db(12_500);
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            max_render_items: 1_000,
            occupancy_bin_px: 8.0,
            ..Default::default()
        });

        let first = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_600_000, 2_000), 1_600.0, 2.0),
        );
        let panned = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(500, 0, 1_600_500, 2_000), 1_600.0, 2.0),
        );

        assert_eq!(first.source, RenderPlanSource::HierarchyFar);
        assert_eq!(panned.source, RenderPlanSource::HierarchyFar);
        assert_eq!(
            first.query_stats.proxy_child_summaries,
            plan_item_count(&first)
        );
        assert_eq!(
            panned.query_stats.proxy_child_summaries,
            plan_item_count(&panned)
        );
        assert!(first.query_stats.proxy_child_summaries > 0);
        assert_eq!(
            first.query_stats.proxy_child_summaries,
            panned.query_stats.proxy_child_summaries
        );
        assert!(first.lod_stats.suppress > 0);
        assert!(panned.lod_stats.suppress > 0);
    }

    #[test]
    fn far_lod_preserves_visible_hierarchy_density_for_large_viewport() {
        let db = repeated_cell_grid_hierarchy_db(80, 80);
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            occupancy_bin_px: 8.0,
            max_markers_per_bin: 3,
            max_render_items: 80_000,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_060_000, 795_000), 1_200.0, 900.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.truncated);
        assert!(
            plan_item_count(&plan) >= 1_000,
            "far LOD should preserve visible hierarchy density, got {}",
            plan_item_count(&plan)
        );
    }

    #[test]
    fn interaction_mode_forces_near_view_to_mid_coarse_without_detail_expansion() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            force_interaction_coarse: true,
            hierarchy_bbox_units_per_pixel: 10_000.0,
            hierarchy_coarse_units_per_pixel: 1_000.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert!(plan.lod_stats.coarse + plan.lod_stats.array_grid + plan.lod_stats.array_bbox > 0);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane != RenderPlane::Hierarchy && batch.display_layer_id == "layer:1"
        }));
    }

    #[test]
    fn idle_detail_boost_expands_hierarchy_before_coarse_threshold() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            idle_detail_units_per_pixel: 96.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 7_100, 7_100), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyNear);
        assert_eq!(plan.lod_stats.coarse, 0);
        assert!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker > 0);
    }

    #[test]
    fn interaction_mode_keeps_idle_detail_boost_as_coarse_proxy() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            force_interaction_coarse: true,
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            idle_detail_units_per_pixel: 96.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 7_100, 7_100), 100.0, 100.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert!(plan.lod_stats.coarse > 0);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
    }

    #[test]
    fn interaction_mode_keeps_far_view_as_hierarchy_bbox() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            force_interaction_coarse: true,
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 4.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.lod_stats.hierarchy_bbox, 1);
        assert!(plan.lod_stats.coarse <= 1);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
    }

    #[test]
    fn far_interaction_view_does_not_truncate_sparse_hierarchy_when_screen_budget_allows_it() {
        let db = many_repeated_cell_hierarchy_db(12_500);
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            force_interaction_coarse: true,
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            max_render_items: 80_000,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_600_000, 2_000), 4_000.0, 4_000.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert_eq!(plan.lod_stats.hierarchy_bbox, 12_500);
        assert_eq!(plan_item_count(&plan), 12_500);
        assert!(!plan.truncated);
    }

    #[test]
    fn far_view_thins_dense_hierarchy_under_screen_budget_without_large_unions() {
        let db = many_repeated_cell_hierarchy_db(12_500);
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            max_render_items: 80_000,
            occupancy_bin_px: 8.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_600_000, 2_000), 1_600.0, 2.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.truncated);
        assert!(plan.lod_stats.hierarchy_bbox > 0);
        assert_eq!(plan.lod_stats.coarse, 0);
        assert!(plan.lod_stats.suppress > 0);
        assert!(plan_item_count(&plan) < 12_500);
    }

    #[test]
    fn far_view_thins_hierarchy_when_bbox_count_exceeds_budget() {
        let db = many_repeated_cell_hierarchy_db(12_500);
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            max_render_items: 1_000,
            occupancy_bin_px: 8.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_600_000, 2_000), 1_600.0, 2.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.truncated);
        assert!(plan.lod_stats.hierarchy_bbox > 0);
        assert_eq!(plan.lod_stats.coarse, 0);
        assert!(plan.lod_stats.suppress > 0);
        assert!(plan_item_count(&plan) <= 1_000);
    }

    #[test]
    fn far_view_increases_thinning_granularity_until_it_fits_budget() {
        let db = many_repeated_cell_hierarchy_db(12_500);
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            max_render_items: 100,
            occupancy_bin_px: 1.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1_600_000, 2_000), 1_600.0, 2.0),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.truncated);
        assert!(plan.lod_stats.hierarchy_bbox > 0);
        assert_eq!(plan.lod_stats.coarse, 0);
        assert!(plan.lod_stats.suppress > 0);
        assert!(plan_item_count(&plan) <= 100);
    }

    #[test]
    fn near_expand_stops_when_render_item_budget_is_reached() {
        let db = many_repeated_cell_hierarchy_db(20);
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            max_render_items: 5,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 3_000, 200), 4_000.0, 400.0),
        );

        let item_count = plan
            .batches
            .iter()
            .map(|batch| batch.items.len())
            .sum::<usize>();
        assert!(plan.truncated);
        assert!(item_count <= 5);
    }

    #[test]
    fn near_view_expands_hierarchy_shapes_through_top_instances() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0),
        );

        assert_eq!(plan.lod_stats.hierarchy_bbox, 0);
        assert!(plan.batches.iter().any(|batch| {
            batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.source_id == 9
                            && rect.world == Rect::new(1010, 2010, 1020, 2020))
                })
        }));
    }

    #[test]
    fn near_expand_skips_hidden_physical_layers_before_querying_shapes() {
        let db = hierarchy_db();
        let mut model = one_layer_display_model();
        model.layers_mut()[0].visible = false;

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0),
        );

        assert_eq!(plan.query_stats.viewport_queries, 0);
        assert_eq!(plan.query_stats.hierarchy_instance_candidates_checked, 0);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
        assert!(plan.batches.is_empty());
    }

    #[test]
    fn near_view_expands_nested_hierarchy_shapes() {
        let db = nested_hierarchy_db();
        let model = one_layer_display_model();

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(100, 200, 130, 240), 400.0, 400.0),
        );

        assert!(plan.batches.iter().any(|batch| {
            batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.source_id == 9
                            && rect.world == Rect::new(112, 223, 118, 229))
                })
        }));
    }

    #[test]
    fn cache_key_for_cell_view_changes_with_target_or_policy_depth() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let viewport = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);
        let planner = RenderPlanner::new(RenderSettings::default());
        let top = CellViewState::top(&db);
        let child = db.cell_by_name("leaf").unwrap();
        let focused = CellViewState::from_path(
            db.top_cell(),
            InstancePath::from_elements(vec![InstancePathElement {
                parent_cell: db.top_cell(),
                instance_id: 77,
                source_id: 77,
                child_cell: child,
                array_column: 0,
                array_row: 0,
                bbox: Rect::new(1000, 2000, 1100, 2080),
            }]),
        );
        let default_policy = HierarchyPolicy::default();
        let mut depth_policy = HierarchyPolicy::default();
        depth_policy.max_depth = 1;

        let top_key = planner.cache_key_for_cell_view(
            &model,
            viewport,
            RenderPlanSource::HierarchyNear,
            &top,
            &default_policy,
        );
        let focused_key = planner.cache_key_for_cell_view(
            &model,
            viewport,
            RenderPlanSource::HierarchyNear,
            &focused,
            &default_policy,
        );
        let depth_key = planner.cache_key_for_cell_view(
            &model,
            viewport,
            RenderPlanSource::HierarchyNear,
            &top,
            &depth_policy,
        );

        assert_ne!(top_key, focused_key);
        assert_ne!(top_key, depth_key);
    }

    #[test]
    fn plan_for_cell_view_focused_child_uses_child_local_shapes() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let child = db.cell_by_name("leaf").unwrap();
        let focused = CellViewState::from_path(
            db.top_cell(),
            InstancePath::from_elements(vec![InstancePathElement {
                parent_cell: db.top_cell(),
                instance_id: 77,
                source_id: 77,
                child_cell: child,
                array_column: 0,
                array_row: 0,
                bbox: Rect::new(1000, 2000, 1100, 2080),
            }]),
        );
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        });
        let mut state = LodHysteresisState::default();

        let plan = planner.plan_for_cell_view(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 30, 30), 400.0, 400.0),
            &focused,
            &HierarchyPolicy::default(),
            &mut state,
        );

        assert!(plan.batches.iter().any(|batch| {
            batch.display_layer_id == "layer:1"
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.source_id == 9 && rect.world == Rect::new(10, 10, 20, 20))
                })
        }));
        assert!(!plan.batches.iter().any(|batch| {
            batch.items.iter().any(|item| {
                matches!(item, DrawItem::Rect(rect)
                    if rect.source_id == 42 || rect.world == Rect::new(1010, 2010, 1020, 2020))
            })
        }));
    }

    #[test]
    fn pick_for_cell_view_uses_focused_child_local_shapes() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let child = db.cell_by_name("leaf").unwrap();
        let focused = CellViewState::from_path(
            db.top_cell(),
            InstancePath::from_elements(vec![InstancePathElement {
                parent_cell: db.top_cell(),
                instance_id: 77,
                source_id: 77,
                child_cell: child,
                array_column: 0,
                array_row: 0,
                bbox: Rect::new(1000, 2000, 1100, 2080),
            }]),
        );

        let hit = RenderPlanner::new(RenderSettings::default())
            .pick_for_cell_view(
                &db,
                &model,
                PickRequest::new(15, 15, 1),
                &focused,
                &HierarchyPolicy::default(),
            )
            .expect("focused child shape should be pickable");

        assert_eq!(hit.source_id, 9);
        assert_eq!(hit.bbox, Rect::new(10, 10, 20, 20));
    }

    #[test]
    fn pick_for_cell_view_returns_shape_object_path() {
        let db = hierarchy_db();
        let model = one_layer_display_model();

        let hit = RenderPlanner::new(RenderSettings::default())
            .pick_for_cell_view(
                &db,
                &model,
                PickRequest::new(1015, 2015, 1),
                &CellViewState::top(&db),
                &HierarchyPolicy::default(),
            )
            .expect("hierarchical child shape should be pickable");

        assert_eq!(hit.target, PickHitTarget::Shape);
        assert_eq!(hit.cell, db.cell_by_name("leaf").unwrap());
        assert_eq!(hit.depth, 1);
        assert_eq!(hit.instance_path.depth(), 1);
        assert_eq!(hit.instance_path.elements()[0].instance_id, 77);
        assert_eq!(hit.object_path.instance_path, hit.instance_path);
        assert!(matches!(hit.object_path.target, ObjectPathTarget::Shape(_)));
    }

    #[test]
    fn pick_for_cell_view_can_return_instance_target() {
        let db = empty_instance_hierarchy_db();
        let model = one_layer_display_model();
        let child = db.cell_by_name("empty_leaf").unwrap();

        let hit = RenderPlanner::new(RenderSettings::default())
            .pick_for_cell_view(
                &db,
                &model,
                PickRequest::new(1250, 2440, 1),
                &CellViewState::top(&db),
                &HierarchyPolicy::default(),
            )
            .expect("empty instance bbox should be pickable");

        assert_eq!(hit.cell, db.top_cell());
        assert_eq!(hit.depth, 1);
        assert_eq!(hit.instance_path.depth(), 1);
        assert_eq!(hit.object_path.instance_path, hit.instance_path);
        assert_eq!(
            hit.target,
            PickHitTarget::Instance {
                parent_cell: db.top_cell(),
                child_cell: child,
                instance_id: 88,
                array_column: 0,
                array_row: 0,
            }
        );
        assert_eq!(
            hit.object_path.target,
            ObjectPathTarget::Instance {
                parent_cell: db.top_cell(),
                instance_id: 88,
                source_id: 88,
                child_cell: child,
                array_column: 0,
                array_row: 0,
            }
        );
    }

    #[test]
    fn pick_for_cell_view_skips_instance_targets_when_instances_are_hidden() {
        let db = empty_instance_hierarchy_db();
        let mut model = one_layer_display_model();
        model.object_visibility_mut().instances = false;

        let hit = RenderPlanner::new(RenderSettings::default()).pick_for_cell_view(
            &db,
            &model,
            PickRequest::new(1250, 2440, 1),
            &CellViewState::top(&db),
            &HierarchyPolicy::default(),
        );

        assert!(hit.is_none());
    }

    #[test]
    fn pick_shape_hit_wins_over_instance_hit_when_overlapping() {
        let db = overlapping_shape_and_instance_db();
        let model = one_layer_display_model();

        let hit = RenderPlanner::new(RenderSettings::default())
            .pick_for_cell_view(
                &db,
                &model,
                PickRequest::new(150, 150, 1),
                &CellViewState::top(&db),
                &HierarchyPolicy::default(),
            )
            .expect("overlapping shape and instance should be pickable");

        assert_eq!(hit.target, PickHitTarget::Shape);
        assert_eq!(hit.source_id, 42);
        assert_eq!(hit.bbox, Rect::new(100, 100, 200, 200));
        assert!(matches!(hit.object_path.target, ObjectPathTarget::Shape(_)));
    }

    #[test]
    fn planner_simplifies_tiny_shapes_to_marker_plane() {
        let db = one_shape_db(Rect::new(10, 10, 11, 11));
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings {
            small_shape_px: 4.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 1000, 1000), 200.0, 200.0),
        );

        assert!(plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Marker));
        assert!(!plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Fill));
    }

    #[test]
    fn picking_respects_display_layer_visibility() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let mut model = one_layer_display_model();
        model.layers_mut()[0].visible = false;

        let hit = RenderPlanner::new(RenderSettings::default()).pick(
            &db,
            &model,
            PickRequest::new(50, 50, 2),
        );

        assert!(hit.is_none());
    }

    #[test]
    fn picking_respects_net_object_visibility() {
        let db = one_shape_db_with_kind(Rect::new(10, 10, 110, 110), ShapeKind::RegularWire);
        let mut model = one_layer_display_model();
        assert!(RenderPlanner::new(RenderSettings::default())
            .pick(&db, &model, PickRequest::new(50, 50, 2))
            .is_some());

        model.object_visibility_mut().net = false;

        let hit = RenderPlanner::new(RenderSettings::default()).pick(
            &db,
            &model,
            PickRequest::new(50, 50, 2),
        );

        assert!(hit.is_none());
    }

    #[test]
    fn picking_respects_pdn_object_visibility() {
        let db = one_shape_db_with_kind(Rect::new(10, 10, 110, 110), ShapeKind::SpecialWire);
        let mut model = one_layer_display_model();
        assert!(RenderPlanner::new(RenderSettings::default())
            .pick(&db, &model, PickRequest::new(50, 50, 2))
            .is_some());

        model.object_visibility_mut().pdn = false;

        let hit = RenderPlanner::new(RenderSettings::default()).pick(
            &db,
            &model,
            PickRequest::new(50, 50, 2),
        );

        assert!(hit.is_none());
    }

    #[test]
    fn planner_uses_indexed_viewport_query_once_then_partitions_by_layer() {
        let db = many_layer_db();
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(1),
        ));

        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 100, 100), 400.0, 400.0),
        );

        assert_eq!(plan.query_stats.viewport_queries, 1);
        assert!(plan.query_stats.candidates_checked < plan.query_stats.total_shapes_in_cell);
    }

    #[test]
    fn cache_key_changes_when_viewport_or_visible_layers_change() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let mut model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings::default());

        let first = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
        );
        let second = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 400, 400), 400.0, 400.0),
        );
        model.layers_mut()[0].visible = false;
        let hidden = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
        );

        assert_ne!(first.cache_key, second.cache_key);
        assert_ne!(first.cache_key, hidden.cache_key);
    }

    #[test]
    fn planner_can_compute_cache_key_without_building_render_plan() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let model = one_layer_display_model();
        let viewport = Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0);
        let planner = RenderPlanner::new(RenderSettings::default());

        let plan = planner.plan(&db, &model, viewport);

        assert_eq!(planner.cache_key(&model, viewport), plan.cache_key);
    }

    #[test]
    fn empty_display_model_plan_uses_flat_detail_source_cache_key() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let model = DisplayModel::new();
        let viewport = Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0);
        let planner = RenderPlanner::new(RenderSettings::default());

        let plan = planner.plan(&db, &model, viewport);

        assert_eq!(plan.source, RenderPlanSource::FlatDetail);
        assert_eq!(
            plan.cache_key,
            planner.cache_key_with_source(&model, viewport, RenderPlanSource::FlatDetail)
        );
    }

    #[test]
    fn source_aware_cache_key_matches_hierarchy_plan_sources() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        });

        let far_view = Viewport::new(Rect::new(0, 0, 17_000, 17_000), 100.0, 100.0);
        let mid_view = Viewport::new(Rect::new(0, 0, 12_000, 12_000), 100.0, 100.0);
        let near_view = Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0);

        let far = planner.plan(&db, &model, far_view);
        let mid = planner.plan(&db, &model, mid_view);
        let near = planner.plan(&db, &model, near_view);

        assert_eq!(far.source, RenderPlanSource::HierarchyFar);
        assert_eq!(mid.source, RenderPlanSource::HierarchyMid);
        assert_eq!(near.source, RenderPlanSource::HierarchyNear);
        assert_eq!(
            far.cache_key,
            planner.cache_key_with_source(&model, far_view, RenderPlanSource::HierarchyFar)
        );
        assert_eq!(
            mid.cache_key,
            planner.cache_key_with_source(&model, mid_view, RenderPlanSource::HierarchyMid)
        );
        assert_eq!(
            near.cache_key,
            planner.cache_key_with_source(&model, near_view, RenderPlanSource::HierarchyNear)
        );
        assert_ne!(far.cache_key, planner.cache_key(&model, far_view));
        assert_ne!(mid.cache_key, planner.cache_key(&model, mid_view));
        assert_ne!(near.cache_key, planner.cache_key(&model, near_view));
    }

    #[test]
    fn top_cell_plan_with_hysteresis_state_keeps_existing_source_aware_cache_key_behavior() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        });
        let viewport = Viewport::new(Rect::new(0, 0, 17_000, 17_000), 100.0, 100.0);
        let mut state = LodHysteresisState::default();

        let plan = planner.plan_with_hysteresis_state(&db, &model, viewport, &mut state);

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert_eq!(
            plan.cache_key,
            planner.cache_key_with_source(&model, viewport, RenderPlanSource::HierarchyFar)
        );
    }

    #[test]
    fn far_top_view_keeps_only_hierarchy_outline_when_hierarchy_exists() {
        let mut db = hierarchy_db();
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let model = one_layer_display_model();
        let viewport = Viewport::new(Rect::new(0, 0, 20_000, 20_000), 100.0, 100.0);

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        })
        .plan(&db, &model, viewport);

        assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Fill
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.world == Rect::new(0, 0, 10_000, 10_000)
                            && rect.layer_id == 1)
                })
        }));
        assert!(plan
            .batches
            .iter()
            .all(|batch| batch.plane == RenderPlane::Hierarchy));
        assert!(plan.lod_stats.hierarchy_bbox > 0);
    }

    #[test]
    fn mid_top_view_keeps_only_hierarchy_coarse_when_hierarchy_exists() {
        let mut db = hierarchy_db();
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let model = one_layer_display_model();
        let viewport = Viewport::new(Rect::new(0, 0, 12_000, 12_000), 100.0, 100.0);

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        })
        .plan(&db, &model, viewport);

        assert_eq!(plan.source, RenderPlanSource::HierarchyMid);
        assert!(!plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Fill
                && batch.items.iter().any(|item| {
                    matches!(item, DrawItem::Rect(rect)
                        if rect.world == Rect::new(0, 0, 10_000, 10_000)
                            && rect.layer_id == 1)
                })
        }));
        assert!(plan
            .batches
            .iter()
            .all(|batch| batch.plane == RenderPlane::Hierarchy));
        assert!(plan.lod_stats.coarse > 0);
    }

    #[test]
    fn cache_key_changes_when_visual_style_alpha_or_pattern_changes() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let mut model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings::default());
        let first = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
        );

        model.layers_mut()[0].style.fill_alpha =
            model.layers_mut()[0].style.fill_alpha.saturating_add(1);
        model.layers_mut()[0].style.fill_pattern = layout_display::Pattern::Hollow;
        let second = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
        );

        assert_ne!(first.cache_key, second.cache_key);
    }

    fn dense_marker_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        for i in 0..40 {
            db.add_shape(
                top,
                ShapeRecord::new(
                    Rect::new(100 + i, 100 + i, 101 + i, 101 + i),
                    1,
                    ShapeKind::RegularWire,
                    i as u32,
                ),
            );
        }
        db
    }

    fn dense_regular_wires_with_context_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(0, "Context"));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(0, 0, 10_000, 10_000), 0, ShapeKind::Die, 10),
        );
        for i in 0..40 {
            db.add_shape(
                top,
                ShapeRecord::new(
                    Rect::new(100, 100 + i, 3_000, 101 + i),
                    1,
                    ShapeKind::RegularWire,
                    i as u32,
                ),
            );
        }
        db
    }

    fn dense_multilayer_wires_with_context_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(0, "Context"));
        db.add_layer(LayerInfo::new(1, "M1"));
        db.add_layer(LayerInfo::new(2, "M2"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(0, 0, 10_000, 10_000), 0, ShapeKind::Die, 10),
        );
        for layer_id in [1, 2] {
            for i in 0..20 {
                db.add_shape(
                    top,
                    ShapeRecord::new(
                        Rect::new(100, 100 + i, 3_000, 101 + i),
                        layer_id,
                        ShapeKind::RegularWire,
                        layer_id as u32 * 100 + i as u32,
                    ),
                );
            }
        }
        db
    }

    #[test]
    fn far_view_uses_detail_query_and_simplifies_shapes_without_density_plane() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert_eq!(plan.query_stats.viewport_queries, 1);
        assert!(plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Marker));
    }

    #[test]
    fn screen_occupancy_limits_markers_in_same_pixel_bin() {
        let db = dense_marker_db();
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            max_markers_per_bin: 2,
            ..Default::default()
        });
        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let marker_count = plan
            .batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Marker)
            .map(|batch| batch.items.len())
            .sum::<usize>();

        assert_eq!(marker_count, 2);
    }

    #[test]
    fn long_thin_shapes_degrade_to_frame_not_marker() {
        let db = one_shape_db(Rect::new(0, 0, 10_000, 20));
        let model = one_layer_display_model();
        let planner = RenderPlanner::new(RenderSettings {
            long_shape_px: 20.0,
            ..Default::default()
        });
        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert!(plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Frame));
        assert!(!plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Marker));
    }

    #[test]
    fn hierarchy_near_preserves_long_net_and_pdn_shapes_as_frames() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        db.add_layer(LayerInfo::new(2, "M2"));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 8_000, 2_000));
        db.add_shape(
            leaf,
            ShapeRecord::new(
                Rect::new(0, 100, 7_000, 120),
                1,
                ShapeKind::RegularWire,
                101,
            ),
        );
        db.add_shape(
            leaf,
            ShapeRecord::new(
                Rect::new(0, 300, 7_000, 320),
                2,
                ShapeKind::SpecialWire,
                202,
            ),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 77,
                name: "u0".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 1_000,
                    dy: 2_000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(1_000, 2_000, 9_000, 4_000),
                source_id: 77,
            },
        );
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(1),
        ));

        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            idle_detail_units_per_pixel: 96.0,
            long_shape_px: 160.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 117.37, 117.37),
        );

        assert_eq!(plan.source, RenderPlanSource::HierarchyNear);
        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Frame
                && batch.display_layer_id == "layer:1"
                && batch
                    .items
                    .iter()
                    .any(|item| matches!(item, DrawItem::Rect(rect) if rect.source_id == 101))
        }));
        assert!(plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Frame
                && batch.display_layer_id == "layer:2"
                && batch
                    .items
                    .iter()
                    .any(|item| matches!(item, DrawItem::Rect(rect) if rect.source_id == 202))
        }));
    }

    #[test]
    fn far_view_keeps_large_shapes_hollow_until_fill_threshold() {
        let db = one_shape_db(Rect::new(0, 0, 10_000, 10_000));
        let model = one_layer_display_model();
        let far_view = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);

        let default_plan =
            RenderPlanner::new(RenderSettings::default()).plan(&db, &model, far_view);

        assert!(default_plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Frame));
        assert!(!default_plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Fill));

        let filled_plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 2_000, 2_000), 100.0, 100.0),
        );

        assert!(filled_plan
            .batches
            .iter()
            .any(|batch| batch.plane == RenderPlane::Fill));
    }

    #[test]
    fn screen_frame_budget_suppresses_dense_wires_but_keeps_context() {
        let db = dense_regular_wires_with_context_db();
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::shape_kind(
            ShapeKind::Die,
            "Die",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(1),
        ));
        let planner = RenderPlanner::new(RenderSettings {
            max_frames_per_bin: 2,
            ..Default::default()
        });
        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let frame_count = plan
            .batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Frame)
            .map(|batch| batch.items.len())
            .sum::<usize>();
        let has_die_frame = plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Frame
                && batch
                    .items
                    .iter()
                    .any(|item| matches!(item, DrawItem::Rect(rect) if rect.source_id == 10))
        });

        assert!(has_die_frame);
        assert_eq!(frame_count, 3);
    }

    #[test]
    fn default_display_model_hides_die_and_core_from_render_plan() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(0, 0, 10_000, 10_000), 0, ShapeKind::Die, 10),
        );
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(1_000, 1_000, 9_000, 9_000),
                0,
                ShapeKind::Core,
                11,
            ),
        );
        let model = DisplayModel::from_layout_layers(db.layers());
        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let context_source_ids = plan
            .batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Frame)
            .flat_map(|batch| batch.items.iter())
            .filter_map(|item| match item {
                DrawItem::Rect(rect) => Some(rect.source_id),
                _ => None,
            })
            .collect::<std::collections::HashSet<_>>();

        assert!(!context_source_ids.contains(&10));
        assert!(!context_source_ids.contains(&11));
    }

    #[test]
    fn default_display_model_renders_instance_shapes_with_semantic_texture_layer() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(0, "OVERLAP"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(1_000, 1_000, 9_000, 9_000),
                0,
                ShapeKind::Instance,
                302,
            ),
        );
        let model = DisplayModel::from_layout_layers(db.layers());

        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 400.0, 400.0),
        );

        let instance_fill = plan.batches.iter().find(|batch| {
            batch.plane == RenderPlane::Fill && batch.display_layer_id == "kind:Instance"
        });

        assert!(instance_fill.is_some());
        assert_ne!(instance_fill.unwrap().style.fill_pattern, Pattern::Hollow);
        assert!(!plan
            .batches
            .iter()
            .any(|batch| batch.display_layer_id == "layer:0"));
    }

    #[test]
    fn object_visibility_can_hide_instances_without_hiding_physical_layers() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(1_000, 1_000, 9_000, 9_000),
                0,
                ShapeKind::Instance,
                302,
            ),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(2_000, 2_000, 8_000, 8_000), 1, ShapeKind::Via, 7),
        );
        let mut model = DisplayModel::from_layout_layers(db.layers());
        model.object_visibility_mut().instances = false;

        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 400.0, 400.0),
        );

        assert!(!plan
            .batches
            .iter()
            .any(|batch| batch.display_layer_id == "kind:Instance"));
        assert!(plan
            .batches
            .iter()
            .any(|batch| batch.display_layer_id == "layer:1"));
    }

    #[test]
    fn object_visibility_filters_net_and_pdn_shapes_on_physical_layers() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(1_000, 1_000, 4_000, 4_000),
                1,
                ShapeKind::RegularWire,
                101,
            ),
        );
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(5_000, 5_000, 8_000, 8_000),
                1,
                ShapeKind::SpecialWire,
                202,
            ),
        );
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(8_500, 8_500, 9_000, 9_000),
                1,
                ShapeKind::Via,
                303,
            ),
        );
        let mut model = DisplayModel::from_layout_layers(db.layers());
        model.object_visibility_mut().net = false;
        model.object_visibility_mut().pdn = false;

        let plan = RenderPlanner::new(RenderSettings::default()).plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 400.0, 400.0),
        );
        let rendered_sources = plan
            .batches
            .iter()
            .flat_map(|batch| batch.items.iter())
            .filter_map(|item| match item {
                DrawItem::Rect(rect) => Some(rect.source_id),
                DrawItem::Marker(marker) => Some(marker.source_id),
                DrawItem::Line(line) => Some(line.source_id),
            })
            .collect::<std::collections::HashSet<_>>();

        assert!(!rendered_sources.contains(&101));
        assert!(!rendered_sources.contains(&202));
        assert!(rendered_sources.contains(&303));
    }

    #[test]
    fn screen_quad_saturation_caps_low_priority_frames_across_layers() {
        let db = dense_multilayer_wires_with_context_db();
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::shape_kind(
            ShapeKind::Die,
            "Die",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(1),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(2),
        ));
        let planner = RenderPlanner::new(RenderSettings {
            max_frames_per_bin: 20,
            max_low_priority_quads_per_bin: 3,
            ..Default::default()
        });
        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let frame_count = plan
            .batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Frame)
            .map(|batch| batch.items.len())
            .sum::<usize>();
        let has_die_frame = plan.batches.iter().any(|batch| {
            batch.plane == RenderPlane::Frame
                && batch
                    .items
                    .iter()
                    .any(|item| matches!(item, DrawItem::Rect(rect) if rect.source_id == 10))
        });

        assert!(has_die_frame);
        assert_eq!(frame_count, 4);
    }

    #[test]
    fn rejected_frame_reservations_do_not_consume_screen_quad_budget() {
        let db = dense_multilayer_wires_with_context_db();
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::shape_kind(
            ShapeKind::Die,
            "Die",
            LayerStyle::default_for_index(0),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(1),
        ));
        model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(2),
        ));
        let planner = RenderPlanner::new(RenderSettings {
            max_frames_per_bin: 1,
            max_low_priority_quads_per_bin: 2,
            ..Default::default()
        });
        let plan = planner.plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        let low_priority_frame_count = plan
            .batches
            .iter()
            .filter(|batch| batch.plane == RenderPlane::Frame)
            .flat_map(|batch| batch.items.iter())
            .filter(|item| matches!(item, DrawItem::Rect(rect) if rect.source_id != 10))
            .count();

        assert_eq!(low_priority_frame_count, 2);
    }

    #[test]
    fn render_plan_reports_lod_decision_counts_for_tuning() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(0, 0, 2_000, 2_000), 1, ShapeKind::RegularWire, 1),
        );
        db.add_shape(
            top,
            ShapeRecord::new(
                Rect::new(0, 1_500, 2_000, 1_510),
                1,
                ShapeKind::RegularWire,
                2,
            ),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(100, 100, 101, 101), 1, ShapeKind::RegularWire, 3),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(102, 102, 103, 103), 1, ShapeKind::RegularWire, 4),
        );

        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings {
            frame_only_px: 8.0,
            long_shape_px: 10.0,
            max_markers_per_bin: 1,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 2_000, 2_000), 100.0, 100.0),
        );

        assert_eq!(plan.lod_stats.exact, 1);
        assert_eq!(plan.lod_stats.frame_only, 1);
        assert_eq!(plan.lod_stats.marker, 1);
        assert_eq!(plan.lod_stats.suppress, 1);
    }

    #[test]
    fn far_view_outputs_only_hierarchy_or_array_bbox_when_hierarchy_exists() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
        );

        assert!(plan.lod_stats.hierarchy_bbox + plan.lod_stats.array_bbox > 0);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
    }

    #[test]
    fn mid_view_outputs_coarse_or_array_grid_without_near_detail() {
        let db = array_hierarchy_db();
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 10.0,
            array_bbox_units_per_pixel: 1_000.0,
            array_grid_units_per_pixel: 10.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 10_000, 200), 100.0, 20.0),
        );

        assert!(plan.lod_stats.coarse + plan.lod_stats.array_grid + plan.lod_stats.array_bbox > 0);
        assert_eq!(
            plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker,
            0
        );
    }

    #[test]
    fn near_view_outputs_detail_when_under_budget() {
        let db = hierarchy_db();
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings {
            max_render_items: 10_000,
            hierarchy_bbox_units_per_pixel: 1_000.0,
            hierarchy_coarse_units_per_pixel: 100.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0),
        );

        assert!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker > 0);
        assert!(!plan.truncated);
    }

    #[test]
    fn flat_db_keeps_existing_flat_lod_behavior() {
        let db = one_shape_db(Rect::new(10, 10, 110, 110));
        let model = one_layer_display_model();
        let plan = RenderPlanner::new(RenderSettings {
            hierarchy_bbox_units_per_pixel: 1.0,
            ..Default::default()
        })
        .plan(
            &db,
            &model,
            Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
        );

        assert!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker > 0);
    }
}
