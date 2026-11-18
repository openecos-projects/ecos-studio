//! Read existing ECC report fields without invoking tools or changing a workspace.
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ReportDetails {
    pub design: Vec<Section>,
    pub design_error: String,
    pub profile: String,
    pub evidence: Vec<Field>,
    pub quality: Vec<Quality>,
    pub diagnoses: Vec<Diagnosis>,
    pub gates: Vec<Field>,
    pub checks: Vec<Check>,
    pub revision: String,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Section {
    pub title: String,
    pub fields: Vec<Field>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Field {
    pub label: String,
    pub value: String,
    pub note: String,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Quality {
    pub label: String,
    pub score: Option<f64>,
    pub state: String,
    pub notes: Vec<String>,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Diagnosis {
    pub title: String,
    pub state: String,
    pub confidence: String,
    pub explanation: String,
    pub actions: Vec<Field>,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Check {
    pub step: String,
    pub category: String,
    pub title: String,
    pub state: String,
    pub blocked: bool,
    pub summary: String,
    pub evidence: Vec<String>,
}
pub fn string(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_owned()
}
fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}

impl ReportDetails {
    pub fn load(qor: Option<&Value>, checklist: Option<&Value>) -> Self {
        let mut result = Self::default();
        if let Some(qor) = qor {
            result.profile = string(&qor["scalar_summary"], "profile");
            result.evidence.push(Field {
                label: "Evidence state".into(),
                value: string(&qor["evidence"], "state"),
                ..Default::default()
            });
            for key in ["integrity", "coverage", "consistency"] {
                let value = qor["evidence"][key]
                    .as_f64()
                    .filter(|n| (0.0..=1.0).contains(n))
                    .map_or_else(|| "N/A".into(), |n| format!("{:.0}%", n * 100.0));
                result.evidence.push(Field {
                    label: key.into(),
                    value,
                    ..Default::default()
                });
            }
            for (key, label) in [
                ("timing", "Timing"),
                ("interconnect", "Interconnect"),
                ("area", "Area efficiency"),
                ("power", "Power"),
                ("robustness", "Robustness"),
            ] {
                let record = &qor["qor_record"][key];
                let mut notes = Vec::new();
                for feature in array(&record["features"]) {
                    if let Some(note) = feature["compatibility"]["assumptions"].as_str() {
                        if !notes.iter().any(|n| n == note) {
                            notes.push(note.to_owned());
                        }
                    }
                }
                result.quality.push(Quality {
                    label: label.into(),
                    score: record["value"]
                        .as_f64()
                        .filter(|n| (0.0..=100.0).contains(n)),
                    state: string(record, "state"),
                    notes,
                });
            }
            for gate in array(&qor["feasibility"]["gates"]) {
                result.gates.push(Field {
                    label: string(gate, "id"),
                    value: string(gate, "state"),
                    note: string(gate, "predicate"),
                });
            }
            for diag in array(&qor["diagnoses"]) {
                result.diagnoses.push(Diagnosis {
                    title: string(diag, "diagnosis_id")
                        .trim_start_matches("diag.")
                        .replace(['.', '_'], " "),
                    state: string(diag, "state"),
                    confidence: string(diag, "diagnosis_confidence"),
                    explanation: string(diag, "interpretation"),
                    actions: array(&diag["interventions"])
                        .iter()
                        .map(|a| Field {
                            label: string(a, "tier").replace('_', " "),
                            value: string(a, "hypothesis")
                                .trim_start_matches("Intervention hypothesis: ")
                                .into(),
                            note: format!(
                                "Confidence: {}. {}",
                                string(a, "confidence"),
                                string(a, "validation_procedure")
                            ),
                        })
                        .collect(),
                });
            }
            result.diagnoses.sort_by_key(|d| match d.state.as_str() {
                "FAIL" => 0,
                "WATCH" => 1,
                _ => 2,
            });
        }
        if let Some(checklist) = checklist {
            result.revision = string(checklist, "checker_revision");
            for item in array(&checklist["checklist"]) {
                let mut evidence: Vec<_> = array(&item["evidence"])
                    .iter()
                    .filter_map(|e| e["path"].as_str().map(str::to_owned))
                    .collect();
                if let Some(path) = item["source"]["path"].as_str() {
                    if !evidence.iter().any(|e| e == path) {
                        evidence.push(path.into());
                    }
                }
                result.checks.push(Check {
                    step: string(item, "step"),
                    category: string(item, "category"),
                    title: string(item, "title"),
                    state: string(item, "state"),
                    blocked: item["blocked"].as_bool().unwrap_or(false),
                    summary: string(item, "summary"),
                    evidence,
                });
            }
        }
        result
    }
}

#[cfg(test)]
#[path = "signoff_report_tests.rs"]
mod tests;
