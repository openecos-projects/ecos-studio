use crate::map_data::{ColormapMode, HeatmapData, MapCatalog};
use crate::replay_data::within;
use egui::{Color32, Painter, Pos2, Rect};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct ReplayMaps {
    root: PathBuf,
    items: Vec<(String, PathBuf, PathBuf)>,
    pub selected: Option<usize>,
    active: Option<HeatmapData>,
    listed_selection: Option<usize>,
    pub error: String,
}

impl ReplayMaps {
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
                            result
                                .items
                                .push((item.label, item.csv_path, layout.clone()));
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
            let loaded = (|| {
                let csv = within(&self.root, csv).map_err(|e| e.to_string())?;
                let layout = within(&self.root, layout).map_err(|e| e.to_string())?;
                HeatmapData::load(&csv, &layout)
            })();
            match loaded {
                Ok(data) => self.active = Some(data),
                Err(error) => self.error = error,
            }
        }
    }

    /// Returns true when a user chooses a map; callers pause automatic cycling.
    pub fn controls(&mut self, ui: &mut egui::Ui) -> bool {
        let mut choice = self.selected;
        let follow = self.listed_selection != self.selected;
        if !self.items.is_empty() {
            ui.strong("Placement maps");
            egui::ScrollArea::vertical()
                .id_salt("replay_map_list")
                .max_height(180.0)
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.selectable_value(&mut choice, None, "Layout");
                    for (i, (label, _, _)) in self.items.iter().enumerate() {
                        let response = ui.selectable_value(&mut choice, Some(i), label);
                        if follow && self.selected == Some(i) {
                            response.scroll_to_me(Some(egui::Align::Center));
                        }
                    }
                });
            if let Some(data) = &self.active {
                ui.small(format!("{:.3} — {:.3}", data.min(), data.max()));
            }
        }
        self.listed_selection = self.selected;
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
