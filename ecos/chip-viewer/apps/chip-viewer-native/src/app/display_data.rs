//! Load geometry analyses off the UI thread, including legacy text compatibility.
use super::*;
use chipgeom_reader::display::DisplayAsset;

pub(super) struct Analyses {
    pub drc: Option<DrcOverlay>,
    pub antenna: Option<AntennaOverlay>,
    pub lvs: Option<lvs::LvsAnalysis>,
    pub maps: Result<MapCatalog, String>,
    pub timing_directory: Option<PathBuf>,
}

#[derive(Clone)]
pub(super) struct Inputs {
    pub map_root: Option<PathBuf>,
    pub drc: Option<PathBuf>,
    pub drc_stats: Option<PathBuf>,
    pub antenna: Option<PathBuf>,
    pub antenna_stats: Option<PathBuf>,
    pub lvs: Option<PathBuf>,
}

pub(super) fn prepare(manifest: PathBuf, inputs: Inputs) -> Receiver<Analyses> {
    let Inputs {
        map_root,
        drc,
        drc_stats,
        antenna,
        antenna_stats,
        lvs,
    } = inputs;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let native = chipgeom_reader::read_manifest(&manifest);
        let drc = native.as_ref().ok().and_then(|m| m.drc.clone()).or(drc);
        let loaded = crate::geometry_maps::assets(&manifest);
        let mut antenna = antenna;
        let mut lvs = lvs;
        if let Ok(assets) = &loaded {
            for (path, asset) in assets {
                match asset.metadata["kind"].as_str() {
                    Some("antenna") => antenna = Some(path.clone()),
                    Some("lvs") => lvs = Some(path.clone()),
                    _ => {}
                }
            }
        }
        let timing_directory = loaded
            .as_ref()
            .ok()
            .filter(|assets| assets.iter().any(|(_, a)| a.metadata["kind"] == "timing"))
            .and_then(|_| manifest.parent().map(Path::to_path_buf));
        let maps = (|| {
            loaded.map_err(|e| e.to_string())?;
            let categories =
                crate::geometry_maps::discover(&manifest).map_err(|e| e.to_string())?;
            if !categories.is_empty() {
                return Ok(MapCatalog {
                    categories,
                    warnings: Vec::new(),
                });
            }
            map_root
                .as_deref()
                .map(MapCatalog::discover)
                .unwrap_or_else(|| {
                    Ok(MapCatalog {
                        categories: Vec::new(),
                        warnings: Vec::new(),
                    })
                })
        })();
        let result = Analyses {
            drc: DrcOverlay::load(drc, drc_stats),
            antenna: AntennaOverlay::load(antenna, antenna_stats),
            lvs: lvs::LvsAnalysis::load(lvs),
            maps,
            timing_directory,
        };
        let _ = sender.send(result);
    });
    receiver
}

pub(super) fn drc(
    path: &Path,
) -> Result<(Vec<DrcViolation>, BTreeMap<String, DrcTypeCounts>), String> {
    if path.extension().is_none_or(|e| e != "gdisplay") {
        return fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|s| parse_drc_json_text(&s));
    }
    let read = || -> anyhow::Result<_> {
        let asset = DisplayAsset::open(path)?;
        anyhow::ensure!(asset.metadata["kind"] == "drc", "Wrong DRC display kind");
        let mut values = Vec::new();
        for i in 0..asset.count {
            let node: serde_json::Value = asset.record(i)?;
            let kind = node["type"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing DRC rule"))?;
            let layer = node["layer"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing DRC layer"))?;
            values.push(
                parse_drc_violation(&node, i, kind, layer)
                    .ok_or_else(|| anyhow::anyhow!("Invalid DRC record"))?,
            );
        }
        let counts = drc_counts_from_violations(&values);
        Ok((values, counts))
    };
    read().map_err(|e| e.to_string())
}

pub(super) fn antenna(
    path: &Path,
) -> Result<(Vec<AntennaViolation>, BTreeMap<String, AntennaTypeCounts>), String> {
    if path.extension().is_none_or(|e| e != "gdisplay") {
        return fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|s| parse_antenna_json_text(&s));
    }
    let read = || -> anyhow::Result<_> {
        let asset = DisplayAsset::open(path)?;
        anyhow::ensure!(
            asset.metadata["kind"] == "antenna",
            "Wrong Antenna display kind"
        );
        let mut values = Vec::new();
        for i in 0..asset.count {
            let node: serde_json::Value = asset.record(i)?;
            let mut item = node.clone();
            for (from, to) in [("lx", "llx"), ("ly", "lly"), ("hx", "urx"), ("hy", "ury")] {
                item[to] = node["location"][from].clone();
            }
            item["net"] = serde_json::json!([node["net"]]);
            item["inst"] = serde_json::json!([node["instance"]]);
            values.push(
                parse_antenna_violation(
                    &item,
                    i,
                    node["type"].as_str().unwrap_or("unknown"),
                    node["layer"].as_str().unwrap_or("unknown"),
                )
                .ok_or_else(|| anyhow::anyhow!("Invalid Antenna record"))?,
            );
        }
        let counts = antenna_counts_from_violations(&values);
        Ok((values, counts))
    };
    read().map_err(|e| e.to_string())
}

