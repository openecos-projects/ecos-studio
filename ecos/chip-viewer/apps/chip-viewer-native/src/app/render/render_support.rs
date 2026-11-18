use super::*;

pub(super) fn loading_canvas(ui: &mut egui::Ui, loading: &LoadingViewer) {
    let available = ui.available_size();
    let (rect, _) = ui.allocate_exact_size(available, egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 0.0, ecos_canvas());

    let center = rect.center();
    painter.text(
        center + egui::vec2(0.0, -18.0),
        egui::Align2::CENTER_CENTER,
        "Loading geometry snapshot",
        egui::FontId::proportional(18.0),
        ecos_text_primary(),
    );
    painter.text(
        center + egui::vec2(0.0, 12.0),
        egui::Align2::CENTER_CENTER,
        format!("{:.1}s", loading.started_at.elapsed().as_secs_f32()),
        egui::FontId::proportional(13.0),
        ecos_text_secondary(),
    );
}

pub(super) fn color32(rgba: [u8; 4]) -> egui::Color32 {
    egui::Color32::from_rgba_unmultiplied(rgba[0], rgba[1], rgba[2], rgba[3])
}

pub(super) fn ecos_canvas() -> egui::Color32 {
    egui::Color32::from_rgb(24, 24, 28)
}

pub(super) fn ecos_panel() -> egui::Color32 {
    egui::Color32::from_rgb(34, 34, 38)
}

pub(crate) fn ecos_border() -> egui::Color32 {
    egui::Color32::from_rgb(54, 54, 58)
}

pub(super) fn ecos_text_primary() -> egui::Color32 {
    egui::Color32::from_rgb(227, 227, 232)
}

pub(crate) fn ecos_text_secondary() -> egui::Color32 {
    egui::Color32::from_rgb(161, 161, 170)
}

pub(super) fn ecos_info_text() -> egui::Color32 {
    egui::Color32::from_rgb(216, 216, 224)
}

pub(crate) fn ecos_accent() -> egui::Color32 {
    egui::Color32::from_rgb(0, 191, 165)
}

pub(crate) fn ecos_warning() -> egui::Color32 {
    egui::Color32::from_rgb(251, 191, 36)
}

pub(super) fn apply_ecos_theme(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.override_text_color = Some(ecos_text_primary());
    visuals.panel_fill = ecos_panel();
    visuals.window_fill = ecos_panel();
    visuals.extreme_bg_color = ecos_canvas();
    visuals.faint_bg_color = egui::Color32::from_rgb(40, 40, 45);
    visuals.window_stroke = egui::Stroke::new(1.0_f32, ecos_border());
    visuals.selection.bg_fill = egui::Color32::from_rgba_unmultiplied(0, 191, 165, 48);
    visuals.selection.stroke = egui::Stroke::new(1.0_f32, ecos_accent());
    visuals.widgets.noninteractive.bg_fill = ecos_panel();
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0_f32, ecos_border());
    visuals.widgets.inactive.bg_fill = ecos_canvas();
    visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0_f32, ecos_border());
    visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(39, 57, 57);
    visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0_f32, ecos_accent());
    visuals.widgets.active.bg_fill = egui::Color32::from_rgb(35, 72, 66);
    visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0_f32, ecos_accent());
    ctx.set_visuals(visuals);

    let mut style = (*ctx.style()).clone();
    style.spacing.button_padding = egui::vec2(8.0, 4.0);
    style.spacing.interact_size.y = 28.0;
    style.spacing.item_spacing = egui::vec2(8.0, 6.0);
    ctx.set_style(style);
}

pub(super) fn section_heading(ui: &mut egui::Ui, label: &str) {
    ui.label(
        egui::RichText::new(label)
            .small()
            .strong()
            .color(ecos_accent()),
    );
}

pub(super) fn analysis_tab_button(ui: &mut egui::Ui, label: &str, selected: bool) -> bool {
    let width = match label {
        "ANTENNA" => 64.0,
        "CLOCK TREE" => 92.0,
        _ => 52.0,
    };
    let response = ui.add_sized(
        egui::vec2(width, 28.0),
        egui::Button::new(
            egui::RichText::new(label)
                .strong()
                .size(12.5)
                .color(if selected {
                    ecos_text_primary()
                } else {
                    ecos_text_secondary()
                }),
        )
        .frame(false),
    );
    if selected {
        ui.painter().line_segment(
            [
                egui::pos2(response.rect.left() + 8.0, response.rect.bottom()),
                egui::pos2(response.rect.right() - 8.0, response.rect.bottom()),
            ],
            egui::Stroke::new(2.0_f32, ecos_accent()),
        );
    }
    response.clicked()
}

pub(super) fn map_heatmap_layout(
    canvas: egui::Rect,
    rows: usize,
    columns: usize,
) -> (egui::Vec2, egui::Vec2) {
    let popup_width = (canvas.width() * MAP_HEATMAP_WIDTH_FRACTION)
        .clamp(MAP_HEATMAP_MIN_WIDTH, MAP_HEATMAP_MAX_WIDTH)
        .min((canvas.width() - 24.0).max(160.0));
    let content_width = (popup_width - 20.0).max(120.0);
    let mut grid_width = content_width.min(MAP_HEATMAP_MAX_GRID_SIZE);
    let mut grid_height = grid_width * rows.max(1) as f32 / columns.max(1) as f32;
    let max_grid_height = (canvas.height() - 118.0).clamp(60.0, MAP_HEATMAP_MAX_GRID_SIZE);
    if grid_height > max_grid_height {
        let scale = max_grid_height / grid_height;
        grid_width *= scale;
        grid_height = max_grid_height;
    }
    let popup_height =
        (grid_height + MAP_HEATMAP_VERTICAL_OVERHEAD).min((canvas.height() - 24.0).max(150.0));
    (
        egui::vec2(popup_width, popup_height),
        egui::vec2(grid_width, grid_height),
    )
}

pub(super) fn paint_heatmap_grid(
    painter: &egui::Painter,
    rect: egui::Rect,
    data: &HeatmapData,
    selected_cell: Option<(usize, usize)>,
    colormap_mode: ColormapMode,
    threshold: f32,
    invert_threshold: bool,
) {
    let rows = data.rows().max(1);
    let columns = data.columns().max(1);
    let cell_width = rect.width() / columns as f32;
    let cell_height = rect.height() / rows as f32;
    painter.rect_filled(rect, 2.0, ecos_canvas());
    for row in 0..rows {
        for column in 0..columns {
            let Some(normalized) = data.normalized_value(row, column) else {
                continue;
            };
            let hidden = if !invert_threshold {
                normalized < threshold
            } else {
                normalized > threshold
            };
            if hidden {
                continue;
            }
            let cell = heatmap_cell_rect(rect, rows, columns, row, column);
            let [r, g, b, _] = colormap_mode.sample(normalized);
            painter.rect_filled(cell, 0.0, egui::Color32::from_rgb(r, g, b));
        }
    }
    painter.rect_stroke(
        rect,
        2.0,
        egui::Stroke::new(1.0_f32, ecos_border()),
        egui::StrokeKind::Inside,
    );
    if let Some((row, column)) = selected_cell {
        if row < rows && column < columns {
            paint_heatmap_cell_outline(
                painter,
                rect,
                rows,
                columns,
                row,
                column,
                egui::Stroke::new(2.0_f32, egui::Color32::WHITE),
            );
        }
    }

    if cell_width >= 8.0 && cell_height >= 8.0 {
        let stroke = egui::Stroke::new(0.5_f32, egui::Color32::from_black_alpha(48));
        for column in 1..columns {
            let x = rect.left() + column as f32 * cell_width;
            painter.line_segment(
                [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                stroke,
            );
        }
        for row in 1..rows {
            let y = rect.top() + row as f32 * cell_height;
            painter.line_segment(
                [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
                stroke,
            );
        }
    }
}

pub(super) fn paint_heatmap_legend(
    ui: &mut egui::Ui,
    min: f64,
    max: f64,
    colormap_mode: ColormapMode,
    threshold: &mut f32,
    invert_threshold: &mut bool,
) -> (bool, bool, bool) {
    let mut threshold_changed = false;
    let mut invert_changed = false;
    let mut peak_clicked = false;
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), 10.0),
        egui::Sense::click_and_drag(),
    );

    if response.clicked() || response.dragged() {
        if let Some(pos) = response.interact_pointer_pos() {
            let t = ((pos.x - rect.left()) / rect.width()).clamp(0.0, 1.0);
            if (*threshold - t).abs() > 0.001 {
                *threshold = t;
                threshold_changed = true;
            }
        }
    }

    let painter = ui.painter_at(rect);
    let segments = 64;
    for segment in 0..segments {
        let t0 = segment as f32 / segments as f32;
        let t1 = (segment + 1) as f32 / segments as f32;
        let mid = (t0 + t1) * 0.5;
        let [r, g, b, _] = colormap_mode.sample(mid);
        let is_sub = if !*invert_threshold {
            mid < *threshold
        } else {
            mid > *threshold
        };
        let color = if is_sub {
            // Defocused / dimmed representation for inactive portion
            egui::Color32::from_rgba_unmultiplied(r / 4 + 15, g / 4 + 15, b / 4 + 15, 120)
        } else {
            egui::Color32::from_rgb(r, g, b)
        };
        painter.rect_filled(
            egui::Rect::from_min_max(
                egui::pos2(egui::lerp(rect.x_range(), t0), rect.top()),
                egui::pos2(egui::lerp(rect.x_range(), t1), rect.bottom()),
            ),
            0.0,
            color,
        );
    }

    // Border around legend
    painter.rect_stroke(
        rect,
        0.0,
        egui::Stroke::new(1.0_f32, ecos_border()),
        egui::StrokeKind::Inside,
    );

    // Indicator line at threshold cutoff position
    if *threshold > 0.001 {
        let handle_x = egui::lerp(rect.x_range(), *threshold);
        painter.line_segment(
            [
                egui::pos2(handle_x, rect.top() - 2.0),
                egui::pos2(handle_x, rect.bottom() + 2.0),
            ],
            egui::Stroke::new(2.0_f32, egui::Color32::WHITE),
        );
    }

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(format_map_value(min))
                .monospace()
                .size(10.0)
                .color(ecos_text_secondary()),
        );
        if ui
            .small_button("Peak")
            .on_hover_text("Focus camera on the maximum hotspot cell")
            .clicked()
        {
            peak_clicked = true;
        }
        let invert_label = if *invert_threshold {
            "Coldspots"
        } else {
            "Hotspots"
        };
        if ui
            .small_button(invert_label)
            .on_hover_text("Toggle between filtering hotspots (normal) and coldspots (inverted)")
            .clicked()
        {
            *invert_threshold = !*invert_threshold;
            invert_changed = true;
        }

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(
                egui::RichText::new(format_map_value(max))
                    .monospace()
                    .size(10.0)
                    .color(ecos_text_secondary()),
            );
            if *threshold > 0.001 && *threshold < 0.999 {
                let thresh_val = min + (*threshold as f64) * (max - min);
                let label_str = if !*invert_threshold {
                    format!("cutoff: ≥ {}", format_map_value(thresh_val))
                } else {
                    format!("cutoff: ≤ {}", format_map_value(thresh_val))
                };
                ui.label(
                    egui::RichText::new(label_str)
                        .monospace()
                        .size(10.0)
                        .color(ecos_accent()),
                );
            }
        });
    });

    (threshold_changed, invert_changed, peak_clicked)
}

pub(super) fn heatmap_cell_at(
    pos: egui::Pos2,
    rect: egui::Rect,
    rows: usize,
    columns: usize,
) -> Option<(usize, usize)> {
    if !rect.contains(pos) || rows == 0 || columns == 0 {
        return None;
    }
    let column = (((pos.x - rect.left()) / rect.width()) * columns as f32)
        .floor()
        .clamp(0.0, (columns - 1) as f32) as usize;
    let row = (((pos.y - rect.top()) / rect.height()) * rows as f32)
        .floor()
        .clamp(0.0, (rows - 1) as f32) as usize;
    Some((row, column))
}

pub(super) fn interactive_heatmap_cell_at(
    pos: egui::Pos2,
    rect: egui::Rect,
    data: &HeatmapData,
) -> Option<(usize, usize)> {
    heatmap_cell_at(pos, rect, data.rows(), data.columns())
        .filter(|(row, column)| data.value(*row, *column).is_some())
}

pub(super) fn heatmap_cell_rect(
    rect: egui::Rect,
    rows: usize,
    columns: usize,
    row: usize,
    column: usize,
) -> egui::Rect {
    let cell_width = rect.width() / columns.max(1) as f32;
    let cell_height = rect.height() / rows.max(1) as f32;
    egui::Rect::from_min_max(
        egui::pos2(
            rect.left() + column as f32 * cell_width,
            rect.top() + row as f32 * cell_height,
        ),
        egui::pos2(
            rect.left() + (column + 1) as f32 * cell_width,
            rect.top() + (row + 1) as f32 * cell_height,
        ),
    )
}

pub(super) fn paint_heatmap_cell_outline(
    painter: &egui::Painter,
    rect: egui::Rect,
    rows: usize,
    columns: usize,
    row: usize,
    column: usize,
    stroke: egui::Stroke,
) {
    painter.rect_stroke(
        heatmap_cell_rect(rect, rows, columns, row, column).expand(1.0),
        0.0,
        stroke,
        egui::StrokeKind::Inside,
    );
}

pub(super) fn format_map_value(value: f64) -> String {
    let magnitude = value.abs();
    if magnitude == 0.0 {
        "0".to_string()
    } else if magnitude >= 1000.0 || magnitude < 0.001 {
        format!("{value:.3e}")
    } else if magnitude >= 1.0 {
        format!("{value:.3}")
    } else {
        format!("{value:.5}")
    }
}

pub(super) fn contextual_map_focus_bbox(bbox: Rect32) -> Rect32 {
    let width = i64::from(bbox.hx) - i64::from(bbox.lx);
    let height = i64::from(bbox.hy) - i64::from(bbox.ly);
    let half_extent = width.max(height).max(1);
    let center_x = (i64::from(bbox.lx) + i64::from(bbox.hx)) / 2;
    let center_y = (i64::from(bbox.ly) + i64::from(bbox.hy)) / 2;
    Rect32 {
        lx: clamp_i64_to_i32(center_x - half_extent),
        ly: clamp_i64_to_i32(center_y - half_extent),
        hx: clamp_i64_to_i32(center_x + half_extent),
        hy: clamp_i64_to_i32(center_y + half_extent),
    }
}

pub(super) fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

pub(super) fn paint_map_selection_overlay(
    painter: &egui::Painter,
    bbox: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) {
    let rect = world_to_screen_rect(bbox, world, canvas, zoom, pan);
    painter.rect_filled(
        rect,
        0.0,
        egui::Color32::from_rgba_unmultiplied(0, 191, 165, 36),
    );
    painter.rect_stroke(
        rect.expand(1.5),
        0.0,
        egui::Stroke::new(2.0_f32, ecos_accent()),
        egui::StrokeKind::Inside,
    );
}

pub(super) fn info_panel_label(ui: &mut egui::Ui, text: impl Into<String>) {
    ui.label(egui::RichText::new(text).size(12.5).color(ecos_info_text()));
}

pub(super) fn drc_type_card(ui: &mut egui::Ui, state: &mut DrcTypeState) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgb(30, 30, 34))
        .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
        .corner_radius(8)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.checkbox(&mut state.visible, "");
                ui.label(
                    egui::RichText::new(&state.name)
                        .strong()
                        .size(13.5)
                        .color(ecos_text_primary()),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(state.total_count.to_string())
                            .size(12.5)
                            .color(ecos_info_text()),
                    );
                });
            });
            let layer_summary = drc_layer_counts_summary(&state.layer_counts);
            if !layer_summary.is_empty() {
                ui.add_space(2.0);
                ui.label(
                    egui::RichText::new(layer_summary)
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
        });
}

pub(super) fn antenna_type_card(ui: &mut egui::Ui, state: &mut AntennaTypeState) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgb(30, 30, 34))
        .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
        .corner_radius(8)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.checkbox(&mut state.visible, "");
                ui.label(
                    egui::RichText::new(&state.name)
                        .strong()
                        .size(13.5)
                        .color(ecos_text_primary()),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(state.total_count.to_string())
                            .size(12.5)
                            .color(ecos_info_text()),
                    );
                });
            });
            let layer_summary = antenna_layer_counts_summary(&state.layer_counts);
            if !layer_summary.is_empty() {
                ui.add_space(2.0);
                ui.label(
                    egui::RichText::new(layer_summary)
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
        });
}

