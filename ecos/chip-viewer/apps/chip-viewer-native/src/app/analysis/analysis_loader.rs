use super::*;

#[derive(Clone, Default)]
pub(super) struct AnalysisPaths {
    pub(super) manifest: Option<PathBuf>,
    pub(super) drc_data: Option<PathBuf>,
    pub(super) drc_stats: Option<PathBuf>,
    pub(super) antenna_data: Option<PathBuf>,
    pub(super) antenna_stats: Option<PathBuf>,
    pub(super) lvs_data: Option<PathBuf>,
    pub(super) map_root: Option<PathBuf>,
}

impl AnalysisPaths {
    pub(super) fn start_for(&self, db: &ChipViewDb) -> (Option<AnalysisLoader>, Option<String>) {
        let mut paths = self.clone();
        let manifest = db.snapshot().manifest();
        paths.manifest = (!manifest.display.is_empty()).then(|| manifest.path.clone());
        paths.drc_data = manifest.drc.clone().or(paths.drc_data);
        match AnalysisLoader::start(paths) {
            Ok(loader) => (loader, None),
            Err(error) => (None, Some(format!("Failed to start analysis data loader: {error}"))),
        }
    }
}

struct AnalysisData {
    drc_overlay: Option<DrcOverlay>,
    antenna_overlay: Option<AntennaOverlay>,
    lvs_analysis: Option<lvs::LvsAnalysis>,
    map_catalog: Option<MapCatalog>,
    map_catalog_error: Option<String>,
    timing_directory: Option<PathBuf>,
}

impl AnalysisData {
    fn load(mut paths: AnalysisPaths) -> Self {
        let mut timing_directory = None;
        let maps = paths.manifest.as_deref().map(crate::geometry_maps::assets).transpose();
        let mut native_maps = Vec::new();
        let mut native_error = None;
        match maps {
            Ok(Some(assets)) => {
                for (path, asset) in &assets {
                    match asset.metadata["kind"].as_str() {
                        Some("antenna") => paths.antenna_data = Some(path.clone()),
                        Some("lvs") => paths.lvs_data = Some(path.clone()),
                        Some("timing") => {
                            timing_directory = paths.manifest.as_deref().and_then(Path::parent).map(Path::to_path_buf);
                        }
                        _ => {}
                    }
                }
                native_maps = crate::geometry_maps::categories(&assets);
            }
            Ok(None) => {}
            Err(error) => native_error = Some(error.to_string()),
        }
        let (map_catalog, map_catalog_error) = if !native_maps.is_empty() {
            (Some(MapCatalog { categories: native_maps, warnings: Vec::new() }), None)
        } else if let Some(root) = paths.map_root.as_deref() {
            match MapCatalog::discover(root) {
                Ok(catalog) if !catalog.is_empty() => (Some(catalog), native_error),
                Ok(catalog) if !catalog.warnings.is_empty() => (None, Some(catalog.warnings.join("; "))),
                Ok(_) => (None, native_error),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, native_error)
        };
        Self {
            drc_overlay: DrcOverlay::load(paths.drc_data, paths.drc_stats),
            antenna_overlay: AntennaOverlay::load(paths.antenna_data, paths.antenna_stats),
            lvs_analysis: lvs::LvsAnalysis::load(paths.lvs_data),
            map_catalog,
            map_catalog_error,
            timing_directory,
        }
    }
}

pub(super) struct AnalysisLoader {
    receiver: Receiver<AnalysisData>,
}

impl AnalysisLoader {
    pub(super) fn start(paths: AnalysisPaths) -> std::io::Result<Option<Self>> {
        if [
            &paths.manifest,
            &paths.drc_data,
            &paths.drc_stats,
            &paths.antenna_data,
            &paths.antenna_stats,
            &paths.lvs_data,
            &paths.map_root,
        ]
        .into_iter()
        .all(Option::is_none)
        {
            return Ok(None);
        }
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("chip-viewer-analysis".into())
            .spawn(move || {
                let _ = sender.send(AnalysisData::load(paths));
            })?;
        Ok(Some(Self { receiver }))
    }
}

