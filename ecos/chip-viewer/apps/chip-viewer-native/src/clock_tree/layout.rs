use std::collections::{HashSet, VecDeque};
use std::ops::Range;

use chip_view_db::clock_tree::ClockGraphIndex;

pub(super) const NODE_WIDTH: f32 = 160.0;
pub(super) const NODE_HEIGHT: f32 = 34.0;
pub(super) const LEVEL_SPACING: f32 = 80.0;
pub(super) const LEAF_WIDTH: f32 = 12.0;
pub(super) const LEAF_HEIGHT: f32 = 12.0;
pub(super) const LEAF_ROW_SPACING: f32 = 16.0;

const LEAF_COLUMN_SPACING: f32 = 12.0;
const LEAF_FAN_MAX_WIDTH: f32 = 180.0;
const LEAF_FAN_MIN_SPACING: f32 = 0.01;
const DELAY_NS_HEIGHT: f32 = 2_400.0;
const MIN_DELAY_AXIS_HEIGHT: f32 = 360.0;
const MAX_LEAF_FAN_COLUMNS: usize = 32;
const LEAF_FAN_THRESHOLD: usize = 8;
const SUBTREE_GAP: f32 = 12.0;
const ROOT_GAP: f32 = 40.0;

#[derive(Clone, Debug)]
pub(super) struct TreeRow {
    pub(super) node: usize,
    pub(super) depth: usize,
    pub(super) parent: Option<usize>,
    pub(super) reference: bool,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) leaf_fan: bool,
    pub(super) fan_spacing: f32,
    pub(super) delay_positioned: bool,
}