pub(super) fn drc_layer_counts_summary(layer_counts: &BTreeMap<String, usize>) -> String {
    const MAX_LAYER_SUMMARY_ITEMS: usize = 6;
    let mut parts = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .take(MAX_LAYER_SUMMARY_ITEMS)
        .map(|(layer, count)| format!("{layer}: {count}"))
        .collect::<Vec<_>>();
    let omitted = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .count()
        .saturating_sub(MAX_LAYER_SUMMARY_ITEMS);
    if omitted > 0 {
        parts.push(format!("+{omitted} layers"));
    }
    parts.join("  ")
}

pub(super) fn antenna_layer_counts_summary(layer_counts: &BTreeMap<String, usize>) -> String {
    const MAX_LAYER_SUMMARY_ITEMS: usize = 6;
    let mut parts = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .take(MAX_LAYER_SUMMARY_ITEMS)
        .map(|(layer, count)| format!("{layer}: {count}"))
        .collect::<Vec<_>>();
    let omitted = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .count()
        .saturating_sub(MAX_LAYER_SUMMARY_ITEMS);
    if omitted > 0 {
        parts.push(format!("+{omitted} layers"));
    }
    parts.join("  ")
}

pub(super) fn single_line_query_text(text: &str) -> String {
    text.chars()
        .map(|value| {
            if value == '\n' || value == '\r' {
                ' '
            } else {
                value
            }
        })
        .collect()
}

pub(super) fn overview_tile_color(style: LayerStyle, shape_count: u32) -> egui::Color32 {
    let [r, g, b, a] = gpu_overview::overview_tile_rgba(style, shape_count);
    egui::Color32::from_rgba_unmultiplied(r, g, b, a)
}

pub(super) fn style_for_shape(style: LayerStyle, owner: Option<&OwnerRef>) -> LayerStyle {
    let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
    let style = match owner_type {
        Some(OwnerType::Die | OwnerType::Core) => context_style(style, 170, 2),
        Some(OwnerType::Row) => context_style(style, 46, 1),
        Some(OwnerType::TrackGrid) => context_style(style, 82, 1),
        Some(OwnerType::GCellGrid) => context_style(style, 104, 2),
        Some(OwnerType::Obs) => owner_texture_style(style, 52, 190, FillPattern::CrossHatch, 1),
        Some(OwnerType::Via) => owner_texture_style(style, 48, 220, FillPattern::XMark, 1),
        Some(OwnerType::PinPortShape | OwnerType::InstancePinPortShape) => {
            owner_texture_style(style, 64, 215, FillPattern::Grid, 2)
        }
        Some(OwnerType::IoPinPortShape) => io_pin_texture_style(style),
        Some(OwnerType::NetWireSegment) => {
            let fill_alpha = style.fill_alpha.max(56);
            let frame_alpha = style.frame_alpha.max(210);
            let line_width_px = style.line_width_px;
            owner_texture_style(
                style,
                fill_alpha,
                frame_alpha,
                FillPattern::DiagonalHatch,
                line_width_px,
            )
        }
        Some(OwnerType::SpecialWireSegment) => {
            owner_texture_style(style, 76, 235, FillPattern::Grid, 2)
        }
        Some(OwnerType::InstanceBBox) => solid_owner_texture_style(style, 64, 172, 1),
        Some(OwnerType::Blockage) => {
            owner_texture_style(style, 66, 220, FillPattern::CrossHatch, 1)
        }
        Some(OwnerType::Fill) => owner_texture_style(style, 42, 150, FillPattern::SparseDots, 1),
        Some(OwnerType::Region) => {
            owner_texture_style(style, 36, 180, FillPattern::VerticalHatch, 1)
        }
        Some(OwnerType::Slot) => {
            owner_texture_style(style, 48, 190, FillPattern::HorizontalHatch, 1)
        }
        _ => style,
    };

    let style = if style.layer_id == LAYOUT_GEOMETRY_LAYER {
        transparent_gray_layout_style(style)
    } else {
        style
    };

    // Halo carries its own fixed color; applying it last keeps the orange even
    // on the layout-geometry layer, where the transparent-gray conversion
    // above would otherwise mute it to dark gray.
    if owner_type == Some(OwnerType::InstanceHalo) {
        halo_texture_style(style)
    } else {
        style
    }
}

pub(super) fn layout_geometry_layer_style() -> LayerStyle {
    LayerStyle {
        layer_id: LAYOUT_GEOMETRY_LAYER,
        visible: true,
        rgba: [
            LAYOUT_GEOMETRY_RGB[0],
            LAYOUT_GEOMETRY_RGB[1],
            LAYOUT_GEOMETRY_RGB[2],
            LAYOUT_GEOMETRY_MAX_FILL_ALPHA,
        ],
        frame_rgba: [
            LAYOUT_GEOMETRY_RGB[0],
            LAYOUT_GEOMETRY_RGB[1],
            LAYOUT_GEOMETRY_RGB[2],
            LAYOUT_GEOMETRY_MAX_FRAME_ALPHA,
        ],
        fill_alpha: LAYOUT_GEOMETRY_MAX_FILL_ALPHA,
        frame_alpha: LAYOUT_GEOMETRY_MAX_FRAME_ALPHA,
        fill_pattern: FillPattern::Hollow,
        line_width_px: 1,
    }
}

pub(super) fn transparent_gray_layout_style(mut style: LayerStyle) -> LayerStyle {
    style.rgba = [
        LAYOUT_GEOMETRY_RGB[0],
        LAYOUT_GEOMETRY_RGB[1],
        LAYOUT_GEOMETRY_RGB[2],
        style.fill_alpha.min(LAYOUT_GEOMETRY_MAX_FILL_ALPHA),
    ];
    style.frame_rgba = [
        LAYOUT_GEOMETRY_RGB[0],
        LAYOUT_GEOMETRY_RGB[1],
        LAYOUT_GEOMETRY_RGB[2],
        style.frame_alpha.min(LAYOUT_GEOMETRY_MAX_FRAME_ALPHA),
    ];
    style.fill_alpha = style.rgba[3];
    style.frame_alpha = style.frame_rgba[3];
    style
}

pub(super) fn io_pin_texture_style(mut style: LayerStyle) -> LayerStyle {
    style.rgba = [245, 190, 32, 104];
    style.frame_rgba = [255, 222, 89, 232];
    style.fill_alpha = style.rgba[3];
    style.frame_alpha = style.frame_rgba[3];
    style.fill_pattern = FillPattern::CrossHatch;
    style.line_width_px = 2;
    style
}

/// Halo keeps a fixed orange regardless of the owning layer's color so it
/// reads as placement keep-out context instead of layer geometry.
pub(super) fn halo_texture_style(mut style: LayerStyle) -> LayerStyle {
    style.rgba = [255, 140, 0, 38];
    style.frame_rgba = [255, 140, 0, 156];
    style.fill_alpha = style.rgba[3];
    style.frame_alpha = style.frame_rgba[3];
    style.fill_pattern = FillPattern::HorizontalHatch;
    style.line_width_px = 1;
    style
}

pub(super) fn owner_texture_style(
    mut style: LayerStyle,
    fill_alpha: u8,
    frame_alpha: u8,
    fill_pattern: FillPattern,
    line_width_px: u8,
) -> LayerStyle {
    let rgb = layer_style_rgb(style);
    style.rgba = [rgb[0], rgb[1], rgb[2], fill_alpha];
    style.frame_rgba = [rgb[0], rgb[1], rgb[2], frame_alpha];
    style.fill_alpha = fill_alpha;
    style.frame_alpha = frame_alpha;
    style.fill_pattern = fill_pattern;
    style.line_width_px = line_width_px;
    style
}

pub(super) fn solid_owner_texture_style(
    mut style: LayerStyle,
    fill_alpha: u8,
    frame_alpha: u8,
    line_width_px: u8,
) -> LayerStyle {
    let rgb = layer_style_rgb(style);
    style.rgba = [rgb[0], rgb[1], rgb[2], fill_alpha];
    style.frame_rgba = [rgb[0], rgb[1], rgb[2], frame_alpha];
    style.fill_alpha = fill_alpha;
    style.frame_alpha = frame_alpha;
    style.fill_pattern = FillPattern::Solid;
    style.line_width_px = line_width_px;
    style
}

pub(super) fn layer_style_rgb(style: LayerStyle) -> [u8; 3] {
    [style.rgba[0], style.rgba[1], style.rgba[2]]
}

pub(super) fn context_style(
    mut style: LayerStyle,
    frame_alpha: u8,
    line_width_px: u8,
) -> LayerStyle {
    let rgb = layer_style_rgb(style);
    style.rgba[3] = 0;
    style.fill_alpha = 0;
    style.fill_pattern = FillPattern::Hollow;
    style.frame_rgba = [rgb[0], rgb[1], rgb[2], frame_alpha];
    style.frame_alpha = frame_alpha;
    style.line_width_px = line_width_px;
    style
}

pub(super) fn layer_ui_states(
    db: &ChipViewDb,
    visibility: &BTreeMap<LayerId, bool>,
    color_theme: chip_display::ColorTheme,
) -> Vec<LayerUiState> {
    layer_ui_states_from_summaries(db.layer_catalog(), visibility, color_theme)
}

