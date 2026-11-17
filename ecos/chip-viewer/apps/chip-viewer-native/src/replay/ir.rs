//! Network views keep a fixed voltage scale while the completed map is revealed.
use crate::ir_drop::IrDrop;
use chipgeom_format::replay_analysis::Analysis;
use std::collections::BTreeMap;

#[derive(Default)]
pub struct IrOverlays {
    maps: BTreeMap<usize, IrDrop>,
    layers: BTreeMap<usize, Option<String>>,
}

impl IrOverlays {
    pub fn load(data: &Analysis, record: &super::data::Recording) -> anyhow::Result<Self> {
        let mut maps = BTreeMap::new();
        for (index, view) in data
            .views
            .iter()
            .enumerate()
            .filter(|(_, v)| v.kind == "ir")
        {
            let map = if let Some(network) = view.summary["geometry_network"].as_str() {
                let path = record
                    .final_geometry_path()?
                    .ok_or_else(|| anyhow::anyhow!("Missing IR geometry"))?;
                let assets = crate::geometry_maps::assets(&path)?;
                let mut all = None;
                let mut layers = BTreeMap::new();
                for (path, asset) in assets {
                    if asset.metadata["kind"] != "ir" || asset.metadata["network"] != network {
                        continue;
                    }
                    let data = std::sync::Arc::new(crate::geometry_maps::load(&path)?);
                    match asset.metadata["layer"].as_str().unwrap_or("") {
                        "" => all = Some(data),
                        name => {
                            layers.insert(name.to_owned(), data);
                        }
                    }
                }
                IrDrop {
                    all: all.ok_or_else(|| anyhow::anyhow!("Missing IR all-layer grid"))?,
                    layers,
                    samples: view.summary["nodes"].as_u64().unwrap_or(0) as usize,
                }
            } else {
                IrDrop::from_view(view)?
            };
            maps.insert(index, map);
        }
        Ok(Self {
            maps,
            ..Default::default()
        })
    }

    pub fn controls(&mut self, ui: &mut egui::Ui, index: usize) -> bool {
        let Some(map) = self.maps.get(&index) else {
            return false;
        };
        let layer = self.layers.entry(index).or_default();
        let previous = layer.clone();
        egui::ComboBox::from_id_salt(("ir_layer", index))
            .selected_text(layer.as_deref().unwrap_or("All layers"))
            .show_ui(ui, |ui| {
                ui.selectable_value(layer, None, "All layers");
                for name in map.layers.keys() {
                    ui.selectable_value(layer, Some(name.clone()), name);
                }
            });
        ui.small(format!(
            "{} solved nodes · spatial reveal · 4 s",
            map.samples
        ));
        crate::ir_drop::legend(ui, map.data(layer.as_deref()));
        previous != *layer
    }

    pub fn paint(
        &self,
        painter: &egui::Painter,
        project: impl Fn(i64, i64) -> egui::Pos2,
        index: usize,
        progress: f32,
    ) {
        let Some(map) = self.maps.get(&index) else {
            return;
        };
        let layer = self.layers.get(&index).and_then(|v| v.as_deref());
        crate::ir_drop::paint(map.data(layer), painter, project, progress);
    }
}
