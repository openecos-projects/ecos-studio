//! Process evidence is browsable without treating candidate masters as geometry.
use serde_json::Value;
use std::collections::BTreeMap;

pub fn show(ui: &mut egui::Ui, metrics: &BTreeMap<String, Value>) {
    egui::ScrollArea::vertical()
        .id_salt("replay_process_evidence")
        .max_height(260.0)
        .show(ui, |ui| {
            for (key, value) in metrics {
                if key == "geometry"
                    && matches!(value.as_str(), Some("box_owner_union" | "selected_tracks"))
                {
                    continue;
                }
                let label = match key.as_str() {
                    "active_boxes" => "Active regions",
                    "boxes" => "Partition regions",
                    "violation_evaluation" => "Violation check",
                    "conflicting_nets_before" => "Conflicting nets before reroute",
                    "iteration" => "Iteration",
                    _ => key,
                };
                if key == "decisions" {
                    if let Some(rows) = value.as_array() {
                        ui.collapsing(format!("Sizing decisions · {}", rows.len()), |ui| {
                            ui.small("Candidate decisions; layout shows the last committed state.");
                            for row in rows {
                                let name = row["instance"].as_str().unwrap_or("?");
                                let before = row["before"].as_str().unwrap_or("?");
                                let proposed = row["proposed"].as_str().unwrap_or("?");
                                let accepted = row["accepted"].as_bool() == Some(true);
                                ui.colored_label(
                                    if accepted {
                                        egui::Color32::LIGHT_GREEN
                                    } else {
                                        egui::Color32::LIGHT_YELLOW
                                    },
                                    format!(
                                        "{name}: {before} → {proposed} · {}",
                                        if accepted { "accepted" } else { "reverted" }
                                    ),
                                );
                            }
                        });
                        continue;
                    }
                }
                if value.is_array() || value.is_object() {
                    ui.collapsing(key, |ui| {
                        ui.monospace(serde_json::to_string_pretty(value).unwrap_or_default());
                    });
                } else {
                    ui.label(format!(
                        "{label}: {}",
                        value
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| value.to_string())
                    ));
                }
            }
        });
}