pub(super) fn layer_ui_states_from_summaries(
    summaries: Vec<LayerSummary>,
    visibility: &BTreeMap<LayerId, bool>,
    color_theme: chip_display::ColorTheme,
) -> Vec<LayerUiState> {
    summaries
        .into_iter()
        .enumerate()
        .map(|(index, summary)| {
            let style = LayerStyle::default_for_metadata_with_type(
                summary.layer_id,
                &summary.name,
                &summary.layer_type,
                index,
                color_theme,
            );
            let display_role = LayerRole::from_metadata(&summary.name, &summary.layer_type)
                .label()
                .to_string();
            LayerUiState {
                layer_id: summary.layer_id,
                shape_count: summary.shape_count,
                order: summary.order,
                name: summary.name,
                layer_type: summary.layer_type,
                display_role,
                direction: summary.direction,
                width: summary.width,
                pitch_x: summary.pitch_x,
                pitch_y: summary.pitch_y,
                min_spacing: summary.min_spacing,
                min_area: summary.min_area,
                min_step: summary.min_step,
                cut_spacing: summary.cut_spacing,
                enclosure_below: summary.enclosure_below,
                enclosure_above: summary.enclosure_above,
                lef58_rule_count: summary.lef58_rule_count,
                visible: visibility.get(&summary.layer_id).copied().unwrap_or(false),
                style,
            }
        })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum ScreenShapePrimitive {
    Rect(egui::Rect),
    Line {
        begin: egui::Pos2,
        end: egui::Pos2,
        width: f32,
    },
    Point {
        center: egui::Pos2,
        radius: f32,
    },
}

#[cfg(test)]
pub(super) fn paint_styled_shape_geometry(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    style: &LayerStyle,
) -> usize {
    let primitive = shape_screen_primitive(geometry, world, canvas, zoom, pan);
    if !screen_primitive_bounds(primitive).intersects(canvas) {
        return 0;
    }

    match primitive {
        ScreenShapePrimitive::Rect(rect) => paint_styled_rect(painter, rect, canvas, *style),
        ScreenShapePrimitive::Line { begin, end, width } => {
            painter.line_segment(
                [begin, end],
                egui::Stroke::new(
                    width.max(style.line_width_px as f32),
                    color32(style.frame_rgba),
                ),
            );
            1
        }
        ScreenShapePrimitive::Point { center, radius } => {
            painter.circle_filled(center, radius, color32(style.frame_rgba));
            1
        }
    }
}

#[cfg(test)]
pub(super) fn paint_styled_rect(
    painter: &egui::Painter,
    rect: egui::Rect,
    canvas: egui::Rect,
    style: LayerStyle,
) -> usize {
    let visible_rect = rect.intersect(canvas);
    if !visible_rect.is_positive() {
        return 0;
    }
    let mut primitives = 0usize;
    let can_pattern =
        visible_rect.width() >= PATTERN_MIN_SIZE_PX && visible_rect.height() >= PATTERN_MIN_SIZE_PX;
    let fill_color = color32(style.rgba);
    match style.fill_pattern {
        FillPattern::Hollow => {}
        FillPattern::Solid => {
            painter.rect_filled(visible_rect, 0.0, fill_color);
            primitives += 1;
        }
        FillPattern::SparseDots if can_pattern => {
            primitives += draw_pattern_dots(painter, visible_rect, fill_color, 9.0);
        }
        FillPattern::DenseDots if can_pattern => {
            primitives += draw_pattern_dots(painter, visible_rect, fill_color, 5.0);
        }
        FillPattern::DiagonalHatch if can_pattern => {
            primitives += draw_hatch(painter, visible_rect, fill_color, false);
        }
        FillPattern::CrossHatch if can_pattern => {
            primitives += draw_hatch(painter, visible_rect, fill_color, true);
        }
        FillPattern::HorizontalHatch if can_pattern => {
            primitives += draw_axis_hatch(
                painter,
                visible_rect,
                fill_color,
                HatchAxis::Horizontal,
                MAX_PATTERN_OPS_PER_SHAPE,
            );
        }
        FillPattern::VerticalHatch if can_pattern => {
            primitives += draw_axis_hatch(
                painter,
                visible_rect,
                fill_color,
                HatchAxis::Vertical,
                MAX_PATTERN_OPS_PER_SHAPE,
            );
        }
        FillPattern::Grid if can_pattern => {
            let first = draw_axis_hatch(
                painter,
                visible_rect,
                fill_color,
                HatchAxis::Horizontal,
                MAX_PATTERN_OPS_PER_SHAPE / 2,
            );
            primitives += first
                + draw_axis_hatch(
                    painter,
                    visible_rect,
                    fill_color,
                    HatchAxis::Vertical,
                    MAX_PATTERN_OPS_PER_SHAPE - first.min(MAX_PATTERN_OPS_PER_SHAPE / 2),
                );
        }
        FillPattern::XMark => {
            painter.rect_filled(visible_rect, 0.0, fill_color);
            primitives += 1;
            if visible_rect.width() >= 6.0 && visible_rect.height() >= 6.0 {
                primitives += draw_x_mark(
                    painter,
                    visible_rect,
                    color32(style.frame_rgba),
                    style.line_width_px.max(1) as f32,
                );
            }
        }
        _ => {}
    }

    if rect.width() >= MIN_SHAPE_SCREEN_SIZE || rect.height() >= MIN_SHAPE_SCREEN_SIZE {
        let mut frame_rgba = style.frame_rgba;
        if rect.width() < PATTERN_FRAME_FADE_SIZE_PX || rect.height() < PATTERN_FRAME_FADE_SIZE_PX {
            frame_rgba[3] = frame_rgba[3].min(112);
        }
        painter.rect_stroke(
            rect,
            0.0,
            egui::Stroke::new(style.line_width_px.max(1) as f32, color32(frame_rgba)),
            egui::StrokeKind::Inside,
        );
        primitives += 1;
    }
    primitives
}

#[cfg(test)]
pub(super) fn draw_pattern_dots(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    spacing: f32,
) -> usize {
    let x_start = rect.left() + 2.0;
    let x_end = rect.right() - 2.0;
    let y_start = rect.top() + 2.0;
    let y_end = rect.bottom() - 2.0;
    let x_source_count = pattern_sample_count(x_start, x_end, spacing);
    let y_source_count = pattern_sample_count(y_start, y_end, spacing);
    let (x_samples, y_samples) =
        pattern_capped_grid(x_source_count, y_source_count, MAX_PATTERN_OPS_PER_SHAPE);
    let mut count = 0usize;
    for y_index in 0..y_samples {
        let y =
            pattern_sample_position(y_start, y_end, spacing, y_source_count, y_samples, y_index);
        for x_index in 0..x_samples {
            let x = pattern_sample_position(
                x_start,
                x_end,
                spacing,
                x_source_count,
                x_samples,
                x_index,
            );
            painter.circle_filled(egui::pos2(x, y), 0.8, color);
            count += 1;
        }
    }
    count
}

#[cfg(test)]
pub(super) fn draw_hatch(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    cross: bool,
) -> usize {
    let first_limit = if cross {
        MAX_PATTERN_OPS_PER_SHAPE / 2
    } else {
        MAX_PATTERN_OPS_PER_SHAPE
    };
    let mut count = draw_hatch_direction(painter, rect, color, false, first_limit);
    if cross {
        count += draw_hatch_direction(
            painter,
            rect,
            color,
            true,
            MAX_PATTERN_OPS_PER_SHAPE - count.min(MAX_PATTERN_OPS_PER_SHAPE / 2),
        );
    }
    count
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum HatchAxis {
    Horizontal,
    Vertical,
}

#[cfg(test)]
pub(super) fn draw_axis_hatch(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    axis: HatchAxis,
    max_ops: usize,
) -> usize {
    let extent = match axis {
        HatchAxis::Horizontal => rect.height(),
        HatchAxis::Vertical => rect.width(),
    };
    let source_count = pattern_sample_count(4.0, extent, 10.0);
    let sample_count = source_count.min(max_ops);
    let mut count = 0usize;
    for index in 0..sample_count {
        let offset = pattern_sample_position(4.0, extent, 10.0, source_count, sample_count, index);
        match axis {
            HatchAxis::Horizontal => {
                let y = rect.top() + offset;
                if y <= rect.bottom() {
                    painter.line_segment(
                        [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
                        egui::Stroke::new(1.0_f32, color),
                    );
                    count += 1;
                }
            }
            HatchAxis::Vertical => {
                let x = rect.left() + offset;
                if x <= rect.right() {
                    painter.line_segment(
                        [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                        egui::Stroke::new(1.0_f32, color),
                    );
                    count += 1;
                }
            }
        }
    }
    count
}

#[cfg(test)]
pub(super) fn draw_x_mark(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    width: f32,
) -> usize {
    let inset = 1.5_f32.min(rect.width() * 0.2).min(rect.height() * 0.2);
    let rect = rect.shrink(inset);
    if !rect.is_positive() {
        return 0;
    }
    let stroke = egui::Stroke::new(width, color);
    painter.line_segment([rect.left_top(), rect.right_bottom()], stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], stroke);
    2
}

pub(super) fn paint_render_stats_overlay(
    painter: &egui::Painter,
    canvas: egui::Rect,
    stats: &CanvasRenderStats,
) {
    let margin = 10.0;
    let overlay_width = 320.0;
    let overlay_height = 110.0;
    let top_right = egui::pos2(
        canvas.right() - margin - overlay_width,
        canvas.top() + margin,
    );
    let rect = egui::Rect::from_min_size(top_right, egui::vec2(overlay_width, overlay_height));

    painter.rect_filled(rect, 6.0, egui::Color32::from_black_alpha(200));
    painter.rect_stroke(
        rect,
        6.0,
        egui::Stroke::new(1.0_f32, ecos_border()),
        egui::StrokeKind::Outside,
    );

    let lines = [
        format!(
            "Frame: {:.2} ms | Paint: {:.2} ms | Labels: {:.2} ms",
            stats.frame_time_ms, stats.paint_time_ms, stats.label_paint_time_ms
        ),
        format!(
            "Query: {:.2} ms | Filter: {:.2} ms",
            stats.query_time_ms, stats.filter_time_ms
        ),
        format!(
            "Engine: {} | Mode: {} | Zoom: {:.2}",
            if stats.is_gpu { "GPU" } else { "CPU Fallback" },
            if stats.use_view_tiles {
                "Tiles"
            } else {
                "Exact"
            },
            stats.zoom
        ),
        format!(
            "Shapes: {} | Est Primitives: {}",
            stats.drawn_shapes, stats.estimated_primitives
        ),
        format!(
            "Labels: {} | DRC: {} | Antenna: {}",
            stats.label_count, stats.visible_drc_count, stats.visible_antenna_count
        ),
    ];

    let font_id = egui::FontId::monospace(11.0);
    let text_color = egui::Color32::from_rgb(220, 225, 230);
    let mut y = rect.top() + 8.0;
    for line in lines {
        painter.text(
            egui::pos2(rect.left() + 10.0, y),
            egui::Align2::LEFT_TOP,
            line,
            font_id.clone(),
            text_color,
        );
        y += 18.0;
    }
}

pub(super) fn record_render_stats(stats: &CanvasRenderStats) {
    let now = Instant::now();
    let last_at = LAST_RENDER_STATS_AT.get_or_init(|| Mutex::new(None));
    let mut sample = stats.clone();
    if let Ok(mut last_at) = last_at.lock() {
        sample.frame_interval_ms = last_at
            .replace(now)
            .map(|last| last.elapsed().as_secs_f32() * 1000.0)
            .unwrap_or_default();
    }
    let logger = RENDER_STATS_LOGGER.get_or_init(|| {
        let path = std::env::var_os(RENDER_STATS_LOG_ENV)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)
            .ok()?;
        Some(Mutex::new(LineWriter::new(file)))
    });
    let Some(logger) = logger else {
        return;
    };
    let Ok(mut logger) = logger.lock() else {
        return;
    };
    if serde_json::to_writer(&mut *logger, &sample).is_ok() {
        let _ = logger.write_all(b"\n");
    }
}

pub(super) fn shape_label_info(
    geometry: &ShapeGeometry,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
    shape_id: ShapeId,
) -> Option<GpuCachedLabel> {
    let ShapeGeometry::Rect(rect) = geometry else {
        return None;
    };
    let owner = owner?;
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    let owner_name = owner_name?.trim();
    let kind = shape_label_kind(owner_type, owner)?;
    let text = shape_label_text(kind, owner_type, owner, owner_name)?;
    let key = shape_label_key(kind, owner, owner_name);

    Some(GpuCachedLabel {
        shape_id,
        key,
        rect: *rect,
        text,
        kind,
        category: crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY,
        context_only: false,
    })
}

pub(super) fn shape_label_kind(owner_type: OwnerType, owner: &OwnerRef) -> Option<ShapeLabelKind> {
    Some(match owner_type {
        OwnerType::IoPinPortShape => ShapeLabelKind::IoPin,
        OwnerType::PinPortShape if owner.path0 == 0 => ShapeLabelKind::IoPin,
        OwnerType::PinPortShape | OwnerType::InstancePinPortShape => ShapeLabelKind::Pin,
        OwnerType::NetWireSegment => ShapeLabelKind::Net,
        OwnerType::SpecialWireSegment => ShapeLabelKind::Pdn,
        OwnerType::InstanceBBox => ShapeLabelKind::Instance,
        _ => return None,
    })
}

pub(super) fn shape_label_candidate(
    geometry: ShapeGeometry,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
    selected: bool,
    highlighted: bool,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Option<ShapeLabelCandidate> {
    let ShapeGeometry::Rect(rect) = geometry else {
        return None;
    };
    let screen_rect = shape_screen_rect(rect, world, canvas, zoom, pan);
    let visible_rect = screen_rect.intersect(canvas);
    if !screen_rect.is_positive() || !visible_rect.is_positive() {
        return None;
    }

    let owner = owner?;
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    let owner_name = owner_name?.trim();
    let kind = shape_label_kind(owner_type, owner)?;
    let text = shape_label_text(kind, owner_type, owner, owner_name)?;
    let key = shape_label_key(kind, owner, owner_name);

    Some(ShapeLabelCandidate {
        key,
        anchor_rect: screen_rect,
        text,
        kind,
        rank_area: visible_rect.area(),
        selected,
        highlighted,
    })
}

pub(super) fn shape_label_text(
    kind: ShapeLabelKind,
    owner_type: OwnerType,
    owner: &OwnerRef,
    owner_name: &str,
) -> Option<String> {
    let text = match kind {
        ShapeLabelKind::Pin
            if matches!(
                owner_type,
                OwnerType::PinPortShape | OwnerType::InstancePinPortShape
            ) && owner.path0 != 0 =>
        {
            local_shape_label_name(owner_name)
        }
        _ => owner_name,
    }
    .trim();
    (!text.is_empty()).then(|| text.to_string())
}

pub(super) fn local_shape_label_name(name: &str) -> &str {
    name.rsplit_once('/')
        .map(|(_, local_name)| local_name)
        .unwrap_or(name)
}

pub(super) fn shape_label_key(
    kind: ShapeLabelKind,
    owner: &OwnerRef,
    owner_name: &str,
) -> ShapeLabelKey {
    match kind {
        ShapeLabelKind::IoPin | ShapeLabelKind::Net | ShapeLabelKind::Pdn => ShapeLabelKey::Named {
            kind,
            text: owner_name.trim().to_string(),
        },
        ShapeLabelKind::Pin | ShapeLabelKind::Instance => ShapeLabelKey::Owner {
            owner_type: owner.owner_type,
            owner_id: owner.owner_id,
        },
    }
}

pub(super) fn paint_shape_label_overlay(
    painter: &egui::Painter,
    overlay: &ShapeLabelOverlay,
    canvas: egui::Rect,
) -> bool {
    let text_rect = overlay.rect.intersect(canvas);
    let clip_rect = overlay.anchor_rect.intersect(canvas);
    if !text_rect.is_positive() || !clip_rect.is_positive() {
        return false;
    }

    let (color, shadow) = match overlay.kind {
        ShapeLabelKind::IoPin | ShapeLabelKind::Pin => {
            (egui::Color32::WHITE, egui::Color32::from_black_alpha(230))
        }
        ShapeLabelKind::Net => (
            egui::Color32::from_rgba_unmultiplied(232, 250, 255, 220),
            egui::Color32::from_black_alpha(210),
        ),
        ShapeLabelKind::Pdn => (
            egui::Color32::from_rgba_unmultiplied(255, 239, 170, 230),
            egui::Color32::from_black_alpha(210),
        ),
        ShapeLabelKind::Instance => (
            egui::Color32::from_rgba_unmultiplied(235, 238, 242, 180),
            egui::Color32::from_black_alpha(210),
        ),
    };

    let font = egui::FontId::proportional(overlay.font_size);
    let clipped = painter.with_clip_rect(clip_rect);
    let galley = painter.layout_no_wrap(overlay.text.clone(), font, color);
    let angle = if overlay.vertical {
        std::f32::consts::FRAC_PI_2
    } else {
        0.0
    };
    let text_position = if overlay.vertical {
        overlay.rect.center() + egui::vec2(overlay.text_size.y * 0.5, -overlay.text_size.x * 0.5)
    } else {
        overlay.rect.center() - overlay.text_size * 0.5
    };
    clipped.add(
        egui::epaint::TextShape::new(text_position + egui::vec2(1.0, 1.0), galley.clone(), shadow)
            .with_override_text_color(shadow)
            .with_angle(angle),
    );
    clipped.add(
        egui::epaint::TextShape::new(text_position, galley, color)
            .with_override_text_color(color)
            .with_angle(angle),
    );
    true
}

#[cfg(test)]
pub(super) fn draw_hatch_direction(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    reverse: bool,
    max_ops: usize,
) -> usize {
    let width = rect.width().floor();
    let height = rect.height().floor();
    let offset_start = -height;
    let offset_end = (width - 3.0).max(offset_start);
    let source_count = pattern_sample_count(offset_start, offset_end, 8.0);
    let sample_count = source_count.min(max_ops);
    let mut count = 0usize;
    for index in 0..sample_count {
        let offset = pattern_sample_position(
            offset_start,
            offset_end,
            8.0,
            source_count,
            sample_count,
            index,
        );
        let begin = (-offset).max(0.0).min(height);
        let end = (width - offset).min(height);
        if end - begin >= 3.0 {
            let x0 = rect.left() + offset + begin;
            let x1 = rect.left() + offset + end;
            let (y0, y1) = if reverse {
                (rect.bottom() - begin, rect.bottom() - end)
            } else {
                (rect.top() + begin, rect.top() + end)
            };
            painter.line_segment(
                [egui::pos2(x0, y0), egui::pos2(x1, y1)],
                egui::Stroke::new(1.0_f32, color),
            );
            count += 1;
        }
    }
    count
}

#[cfg(test)]
pub(super) fn pattern_sample_count(start: f32, end: f32, spacing: f32) -> usize {
    if !start.is_finite() || !end.is_finite() || !spacing.is_finite() || spacing <= 0.0 {
        return 0;
    }
    if end < start {
        return 0;
    }
    ((end - start) / spacing).floor() as usize + 1
}

#[cfg(test)]
pub(super) fn pattern_sample_position(
    start: f32,
    end: f32,
    spacing: f32,
    source_count: usize,
    samples: usize,
    index: usize,
) -> f32 {
    if source_count <= samples || samples <= 1 {
        return start + index as f32 * spacing;
    }
    start + (end - start) * index as f32 / (samples - 1) as f32
}

#[cfg(test)]
pub(super) fn pattern_capped_grid(
    horizontal: usize,
    vertical: usize,
    max_ops: usize,
) -> (usize, usize) {
    if horizontal == 0 || vertical == 0 || max_ops == 0 {
        return (0, 0);
    }
    if horizontal.saturating_mul(vertical) <= max_ops {
        return (horizontal, vertical);
    }

    let aspect = horizontal as f32 / vertical as f32;
    let mut horizontal_samples = ((max_ops as f32 * aspect).sqrt() as usize)
        .max(1)
        .min(horizontal);
    let mut vertical_samples = (max_ops / horizontal_samples).max(1).min(vertical);
    while horizontal_samples.saturating_mul(vertical_samples) > max_ops {
        if horizontal_samples >= vertical_samples {
            horizontal_samples = horizontal_samples.saturating_sub(1).max(1);
        } else {
            vertical_samples = vertical_samples.saturating_sub(1).max(1);
        }
    }
    (horizontal_samples, vertical_samples)
}

pub(super) fn shape_screen_primitive(
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> ScreenShapePrimitive {
    match geometry {
        ShapeGeometry::Rect(rect) => {
            ScreenShapePrimitive::Rect(shape_screen_rect(rect, world, canvas, zoom, pan))
        }
        ShapeGeometry::Line(line) => {
            let scale = world_to_screen_scale(world, canvas, zoom);
            ScreenShapePrimitive::Line {
                begin: world_to_screen_point(line.begin, world, canvas, zoom, pan),
                end: world_to_screen_point(line.end, world, canvas, zoom, pan),
                width: ((line.width.abs().max(1)) as f32 * scale).max(MIN_SHAPE_SCREEN_SIZE),
            }
        }
        ShapeGeometry::Point(point) => ScreenShapePrimitive::Point {
            center: world_to_screen_point(point.point, world, canvas, zoom, pan),
            radius: MIN_SHAPE_SCREEN_SIZE,
        },
    }
}

pub(super) fn shape_overlay_primitive(
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> ScreenShapePrimitive {
    shape_screen_primitive(geometry, world, canvas, zoom, pan)
}

pub(super) fn paint_shape_overlay(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    stroke: egui::Stroke,
) -> bool {
    let primitive = shape_overlay_primitive(geometry, world, canvas, zoom, pan);
    if !screen_primitive_bounds(primitive).intersects(canvas) {
        return false;
    }

    match primitive {
        ScreenShapePrimitive::Rect(rect) => {
            painter.rect_stroke(rect.expand(1.5), 0.0, stroke, egui::StrokeKind::Inside);
        }
        ScreenShapePrimitive::Line { begin, end, .. } => {
            painter.line_segment([begin, end], stroke);
        }
        ScreenShapePrimitive::Point { center, radius } => {
            painter.circle_stroke(center, radius + 1.5, stroke);
        }
    }
    true
}

pub(super) fn search_highlight_outer_stroke() -> egui::Stroke {
    egui::Stroke::new(4.0_f32, egui::Color32::from_rgb(255, 64, 192))
}

pub(super) fn search_highlight_inner_stroke() -> egui::Stroke {
    egui::Stroke::new(1.5_f32, egui::Color32::from_rgb(255, 248, 210))
}

pub(super) fn clock_tree_highlight_strokes(
    role: clock_tree::ClockTreeHighlightRole,
) -> (egui::Stroke, egui::Stroke) {
    match role {
        clock_tree::ClockTreeHighlightRole::Parent => (
            egui::Stroke::new(4.0_f32, egui::Color32::from_rgb(74, 222, 128)),
            egui::Stroke::new(1.5_f32, egui::Color32::from_rgb(226, 255, 238)),
        ),
        clock_tree::ClockTreeHighlightRole::Child => (
            egui::Stroke::new(4.0_f32, egui::Color32::from_rgb(255, 166, 64)),
            egui::Stroke::new(1.5_f32, egui::Color32::from_rgb(255, 244, 220)),
        ),
    }
}

pub(super) fn clock_tree_node_marker_vertices(
    center: egui::Pos2,
    radius: f32,
    apex_up: bool,
) -> [egui::Pos2; 3] {
    if apex_up {
        [
            egui::pos2(center.x, center.y - radius),
            egui::pos2(center.x + radius, center.y + radius),
            egui::pos2(center.x - radius, center.y + radius),
        ]
    } else {
        [
            egui::pos2(center.x - radius, center.y - radius),
            egui::pos2(center.x + radius, center.y - radius),
            egui::pos2(center.x, center.y + radius),
        ]
    }
}

pub(super) fn paint_clock_tree_node_markers(
    painter: &egui::Painter,
    markers: &[clock_tree::ClockTreeNodeMarker],
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) {
    let outline = egui::Color32::from_rgb(8, 12, 18);
    for marker in markers {
        let (radius, fill, stroke) = match marker.kind {
            clock_tree::ClockTreeNodeMarkerKind::Parent => (
                CLOCK_TREE_NODE_MARKER_RADIUS_PX,
                egui::Color32::from_rgb(74, 222, 128),
                egui::Stroke::new(1.25, outline),
            ),
            clock_tree::ClockTreeNodeMarkerKind::Child => (
                CLOCK_TREE_NODE_MARKER_RADIUS_PX,
                egui::Color32::from_rgb(255, 166, 64),
                egui::Stroke::new(1.25, outline),
            ),
            clock_tree::ClockTreeNodeMarkerKind::Selected => (
                CLOCK_TREE_SELECTED_MARKER_RADIUS_PX,
                egui::Color32::WHITE,
                egui::Stroke::new(2.5, outline),
            ),
        };
        let center = world_to_screen_point(marker.position, world, canvas, zoom, pan);
        if !canvas.expand(radius + 2.0).contains(center) {
            continue;
        }
        painter.add(egui::Shape::convex_polygon(
            clock_tree_node_marker_vertices(center, radius, marker.apex_up).to_vec(),
            fill,
            stroke,
        ));
    }
}

pub(super) fn paint_clock_tree_highlight_overlay(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    role: clock_tree::ClockTreeHighlightRole,
) -> bool {
    let (outer, inner) = clock_tree_highlight_strokes(role);
    paint_shape_overlay(painter, geometry, world, canvas, zoom, pan, outer)
        | paint_shape_overlay(painter, geometry, world, canvas, zoom, pan, inner)
}

pub(super) fn paint_search_highlight_overlay(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> bool {
    let outer = paint_shape_overlay(
        painter,
        geometry,
        world,
        canvas,
        zoom,
        pan,
        search_highlight_outer_stroke(),
    );
    let inner = paint_shape_overlay(
        painter,
        geometry,
        world,
        canvas,
        zoom,
        pan,
        search_highlight_inner_stroke(),
    );
    outer || inner
}

pub(super) fn drc_overlay_primary_color() -> egui::Color32 {
    egui::Color32::from_rgb(250, 250, 255)
}

pub(super) fn antenna_overlay_primary_color() -> egui::Color32 {
    egui::Color32::from_rgb(250, 250, 255)
}

pub(super) fn drc_overlay_secondary_color() -> egui::Color32 {
    egui::Color32::from_rgb(0, 191, 165)
}

pub(super) fn antenna_overlay_secondary_color() -> egui::Color32 {
    egui::Color32::from_rgb(0, 191, 165)
}

pub(super) fn drc_violation_screen_rect(
    violation: &DrcViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    expand_screen_rect_to_min_size(
        world_to_screen_rect(violation.bbox, world, canvas, zoom, pan),
        8.0,
    )
}

pub(super) fn antenna_violation_screen_rect(
    violation: &AntennaViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    expand_screen_rect_to_min_size(
        world_to_screen_rect(violation.bbox, world, canvas, zoom, pan),
        8.0,
    )
}

pub(super) fn paint_drc_violation_overlay(
    painter: &egui::Painter,
    violation: &DrcViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    selected: bool,
) -> bool {
    let rect = drc_violation_screen_rect(violation, world, canvas, zoom, pan);
    if !rect.intersects(canvas) {
        return false;
    }

    let stroke = egui::Stroke::new(
        if selected { 4.0_f32 } else { 3.0_f32 },
        if selected {
            drc_overlay_secondary_color()
        } else {
            drc_overlay_primary_color()
        },
    );
    let inner_stroke = egui::Stroke::new(1.5_f32, drc_overlay_primary_color());
    let rect = rect.expand(1.5);
    painter.rect_stroke(rect, 0.0, stroke, egui::StrokeKind::Inside);
    painter.line_segment([rect.left_top(), rect.right_bottom()], inner_stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], inner_stroke);
    true
}

pub(super) fn paint_antenna_violation_overlay(
    painter: &egui::Painter,
    violation: &AntennaViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    selected: bool,
) -> bool {
    let rect = antenna_violation_screen_rect(violation, world, canvas, zoom, pan);
    if !rect.intersects(canvas) {
        return false;
    }

    let stroke = egui::Stroke::new(
        if selected { 4.0_f32 } else { 3.0_f32 },
        if selected {
            antenna_overlay_secondary_color()
        } else {
            antenna_overlay_primary_color()
        },
    );
    let inner_stroke = egui::Stroke::new(1.5_f32, antenna_overlay_primary_color());
    let rect = rect.expand(1.5);
    painter.rect_stroke(rect, 0.0, stroke, egui::StrokeKind::Inside);
    painter.line_segment([rect.left_top(), rect.right_bottom()], inner_stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], inner_stroke);
    true
}

pub(super) fn paint_lvs_anomaly_overlay(
    painter: &egui::Painter,
    shape: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> bool {
    let rect =
        expand_screen_rect_to_min_size(world_to_screen_rect(shape, world, canvas, zoom, pan), 3.0);
    if !rect.intersects(canvas) {
        return false;
    }

    painter.rect_filled(
        rect,
        0.0,
        egui::Color32::from_rgba_unmultiplied(255, 255, 255, 44),
    );
    painter.rect_stroke(
        rect.expand(1.0),
        0.0,
        egui::Stroke::new(2.0_f32, egui::Color32::WHITE),
        egui::StrokeKind::Inside,
    );
    true
}

pub(super) fn drc_detail_lines(violation: &DrcViolation) -> Vec<String> {
    let mut lines = vec![
        format!("type: {}", violation.drc_type),
        format!("layer: {}", violation.layer),
        format!(
            "bbox: ({}, {}) - ({}, {})",
            violation.bbox.lx, violation.bbox.ly, violation.bbox.hx, violation.bbox.hy
        ),
    ];
    if let Some(required_size) = violation.required_size {
        lines.push(format!("required size: {required_size}"));
    }
    if !violation.nets.is_empty() {
        lines.push(format!("nets: {}", violation.nets.join(", ")));
    }
    if !violation.insts.is_empty() {
        lines.push(format!("instances: {}", violation.insts.join(", ")));
    }
    lines
}

pub(super) fn antenna_detail_lines(violation: &AntennaViolation) -> Vec<String> {
    let mut lines = vec![
        format!("type: {}", violation.antenna_type),
        format!("layer: {}", violation.layer),
        format!(
            "bbox: ({}, {}) - ({}, {})",
            violation.bbox.lx, violation.bbox.ly, violation.bbox.hx, violation.bbox.hy
        ),
    ];
    if let Some(required_size) = violation.required_size {
        lines.push(format!("required size: {required_size}"));
    }
    if !violation.nets.is_empty() {
        lines.push(format!("nets: {}", violation.nets.join(", ")));
    }
    if !violation.insts.is_empty() {
        lines.push(format!("instances: {}", violation.insts.join(", ")));
    }
    lines
}

pub(super) fn paint_parameterized_grid_overlay(
    painter: &egui::Painter,
    grids: &[GridMetadata],
    layers: &[LayerUiState],
    visibility: ObjectVisibility,
    viewport: Rect32,
    grid_bounds: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> usize {
    let mut drawn = 0usize;
    for grid in grids {
        if !parameterized_grid_is_visible(grid, layers, visibility, zoom) {
            continue;
        }
        let Some(owner_type) = grid_owner_type(grid) else {
            continue;
        };
        let stroke = parameterized_grid_stroke(grid, layers, owner_type);
        let Some(grid_viewport) = intersect_rect(viewport, grid_bounds) else {
            continue;
        };
        for index in grid_visible_indices(grid, grid_viewport) {
            let coordinate = saturating_i64_to_i32(grid_coordinate_at_index(grid, index));
            let Some((begin, end)) =
                parameterized_grid_line_endpoints(grid, coordinate, grid_viewport, grid_bounds)
            else {
                continue;
            };
            painter.line_segment(
                [
                    world_to_screen_point(begin, world, canvas, zoom, pan),
                    world_to_screen_point(end, world, canvas, zoom, pan),
                ],
                stroke,
            );
            drawn += 1;
        }
    }
    drawn
}

/// Flylines collapse into visual noise below this on-screen span, so they
/// are skipped entirely (most valuable at extreme zoom-out).
const FLYLINE_MIN_SCREEN_SPAN_PX: f32 = 6.0;
/// Per-frame caps for flyline painting. Without them, a full-chip view of a
/// multi-million-pin design pushes hundreds of thousands of dashed segments
/// into the painter every frame, which exhausts memory while zooming.
pub(super) const FLYLINE_MAX_LINES_PER_FRAME: usize = 48_000;
pub(super) const FLYLINE_MAX_SEGMENTS_PER_FRAME: usize = 128_000;

pub(super) fn paint_unrouted_net_guides(
    painter: &egui::Painter,
    guides: &[UnroutedNetGuide],
    visibility: ObjectVisibility,
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> usize {
    let selected =
        select_unrouted_net_guide_lines(guides, visibility, viewport, world, canvas, zoom, pan);
    let mut drawn = 0usize;
    let mut painted_hub_for: Option<usize> = None;
    for (guide_index, pin_index) in selected {
        let guide = &guides[guide_index];
        let category = net_kind_drawing_category(Some(&guide.net_kind));
        let stroke = unrouted_net_guide_stroke(category);
        let hub = world_to_screen_point(guide.hub, world, canvas, zoom, pan);
        if painted_hub_for != Some(guide_index) {
            painted_hub_for = Some(guide_index);
            if canvas.contains(hub) {
                painter.circle_filled(hub, 2.5, stroke.color);
            }
        }
        let endpoint =
            world_to_screen_point(guide.pin_centers[pin_index], world, canvas, zoom, pan);
        if paint_dashed_line(painter, hub, endpoint, stroke, 8.0, 5.0) {
            drawn += 1;
        }
    }
    drawn
}

/// Selects the `(guide_index, pin_index)` flylines to paint this frame.
///
/// Selection is deterministic for a stable viewport: a screen-size filter
/// drops guides that are invisible small, then a stride keeps the line count
/// within `FLYLINE_MAX_LINES_PER_FRAME` and a segment budget within
/// `FLYLINE_MAX_SEGMENTS_PER_FRAME`, so panning and zooming paint a bounded
/// amount of work instead of every flyline in the design.
pub(super) fn select_unrouted_net_guide_lines(
    guides: &[UnroutedNetGuide],
    visibility: ObjectVisibility,
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Vec<(usize, usize)> {
    let mut total_lines = 0usize;
    let mut visible_guides = Vec::new();
    for (guide_index, guide) in guides.iter().enumerate() {
        if !unrouted_net_guide_is_visible(guide, visibility, viewport) {
            continue;
        }
        if flyline_screen_span_px(guide.bbox, world, canvas, zoom, pan) < FLYLINE_MIN_SCREEN_SPAN_PX
        {
            continue;
        }
        let hub = world_to_screen_point(guide.hub, world, canvas, zoom, pan);
        let pin_hits: Vec<usize> = guide
            .pin_centers
            .iter()
            .enumerate()
            .filter(|(_, pin)| {
                screen_line_bounds(hub, world_to_screen_point(**pin, world, canvas, zoom, pan))
                    .intersects(canvas)
            })
            .map(|(pin_index, _)| pin_index)
            .collect();
        total_lines += pin_hits.len();
        visible_guides.push((guide_index, guide, hub, pin_hits));
    }
    if total_lines == 0 {
        return Vec::new();
    }
    let stride = total_lines.div_ceil(FLYLINE_MAX_LINES_PER_FRAME);
    let mut selected = Vec::new();
    let mut line_no = 0usize;
    let mut segments_left = FLYLINE_MAX_SEGMENTS_PER_FRAME;
    for (guide_index, guide, hub, pin_hits) in visible_guides {
        for pin_index in pin_hits {
            if line_no % stride != 0 {
                line_no += 1;
                continue;
            }
            line_no += 1;
            let end = world_to_screen_point(guide.pin_centers[pin_index], world, canvas, zoom, pan);
            let segment_count = dashed_line_segment_count(hub, end, 8.0, 5.0);
            if segment_count > segments_left {
                continue;
            }
            segments_left -= segment_count;
            selected.push((guide_index, pin_index));
        }
    }
    selected
}

pub(super) fn flyline_screen_span_px(
    bbox: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> f32 {
    let screen = world_to_screen_rect(bbox, world, canvas, zoom, pan);
    screen.width().hypot(screen.height())
}

/// Segment count of [`dashed_line_segments`] without allocating.
pub(super) fn dashed_line_segment_count(
    begin: egui::Pos2,
    end: egui::Pos2,
    dash_length: f32,
    gap_length: f32,
) -> usize {
    let length = (end - begin).length();
    if length <= 0.5 {
        return 0;
    }
    let dash_length = dash_length.max(1.0);
    let step = (dash_length + gap_length.max(1.0)).max(2.0);
    (length / step).ceil().min(256.0) as usize
}

pub(super) fn unrouted_net_guide_is_visible(
    guide: &UnroutedNetGuide,
    visibility: ObjectVisibility,
    viewport: Rect32,
) -> bool {
    guide.bbox.intersects(viewport)
        && visibility.is_category_visible(net_kind_drawing_category(Some(&guide.net_kind)))
}

pub(super) fn unrouted_net_guide_stroke(category: DrawingCategory) -> egui::Stroke {
    let color = match category {
        DrawingCategory::NetClock => egui::Color32::from_rgba_unmultiplied(255, 114, 216, 146),
        DrawingCategory::NetSignal => egui::Color32::from_rgba_unmultiplied(0, 191, 165, 132),
        DrawingCategory::NetOther => egui::Color32::from_rgba_unmultiplied(228, 176, 72, 132),
        _ => egui::Color32::from_rgba_unmultiplied(180, 190, 204, 120),
    };
    egui::Stroke::new(1.25_f32, color)
}

pub(super) fn paint_dashed_line(
    painter: &egui::Painter,
    begin: egui::Pos2,
    end: egui::Pos2,
    stroke: egui::Stroke,
    dash_length: f32,
    gap_length: f32,
) -> bool {
    let segments = dashed_line_segments(begin, end, dash_length, gap_length);
    let painted = !segments.is_empty();
    for (dash_begin, dash_end) in segments {
        painter.line_segment([dash_begin, dash_end], stroke);
    }
    painted
}

pub(super) fn dashed_line_segments(
    begin: egui::Pos2,
    end: egui::Pos2,
    dash_length: f32,
    gap_length: f32,
) -> Vec<(egui::Pos2, egui::Pos2)> {
    let delta = end - begin;
    let length = delta.length();
    if length <= 0.5 {
        return Vec::new();
    }

    let dash_length = dash_length.max(1.0);
    let step = (dash_length + gap_length.max(1.0)).max(2.0);
    let direction = delta / length;
    let mut segments = Vec::new();
    let mut offset = 0.0f32;
    while offset < length && segments.len() < 256 {
        let dash_end = (offset + dash_length).min(length);
        segments.push((begin + direction * offset, begin + direction * dash_end));
        offset += step;
    }
    segments
}

pub(super) fn screen_line_bounds(begin: egui::Pos2, end: egui::Pos2) -> egui::Rect {
    egui::Rect::from_min_max(
        egui::pos2(begin.x.min(end.x), begin.y.min(end.y)),
        egui::pos2(begin.x.max(end.x), begin.y.max(end.y)),
    )
}

pub(super) fn parameterized_grid_is_visible(
    grid: &GridMetadata,
    layers: &[LayerUiState],
    visibility: ObjectVisibility,
    zoom: f32,
) -> bool {
    let Some(owner_type) = grid_owner_type(grid) else {
        return false;
    };
    zoom > 1.25
        && visibility.includes_owner_type(owner_type as u8)
        && grid_layer_filter_is_visible(grid, layers)
        && grid.step > 0
        && grid.count > 0
}

pub(super) fn grid_owner_type(grid: &GridMetadata) -> Option<OwnerType> {
    match grid.grid_type.trim().to_ascii_lowercase().as_str() {
        "track" => Some(OwnerType::TrackGrid),
        "gcell" => Some(OwnerType::GCellGrid),
        _ => None,
    }
}

pub(super) fn grid_layer_filter_is_visible(grid: &GridMetadata, layers: &[LayerUiState]) -> bool {
    if grid.layer_names.is_empty() {
        return true;
    }
    grid.layer_names.iter().any(|name| {
        layers
            .iter()
            .any(|layer| layer.visible && layer.name.as_str() == name.as_str())
    })
}

pub(super) fn parameterized_grid_stroke(
    grid: &GridMetadata,
    layers: &[LayerUiState],
    owner_type: OwnerType,
) -> egui::Stroke {
    if let Some(style) = grid_layer_style(grid, layers) {
        let (width, alpha) = match owner_type {
            OwnerType::TrackGrid => (1.0_f32, 82),
            OwnerType::GCellGrid => (2.0_f32, 104),
            _ => (1.0_f32, style.frame_alpha),
        };
        return egui::Stroke::new(
            width,
            egui::Color32::from_rgba_unmultiplied(
                style.rgba[0],
                style.rgba[1],
                style.rgba[2],
                alpha,
            ),
        );
    }

    match owner_type {
        OwnerType::TrackGrid => egui::Stroke::new(
            1.0_f32,
            egui::Color32::from_rgba_unmultiplied(
                LAYOUT_GEOMETRY_RGB[0],
                LAYOUT_GEOMETRY_RGB[1],
                LAYOUT_GEOMETRY_RGB[2],
                82,
            ),
        ),
        OwnerType::GCellGrid => egui::Stroke::new(
            2.0_f32,
            egui::Color32::from_rgba_unmultiplied(
                LAYOUT_GEOMETRY_RGB[0],
                LAYOUT_GEOMETRY_RGB[1],
                LAYOUT_GEOMETRY_RGB[2],
                104,
            ),
        ),
        _ => egui::Stroke::new(1.0_f32, ecos_text_secondary()),
    }
}

pub(super) fn grid_layer_style<'a>(
    grid: &GridMetadata,
    layers: &'a [LayerUiState],
) -> Option<&'a LayerStyle> {
    grid.layer_names.iter().find_map(|name| {
        layers
            .iter()
            .find(|layer| layer.visible && layer.name.as_str() == name.as_str())
            .map(|layer| &layer.style)
    })
}

pub(super) fn parameterized_grid_line_endpoints(
    grid: &GridMetadata,
    coordinate: i32,
    viewport: Rect32,
    grid_bounds: Rect32,
) -> Option<(Point32, Point32)> {
    let bounds = intersect_rect(viewport, grid_bounds)?;
    match grid.direction.trim().to_ascii_lowercase().as_str() {
        "x" if coordinate >= bounds.lx && coordinate <= bounds.hx => Some((
            Point32 {
                x: coordinate,
                y: bounds.ly,
            },
            Point32 {
                x: coordinate,
                y: bounds.hy,
            },
        )),
        "y" if coordinate >= bounds.ly && coordinate <= bounds.hy => Some((
            Point32 {
                x: bounds.lx,
                y: coordinate,
            },
            Point32 {
                x: bounds.hx,
                y: coordinate,
            },
        )),
        _ => None,
    }
}

pub(super) fn intersect_rect(lhs: Rect32, rhs: Rect32) -> Option<Rect32> {
    let intersection = Rect32 {
        lx: lhs.lx.max(rhs.lx),
        ly: lhs.ly.max(rhs.ly),
        hx: lhs.hx.min(rhs.hx),
        hy: lhs.hy.min(rhs.hy),
    };
    (intersection.lx <= intersection.hx && intersection.ly <= intersection.hy)
        .then_some(intersection)
}

#[cfg(test)]
pub(super) fn grid_reference_bounds_from_records(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
) -> Option<Rect32> {
    shapes
        .iter()
        .filter(|shape| shape.state == ShapeState::Alive as u8)
        .filter_map(|shape| {
            owners
                .get(shape.owner_index as usize)
                .filter(|owner| owner.owner_type == OwnerType::Die as u8)
                .map(|_| shape.bbox)
        })
        .reduce(union_rect)
}

pub(super) fn grid_visible_indices(grid: &GridMetadata, viewport: Rect32) -> Vec<u32> {
    let Some((first, last)) = grid_visible_index_range(grid, viewport) else {
        return Vec::new();
    };
    let total = (last - first + 1) as usize;
    let stride = total.div_ceil(MAX_PARAMETERIZED_GRID_LINES_PER_GRID).max(1);
    (first..=last).step_by(stride).collect()
}

pub(super) fn grid_visible_index_range(
    grid: &GridMetadata,
    viewport: Rect32,
) -> Option<(u32, u32)> {
    if grid.step <= 0 || grid.count == 0 {
        return None;
    }
    let (min, max) = match grid.direction.trim().to_ascii_lowercase().as_str() {
        "x" => (viewport.lx as i64, viewport.hx as i64),
        "y" => (viewport.ly as i64, viewport.hy as i64),
        _ => return None,
    };
    let first = ceil_div_i64(min.saturating_sub(grid.start), grid.step).max(0);
    let last = floor_div_i64(max.saturating_sub(grid.start), grid.step)
        .min(grid.count.saturating_sub(1) as i64);
    if first > last {
        return None;
    }
    Some((first as u32, last as u32))
}

pub(super) fn grid_coordinate_at_index(grid: &GridMetadata, index: u32) -> i64 {
    grid.start
        .saturating_add(grid.step.saturating_mul(index as i64))
}

pub(super) fn floor_div_i64(numerator: i64, denominator: i64) -> i64 {
    numerator.div_euclid(denominator)
}

pub(super) fn ceil_div_i64(numerator: i64, denominator: i64) -> i64 {
    let quotient = numerator.div_euclid(denominator);
    if numerator.rem_euclid(denominator) == 0 {
        quotient
    } else {
        quotient + 1
    }
}

pub(super) fn saturating_i64_to_i32(value: i64) -> i32 {
    value.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

pub(super) fn paint_scale_ruler(
    painter: &egui::Painter,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 || canvas.width() < 80.0 {
        return;
    }

    let target_px = (canvas.width() * 0.24).clamp(56.0, 120.0);
    let distance_dbu = nice_ruler_distance_dbu(target_px / scale);
    let length_px = distance_dbu as f32 * scale;
    if !length_px.is_finite() || length_px < 8.0 {
        return;
    }

    let start = egui::pos2(canvas.left() + 12.0, canvas.bottom() - 18.0);
    let end = egui::pos2((start.x + length_px).min(canvas.right() - 12.0), start.y);
    if end.x <= start.x + 4.0 {
        return;
    }

    let color = ecos_text_secondary();
    let stroke = egui::Stroke::new(1.0_f32, color);
    painter.line_segment([start, end], stroke);
    painter.line_segment(
        [start + egui::vec2(0.0, -4.0), start + egui::vec2(0.0, 4.0)],
        stroke,
    );
    painter.line_segment(
        [end + egui::vec2(0.0, -4.0), end + egui::vec2(0.0, 4.0)],
        stroke,
    );
    painter.text(
        start + egui::vec2(0.0, -18.0),
        egui::Align2::LEFT_BOTTOM,
        format_distance(distance_dbu, unit, dbu_per_micron),
        egui::FontId::monospace(11.0),
        color,
    );
}

pub(super) fn layout_canvas_rect(frame: egui::Rect) -> egui::Rect {
    egui::Rect::from_min_max(
        egui::pos2(
            (frame.left() + COORDINATE_RULER_THICKNESS).min(frame.right()),
            frame.top(),
        ),
        egui::pos2(
            frame.right(),
            (frame.bottom() - COORDINATE_RULER_THICKNESS).max(frame.top()),
        ),
    )
}

pub(super) fn paint_coordinate_rulers(
    painter: &egui::Painter,
    frame: egui::Rect,
    canvas: egui::Rect,
    world: Rect32,
    zoom: f32,
    pan: egui::Vec2,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 || !canvas.is_positive() {
        return;
    }

    let horizontal = egui::Rect::from_min_max(
        egui::pos2(canvas.left(), canvas.bottom()),
        frame.right_bottom(),
    );
    let vertical = egui::Rect::from_min_max(frame.left_top(), canvas.left_bottom());
    let background = egui::Color32::from_rgb(34, 35, 39);
    let tick_color = egui::Color32::from_rgb(91, 94, 101);
    let text_color = ecos_text_secondary();
    painter.rect_filled(horizontal, 0.0, background);
    painter.rect_filled(vertical, 0.0, background);
    painter.rect_filled(
        egui::Rect::from_min_max(
            egui::pos2(frame.left(), canvas.bottom()),
            egui::pos2(canvas.left(), frame.bottom()),
        ),
        0.0,
        background,
    );
    painter.line_segment(
        [canvas.left_top(), canvas.left_bottom()],
        egui::Stroke::new(1.0, tick_color),
    );
    painter.line_segment(
        [canvas.left_bottom(), canvas.right_bottom()],
        egui::Stroke::new(1.0, tick_color),
    );

    let viewport = screen_to_world_rect(canvas, world, canvas, zoom, pan);
    let major_interval = coordinate_ruler_interval_dbu(scale, unit, dbu_per_micron);
    let minor_interval = if major_interval >= 10 {
        major_interval / 10
    } else {
        major_interval
    }
    .max(1);
    let font = egui::FontId::monospace(9.0);
    let tick_stroke = egui::Stroke::new(1.0, tick_color);

    let mut x = floor_div_i64(i64::from(viewport.lx), minor_interval) * minor_interval;
    let mut last_label_right = f32::NEG_INFINITY;
    let mut tick_count = 0usize;
    while x <= i64::from(viewport.hx) && tick_count < MAX_PARAMETERIZED_GRID_LINES_PER_GRID {
        let point = Point32 {
            x: saturating_i64_to_i32(x),
            y: viewport.ly,
        };
        let screen_x = world_to_screen_point(point, world, canvas, zoom, pan).x;
        if screen_x < canvas.left() || screen_x > canvas.right() {
            x = x.saturating_add(minor_interval);
            tick_count += 1;
            continue;
        }
        let major = x.rem_euclid(major_interval) == 0;
        let height = if major {
            COORDINATE_RULER_THICKNESS * 0.6
        } else {
            COORDINATE_RULER_THICKNESS * 0.3
        };
        painter.line_segment(
            [
                egui::pos2(screen_x, frame.bottom() - height),
                egui::pos2(screen_x, frame.bottom()),
            ],
            tick_stroke,
        );
        if major && screen_x >= canvas.left() && screen_x >= last_label_right + 12.0 {
            let label = format_axis_coordinate(x, unit, dbu_per_micron);
            let rect = painter.text(
                egui::pos2(screen_x + 2.0, horizontal.top() + 2.0),
                egui::Align2::LEFT_TOP,
                label,
                font.clone(),
                text_color,
            );
            last_label_right = rect.right();
        }
        x = x.saturating_add(minor_interval);
        tick_count += 1;
    }

    let mut y = floor_div_i64(i64::from(viewport.ly), minor_interval) * minor_interval;
    let mut last_label_y = f32::NEG_INFINITY;
    let mut tick_count = 0usize;
    while y <= i64::from(viewport.hy) && tick_count < MAX_PARAMETERIZED_GRID_LINES_PER_GRID {
        let point = Point32 {
            x: viewport.lx,
            y: saturating_i64_to_i32(y),
        };
        let screen_y = world_to_screen_point(point, world, canvas, zoom, pan).y;
        if screen_y < canvas.top() || screen_y > canvas.bottom() {
            y = y.saturating_add(minor_interval);
            tick_count += 1;
            continue;
        }
        let major = y.rem_euclid(major_interval) == 0;
        let width = if major {
            COORDINATE_RULER_THICKNESS * 0.6
        } else {
            COORDINATE_RULER_THICKNESS * 0.3
        };
        painter.line_segment(
            [
                egui::pos2(canvas.left() - width, screen_y),
                egui::pos2(canvas.left(), screen_y),
            ],
            tick_stroke,
        );
        if major && screen_y < canvas.bottom() && (screen_y - last_label_y).abs() >= 40.0 {
            let label = format_axis_coordinate(y, unit, dbu_per_micron);
            let galley = painter.layout_no_wrap(label, font.clone(), text_color);
            let position = egui::pos2(vertical.left() + 2.0, screen_y + galley.size().x * 0.5);
            painter.add(
                egui::epaint::TextShape::new(position, galley, text_color)
                    .with_angle(-std::f32::consts::FRAC_PI_2),
            );
            last_label_y = screen_y;
        }
        y = y.saturating_add(minor_interval);
        tick_count += 1;
    }
}

pub(super) fn coordinate_ruler_interval_dbu(
    scale: f32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> i64 {
    let target_dbu = f64::from(COORDINATE_RULER_TARGET_TICK_PX) / f64::from(scale);
    let interval = match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => nice_ruler_interval(target_dbu),
        CoordinateUnit::Micron => {
            let dbu_per_micron = dbu_per_micron.filter(|value| *value > 0).unwrap_or(1);
            nice_ruler_interval(target_dbu / f64::from(dbu_per_micron)) * f64::from(dbu_per_micron)
        }
    };
    interval.round().clamp(1.0, i32::MAX as f64) as i64
}

pub(super) fn format_axis_coordinate(
    value_dbu: i64,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> String {
    let value = match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => value_dbu as f64,
        CoordinateUnit::Micron => {
            value_dbu as f64 / f64::from(dbu_per_micron.filter(|value| *value > 0).unwrap_or(1))
        }
    };
    let magnitude = value.abs();
    if magnitude >= 1_000_000.0 {
        format_compact_number(value / 1_000_000.0, "M")
    } else if magnitude >= 10_000.0 {
        format_compact_number(value / 1_000.0, "K")
    } else {
        format_compact_number(value, "")
    }
}

pub(super) fn format_compact_number(value: f64, suffix: &str) -> String {
    let text = if (value - value.round()).abs() <= 0.000_5 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    };
    format!("{text}{suffix}")
}

pub(super) fn orthogonal_ruler_point(anchor: Point32, pointer: Point32) -> Point32 {
    let dx = (i64::from(pointer.x) - i64::from(anchor.x)).abs();
    let dy = (i64::from(pointer.y) - i64::from(anchor.y)).abs();
    if dx >= dy {
        Point32 {
            x: pointer.x,
            y: anchor.y,
        }
    } else {
        Point32 {
            x: anchor.x,
            y: pointer.y,
        }
    }
}

pub(super) fn nearest_orthogonal_edge_snap(
    anchor: Point32,
    pointer: Point32,
    rects: &[Rect32],
    radius: i32,
) -> Option<Point32> {
    let locked = orthogonal_ruler_point(anchor, pointer);
    let horizontal = locked.y == anchor.y;
    let max_distance_squared = i128::from(radius.max(0)).pow(2);
    let mut nearest: Option<(i128, Point32)> = None;
    let mut consider = |point: Point32| {
        let dx = i128::from(point.x) - i128::from(pointer.x);
        let dy = i128::from(point.y) - i128::from(pointer.y);
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= max_distance_squared
            && nearest.is_none_or(|(best, _)| distance_squared < best)
        {
            nearest = Some((distance_squared, point));
        }
    };

    for rect in rects {
        if horizontal && (rect.ly..=rect.hy).contains(&anchor.y) {
            consider(Point32 {
                x: rect.lx,
                y: anchor.y,
            });
            consider(Point32 {
                x: rect.hx,
                y: anchor.y,
            });
        } else if !horizontal && (rect.lx..=rect.hx).contains(&anchor.x) {
            consider(Point32 {
                x: anchor.x,
                y: rect.ly,
            });
            consider(Point32 {
                x: anchor.x,
                y: rect.hy,
            });
        }
    }
    nearest.map(|(_, point)| point)
}

pub(super) fn ruler_distances(points: &[Point32], preview: Option<Point32>) -> (i64, i64) {
    let mut x_distance = 0i64;
    let mut y_distance = 0i64;
    let mut add_segment = |begin: Point32, end: Point32| {
        x_distance += (i64::from(end.x) - i64::from(begin.x)).abs();
        y_distance += (i64::from(end.y) - i64::from(begin.y)).abs();
    };
    for pair in points.windows(2) {
        add_segment(pair[0], pair[1]);
    }
    if let (Some(begin), Some(end)) = (points.last().copied(), preview) {
        add_segment(begin, end);
    }
    (x_distance, y_distance)
}

pub(super) fn ruler_status_line(
    points: &[Point32],
    preview: Option<Point32>,
    active: bool,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> Option<String> {
    (!points.is_empty()).then(|| {
        let (x_distance, y_distance) = ruler_distances(points, preview);
        format!(
            "ruler{}: X {}, Y {}",
            if active { "" } else { " done" },
            format_distance_i64(x_distance, unit, dbu_per_micron),
            format_distance_i64(y_distance, unit, dbu_per_micron)
        )
    })
}

pub(super) fn paint_orthogonal_ruler(
    painter: &egui::Painter,
    points: &[Point32],
    preview: Option<Point32>,
    snap_point: Option<Point32>,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) {
    if points.is_empty() {
        return;
    }
    let color = egui::Color32::from_rgb(240, 197, 78);
    let stroke = egui::Stroke::new(1.75, color);
    let paint_segment = |begin: Point32, end: Point32, pending: bool| {
        let begin_screen = world_to_screen_point(begin, world, canvas, zoom, pan);
        let end_screen = world_to_screen_point(end, world, canvas, zoom, pan);
        if pending {
            paint_dashed_line(painter, begin_screen, end_screen, stroke, 6.0, 4.0);
        } else {
            painter.line_segment([begin_screen, end_screen], stroke);
        }
        if begin == end {
            return;
        }
        let horizontal = begin.y == end.y;
        let distance = if horizontal {
            (i64::from(end.x) - i64::from(begin.x)).abs()
        } else {
            (i64::from(end.y) - i64::from(begin.y)).abs()
        };
        let label = format!(
            "{} {}",
            if horizontal { "X" } else { "Y" },
            format_distance_i64(distance, unit, dbu_per_micron)
        );
        let midpoint = begin_screen + (end_screen - begin_screen) * 0.5;
        let (position, align) = if horizontal {
            (
                midpoint + egui::vec2(0.0, -5.0),
                egui::Align2::CENTER_BOTTOM,
            )
        } else {
            (midpoint + egui::vec2(5.0, 0.0), egui::Align2::LEFT_CENTER)
        };
        painter.text(
            position + egui::vec2(1.0, 1.0),
            align,
            &label,
            egui::FontId::monospace(11.0),
            egui::Color32::from_black_alpha(220),
        );
        painter.text(position, align, label, egui::FontId::monospace(11.0), color);
    };

    for pair in points.windows(2) {
        paint_segment(pair[0], pair[1], false);
    }
    if let (Some(begin), Some(end)) = (points.last().copied(), preview) {
        paint_segment(begin, end, true);
    }
    for point in points {
        let screen = world_to_screen_point(*point, world, canvas, zoom, pan);
        painter.circle_filled(screen, 3.25, color);
        painter.circle_stroke(screen, 4.25, egui::Stroke::new(1.0, ecos_canvas()));
    }
    if let Some(point) = preview {
        let screen = world_to_screen_point(point, world, canvas, zoom, pan);
        painter.circle_stroke(screen, 3.5, egui::Stroke::new(1.5, color));
    }
    if let Some(point) = snap_point {
        let screen = world_to_screen_point(point, world, canvas, zoom, pan);
        painter.circle_stroke(screen, 6.5, egui::Stroke::new(1.5, color));
    }
}

pub(super) fn paint_ruler_tool_icon(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
) {
    let center = rect.center();
    let left = center.x - 8.0;
    let right = center.x + 8.0;
    let top = center.y - 4.0;
    let bottom = center.y + 4.0;
    let stroke = egui::Stroke::new(1.5, color);
    painter.line_segment(
        [egui::pos2(left, bottom), egui::pos2(right, bottom)],
        stroke,
    );
    for (x, height) in [
        (left, 8.0),
        (center.x - 4.0, 4.0),
        (center.x, 6.0),
        (center.x + 4.0, 4.0),
        (right, 8.0),
    ] {
        painter.line_segment(
            [egui::pos2(x, bottom - height), egui::pos2(x, bottom)],
            stroke,
        );
    }
    painter.line_segment(
        [egui::pos2(left, top), egui::pos2(left + 2.5, top + 2.5)],
        stroke,
    );
    painter.line_segment(
        [egui::pos2(right, top), egui::pos2(right - 2.5, top + 2.5)],
        stroke,
    );
}

pub(super) fn screen_primitive_bounds(primitive: ScreenShapePrimitive) -> egui::Rect {
    match primitive {
        ScreenShapePrimitive::Rect(rect) => rect,
        ScreenShapePrimitive::Line { begin, end, width } => {
            egui::Rect::from_two_pos(begin, end).expand(width * 0.5)
        }
        ScreenShapePrimitive::Point { center, radius } => {
            egui::Rect::from_center_size(center, egui::vec2(radius * 2.0, radius * 2.0))
        }
    }
}

pub(super) fn world_to_screen_scale(world: Rect32, canvas: egui::Rect, zoom: f32) -> f32 {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width).min(canvas.height() / world_height);
    base_scale * zoom.max(0.001)
}

pub(super) fn world_to_screen_point(
    point: Point32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Pos2 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let center = canvas.center() + pan;
    egui::pos2(
        center.x + (point.x as f32 - world_cx) * scale,
        center.y - (point.y as f32 - world_cy) * scale,
    )
}

pub(super) fn world_to_screen_rect(
    rect: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    egui::Rect::from_min_max(
        world_to_screen_point(
            Point32 {
                x: rect.lx,
                y: rect.hy,
            },
            world,
            canvas,
            zoom,
            pan,
        ),
        world_to_screen_point(
            Point32 {
                x: rect.hx,
                y: rect.ly,
            },
            world,
            canvas,
            zoom,
            pan,
        ),
    )
}

pub(super) fn shape_screen_rect(
    rect: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    expand_screen_rect_to_min_size(
        world_to_screen_rect(rect, world, canvas, zoom, pan),
        MIN_SHAPE_SCREEN_SIZE,
    )
}

pub(super) fn expand_screen_rect_to_min_size(rect: egui::Rect, min_size: f32) -> egui::Rect {
    let center = rect.center();
    let width = rect.width().max(min_size);
    let height = rect.height().max(min_size);
    egui::Rect::from_center_size(center, egui::vec2(width, height))
}

pub(super) fn screen_to_world_rect(
    rect: egui::Rect,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Rect32 {
    // Large DBU extents can legitimately render below 0.001 pixels per DBU.
    // Invert the actual drawing scale so the viewport still covers the canvas.
    let scale = world_to_screen_scale(world, canvas, zoom);
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let center = canvas.center() + pan;
    let to_world = |pos: egui::Pos2| -> (i32, i32) {
        (
            (world_cx + (pos.x - center.x) / scale).round() as i32,
            (world_cy - (pos.y - center.y) / scale).round() as i32,
        )
    };
    let (x0, y0) = to_world(rect.left_bottom());
    let (x1, y1) = to_world(rect.right_top());
    Rect32 {
        lx: x0.min(x1),
        ly: y0.min(y1),
        hx: x0.max(x1),
        hy: y0.max(y1),
    }
}

pub(super) fn screen_to_world_point(
    pos: egui::Pos2,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Point32 {
    let rect = screen_to_world_rect(egui::Rect::from_min_max(pos, pos), world, canvas, zoom, pan);
    Point32 {
        x: rect.lx,
        y: rect.ly,
    }
}

pub(super) fn screen_to_world_delta(
    delta: egui::Vec2,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
) -> (i32, i32) {
    let scale = world_to_screen_scale(world, canvas, zoom);
    (
        (delta.x / scale).round() as i32,
        (-delta.y / scale).round() as i32,
    )
}

pub(super) fn effective_coordinate_unit(
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> CoordinateUnit {
    if unit.is_available(dbu_per_micron) {
        unit
    } else {
        CoordinateUnit::Dbu
    }
}

#[cfg(test)]
pub(super) fn cursor_status_line(
    point: Point32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> String {
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => format!("cursor: {} {} DBU", point.x, point.y),
        CoordinateUnit::Micron => format!(
            "cursor: {} {} um",
            format_micron(point.x, dbu_per_micron),
            format_micron(point.y, dbu_per_micron)
        ),
    }
}

/// Zero-allocation version: writes the hover status line into `buf` using fmt::Write.
pub(super) fn hover_status_line_into(
    buf: &mut String,
    point: Point32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
    nearest: Option<NearestShape>,
) {
    use std::fmt::Write as _;
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => {
            let _ = write!(buf, "cursor: {} {} DBU", point.x, point.y);
        }
        CoordinateUnit::Micron => {
            let _ = write!(
                buf,
                "cursor: {} {} um",
                format_micron(point.x, dbu_per_micron),
                format_micron(point.y, dbu_per_micron)
            );
        }
    }
    if let Some(nearest) = nearest {
        let _ = write!(
            buf,
            ", nearest: shape {} d2 {}",
            nearest.shape_id, nearest.distance_squared
        );
    }
}

#[cfg(test)]
pub(super) fn hover_status_line(
    point: Point32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
    nearest: Option<NearestShape>,
) -> String {
    let cursor = cursor_status_line(point, unit, dbu_per_micron);
    match nearest {
        Some(nearest) => format!(
            "{cursor}, nearest: shape {} d2 {}",
            nearest.shape_id, nearest.distance_squared
        ),
        None => cursor,
    }
}

pub(super) fn hover_nearest_radius_dbu(world: Rect32, canvas: egui::Rect, zoom: f32) -> i32 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 {
        return 0;
    }
    (HOVER_NEAREST_RADIUS_PX / scale).ceil().max(1.0) as i32
}

/// Click slop for editable-instance picking, in DBU, derived from the current
/// viewport so the tolerable screen distance stays constant across zooms.
pub(super) fn edit_pick_tolerance_dbu(world: Rect32, canvas: egui::Rect, zoom: f32) -> i32 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 {
        return 0;
    }
    (EDIT_PICK_TOLERANCE_PX / scale).ceil().max(0.0) as i32
}

/// Chebyshev distance from a point to a rectangle: 0 while inside, otherwise
/// the gap to the nearest horizontal or vertical edge.
pub(super) fn rect_edge_distance_dbu(rect: Rect32, point: Point32) -> i32 {
    rect.lx
        .saturating_sub(point.x)
        .max(point.x.saturating_sub(rect.hx))
        .max(rect.ly.saturating_sub(point.y))
        .max(point.y.saturating_sub(rect.hy))
}

pub(super) fn ruler_edge_snap_radius_dbu(world: Rect32, canvas: egui::Rect, zoom: f32) -> i32 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 {
        return 0;
    }
    (RULER_EDGE_SNAP_RADIUS_PX / scale).ceil().max(1.0) as i32
}

pub(super) fn format_distance(
    distance_dbu: i32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> String {
    format_distance_i64(i64::from(distance_dbu), unit, dbu_per_micron)
}

pub(super) fn format_distance_i64(
    distance_dbu: i64,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> String {
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => format!("{distance_dbu} DBU"),
        CoordinateUnit::Micron => {
            format!("{} um", format_micron_i64(distance_dbu, dbu_per_micron))
        }
    }
}

pub(super) fn format_micron(value_dbu: i32, dbu_per_micron: Option<u32>) -> String {
    format_micron_i64(i64::from(value_dbu), dbu_per_micron)
}

pub(super) fn format_micron_i64(value_dbu: i64, dbu_per_micron: Option<u32>) -> String {
    let dbu_per_micron = dbu_per_micron.filter(|value| *value > 0).unwrap_or(1);
    format!("{:.3}", value_dbu as f64 / dbu_per_micron as f64)
}

pub(super) fn nice_ruler_distance_dbu(target_dbu: f32) -> i32 {
    nice_ruler_interval(f64::from(target_dbu))
        .round()
        .clamp(1.0, i32::MAX as f64) as i32
}

pub(super) fn nice_ruler_interval(target: f64) -> f64 {
    if !target.is_finite() || target <= 0.0 {
        return 1.0;
    }
    let magnitude = 10_f64.powf(target.log10().floor());
    let normalized = target / magnitude;
    let nice = if normalized <= 1.0 {
        1.0
    } else if normalized <= 2.0 {
        2.0
    } else if normalized <= 5.0 {
        5.0
    } else {
        10.0
    };
    nice * magnitude
}

pub(super) fn scroll_zoom_factor(scroll: f32) -> f32 {
    if scroll.abs() < f32::EPSILON {
        return 1.0;
    }
    let steps = if scroll.abs() <= 5.0 {
        scroll
    } else {
        scroll / 25.0
    };
    let base: f32 = 1.35;
    base.powf(steps).clamp(0.05, 20.0)
}

pub(super) fn zoom_at_screen_pos(
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    zoom_factor: f32,
    cursor: egui::Pos2,
) -> (f32, egui::Vec2) {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width)
        .min(canvas.height() / world_height)
        .max(0.001);
    let old_zoom = zoom.max(0.001);
    let new_zoom = (zoom * zoom_factor).clamp(0.05, 50_000.0);
    let old_scale = base_scale * old_zoom;
    let new_scale = base_scale * new_zoom;
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let old_center = canvas.center() + pan;
    let cursor_world_x = world_cx + (cursor.x - old_center.x) / old_scale;
    let cursor_world_y = world_cy - (cursor.y - old_center.y) / old_scale;
    let new_pan = egui::vec2(
        cursor.x - canvas.center().x - (cursor_world_x - world_cx) * new_scale,
        cursor.y - canvas.center().y + (cursor_world_y - world_cy) * new_scale,
    );

    (new_zoom, new_pan)
}

pub(super) fn translate_rect(rect: Rect32, dx: i32, dy: i32) -> Rect32 {
    Rect32 {
        lx: rect.lx.saturating_add(dx),
        ly: rect.ly.saturating_add(dy),
        hx: rect.hx.saturating_add(dx),
        hy: rect.hy.saturating_add(dy),
    }
}

pub(super) fn overview_lod_candidates(preferred_lod: u8) -> [u8; 4] {
    match preferred_lod {
        3 => [3, 2, 1, 0],
        2 => [2, 1, 0, 3],
        1 => [1, 0, 2, 3],
        _ => [0, 1, 2, 3],
    }
}

pub(super) fn tile_is_useful_overview(
    tile: &chipgeom_format::GeometryViewTileRecord,
    world: Rect32,
) -> bool {
    tile.shape_count > 0 && !crate::canvas_gpu3d::tile_is_full_die(tile.bbox, world)
}

pub(super) fn select_overview_lod(
    db: &ChipViewDb,
    layer_ids: &[LayerId],
    viewport: Rect32,
    world: Rect32,
) -> Option<u8> {
    crate::canvas_gpu3d::choose_overview_lod(
        [0_u8, 1, 2, 3].into_iter().map(|lod| {
            let mut total = 0usize;
            let mut useful = 0usize;
            for layer_id in layer_ids {
                for tile in db.query_view_tiles(lod, *layer_id, viewport) {
                    total += 1;
                    if tile_is_useful_overview(tile, world) {
                        useful += 1;
                    }
                }
            }
            (lod, total, useful)
        }),
        crate::canvas_gpu3d::OVERVIEW_INSTANCE_BUDGET,
    )
}

pub(super) fn overview_tiles_for_layer<'a>(
    db: &'a ChipViewDb,
    preferred_lod: u8,
    layer_id: LayerId,
    viewport: Rect32,
    world: Rect32,
) -> Vec<&'a chipgeom_format::GeometryViewTileRecord> {
    for lod in overview_lod_candidates(preferred_lod) {
        let tiles: Vec<_> = db
            .query_view_tiles(lod, layer_id, viewport)
            .into_iter()
            .filter(|tile| tile_is_useful_overview(tile, world))
            .collect();
        if !tiles.is_empty() {
            return tiles;
        }
    }
    Vec::new()
}

pub(super) fn can_start_edit_command(
    has_draft: bool,
    has_pending_edit: bool,
    has_pending_session_action: bool,
) -> bool {
    !has_draft && !has_pending_edit && !has_pending_session_action
}

pub(super) fn edit_poll_repaint_interval(has_pending_command: bool) -> Option<Duration> {
    has_pending_command.then_some(Duration::from_millis(100))
}

pub(super) fn snapshot_signature_for_db(db: &ChipViewDb) -> SnapshotFileSignature {
    let manifest = db.snapshot().manifest();
    let mut paths = vec![
        manifest.path.clone(),
        manifest.meta.clone(),
        manifest.shapes.clone(),
        manifest.owners.clone(),
        manifest.payload.clone(),
        manifest.names.clone(),
        manifest.name_index.clone(),
        manifest.sidmap.clone(),
        manifest.view.clone(),
    ];
    if let Some(layers) = &manifest.layers {
        paths.push(layers.clone());
    }
    if let Some(sites) = &manifest.sites {
        paths.push(sites.clone());
    }
    if let Some(masters) = &manifest.masters {
        paths.push(masters.clone());
    }
    if let Some(vias) = &manifest.vias {
        paths.push(vias.clone());
    }
    if let Some(grids) = &manifest.grids {
        paths.push(grids.clone());
    }
    if let Some(connectivity) = &manifest.connectivity {
        paths.push(connectivity.clone());
    }
    if let Some(buses) = &manifest.buses {
        paths.push(buses.clone());
    }
    if let Some(groups) = &manifest.groups {
        paths.push(groups.clone());
    }
    if let Some(delta) = &manifest.delta {
        paths.push(delta.clone());
    }
    snapshot_file_signature(paths)
}

pub(super) fn snapshot_file_signature(
    paths: impl IntoIterator<Item = PathBuf>,
) -> SnapshotFileSignature {
    SnapshotFileSignature {
        files: paths
            .into_iter()
            .map(|path| {
                let stamp = snapshot_file_stamp(&path);
                (path, stamp)
            })
            .collect(),
    }
}

pub(super) fn snapshot_file_stamp(path: &Path) -> Option<SnapshotFileStamp> {
    fs::metadata(path).ok().map(|metadata| SnapshotFileStamp {
        modified: metadata.modified().ok(),
        len: metadata.len(),
    })
}

pub(super) fn snapshot_file_signature_changed(
    previous: &SnapshotFileSignature,
    current: &SnapshotFileSignature,
) -> bool {
    previous != current
}

pub(super) fn edit_result_action(result: &GeometryEditResult) -> EditResultAction {
    let (reload_snapshot, message) = match result.status {
        GeometryEditStatus::Accepted => (true, accepted_edit_result_message(result)),
        GeometryEditStatus::AdjustedAccepted => {
            let staging_revision = result
                .staging_revision
                .map(|revision| format!(" staging revision {revision}"))
                .unwrap_or_default();
            (
                true,
                format!(
                    "edit adjusted: shape {} version {} bbox {} {} {} {}{}",
                    result.shape_id,
                    result.new_version,
                    result.committed_bbox.lx,
                    result.committed_bbox.ly,
                    result.committed_bbox.hx,
                    result.committed_bbox.hy,
                    staging_revision
                ),
            )
        }
        GeometryEditStatus::Rejected => (
            false,
            format!(
                "edit rejected: shape {} restored to original geometry",
                result.shape_id
            ),
        ),
        GeometryEditStatus::Conflict => (
            true,
            format!(
                "edit conflict: shape {} refreshed; retry the edit",
                result.shape_id
            ),
        ),
    };

    EditResultAction {
        reload_snapshot,
        selected_shape_id: Some(result.shape_id),
        message: append_edit_diagnostic(message, result),
    }
}

pub(super) fn accepted_edit_result_message(result: &GeometryEditResult) -> String {
    let source_version = result.source_version.unwrap_or(result.new_version);
    if result.shape_id == 0 {
        return match result.staging_revision {
            Some(staging_revision) => format!(
                "edit accepted: staged macro source version {} staging revision {}",
                source_version, staging_revision
            ),
            None => format!("edit accepted: staged macro version {source_version}"),
        };
    }
    match result.staging_revision {
        Some(staging_revision) => format!(
            "edit accepted: shape {} source version {} staging revision {}",
            result.shape_id, source_version, staging_revision
        ),
        None => format!(
            "edit accepted: shape {} version {}",
            result.shape_id, result.new_version
        ),
    }
}

pub(super) fn append_edit_diagnostic(mut message: String, result: &GeometryEditResult) -> String {
    let Some(diagnostic) = result.message.as_deref().map(str::trim) else {
        return message;
    };
    if diagnostic.is_empty() {
        return message;
    }

    message.push_str(": ");
    message.push_str(diagnostic);
    message
}

pub(super) fn diagnostics_lines(
    memory: &ChipViewMemoryStats,
    delta: &DeltaStats,
    view_tile_count: usize,
    exact_cache: RenderCacheStats,
    tile_cache: RenderCacheStats,
) -> Vec<String> {
    let mut lines = vec![
        format!("mmap bytes: {}", memory.mapped_bytes.total()),
        format!("index bytes: {}", memory.index_bytes.total_bytes),
        format!("total memory: {}", memory.mapped_plus_index_bytes),
        format!("view tiles: {view_tile_count}"),
        cache_stats_line("exact cache", exact_cache),
        cache_stats_line("tile cache", tile_cache),
        format!("delta records: {}", delta.record_count),
    ];

    lines.push(match (
        delta.latest_sequence_id,
        delta.latest_command_id,
        delta.latest_shape_id,
        delta.latest_old_version,
        delta.latest_new_version,
    ) {
        (Some(sequence_id), Some(command_id), Some(shape_id), Some(old_version), Some(new_version)) => {
            format!("latest delta: seq {sequence_id} cmd {command_id} shape {shape_id} v{old_version}->{new_version}")
        }
        _ => "latest delta: none".to_string(),
    });

    lines
}

pub(super) fn design_metadata_lines(manifest: &chip_view_db::GeometryManifest) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(name) = manifest.design_name.as_deref() {
        lines.push(format!("design: {name}"));
    }
    if let Some(version) = manifest.design_version.as_deref() {
        lines.push(format!("design version: {version}"));
    }
    if let Some(dbu_per_micron) = manifest.dbu_per_micron {
        lines.push(format!("dbu per micron: {dbu_per_micron}"));
    }
    if let Some(manufacture_grid) = manifest.manufacture_grid {
        lines.push(format!("manufacture grid: {manufacture_grid}"));
    }
    if let Some(dirty_lod_tile_count) = manifest.dirty_lod_tile_count {
        lines.push(format!("dirty LOD tiles: {dirty_lod_tile_count}"));
    }
    if let Some(dirty_lod_rebuild_candidate_count) = manifest.dirty_lod_rebuild_candidate_count {
        lines.push(format!(
            "dirty LOD candidates: {dirty_lod_rebuild_candidate_count}"
        ));
    }
    if let Some(written_side_file_count) = manifest.written_side_file_count {
        lines.push(format!("written side files: {written_side_file_count}"));
    }
    if let Some(reused_side_file_count) = manifest.reused_side_file_count {
        lines.push(format!("reused side files: {reused_side_file_count}"));
    }
    lines
}

pub(super) fn semantic_metadata_lines(
    site_count: usize,
    master_count: usize,
    via_count: usize,
    grid_count: usize,
    connectivity_count: usize,
    net_count: usize,
    bus_count: usize,
    group_count: usize,
) -> Vec<String> {
    vec![
        format!("sites: {site_count}"),
        format!("masters: {master_count}"),
        format!("via definitions: {via_count}"),
        format!("grid definitions: {grid_count}"),
        format!("connectivity endpoints: {connectivity_count}"),
        format!("net definitions: {net_count}"),
        format!("buses: {bus_count}"),
        format!("groups: {group_count}"),
    ]
}

pub(super) fn cache_stats_line(label: &str, stats: RenderCacheStats) -> String {
    format!(
        "{label}: {} entries, {} hits, {} misses",
        stats.entries, stats.hits, stats.misses
    )
}

#[cfg(test)]
pub(super) fn canvas_status_line(
    drawn: usize,
    overlay_count: usize,
    use_view_tiles: bool,
    view_lod: u8,
    zoom: f32,
    viewport: Rect32,
) -> String {
    let mut buf = String::new();
    canvas_status_line_into(
        &mut buf,
        drawn,
        overlay_count,
        use_view_tiles,
        view_lod,
        zoom,
        viewport,
    );
    buf
}

/// Zero-allocation version: writes canvas status into `buf` using fmt::Write.
pub(super) fn canvas_status_line_into(
    buf: &mut String,
    drawn: usize,
    overlay_count: usize,
    use_view_tiles: bool,
    view_lod: u8,
    zoom: f32,
    viewport: Rect32,
) {
    use std::fmt::Write as _;
    if use_view_tiles {
        let _ = write!(
            buf,
            "drawn: {drawn} view tiles, lod: {view_lod}, zoom: {zoom:.2}x, viewport: {} {} {} {}",
            viewport.lx, viewport.ly, viewport.hx, viewport.hy
        );
    } else {
        let _ = write!(
            buf,
            "drawn: {drawn} exact, zoom: {zoom:.2}x, viewport: {} {} {} {}",
            viewport.lx, viewport.ly, viewport.hx, viewport.hy
        );
    }
    if overlay_count > 0 {
        let _ = write!(buf, ", overlays: {overlay_count}");
    }
}

pub(super) fn canvas_cursor_icon(hovered: bool, pan_active: bool) -> Option<egui::CursorIcon> {
    if pan_active {
        Some(egui::CursorIcon::Move)
    } else if hovered {
        Some(egui::CursorIcon::Grab)
    } else {
        None
    }
}

pub(super) fn instance_move_is_allowed(owner_type: u8) -> bool {
    OwnerType::from_raw(owner_type) == Some(OwnerType::InstanceBBox)
}

/// Picks the editable instance bbox under (or within `tolerance_dbu` of) the
/// point. Exact containment wins over near-misses; within each group the
/// later candidate in iteration order wins, preserving the previous
/// topmost-shape behavior. `tolerance_dbu` is 0 for an exact hit test.
pub(super) fn pick_top_editable_instance_bbox<'a>(
    candidates: impl IntoIterator<Item = (&'a ShapeRecord, &'a OwnerRef)>,
    point: Point32,
    tolerance_dbu: i32,
) -> Option<ShapeId> {
    let mut best: Option<(i64, std::cmp::Reverse<usize>, ShapeId)> = None;
    for (index, (shape, owner)) in candidates.into_iter().enumerate() {
        if !(shape.state == ShapeState::Alive as u8
            && shape.kind == ShapeKind::Rect as u8
            && OwnerType::from_raw(owner.owner_type) == Some(OwnerType::InstanceBBox))
        {
            continue;
        }
        let distance = i64::from(rect_edge_distance_dbu(shape.bbox, point));
        if distance > i64::from(tolerance_dbu) {
            continue;
        }
        let key = (distance, std::cmp::Reverse(index));
        if best
            .as_ref()
            .is_none_or(|(best_distance, best_index, _)| key < (*best_distance, *best_index))
        {
            best = Some((distance, std::cmp::Reverse(index), shape.id));
        }
    }
    best.map(|(_, _, shape_id)| shape_id)
}

pub(super) fn edit_capability_lines(
    shape: &ShapeRecord,
    owner: Option<&OwnerRef>,
    edit_enabled: bool,
) -> Vec<String> {
    if !edit_enabled {
        return vec!["edit: view-only session".to_string()];
    }
    if shape.state != ShapeState::Alive as u8 {
        return vec!["edit: read-only, shape is not alive".to_string()];
    }
    if shape.kind != ShapeKind::Rect as u8 {
        return vec!["edit: read-only, only rect shapes are editable".to_string()];
    }

    let Some(owner) = owner else {
        return vec!["edit: read-only, owner unavailable".to_string()];
    };

    if !instance_move_is_allowed(owner.owner_type) {
        return vec![format!(
            "edit: read-only, {} is not editable",
            ChipViewDb::owner_type_label(owner.owner_type)
        )];
    }

    vec![
        "edit: move".to_string(),
        "edit note: instance resize is rejected; move preserves master size".to_string(),
    ]
}

pub(super) fn is_context_owner_type(owner_type: u8) -> bool {
    matches!(
        OwnerType::from_raw(owner_type),
        Some(OwnerType::Row | OwnerType::TrackGrid | OwnerType::GCellGrid | OwnerType::Obs)
    )
}

pub(super) fn owner_uses_layer_visibility(owner_type: Option<OwnerType>) -> bool {
    !matches!(
        owner_type,
        Some(
            OwnerType::Die
                | OwnerType::Core
                | OwnerType::Row
                | OwnerType::InstanceBBox
                | OwnerType::InstanceHalo
                | OwnerType::Region
        )
    )
}

pub(super) fn shape_uses_layer_visibility(
    shape: &ShapeRecord,
    owner_type: Option<OwnerType>,
) -> bool {
    shape.layer_id != LAYOUT_GEOMETRY_LAYER && owner_uses_layer_visibility(owner_type)
}

pub(super) fn object_visibility_needs_layout_layer(visibility: ObjectVisibility) -> bool {
    visibility.instances.any_visible()
        || visibility.fill
        || visibility.boundaries
        || visibility.placement
        || visibility.tracks
        || visibility.gcells
        || visibility.obstructions
        || visibility.regions
}

pub(super) fn is_renderable_shape(shape: &chipgeom_format::ShapeRecord) -> bool {
    shape.state == ShapeState::Alive as u8 && is_renderable_shape_kind(shape.kind)
}

pub(super) fn is_renderable_shape_kind(kind: u8) -> bool {
    kind == ShapeKind::Rect as u8 || kind == ShapeKind::Line as u8 || kind == ShapeKind::Point as u8
}

pub(super) fn overlay_shape_ids(
    selected: Option<ShapeId>,
    highlighted: &BTreeSet<ShapeId>,
) -> BTreeSet<ShapeId> {
    let mut overlay = highlighted.clone();
    if let Some(shape_id) = selected {
        overlay.insert(shape_id);
    }
    overlay
}

pub(super) fn shape_xy_rect(geometry: ShapeGeometry) -> Option<Rect32> {
    match geometry {
        ShapeGeometry::Rect(rect) => Some(rect),
        ShapeGeometry::Line(line) => {
            let width = line.width.abs().max(80);
            let half = (width / 2).max(40);
            if line.begin.y == line.end.y {
                Some(Rect32 {
                    lx: line.begin.x.min(line.end.x),
                    ly: line.begin.y.saturating_sub(half),
                    hx: line.begin.x.max(line.end.x),
                    hy: line.begin.y.saturating_add(half),
                })
            } else if line.begin.x == line.end.x {
                Some(Rect32 {
                    lx: line.begin.x.saturating_sub(half),
                    ly: line.begin.y.min(line.end.y),
                    hx: line.begin.x.saturating_add(half),
                    hy: line.begin.y.max(line.end.y),
                })
            } else {
                Some(Rect32 {
                    lx: line.begin.x.min(line.end.x).saturating_sub(half),
                    ly: line.begin.y.min(line.end.y).saturating_sub(half),
                    hx: line.begin.x.max(line.end.x).saturating_add(half),
                    hy: line.begin.y.max(line.end.y).saturating_add(half),
                })
            }
        }
        ShapeGeometry::Point(point) => Some(Rect32 {
            lx: point.point.x.saturating_sub(80),
            ly: point.point.y.saturating_sub(80),
            hx: point.point.x.saturating_add(80),
            hy: point.point.y.saturating_add(80),
        }),
    }
}

pub(super) fn clear_search_state(search_text: &mut String, highlighted: &mut BTreeSet<ShapeId>) {
    search_text.clear();
    highlighted.clear();
}

pub(super) fn selection_detail_lines(
    shape: &ShapeRecord,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
    owner_local_name: Option<&str>,
) -> Vec<String> {
    let mut lines = vec![
        format!("shape: {}", shape.id),
        format!("kind: {}", shape_kind_label(shape.kind)),
        format!("state: {}", shape_state_label(shape.state)),
        format!("version: {}", shape.version),
        format!("layer: {}", shape.layer_id),
        format!("flags: 0x{:04x}", shape.flags),
        format!(
            "bbox: {} {} {} {}",
            shape.bbox.lx, shape.bbox.ly, shape.bbox.hx, shape.bbox.hy
        ),
    ];

    if let Some(owner) = owner {
        lines.push(format!(
            "owner: {} {}",
            ChipViewDb::owner_type_label(owner.owner_type),
            owner.owner_id
        ));
        lines.push(format!("owner flags: 0x{:04x}", owner.flags));
        if let Some(name) = owner_name {
            lines.push(format!("name: {name}"));
        }
        if let Some(local_name) = owner_local_name {
            lines.push(format!("local name: {local_name}"));
            if let Some(local_info) = OwnerLocalInfo::parse(local_name) {
                lines.extend(owner_local_info_lines(&local_info));
            }
        }
        lines.push(format!(
            "path: {} {} {} {}",
            owner.path0, owner.path1, owner.path2, owner.path3
        ));
    } else {
        lines.push("owner: unavailable".to_string());
    }

    lines
}

pub(super) fn owner_local_info_lines(local_info: &OwnerLocalInfo) -> Vec<String> {
    if local_info.kind == "via" {
        return via_local_info_lines(local_info);
    }

    let mut lines = Vec::new();
    if let Some(master) = local_info.field("master") {
        lines.push(format!("master: {master}"));
    }
    if let Some(site) = local_info.field("site") {
        lines.push(format!("site: {site}"));
    }
    lines
}

pub(super) fn via_local_info_lines(local_info: &OwnerLocalInfo) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(via) = local_info.field("via") {
        lines.push(format!("via: {via}"));
    }
    if let Some(master) = local_info.field("master") {
        lines.push(format!("via master: {master}"));
    }
    if let Some(via_type) = local_info.field("type") {
        lines.push(format!("via type: {via_type}"));
    }
    if let Some(rule) = local_info.field("rule") {
        lines.push(format!("via rule: {rule}"));
    }

    let bottom = local_info.field("bottom");
    let cut = local_info.field("cut");
    let top = local_info.field("top");
    if bottom.is_some() || cut.is_some() || top.is_some() {
        lines.push(format!(
            "via layers: {} / {} / {}",
            bottom.unwrap_or("?"),
            cut.unwrap_or("?"),
            top.unwrap_or("?")
        ));
    }

    let cut_size = local_info.field("cut_size");
    let cut_spacing = local_info.field("cut_spacing");
    if cut_size.is_some() || cut_spacing.is_some() {
        lines.push(format!(
            "via cut: size {} spacing {}",
            cut_size.unwrap_or("?"),
            cut_spacing.unwrap_or("?")
        ));
    }

    let enclosure_bottom = local_info.field("enclosure_bottom");
    let enclosure_top = local_info.field("enclosure_top");
    if enclosure_bottom.is_some() || enclosure_top.is_some() {
        lines.push(format!(
            "via enclosure: bottom {} top {}",
            enclosure_bottom.unwrap_or("?"),
            enclosure_top.unwrap_or("?")
        ));
    }

    if let Some(rowcol) = local_info.field("rowcol") {
        lines.push(format!("via row/col: {rowcol}"));
    }
    if local_info.field("default") == Some("true") {
        lines.push("via default: true".to_string());
    }
    lines
}

pub(super) fn selection_connectivity_lines(endpoints: &[&ConnectivityMetadata]) -> Vec<String> {
    let mut lines = selection_connectivity_header_lines(endpoints);
    for endpoint in endpoints.iter().take(MAX_SELECTION_ENDPOINT_LINES) {
        lines.push(selection_connectivity_endpoint_line(endpoint));
    }
    if let Some(line) = selection_connectivity_omitted_line(endpoints) {
        lines.push(line);
    }
    lines
}

pub(super) fn selection_connectivity_header_lines(
    endpoints: &[&ConnectivityMetadata],
) -> Vec<String> {
    if endpoints.is_empty() {
        return Vec::new();
    }

    vec![format!("connectivity endpoints: {}", endpoints.len())]
}

pub(super) fn selection_connectivity_endpoint_line(endpoint: &ConnectivityMetadata) -> String {
    format!(
        "endpoint: {} {} {} master:{}",
        empty_label(&endpoint.endpoint_type),
        empty_label(&endpoint.instance_name),
        empty_label(&endpoint.pin_name),
        empty_label(&endpoint.master_name)
    )
}

pub(super) fn selection_connectivity_omitted_line(
    endpoints: &[&ConnectivityMetadata],
) -> Option<String> {
    (endpoints.len() > MAX_SELECTION_ENDPOINT_LINES).then(|| {
        format!(
            "endpoints omitted: {}",
            endpoints.len() - MAX_SELECTION_ENDPOINT_LINES
        )
    })
}

pub(super) fn selection_connectivity_endpoints<'a>(
    db: &'a ChipViewDb,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
) -> Vec<&'a ConnectivityMetadata> {
    let Some(owner_name) = owner_name else {
        return Vec::new();
    };
    match owner.and_then(|owner| OwnerType::from_raw(owner.owner_type)) {
        Some(OwnerType::InstanceBBox | OwnerType::InstanceHalo) => {
            db.connectivity_for_instance(owner_name)
        }
        Some(
            OwnerType::PinPortShape | OwnerType::InstancePinPortShape | OwnerType::IoPinPortShape,
        ) => db.connectivity_for_pin(owner_name),
        _ => db.connectivity_for_net(owner_name),
    }
}

