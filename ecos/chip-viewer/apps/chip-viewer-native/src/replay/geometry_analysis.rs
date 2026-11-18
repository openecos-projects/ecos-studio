//! Native display assets are already bound by Recording's geometry fingerprint set.
use super::data::Recording;
use anyhow::{Context, Result};
use chipgeom_format::replay_analysis::{Analysis, Item, View};
use chipgeom_reader::display::DisplayAsset;
use serde_json::{json, Value};

pub fn append(record: &Recording, data: &mut Analysis) -> Result<()> {
    let path = record
        .final_geometry_path()?
        .context("Missing analysis geometry")?;
    let manifest = chipgeom_reader::read_manifest(&path)?;
    let mut assets = crate::geometry_maps::assets(&path)?;
    if let Some(path) = manifest
        .drc
        .filter(|p| p.extension().is_some_and(|e| e == "gdisplay"))
    {
        let asset = DisplayAsset::open(&path)?;
        assets.push((path, asset));
    }
    let power_names = assets
        .iter()
        .find(|(_, a)| a.metadata["kind"] == "power_instances")
        .map(|(_, a)| a.clone());
    for (_, asset) in assets {
        let m = &asset.metadata;
        let kind = m["kind"].as_str().unwrap_or("");
        if !super::analysis_data::belongs_to_step(&record.manifest.step, kind) {
            continue;
        }
        if !matches!(
            kind,
            "ir" | "em" | "power" | "drc" | "antenna" | "lvs" | "timing" | "rcx"
        ) {
            continue;
        }
        if kind == "ir" && m["layer"].as_str().is_some_and(|s| !s.is_empty()) {
            continue;
        }
        let mut view = View {
            label: m["label"].as_str().unwrap_or(kind).into(),
            kind: kind.into(),
            basis: "final".into(),
            unit: m["unit"].as_str().unwrap_or("").into(),
            items: Vec::new(),
            summary: m.clone(),
        };
        if kind == "ir" {
            view.summary["geometry_network"] = m["network"].clone();
            data.views.push(view);
            continue;
        }
        if kind == "power" {
            for i in 0..asset.count {
                let c = asset.cell(i)?;
                let b = c.bounds;
                view.items.push(Item {
                    label: power_names
                        .as_ref()
                        .map(|a| a.record::<String>(i))
                        .transpose()?
                        .unwrap_or_else(|| format!("Cell {i}")),
                    value: Some(c.value),
                    bboxes: vec![[b.lx.into(), b.ly.into(), b.hx.into(), b.hy.into()]],
                    ..Default::default()
                });
            }
        } else {
            for i in 0..asset.count {
                let row: Value = asset.record(i)?;
                let item = match kind {
                    "em" | "rcx" => serde_json::from_value(row)?,
                    "timing" => Item {
                        label: format!(
                            "{} → {}",
                            row["start_point"].as_str().unwrap_or("?"),
                            row["end_point"].as_str().unwrap_or("?")
                        ),
                        value: row["slack_ns"].as_f64(),
                        details: row,
                        ..Default::default()
                    },
                    "drc" => Item {
                        label: row["type"].as_str().unwrap_or("DRC").into(),
                        bboxes: vec![[
                            integer(&row, "llx")?,
                            integer(&row, "lly")?,
                            integer(&row, "urx")?,
                            integer(&row, "ury")?,
                        ]],
                        nets: strings(&row["net"]),
                        instances: strings(&row["inst"]),
                        details: row,
                        ..Default::default()
                    },
                    "antenna" => {
                        let b = &row["location"];
                        Item {
                            label: row["type"].as_str().unwrap_or("Antenna").into(),
                            value: row["ratio"].as_f64(),
                            nets: strings(&row["net"]),
                            instances: strings(&row["instance"]),
                            bboxes: vec![[
                                integer(b, "lx")?,
                                integer(b, "ly")?,
                                integer(b, "hx")?,
                                integer(b, "hy")?,
                            ]],
                            details: row,
                            ..Default::default()
                        }
                    }
                    "lvs" => {
                        let boxes = row["shapes"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|s| serde_json::from_value(s["rect"].clone()))
                            .collect::<std::result::Result<Vec<_>, _>>()?;
                        Item {
                            label: row["type"].as_str().unwrap_or("LVS").into(),
                            nets: strings(&row["net"]),
                            instances: strings(&row["instance"]),
                            bboxes: boxes,
                            details: row,
                            ..Default::default()
                        }
                    }
                    _ => unreachable!(),
                };
                view.items.push(item);
            }
        }
        if kind == "timing" {
            for analysis_type in ["setup", "hold"] {
                let items = view
                    .items
                    .iter_mut()
                    .filter(|i| i.details["analysis_type"] == analysis_type)
                    .map(std::mem::take)
                    .collect::<Vec<_>>();
                if !items.is_empty() {
                    data.views.push(View {
                        label: format!(
                            "{} · {analysis_type}",
                            m["corner"].as_str().unwrap_or("unknown")
                        ),
                        kind: "timing".into(),
                        basis: "final".into(),
                        unit: "ns".into(),
                        items,
                        summary: json!({"corner":m["corner"],"analysis_type":analysis_type}),
                    });
                }
            }
        } else {
            data.views.push(view);
        }
    }
    Ok(())
}

fn integer(value: &Value, key: &str) -> Result<i64> {
    value[key]
        .as_i64()
        .with_context(|| format!("Missing geometry analysis {key}"))
}

fn strings(value: &Value) -> Vec<String> {
    if let Some(text) = value.as_str() {
        return if text.is_empty() {
            Vec::new()
        } else {
            vec![text.to_owned()]
        };
    }
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

// Timeline planning reads only small catalogs. Record decoding waits until this
// step is selected, so opening Replay does not materialize every analysis twice.
pub fn duration(record: &Recording) -> Result<f64> {
    let path = record
        .final_geometry_path()?
        .context("Missing analysis geometry")?;
    let manifest = chipgeom_reader::read_manifest(&path)?;
    let mut total = if manifest
        .drc
        .as_ref()
        .is_some_and(|p| p.extension().is_some_and(|e| e == "gdisplay"))
    {
        super::drc_review::duration(super::layer_focus::routing_layers(record)?.len())
    } else {
        0.0
    };
    for (_, asset) in crate::geometry_maps::assets(&path)? {
        let meta = &asset.metadata;
        if !super::analysis_data::belongs_to_step(
            &record.manifest.step,
            meta["kind"].as_str().unwrap_or(""),
        ) {
            continue;
        }
        total += match meta["kind"].as_str() {
            Some("ir") if meta["layer"] == "" => 4.0,
            Some("power") => 4.0,
            Some("rcx") => super::rcx::CORNER_SECONDS,
            Some("timing") if asset.count > 0 => super::timing::CORNER_SECONDS,
            Some("em" | "antenna" | "lvs") => super::plan::MAP_SECONDS,
            _ => 0.0,
        };
    }
    Ok(total)
}
