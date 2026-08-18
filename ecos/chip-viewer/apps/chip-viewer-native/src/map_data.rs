use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use chipgeom_format::{Point32, Rect32};
use serde::Deserialize;

#[derive(Clone, Debug)]
pub struct MapCatalog {
    pub categories: Vec<MapCategory>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct MapCategory {
    pub id: String,
    pub label: String,
    pub layout_path: Option<PathBuf>,
    pub items: Vec<MapItem>,
}

#[derive(Clone, Debug)]
pub struct MapItem {
    pub label: String,
    pub png_path: PathBuf,
    pub csv_path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct HeatmapData {
    values: Vec<Vec<Option<f64>>>,
    layout: BTreeMap<(usize, usize), Rect32>,
    min: f64,
    max: f64,
}

#[derive(Debug, Deserialize)]
struct LayoutRecord {
    pixel_row: usize,
    pixel_col: usize,
    lx: i32,
    ly: i32,
    ux: i32,
    uy: i32,
}

impl MapCatalog {
    pub fn discover(root: &Path) -> Result<Self, String> {
        let entries = fs::read_dir(root)
            .map_err(|err| format!("failed to read map root {}: {err}", root.display()))?;
        let mut category_directories = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let file_type = entry.file_type().ok()?;
                let name = entry.file_name().to_string_lossy().into_owned();
                (file_type.is_dir() && name.to_ascii_lowercase().ends_with("_map"))
                    .then_some((name, entry.path()))
            })
            .collect::<Vec<_>>();
        category_directories.sort_by_key(|(name, _)| name.to_ascii_lowercase());

        let mut categories = Vec::new();
        let mut warnings = Vec::new();
        for (id, directory) in category_directories {
            match discover_category(&id, &directory) {
                Ok(category) if !category.items.is_empty() => categories.push(category),
                Ok(_) => {}
                Err(err) => warnings.push(err),
            }
        }
        Ok(Self {
            categories,
            warnings,
        })
    }

    pub fn item_count(&self) -> usize {
        self.categories
            .iter()
            .map(|category| category.items.len())
            .sum()
    }

    pub fn is_empty(&self) -> bool {
        self.item_count() == 0
    }

    pub fn find_item_by_png(&self, path: &Path) -> Option<(&MapItem, Option<&Path>)> {
        for category in &self.categories {
            for item in &category.items {
                if item.png_path == path {
                    return Some((item, category.layout_path.as_deref()));
                }
            }
        }
        None
    }
}

impl HeatmapData {
    pub fn load(csv_path: &Path, layout_path: &Path) -> Result<Self, String> {
        let values = read_value_matrix(csv_path)?;
        let layout = read_layout(layout_path)?;
        let mut finite_values = values.iter().flatten().filter_map(|value| *value);
        let first = finite_values
            .next()
            .ok_or_else(|| format!("map data contains no finite values: {}", csv_path.display()))?;
        let (min, max) = finite_values.fold((first, first), |(min, max), value| {
            (min.min(value), max.max(value))
        });
        Ok(Self {
            values,
            layout,
            min,
            max,
        })
    }

    pub fn rows(&self) -> usize {
        self.values.len()
    }

    pub fn columns(&self) -> usize {
        self.values.first().map_or(0, Vec::len)
    }

    pub fn value(&self, row: usize, column: usize) -> Option<f64> {
        self.values
            .get(row)
            .and_then(|values| values.get(column))
            .copied()
            .flatten()
    }

    pub fn bbox(&self, row: usize, column: usize) -> Option<Rect32> {
        self.layout.get(&(row, column)).copied()
    }

    pub fn min(&self) -> f64 {
        self.min
    }

    pub fn max(&self) -> f64 {
        self.max
    }

    pub fn normalized_value(&self, row: usize, column: usize) -> Option<f32> {
        let value = self.value(row, column)?;
        let range = self.max - self.min;
        if range.abs() <= f64::EPSILON {
            return Some(0.5);
        }
        Some(((value - self.min) / range).clamp(0.0, 1.0) as f32)
    }