pub(super) fn empty_label(value: &str) -> &str {
    if value.is_empty() {
        "-"
    } else {
        value
    }
}

pub(super) fn shape_kind_label(kind: u8) -> &'static str {
    match kind {
        value if value == ShapeKind::Point as u8 => "point",
        value if value == ShapeKind::Line as u8 => "line",
        value if value == ShapeKind::Rect as u8 => "rect",
        _ => "other",
    }
}

pub(super) fn shape_state_label(state: u8) -> &'static str {
    match state {
        value if value == ShapeState::Alive as u8 => "alive",
        value if value == ShapeState::Deleted as u8 => "deleted",
        _ => "other",
    }
}

pub(super) fn first_existing_shape_id<F>(
    shape_ids: &BTreeSet<ShapeId>,
    mut exists: F,
) -> Option<ShapeId>
where
    F: FnMut(ShapeId) -> bool,
{
    shape_ids.iter().copied().find(|shape_id| exists(*shape_id))
}

pub(super) fn focus_target_for_shape_ids<F>(
    shape_ids: &BTreeSet<ShapeId>,
    mut bbox_for_shape: F,
) -> Option<PendingFocus>
where
    F: FnMut(ShapeId) -> Option<Rect32>,
{
    let mut shape_bboxes = BTreeMap::new();
    for shape_id in shape_ids.iter().copied() {
        let Some(shape_bbox) = bbox_for_shape(shape_id) else {
            continue;
        };
        shape_bboxes.insert(shape_id, shape_bbox);
    }

    let bbox = shape_bboxes.values().copied().reduce(union_rect)?;
    let select_shape_id =
        first_existing_shape_id(shape_ids, |shape_id| shape_bboxes.contains_key(&shape_id));
    Some(PendingFocus {
        bbox,
        select_shape_id,
        transition: FocusTransition::Immediate,
    })
}

