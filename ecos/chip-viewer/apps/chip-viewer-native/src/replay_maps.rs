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

    pub fn controls(&mut self, ui: &mut egui::Ui) {
        if !self.items.is_empty() {
            ui.separator();
            ui.label("Placement analysis");
            let mut choice = self.selected;
            egui::ComboBox::from_id_salt("replay_map")
                .selected_text(choice.map(|i| self.items[i].0.as_str()).unwrap_or("Layout"))
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut choice, None, "Layout");
                    for (i, (label, _, _)) in self.items.iter().enumerate() {
                        ui.selectable_value(&mut choice, Some(i), label);
                    }
                });
            if let Some(i) = choice {
                self.select(i);
            } else {
                self.selected = None;
                self.active = None;
            }
            if let Some(data) = &self.active {
                ui.small(format!("{:.3} — {:.3}", data.min(), data.max()));
            }
        }
        if !self.error.is_empty() {
            ui.small(&self.error);
        }
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