    pub fn top_peaks(&self, invert: bool) -> Vec<(usize, usize)> {
        let rows = self.rows();
        let cols = self.columns();
        if rows == 0 || cols == 0 {
            return Vec::new();
        }

        let mut target_val = if !invert {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
        for r in 0..rows {
            for c in 0..cols {
                let Some(val) = self.value(r, c) else {
                    continue;
                };
                if !self.layout.is_empty() && !self.layout.contains_key(&(r, c)) {
                    continue;
                }
                if !invert {
                    if val > target_val {
                        target_val = val;
                    }
                } else if val < target_val {
                    target_val = val;
                }
            }
        }

        if target_val.is_infinite() {
            return Vec::new();
        }

        let range = (self.max - self.min).abs().max(1e-6);
        let tolerance = (range * 0.05).max(1e-4);

        let radius = 3_isize; // 7x7 spatial window
        let mut candidates = Vec::new();

        let center_r = (rows.saturating_sub(1)) as f64 * 0.5;
        let center_c = (cols.saturating_sub(1)) as f64 * 0.5;

        for r in 0..rows {
            for c in 0..cols {
                let Some(val) = self.value(r, c) else {
                    continue;
                };
                if !self.layout.is_empty() && !self.layout.contains_key(&(r, c)) {
                    continue;
                }

                let is_near_peak = if !invert {
                    val >= target_val - tolerance
                } else {
                    val <= target_val + tolerance
                };

                if !is_near_peak {
                    continue;
                }

                let mut weighted_sum = 0.0;
                let r_i = r as isize;
                let c_i = c as isize;

                for dr in -radius..=radius {
                    for dc in -radius..=radius {
                        let nr = r_i + dr;
                        let nc = c_i + dc;
                        if nr >= 0 && nr < rows as isize && nc >= 0 && nc < cols as isize {
                            if let Some(nval) = self.value(nr as usize, nc as usize) {
                                let dist = ((dr * dr + dc * dc) as f64).sqrt();
                                let w = 1.0 / (1.0 + dist);
                                weighted_sum += nval * w;
                            }
                        }
                    }
                }

                let dist_center =
                    ((r as f64 - center_r).powi(2) + (c as f64 - center_c).powi(2)).sqrt();
                let center_bonus = 1.0 / (1.0 + dist_center * 0.05);

                let score = if !invert {
                    (val - (target_val - tolerance)) / tolerance * 1000.0
                        + weighted_sum * 10.0
                        + center_bonus
                } else {
                    ((target_val + tolerance) - val) / tolerance * 1000.0 - weighted_sum * 10.0
                        + center_bonus
                };

                candidates.push(((r, c), score));
            }
        }

        candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let suppression_radius_sq = ((rows.max(cols) as f64 / 15.0).max(4.0)).powi(2);
        let mut peaks = Vec::new();

        for ((r, c), _) in candidates {
            let too_close = peaks.iter().any(|&(pr, pc)| {
                let dist_sq = (r as f64 - pr as f64).powi(2) + (c as f64 - pc as f64).powi(2);
                dist_sq < suppression_radius_sq
            });
            if !too_close {
                peaks.push((r, c));
                if peaks.len() >= 10 {
                    break;
                }
            }
        }

        if peaks.is_empty() {
            let mut best_cell = None;
            let mut best_val = if !invert {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            };
            for (&(r, c), _) in &self.layout {
                if let Some(val) = self.value(r, c) {
                    if (!invert && val > best_val) || (invert && val < best_val) {
                        best_val = val;
                        best_cell = Some((r, c));
                    }
                }
            }
            if let Some(cell) = best_cell {
                peaks.push(cell);
            }
        }

        peaks
    }

    pub fn peak_cell(&self, invert: bool) -> Option<(usize, usize)> {
        self.top_peaks(invert).first().copied()
    }

    pub fn next_peak_cell(
        &self,
        current: Option<(usize, usize)>,
        invert: bool,
    ) -> Option<(usize, usize)> {
        let peaks = self.top_peaks(invert);
        if peaks.is_empty() {
            return None;
        }
        let Some(curr) = current else {
            return peaks.first().copied();
        };
        if let Some(idx) = peaks.iter().position(|&p| p == curr) {
            let next_idx = (idx + 1) % peaks.len();
            Some(peaks[next_idx])
        } else {
            peaks.first().copied()
        }
    }

    pub fn grid_bbox(&self) -> Option<Rect32> {
        let rows = self.rows();
        let cols = self.columns();
        if rows == 0 || cols == 0 {
            return None;
        }

        let (&(r, c), rect) = self.layout.iter().next()?;

        let pitch_x = self
            .layout
            .get(&(r, c + 1))
            .map(|r2| r2.lx - rect.lx)
            .filter(|&p| p > 0)
            .unwrap_or(rect.hx - rect.lx);

        let pitch_y = self
            .layout
            .get(&(r + 1, c))
            .map(|r2| r2.ly - rect.ly)
            .filter(|&p| p < 0)
            .unwrap_or(-(rect.hy - rect.ly));

        let grid_lx = rect.lx - (c as i32) * pitch_x;
        let grid_hy = rect.hy - (r as i32) * pitch_y;

        Some(Rect32 {
            lx: grid_lx,
            hy: grid_hy,
            hx: grid_lx + pitch_x * cols as i32,
            ly: grid_hy + pitch_y * rows as i32,
        })
    }

    pub fn core_pitch(&self) -> Option<(i32, i32)> {
        let rows = self.rows();
        let cols = self.columns();
        if rows < 3 || cols < 3 {
            return None;
        }
        let r = rows / 2; // interior row
        let c = cols / 2; // interior col
        let a = self.layout.get(&(r, c))?;
        let b = self.layout.get(&(r, c + 1))?;
        let d = self.layout.get(&(r + 1, c))?;
        let pitch_x = (b.lx - a.lx).abs();
        let pitch_y = (d.ly - a.ly).abs();
        Some((pitch_x, pitch_y))
    }

    pub fn cells(&self) -> impl Iterator<Item = ((usize, usize), Rect32)> + '_ {
        self.layout
            .iter()
            .map(|(&(row, col), &rect)| ((row, col), rect))
    }