pub(super) fn shape_id_lookup_action<F>(input: &str, mut bbox_for_shape: F) -> ShapeIdLookupAction
where
    F: FnMut(ShapeId) -> Option<Rect32>,
{
    let value = input.trim();
    if value.is_empty() {
        return ShapeIdLookupAction {
            pending_focus: None,
            message: "enter a ShapeId".to_string(),
        };
    }
    let Ok(shape_id) = value.parse::<ShapeId>() else {
        return ShapeIdLookupAction {
            pending_focus: None,
            message: format!("invalid ShapeId: {value}"),
        };
    };
    let Some(bbox) = bbox_for_shape(shape_id) else {
        return ShapeIdLookupAction {
            pending_focus: None,
            message: format!("shape {shape_id} not found"),
        };
    };

    ShapeIdLookupAction {
        pending_focus: Some(PendingFocus {
            bbox,
            select_shape_id: Some(shape_id),
            transition: FocusTransition::Immediate,
        }),
        message: format!("shape {shape_id} selected"),
    }
}

pub(super) fn union_rect(lhs: Rect32, rhs: Rect32) -> Rect32 {
    Rect32 {
        lx: lhs.lx.min(rhs.lx),
        ly: lhs.ly.min(rhs.ly),
        hx: lhs.hx.max(rhs.hx),
        hy: lhs.hy.max(rhs.hy),
    }
}

