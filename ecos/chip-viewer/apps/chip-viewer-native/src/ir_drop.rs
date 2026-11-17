//! Solved IR samples -> bounded spatial maxima, shared by Map and Replay.
use crate::map_data::{ColormapMode, HeatmapData};
use anyhow::{ensure, Context, Result};
use chipgeom_format::{replay_analysis::View, Rect32};
use egui::{Color32, Pos2};
use serde::Deserialize;
use std::{collections::BTreeMap, path::Path, sync::Arc};

#[derive(Deserialize)]
struct Document {
    schema: String,
    coordinate_unit: String,
    dbu_per_micron: u32,
    #[serde(default)]
    geometry_manifest_sha256: Option<String>,
    views: Vec<View>,
}

#[derive(Clone, Debug)]
pub struct IrDrop {
    pub all: Arc<HeatmapData>,
    pub layers: BTreeMap<String, Arc<HeatmapData>>,
    pub samples: usize,
}

impl IrDrop {
    pub fn from_view(view: &View) -> Result<Self> {
        ensure!(
            view.kind == "ir" && view.unit == "V" && view.basis == "final",
            "Unsupported IR sample units or basis"
        );
        ensure!(!view.items.is_empty(), "No IR samples recorded");
        let mut samples = Vec::with_capacity(view.items.len());
        let mut bounds = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
        let mut maximum = 0.0_f64;
        for item in &view.items {
            let value = item.value.context("Missing IR drop")? * 1000.0;
            ensure!(value.is_finite() && value >= 0.0, "Invalid IR drop");
            let [b] = item.bboxes.as_slice() else {
                anyhow::bail!("IR sample must have one position")
            };
            ensure!(b[0] == b[2] && b[1] == b[3], "IR sample must be a point");
            let x = i32::try_from(b[0]).context("IR X exceeds DBU range")?;
            let y = i32::try_from(b[1]).context("IR Y exceeds DBU range")?;
            let layer = item.details["layer"]
                .as_str()
                .filter(|s| !s.is_empty())
                .context("Missing IR layer")?;
            bounds = [
                bounds[0].min(x),
                bounds[1].min(y),
                bounds[2].max(x),
                bounds[3].max(y),
            ];
            maximum = maximum.max(value);
            samples.push((x, y, layer, value));
        }
        // Exclusive upper edges include the last node, including single-point nets.
        let [lx, ly, hx, hy] = bounds;
        let hx = hx.checked_add(1).context("IR X bounds overflow")?;
        let hy = hy.checked_add(1).context("IR Y bounds overflow")?;
        let width = i64::from(hx) - i64::from(lx);
        let height = i64::from(hy) - i64::from(ly);
        let pitch = ((width.max(height) + 31) / 32).max(1);
        let cols = ((width + pitch - 1) / pitch) as usize;
        let rows = ((height + pitch - 1) / pitch) as usize;
        let mut layout = BTreeMap::new();
        for row in 0..rows {
            for col in 0..cols {
                layout.insert(
                    (row, col),
                    Rect32 {
                        lx: (i64::from(lx) + width * col as i64 / cols as i64) as i32,
                        hx: (i64::from(lx) + width * (col + 1) as i64 / cols as i64) as i32,
                        ly: (i64::from(ly) + height * (rows - row - 1) as i64 / rows as i64) as i32,
                        hy: (i64::from(ly) + height * (rows - row) as i64 / rows as i64) as i32,
                    },
                );
            }
        }
        let mut grids = BTreeMap::<String, Vec<Vec<Option<f64>>>>::new();
        let mut all = vec![vec![None::<f64>; cols]; rows];
        for (x, y, layer, value) in samples {
            // Invert the integer partition above, including exact cell edges.
            let col = (((i64::from(x) - i64::from(lx) + 1) * cols as i64 - 1) / width) as usize;
            let bottom_row =
                (((i64::from(y) - i64::from(ly) + 1) * rows as i64 - 1) / height) as usize;
            let row = rows - 1 - bottom_row;
            let grid = grids
                .entry(layer.to_owned())
                .or_insert_with(|| vec![vec![None; cols]; rows]);
            grid[row][col] = Some(grid[row][col].map_or(value, |old| old.max(value)));
            all[row][col] = Some(all[row][col].map_or(value, |old| old.max(value)));
        }
        let make = |values| Arc::new(HeatmapData::ir_drop(values, layout.clone(), maximum));
        Ok(Self {
            all: make(all),
            layers: grids
                .into_iter()
                .map(|(name, grid)| (name, make(grid)))
                .collect(),
            samples: view.items.len(),
        })
    }

