//! Read the selected step's existing checklist without changing workspace data.
use crate::replay::data::{read, within};
use anyhow::{Context, Result};
use egui::Color32;
use serde::Deserialize;
use std::path::Path;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Checklist {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub blocked: bool,
    #[serde(default, rename = "checklist")]
    pub items: Vec<Item>,
    #[serde(default)]
    reason: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Item {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub step: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub blocked: bool,
    #[serde(default)]
    pub summary: String,
}

impl Item {
    pub fn is_blocked(&self) -> bool {
        self.blocked || self.state.eq_ignore_ascii_case("blocked")
    }
}

#[derive(Deserialize)]
struct Flow {
    steps: Vec<Step>,
}
#[derive(Deserialize)]
struct Step {
    name: String,
    checklist_status: Option<Projection>,
    checklist: Option<Vec<Item>>,
}
#[derive(Deserialize)]
struct Projection {
    #[serde(default)]
    status: String,
    #[serde(default)]
    blocked: bool,
    source: Option<String>,
}

pub fn load(workspace: &Path, step_name: &str) -> Result<Checklist> {
    let flow: Flow = read(&within(workspace, &workspace.join("home/flow.json"))?)?;
    let step = flow
        .steps
        .into_iter()
        .find(|step| step.name == step_name)
        .context("Step is missing from the workspace flow")?;
    if let Some(source) = step
        .checklist_status
        .as_ref()
        .and_then(|status| status.source.as_ref())
    {
        // Containment failures are errors, not a reason to show a green fallback.
        let path = workspace.join(source);
        if path.exists() {
            let mut checklist: Checklist = read(&within(workspace, &path)?)?;
            checklist
                .items
                .retain(|item| item.step.is_empty() || item.step == step_name);
            checklist.blocked |= step.checklist_status.as_ref().is_some_and(|status| {
                status.blocked || status.status.eq_ignore_ascii_case("blocked")
            });
            return Ok(checklist);
        }
    }
    let mut checklist = Checklist::default();
    if let Some(status) = step.checklist_status {
        checklist.status = status.status;
        checklist.blocked = status.blocked;
    }
    if let Some(items) = step.checklist {
        checklist.items = items
            .into_iter()
            .filter(|item| item.step.is_empty() || item.step == step_name)
            .collect();
    } else {
        let path = workspace.join("home/checklist.json");
        if path.exists() {
            let document: Checklist = read(&within(workspace, &path)?)?;
            // Workspace-wide blocked status must not color another step red.
            checklist.items = document
                .items
                .into_iter()
                .filter(|item| item.step == step_name)
                .collect();
        }
    }
    Ok(checklist)
}

fn color(blocked: bool) -> Color32 {
    if blocked {
        Color32::from_rgb(244, 104, 104)
    } else {
        Color32::from_rgb(93, 207, 143)
    }
}

impl Checklist {
    pub fn from_recording(
        recording: &crate::replay::data::Recording,
        workspace: &Path,
        step_name: &str,
    ) -> Result<Self> {
        if let Some(value) = &recording.manifest.result_checklist {
            return Ok(serde_json::from_value(value.clone())?);
        }
        if recording.manifest.results_frozen {
            return Ok(Self {
                status: "unavailable".into(),
                reason: "No checklist captured for this attempt".into(),
                ..Self::default()
            });
        }
        load(workspace, step_name)
    }

    pub fn show(&self, ui: &mut egui::Ui) {
        if !self.reason.is_empty() {
            ui.small(&self.reason);
        }
        let blocked = self.blocked
            || self.status.eq_ignore_ascii_case("blocked")
            || self.items.iter().any(Item::is_blocked);
        if !self.status.is_empty() || !self.items.is_empty() {
            let status = if blocked {
                "blocked"
            } else if self.status.is_empty() {
                "not blocked"
            } else {
                &self.status
            };
            ui.colored_label(
                color(blocked),
                format!("{status} · {} items", self.items.len()),
            );
        }
        if self.items.is_empty() {
            ui.small("No checklist items recorded for this step.");
        }
        egui::ScrollArea::vertical()
            .id_salt("replay_checklist_items")
            .show(ui, |ui| {
                for item in &self.items {
                    ui.colored_label(color(item.is_blocked()), &item.title)
                        .on_hover_text(&item.summary);
                    ui.small(if item.is_blocked() {
                        format!("blocked · {}", item.state)
                    } else {
                        item.state.clone()
                    });
                }
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::data::tests::Fixture;
    use serde_json::json;

    #[test]
    fn advisory_and_unavailable_are_green_unless_explicitly_blocked() {
        let items: Vec<Item> = serde_json::from_value(json!([
            {"state":"warning","blocked":false},
            {"state":"unavailable","blocked":false},
            {"state":"failed","blocked":false},
            {"state":"unavailable","blocked":true},
            {"state":"blocked"}
        ]))
        .unwrap();
        assert_eq!(
            items.iter().map(Item::is_blocked).collect::<Vec<_>>(),
            [false, false, false, true, true]
        );
        assert_ne!(color(false), color(true));
    }

    #[test]
    fn reads_step_report_and_filters_workspace_fallback_by_exact_name() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.0.join("home")).unwrap();
        fixture.write(
            "home/flow.json",
            json!({"steps":[
            {"name":"place","checklist_status":{"source":"step-checklist.json","status":"passed"}},
            {"name":"CTS"}]}),
        );
        fixture.write(
            "step-checklist.json",
            json!({"status":"ready","checklist":[
            {"step":"place","title":"Placement","state":"warning","blocked":false}]}),
        );
        fixture.write(
            "home/checklist.json",
            json!({"status":"blocked","checklist":[
            {"step":"place","title":"Other step","blocked":true},
            {"step":"CTS","title":"Clock check","blocked":false,"state":"pass"}]}),
        );
        let place = load(&fixture.0, "place").unwrap();
        assert_eq!(
            place
                .items
                .iter()
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>(),
            ["Placement"]
        );
        let cts = load(&fixture.0, "CTS").unwrap();
        assert!(!cts.blocked);
        assert_eq!(
            cts.items
                .iter()
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>(),
            ["Clock check"]
        );
    }

    #[test]
    fn refuses_report_paths_outside_workspace() {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        std::fs::create_dir_all(fixture.0.join("home")).unwrap();
        fixture.write(
            "home/flow.json",
            json!({"steps":[{"name":"place",
            "checklist_status":{"source":outside.0.join("manifest.json")}}]}),
        );
        assert!(load(&fixture.0, "place")
            .unwrap_err()
            .to_string()
            .contains("escapes"));
    }

    #[test]
    fn frozen_checklist_does_not_read_mutable_workspace_results() {
        let fixture = Fixture::new();
        let mut recording = fixture.open();
        recording.manifest.results_frozen = true;
        recording.manifest.result_checklist = Some(json!({"status":"blocked", "checklist":[
            {"title":"Original check", "blocked":true}
        ]}));
        let checklist = Checklist::from_recording(&recording, &fixture.0, "place").unwrap();
        assert_eq!(checklist.status, "blocked");
        assert_eq!(checklist.items[0].title, "Original check");
        recording.manifest.result_checklist = None;
        let missing = Checklist::from_recording(&recording, &fixture.0, "place").unwrap();
        assert_eq!(missing.status, "unavailable");
    }
}