pub(super) fn focus_view_on_bbox(
    world: Rect32,
    target: Rect32,
    canvas: egui::Rect,
) -> (f32, egui::Vec2) {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let canvas_width = canvas.width().max(1.0);
    let canvas_height = canvas.height().max(1.0);
    let base_scale = (canvas_width / world_width)
        .min(canvas_height / world_height)
        .max(0.001);
    let target_width = (target.hx - target.lx).max(1) as f32;
    let target_height = (target.hy - target.ly).max(1) as f32;
    let target_scale =
        (canvas_width / target_width).min(canvas_height / target_height) * FOCUS_VIEWPORT_FILL;
    let zoom = (target_scale / base_scale).clamp(1.0, 50_000.0);
    let scale = base_scale * zoom;
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let target_cx = (target.lx + target.hx) as f32 * 0.5;
    let target_cy = (target.ly + target.hy) as f32 * 0.5;

    (
        zoom,
        egui::vec2(
            (world_cx - target_cx) * scale,
            (target_cy - world_cy) * scale,
        ),
    )
}

impl FocusAnimation {
    pub(super) fn new(
        started_at: f64,
        from_zoom: f32,
        from_pan: egui::Vec2,
        to_zoom: f32,
        to_pan: egui::Vec2,
    ) -> Self {
        Self {
            started_at,
            from_zoom,
            from_pan,
            to_zoom,
            to_pan,
        }
    }

