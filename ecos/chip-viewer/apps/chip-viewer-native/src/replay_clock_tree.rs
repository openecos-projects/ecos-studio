use chipgeom_format::ClockNodeKind;
use chipgeom_reader::ClockTreeSnapshot;
use egui::{Color32, Pos2, Rect, Stroke};
use std::collections::BTreeMap;

pub fn show(ui: &mut egui::Ui, tree: &ClockTreeSnapshot) {
    ui.label(format!(
        "{} clocks · {} nodes · {} connections",
        tree.clocks.len(),
        tree.nodes.len(),
        tree.edges.len()
    ));
    if let Some(status) = tree.status() {
        ui.small(format!("Analysis: {status:?}"));
    }
    if tree.nodes.is_empty() {
        ui.label("The CTS result contains no clock-tree nodes.");
        return;
    }

    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), ui.available_height().max(180.0)),
        egui::Sense::hover(),
    );
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 0.0, Color32::from_rgb(17, 24, 30));
    let min_x = tree.nodes.iter().map(|node| node.x).min().unwrap_or(0);
    let max_x = tree.nodes.iter().map(|node| node.x).max().unwrap_or(1);
    let min_y = tree.nodes.iter().map(|node| node.y).min().unwrap_or(0);
    let max_y = tree.nodes.iter().map(|node| node.y).max().unwrap_or(1);
    let world = Rect::from_min_max(
        rect.min + egui::vec2(12.0, 12.0),
        rect.max - egui::vec2(12.0, 12.0),
    );
    let scale = (world.width() / (i64::from(max_x) - i64::from(min_x)).max(1) as f32)
        .min(world.height() / (i64::from(max_y) - i64::from(min_y)).max(1) as f32);
    let project = |x: i32, y: i32| {
        Pos2::new(
            world.center().x + (i64::from(x) - i64::from(min_x)) as f32 * scale
                - (i64::from(max_x) - i64::from(min_x)) as f32 * scale / 2.0,
            world.center().y - (i64::from(y) - i64::from(min_y)) as f32 * scale
                + (i64::from(max_y) - i64::from(min_y)) as f32 * scale / 2.0,
        )
    };
    let positions = tree
        .nodes
        .iter()
        .map(|node| (node.node_id, project(node.x, node.y)))
        .collect::<BTreeMap<_, _>>();
    for edge in &tree.edges {
        if let (Some(from), Some(to)) =
            (positions.get(&edge.from_node), positions.get(&edge.to_node))
        {
            painter.line_segment(
                [*from, *to],
                Stroke::new(0.7, Color32::from_rgb(78, 103, 117)),
            );
        }
    }
    for node in &tree.nodes {
        let Some(position) = positions.get(&node.node_id) else {
            continue;
        };
        let color = match ClockNodeKind::from_raw(node.kind) {
            Some(ClockNodeKind::RootPort | ClockNodeKind::InternalRoot) => {
                Color32::from_rgb(238, 126, 110)
            }
            Some(
                ClockNodeKind::BufferInput
                | ClockNodeKind::BufferOutput
                | ClockNodeKind::InverterInput
                | ClockNodeKind::InverterOutput
                | ClockNodeKind::IcgInput
                | ClockNodeKind::IcgOutput,
            ) => Color32::from_rgb(75, 190, 206),
            Some(ClockNodeKind::Sink) => Color32::from_rgb(232, 192, 93),
            _ => Color32::from_rgb(156, 169, 179),
        };
        painter.circle_filled(*position, 2.0, color);
    }
}