    pub fn overall_layout_bbox(&self) -> Option<Rect32> {
        let mut rects = self.layout.values().copied();
        let first = rects.next()?;
        Some(rects.fold(first, |acc, rect| Rect32 {
            lx: acc.lx.min(rect.lx),
            ly: acc.ly.min(rect.ly),
            hx: acc.hx.max(rect.hx),
            hy: acc.hy.max(rect.hy),
        }))
    }

    pub fn to_rgba_bytes(&self, mode: ColormapMode) -> Vec<u8> {
        let rows = self.rows();
        let cols = self.columns();
        let mut rgba = Vec::with_capacity(rows * cols * 4);
        for row in 0..rows {
            for col in 0..cols {
                if let Some(norm) = self.normalized_value(row, col) {
                    let color = mode.sample(norm);
                    rgba.extend_from_slice(&color);
                } else {
                    rgba.extend_from_slice(&[0, 0, 0, 0]);
                }
            }
        }
        rgba
    }

    pub fn cell_at_world_point(&self, point: Point32) -> Option<(usize, usize)> {
        let pitch = self.core_pitch();
        for ((row, col), bbox) in &self.layout {
            if point.x >= bbox.lx && point.x <= bbox.hx && point.y >= bbox.ly && point.y <= bbox.hy
            {
                if let Some((px, py)) = pitch {
                    let w = bbox.hx - bbox.lx;
                    let h = bbox.hy - bbox.ly;
                    if (w - px).abs() * 4 > px || (h - py).abs() * 4 > py {
                        continue;
                    }
                }
                return Some((*row, *col));
            }
        }
        None
    }
}

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum ColormapMode {
    #[default]
    Turbo,
    Viridis,
    Plasma,
}

impl ColormapMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Turbo => "Turbo",
            Self::Viridis => "Viridis",
            Self::Plasma => "Plasma",
        }
    }

    pub fn sample(self, normalized: f32) -> [u8; 4] {
        let t = normalized.clamp(0.0, 1.0);
        let (r, g, b) = match self {
            Self::Turbo => colormap_turbo(t),
            Self::Viridis => colormap_viridis(t),
            Self::Plasma => colormap_plasma(t),
        };
        [
            (r.clamp(0.0, 1.0) * 255.0) as u8,
            (g.clamp(0.0, 1.0) * 255.0) as u8,
            (b.clamp(0.0, 1.0) * 255.0) as u8,
            255,
        ]
    }
}