    pub(super) fn sample(self, now: f64) -> FocusAnimationFrame {
        let progress =
            ((now - self.started_at) / MAP_FOCUS_ANIMATION_DURATION_SECONDS).clamp(0.0, 1.0) as f32;
        let eased = ease_out_quint(progress);
        let zoom = egui::lerp(self.from_zoom..=self.to_zoom, eased);
        FocusAnimationFrame {
            zoom: if progress >= 1.0 { self.to_zoom } else { zoom },
            pan: if progress >= 1.0 {
                self.to_pan
            } else {
                self.from_pan + (self.to_pan - self.from_pan) * eased
            },
            complete: progress >= 1.0,
        }
    }
}

pub(super) fn ease_out_quint(progress: f32) -> f32 {
    1.0 - (1.0 - progress.clamp(0.0, 1.0)).powi(5)
}

pub(super) fn focus_animation_enabled(ctx: &egui::Context) -> bool {
    ctx.style().animation_time > 0.0
        && !reduced_motion_requested(std::env::var(REDUCED_MOTION_ENV).ok().as_deref())
}

pub(super) fn env_flag_requested(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        ["1", "true", "yes", "on"]
            .iter()
            .any(|enabled| value.trim().eq_ignore_ascii_case(enabled))
    })
}

pub(super) fn reduced_motion_requested(value: Option<&str>) -> bool {
    env_flag_requested(value)
}

