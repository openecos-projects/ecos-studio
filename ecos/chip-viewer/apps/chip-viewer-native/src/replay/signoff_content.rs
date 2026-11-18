//! Sectioned design, quality and checklist bodies.
use super::{widgets::*, SignoffSummary};
use crate::replay::dashboard::signoff_report::{Check, Field, Section};
use std::collections::BTreeMap;

pub fn design(ui: &mut egui::Ui, s: &SignoffSummary) {
    if !s.details.design_error.is_empty() {
        notice(
            ui,
            "Design details unavailable",
            &s.details.design_error,
            "unavailable",
        );
    }
    if s.details.design.is_empty() {
        return;
    }
    let fields: Vec<_> = s.details.design.iter().flat_map(|s| &s.fields).collect();
    let find = |name: &str| fields.iter().find(|f| f.label == name).copied();
    let get = |name: &str| find(name).map_or("N/A", |f| f.value.as_str());
    heading(ui, "01  PHYSICAL & AREA");
    for name in [
        "Die Area",
        "Core Area",
        "Standard Cell Area",
        "Core Utilization",
        "Total Instances",
        "Sequential / Comb. Cells",
    ] {
        if let Some(f) = find(name) {
            report_field(ui, f);
        }
    }
    row(
        ui,
        "IO pins / nets",
        &format!("{} / {}", get("IO Pins"), get("Total Nets")),
        TEXT,
    );
    heading(ui, "02  TIMING & CLOCK");
    for name in [
        "Target Clock Period",
        "Achieved Fmax",
        "Setup Slack (WNS / TNS)",
        "Hold Slack (WNS / TNS)",
        "Critical Path Delay",
        "Violating Endpoints (Setup/Hold)",
    ] {
        if let Some(f) = find(name) {
            report_field(ui, f);
        }
    }
    row(
        ui,
        "Clock depth / buffers",
        &format!("{} / {}", get("Clock Tree Depth"), get("Clock Buffers")),
        TEXT,
    );
    if let Some(corners) = s
        .details
        .design
        .iter()
        .find(|s| !s.rows.is_empty() && s.columns.first().is_some_and(|c| c == "Corner"))
    {
        let passed = corners
            .rows
            .iter()
            .filter(|r| r.last().is_some_and(|v| v == "PASS"))
            .count();
        row(
            ui,
            "Multi-corner timing",
            &format!("{passed} / {} PASS", corners.rows.len()),
            if passed == corners.rows.len() {
                TEAL
            } else {
                AMBER
            },
        );
    }
    heading(ui, "03  ROUTING & POWER");
    for name in ["Routed Wirelength", "HPWL"] {
        if let Some(f) = find(name) {
            report_field(ui, f);
        }
    }
    row(
        ui,
        "Vias / route overflow",
        &format!("{} / {}", get("Via Count"), get("Global Route Overflow")),
        TEXT,
    );
    row(ui, "Total power", get("Total Power"), TEAL);
    row(
        ui,
        "Dynamic / leakage",
        &format!("{} / {}", get("Dynamic Power"), get("Leakage Power")),
        TEXT,
    );
    heading(ui, "04  VERIFICATION & EXECUTION");
    for name in [
        "DRC Status",
        "LVS Status",
        "Total Runtime",
        "Peak Memory Usage",
    ] {
        if let Some(f) = find(name) {
            report_field(ui, f);
        }
    }
    heading(ui, "05  FULL DESIGN REPORT");
    for section in &s.details.design {
        if section.fields.is_empty() {
            continue;
        }
        heading(ui, &section.title);
        for f in &section.fields {
            report_field(ui, f);
        }
    }
    for section in &s.details.design {
        if section.rows.is_empty() {
            continue;
        }
        heading(ui, &section.title);
        report_table(ui, section);
    }
}
fn report_field(ui: &mut egui::Ui, f: &Field) {
    let tone = if f.note == "PASS" || f.note == "TIMING MET" {
        TEAL
    } else if matches!(f.note.as_str(), "FAIL" | "VIOLATION") {
        RED
    } else {
        TEXT
    };
    row(ui, &f.label, &f.value, tone);
    if f.note.starts_with("Target freq:") {
        text(ui, &f.note, 15.0, LABEL);
    }
}
fn report_table(ui: &mut egui::Ui, table: &Section) {
    // A record layout keeps all columns readable even in narrow cards. The
    // first column identifies the record; remaining columns keep their labels.
    for (index, values) in table.rows.iter().enumerate() {
        ui.push_id(index, |ui| {
            egui::Frame::NONE
                .fill(egui::Color32::from_rgb(17, 41, 58))
                .corner_radius(5)
                .inner_margin(9)
                .show(ui, |ui| {
                    text(ui, &values[0], 17.0, CYAN);
                    for (label, value) in table.columns.iter().zip(values).skip(1) {
                        row(
                            ui,
                            label,
                            value,
                            if matches!(label.as_str(), "State" | "Status") {
                                color(value)
                            } else {
                                TEXT
                            },
                        );
                    }
                });
            ui.add_space(7.0);
        });
    }
}

