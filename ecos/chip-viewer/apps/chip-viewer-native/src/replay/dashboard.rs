//! Final QoR and flow-wide checklist, loaded once outside the render thread.
use crate::replay::checklist::{Checklist, Item};
use crate::replay::data::{read, within, Catalog, Recording};
use crate::replay::widgets::{CheckMark, SelectionFollow};
use egui::{Color32, RichText};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::mpsc,
    time::SystemTime,
};

#[derive(Default)]
pub struct Dashboard {
    pub score: Option<f64>,
    pub score_status: String,
    pub signoff: SignoffSummary,
    pub groups: Vec<Group>,
    pub errors: Vec<String>,
    watches: Vec<Watch>,
    pub stale: bool,
    unavailable_steps: BTreeSet<usize>,
    follow: SelectionFollow,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SignoffSummary {
    pub design: DesignSummary,
    pub qor: QorSummary,
    pub checklist: ChecklistSummary,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DesignSummary {
    pub name: String,
    pub top_module: String,
    pub pdk: String,
    pub harden_state: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct QorSummary {
    pub score: Option<f64>,
    pub scalar_status: String,
    pub feasibility_status: String,
    pub gate_summary: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChecklistSummary {
    pub status: String,
    pub passed: Option<usize>,
    pub attention: Option<usize>,
    pub blocked: Option<usize>,
    pub unavailable: Option<usize>,
}
pub struct Group {
    pub name: String,
    pub step: Option<usize>,
    pub items: Vec<Item>,
}
#[derive(Debug, PartialEq)]
struct Stamp {
    resolved: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
}
struct Watch {
    path: PathBuf,
    stamp: Option<Stamp>,
}
fn stamp(path: &Path) -> Option<Stamp> {
    let m = path.metadata().ok()?;
    Some(Stamp {
        resolved: path.canonicalize().ok()?,
        size: m.len(),
        modified: m.modified().ok(),
    })
}

pub fn prepare(catalog: &Catalog) -> mpsc::Receiver<Dashboard> {
    let (sender, receiver) = mpsc::channel();
    let workspace = catalog.workspace.clone();
    let steps: Vec<_> = catalog
        .steps
        .iter()
        .map(|s| (s.name.clone(), s.manifest.clone()))
        .collect();
    std::thread::spawn(move || {
        let _ = sender.send(Dashboard::load(&workspace, &steps));
    });
    receiver
}
impl Dashboard {
    fn watch(&mut self, path: PathBuf) {
        self.watches.push(Watch {
            stamp: stamp(&path),
            path,
        });
    }
    pub fn check_current(&mut self) {
        self.stale |= self.watches.iter().any(|w| stamp(&w.path) != w.stamp);
    }
    pub fn load(workspace: &Path, steps: &[(String, Option<PathBuf>)]) -> Self {
        let mut data = Self::default();
        for name in [
            "home/flow.json",
            "home/checklist.json",
            "home/qor_report.json",
            "home/engineering-snapshot.json",
        ] {
            data.watch(workspace.join(name));
        }
        let flow = match optional(workspace, "home/flow.json") {
            Ok(value) => value,
            Err(error) => {
                data.errors.push(format!("Flow: {error}"));
                None
            }
        };
        let report = optional(workspace, "home/qor_report.json");
        let mut report_matches_flow = true;
        match &report {
            Ok(Some(report)) => {
                data.score = final_score(report);
                data.score_status = report["scalar_summary"]["status"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
                if let Some(flow) = &flow {
                    if let (Some(saved), Some(current)) =
                        (report["flow_steps"].as_object(), flow["steps"].as_array())
                    {
                        let current: BTreeMap<_, _> = current
                            .iter()
                            .filter_map(|s| Some((s["name"].as_str()?, &s["state"])))
                            .collect();
                        if saved.len() != current.len()
                            || current
                                .iter()
                                .any(|(name, state)| saved.get(*name) != Some(*state))
                        {
                            data.score = None;
                            report_matches_flow = false;
                            data.errors
                                .push("QoR report does not match the current flow".into());
                        }
                    }
                }
            }
            Err(error) => data.errors.push(format!("QoR: {error}")),
            _ => {}
        }
        let snapshot = match optional(workspace, "home/engineering-snapshot.json") {
            Ok(value) => value,
            Err(error) => {
                data.errors.push(format!("Design: {error}"));
                None
            }
        };
        let checklist = match optional(workspace, "home/checklist.json") {
            Ok(value) => value,
            Err(error) => {
                data.errors.push(format!("Checklist: {error}"));
                None
            }
        };
        data.signoff = SignoffSummary::load(
            report.as_ref().ok().and_then(Option::as_ref),
            flow.as_ref(),
            snapshot.as_ref(),
            checklist.as_ref(),
        );
        if !report_matches_flow {
            data.signoff.qor = QorSummary::default();
        }
        let mut items: BTreeMap<(String, String), Item> = BTreeMap::new();
        match checklist {
            Some(value) => match serde_json::from_value::<Checklist>(value) {
                Ok(checklist) => merge(&mut items, checklist.items, None),
                Err(error) => data.errors.push(format!("Checklist: {error}")),
            },
            _ => {}
        }
        for (step_index, (name, path)) in steps.iter().enumerate() {
            let Some(path) = path else {
                continue;
            };
            data.watch(path.clone());
            let loaded = (|| -> anyhow::Result<Checklist> {
                let record = Recording::open(workspace, path)?;
                data.watch(record.current_pointer().to_owned());
                record.check_current()?;
                Checklist::from_recording(&record, workspace, name)
            })();
            match loaded {
                Ok(checklist) => merge(&mut items, checklist.items, Some(name)),
                Err(error) => {
                    data.unavailable_steps.insert(step_index);
                    data.errors.push(format!("{name}: {error}"));
                }
            }
        }
        // Module order follows this workspace's actual flow, including custom flows.
        for (index, (name, _)) in steps.iter().enumerate() {
            let keys: Vec<_> = items
                .keys()
                .filter(|(step, _)| step == name)
                .cloned()
                .collect();
            let group = Group {
                name: name.clone(),
                step: Some(index),
                items: keys.into_iter().filter_map(|k| items.remove(&k)).collect(),
            };
            if !group.items.is_empty() {
                data.groups.push(group);
            }
        }
        for ((module, _), item) in items {
            let name = if module.is_empty() || module == "workspace" {
                "Workspace".to_owned()
            } else {
                module
            };
            if let Some(group) = data
                .groups
                .iter_mut()
                .find(|g| g.step.is_none() && g.name == name)
            {
                group.items.push(item);
            } else {
                data.groups.push(Group {
                    name,
                    step: None,
                    items: vec![item],
                });
            }
        }
        data.check_current();
        data
    }
    pub fn show(&mut self, ui: &mut egui::Ui, step: usize, complete: bool, last: bool) {
        let invalid = self.stale;
        let follow = self
            .follow
            .changed(ui.id(), (step, complete, last, invalid));
        let current = self
            .groups
            .iter()
            .rposition(|g| g.step.is_some_and(|i| i <= step));
        ui.horizontal(|ui| {
            ui.strong("QoR SCORE");
            ui.weak("FINAL");
        });
        ui.horizontal(|ui| {
            let text = if invalid {
                "—".into()
            } else {
                self.score.map_or("—".into(), |s| format!("{s:.1}"))
            };
            ui.label(
                RichText::new(text)
                    .size(34.0)
                    .color(Color32::from_rgb(119, 219, 203)),
            );
            ui.weak("/ 100");
        });
        ui.small(if invalid {
            "Results changed. Reopen Replay."
        } else if self.score.is_none() {
            "Final score unavailable"
        } else {
            "Final workspace score · fixed during replay"
        });
        if !self.score_status.is_empty() && !invalid {
            ui.small(&self.score_status);
        }
        ui.separator();
        let total: usize = self.groups.iter().map(|g| g.items.len()).sum();
        let revealed: usize = self
            .groups
            .iter()
            .filter(|g| {
                !invalid
                    && !g.step.is_some_and(|i| self.unavailable_steps.contains(&i))
                    && g.revealed(step, complete, last)
            })
            .map(|g| g.items.len())
            .sum();
        ui.horizontal(|ui| {
            ui.strong("Checklist");
            ui.weak(format!("{revealed} / {total}"));
        });
        egui::ScrollArea::vertical()
            .id_salt("replay_all_checks")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                if total == 0 {
                    ui.weak("No checklist items recorded");
                }
                for (index, group) in self.groups.iter().enumerate() {
                    let unavailable = group
                        .step
                        .is_some_and(|i| self.unavailable_steps.contains(&i));
                    let ready = !invalid && !unavailable && group.revealed(step, complete, last);
                    let active = current == Some(index);
                    let response = egui::CollapsingHeader::new(
                        RichText::new(format!(
                            "{} · {}/{}",
                            group.name,
                            if ready { group.items.len() } else { 0 },
                            group.items.len()
                        ))
                        .color(if active {
                            Color32::from_rgb(119, 219, 203)
                        } else {
                            ui.visuals().text_color()
                        }),
                    )
                    .id_salt(("check_module", index))
                    .default_open(true)
                    .open((follow && active).then_some(true))
                    .show(ui, |ui| {
                        for item in &group.items {
                            let mark = CheckMark::for_item(item, ready);
                            let color = mark.color();
                            let response = ui
                                .horizontal_top(|ui| {
                                    mark.paint(ui);
                                    ui.colored_label(color, &item.title)
                                })
                                .inner;
                            if ready {
                                response.on_hover_text(&item.summary);
                                ui.label(RichText::new(&item.state).small().color(color));
                            } else {
                                ui.weak(if invalid {
                                    "Result no longer current"
                                } else if group.step == Some(step) {
                                    "Awaiting completion"
                                } else {
                                    "Not reached"
                                });
                            }
                        }
                    });
                    if follow && active {
                        response
                            .header_response
                            .scroll_to_me(Some(egui::Align::Min));
                    }
                }
                if !self.errors.is_empty() {
                    ui.collapsing("Unavailable reports", |ui| {
                        for error in &self.errors {
                            ui.small(error);
                        }
                    });
                }
            });
    }

    pub fn show_signoff_cards(&self, ctx: &egui::Context) {
        let _ = crate::replay::signoff_cards::show(ctx, &self.signoff);
    }
}

impl SignoffSummary {
    fn load(
        report: Option<&Value>,
        flow: Option<&Value>,
        snapshot: Option<&Value>,
        checklist: Option<&Value>,
    ) -> Self {
        let mut summary = Self {
            qor: report.map(QorSummary::from_report).unwrap_or_default(),
            design: DesignSummary::from_snapshot(snapshot, flow),
            checklist: checklist
                .map(ChecklistSummary::from_checklist)
                .unwrap_or_default(),
        };
        if summary.design.name.is_empty() {
            summary.design.name = report
                .and_then(|value| value.get("design"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
        }
        summary
    }
}

impl DesignSummary {
    fn from_snapshot(snapshot: Option<&Value>, flow: Option<&Value>) -> Self {
        let parameters = snapshot
            .and_then(|value| value.get("parameters"))
            .and_then(Value::as_object);
        let design = parameters
            .and_then(|value| value.get("design"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let top_module = parameters
            .and_then(|value| value.get("top_module"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let pdk = parameters
            .and_then(|value| value.get("pdk"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let harden_state = flow
            .and_then(|value| value.get("steps"))
            .and_then(Value::as_array)
            .and_then(|steps| {
                steps.iter().find(|step| {
                    step.get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name.eq_ignore_ascii_case("harden"))
                })
            })
            .and_then(|step| step.get("state"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        Self {
            name: design.to_owned(),
            top_module: top_module.to_owned(),
            pdk: pdk.to_owned(),
            harden_state,
        }
    }
}

impl QorSummary {
    fn from_report(report: &Value) -> Self {
        let score = final_score(report);
        let scalar_status = report
            .get("scalar_summary")
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let feasibility_status = report
            .get("feasibility")
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let mut passed = 0;
        let mut attention = 0;
        let mut blocked = 0;
        let mut unavailable = 0;
        let mut gate_summary = String::new();
        if let Some(gates) = report
            .get("feasibility")
            .and_then(|value| value.get("gates"))
            .and_then(Value::as_array)
        {
            for gate in gates {
                let state = gate.get("state").and_then(Value::as_str).unwrap_or("");
                match state.to_ascii_lowercase().as_str() {
                    "passed" | "pass" => passed += 1,
                    "warning" | "attention" => attention += 1,
                    "failed" | "blocked" | "fail" => blocked += 1,
                    _ => unavailable += 1,
                }
            }
            if !gates.is_empty() {
                gate_summary = format!("{passed} pass · {attention} attention · {blocked} blocked");
                if unavailable > 0 {
                    gate_summary.push_str(&format!(" · {unavailable} unavailable"));
                }
            }
        }
        Self {
            score,
            scalar_status,
            feasibility_status,
            gate_summary,
        }
    }
}

impl ChecklistSummary {
    fn from_checklist(checklist: &Value) -> Self {
        let summary = checklist.get("summary").and_then(Value::as_object);
        // ECC's summary accounts for each check's blocking policy. Do not infer
        // it from state alone: an advisory failed check is not a blocking check.
        let count = |key: &str| {
            summary
                .and_then(|value| value.get(key))
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
        };
        Self {
            status: checklist
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            passed: count("passed"),
            attention: count("attention"),
            blocked: count("blocked"),
            unavailable: count("unavailable"),
        }
    }
}
impl Group {
    pub fn revealed(&self, step: usize, complete: bool, last: bool) -> bool {
        match self.step {
            Some(index) => index < step || index == step && complete,
            None => last && complete,
        }
    }
}
fn optional(workspace: &Path, name: &str) -> anyhow::Result<Option<Value>> {
    let path = workspace.join(name);
    if !path.try_exists()? {
        return Ok(None);
    }
    Ok(Some(read(&within(workspace, &path)?)?))
}
fn merge(items: &mut BTreeMap<(String, String), Item>, incoming: Vec<Item>, step: Option<&str>) {
    for mut item in incoming {
        if item.step.is_empty() {
            item.step = step.unwrap_or("workspace").into();
        }
        if step.is_some_and(|s| s != item.step) {
            continue;
        }
        let identity = if item.id.is_empty() {
            &item.title
        } else {
            &item.id
        };
        items.insert((item.step.clone(), identity.clone()), item);
    }
}
fn final_score(report: &Value) -> Option<f64> {
    report["scalar_summary"]["score"]
        .as_f64()
        .filter(|s| s.is_finite() && (0.0..=100.0).contains(s))
}

#[cfg(test)]
#[path = "dashboard_tests.rs"]
mod tests;
