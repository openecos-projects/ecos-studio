use std::collections::{HashMap, VecDeque};

use anyhow::{ensure, Result};
use chipgeom_format::{
    ClockEdgeKind, ClockEdgeTransition, ClockNodeKind, ClockNodeRecord, ClockTimingRecord,
    ClockTreeAnalysisSource, ClockTreeMetaRecord, ClockTreeStage, ClockTreeStatus,
    CLOCK_NODE_OWNER_VALID, CLOCK_NODE_POSITION_VALID, CLOCK_NODE_ROOT, CLOCK_NODE_SINK,
    CLOCK_TIMING_ARRIVAL_VALID, CLOCK_TIMING_PREDECESSOR_VALID, CLOCK_TIMING_SLEW_VALID,
};
use chipgeom_reader::ClockTreeSnapshot;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClockSubtreeStats {
    pub sink_count: usize,
    pub valid_sink_count: usize,
    pub earliest: Option<(f64, usize)>,
    pub latest: Option<(f64, usize)>,
    pub min_buffers: usize,
    pub max_buffers: usize,
    pub issue_count: usize,
    pub exact: bool,
}

impl ClockSubtreeStats {
    pub fn skew_ns(&self) -> Option<f64> {
        if !self.exact || self.valid_sink_count < 2 {
            return None;
        }
        Some(self.latest?.0 - self.earliest?.0)
    }

