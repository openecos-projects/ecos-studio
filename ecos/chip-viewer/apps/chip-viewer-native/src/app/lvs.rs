use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use chipgeom_format::Rect32;
use eframe::egui;
use serde_json::Value;

use super::{
    contextual_map_focus_bbox, ecos_accent, ecos_text_primary, ecos_text_secondary, ecos_warning,
    info_panel_label, section_heading, FocusTransition, LoadedViewer, PendingFocus,
};

const MAX_COMPONENT_LABELS: usize = 8;
const MAX_TERMINAL_EXAMPLES: usize = 3;

pub(super) struct LvsAnalysis {
    data_path: PathBuf,
    run_state: Option<String>,
    connectivity: Vec<LvsConnectivityAnomaly>,
    entities: Vec<LvsEntityAnomaly>,
    groups: Vec<LvsFaultGroup>,
    load_error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct LvsFocusRequest {
    pub(super) group_index: usize,
    pub(super) bbox: Rect32,
}

#[derive(Debug, PartialEq)]
struct LvsConnectivityAnomaly {
    name: String,
    total: usize,
    open: usize,
    open_percentage: f64,
    short: usize,
    short_percentage: f64,
}

#[derive(Debug, PartialEq)]
struct LvsEntityAnomaly {
    entity: String,
    def_count: i64,
    netlist_count: i64,
    difference: i64,
}

#[derive(Debug, PartialEq)]
struct LvsFaultGroup {
    violation_type: String,
    net: String,
    components: BTreeSet<usize>,
    terminal_count: usize,
    shape_count: usize,
    shapes: Vec<Rect32>,
    bbox: Option<Rect32>,
    terminal_examples: Vec<String>,
}

struct ParsedLvs {
    run_state: Option<String>,
    connectivity: Vec<LvsConnectivityAnomaly>,
    entities: Vec<LvsEntityAnomaly>,
    groups: Vec<LvsFaultGroup>,
}

impl LvsAnalysis {
    pub(super) fn load(data_path: Option<PathBuf>) -> Option<Self> {
        let data_path = data_path?;
        match fs::read_to_string(&data_path) {
            Ok(text) => match parse_lvs_json_text(&text) {
                Ok(parsed) => Some(Self {
                    data_path,
                    run_state: parsed.run_state,
                    connectivity: parsed.connectivity,
                    entities: parsed.entities,
                    groups: parsed.groups,
                    load_error: None,
                }),
                Err(err) => Some(Self::failed(
                    data_path,
                    format!("failed to parse LVS analysis: {err}"),
                )),
            },
            Err(err) => Some(Self::failed(
                data_path,
                format!("failed to read LVS analysis: {err}"),
            )),
        }
    }

    fn failed(data_path: PathBuf, load_error: String) -> Self {
        Self {
            data_path,
            run_state: None,
            connectivity: Vec::new(),
            entities: Vec::new(),
            groups: Vec::new(),
            load_error: Some(load_error),
        }
    }

    fn anomaly_count(&self) -> usize {
        self.connectivity.len() + self.entities.len() + self.groups.len()
    }

    pub(super) fn selected_shape_rects(&self, selected_group: Option<usize>) -> Option<&[Rect32]> {
        let group = self.groups.get(selected_group?)?;
        (!group.shapes.is_empty()).then_some(group.shapes.as_slice())
    }

    fn sidebar(&self, ui: &mut egui::Ui, selected_group: Option<usize>) -> Option<LvsFocusRequest> {
        let mut focus = None;
        ui.horizontal(|ui| {
            section_heading(ui, "LVS ANOMALIES");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{} findings", self.anomaly_count()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            });
        });

        if let Some(error) = &self.load_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), error);
            info_panel_label(ui, self.data_path.display().to_string());
            return None;
        }

        if self
            .run_state
            .as_deref()
            .is_some_and(|state| !state.eq_ignore_ascii_case("success"))
        {
            ui.add_space(6.0);
            ui.colored_label(
                ecos_warning(),
                format!(
                    "LVS run state: {}",
                    self.run_state.as_deref().unwrap_or("unknown")
                ),
            );
        }

        if self.anomaly_count() == 0 {
            ui.add_space(8.0);
            ui.label(
                egui::RichText::new("No LVS anomalies detected")
                    .size(13.0)
                    .color(ecos_text_secondary()),
            );
            return None;
        }

        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_lvs_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                if !self.connectivity.is_empty() {
                    ui.add_space(8.0);
                    section_heading(ui, "CONNECTIVITY");
                    for anomaly in &self.connectivity {
                        lvs_connectivity_card(ui, anomaly);
                        ui.add_space(6.0);
                    }
                }

                if !self.entities.is_empty() {
                    ui.add_space(8.0);
                    section_heading(ui, "ENTITY DIFFERENCES");
                    for anomaly in &self.entities {
                        lvs_entity_card(ui, anomaly);
                        ui.add_space(6.0);
                    }
                }

                if !self.groups.is_empty() {
                    ui.add_space(8.0);
                    section_heading(ui, "FAULT GROUPS");
                    for (group_index, group) in self.groups.iter().enumerate() {
                        if lvs_fault_group_card(ui, group, selected_group == Some(group_index)) {
                            focus = group.bbox.map(|bbox| LvsFocusRequest { group_index, bbox });
                        }
                        ui.add_space(6.0);
                    }
                }
            });
        focus
    }
}