pub fn qor(ui: &mut egui::Ui, s: &SignoffSummary) {
    row(ui, "Profile", &s.details.profile, TEXT);
    notice(
        ui,
        "Physical feasibility",
        &s.qor.gate_summary,
        &s.qor.feasibility_status,
    );
    heading(ui, "01  QUALITY BREAKDOWN");
    if s.details.quality.is_empty() {
        text(ui, "Quality breakdown unavailable", 16.0, LABEL);
    }
    for q in &s.details.quality {
        row(
            ui,
            &q.label,
            &q.score
                .map_or_else(|| "N/A".into(), |v| format!("{v:.1} / 100")),
            color(&q.state),
        );
        if let Some(score) = q.score {
            ui.add(
                egui::ProgressBar::new(score as f32 / 100.0)
                    .fill(color(&q.state))
                    .desired_height(5.0),
            );
        } else {
            ui.add(egui::ProgressBar::new(0.0).fill(LABEL).desired_height(5.0));
        }
        text(ui, value(&q.state), 14.0, color(&q.state));
        if q.label == "Power" && q.score.is_none() {
            text(
                ui,
                "Power score unavailable; check the report's power budget and evidence.",
                15.0,
                LABEL,
            );
        }
        ui.add_space(8.0);
    }
    heading(ui, "02  EVIDENCE QUALITY");
    for e in &s.details.evidence {
        row(
            ui,
            &e.label,
            &e.value,
            if e.label == "Evidence state" {
                color(&e.value)
            } else {
                TEXT
            },
        );
    }
    heading(ui, "03  DIAGNOSES");
    if s.details.diagnoses.is_empty() {
        text(ui, "No diagnoses recorded", 16.0, LABEL);
    }
    for d in &s.details.diagnoses {
        notice(ui, &d.title, &d.explanation, &d.state);
        text(
            ui,
            &format!("Diagnosis confidence: {}", value(&d.confidence)),
            14.0,
            LABEL,
        );
    }
    heading(ui, "04  PRIORITIZED ACTIONS");
    let mut actions: Vec<_> = s
        .details
        .diagnoses
        .iter()
        .flat_map(|d| &d.actions)
        .collect();
    actions.sort_by(|a, b| a.label.cmp(&b.label));
    if actions.is_empty() {
        text(ui, "No intervention hypotheses recorded", 16.0, LABEL);
    }
    for (index, a) in actions.iter().enumerate() {
        text(ui, &format!("{}. {}", index + 1, a.label), 15.0, CYAN);
        text(ui, &a.value, 16.0, TEXT);
        text(ui, &a.note, 14.0, LABEL);
        ui.add_space(9.0);
    }
    heading(ui, "05  PHYSICAL SIGNOFF GATES");
    for g in &s.details.gates {
        row(
            ui,
            &g.label.replace("GATE_", "").replace('_', " "),
            &g.value,
            color(&g.value),
        );
        text(ui, &g.note, 14.0, LABEL);
    }
    let notes: Vec<_> = s.details.quality.iter().flat_map(|q| &q.notes).collect();
    if !notes.is_empty() {
        heading(ui, "06  REPORT COMPATIBILITY");
        for note in notes {
            text(ui, note, 16.0, LABEL);
        }
    }
}