    fn merge(&mut self, child: &Self) {
        if child.sink_count > 0 {
            if self.sink_count == 0 {
                self.min_buffers = child.min_buffers;
            } else {
                self.min_buffers = self.min_buffers.min(child.min_buffers);
            }
            self.max_buffers = self.max_buffers.max(child.max_buffers);
        }
        self.sink_count += child.sink_count;
        self.valid_sink_count += child.valid_sink_count;
        self.issue_count += child.issue_count;
        if let Some(earliest) = child.earliest {
            if self.earliest.is_none_or(|current| earliest.0 < current.0) {
                self.earliest = Some(earliest);
            }
        }
        if let Some(latest) = child.latest {
            if self.latest.is_none_or(|current| latest.0 > current.0) {
                self.latest = Some(latest);
            }
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClockTimingState {
    pub source_edge: ClockEdgeTransition,
    pub local_edge: ClockEdgeTransition,
    pub arrival_ns: Option<f64>,
    pub slew_ns: Option<f64>,
    pub predecessor: Option<usize>,
    pub scenario: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClockNode {
    pub id: u32,
    pub index: usize,
    pub name: String,
    pub instance_name: String,
    pub pin_name: String,
    pub master: String,
    pub kind: ClockNodeKind,
    pub x_dbu: i32,
    pub y_dbu: i32,
    pub position_valid: bool,
    pub owner_index: Option<u32>,
    pub root: bool,
    pub sink: bool,
    pub arrival_ns: Option<f64>,
    pub slew_ns: Option<f64>,
    pub timing_states: Vec<ClockTimingState>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClockEdge {
    pub from: usize,
    pub to: usize,
    pub kind: ClockEdgeKind,
    pub polarity: ClockEdgeTransition,
    pub net_name: String,
    pub cell_name: String,
    pub object_ref: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClockInfo {
    pub name: String,
    pub master_clock_id: Option<u32>,
    pub source_edge: ClockEdgeTransition,
}

#[derive(Clone, Debug)]
pub struct ClockGraphIndex {
    pub info: ClockInfo,
    pub nodes: Vec<ClockNode>,
    pub edges: Vec<ClockEdge>,
    pub children: Vec<Vec<usize>>,
    pub parents: Vec<Vec<usize>>,
    pub roots: Vec<usize>,
    pub depth: Vec<usize>,
    pub stats: Vec<ClockSubtreeStats>,
    pub summary: ClockSubtreeStats,
    pub issues: Vec<Vec<String>>,
    pub diagnostics: Vec<String>,
    pub by_name: HashMap<String, Vec<usize>>,
    pub by_instance: HashMap<String, Vec<usize>>,
    pub by_net: HashMap<String, Vec<usize>>,
    pub edges_for_node: Vec<Vec<usize>>,
    pub edge_by_pair: HashMap<(usize, usize), usize>,
}

impl ClockGraphIndex {
    pub fn build(snapshot: &ClockTreeSnapshot, clock_index: usize) -> Result<Self> {
        let timing_by_node = timing_index(snapshot);
        Self::build_with_timing(snapshot, clock_index, &timing_by_node)
    }

    fn build_with_timing(
        snapshot: &ClockTreeSnapshot,
        clock_index: usize,
        timing_by_node: &HashMap<u32, Vec<usize>>,
    ) -> Result<Self> {
        let clock = snapshot
            .clocks
            .get(clock_index)
            .ok_or_else(|| anyhow::anyhow!("clock index is out of bounds"))?;
        let node_start = clock.node_first as usize;
        let node_end = node_start
            .checked_add(clock.node_count as usize)
            .ok_or_else(|| anyhow::anyhow!("clock node range overflow"))?;
        ensure!(
            node_end <= snapshot.nodes.len(),
            "clock node range is out of bounds"
        );
        let edge_start = clock.edge_first as usize;
        let edge_end = edge_start
            .checked_add(clock.edge_count as usize)
            .ok_or_else(|| anyhow::anyhow!("clock edge range overflow"))?;
        ensure!(
            edge_end <= snapshot.edges.len(),
            "clock edge range is out of bounds"
        );

        let mut by_global = HashMap::with_capacity(clock.node_count as usize);
        for (index, record) in snapshot.nodes[node_start..node_end].iter().enumerate() {
            by_global.insert(record.node_id, index);
        }
        let mut nodes = Vec::with_capacity(clock.node_count as usize);
        for (index, record) in snapshot.nodes[node_start..node_end].iter().enumerate() {
            let node = node_from_record(snapshot, record, index, timing_by_node, &by_global)?;
            nodes.push(node);
        }

        let mut edges = Vec::with_capacity(clock.edge_count as usize);
        for record in &snapshot.edges[edge_start..edge_end] {
            let from = *by_global
                .get(&record.from_node)
                .ok_or_else(|| anyhow::anyhow!("dangling clock edge source"))?;
            let to = *by_global
                .get(&record.to_node)
                .ok_or_else(|| anyhow::anyhow!("dangling clock edge sink"))?;
            edges.push(ClockEdge {
                from,
                to,
                kind: ClockEdgeKind::from_raw(record.kind)
                    .ok_or_else(|| anyhow::anyhow!("invalid clock edge kind"))?,
                polarity: ClockEdgeTransition::from_raw(record.polarity)
                    .ok_or_else(|| anyhow::anyhow!("invalid clock edge polarity"))?,
                net_name: snapshot
                    .string(record.net_offset, record.net_size)
                    .unwrap_or_default()
                    .to_string(),
                cell_name: snapshot
                    .string(record.cell_offset, record.cell_size)
                    .unwrap_or_default()
                    .to_string(),
                object_ref: record.object_ref,
            });
        }

        let mut roots = Vec::new();
        let root_start = clock.root_node_first as usize;
        let root_end = root_start
            .checked_add(clock.root_node_count as usize)
            .ok_or_else(|| anyhow::anyhow!("clock root range overflow"))?;
        ensure!(
            root_end <= snapshot.roots.len(),
            "clock root range is out of bounds"
        );
        for global_id in &snapshot.roots[root_start..root_end] {
            let index = *by_global
                .get(global_id)
                .ok_or_else(|| anyhow::anyhow!("clock root references another clock's node"))?;
            roots.push(index);
        }
        for (index, node) in nodes.iter().enumerate() {
            if node.root && !roots.contains(&index) {
                roots.push(index);
            }
        }
        roots.sort_unstable();
        roots.dedup();

        let mut children = vec![Vec::new(); nodes.len()];
        let mut parents = vec![Vec::new(); nodes.len()];
        let mut edges_for_node = vec![Vec::new(); nodes.len()];
        let mut by_net: HashMap<String, Vec<usize>> = HashMap::new();
        let mut edge_by_pair = HashMap::new();
        for (edge_index, edge) in edges.iter().enumerate() {
            children[edge.from].push(edge.to);
            parents[edge.to].push(edge.from);
            edges_for_node[edge.from].push(edge_index);
            edges_for_node[edge.to].push(edge_index);
            edge_by_pair
                .entry((edge.from, edge.to))
                .or_insert(edge_index);
            if !edge.net_name.is_empty() {
                by_net
                    .entry(edge.net_name.clone())
                    .or_default()
                    .extend([edge.from, edge.to]);
            }
        }
        for entries in children
            .iter_mut()
            .chain(parents.iter_mut())
            .chain(by_net.values_mut())
        {
            entries.sort_unstable();
            entries.dedup();
        }

        let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_instance: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, node) in nodes.iter().enumerate() {
            by_name.entry(node.name.clone()).or_default().push(index);
            if !node.instance_name.is_empty() {
                by_instance
                    .entry(node.instance_name.clone())
                    .or_default()
                    .push(index);
            }
        }

        let (depth, order, cyclic) = topological_order(&children, &parents);
        let mut diagnostics = Vec::new();
        if cyclic {
            diagnostics.push(
                "Clock graph contains a cycle; subtree aggregates are unavailable".to_string(),
            );
        }
        let shared = parents.iter().any(|parents| parents.len() > 1);
        let mut issues = vec![Vec::new(); nodes.len()];
        let mut stats = vec![ClockSubtreeStats::default(); nodes.len()];
        let mut summary = ClockSubtreeStats {
            exact: true,
            ..Default::default()
        };
        for (index, node) in nodes.iter().enumerate() {
            if node.sink && node.arrival_ns.is_none() {
                issues[index].push("Insertion timing unavailable".to_string());
            }
            let valid = node.sink && node.arrival_ns.is_some();
            stats[index] = ClockSubtreeStats {
                sink_count: usize::from(node.sink),
                valid_sink_count: usize::from(valid),
                earliest: node
                    .arrival_ns
                    .filter(|_| valid)
                    .map(|value| (value, index)),
                latest: node
                    .arrival_ns
                    .filter(|_| valid)
                    .map(|value| (value, index)),
                issue_count: issues[index].len(),
                exact: !cyclic && !shared,
                ..Default::default()
            };
            summary.merge(&stats[index]);
        }
        if !cyclic && !shared {
            for &index in order.iter().rev() {
                for &child in &children[index] {
                    let child_stats = stats[child].clone();
                    stats[index].merge(&child_stats);
                }
                if nodes[index].kind == ClockNodeKind::BufferOutput && stats[index].sink_count > 0 {
                    stats[index].min_buffers += 1;
                    stats[index].max_buffers += 1;
                }
            }
            summary.min_buffers = roots
                .iter()
                .filter(|&&root| stats[root].sink_count > 0)
                .map(|&root| stats[root].min_buffers)
                .min()
                .unwrap_or(0);
            summary.max_buffers = roots
                .iter()
                .map(|&root| stats[root].max_buffers)
                .max()
                .unwrap_or(0);
        }
        for (index, entries) in by_name.iter_mut().chain(by_instance.iter_mut()) {
            let _ = index;
            entries.sort_unstable();
            entries.dedup();
        }

        Ok(Self {
            info: ClockInfo {
                name: snapshot
                    .string(clock.name_offset, clock.name_size)
                    .unwrap_or_default()
                    .to_string(),
                master_clock_id: (clock.master_clock_id != u32::MAX)
                    .then_some(clock.master_clock_id),
                source_edge: ClockEdgeTransition::from_raw(clock.source_edge)
                    .unwrap_or(ClockEdgeTransition::Rise),
            },
            nodes,
            edges,
            children,
            parents,
            roots,
            depth,
            stats,
            summary,
            issues,
            diagnostics,
            by_name,
            by_instance,
            by_net,
            edges_for_node,
            edge_by_pair,
        })
    }

    pub fn path_to(&self, target: usize) -> Vec<usize> {
        let mut path = Vec::new();
        let mut visited = vec![false; self.parents.len()];
        let mut current = Some(target);
        while let Some(index) = current {
            if visited[index] {
                break;
            }
            visited[index] = true;
            path.push(index);
            current = self.parents[index].first().copied();
        }
        path.reverse();
        path
    }
}

#[derive(Clone, Debug)]
pub struct ClockTreeView {
    pub meta: ClockTreeMetaRecord,
    pub clocks: Vec<ClockGraphIndex>,
    pub stage: Option<ClockTreeStage>,
    pub status: Option<ClockTreeStatus>,
    pub analysis_source: Option<ClockTreeAnalysisSource>,
    pub rc_corner: String,
    pub liberty_corner: String,
    pub diagnostics: String,
}

impl ClockTreeView {
    pub fn build(snapshot: &ClockTreeSnapshot) -> Result<Self> {
        let timing_by_node = timing_index(snapshot);
        let clocks = (0..snapshot.clocks.len())
            .map(|index| ClockGraphIndex::build_with_timing(snapshot, index, &timing_by_node))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            meta: snapshot.meta,
            clocks,
            stage: snapshot.stage(),
            status: snapshot.status(),
            analysis_source: snapshot.analysis_source(),
            rc_corner: snapshot
                .string(snapshot.meta.rc_corner_offset, snapshot.meta.rc_corner_size)
                .unwrap_or_default()
                .to_string(),
            liberty_corner: snapshot
                .string(
                    snapshot.meta.liberty_corner_offset,
                    snapshot.meta.liberty_corner_size,
                )
                .unwrap_or_default()
                .to_string(),
            diagnostics: snapshot
                .string(
                    snapshot.meta.diagnostics_offset,
                    snapshot.meta.diagnostics_size,
                )
                .unwrap_or_default()
                .to_string(),
        })
    }
}

fn node_from_record(
    snapshot: &ClockTreeSnapshot,
    record: &ClockNodeRecord,
    index: usize,
    timing_by_node: &HashMap<u32, Vec<usize>>,
    by_global: &HashMap<u32, usize>,
) -> Result<ClockNode> {
    let instance_name = snapshot
        .string(record.instance_offset, record.instance_size)
        .unwrap_or_default()
        .to_string();
    let pin_name = snapshot
        .string(record.pin_offset, record.pin_size)
        .unwrap_or_default()
        .to_string();
    let master = snapshot
        .string(record.master_offset, record.master_size)
        .unwrap_or_default()
        .to_string();
    let name = if instance_name.is_empty() {
        pin_name.clone()
    } else if pin_name.is_empty() {
        instance_name.clone()
    } else {
        format!("{instance_name}/{pin_name}")
    };
    let timing_states = timing_by_node
        .get(&record.node_id)
        .into_iter()
        .flatten()
        .filter_map(|&timing_index| {
            timing_state(snapshot, &snapshot.timing[timing_index], by_global)
        })
        .collect::<Vec<_>>();
    let arrival_ns = timing_states
        .iter()
        .filter_map(|state| state.arrival_ns)
        .reduce(f64::max);
    let slew_ns = timing_states
        .iter()
        .filter_map(|state| state.slew_ns)
        .reduce(f64::max);
    Ok(ClockNode {
        id: record.node_id,
        index,
        name,
        instance_name,
        pin_name,
        master,
        kind: ClockNodeKind::from_raw(record.kind)
            .ok_or_else(|| anyhow::anyhow!("invalid clock node kind"))?,
        x_dbu: record.x,
        y_dbu: record.y,
        position_valid: record.flags & CLOCK_NODE_POSITION_VALID != 0,
        owner_index: (record.flags & CLOCK_NODE_OWNER_VALID != 0).then_some(record.owner_index),
        root: record.flags & CLOCK_NODE_ROOT != 0,
        sink: record.flags & CLOCK_NODE_SINK != 0 || record.kind == ClockNodeKind::Sink as u8,
        arrival_ns,
        slew_ns,
        timing_states,
    })
}

fn timing_state(
    snapshot: &ClockTreeSnapshot,
    timing: &ClockTimingRecord,
    by_global: &HashMap<u32, usize>,
) -> Option<ClockTimingState> {
    Some(ClockTimingState {
        source_edge: ClockEdgeTransition::from_raw(timing.source_edge)?,
        local_edge: ClockEdgeTransition::from_raw(timing.local_edge)?,
        arrival_ns: (timing.flags & CLOCK_TIMING_ARRIVAL_VALID != 0).then_some(timing.arrival_ns),
        slew_ns: (timing.flags & CLOCK_TIMING_SLEW_VALID != 0).then_some(timing.slew_ns),
        predecessor: (timing.flags & CLOCK_TIMING_PREDECESSOR_VALID != 0)
            .then(|| by_global.get(&timing.predecessor_node).copied())
            .flatten(),
        scenario: snapshot
            .string(timing.scenario_offset, timing.scenario_size)
            .unwrap_or_default()
            .to_string(),
    })
}

fn timing_index(snapshot: &ClockTreeSnapshot) -> HashMap<u32, Vec<usize>> {
    let mut by_node = HashMap::<u32, Vec<usize>>::with_capacity(snapshot.timing.len());
    for (index, timing) in snapshot.timing.iter().enumerate() {
        by_node.entry(timing.node_id).or_default().push(index);
    }
    by_node
}

fn topological_order(
    children: &[Vec<usize>],
    parents: &[Vec<usize>],
) -> (Vec<usize>, Vec<usize>, bool) {
    let mut remaining: Vec<usize> = parents.iter().map(Vec::len).collect();
    let mut ready: VecDeque<usize> = remaining
        .iter()
        .enumerate()
        .filter_map(|(index, count)| (*count == 0).then_some(index))
        .collect();
    let mut depth = vec![0usize; children.len()];
    let mut order = Vec::with_capacity(children.len());
    while let Some(index) = ready.pop_front() {
        order.push(index);
        for &child in &children[index] {
            depth[child] = depth[child].max(depth[index] + 1);
            remaining[child] -= 1;
            if remaining[child] == 0 {
                ready.push_back(child);
            }
        }
    }
    let cyclic = order.len() != children.len();
    (depth, order, cyclic)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chipgeom_format::{ClockEdgeRecord, ClockRecord};

    fn timed_clock_snapshot() -> ClockTreeSnapshot {
        ClockTreeSnapshot {
            clocks: vec![ClockRecord {
                clock_id: 0,
                master_clock_id: u32::MAX,
                root_node_first: 0,
                root_node_count: 1,
                node_first: 0,
                node_count: 2,
                edge_first: 0,
                edge_count: 1,
                source_edge: ClockEdgeTransition::Rise as u8,
                ..Default::default()
            }],
            nodes: vec![
                ClockNodeRecord {
                    node_id: 0,
                    clock_id: 0,
                    kind: ClockNodeKind::RootPort as u8,
                    flags: CLOCK_NODE_ROOT | CLOCK_NODE_POSITION_VALID,
                    ..Default::default()
                },
                ClockNodeRecord {
                    node_id: 1,
                    clock_id: 0,
                    kind: ClockNodeKind::Sink as u8,
                    flags: CLOCK_NODE_SINK | CLOCK_NODE_POSITION_VALID,
                    ..Default::default()
                },
            ],
            edges: vec![ClockEdgeRecord {
                edge_id: 0,
                from_node: 0,
                to_node: 1,
                kind: ClockEdgeKind::Net as u8,
                polarity: ClockEdgeTransition::Rise as u8,
                ..Default::default()
            }],
            timing: vec![
                ClockTimingRecord {
                    node_id: 0,
                    flags: CLOCK_TIMING_ARRIVAL_VALID,
                    source_edge: ClockEdgeTransition::Rise as u8,
                    local_edge: ClockEdgeTransition::Rise as u8,
                    ..Default::default()
                },
                ClockTimingRecord {
                    node_id: 1,
                    flags: CLOCK_TIMING_ARRIVAL_VALID | CLOCK_TIMING_PREDECESSOR_VALID,
                    source_edge: ClockEdgeTransition::Rise as u8,
                    local_edge: ClockEdgeTransition::Rise as u8,
                    predecessor_node: 0,
                    arrival_ns: 0.2,
                    ..Default::default()
                },
            ],
            roots: vec![0],
            ..Default::default()
        }
    }

    #[test]
    fn clock_graph_attaches_timing_and_maps_predecessor_to_local_index() {
        let snapshot = timed_clock_snapshot();
        let index = ClockGraphIndex::build(&snapshot, 0).expect("clock graph");

        assert_eq!(timing_index(&snapshot).get(&1), Some(&vec![1]));
        assert_eq!(index.nodes[1].arrival_ns, Some(0.2));
        assert_eq!(index.nodes[1].timing_states[0].predecessor, Some(0));
    }

    #[test]
    fn clock_subtree_skew_requires_complete_leaf_data() {
        let mut stats = ClockSubtreeStats {
            sink_count: 2,
            valid_sink_count: 2,
            earliest: Some((1.0, 0)),
            latest: Some((1.4, 1)),
            exact: true,
            ..Default::default()
        };
        let skew = stats.skew_ns().expect("finite timing should have a skew");
        assert!((skew - 0.4).abs() < 1e-12);
        stats.exact = false;
        assert_eq!(stats.skew_ns(), None);
    }
}