impl LoadedViewer {
    pub(super) fn lvs_sidebar(&mut self, ui: &mut egui::Ui) {
        let selected_group = self.selected_lvs_group;
        let focus = self
            .lvs_analysis
            .as_ref()
            .and_then(|analysis| analysis.sidebar(ui, selected_group));
        if let Some(focus) = focus {
            self.selected_lvs_group = Some(focus.group_index);
            self.pending_focus = Some(PendingFocus {
                bbox: contextual_map_focus_bbox(focus.bbox),
                select_shape_id: None,
                transition: FocusTransition::Animated,
            });
        }
    }
}

fn lvs_connectivity_card(ui: &mut egui::Ui, anomaly: &LvsConnectivityAnomaly) {
    egui::Frame::NONE
        .fill(ui.visuals().faint_bg_color)
        .corner_radius(8)
        .inner_margin(egui::Margin::same(8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(
                egui::RichText::new(&anomaly.name)
                    .strong()
                    .color(ecos_text_primary()),
            );
            ui.label(
                egui::RichText::new(format!("of {} objects", anomaly.total))
                    .small()
                    .color(ecos_text_secondary()),
            );
            ui.horizontal_wrapped(|ui| {
                if anomaly.open > 0 {
                    ui.colored_label(
                        ecos_warning(),
                        format!("Open {} ({:.2}%)", anomaly.open, anomaly.open_percentage),
                    );
                }
                if anomaly.short > 0 {
                    ui.colored_label(
                        ecos_warning(),
                        format!("Short {} ({:.2}%)", anomaly.short, anomaly.short_percentage),
                    );
                }
            });
        });
}

fn lvs_entity_card(ui: &mut egui::Ui, anomaly: &LvsEntityAnomaly) {
    egui::Frame::NONE
        .fill(ui.visuals().faint_bg_color)
        .corner_radius(8)
        .inner_margin(egui::Margin::same(8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(&anomaly.entity)
                        .strong()
                        .color(ecos_text_primary()),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.colored_label(ecos_accent(), format!("{:+}", anomaly.difference));
                });
            });
            ui.label(
                egui::RichText::new(format!(
                    "DEF {} / netlist {}",
                    anomaly.def_count, anomaly.netlist_count
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });
}

fn lvs_fault_group_card(ui: &mut egui::Ui, group: &LvsFaultGroup, selected: bool) -> bool {
    let mut focus_requested = false;
    egui::Frame::NONE
        .fill(ui.visuals().faint_bg_color)
        .stroke(if selected {
            egui::Stroke::new(1.5, egui::Color32::WHITE)
        } else {
            egui::Stroke::NONE
        })
        .corner_radius(8)
        .inner_margin(egui::Margin::same(8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(&group.violation_type)
                        .strong()
                        .color(ecos_text_primary()),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let button = ui.add_enabled(group.bbox.is_some(), egui::Button::new("Focus"));
                    if button.clicked() {
                        focus_requested = true;
                    }
                });
            });
            ui.label(
                egui::RichText::new(format!("Net {}", group.net))
                    .small()
                    .color(ecos_text_secondary()),
            );
            let components = component_summary(&group.components);
            let summary = format!(
                "{} terminals · {} shapes · component IDs: {}",
                group.terminal_count, group.shape_count, components
            );
            let label = ui.label(
                egui::RichText::new(summary)
                    .small()
                    .color(ecos_text_secondary()),
            );
            if !group.terminal_examples.is_empty() {
                label.on_hover_text(group.terminal_examples.join("\n"));
            }
        });
    focus_requested
}

fn component_summary(components: &BTreeSet<usize>) -> String {
    if components.is_empty() {
        return "none".to_string();
    }
    let visible = components
        .iter()
        .take(MAX_COMPONENT_LABELS)
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    let hidden = components.len().saturating_sub(MAX_COMPONENT_LABELS);
    if hidden == 0 {
        visible
    } else {
        format!("{visible} +{hidden} more")
    }
}

