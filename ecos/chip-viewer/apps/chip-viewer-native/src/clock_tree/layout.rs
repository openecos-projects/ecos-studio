use std::collections::{HashSet, VecDeque};
use std::ops::Range;

use chip_view_db::clock_tree::ClockGraphIndex;

pub(super) const NODE_WIDTH: f32 = 160.0;
pub(super) const NODE_HEIGHT: f32 = 34.0;
pub(super) const LEVEL_SPACING: f32 = 80.0;
pub(super) const LEAF_WIDTH: f32 = 14.0;
pub(super) const LEAF_HEIGHT: f32 = 14.0;
pub(super) const LEAF_ROW_SPACING: f32 = 20.0;

const LEAF_COLUMN_SPACING: f32 = 20.0;
const MAX_LEAF_FAN_COLUMNS: usize = 32;
const LEAF_FAN_THRESHOLD: usize = 8;
const SUBTREE_GAP: f32 = 16.0;
const ROOT_GAP: f32 = 48.0;

#[derive(Clone, Debug)]
pub(super) struct TreeRow {
    pub(super) node: usize,
    pub(super) depth: usize,
    pub(super) parent: Option<usize>,
    pub(super) reference: bool,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) leaf_fan: bool,
}

#[derive(Clone, Debug)]
pub(super) struct YBand {
    pub(super) y: f64,
    pub(super) rows: Range<usize>,
}

pub(super) struct TreeLayout {
    pub(super) rows: Vec<TreeRow>,
    pub(super) render_rows: Vec<usize>,
    pub(super) y_bands: Vec<YBand>,
}

pub(super) fn visible_rows(
    index: &ClockGraphIndex,
    collapsed: &HashSet<usize>,
    search: &str,
    only_issues: bool,
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
        });
        if !reference && (filtering || !collapsed.contains(&node)) {
            queue.extend(
                index.children[node]
                    .iter()
                    .map(|&child| (child, depth + 1, Some(row))),
            );
        }
    }

    layout_rows(index, &mut rows);
    build_spatial_index(rows)
}

fn layout_rows(index: &ClockGraphIndex, rows: &mut [TreeRow]) {
    let node_count = rows.len();
    if node_count == 0 {
        return;
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
        .map(|row| {
            let node = &index.nodes[row.node];
            node.sink || node.kind == chipgeom_format::ClockNodeKind::Sink
        })
        .collect::<Vec<_>>();
    let mut fan_columns = vec![0usize; node_count];
    for row_index in 0..node_count {
        if child_count[row_index] < LEAF_FAN_THRESHOLD {
            continue;
        }
        let mut child = first_child[row_index];
        let all_leaf_children = std::iter::from_fn(|| {
            let current = child?;
            child = next_sibling[current];
            Some(current)
        })
        .all(|child_index| first_child[child_index].is_none() && terminal_leaf[child_index]);
        if all_leaf_children {
            let columns = ((child_count[row_index] as f32 * 1.25).sqrt().ceil() as usize)
                .clamp(4, MAX_LEAF_FAN_COLUMNS);
            fan_columns[row_index] = columns;
        }
    }

    let mut subtree_width = vec![0.0_f32; node_count];
    for row_index in (0..node_count).rev() {
        if child_count[row_index] == 0 {
            subtree_width[row_index] = if terminal_leaf[row_index] {
                LEAF_COLUMN_SPACING
            } else {
                NODE_WIDTH
            };
        } else if fan_columns[row_index] > 0 {
            subtree_width[row_index] =
                (fan_columns[row_index] as f32 * LEAF_COLUMN_SPACING).max(NODE_WIDTH);
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
            let fan_width = (columns - 1) as f32 * LEAF_COLUMN_SPACING;
            let fan_left = rows[row_index].x as f32 - fan_width * 0.5;
            let mut child = first_child[row_index];
            let mut child_ordinal = 0;
            while let Some(child_index) = child {
                let column = child_ordinal % columns;
                let fan_row = child_ordinal / columns;
                rows[child_index].x = f64::from(fan_left + column as f32 * LEAF_COLUMN_SPACING);
                rows[child_index].y = rows[row_index].y
                    + f64::from(LEVEL_SPACING + fan_row as f32 * LEAF_ROW_SPACING);
                rows[child_index].leaf_fan = true;
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
        let Some(first) = first_child[row_index] else {
            continue;
        };
        let last = last_child[row_index].unwrap_or(first);
        rows[row_index].x = (rows[first].x + rows[last].x) * 0.5;
    }
}

fn build_spatial_index(rows: Vec<TreeRow>) -> TreeLayout {
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
                arrival_ns: Some(index as f64),
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
            timed_node_count: nodes.len(),
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
        let layout = visible_rows(&index, &HashSet::new(), "", false);

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
        let layout = visible_rows(&index, &collapsed, "", false);

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
        let layout = visible_rows(&index, &HashSet::new(), "", false);

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
            maximum_x - minimum_x < 32.0 * f64::from(LEAF_COLUMN_SPACING),
            "layout width: {minimum_x}..{maximum_x}"
        );
        assert!(layout.y_bands.len() > 300);
    }
}