fn check_color(c: &Check) -> egui::Color32 {
    if c.blocked {
        RED
    } else {
        color(&c.state)
    }
}
fn group_counts(checks: &[&Check]) -> [usize; 4] {
    let mut counts = [0; 4];
    for c in checks {
        let index = if c.blocked || c.state == "blocked" {
            2
        } else if matches!(c.state.as_str(), "pass" | "passed") {
            0
        } else if c.state == "unavailable" {
            3
        } else {
            1
        };
        counts[index] += 1;
    }
    counts
}
pub fn checklist(ui: &mut egui::Ui, s: &SignoffSummary) {
    let c = &s.checklist;
    let columns = if ui.available_width() >= 440.0 { 4 } else { 2 };
    ui.columns(columns, |cols| {
        for (i, (label, number, tone)) in [
            ("PASSED", c.passed, TEAL),
            ("ATTENTION", c.attention, AMBER),
            ("BLOCKED", c.blocked, RED),
            ("UNAVAILABLE", c.unavailable, LABEL),
        ]
        .into_iter()
        .enumerate()
        {
            let ui = &mut cols[i % columns];
            let frame = egui::Frame::NONE
                .fill(egui::Color32::from_rgb(20, 43, 61))
                .corner_radius(6)
                .inner_margin(8);
            let width = ui.available_width() - frame.total_margin().sum().x;
            frame.show(ui, |ui| {
                ui.set_width(width);
                text(ui, &count(number), 26.0, tone);
                text(ui, &label.to_ascii_lowercase(), 12.0, TEXT);
            });
            ui.add_space(5.0);
        }
    });
    heading(ui, "01  REQUIRES REVIEW");
    let attention: Vec<_> = s
        .details
        .checks
        .iter()
        .filter(|c| !matches!(c.state.as_str(), "pass" | "passed") || c.blocked)
        .collect();
    if attention.is_empty() {
        text(
            ui,
            if s.details.checks.is_empty() {
                "Checklist details unavailable"
            } else {
                "No recorded checks require review"
            },
            16.0,
            LABEL,
        );
    }
    for c in attention {
        notice(
            ui,
            &format!("{} / {}", c.step, c.title),
            &c.summary,
            if c.blocked { "blocked" } else { &c.state },
        );
    }
    heading(ui, "02  CHECKS BY STEP");
    text(
        ui,
        "Passed / Attention / Blocked / Unavailable",
        14.0,
        LABEL,
    );
    let mut groups: BTreeMap<&str, Vec<&Check>> = BTreeMap::new();
    for c in &s.details.checks {
        groups.entry(&c.step).or_default().push(c);
    }
    for (name, checks) in &groups {
        let [pass, attention, blocked, unavailable] = group_counts(checks);
        row(
            ui,
            name,
            &format!("{pass} / {attention} / {blocked} / {unavailable}"),
            if blocked > 0 {
                RED
            } else if attention + unavailable > 0 {
                AMBER
            } else {
                TEAL
            },
        );
    }
    heading(ui, "03  HARDEN DELIVERABLES");
    let deliveries: Vec<_> = s
        .details
        .checks
        .iter()
        .filter(|c| c.step.eq_ignore_ascii_case("harden") && c.category == "artifact")
        .collect();
    if deliveries.is_empty() {
        text(ui, "No Harden artifacts recorded", 16.0, LABEL);
    }
    for c in deliveries {
        row(ui, &c.title, &c.state, check_color(c));
    }
    heading(
        ui,
        &format!("04  FULL CHECKLIST · {} ITEMS", s.details.checks.len()),
    );
    text(
        ui,
        &format!("Revision: {}", value(&s.details.revision)),
        14.0,
        LABEL,
    );
    for (i, c) in s.details.checks.iter().enumerate() {
        ui.push_id(i, |ui| {
            ui.add_space(10.0);
            text(ui, &format!("{} / {}", c.step, c.category), 14.0, CYAN);
            row(ui, &c.title, &c.state, check_color(c));
            text(ui, &c.summary, 15.0, LABEL);
            for e in &c.evidence {
                text(ui, &format!("Evidence: {e}"), 14.0, LABEL);
            }
            ui.separator();
        });
    }
}