fn parse_lvs_json_text(text: &str) -> Result<ParsedLvs, String> {
    let root: Value = serde_json::from_str(text).map_err(|err| err.to_string())?;
    let run_state = root
        .get("run")
        .and_then(|run| run.get("state"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let connectivity = parse_connectivity(root.get("connectivity"));
    let entities = parse_entity_anomalies(root.get("entity"));
    let groups = parse_fault_groups(root.get("violations"));
    Ok(ParsedLvs {
        run_state,
        connectivity,
        entities,
        groups,
    })
}

fn parse_connectivity(value: Option<&Value>) -> Vec<LvsConnectivityAnomaly> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let open = row.get("open")?;
            let short = row.get("short")?;
            let open_count = json_usize(open.get("count")).unwrap_or(0);
            let short_count = json_usize(short.get("count")).unwrap_or(0);
            if open_count == 0 && short_count == 0 {
                return None;
            }
            Some(LvsConnectivityAnomaly {
                name: row
                    .get("connectivity")
                    .and_then(Value::as_str)
                    .unwrap_or("Unknown connectivity")
                    .to_string(),
                total: json_usize(row.get("total")).unwrap_or(0),
                open: open_count,
                open_percentage: json_f64(open.get("percentage")).unwrap_or(0.0),
                short: short_count,
                short_percentage: json_f64(short.get("percentage")).unwrap_or(0.0),
            })
        })
        .collect()
}

fn parse_entity_anomalies(value: Option<&Value>) -> Vec<LvsEntityAnomaly> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let def_count = json_i64(row.get("def")).unwrap_or(0);
            let netlist_count = json_i64(row.get("netlist")).unwrap_or(0);
            let difference = json_i64(row.get("difference")).unwrap_or(def_count - netlist_count);
            if difference == 0 {
                return None;
            }
            Some(LvsEntityAnomaly {
                entity: row
                    .get("entity")
                    .and_then(Value::as_str)
                    .unwrap_or("Unknown entity")
                    .to_string(),
                def_count,
                netlist_count,
                difference,
            })
        })
        .collect()
}

fn parse_fault_groups(value: Option<&Value>) -> Vec<LvsFaultGroup> {
    #[derive(Default)]
    struct Accumulator {
        components: BTreeSet<usize>,
        terminal_count: usize,
        shape_count: usize,
        shapes: Vec<Rect32>,
        bbox: Option<Rect32>,
        terminal_examples: Vec<String>,
    }

    let mut groups = BTreeMap::<(String, String), Accumulator>::new();
    for violation in value.and_then(Value::as_array).into_iter().flatten() {
        let violation_type = violation
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("Unknown violation")
            .to_string();
        let net = violation
            .get("net")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let group = groups.entry((violation_type, net)).or_default();
        if let Some(components) = violation.get("components").and_then(Value::as_array) {
            group.components.extend(
                components
                    .iter()
                    .filter_map(|component| json_usize(Some(component))),
            );
        }
        if let Some(terminals) = violation.get("terminals").and_then(Value::as_array) {
            group.terminal_count += terminals.len();
            let remaining = MAX_TERMINAL_EXAMPLES.saturating_sub(group.terminal_examples.len());
            for terminal in terminals.iter().filter_map(Value::as_str).take(remaining) {
                group.terminal_examples.push(terminal.to_string());
            }
        }
        if let Some(shapes) = violation.get("shapes").and_then(Value::as_array) {
            group.shape_count += shapes.len();
            for shape in shapes {
                let Some(rect) = shape.get("rect").and_then(Value::as_array) else {
                    continue;
                };
                if rect.len() != 4 {
                    continue;
                }
                let (Some(lx), Some(ly), Some(hx), Some(hy)) = (
                    json_i32(rect.first()),
                    json_i32(rect.get(1)),
                    json_i32(rect.get(2)),
                    json_i32(rect.get(3)),
                ) else {
                    continue;
                };
                let rect = normalized_rect(lx, ly, hx, hy);
                group.shapes.push(rect);
                union_bbox(&mut group.bbox, rect);
            }
        }
    }
    groups
        .into_iter()
        .map(|((violation_type, net), group)| LvsFaultGroup {
            violation_type,
            net,
            components: group.components,
            terminal_count: group.terminal_count,
            shape_count: group.shape_count,
            shapes: group.shapes,
            bbox: group.bbox,
            terminal_examples: group.terminal_examples,
        })
        .collect()
}

fn normalized_rect(lx: i32, ly: i32, hx: i32, hy: i32) -> Rect32 {
    Rect32 {
        lx: lx.min(hx),
        ly: ly.min(hy),
        hx: lx.max(hx),
        hy: ly.max(hy),
    }
}

fn union_bbox(bbox: &mut Option<Rect32>, next: Rect32) {
    *bbox = Some(match *bbox {
        None => next,
        Some(current) => Rect32 {
            lx: current.lx.min(next.lx),
            ly: current.ly.min(next.ly),
            hx: current.hx.max(next.hx),
            hy: current.hy.max(next.hy),
        },
    });
}