fn colormap_turbo(x: f32) -> (f32, f32, f32) {
    let r = (34.61 + x * (1172.2 + x * (-8970.5 + x * (25881.0 + x * (-30164.0 + x * 12720.0)))))
        / 255.0;
    let g = (23.31 + x * (557.3 + x * (1225.7 + x * (-3571.5 + x * (1074.0 + x * 905.7))))) / 255.0;
    let b = (27.2 + x * (3211.1 + x * (-15327.0 + x * (27546.0 + x * (-21742.0 + x * 6271.0)))))
        / 255.0;
    (r, g, b)
}

fn colormap_viridis(x: f32) -> (f32, f32, f32) {
    let r = 0.267 + x * (0.004 + x * (2.410 - x * 1.681));
    let g = 0.004 + x * (1.385 + x * (-0.354 - x * 0.035));
    let b = 0.329 + x * (1.393 + x * (-2.684 + x * 1.962));
    (r, g, b)
}

fn colormap_plasma(x: f32) -> (f32, f32, f32) {
    let r = 0.050 + x * (2.204 + x * (-2.485 + x * 1.231));
    let g = 0.030 + x * (-0.160 + x * (2.894 - x * 1.764));
    let b = 0.529 + x * (0.910 + x * (-3.220 + x * 1.781));
    (r, g, b)
}

fn discover_category(id: &str, directory: &Path) -> Result<MapCategory, String> {
    let entries = fs::read_dir(directory)
        .map_err(|err| format!("failed to read map category {}: {err}", directory.display()))?;
    let mut png_paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        })
        .collect::<Vec<_>>();
    png_paths.sort_by_key(|path| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });

    let items = png_paths
        .into_iter()
        .filter_map(|png_path| {
            let stem = png_path.file_stem()?.to_string_lossy().into_owned();
            let csv_path = png_path.with_extension("csv");
            Some(MapItem {
                label: humanize_identifier(&stem),
                png_path,
                csv_path: csv_path.is_file().then_some(csv_path),
            })
        })
        .collect();
    let layout_path = directory.join("layout.csv");
    Ok(MapCategory {
        id: id.to_string(),
        label: humanize_category(id),
        layout_path: layout_path.is_file().then_some(layout_path),
        items,
    })
}

fn read_value_matrix(path: &Path) -> Result<Vec<Vec<Option<f64>>>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(path)
        .map_err(|err| format!("failed to open map CSV {}: {err}", path.display()))?;
    let mut values = Vec::new();
    let mut expected_columns = None;
    for (row_index, record) in reader.records().enumerate() {
        let record = record.map_err(|err| {
            format!(
                "failed to read map CSV {} row {}: {err}",
                path.display(),
                row_index + 1
            )
        })?;
        if record.is_empty() {
            continue;
        }
        if let Some(expected) = expected_columns {
            if record.len() != expected {
                return Err(format!(
                    "map CSV {} row {} has {} columns; expected {}",
                    path.display(),
                    row_index + 1,
                    record.len(),
                    expected
                ));
            }
        } else {
            expected_columns = Some(record.len());
        }
        let mut row = Vec::with_capacity(record.len());
        for (column_index, field) in record.iter().enumerate() {
            let field = field.trim();
            if field.is_empty() || field.eq_ignore_ascii_case("nan") {
                row.push(None);
                continue;
            }
            let value = field.parse::<f64>().map_err(|err| {
                format!(
                    "invalid map value at {} row {}, column {}: {err}",
                    path.display(),
                    row_index + 1,
                    column_index + 1
                )
            })?;
            row.push(value.is_finite().then_some(value));
        }
        values.push(row);
    }
    if values.is_empty() || expected_columns == Some(0) {
        return Err(format!("map CSV is empty: {}", path.display()));
    }
    Ok(values)
}