#[derive(Clone, Debug)]
pub(super) struct YBand {
    pub(super) y: f64,
    pub(super) rows: Range<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TreeAxisKind {
    Level,
    DelayNs,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct TreeAxis {
    pub(super) kind: TreeAxisKind,
    pub(super) minimum: f64,
    pub(super) maximum: f64,
    pub(super) top_y: f64,
    pub(super) bottom_y: f64,
}

pub(super) struct TreeLayout {
    pub(super) rows: Vec<TreeRow>,
    pub(super) render_rows: Vec<usize>,
    pub(super) y_bands: Vec<YBand>,
    pub(super) axis: Option<TreeAxis>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TreeLayoutMode {
    UnitDelay,
    RealDelay,
}

fn compact_fan_spacing(columns: usize) -> f32 {
    ((LEAF_FAN_MAX_WIDTH / columns.saturating_sub(1).max(1) as f32).min(LEAF_COLUMN_SPACING))
        .max(LEAF_FAN_MIN_SPACING)
}

fn is_terminal_leaf(index: &ClockGraphIndex, node: usize) -> bool {
    let node = &index.nodes[node];
    node.sink || node.kind == chipgeom_format::ClockNodeKind::Sink
}

pub(super) fn delay_axis_bounds(index: &ClockGraphIndex) -> Option<(f64, f64)> {
    let mut maximum = f64::NEG_INFINITY;
    let mut count = 0usize;
    for node in &index.nodes {
        let Some(arrival) = node.arrival_ns.filter(|value| value.is_finite()) else {
            continue;
        };
        maximum = maximum.max(arrival);
        count += 1;
    }
    // Insertion delay is measured from the clock root, so the axis always
    // starts at zero even when the earliest sink has a non-zero arrival.
    (count >= 2 && maximum > 1e-12).then_some((0.0, maximum))
}

pub(super) fn visible_rows(
    index: &ClockGraphIndex,
    collapsed: &HashSet<usize>,
    search: &str,
    only_issues: bool,
    mode: TreeLayoutMode,
) -> TreeLayout {
    let query = search.trim().to_lowercase();
    let filtering = !query.is_empty() || only_issues;
    let mut keep = vec![!filtering; index.nodes.len()];
    let mut pending = VecDeque::new();
    if filtering {
        for (node_index, node) in index.nodes.iter().enumerate() {
            let matches = query.is_empty()
                || node.name.to_lowercase().contains(&query)
                || node.instance_name.to_lowercase().contains(&query);
            if matches && (!only_issues || !index.issues[node_index].is_empty()) {
                keep[node_index] = true;
                pending.push_back(node_index);
            }
        }
        while let Some(node) = pending.pop_front() {
            for &parent in &index.parents[node] {
                if !keep[parent] {
                    keep[parent] = true;
                    pending.push_back(parent);
                }
            }
        }
    }

    let mut roots = index.roots.clone();
    if !index.diagnostics.is_empty() {
        let mut reachable = vec![false; index.nodes.len()];
        let mut queue = roots.clone();
        while let Some(node) = queue.pop() {
            if !reachable[node] {
                reachable[node] = true;
                queue.extend(&index.children[node]);
            }
        }
        for node in 0..index.nodes.len() {
            if !reachable[node] {
                roots.push(node);
                queue.push(node);
                while let Some(current) = queue.pop() {
                    if !reachable[current] {
                        reachable[current] = true;
                        queue.extend(&index.children[current]);
                    }
                }
            }
        }
    }

    let mut rows = Vec::with_capacity(index.nodes.len());
    let mut visited = vec![false; index.nodes.len()];
    let mut queue: VecDeque<(usize, usize, Option<usize>)> =
        roots.into_iter().map(|node| (node, 0, None)).collect();
    while let Some((node, depth, parent)) = queue.pop_front() {
        if !keep[node] {
            continue;
        }
        let reference = visited[node];
        visited[node] = true;
        let row = rows.len();
        rows.push(TreeRow {
            node,
            depth,
            parent,
            reference,
            x: 0.0,
            y: 0.0,
            leaf_fan: false,
            fan_spacing: 0.0,
            delay_positioned: false,
        });
        if !reference && (filtering || !collapsed.contains(&node)) {
            queue.extend(
                index.children[node]
                    .iter()
                    .map(|&child| (child, depth + 1, Some(row))),
            );
        }
    }

    let axis = layout_rows(index, &mut rows, mode);
    build_spatial_index(rows, axis)
}

fn layout_rows(
    index: &ClockGraphIndex,
    rows: &mut [TreeRow],
    mode: TreeLayoutMode,
) -> Option<TreeAxis> {
    let node_count = rows.len();
    if node_count == 0 {
        return None;
    }
    for row in rows.iter_mut() {
        row.y = row.depth as f64 * f64::from(LEVEL_SPACING);
    }

    let mut first_child = vec![None; node_count];
    let mut last_child = vec![None; node_count];
    let mut next_sibling = vec![None; node_count];
    let mut child_count = vec![0usize; node_count];
    for (row_index, row) in rows.iter().enumerate() {
        let Some(parent) = row.parent else {
            continue;
        };
        if let Some(previous) = last_child[parent] {
            next_sibling[previous] = Some(row_index);
        } else {
            first_child[parent] = Some(row_index);
        }
        last_child[parent] = Some(row_index);
        child_count[parent] += 1;
    }

    let terminal_leaf = rows
        .iter()
        .map(|row| is_terminal_leaf(index, row.node))
        .collect::<Vec<_>>();
    let delay_bounds = (mode == TreeLayoutMode::RealDelay)
        .then(|| delay_axis_bounds(index))
        .flatten();
    let mut subtree_delay_sum = vec![0.0_f64; node_count];
    let mut subtree_delay_count = vec![0usize; node_count];
    for row_index in (0..node_count).rev() {
        if child_count[row_index] == 0 {
            if let Some(arrival) = index.nodes[rows[row_index].node]
                .arrival_ns
                .filter(|value| value.is_finite())
            {
                subtree_delay_sum[row_index] = arrival;
                subtree_delay_count[row_index] = 1;
            }
            continue;
        }
        let mut child = first_child[row_index];
        while let Some(child_index) = child {
            subtree_delay_sum[row_index] += subtree_delay_sum[child_index];
            subtree_delay_count[row_index] += subtree_delay_count[child_index];
            child = next_sibling[child_index];
        }
    }
    let subtree_delay = subtree_delay_sum
        .iter()
        .zip(&subtree_delay_count)
        .map(|(sum, count)| (*count > 0).then(|| sum / *count as f64))
        .collect::<Vec<_>>();
    for row_index in 0..node_count {
        if mode == TreeLayoutMode::UnitDelay || child_count[row_index] < 2 {
            continue;
        }
        let mut children = Vec::with_capacity(child_count[row_index]);
        let mut child = first_child[row_index];
        while let Some(child_index) = child {
            children.push(child_index);
            child = next_sibling[child_index];
        }
        children.sort_by(
            |&left, &right| match (subtree_delay[left], subtree_delay[right]) {
                (Some(left_delay), Some(right_delay)) => left_delay.total_cmp(&right_delay),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            },
        );
        first_child[row_index] = Some(children[0]);
        for pair in children.windows(2) {
            next_sibling[pair[0]] = Some(pair[1]);
        }
        next_sibling[*children.last().expect("siblings are non-empty")] = None;
    }
    let mut fan_columns = vec![0usize; node_count];
    let mut fan_spacing = vec![0.0_f32; node_count];
    for row_index in 0..node_count {
        if child_count[row_index] == 0 {
            continue;
        }
        let mut child = first_child[row_index];
        let all_leaf_children = std::iter::from_fn(|| {
            let current = child?;
            child = next_sibling[current];
            Some(current)
        })
        .all(|child_index| first_child[child_index].is_none() && terminal_leaf[child_index]);
        if !all_leaf_children {
            continue;
        }
        if mode == TreeLayoutMode::RealDelay
            && delay_bounds.is_some()
            && child_count[row_index] >= 2
        {
            // Keep timed leaves on one horizontal row so their vertical
            // position can match the shared delay axis exactly.
            fan_columns[row_index] = child_count[row_index];
            fan_spacing[row_index] = compact_fan_spacing(child_count[row_index]);
        } else if child_count[row_index] >= LEAF_FAN_THRESHOLD {
            let columns = ((child_count[row_index] as f32 * 1.25).sqrt().ceil() as usize)
                .clamp(4, MAX_LEAF_FAN_COLUMNS);
            fan_columns[row_index] = columns;
            fan_spacing[row_index] = compact_fan_spacing(columns);
        }
    }
    let delay_axis_top = rows.iter().map(|row| row.y).fold(f64::INFINITY, f64::min);
    let maximum_depth = rows.iter().map(|row| row.depth).max().unwrap_or(0);
    let level_axis = TreeAxis {
        kind: TreeAxisKind::Level,
        minimum: 0.0,
        maximum: maximum_depth as f64,
        top_y: 0.0,
        bottom_y: f64::from(maximum_depth as f32 * LEVEL_SPACING),
    };
    let delay_axis_height = delay_bounds.map_or(0.0, |(_, maximum_ns)| {
        (maximum_ns as f32 * DELAY_NS_HEIGHT)
            .max(MIN_DELAY_AXIS_HEIGHT)
            .max(maximum_depth as f32 * LEVEL_SPACING + LEVEL_SPACING)
    });
    let delay_axis_bottom = delay_axis_top + f64::from(delay_axis_height);

    let mut subtree_width = vec![0.0_f32; node_count];
    for row_index in (0..node_count).rev() {
        if child_count[row_index] == 0 {
            subtree_width[row_index] = if terminal_leaf[row_index] {
                LEAF_COLUMN_SPACING
            } else {
                NODE_WIDTH
            };
        } else if fan_columns[row_index] > 0 {
            let columns = fan_columns[row_index];
            let fan_width =
                (columns.saturating_sub(1) as f32 * fan_spacing[row_index]) + LEAF_WIDTH;
            subtree_width[row_index] = fan_width.max(NODE_WIDTH);
        } else {
            let mut children_width = 0.0;
            let mut child = first_child[row_index];
            while let Some(child_index) = child {
                children_width += subtree_width[child_index];
                child = next_sibling[child_index];
            }
            children_width += SUBTREE_GAP * child_count[row_index].saturating_sub(1) as f32;
            subtree_width[row_index] = children_width.max(NODE_WIDTH);
        }
    }

    let mut subtree_start = vec![0.0_f32; node_count];
    let mut next_root_start = 0.0;
    for row_index in 0..node_count {
        if rows[row_index].parent.is_none() {
            subtree_start[row_index] = next_root_start;
            next_root_start += subtree_width[row_index] + ROOT_GAP;
        }
    }

    for row_index in 0..node_count {
        let start = subtree_start[row_index];
        let width = subtree_width[row_index];
        rows[row_index].x = f64::from(start + width * 0.5);
        if child_count[row_index] == 0 {
            continue;
        }
        if fan_columns[row_index] > 0 {
            let columns = fan_columns[row_index].min(child_count[row_index]);
            let spacing = fan_spacing[row_index];
            let fan_width = (columns - 1) as f32 * spacing;
            let fan_left = rows[row_index].x as f32 - fan_width * 0.5;
            let mut child = first_child[row_index];
            let mut child_ordinal = 0;
            while let Some(child_index) = child {
                let column = child_ordinal % columns;
                let fan_row = child_ordinal / columns;
                let child_x = fan_left + column as f32 * spacing;
                rows[child_index].x = f64::from(child_x);
                rows[child_index].y = rows[row_index].y
                    + f64::from(LEVEL_SPACING + fan_row as f32 * LEAF_ROW_SPACING);
                rows[child_index].leaf_fan = true;
                rows[child_index].fan_spacing = spacing;
                subtree_start[child_index] = child_x - subtree_width[child_index] * 0.5;
                child_ordinal += 1;
                child = next_sibling[child_index];
            }
            continue;
        }

        let mut children_width = 0.0;
        let mut child = first_child[row_index];
        while let Some(child_index) = child {
            children_width += subtree_width[child_index];
            child = next_sibling[child_index];
        }
        children_width += SUBTREE_GAP * (child_count[row_index] - 1) as f32;
        let mut cursor = start + (width - children_width).max(0.0) * 0.5;
        child = first_child[row_index];
        while let Some(child_index) = child {
            subtree_start[child_index] = cursor;
            rows[child_index].y = rows[row_index].y + f64::from(LEVEL_SPACING);
            cursor += subtree_width[child_index] + SUBTREE_GAP;
            child = next_sibling[child_index];
        }
    }

    for row_index in 0..node_count {
        let mut child = first_child[row_index];
        let mut left = f64::INFINITY;
        let mut right = f64::NEG_INFINITY;
        while let Some(child_index) = child {
            left = left.min(rows[child_index].x);
            right = right.max(rows[child_index].x);
            child = next_sibling[child_index];
        }
        if left.is_finite() {
            rows[row_index].x = (left + right) * 0.5;
        }
    }
    if mode == TreeLayoutMode::UnitDelay {
        return Some(level_axis);
    }
    delay_bounds.and_then(|(minimum_ns, maximum_ns)| {
        let delay_span = delay_axis_bottom - delay_axis_top;
        for row in rows.iter_mut() {
            let Some(arrival) = index.nodes[row.node]
                .arrival_ns
                .filter(|value| value.is_finite())
            else {
                continue;
            };
            let delay_fraction = (arrival / maximum_ns).clamp(0.0, 1.0);
            row.y = delay_axis_top + delay_fraction * delay_span;
            row.delay_positioned = true;
        }
        delay_axis_top.is_finite().then_some(TreeAxis {
            kind: TreeAxisKind::DelayNs,
            minimum: minimum_ns,
            maximum: maximum_ns,
            top_y: delay_axis_top,
            bottom_y: delay_axis_bottom,
        })
    })
}

fn build_spatial_index(rows: Vec<TreeRow>, axis: Option<TreeAxis>) -> TreeLayout {
    let mut render_rows = (0..rows.len()).collect::<Vec<_>>();
    render_rows.sort_by(|&left, &right| {
        rows[left]
            .y
            .total_cmp(&rows[right].y)
            .then_with(|| rows[left].x.total_cmp(&rows[right].x))
    });

    let mut y_bands = Vec::new();
    let mut start = 0;
    while start < render_rows.len() {
        let y = rows[render_rows[start]].y;
        let mut end = start + 1;
        while end < render_rows.len() && rows[render_rows[end]].y == y {
            end += 1;
        }
        y_bands.push(YBand {
            y,
            rows: start..end,
        });
        start = end;
    }

    TreeLayout {
        rows,
        render_rows,
        y_bands,
        axis,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chip_view_db::clock_tree::{ClockInfo, ClockNode, ClockSubtreeStats};
    use chipgeom_format::{ClockEdgeTransition, ClockNodeKind};
    use std::collections::HashMap;

    fn test_index(children: Vec<Vec<usize>>) -> ClockGraphIndex {
        let node_count = children.len();
        let nodes = children
            .iter()
            .enumerate()
            .map(|(index, _)| ClockNode {
                id: index as u32,
                index,
                name: format!("n{index}"),
                instance_name: String::new(),
                pin_name: String::new(),
                master: String::new(),
                kind: ClockNodeKind::BufferInput,
                x_dbu: 0,
                y_dbu: 0,
                position_valid: false,
                owner_index: None,
                root: index == 0,
                sink: index > 0,
                arrival_ns: None,
                slew_ns: None,
                timing_states: Vec::new(),
            })
            .collect::<Vec<_>>();
        let mut parents = vec![Vec::new(); children.len()];
        for (parent, child_nodes) in children.iter().enumerate() {
            for &child in child_nodes {
                parents[child].push(parent);
            }
        }
        ClockGraphIndex {
            info: ClockInfo {
                name: "clk".to_string(),
                master_clock_id: None,
                source_edge: ClockEdgeTransition::Rise,
            },
            timed_node_count: 0,
            nodes,
            edges: Vec::new(),
            children,
            parents,
            roots: vec![0],
            depth: Vec::new(),
            stats: vec![ClockSubtreeStats::default(); node_count],
            summary: ClockSubtreeStats::default(),
            issues: vec![Vec::new(); node_count],
            diagnostics: Vec::new(),
            by_name: HashMap::new(),
            by_instance: HashMap::new(),
            by_net: HashMap::new(),
            edges_for_node: Vec::new(),
            edge_by_pair: HashMap::new(),
        }
    }

    #[test]
    fn top_down_layout_centers_parents_over_their_children() {
        let index = test_index(vec![vec![1, 2], vec![3, 4], vec![], vec![], vec![]]);
        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::UnitDelay,
        );

        assert_eq!(
            layout.rows.iter().map(|row| row.depth).collect::<Vec<_>>(),
            vec![0, 1, 1, 2, 2]
        );
        assert_eq!(
            layout.rows[0].x,
            (layout.rows[1].x + layout.rows[2].x) * 0.5
        );
        assert!(layout.rows[1].x < layout.rows[2].x);
        assert_eq!(layout.rows[1].y, layout.rows[2].y);
        assert!(layout.rows[3].y > layout.rows[1].y);
    }

    #[test]
    fn collapsed_branch_is_ignored_by_default_expanded_layout() {
        let index = test_index(vec![vec![1, 2], vec![3, 4], vec![], vec![], vec![]]);
        let collapsed = HashSet::from([1]);
        let layout = visible_rows(&index, &collapsed, "", false, TreeLayoutMode::UnitDelay);

        assert_eq!(layout.rows.len(), 3);
        assert_eq!(
            layout.rows.iter().map(|row| row.node).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn wide_leaf_fan_wraps_without_truncating_nodes() {
        let mut children = vec![vec![]; 10_001];
        children[0] = (1..=10_000).collect();
        let index = test_index(children);
        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::UnitDelay,
        );

        let minimum_x = layout
            .rows
            .iter()
            .map(|row| row.x)
            .fold(f64::INFINITY, f64::min);
        let maximum_x = layout
            .rows
            .iter()
            .map(|row| row.x)
            .fold(f64::NEG_INFINITY, f64::max);
        assert_eq!(layout.rows.len(), 10_001);
        assert!(
            maximum_x - minimum_x < f64::from(LEAF_FAN_MAX_WIDTH + LEAF_WIDTH),
            "layout width: {minimum_x}..{maximum_x}"
        );
        assert!(layout.y_bands.len() > 300);
    }

    #[test]
    fn real_delay_leaf_fan_stays_compact_for_large_fanout() {
        let mut children = vec![vec![]; 1_001];
        children[0] = (1..=1_000).collect();
        let mut index = test_index(children);
        index.nodes[0].arrival_ns = Some(0.0);
        for node in 1..=1_000 {
            index.nodes[node].arrival_ns = Some(0.10 + node as f64 * 0.0001);
        }
        index.timed_node_count = index.nodes.len();

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::RealDelay,
        );
        let minimum_x = layout
            .rows
            .iter()
            .map(|row| row.x)
            .fold(f64::INFINITY, f64::min);
        let maximum_x = layout
            .rows
            .iter()
            .map(|row| row.x)
            .fold(f64::NEG_INFINITY, f64::max);

        assert!(maximum_x - minimum_x < f64::from(LEAF_FAN_MAX_WIDTH + LEAF_WIDTH));
        assert!(layout
            .axis
            .is_some_and(|axis| axis.kind == TreeAxisKind::DelayNs));
        assert!(layout.rows[1..].iter().all(|row| row.delay_positioned));
    }

    #[test]
    fn leaf_height_tracks_insertion_delay_from_zero() {
        let mut index = test_index(vec![vec![1, 2, 3, 4], vec![], vec![], vec![], vec![]]);
        for (node, arrival) in [(1, 0.10), (2, 0.30), (3, 0.15), (4, 0.25)] {
            index.nodes[node].arrival_ns = Some(arrival);
        }
        index.timed_node_count = 4;

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::RealDelay,
        );
        let row_for = |node| layout.rows.iter().find(|row| row.node == node).unwrap();

        assert!(layout.rows[1..].iter().all(|row| row.delay_positioned));
        assert!(row_for(1).y < row_for(3).y);
        assert!(row_for(3).y < row_for(4).y);
        assert!(row_for(4).y < row_for(2).y);
        let axis = layout.axis.expect("delay axis");
        assert_eq!(axis.kind, TreeAxisKind::DelayNs);
        assert!(axis.minimum.abs() < 1e-9);
        assert!((axis.maximum - 0.30).abs() < 1e-9);
        assert!((axis.top_y - row_for(0).y).abs() < 1e-9);
        assert!(
            (row_for(1).y - axis.top_y - (axis.bottom_y - axis.top_y) / 3.0).abs() < 1e-5,
            "leaf_y={} axis_top={} axis_bottom={}",
            row_for(1).y,
            axis.top_y,
            axis.bottom_y
        );
        assert!((axis.bottom_y - row_for(2).y).abs() < 1e-9);
    }

    #[test]
    fn every_timed_node_height_matches_the_delay_axis() {
        let mut index = test_index(vec![vec![1], vec![2], vec![3], vec![]]);
        for (node, arrival) in [(0, 0.0), (1, 0.10), (2, 0.25), (3, 0.40)] {
            index.nodes[node].arrival_ns = Some(arrival);
        }
        index.timed_node_count = 4;

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::RealDelay,
        );
        let axis = layout.axis.expect("delay axis");
        let axis_span = axis.bottom_y - axis.top_y;

        for row in &layout.rows {
            let arrival = index.nodes[row.node].arrival_ns.expect("timed node");
            let expected = axis.top_y + arrival / axis.maximum * axis_span;
            assert!(
                (row.y - expected).abs() < 1e-9,
                "node {} y={} expected={}",
                row.node,
                row.y,
                expected
            );
            assert!(row.delay_positioned);
        }
    }

    #[test]
    fn real_delay_axis_scales_with_insertion_delay() {
        let mut index = test_index(vec![vec![1], vec![]]);
        index.nodes[0].arrival_ns = Some(0.0);
        index.nodes[1].arrival_ns = Some(0.50);
        index.timed_node_count = 2;

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::RealDelay,
        );
        let axis = layout.axis.expect("delay axis");

        assert!(
            axis.bottom_y - axis.top_y >= f64::from(0.50 * DELAY_NS_HEIGHT),
            "delay axis height: {}",
            axis.bottom_y - axis.top_y
        );
    }