fn json_usize(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn json_i32(value: Option<&Value>) -> Option<i32> {
    value
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
}

fn json_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_i64)
}

fn json_f64(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LVS_SAMPLE: &str = r#"{
        "run": {"state": "Success", "runtime_seconds": 12.0},
        "entity": [
            {"entity": "Instance", "def": 10, "netlist": 12, "difference": 2},
            {"entity": "Net", "def": 8, "netlist": 8, "difference": 0}
        ],
        "connectivity": [
            {"connectivity": "Routing", "total": 8, "open": {"count": 0, "percentage": 0}, "short": {"count": 0, "percentage": 0}},
            {"connectivity": "Power VDD", "total": 10, "open": {"count": 2, "percentage": 20.0}, "short": {"count": 1, "percentage": 10.0}}
        ],
        "violations": [
            {"type": "PowerOpenVDD", "net": "VDD", "components": [3], "terminals": ["U1/VDD", "U2/VDD"], "shapes": [{"rect": [10, 20, 30, 40]}, {"rect": [20, 30, 50, 60]}]},
            {"type": "PowerOpenVDD", "net": "VDD", "components": [4], "terminals": ["U3/VDD"], "shapes": [{"rect": [0, 5, 5, 15]}]}
        ]
    }"#;

    #[test]
    fn parses_only_lvs_anomalies_and_aggregates_fault_groups() {
        let parsed = parse_lvs_json_text(LVS_SAMPLE).unwrap();

        assert_eq!(parsed.run_state.as_deref(), Some("Success"));
        assert_eq!(
            parsed.entities,
            vec![LvsEntityAnomaly {
                entity: "Instance".to_string(),
                def_count: 10,
                netlist_count: 12,
                difference: 2,
            }]
        );
        assert_eq!(
            parsed.connectivity,
            vec![LvsConnectivityAnomaly {
                name: "Power VDD".to_string(),
                total: 10,
                open: 2,
                open_percentage: 20.0,
                short: 1,
                short_percentage: 10.0,
            }]
        );
        assert_eq!(
            parsed.groups,
            vec![LvsFaultGroup {
                violation_type: "PowerOpenVDD".to_string(),
                net: "VDD".to_string(),
                components: BTreeSet::from([3, 4]),
                terminal_count: 3,
                shape_count: 3,
                shapes: vec![
                    Rect32 {
                        lx: 10,
                        ly: 20,
                        hx: 30,
                        hy: 40,
                    },
                    Rect32 {
                        lx: 20,
                        ly: 30,
                        hx: 50,
                        hy: 60,
                    },
                    Rect32 {
                        lx: 0,
                        ly: 5,
                        hx: 5,
                        hy: 15,
                    },
                ],
                bbox: Some(Rect32 {
                    lx: 0,
                    ly: 5,
                    hx: 50,
                    hy: 60,
                }),
                terminal_examples: vec![
                    "U1/VDD".to_string(),
                    "U2/VDD".to_string(),
                    "U3/VDD".to_string(),
                ],
            }]
        );
    }

    #[test]
    fn clean_lvs_report_has_no_anomalies() {
        let parsed = parse_lvs_json_text(
            r#"{
                "run": {"state": "Success"},
                "entity": [{"entity": "Net", "def": 8, "netlist": 8, "difference": 0}],
                "connectivity": [{"connectivity": "Routing", "total": 8, "open": {"count": 0, "percentage": 0}, "short": {"count": 0, "percentage": 0}}],
                "violations": []
            }"#,
        )
        .unwrap();

        assert!(parsed.entity_anomalies().is_empty());
        assert!(parsed.connectivity.is_empty());
        assert!(parsed.groups.is_empty());
    }

    #[test]
    fn fault_group_summaries_are_bounded() {
        let parsed = parse_lvs_json_text(
            r#"{
                "violations": [{
                    "type": "PowerOpenVDD",
                    "net": "VDD",
                    "components": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                    "terminals": ["U1/VDD", "U2/VDD", "U3/VDD", "U4/VDD", "U5/VDD"],
                    "shapes": []
                }]
            }"#,
        )
        .unwrap();

        let group = &parsed.groups[0];
        assert_eq!(group.terminal_count, 5);
        assert_eq!(group.terminal_examples, vec!["U1/VDD", "U2/VDD", "U3/VDD"]);
        assert_eq!(
            component_summary(&group.components),
            "1, 2, 3, 4, 5, 6, 7, 8 +2 more"
        );
    }

    impl ParsedLvs {
        fn entity_anomalies(&self) -> &[LvsEntityAnomaly] {
            &self.entities
        }
    }
}