    pub fn data(&self, layer: Option<&str>) -> &HeatmapData {
        layer
            .and_then(|name| self.layers.get(name))
            .unwrap_or(&self.all)
    }
}

pub fn load(path: &Path) -> Result<Vec<(String, IrDrop)>> {
    let document: Document = crate::replay::data::read(path)?;
    if let Some(sha256) = document.geometry_manifest_sha256 {
        let manifest = path
            .parent()
            .and_then(Path::parent)
            .context("Missing IR snapshot root")?
            .join("geometry.manifest");
        crate::replay::integrity::verify(
            &manifest,
            &chipgeom_format::replay::Fingerprint {
                size: manifest.metadata()?.len(),
                sha256,
            },
        )?;
    }
    ensure!(
        document.schema == "ecos.emir.ir.v1"
            && document.coordinate_unit == "dbu"
            && document.dbu_per_micron > 0,
        "Unsupported IR spatial schema or units"
    );
    document
        .views
        .iter()
        .map(|view| Ok((view.label.clone(), IrDrop::from_view(view)?)))
        .collect()
}

/// Spatial reveal of final values. It does not animate voltage magnitudes.
pub fn paint(
    data: &HeatmapData,
    painter: &egui::Painter,
    project: impl Fn(i64, i64) -> Pos2,
    progress: f32,
) {
    let cells: Vec<_> = data
        .cells()
        .filter_map(|((r, c), b)| data.normalized_value(r, c).map(|v| (b, v)))
        .collect();
    let count = (cells.len() as f32 * progress.clamp(0.0, 1.0)).ceil() as usize;
    let mut mesh = egui::Mesh::default();
    for (b, value) in cells.into_iter().take(count) {
        let [r, g, blue, _] = ColormapMode::Inferno.sample(value);
        let color = Color32::from_rgba_unmultiplied(r, g, blue, 210);
        let start = mesh.vertices.len() as u32;
        for (x, y) in [(b.lx, b.ly), (b.hx, b.ly), (b.hx, b.hy), (b.lx, b.hy)] {
            mesh.colored_vertex(project(x.into(), y.into()), color);
        }
        mesh.add_triangle(start, start + 1, start + 2);
        mesh.add_triangle(start, start + 2, start + 3);
    }
    if !mesh.is_empty() {
        painter.add(egui::Shape::mesh(mesh));
    }
}

pub fn legend(ui: &mut egui::Ui, data: &HeatmapData) {
    ui.small("Static IR result · maximum sample per cell");
    let (bar, _) =
        ui.allocate_exact_size(egui::vec2(ui.available_width(), 10.0), egui::Sense::hover());
    for i in 0..64 {
        let [r, g, b, _] = ColormapMode::Inferno.sample(i as f32 / 63.0);
        ui.painter().rect_filled(
            egui::Rect::from_min_max(
                egui::pos2(bar.left() + bar.width() * i as f32 / 64.0, bar.top()),
                egui::pos2(
                    bar.left() + bar.width() * (i + 1) as f32 / 64.0,
                    bar.bottom(),
                ),
            ),
            0.0,
            Color32::from_rgb(r, g, b),
        );
    }
    ui.small(format!("0 — {:.6} mV · brighter = larger drop", data.max()));
}

#[cfg(test)]
#[path = "ir_drop_tests.rs"]
mod tests;