    #[test]
    fn unit_delay_mode_ignores_arrival_for_node_height() {
        let mut index = test_index(vec![vec![1], vec![2], vec![3], vec![]]);
        for (node, arrival) in [(0, 0.0), (1, 0.01), (2, 0.02), (3, 0.40)] {
            index.nodes[node].arrival_ns = Some(arrival);
        }
        index.timed_node_count = 4;

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::UnitDelay,
        );
        for row in &layout.rows {
            assert!((row.y - row.depth as f64 * f64::from(LEVEL_SPACING)).abs() < 1e-9);
            assert!(!row.delay_positioned);
        }
        let axis = layout.axis.expect("level axis");
        assert_eq!(axis.kind, TreeAxisKind::Level);
        assert_eq!(axis.maximum, 3.0);
    }

    #[test]
    fn sibling_fans_are_ordered_from_early_to_late_delay() {
        let mut index = test_index(vec![
            vec![1, 2],
            vec![3, 4],
            vec![5, 6],
            vec![],
            vec![],
            vec![],
            vec![],
        ]);
        for (node, arrival) in [(3, 0.20), (4, 0.30), (5, 0.10), (6, 0.15)] {
            index.nodes[node].arrival_ns = Some(arrival);
        }
        index.timed_node_count = 4;

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::RealDelay,
        );
        let row_for = |node| layout.rows.iter().find(|row| row.node == node).unwrap();
        let early_max = [5, 6]
            .into_iter()
            .map(|node| row_for(node).x)
            .fold(f64::NEG_INFINITY, f64::max);
        let late_min = [3, 4]
            .into_iter()
            .map(|node| row_for(node).x)
            .fold(f64::INFINITY, f64::min);
        let early_max_y = [5, 6]
            .into_iter()
            .map(|node| row_for(node).y)
            .fold(f64::NEG_INFINITY, f64::max);
        let late_min_y = [3, 4]
            .into_iter()
            .map(|node| row_for(node).y)
            .fold(f64::INFINITY, f64::min);

        assert!(row_for(2).x < row_for(1).x);
        assert!(early_max < late_min);
        assert!(early_max_y < late_min_y);
    }

    #[test]
    fn leaf_delay_height_uses_a_global_baseline_across_depths() {
        let mut index = test_index(vec![
            vec![1, 2],
            vec![3, 4],
            vec![7],
            vec![],
            vec![],
            vec![],
            vec![],
            vec![5, 6],
        ]);
        for (node, arrival) in [(3, 0.20), (4, 0.30), (5, 0.10), (6, 0.20)] {
            index.nodes[node].arrival_ns = Some(arrival);
        }
        index.timed_node_count = 4;

        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::RealDelay,
        );
        let row_for = |node| layout.rows.iter().find(|row| row.node == node).unwrap();

        assert!((row_for(3).y - row_for(6).y).abs() < 1e-9);
        assert!(row_for(3).y > row_for(1).y);
        assert!(row_for(6).y > row_for(7).y);
    }

    #[test]
    fn sibling_leaf_fans_keep_their_nodes_under_each_parent() {
        let mut children = vec![vec![]; 37];
        children[0] = vec![1, 2];
        children[1] = (3..=19).collect();
        children[2] = (20..=36).collect();
        let index = test_index(children);
        let layout = visible_rows(
            &index,
            &HashSet::new(),
            "",
            false,
            TreeLayoutMode::UnitDelay,
        );

        let row_for = |node| layout.rows.iter().find(|row| row.node == node).unwrap();
        let child_columns = |node: usize| {
            index.children[node]
                .iter()
                .map(|&child| {
                    let child = layout.rows.iter().find(|row| row.node == child).unwrap();
                    (child.x, child.y)
                })
                .collect::<Vec<_>>()
        };
        let first = child_columns(1);
        let second = child_columns(2);
        let first_min = first.iter().map(|(x, _)| *x).fold(f64::INFINITY, f64::min);
        let first_max = first
            .iter()
            .map(|(x, _)| *x)
            .fold(f64::NEG_INFINITY, f64::max);
        let second_min = second.iter().map(|(x, _)| *x).fold(f64::INFINITY, f64::min);

        assert!(first_max > first_min);
        assert!(first_max < second_min);
        assert_eq!(row_for(1).x, (first_min + first_max) * 0.5);
        assert_eq!(first[0].1, first[4].1);
        assert!(first[5].1 > first[0].1);
    }
}
