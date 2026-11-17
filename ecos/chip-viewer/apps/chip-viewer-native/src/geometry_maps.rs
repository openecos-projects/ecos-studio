//! Geometry-owned maps: catalog reads metadata; selection reads just one dataset.
use crate::{
    map_data::{GeometryMapKind, HeatmapData, MapCategory, MapItem},
    map_source::MapSource,
};
use anyhow::{ensure, Context, Result};
use chipgeom_reader::{display::DisplayAsset, read_manifest};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub fn assets(manifest: &Path) -> Result<Vec<(PathBuf, DisplayAsset)>> {
    let snapshot = read_manifest(manifest)?;
    let mut identities = std::collections::BTreeSet::new();
    snapshot
        .display
        .into_iter()
        .map(|path| {
            let data = DisplayAsset::open(&path)?;
            ensure!(
                identities.insert(data.metadata["key"].as_str().unwrap().to_owned()),
                "Duplicate geometry dataset identity"
            );
            if let Some(units) = data.metadata["dbu_per_micron"].as_u64() {
                ensure!(
                    snapshot
                        .dbu_per_micron
                        .is_some_and(|dbu| u64::from(dbu) == units),
                    "Display/geometry unit mismatch"
                );
            }
            Ok((path, data))
        })
        .collect()
}

pub fn discover(manifest: &Path) -> Result<Vec<MapCategory>> {
    Ok(categories(&assets(manifest)?))
}

pub(crate) fn categories(assets: &[(PathBuf, DisplayAsset)]) -> Vec<MapCategory> {
    let mut groups = BTreeMap::<String, MapCategory>::new();
    for (path, asset) in assets {
        let meta = &asset.metadata;
        let kind = meta["kind"].as_str().unwrap_or("");
        if !matches!(kind, "ir" | "map" | "power") {
            continue;
        }
        let group = meta["category"]
            .as_str()
            .or_else(|| meta["network"].as_str())
            .unwrap_or(kind)
            .to_owned();
        let label = meta["label"].as_str().unwrap_or(kind);
        let item_label = if kind == "ir" {
            let layer = meta["layer"].as_str().unwrap_or("");
            format!(
                "{label} · {} [mV]",
                if layer.is_empty() {
                    "All layers"
                } else {
                    layer
                }
            )
        } else {
            label.to_owned()
        };
        groups
            .entry(group.clone())
            .or_insert_with(|| MapCategory {
                id: format!("geometry_{group}"),
                label: group,
                layout_path: None,
                items: Vec::new(),
            })
            .items
            .push(MapItem {
                label: item_label,
                source: MapSource::Geometry(path.clone()),
            });
    }
    groups.into_values().collect()
}

pub fn load(path: &Path) -> Result<HeatmapData> {
    let asset = DisplayAsset::open(path)?;
    let meta = &asset.metadata;
    let rows = usize::try_from(meta["rows"].as_u64().context("Missing map rows")?)?;
    let cols = usize::try_from(meta["columns"].as_u64().context("Missing map columns")?)?;
    ensure!(
        (rows > 0 || asset.count == 0)
            && cols > 0
            && rows.checked_mul(cols).is_some_and(|n| n <= 16_777_216),
        "Map dimensions exceed limit"
    );
    let ir = meta["kind"] == "ir";
    let scale = if ir {
        ensure!(meta["unit"] == "V", "Invalid IR units");
        1000.0
    } else {
        1.0
    };
    let mut values = vec![None; rows * cols];
    let mut layout = BTreeMap::new();
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    for i in 0..asset.count {
        let cell = asset.cell(i)?;
        let row = cell.row as usize;
        let col = cell.column as usize;
        ensure!(row < rows && col < cols, "Map cell outside grid");
        let value = cell.value * scale;
        ensure!(
            value.is_finite() && (!ir || value >= 0.0),
            "Invalid map value"
        );
        ensure!(
            values[row * cols + col].replace(value).is_none(),
            "Duplicate map cell"
        );
        layout.insert((row, col), cell.bounds);
        minimum = minimum.min(value);
        maximum = maximum.max(value);
    }
    if ir {
        let shared = meta["maximum"].as_f64().context("Missing IR scale")? * scale;
        ensure!(
            shared.is_finite() && shared >= maximum.max(0.0),
            "Invalid IR scale"
        );
        Ok(HeatmapData::geometry(
            (rows, cols),
            values,
            layout,
            GeometryMapKind::Ir,
            (0.0, shared),
        ))
    } else {
        Ok(HeatmapData::geometry(
            (rows, cols),
            values,
            layout,
            if meta["kind"] == "power" {
                GeometryMapKind::Power
            } else {
                GeometryMapKind::Grid
            },
            (minimum, maximum),
        ))
    }
}

#[cfg(test)]
#[path = "geometry_maps_tests.rs"]
mod tests;
