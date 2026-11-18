//! Read-only counterpart of ECC signoff/report_extract.py's metric store.
use crate::replay::data::within;
use anyhow::{ensure, Context, Result};
use serde_json::{Map, Value};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::LazyLock,
};

static RULES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("signoff_metric_rules.json"))
        .expect("static signoff metric rules")
});
pub(super) fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}
pub(super) fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.replace(',', "").trim().parse().ok())
        .or_else(|| v.as_object().and_then(|o| o.get("value")).and_then(number))
        .filter(|n| n.is_finite())
}
fn normalized(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '_' | '-'))
        .flat_map(char::to_lowercase)
        .collect()
}
pub(super) fn nested<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(v, |v, key| {
        v.get(key).filter(|v| !v.is_null()).or_else(|| {
            v.as_object()?
                .iter()
                .find(|(k, _)| normalized(k) == normalized(key))
                .map(|(_, v)| v)
        })
    })
}
pub(super) fn lookup(v: &Value, aliases: &[&str]) -> Option<f64> {
    // ECC schema 3 arrays take precedence over raw feature keys.
    for m in array(&v["metrics"]) {
        if aliases.iter().any(|a| {
            ["id", "display_name"].iter().any(|k| {
                m[k].as_str()
                    .is_some_and(|s| normalized(s) == normalized(a))
            })
        }) {
            if let Some(n) = number(&m["value"]) {
                return Some(n);
            }
        }
    }
    aliases
        .iter()
        .find_map(|a| v.get(*a).and_then(number))
        .or_else(|| {
            aliases
                .iter()
                .filter(|a| a.contains('.'))
                .find_map(|a| nested(v, a).and_then(number))
        })
        .or_else(|| {
            v.as_object()?
                .values()
                .filter_map(Value::as_object)
                .find_map(|o| aliases.iter().find_map(|a| o.get(*a).and_then(number)))
        })
        .or_else(|| {
            aliases.iter().find_map(|a| {
                v.as_object()?
                    .iter()
                    .find(|(k, _)| normalized(k) == normalized(a))
                    .and_then(|(_, v)| number(v))
            })
        })
}
pub(super) fn stage(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "synthesis" | "synth" => "Synth",
        "legalization" | "legal" => "Legal",
        "placement" | "place" => "Place",
        "routing" | "route" => "Route",
        "postfloorplan" => "PostFloorplan",
        "poweranalysis" | "power" => "Power",
        "sta" => "STA",
        "cts" => "CTS",
        "drc" => "DRC",
        "lvs" => "LVS",
        "harden" => "Harden",
        _ => name,
    }
    .into()
}
pub(super) struct Sources<'a> {
    root: &'a Path,
    pub paths: Vec<PathBuf>,
    pub errors: Vec<String>,
    pub stages: BTreeMap<String, Value>,
    pub parameters: Value,
}
impl<'a> Sources<'a> {
    pub fn new(root: &'a Path, parameters: Value) -> Self {
        Self {
            root,
            paths: vec![],
            errors: vec![],
            stages: BTreeMap::new(),
            parameters,
        }
    }
    pub fn text(&mut self, relative: &str) -> Option<String> {
        let path = self.root.join(relative);
        self.paths.push(path.clone());
        if !path.exists() {
            return None;
        }
        let result = (|| -> Result<String> {
            let path = within(self.root, &path)?;
            let mut text = String::new();
            std::fs::File::open(path)?
                .take(16 * 1024 * 1024 + 1)
                .read_to_string(&mut text)?;
            ensure!(
                text.len() <= 16 * 1024 * 1024,
                "Signoff input exceeds 16 MiB"
            );
            Ok(text)
        })();
        match result {
            Ok(text) => Some(text),
            Err(e) => {
                self.errors.push(format!("{relative}: {e}"));
                None
            }
        }
    }
    pub fn json(&mut self, relative: &str) -> Option<Value> {
        let text = self.text(relative)?;
        match serde_json::from_str(&text).context("Invalid signoff JSON") {
            Ok(v) => Some(v),
            Err(e) => {
                self.errors.push(format!("{relative}: {e}"));
                None
            }
        }
    }
    pub fn collect(&mut self, flow: &Value) {
        if let Some(parameters) = self.json("home/parameters.json") {
            self.parameters = parameters;
        }
        for step in array(&flow["steps"]) {
            let (Some(name), Some(tool)) = (step["name"].as_str(), step["tool"].as_str()) else {
                continue;
            };
            if [name, tool]
                .iter()
                .any(|s| s.is_empty() || s.contains(['/', '\\']) || matches!(*s, "." | ".."))
            {
                continue;
            }
            let directory = format!("{name}_{tool}");
            let mut merged = Map::new();
            for file in ["qor_metrics.json", "qor_summary.json"] {
                if let Some(Value::Object(payload)) =
                    self.json(&format!("{directory}/analysis/{file}"))
                {
                    merged.extend(payload);
                }
            }
            let feature = self.root.join(&directory).join("feature");
            self.paths.push(feature.clone());
            if within(self.root, &feature).is_ok() {
                if let Ok(entries) = std::fs::read_dir(&feature) {
                    let mut paths: Vec<_> = entries
                        .flatten()
                        .map(|e| e.path())
                        .filter(|p| p.extension().is_some_and(|e| e == "json"))
                        .collect();
                    paths.sort();
                    for path in paths {
                        if let Ok(relative) = path.strip_prefix(self.root) {
                            if let Some(Value::Object(payload)) =
                                self.json(&relative.to_string_lossy())
                            {
                                merged.extend(payload);
                            }
                        }
                    }
                }
            }
            if !merged.is_empty() {
                self.stages.insert(stage(name), Value::Object(merged));
            }
        }
    }
    pub fn query(&self, label: &str) -> Option<f64> {
        let rule = &RULES[label];
        let aliases: Vec<_> = array(&rule["aliases"])
            .iter()
            .filter_map(Value::as_str)
            .collect();
        array(&rule["stages"])
            .iter()
            .filter_map(Value::as_str)
            .find_map(|s| self.stages.get(s).and_then(|v| lookup(v, &aliases)))
            .or_else(|| lookup(&self.parameters, &aliases))
    }
}