impl LoadedViewer {
    pub(super) fn refresh_display_data(&mut self) {
        self.display_loading = Some(prepare(
            self.db.snapshot().manifest().path.clone(),
            self.display_inputs.clone(),
        ));
        self.map_loading = None;
        self.active_heatmap = None;
        self.map_catalog = None;
        self.map_catalog_error = None;
        self.drc_overlay = None;
        self.antenna_overlay = None;
        self.lvs_analysis = None;
        self.refresh_timing();
    }

    pub(super) fn poll_display(&mut self, ctx: &egui::Context) {
        if let Some(receiver) = &self.display_loading {
            match receiver.try_recv() {
                Ok(data) => {
                    self.display_loading = None;
                    if self.timing.is_none() && self.timing_loading.is_none() {
                        self.attach_timing_feature_dir(data.timing_directory);
                    }
                    self.drc_overlay = data.drc;
                    self.antenna_overlay = data.antenna;
                    self.lvs_analysis = data.lvs;
                    match data.maps {
                        Ok(catalog) => self.map_catalog = Some(catalog),
                        Err(e) => self.map_catalog_error = Some(e),
                    }
                    self.analysis_tab = if self.drc_overlay.is_some() {
                        AnalysisTab::Drc
                    } else if self.lvs_analysis.is_some() {
                        AnalysisTab::Lvs
                    } else if self.antenna_overlay.is_some() {
                        AnalysisTab::Antenna
                    } else if self.map_catalog.as_ref().is_some_and(|c| !c.is_empty()) {
                        AnalysisTab::Map
                    } else {
                        self.analysis_tab
                    };
                    if let Some(catalog) = &self.map_catalog {
                        if let Some(category) = catalog.categories.first() {
                            self.expanded_map_categories.insert(category.id.clone());
                        }
                        let default = catalog.default_power_item().or_else(|| {
                            catalog
                                .categories
                                .iter()
                                .flat_map(|c| &c.items)
                                .find(|i| {
                                    i.label.contains("All layers") || i.label == "total power [W]"
                                })
                                .map(|i| (i.clone(), None))
                        });
                        if let Some((item, layout)) = default {
                            self.activate_map_item(&item, layout.as_deref());
                        }
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.display_loading = None;
                    self.map_catalog_error = Some("Analysis loader stopped".into());
                }
                Err(mpsc::TryRecvError::Empty) => {
                    ctx.request_repaint_after(Duration::from_millis(30))
                }
            }
        }
        if let Some(receiver) = &self.map_loading {
            match receiver.try_recv() {
                Ok(result) => {
                    self.map_loading = None;
                    match result {
                        Ok(map) => self.active_heatmap = Some(map),
                        Err(e) => self.map_item_error = Some(e),
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.map_loading = None;
                    self.map_item_error = Some("Map loader stopped".into());
                }
                Err(mpsc::TryRecvError::Empty) => {
                    ctx.request_repaint_after(Duration::from_millis(30))
                }
            }
        }
    }
}

// A single decoder bounds memory during rapid map switching. Each request owns
// its reply channel, so superseded results cannot overwrite the latest selection.
pub(super) type MapRequest = (
    MapItem,
    Option<PathBuf>,
    mpsc::Sender<Result<ActiveHeatmap, String>>,
);

pub(super) fn map_worker() -> mpsc::Sender<MapRequest> {
    let (sender, requests) = mpsc::channel::<MapRequest>();
    thread::spawn(move || {
        while let Ok(mut request) = requests.recv() {
            while let Ok(newer) = requests.try_recv() {
                request = newer;
            }
            let (item, layout, reply) = request;
            let result = item
                .source
                .load(layout.as_deref())
                .map(|data| ActiveHeatmap::new(item.label, data));
            let _ = reply.send(result);
        }
    });
    sender
}
