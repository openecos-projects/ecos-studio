//! Load geometry analyses off the UI thread, including legacy text compatibility.
use super::analysis_overlays::{
    antenna_counts_from_violations, drc_counts_from_violations, parse_antenna_json_text,
    parse_antenna_violation, parse_drc_json_text, parse_drc_violation, AntennaTypeCounts,
    DrcTypeCounts,
};
use super::*;
use chipgeom_reader::display::DisplayAsset;

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
    pub(super) fn poll_map(&mut self, ctx: &egui::Context) {
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