fn read_layout(path: &Path) -> Result<BTreeMap<(usize, usize), Rect32>, String> {
    let mut reader = csv::Reader::from_path(path)
        .map_err(|err| format!("failed to open map layout {}: {err}", path.display()))?;
    let mut layout = BTreeMap::new();
    let is_egr = path.to_string_lossy().to_lowercase().contains("egr");

    for record in reader.deserialize::<LayoutRecord>() {
        let record =
            record.map_err(|err| format!("failed to read map layout {}: {err}", path.display()))?;
        if record.ux <= record.lx || record.uy <= record.ly {
            return Err(format!(
                "map layout {} has an invalid rectangle at row {}, column {}",
                path.display(),
                record.pixel_row,
                record.pixel_col
            ));
        }
        let key = if is_egr {
            (record.pixel_col, record.pixel_row)
        } else {
            (record.pixel_row, record.pixel_col)
        };
        layout.insert(
            key,
            Rect32 {
                lx: record.lx,
                ly: record.ly,
                hx: record.ux,
                hy: record.uy,
            },
        );
    }
    if layout.is_empty() {
        return Err(format!("map layout is empty: {}", path.display()));
    }
    Ok(layout)
}

fn humanize_category(id: &str) -> String {
    let base = id
        .strip_suffix("_map")
        .or_else(|| id.strip_suffix("_MAP"))
        .unwrap_or(id);
    humanize_identifier(base).to_ascii_uppercase()
}