impl LoadedViewer {
    pub(super) fn refresh_display_data(&mut self) {
        (self.analysis_loader, self.analysis_load_error) = self.analysis_paths.start_for(&self.db);
        self.map_loading = None;
        self.active_heatmap = None;
        self.map_catalog = None;
        self.map_catalog_error = None;
        self.drc_overlay = None;
        self.antenna_overlay = None;
        self.lvs_analysis = None;
        self.refresh_timing();
    }

    pub(super) fn poll_analysis(&mut self, ctx: &egui::Context) {
        let Some(loader) = &self.analysis_loader else {
            return;
        };
        let analysis = match loader.receiver.try_recv() {
            Ok(analysis) => analysis,
            Err(mpsc::TryRecvError::Empty) => {
                ctx.request_repaint_after(Duration::from_millis(25));
                return;
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                self.analysis_loader = None;
                self.analysis_load_error =
                    Some("Analysis data loader stopped before returning results".into());
                return;
            }
        };
        self.analysis_loader = None;
        if self.timing.is_none() && self.timing_loading.is_none() {
            self.attach_timing_feature_dir(analysis.timing_directory);
        }
        self.drc_overlay = analysis.drc_overlay;
        self.antenna_overlay = analysis.antenna_overlay;
        self.lvs_analysis = analysis.lvs_analysis;
        self.map_catalog = analysis.map_catalog;
        self.map_catalog_error = analysis.map_catalog_error;
        self.expanded_map_categories = self
            .map_catalog
            .as_ref()
            .and_then(|catalog| catalog.categories.first())
            .map(|category| BTreeSet::from([category.id.clone()]))
            .unwrap_or_default();
        if !self.analysis_tab_user_selected && self.analysis_tab != AnalysisTab::Timing {
            self.analysis_tab = self.default_analysis_tab();
        }
        let default_map = self.map_catalog.as_ref().and_then(|catalog| {
            catalog.default_power_item().or_else(|| {
                catalog.categories.iter().flat_map(|category| &category.items)
                    .find(|item| item.label.contains("All layers") || item.label == "total power [W]")
                    .map(|item| (item.clone(), None))
            })
        });
        if let Some((item, layout)) = default_map {
            self.activate_map_item(&item, layout.as_deref());
        }
    }

    pub(super) fn default_analysis_tab(&self) -> AnalysisTab {
        if self.drc_overlay.is_some() {
            AnalysisTab::Drc
        } else if self.lvs_analysis.is_some() {
            AnalysisTab::Lvs
        } else if self.antenna_overlay.is_some() {
            AnalysisTab::Antenna
        } else if self.map_catalog.is_none() && self.clock_tree.is_some() {
            AnalysisTab::ClockTree
        } else {
            AnalysisTab::Map
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn analysis_report_is_parsed_and_delivered_through_background_channel() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "chip-viewer-analysis-loader-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("create analysis loader fixture directory");
        let drc_path = directory.join("drc.json");
        fs::write(&drc_path, r#"{"drc":{"number":0,"distribution":{}}}"#)
            .expect("write DRC report fixture");
        let loader = AnalysisLoader::start(AnalysisPaths {
            drc_data: Some(drc_path),
            ..AnalysisPaths::default()
        })
        .expect("start analysis worker")
        .expect("DRC path requires a worker");
        let analysis = loader
            .receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("receive analysis data");

        assert!(analysis
            .drc_overlay
            .as_ref()
            .is_some_and(|overlay| overlay.load_error.is_none() && overlay.total_count() == 0));
        assert!(analysis.antenna_overlay.is_none());
        assert!(analysis.lvs_analysis.is_none());
        assert!(analysis.map_catalog.is_none());
        assert!(analysis.map_catalog_error.is_none());
        fs::remove_dir_all(directory).expect("remove analysis loader fixture directory");
    }
}
