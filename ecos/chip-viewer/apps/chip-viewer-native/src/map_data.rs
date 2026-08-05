use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use chipgeom_format::Rect32;
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
        self.categories.is_empty()
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
        layout.insert(
            (record.pixel_row, record.pixel_col),
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
}
