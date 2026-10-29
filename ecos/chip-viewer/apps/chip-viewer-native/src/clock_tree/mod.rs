mod graph;
mod panel;

use std::collections::{HashMap, HashSet};
use std::sync::{mpsc, Arc};

use chip_view_db::clock_tree::{ClockNode, ClockTreeView};
use chip_view_db::ChipViewDb;
use chipgeom_format::{ClockTreeAnalysisSource, ClockTreeStage, ClockTreeStatus};

pub(crate) enum LayoutTarget {
    Node(ClockNode),
    Net(String),
}

struct ClockData {
    view: ClockTreeView,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LayoutMatch {
    clock: usize,
    node: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum TreeAxis {
    #[default]
    Level,
    Delay,
}

#[derive(Clone, Debug)]
struct TreeRow {
    node: usize,
    depth: usize,
    parent: Option<usize>,
    reference: bool,
}

pub(crate) struct ClockTreePanel {
    db: Arc<ChipViewDb>,
    receiver: Option<mpsc::Receiver<Result<ClockData, String>>>,
    data: Option<Arc<ClockData>>,
    error: Option<String>,
    started: bool,
    clock: usize,
    selected: Option<usize>,
    expanded: HashSet<usize>,
    search: String,
    only_issues: bool,
    rows: Vec<TreeRow>,
    rows_dirty: bool,
    truncated: bool,
    focus_selected: bool,
    delay_bounds: (f64, f64),
    axis: TreeAxis,
    zoom: f32,
    pan: egui::Vec2,
    open: bool,
    pub(crate) last_layout_selection: Option<u64>,
    pending_layout_matches: Vec<LayoutMatch>,
    pending_layout_choice: usize,
    layout_sync_status: Option<String>,
    location_status: Option<String>,
}

impl ClockTreePanel {
    pub(crate) fn new(db: Arc<ChipViewDb>) -> Option<Self> {
        db.has_clock_tree_manifest().then(|| Self {
            db,
            receiver: None,
            data: None,
            error: None,
            started: false,
            clock: 0,
            selected: None,
            expanded: HashSet::new(),
            search: String::new(),
            only_issues: false,
            rows: Vec::new(),
            rows_dirty: true,
            truncated: false,
            focus_selected: false,
            delay_bounds: (0.0, 1.0),
            axis: TreeAxis::Level,
            zoom: 1.0,
            pan: egui::Vec2::ZERO,
            open: false,
            last_layout_selection: None,
            pending_layout_matches: Vec::new(),
            pending_layout_choice: 0,
            layout_sync_status: None,
            location_status: None,
        })
    }

    pub(crate) fn is_open(&self) -> bool {
        self.open
    }

    fn poll(&mut self, ctx: &egui::Context) {
        if !self.started {
            let db = Arc::clone(&self.db);
            let (sender, receiver) = mpsc::channel();
            self.receiver = Some(receiver);
            self.started = true;
            let wake = ctx.clone();
            std::thread::spawn(move || {
                let result = (|| -> anyhow::Result<ClockData> {
                    let snapshot = db
                        .clock_tree()?
                        .ok_or_else(|| anyhow::anyhow!("clock-tree extension is missing"))?;
                    Ok(ClockData {
                        view: ClockTreeView::build(snapshot)?,
                    })
                })()
                .map_err(|error| format!("{error:#}"));
                let _ = sender.send(result);
                wake.request_repaint();
            });
        }
        if let Some(receiver) = &self.receiver {
            match receiver.try_recv() {
                Ok(Ok(data)) => {
                    self.data = Some(Arc::new(data));
                    self.receiver = None;
                    self.reset_clock();
                }
                Ok(Err(error)) => {
                    self.error = Some(error);
                    self.receiver = None;
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.error = Some("clock-tree loader stopped".to_string());
                    self.receiver = None;
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
    }

    fn reset_clock(&mut self) {
        self.selected = None;
        self.expanded.clear();
        if let Some(index) = self
            .data
            .as_ref()
            .and_then(|data| data.view.clocks.get(self.clock))
        {
            self.expanded.extend(index.roots.iter().copied());
        }
        self.rows_dirty = true;
        self.zoom = 1.0;
        self.pan = egui::Vec2::ZERO;
    }

    fn select(&mut self, node: usize) {
        let Some(index) = self
            .data
            .as_ref()
            .and_then(|data| data.view.clocks.get(self.clock))
        else {
            return;
        };
        self.selected = Some(node);
        self.focus_selected = true;
        self.expanded.extend(index.path_to(node));
        self.rows_dirty = true;
    }

    pub(crate) fn select_layout_names(&mut self, names: &[String]) {
        let Some(data) = self.data.clone() else {
            return;
        };
        let matches = layout_matches(&data.view.clocks, names);
        self.pending_layout_matches.clear();
        self.pending_layout_choice = 0;
        match matches.as_slice() {
            [] => {
                self.layout_sync_status =
                    Some("No clock-tree node matches the layout selection.".to_string());
            }
            [matched] => self.apply_layout_match(*matched),
            _ => {
                self.layout_sync_status = Some(format!(
                    "The layout selection maps to {} clock-tree nodes. Choose one to synchronize.",
                    matches.len()
                ));
                self.pending_layout_matches = matches;
            }
        }
    }

    fn apply_layout_match(&mut self, matched: LayoutMatch) {
        let label = self.data.as_ref().and_then(|data| {
            let clock = data.view.clocks.get(matched.clock)?;
            let node = clock.nodes.get(matched.node)?;
            Some(format!("{} · {}", clock.info.name, node.name))
        });
        let Some(label) = label else {
            return;
        };
        if self.clock != matched.clock {
            self.clock = matched.clock;
            self.reset_clock();
        }
        self.select(matched.node);
        self.search.clear();
        self.only_issues = false;
        self.pending_layout_matches.clear();
        self.pending_layout_choice = 0;
        self.layout_sync_status = Some(format!("Selected {label} from the layout selection."));
    }

    pub(crate) fn set_location_status(&mut self, status: Option<String>) {
        self.location_status = status;
    }

    pub(crate) fn sync_layout_selection(&mut self, selection: Option<u64>, names: &[String]) {
        if self.data.is_none() || self.last_layout_selection == selection {
            return;
        }
        self.last_layout_selection = selection;
        if selection.is_some() {
            self.select_layout_names(names);
        }
    }
}

fn layout_candidates_for_clock(
    by_name: &HashMap<String, Vec<usize>>,
    by_instance: &HashMap<String, Vec<usize>>,
    by_net: &HashMap<String, Vec<usize>>,
    names: &[String],
) -> Vec<usize> {
    let mut found = Vec::new();
    for name in names {
        for lookup in [by_name, by_instance, by_net] {
            if let Some(nodes) = lookup.get(name) {
                found.extend(nodes.iter().copied());
            }
        }
    }
    found.sort_unstable();
    found.dedup();
    found
}

fn layout_matches_from_candidates(
    per_clock: impl IntoIterator<Item = (usize, Vec<usize>)>,
) -> Vec<LayoutMatch> {
    let mut matches = Vec::new();
    for (clock, nodes) in per_clock {
        for node in nodes {
            let matched = LayoutMatch { clock, node };
            if !matches.contains(&matched) {
                matches.push(matched);
            }
        }
    }
    matches.sort_unstable_by_key(|matched| (matched.clock, matched.node));
    matches
}

fn layout_matches(
    clocks: &[chip_view_db::clock_tree::ClockGraphIndex],
    names: &[String],
) -> Vec<LayoutMatch> {
    layout_matches_from_candidates(clocks.iter().enumerate().map(|(clock, index)| {
        let nodes =
            layout_candidates_for_clock(&index.by_name, &index.by_instance, &index.by_net, names);
        (clock, nodes)
    }))
}

fn measurement(value: Option<f64>, unit: &str) -> String {
    value.map_or_else(
        || "unavailable".to_string(),
        |value| {
            if unit.is_empty() {
                format!("{value:.4}")
            } else {
                format!("{value:.4} {unit}")
            }
        },
    )
}

fn stage_label(stage: Option<ClockTreeStage>) -> &'static str {
    match stage {
        Some(ClockTreeStage::PostFloorplan) => "postFloorplan",
        Some(ClockTreeStage::Cts) => "CTS",
        Some(ClockTreeStage::Filler) => "filler",
        _ => "unknown",
    }
}

fn status_label(status: Option<ClockTreeStatus>) -> &'static str {
    match status {
        Some(ClockTreeStatus::Unavailable) => "unavailable",
        Some(ClockTreeStatus::NoClocks) => "no clocks",
        Some(ClockTreeStatus::TopologyOnly) => "topology only",
        Some(ClockTreeStatus::PartialTiming) => "partial timing",
        Some(ClockTreeStatus::CompleteTiming) => "complete timing",
        None => "unknown",
    }
}

fn analysis_label(source: Option<ClockTreeAnalysisSource>) -> &'static str {
    match source {
        Some(ClockTreeAnalysisSource::CtsFastSta) => "CTS FastSTA",
        Some(ClockTreeAnalysisSource::IstaTypical) => "iSTA TYPICAL",
        _ => "none",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(entries: &[(&str, &[usize])]) -> HashMap<String, Vec<usize>> {
        entries
            .iter()
            .map(|(name, nodes)| ((*name).to_string(), nodes.to_vec()))
            .collect()
    }

    #[test]
    fn layout_candidates_merge_name_instance_and_net_without_duplicates() {
        let by_name = lookup(&[("u1/CK", &[3])]);
        let by_instance = lookup(&[("u1", &[3, 4])]);
        let by_net = lookup(&[("clk", &[0, 3])]);
        let names = vec!["u1/CK".to_string(), "u1".to_string(), "clk".to_string()];

        assert_eq!(
            layout_candidates_for_clock(&by_name, &by_instance, &by_net, &names),
            vec![0, 3, 4]
        );
    }

    #[test]
    fn layout_matches_keep_every_clock_in_stable_order() {
        let matches =
            layout_matches_from_candidates(vec![(1, vec![2, 2]), (0, vec![5]), (1, vec![1])]);

        assert_eq!(
            matches,
            vec![
                LayoutMatch { clock: 0, node: 5 },
                LayoutMatch { clock: 1, node: 1 },
                LayoutMatch { clock: 1, node: 2 },
            ]
        );
    }

    #[test]
    fn layout_candidates_return_empty_without_a_match() {
        let empty = HashMap::new();
        assert!(
            layout_candidates_for_clock(&empty, &empty, &empty, &["missing".to_string()])
                .is_empty()
        );
    }
}