pub(super) fn retain_existing_shape_id<F>(
    shape_id: Option<ShapeId>,
    mut exists: F,
) -> Option<ShapeId>
where
    F: FnMut(ShapeId) -> bool,
{
    shape_id.filter(|shape_id| exists(*shape_id))
}

pub(super) fn retain_existing_shape_ids<F>(shape_ids: &mut BTreeSet<ShapeId>, mut exists: F)
where
    F: FnMut(ShapeId) -> bool,
{
    shape_ids.retain(|shape_id| exists(*shape_id));
}

pub(super) fn sidebar_section_heights(available_height: f32) -> SidebarSectionHeights {
    let available_height = available_height.max(360.0);
    let view = (available_height / 13.0).clamp(54.0, 78.0);
    let interaction = (available_height * 2.0 / 13.0).clamp(136.0, 180.0);
    let list_total =
        (available_height - view - interaction - SIDEBAR_SECTION_RESERVE_HEIGHT).max(220.0);
    let physical_layers = (list_total * 0.5).clamp(120.0, 420.0);
    let drawing_data = (list_total - physical_layers).clamp(120.0, 420.0);

    SidebarSectionHeights {
        view,
        interaction,
        physical_layers,
        drawing_data,
    }
}

pub(super) fn next_native_command_id(counter: &mut u32) -> u64 {
    let command_id = u64::from(*counter);
    assert!(
        command_id <= MAX_JAVASCRIPT_SAFE_INTEGER,
        "native edit command ID exceeds the JavaScript safe integer range"
    );
    *counter = counter.saturating_add(1);
    command_id
}

pub(super) fn set_layer_visibility(layers: &mut [LayerUiState], visible: bool) {
    for layer in layers {
        layer.visible = visible;
    }
}

pub(super) fn invert_layer_visibility(layers: &mut [LayerUiState]) {
    for layer in layers {
        layer.visible = !layer.visible;
    }
}

pub(super) fn visible_layer_count(layers: &[LayerUiState]) -> usize {
    layers.iter().filter(|layer| layer.visible).count()
}

pub(super) fn layers_visibility_hash(layers: &[LayerUiState]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for l in layers {
        l.layer_id.hash(&mut hasher);
        l.visible.hash(&mut hasher);
    }
    LAYOUT_GEOMETRY_LAYER.hash(&mut hasher);
    true.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
pub(super) fn drc_layer_is_visible(layers: &[LayerUiState], layer_name: &str) -> bool {
    layers
        .iter()
        .find(|layer| layer.name.eq_ignore_ascii_case(layer_name))
        .map(|layer| layer.visible)
        .unwrap_or(true)
}

pub(super) fn antenna_layer_is_visible(layers: &[LayerUiState], layer_name: &str) -> bool {
    layers
        .iter()
        .find(|layer| layer.name.eq_ignore_ascii_case(layer_name))
        .map(|layer| layer.visible)
        .unwrap_or(true)
}

#[cfg(test)]
pub(super) fn visible_layer_ids(visible_layers: &BTreeMap<LayerId, LayerStyle>) -> Vec<LayerId> {
    visible_layers.keys().copied().collect()
}

pub(super) fn render_query_layer_ids(
    layers: &[LayerUiState],
    visibility: ObjectVisibility,
) -> Vec<LayerId> {
    let mut ids: BTreeSet<LayerId> = layers
        .iter()
        .filter(|layer| layer.visible)
        .map(|layer| layer.layer_id)
        .collect();
    if object_visibility_needs_layout_layer(visibility) {
        ids.insert(LAYOUT_GEOMETRY_LAYER);
    }
    ids.into_iter().collect()
}

#[cfg(test)]
pub(super) fn visible_style_for_shape<'a>(
    shape: &ShapeRecord,
    owner: Option<&OwnerRef>,
    visible_layers: &'a BTreeMap<LayerId, LayerStyle>,
    all_layers: &'a BTreeMap<LayerId, LayerStyle>,
) -> Option<&'a LayerStyle> {
    let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
    if shape_uses_layer_visibility(shape, owner_type) {
        visible_layers.get(&shape.layer_id)
    } else {
        all_layers
            .get(&shape.layer_id)
            .or_else(|| visible_layers.get(&shape.layer_id))
    }
}

pub(super) fn layer_hover_text(layer: &LayerUiState) -> String {
    let mut text = format!(
        "id: {}\norder: {}\ntype: {}\nstyle role: {}\ndirection: {}\nwidth: {}\npitch: {} {}",
        layer.layer_id,
        layer.order,
        layer.layer_type,
        layer.display_role,
        layer.direction,
        layer.width,
        layer.pitch_x,
        layer.pitch_y
    );
    append_positive_layer_rule(&mut text, "min spacing", layer.min_spacing);
    append_positive_layer_rule(&mut text, "min area", layer.min_area);
    append_positive_layer_rule(&mut text, "min step", layer.min_step);
    append_positive_layer_rule(&mut text, "cut spacing", layer.cut_spacing);
    if !layer.enclosure_below.is_empty() {
        text.push_str("\nenclosure below: ");
        text.push_str(&layer.enclosure_below);
    }
    if !layer.enclosure_above.is_empty() {
        text.push_str("\nenclosure above: ");
        text.push_str(&layer.enclosure_above);
    }
    if layer.lef58_rule_count > 0 {
        text.push_str(&format!("\nLEF58 rules: {}", layer.lef58_rule_count));
    }
    text
}

pub(super) fn append_positive_layer_rule(text: &mut String, label: &str, value: i32) {
    if value > 0 {
        text.push_str(&format!("\n{label}: {value}"));
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CanvasDragMode {
    Pan,
    Edit,
    MacroMove,
    MacroMarquee,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PanDragState {
    mode: Option<CanvasDragMode>,
    accumulated_delta: egui::Vec2,
}

impl Default for PanDragState {
    fn default() -> Self {
        Self {
            mode: None,
            accumulated_delta: egui::Vec2::ZERO,
        }
    }
}

impl PanDragState {
    pub(super) fn start(&mut self, mode: CanvasDragMode) {
        self.mode = Some(mode);
        self.accumulated_delta = egui::Vec2::ZERO;
    }

    pub(super) fn mode(&self) -> Option<CanvasDragMode> {
        self.mode
    }

    pub(super) fn apply_pan_frame(&self, pan: egui::Vec2, frame_delta: egui::Vec2) -> egui::Vec2 {
        pan + frame_delta
    }

    pub(super) fn accumulate(&mut self, frame_delta: egui::Vec2) -> egui::Vec2 {
        self.accumulated_delta += frame_delta;
        self.accumulated_delta
    }

    pub(super) fn reset(&mut self) {
        self.mode = None;
        self.accumulated_delta = egui::Vec2::ZERO;
    }
}

pub(super) fn write_edit_command(
    path: &Path,
    command: &GeometryEditCommand,
    instance_name: Option<&str>,
    orient: Option<&str>,
    placement_status: Option<&str>,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_vec_pretty(&ViewerEditCommand {
        command,
        instance_name,
        orient,
        placement_status,
    })
    .map_err(std::io::Error::other)?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)?;
    fs::rename(temp_path, path)
}

pub(super) fn write_session_action_command(
    path: &Path,
    command: &SessionActionCommand,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_vec_pretty(command).map_err(std::io::Error::other)?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)?;
    fs::rename(temp_path, path)
}

pub(super) fn session_action_result_message(result: &SessionActionResult) -> String {
    let detail = result.message.as_deref().map(str::trim).unwrap_or_default();
    let outcome = if result.accepted {
        "completed"
    } else {
        "rejected"
    };
    if detail.is_empty() {
        format!("{} {}", result.action.label(), outcome)
    } else {
        format!("{} {}: {detail}", result.action.label(), outcome)
    }
}

/// Saving a manual macro-placement session records every placement as the
/// `macro.placements` parameter, which makes macroPlacement skip DreamPlace
/// entirely. A save with macros still staged in the unplaced column would
/// strand them unplaced, so it is rejected until each one has a placement.
pub(super) fn macro_save_blocker(
    staging: Option<&crate::macro_staging::MacroStagingState>,
) -> Option<String> {
    let staging = staging?;
    let unplaced = staging.unplaced_staged_names();
    (!unplaced.is_empty()).then(|| {
        format!(
            "{} macro(s) are still unplaced; place every macro before saving: {}",
            unplaced.len(),
            unplaced.join(", ")
        )
    })
}