fn humanize_identifier(value: &str) -> String {
    value.replace('_', " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("chip-viewer-{name}-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn discovers_map_categories_and_pairs_png_with_csv() {
        let root = temp_directory("map-catalog");
        let density = root.join("density_map");
        fs::create_dir_all(&density).unwrap();
        fs::write(density.join("place_density.png"), b"preview").unwrap();
        fs::write(density.join("place_density.csv"), b"0.0,1.0\n").unwrap();
        fs::write(
            density.join("layout.csv"),
            b"pixel_row,pixel_col,lx,ly,ux,uy\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("not_a_category")).unwrap();

        let catalog = MapCatalog::discover(&root).unwrap();

        assert_eq!(catalog.categories.len(), 1);
        assert_eq!(catalog.categories[0].id, "density_map");
        assert_eq!(catalog.categories[0].label, "DENSITY");
        assert_eq!(catalog.categories[0].items.len(), 1);
        assert!(catalog.categories[0].items[0].csv_path.is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn loads_values_and_pixel_to_layout_coordinates() {
        let root = temp_directory("map-data");
        let values = root.join("density.csv");
        let layout = root.join("layout.csv");
        fs::write(&values, "0.0,0.5\n1.0,nan\n").unwrap();
        fs::write(
            &layout,
            "pixel_row,pixel_col,grid_x,grid_y,lx,ly,ux,uy\n\
             0,0,0,1,0,100,10,110\n\
             0,1,1,1,10,100,20,110\n\
             1,0,0,0,0,90,10,100\n\
             1,1,1,0,10,90,20,100\n",
        )
        .unwrap();

        let heatmap = HeatmapData::load(&values, &layout).unwrap();

        assert_eq!(heatmap.rows(), 2);
        assert_eq!(heatmap.columns(), 2);
        assert_eq!(heatmap.min(), 0.0);
        assert_eq!(heatmap.max(), 1.0);
        assert_eq!(heatmap.value(0, 1), Some(0.5));
        assert_eq!(heatmap.value(1, 1), None);
        assert_eq!(
            heatmap.bbox(0, 1),
            Some(Rect32 {
                lx: 10,
                ly: 100,
                hx: 20,
                hy: 110,
            })
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_ragged_value_matrices() {
        let root = temp_directory("map-ragged");
        let values = root.join("density.csv");
        fs::write(&values, "0.0,0.5\n1.0\n").unwrap();

        let error = read_value_matrix(&values).unwrap_err();

        assert!(error.contains("expected 2"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn heatmap_gpu_texture_helpers() {
        let root = temp_directory("map-gpu-helpers");
        let values = root.join("values.csv");
        let layout = root.join("layout.csv");

        fs::write(&values, "0.0,1.0\n").unwrap();
        fs::write(
            &layout,
            "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,0,10,10\n0,1,10,0,20,10\n",
        )
        .unwrap();

        let heatmap = HeatmapData::load(&values, &layout).unwrap();
        assert_eq!(
            heatmap.overall_layout_bbox(),
            Some(Rect32 {
                lx: 0,
                ly: 0,
                hx: 20,
                hy: 10
            })
        );

        let rgba_turbo = heatmap.to_rgba_bytes(ColormapMode::Turbo);
        assert_eq!(rgba_turbo.len(), 2 * 4);

        let cell = heatmap.cell_at_world_point(Point32 { x: 15, y: 5 });
        assert_eq!(cell, Some((0, 1)));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn peak_cell_selects_densest_cluster() {
        let root = temp_directory("map-peak-cluster");
        let values = root.join("values.csv");
        let layout = root.join("layout.csv");

        // 3x3 grid:
        // [0.0, 0.0, 1.0] (isolated 1.0 at corner (0, 2))
        // [0.0, 1.0, 1.0] (dense cluster at (1,1)-(2,2))
        // [0.0, 1.0, 1.0]
        fs::write(&values, "0.0,0.0,1.0\n0.0,1.0,1.0\n0.0,1.0,1.0\n").unwrap();
        fs::write(
            &layout,
            "pixel_row,pixel_col,lx,ly,ux,uy\n\
             0,0,0,20,10,30\n0,1,10,20,20,30\n0,2,20,20,30,30\n\
             1,0,0,10,10,20\n1,1,10,10,20,20\n1,2,20,10,30,20\n\
             2,0,0,0,10,10\n2,1,10,0,20,10\n2,2,20,0,30,10\n",
        )
        .unwrap();

        let heatmap = HeatmapData::load(&values, &layout).unwrap();
        assert_eq!(heatmap.min(), 0.0);
        assert_eq!(heatmap.max(), 1.0);

        // In normal mode: peak is in the center of the dense cluster (1, 1) or (1, 2)/(2, 1)/(2, 2)
        // rather than the isolated (0, 2) corner.
        let peak = heatmap.peak_cell(false).unwrap();
        assert_eq!(heatmap.value(peak.0, peak.1), Some(1.0));
        assert_ne!(peak, (0, 2)); // Not the isolated corner
        assert!(peak == (1, 1) || peak == (1, 2) || peak == (2, 1) || peak == (2, 2));

        // In inverted mode (coldspot): finds minimum value
        let coldspot = heatmap.peak_cell(true).unwrap();
        assert_eq!(heatmap.value(coldspot.0, coldspot.1), Some(0.0));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn peak_cell_handles_checkered_striped_views() {
        let root = temp_directory("map-checkered");
        let values = root.join("values.csv");
        let layout = root.join("layout.csv");

        // 7x7 grid with standard cell alternating rows (checkered/striped):
        // Row 0: 1.0 everywhere
        // Row 1: 0.0 everywhere (gap)
        // Row 2: 1.0 everywhere
        // Row 3: 0.0 everywhere (gap)
        // Row 4: 1.0 everywhere
        // Row 5: 0.0 everywhere (gap)
        // Row 6: 1.0 everywhere, except dense block in center (2..4, 2..4)
        let mut val_str = String::new();
        let mut lay_str = String::from("pixel_row,pixel_col,lx,ly,ux,uy\n");
        for r in 0..7 {
            let is_cell_row = r % 2 == 0;
            let mut row_vals = Vec::new();
            for c in 0..7 {
                let v = if is_cell_row {
                    if (2..=4).contains(&r) && (2..=4).contains(&c) {
                        1.0 // center core cluster
                    } else {
                        0.8 // normal cell
                    }
                } else {
                    0.0 // gap
                };
                row_vals.push(format!("{v:.1}"));
                lay_str.push_str(&format!(
                    "{r},{c},{},{},{},{}\n",
                    c * 10,
                    (6 - r) * 10,
                    (c + 1) * 10,
                    (7 - r) * 10
                ));
            }
            val_str.push_str(&row_vals.join(","));
            val_str.push('\n');
        }

        fs::write(&values, val_str).unwrap();
        fs::write(&layout, lay_str).unwrap();

        let heatmap = HeatmapData::load(&values, &layout).unwrap();
        let peak = heatmap.peak_cell(false).unwrap();

        // Must pick the central dense cluster (row 2 or 4, col 2..4)
        assert_eq!(heatmap.value(peak.0, peak.1), Some(1.0));
        assert!(peak.0 == 2 || peak.0 == 4);
        assert!((2..=4).contains(&peak.1));

        fs::remove_dir_all(root).unwrap();
    }
}
