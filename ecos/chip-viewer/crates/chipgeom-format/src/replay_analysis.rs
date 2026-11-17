//! Completion-only analysis bound to a recording's authoritative final scene.
use serde::Deserialize;

#[derive(Default, Deserialize)]
pub struct Analysis {
    pub schema: String,
    #[serde(default)]
    pub geometry_display: bool,
    #[serde(default)]
    pub nets: Vec<String>,
    #[serde(default)]
    pub instances: Vec<String>,
    pub views: Vec<View>,
    #[serde(default)]
    pub unavailable: Vec<String>,
}

#[derive(Deserialize)]
pub struct View {
    pub label: String,
    pub kind: String,
    pub basis: String,
    #[serde(default)]
    pub unit: String,
    pub items: Vec<Item>,
    #[serde(default)]
    pub summary: serde_json::Value,
}

#[derive(Default, Deserialize)]
pub struct Item {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub net_ref: Option<usize>,
    #[serde(default)]
    pub instance_ref: Option<usize>,
    #[serde(default)]
    pub bboxes: Vec<[i64; 4]>,
    #[serde(default)]
    pub instances: Vec<String>,
    #[serde(default)]
    pub nets: Vec<String>,
    #[serde(default)]
    pub pins: Vec<String>,
    #[serde(default)]
    pub positions: Vec<[i64; 2]>,
    #[serde(default)]
    pub segments: Vec<[[i64; 2]; 2]>,
    pub value: Option<f64>,
    #[serde(default)]
    pub details: serde_json::Value,
}
