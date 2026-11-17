//! Map inputs share selection and display without pretending IR samples are CSVs.
use crate::map_data::HeatmapData;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug)]
pub enum MapSource {
    Csv(PathBuf),
    Ir {
        file: PathBuf,
        view: usize,
        layer: Option<String>,
        data: Arc<HeatmapData>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MapKey {
    Csv(PathBuf),
    Ir(PathBuf, usize, Option<String>),
}

impl MapSource {
    pub fn key(&self) -> MapKey {
        match self {
            Self::Csv(path) => MapKey::Csv(path.clone()),
            Self::Ir {
                file, view, layer, ..
            } => MapKey::Ir(file.clone(), *view, layer.clone()),
        }
    }
    pub fn path(&self) -> &Path {
        match self {
            Self::Csv(path) => path,
            Self::Ir { file, .. } => file,
        }
    }
    pub fn load(&self, layout: Option<&Path>) -> Result<HeatmapData, String> {
        match self {
            Self::Csv(path) => HeatmapData::load(path, layout.ok_or("Missing layout.csv")?),
            Self::Ir { data, .. } => Ok(data.as_ref().clone()),
        }
    }
}

pub fn discover_ir(root: &Path) -> Result<Vec<crate::map_data::MapCategory>, String> {
    let file = root.join("ir_drop.json");
    if !file.is_file() {
        return Ok(Vec::new());
    }
    let views = crate::ir_drop::load(&file).map_err(|err| format!("IR spatial data: {err:#}"))?;
    Ok(views
        .into_iter()
        .enumerate()
        .map(|(view, (label, map))| {
            let mut items = vec![crate::map_data::MapItem {
                label: format!("{label} · All layers [mV]"),
                source: MapSource::Ir {
                    file: file.clone(),
                    view,
                    layer: None,
                    data: map.all,
                },
            }];
            for (layer, data) in map.layers {
                items.push(crate::map_data::MapItem {
                    label: format!("{label} · {layer} [mV]"),
                    source: MapSource::Ir {
                        file: file.clone(),
                        view,
                        layer: Some(layer),
                        data,
                    },
                });
            }
            crate::map_data::MapCategory {
                id: format!("ir_{view}"),
                label,
                layout_path: None,
                items,
            }
        })
        .collect())
}
