//! Timeline controls and exact navigation between recorded flow boundaries.
use super::ReplayApp;
use egui::{Color32, Pos2, Stroke, Ui};
use std::time::Instant;

#[derive(Clone, Copy)]
pub(super) enum Direction {
    Previous,
    Next,
}

impl ReplayApp {
    pub(super) fn navigate_step(&mut self, direction: Direction) {
        let step = match direction {
            Direction::Previous => self.step.saturating_sub(1),
            Direction::Next => (self.step + 1).min(self.catalog.steps.len() - 1),
        };
        self.playing = false;
        self.select(step, self.starts[step], false);
    }

    pub(super) fn navigate_subflow(&mut self, direction: Direction) {
        let starts = &self.starts;
        let plans = &self.plans;
        let nodes: Vec<_> = self
            .catalog
            .steps
            .iter()
            .enumerate()
            .flat_map(|(step, entry)| {
                entry
                    .nodes
                    .iter()
                    .enumerate()
                    .filter(|(_, node)| node.sequence.is_none())
                    .map(move |(index, node)| {
                        let time = starts[step]
                            + plans[step]
                                .subflow_start(&node.label)
                                .unwrap_or_else(|| plans[step].display_at_source(node.seconds));
                        (step, index, time)
                    })
            })
            .collect();
        let current = self
            .navigation_node
            .and_then(|id| nodes.iter().position(|n| (n.0, n.1) == id));
        let target = match (direction, current) {
            (Direction::Previous, Some(i)) => i.checked_sub(1),
            (Direction::Next, Some(i)) => (i + 1 < nodes.len()).then_some(i + 1),
            (Direction::Previous, None) => nodes.iter().rposition(|n| n.2 < self.position - 1e-9),
            (Direction::Next, None) => nodes.iter().position(|n| n.2 > self.position + 1e-9),
        };
        self.playing = false;
        if let Some((step, index, time)) = target.map(|i| nodes[i]) {
            self.select(step, time, false);
            self.navigation_node = Some((step, index));
        }
    }

    pub(super) fn playback_controls(&mut self, ui: &mut Ui) {
        let width = ui.available_width();
        let height = 30.0;
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
        let button_width = 30.0;
        let gap = 4.0;
        let group_width = 5.0 * button_width + 4.0 * gap;
        let mut controls = ui.new_child(
            egui::UiBuilder::new()
                .max_rect(egui::Rect::from_min_size(
                    Pos2::new(
                        (rect.center().x - group_width / 2.0).max(rect.left()),
                        rect.top(),
                    ),
                    egui::vec2(group_width, height),
                ))
                .layout(egui::Layout::left_to_right(egui::Align::Center)),
        );
        controls.spacing_mut().item_spacing.x = gap;
        if icon(&mut controls, false, true, "Previous step") {
            self.navigate_step(Direction::Previous);
        }
        if icon(&mut controls, false, false, "Previous subflow") {
            self.navigate_subflow(Direction::Previous);
        }
        let label = if self.playing { "⏸" } else { "▶" };
        if controls
            .add_sized(
                [button_width, height],
                egui::Button::new(egui::RichText::new(label).color(Color32::WHITE).size(15.0))
                    .fill(Color32::from_rgb(0, 111, 107))
                    .corner_radius(15.0),
            )
            .on_hover_text(if self.playing {
                "Pause replay"
            } else {
                "Play replay"
            })
            .clicked()
        {
            if self.position >= self.total {
                self.select(0, 0.0, false);
            }
            self.navigation_node = None;
            self.playing = !self.playing;
            self.tick = Instant::now();
        }
        if icon(&mut controls, true, false, "Next subflow") {
            self.navigate_subflow(Direction::Next);
        }
        if icon(&mut controls, true, true, "Next step") {
            self.navigate_step(Direction::Next);
        }
        let speed = |ui: &mut Ui, value: &mut f64| {
            egui::ComboBox::from_id_salt("speed")
                .selected_text(format!("{}×", value))
                .show_ui(ui, |ui| {
                    for speed in [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 32.0, 64.0] {
                        ui.selectable_value(value, speed, format!("{speed}×"));
                    }
                })
        };
        if width >= group_width + 160.0 {
            let mut speed_ui = ui.new_child(egui::UiBuilder::new().max_rect(
                egui::Rect::from_min_max(Pos2::new(rect.right() - 76.0, rect.top()), rect.max),
            ));
            speed(&mut speed_ui, &mut self.speed);
        } else {
            speed(ui, &mut self.speed);
        }
    }
}

fn icon(ui: &mut Ui, right: bool, bar: bool, tooltip: &str) -> bool {
    let response = ui
        .add_sized([30.0, 30.0], egui::Button::new(""))
        .on_hover_text(tooltip);
    let center = response.rect.center();
    let sign = if right { 1.0 } else { -1.0 };
    let points = vec![
        center + egui::vec2(sign * 5.0, 0.0),
        center + egui::vec2(-sign * 4.0, -6.0),
        center + egui::vec2(-sign * 4.0, 6.0),
    ];
    ui.painter().add(egui::Shape::convex_polygon(
        points,
        Color32::LIGHT_GRAY,
        Stroke::NONE,
    ));
    if bar {
        let x = center.x + sign * 7.0;
        ui.painter().line_segment(
            [Pos2::new(x, center.y - 6.0), Pos2::new(x, center.y + 6.0)],
            Stroke::new(1.5, Color32::LIGHT_GRAY),
        );
    }
    response.clicked()
}
