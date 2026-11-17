use crate::map_data::{ColormapMode, HeatmapData, MapCatalog};
use egui::{Color32, Painter, Pos2, Rect};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct ReplayMaps {
    root: PathBuf,
    items: Vec<(String, PathBuf, PathBuf)>,
    pub selected: Option<usize>,
    active: Option<std::sync::Arc<HeatmapData>>,
    loader: Option<crate::replay::map_loader::MapLoader>,
    follow: crate::replay::widgets::SelectionFollow,
    pub error: String,
}

impl ReplayMaps {
    pub fn selected_label(&self) -> Option<&str> {
        self.selected
            .and_then(|i| self.items.get(i))
            .map(|item| item.0.as_str())
    }
    pub fn active_data(&self) -> Option<&HeatmapData> {
        self.active.as_deref()
    }
    pub fn open(root: &Path) -> Self {
        let mut result = Self {
            root: root.into(),
            ..Self::default()
        };
        match MapCatalog::discover(root) {
            Ok(catalog) => {
                result.error = catalog.warnings.join("; ");
                for category in catalog.categories {
                    if let Some(layout) = category.layout_path {
                        for item in category.items {
                            result.items.push((
                                item.label,
                                item.source.path().to_path_buf(),
                                layout.clone(),
                            ));
                        }
                    }
                }
            }
            Err(error) => result.error = error,
        }
        result
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn clear_selection(&mut self) {
        if let Some(loader) = &mut self.loader {
            loader.cancel();
        }
        self.selected = None;
        self.active = None;
    }

    pub fn select(&mut self, index: usize) {
        if self.selected == Some(index) {
            return;
        }
        self.selected = Some(index);
        self.active = None;
        if let Some((_, csv, layout)) = self.items.get(index) {
            self.loader.get_or_insert_with(Default::default).select(
                self.root.clone(),
                csv.clone(),
                layout.clone(),
            );
        }
    }

    pub fn loading(&self) -> bool {
        self.loader.as_ref().is_some_and(|loader| loader.pending)
    }

    pub fn poll(&mut self) {
        if let Some(result) = self.loader.as_mut().and_then(|loader| loader.poll()) {
            match result {
                Ok(data) => self.active = Some(data),
                Err(error) => self.error = error,
            }
        }
    }

    /// Returns true when a user chooses a map; callers pause automatic cycling.
    pub fn controls(&mut self, ui: &mut egui::Ui) -> bool {
        if self.loading() {
            ui.spinner();
            ui.ctx().request_repaint();
        }
        let mut choice = self.selected;
        let follow = self.follow.changed(ui.id(), self.selected);
        if !self.items.is_empty() {
            ui.strong("Placement maps");
            let list = egui::ScrollArea::vertical()
                .id_salt("replay_map_list")
                .max_height(180.0)
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.selectable_value(&mut choice, None, "Layout");
                    for (i, (label, _, _)) in self.items.iter().enumerate() {
                        let response = ui.selectable_value(&mut choice, Some(i), label);
                        if follow && self.selected == Some(i) {
                            response.scroll_to_me(None);
                        }
                    }
                });
            if follow && self.selected.is_some() {
                ui.scroll_to_rect(list.inner_rect, None);
            }
            if let Some(data) = &self.active {
                ui.small(format!("{:.3} — {:.3}", data.min(), data.max()));
            }
        }
        let changed = choice != self.selected;
        if changed {
            if let Some(index) = choice {
                self.select(index);
            } else {
                self.clear_selection();
            }
        }
        if !self.error.is_empty() {
            ui.small(&self.error);
        }
        changed
    }

    pub fn paint(&self, painter: &Painter, project: impl Fn(i64, i64) -> Pos2) {
        let Some(data) = &self.active else {
            return;
        };
        for row in 0..data.rows() {
            for col in 0..data.columns() {
                if let (Some(b), Some(value)) =
                    (data.bbox(row, col), data.normalized_value(row, col))
                {
                    let [r, g, bcolor, _] = ColormapMode::Turbo.sample(value);
                    painter.rect_filled(
                        Rect::from_two_pos(
                            project(b.lx.into(), b.ly.into()),
                            project(b.hx.into(), b.hy.into()),
                        ),
                        0.0,
                        Color32::from_rgba_unmultiplied(r, g, bcolor, 155),
                    );
                }
            }
        }
    }
}
